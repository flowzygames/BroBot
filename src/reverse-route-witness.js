import pathfinder from 'mineflayer-pathfinder';
import Move from 'mineflayer-pathfinder/lib/move.js';

// Fresh directed-edge proof, never an assumption that a forward route reverses.
// A null result is inconclusive and must fall back to ordinary reverse A*.
export function reverseRouteWitness(bot, movements, forward, origin, {
  deadline, signal, validateNode = null, maxNodes = 64, budgetMs = 12,
  now = () => performance.now()
} = {}) {
  if (!(movements instanceof pathfinder.Movements) || movements.canDig !== false ||
      movements.allowParkour !== false || movements.allow1by1towers !== false ||
      movements.allowFreeMotion !== false || !Array.isArray(movements.scafoldingBlocks) ||
      movements.scafoldingBlocks.length || bot.pathfinder?.searchRadius !== -1 ||
      !Array.isArray(forward) || !forward.length || forward.length > 64 ||
      !Number.isInteger(maxNodes) || maxNodes < 1 || forward.length > maxNodes ||
      !Number.isFinite(budgetMs) || budgetMs < 0 ||
      typeof origin?.isEnd !== 'function' || !Number.isFinite(deadline) ||
      typeof bot.on !== 'function' || typeof bot.removeListener !== 'function') return null;
  const end = Math.min(deadline, now() + Math.max(0, Math.min(12, budgetMs)));
  const world = bot.world, entity = bot.entity, client = bot._client, planner = bot.pathfinder, dimension = bot.game?.dimension;
  let invalidated = false;
  const events = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'respawn', 'spawn', 'end', 'entityMoved', 'entitySpawn', 'entityGone'];
  const invalidate = () => { invalidated = true; };
  const unchanged = () => !invalidated && !signal?.aborted && now() < end && bot.world === world && bot.entity === entity &&
    bot._client === client && bot.pathfinder === planner && bot.game?.dimension === dimension;
  const clean = node => node && ['x', 'y', 'z'].every(k => Number.isSafeInteger(node[k])) &&
    !node.toBreak?.length && !node.toPlace?.length && !node.parkour;
  try {
    for (const event of events) bot.on(event, invalidate);
    if (!unchanged() || !forward.every(clean)) return null;
    // Exactly the reverse planner's collision-index refresh; no cross-call cache.
    if (movements.allowEntityDetection) {
      movements.clearCollisionIndex(); movements.updateCollisionIndex();
    }
    if (!unchanged()) return null;
    const last = forward.at(-1);
    let current = new Move(last.x, last.y, last.z, movements.countScaffoldingItems(), 0);
    const path = [];
    // A* also accepts its initial node before expanding or validating neighbors.
    if (origin.isEnd(current)) return unchanged() ? { path } : null;
    for (let index = forward.length - 2; index >= 0; index--) {
      if (!unchanged()) return null;
      const expected = forward[index];
      const neighbors = movements.getNeighbors(current);
      if (!unchanged()) return null;
      const next = neighbors.find(node => clean(node) && node.x === expected.x && node.y === expected.y && node.z === expected.z &&
        Number.isFinite(node.cost) && node.cost >= 0 && (!validateNode || validateNode(node)));
      if (!next || !unchanged()) return null;
      path.push(next); current = next;
      if (origin.isEnd(current)) return unchanged() ? { path } : null;
    }
    // The forward path omits its initial node. Never invent a floored/raised one.
    return null;
  } catch { return null; }
  finally { for (const event of events) bot.removeListener(event, invalidate); }
}

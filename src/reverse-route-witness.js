import pathfinder from 'mineflayer-pathfinder';
import Move from 'mineflayer-pathfinder/lib/move.js';

// Fresh directed-edge proof, never an assumption that a forward route reverses.
// A null result is inconclusive and must fall back to ordinary reverse A*.
export function reverseRouteWitness(bot, movements, forward, origin, {
  deadline, signal, validateNode = null, maxNodes = 64, budgetMs = 12,
  now = () => performance.now(), onDiagnostic = null
} = {}) {
  let status = 'declined', reason = 'exception', forwardNodes, validatedEdges = 0;
  const decline = value => { reason = value; return null; };
  const success = (path, value) => { status = 'success'; reason = value; return { path }; };
  try {
    // Preserve guard order: a policy refusal must not inspect later inputs.
    if (!(movements instanceof pathfinder.Movements) || movements.canDig !== false ||
        movements.allowParkour !== false || movements.allow1by1towers !== false ||
        movements.allowFreeMotion !== false || !Array.isArray(movements.scafoldingBlocks) ||
        movements.scafoldingBlocks.length || bot.pathfinder?.searchRadius !== -1) return decline('policy');
    if (!Array.isArray(forward) || !(forwardNodes = forward.length)) return decline('input');
    if (forward.length > 64 || !Number.isInteger(maxNodes) || maxNodes < 1 || forward.length > maxNodes ||
        !Number.isFinite(budgetMs) || budgetMs < 0) return decline('cap');
    if (typeof origin?.isEnd !== 'function' || !Number.isFinite(deadline) ||
        typeof bot.on !== 'function' || typeof bot.removeListener !== 'function') return decline('input');
    const end = Math.min(deadline, now() + Math.max(0, Math.min(12, budgetMs)));
    const world = bot.world, entity = bot.entity, client = bot._client, planner = bot.pathfinder, dimension = bot.game?.dimension;
    let invalidated = false;
    const events = ['blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'respawn', 'spawn', 'end', 'entityMoved', 'entitySpawn', 'entityGone'];
    const invalidate = () => { invalidated = true; };
    const unchanged = () => {
      if (invalidated) { reason = 'event'; return false; }
      if (signal?.aborted) { reason = 'cancelled'; return false; }
      const time = now();
      if (!(time < end)) {
        reason = typeof time === 'number' && time >= deadline ? 'planning_deadline'
          : typeof time === 'number' && time >= end ? 'local_deadline' : 'deadline';
        return false;
      }
      if (bot.world !== world || bot.entity !== entity || bot._client !== client ||
          bot.pathfinder !== planner || bot.game?.dimension !== dimension) { reason = 'context'; return false; }
      return true;
    };
    const clean = node => node && ['x', 'y', 'z'].every(k => Number.isSafeInteger(node[k])) &&
      !node.toBreak?.length && !node.toPlace?.length && !node.parkour;
    try {
      for (const event of events) bot.on(event, invalidate);
      if (!unchanged()) return null;
      if (!forward.every(clean)) return decline('input');
      // Exactly the reverse planner's collision-index refresh; no cross-call cache.
      if (movements.allowEntityDetection) {
        movements.clearCollisionIndex(); movements.updateCollisionIndex();
      }
      if (!unchanged()) return null;
      const last = forward.at(-1);
      let current = new Move(last.x, last.y, last.z, movements.countScaffoldingItems(), 0);
      const path = [];
      // A* also accepts its initial node before expanding or validating neighbors.
      if (origin.isEnd(current)) return unchanged() ? success(path, 'initial_endpoint') : null;
      for (let index = forward.length - 2; index >= 0; index--) {
        if (!unchanged()) return null;
        const expected = forward[index];
        const neighbors = movements.getNeighbors(current);
        if (!unchanged()) return null;
        const next = neighbors.find(node => clean(node) && node.x === expected.x && node.y === expected.y && node.z === expected.z &&
          Number.isFinite(node.cost) && node.cost >= 0 && (!validateNode || validateNode(node)));
        if (!next) return decline('corridor_unverified');
        if (!unchanged()) return null;
        path.push(next); current = next; validatedEdges++;
        if (origin.isEnd(current)) return unchanged() ? success(path, 'retained_corridor') : null;
      }
      // The forward path omits its initial node. Do not guess that coordinate:
      // one fresh directed edge may instead prove arrival at the caller's goal.
      // At most (forward.length - 1) corridor edges plus this final edge, <= 64.
      if (!unchanged()) return null;
      const neighbors = movements.getNeighbors(current);
      if (!unchanged()) return null;
      const home = neighbors.find(node => clean(node) && Number.isFinite(node.cost) && node.cost >= 0 &&
        (!validateNode || validateNode(node)) && origin.isEnd(node));
      if (!home) return decline('final_edge_unverified');
      if (!unchanged()) return null;
      path.push(home); validatedEdges++;
      return success(path, 'final_edge');
    } catch { return decline('exception'); }
    finally { for (const event of events) bot.removeListener(event, invalidate); }
  } catch (error) {
    // Preflight/cleanup exceptions keep their existing propagation behavior.
    status = 'declined'; reason = 'exception'; throw error;
  } finally {
    // Diagnostics observe the settled attempt after all existing cleanup, once.
    // Unknown lengths stay absent when an earlier guard refused to inspect them.
    try {
      if (typeof onDiagnostic === 'function') onDiagnostic({
        status, reason,
        ...(!Number.isSafeInteger(forwardNodes) || forwardNodes < 0 ? {} : { forward_nodes: Math.min(64, forwardNodes), ...(forwardNodes > 64 ? { forward_nodes_capped: true } : {}) }),
        validated_edges: validatedEdges
      });
    } catch {}
  }
}

import { Vec3 } from 'vec3'

const abortError = () => Object.assign(new Error('Action cancelled'), { name: 'AbortError' })

// Use the public path generator rather than mutating the pathfinder's active goal.
// A timeout is unknown, never evidence that a route is safe.
export async function planReturnablePath (bot, movements, goal, origin, { signal, planningBudget = 1600, fixedEndpoint = null, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (typeof bot.pathfinder.getPathFromTo !== 'function') throw new Error('Return-path planning is unavailable; refusing collection travel')
  const deadline = performance.now() + planningBudget
  const check = () => { if (signal?.aborted) throw abortError(); if (performance.now() >= deadline) throw new Error('Return-path planning budget exhausted') }
  const plan = async (start, target) => {
    check()
    const remaining = Math.max(1, deadline - performance.now())
    const generator = bot.pathfinder.getPathFromTo(movements, start, target, { timeout: remaining, tickTimeout: 25, optimizePath: false })
    let result
    try {
      for (const value of generator) {
        check(); result = value.result
        if (result.status !== 'partial') break
        await yieldControl()
      }
    } finally { generator.return?.() }
    check()
    if (result?.status !== 'success') throw new Error(`No verified returnable walking route (${result?.status ?? 'unknown'})`)
    if (result.path.some(p => p.toBreak?.length || p.toPlace?.length)) throw new Error('Collection route would modify terrain')
    return result
  }
  // Pickup already validates an exact standing cell. A sealed drop pocket can
  // exhaust a huge forward search even though its reverse component is tiny.
  // Reject that pocket first; both directions still share the same deadline.
  let fixed = null, reverse = null
  if (fixedEndpoint !== null) {
    if (!['x', 'y', 'z'].every(k => Number.isInteger(fixedEndpoint[k])) || typeof goal.isEnd !== 'function') throw new Error('Fixed endpoint must be an exact standing-cell goal')
    fixed = new Vec3(fixedEndpoint.x, fixedEndpoint.y, fixedEndpoint.z)
    if (!goal.isEnd(fixed)) throw new Error('Fixed endpoint does not satisfy the walking goal')
    reverse = await plan(fixed, origin)
  }
  const forward = await plan(bot.entity.position.clone(), goal)
  const last = forward.path.at(-1)
  const endpoint = last ? new Vec3(last.x, last.y, last.z) : bot.entity.position.floored()
  // Origin goal is supplied by the caller so the helper does not depend on an internal goal class.
  if (fixed && !endpoint.equals(fixed)) throw new Error('Forward route ended at a different fixed endpoint')
  if (!reverse) reverse = await plan(endpoint, origin)
  return { endpoint, forwardNodes: forward.path.length, reverseNodes: reverse.path.length }
}

// Item-aware navigation owns its listeners/goal. No never-ending goto promise is
// left behind when an item is acquired, disappears, or a local budget expires.
export function pursueDroppedItem (bot, goal, entity, { signal, timeoutMs = 6000, stallMs = 1800, pollMs = 75 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, timer, lastMove = performance.now(), position = bot.entity.position.clone(), ownsGoal = false
    const exists = () => !!bot.entities?.[entity.id]
    const finish = (error, reason) => {
      if (settled) return
      settled = true; clearInterval(timer)
      signal?.removeEventListener('abort', aborted)
      bot.removeListener('entityGone', gone); bot.removeListener('playerCollect', collected)
      bot.removeListener('goal_reached', reached); bot.removeListener('goal_updated', changed); bot.removeListener('path_update', pathUpdate)
      // Serialization gives this pursuit exclusive movement ownership. Never clear a replacement goal.
      if (ownsGoal && (bot.pathfinder.goal === undefined || bot.pathfinder.goal === goal)) {
        try { bot.pathfinder.setGoal(null) } catch {}
        try { bot.clearControlStates?.() } catch {}
      }
      if (error) reject(error); else resolve({ reason })
    }
    const aborted = () => finish(abortError())
    const gone = e => { if (e.id === entity.id) finish(null, 'target_gone') }
    const collected = (collector, item) => { if (collector?.id === bot.entity.id && item?.id === entity.id) finish(null, 'collected') }
    const reached = g => { if (!g || g === goal) finish(null, 'arrived') }
    const changed = g => { if (ownsGoal && g !== goal) finish(signal?.aborted ? abortError() : new Error('Pickup navigation goal replaced')) }
    const pathUpdate = result => {
      if (result.status === 'noPath' || result.status === 'timeout') finish(new Error(`Pickup navigation ${result.status}`))
    }
    if (signal?.aborted) return aborted()
    if (!exists()) return finish(null, 'target_gone')
    signal?.addEventListener('abort', aborted, { once: true })
    bot.on('entityGone', gone); bot.on('playerCollect', collected); bot.on('goal_reached', reached); bot.on('goal_updated', changed); bot.on('path_update', pathUpdate)
    const started = performance.now()
    timer = setInterval(() => {
      if (signal?.aborted) return aborted()
      if (!exists()) return finish(null, 'target_gone')
      const now = performance.now()
      if (bot.entity.position.distanceTo(position) >= 0.35) { position = bot.entity.position.clone(); lastMove = now }
      if (now - started >= timeoutMs) finish(new Error('Pickup navigation exceeded its local time budget'))
      else if (now - lastMove >= stallMs) finish(new Error('Pickup navigation made no movement progress'))
    }, pollMs)
    try { ownsGoal = true; bot.pathfinder.setGoal(goal) } catch (error) { finish(error) }
  })
}

// Bound walking separately from the whole collection action, so a blocked
// approach can be recorded and another resource tried before the action expires.
export function walkToGoal(bot, goal, { signal, timeoutMs = 15000, stallMs = 3000, pollMs = 100 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false, timer, ownsGoal = false;
    let position = bot.entity.position.clone(), lastMove = performance.now();
    const started = lastMove;
    const finish = error => {
      if (settled) return;
      settled = true; clearInterval(timer);
      signal?.removeEventListener('abort', aborted);
      bot.removeListener('goal_reached', reached); bot.removeListener('goal_updated', changed); bot.removeListener('path_update', pathUpdate);
      if (ownsGoal && (bot.pathfinder.goal === undefined || bot.pathfinder.goal === goal)) {
        try { bot.pathfinder.setGoal(null); } catch {}
        try { bot.clearControlStates?.(); } catch {}
      }
      if (error) reject(error); else resolve({ arrived: true });
    };
    const aborted = () => finish(abortError());
    const reached = g => {
      if (g && g !== goal) return;
      if (typeof goal.isEnd === 'function' && !goal.isEnd(bot.entity.position.floored())) return;
      finish();
    };
    const changed = g => { if (ownsGoal && g !== goal) finish(signal?.aborted ? abortError() : new Error('Walking navigation goal replaced')); };
    const pathUpdate = result => { if (['noPath', 'timeout'].includes(result.status)) finish(new Error(`Walking route ${result.status}`)); };
    if (signal?.aborted) return aborted();
    if (typeof goal.isEnd === 'function' && goal.isEnd(bot.entity.position.floored())) return finish();
    signal?.addEventListener('abort', aborted, { once: true });
    bot.on('goal_reached', reached); bot.on('goal_updated', changed); bot.on('path_update', pathUpdate);
    timer = setInterval(() => {
      if (signal?.aborted) return aborted();
      const now = performance.now();
      if (bot.entity.position.distanceTo(position) >= 0.35) { position = bot.entity.position.clone(); lastMove = now; }
      if (now - started >= timeoutMs) finish(new Error('Walking route exceeded its local time budget'));
      else if (now - lastMove >= stallMs) finish(new Error('Walking route made no movement progress'));
    }, pollMs);
    try { ownsGoal = true; bot.pathfinder.setGoal(goal); } catch (error) { finish(error); }
  });
}

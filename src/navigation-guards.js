import { reverseRouteWitness } from './reverse-route-witness.js'
import { annotateRouteFailure, routeFailure, reverseWitness } from './route-diagnostics.js'
import { Vec3 } from 'vec3'

// Aquatic plants and bubble columns carry water even when isWaterlogged is false.
export const WATER_BEARING_BLOCK_NAMES = Object.freeze(['water', 'flowing_water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass'])
// Powder snow can freeze an unequipped starter even though it is not a fluid.
export const STARTER_AVOID_BLOCK_NAMES = Object.freeze([...WATER_BEARING_BLOCK_NAMES, 'powder_snow'])
const FLUID_BEARING_BLOCKS = new Set([...WATER_BEARING_BLOCK_NAMES, 'lava', 'flowing_lava'])
export const isFluidBearingBlock = block => Boolean(block && (block.isWaterlogged || FLUID_BEARING_BLOCKS.has(block.name)))

const abortError = () => Object.assign(new Error('Action cancelled'), { name: 'AbortError' })

// Use the public path generator rather than mutating the pathfinder's active goal.
// A timeout is unknown, never evidence that a route is safe.
export async function planReturnablePath (bot, movements, goal, origin, { signal, planningBudget = 1600, fixedEndpoint = null, validateNode = null, onCertifiedPaths = null, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  if (typeof bot.pathfinder.getPathFromTo !== 'function') throw new Error('Return-path planning is unavailable; refusing collection travel')
  const deadline = performance.now() + planningBudget
  let witnessDiagnostic = null
  const check = () => { if (signal?.aborted) throw abortError(); if (performance.now() >= deadline) throw new Error('Return-path planning budget exhausted') }
  const plan = async (start, target, phase) => {
    let result
    try {
      check()
      const remaining = Math.max(1, deadline - performance.now())
      const generator = bot.pathfinder.getPathFromTo(movements, start, target, { timeout: remaining, tickTimeout: 25, optimizePath: false })
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
      if (validateNode && result.path.some(p => !validateNode(p))) throw new Error('No verified returnable walking route (unsafe node)')
      return result
    } catch (error) { throw annotateRouteFailure(error, phase, result?.status, phase === 'reverse' ? witnessDiagnostic : null) }
  }
  // Pickup already validates an exact standing cell. A sealed drop pocket can
  // exhaust a huge forward search even though its reverse component is tiny.
  // Reject that pocket first; both directions still share the same deadline.
  let fixed = null, reverse = null
  if (fixedEndpoint !== null) {
    if (!['x', 'y', 'z'].every(k => Number.isInteger(fixedEndpoint[k])) || typeof goal.isEnd !== 'function') throw new Error('Fixed endpoint must be an exact standing-cell goal')
    fixed = new Vec3(fixedEndpoint.x, fixedEndpoint.y, fixedEndpoint.z)
    if (!goal.isEnd(fixed)) throw new Error('Fixed endpoint does not satisfy the walking goal')
    reverse = await plan(fixed, origin, 'reverse')
  }
  const forward = await plan(bot.entity.position.clone(), goal, 'forward')
  const last = forward.path.at(-1)
  const endpoint = last ? new Vec3(last.x, last.y, last.z) : bot.entity.position.floored()
  // Origin goal is supplied by the caller so the helper does not depend on an internal goal class.
  if (fixed && !endpoint.equals(fixed)) throw new Error('Forward route ended at a different fixed endpoint')
  if (!reverse) {
    // Try only freshly generated reverse edges on the already observed forward
    // corridor. Inconclusive evidence keeps the original reverse search.
    const witness = reverseRouteWitness(bot, movements, forward.path, origin, { deadline, signal, validateNode, onDiagnostic: value => { witnessDiagnostic = reverseWitness(value) } })
    try { check() } catch (error) { throw annotateRouteFailure(error, 'reverse', undefined, witnessDiagnostic) }
    reverse = witness ?? await plan(endpoint, origin, 'reverse')
  }
  if (onCertifiedPaths) { onCertifiedPaths({forward:forward.path.map(p=>({x:p.x,y:p.y,z:p.z})),reverse:reverse.path.map(p=>({x:p.x,y:p.y,z:p.z}))});check() }
  return { endpoint, forwardNodes: forward.path.length, reverseNodes: reverse.path.length, ...(witnessDiagnostic ? { reverse_witness: witnessDiagnostic } : {}) }
}

// Ranked scout alternatives share one planning window. Failed probes never
// move the bot and do not consume a second, fresh planning allowance.
export async function planRankedRoutes(candidates, plan, { signal, budget = 1600, now = () => performance.now() } = {}) {
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 4) throw new Error('Expected one to four route candidates');
  const deadline = now() + Math.min(1600, Math.max(0, budget));
  const tried = [], outcomes = [];
  const annotate = error => { error.result = { ...(error.result ?? {}), directions_tried: [...tried], route_attempts: [...outcomes] }; return error; };
  let lastError;
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) throw annotate(abortError());
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const candidate = candidates[index]; tried.push(candidate);
    try {
      const route = await plan(candidate, remaining / (candidates.length - index));
      if (signal?.aborted) throw abortError();
      if (now() >= deadline) throw new Error('Scout planning budget exhausted');
      outcomes.push({ direction: candidate, status: 'verified' });
      return { route, candidate, tried, outcomes };
    } catch (error) {
      const diagnostic = routeFailure(error);
      outcomes.push({ direction: candidate, status: signal?.aborted || error.name === 'AbortError' ? 'cancelled' : 'unverified', reason: error.message, ...(diagnostic ? { route_failure: diagnostic } : {}) });
      if (signal?.aborted || error.name === 'AbortError' || !/^(No verified returnable walking route|Return-path planning budget exhausted|Collection route would modify terrain|Scout planning budget exhausted)/.test(error.message)) throw annotate(error);
      lastError = error;
    }
  }
  throw Object.assign(new Error(`No verified scout route: ${lastError?.message ?? 'planning budget exhausted'}`), { result: { directions_tried: tried, route_attempts: outcomes } });
}

// Item-aware navigation owns its listeners/goal. No never-ending goto promise is
// left behind when an item is acquired, disappears, or a local budget expires.
export function pursueDroppedItem (bot, goal, entity, { signal, timeoutMs = 6000, stallMs = 1800, pollMs = 75, waitForLanding = false, safeToStop = () => true, atDestination = null, ownershipGuard = null } = {}) {
  return new Promise((resolve, reject) => {
    const pathfinder = bot.pathfinder
    const owns = () => { try { return bot.pathfinder === pathfinder && (ownershipGuard == null || (typeof ownershipGuard === 'function' && ownershipGuard() === true)) } catch { return false } }
    let settled = false, timer, lastMove = performance.now(), position = bot.entity.position.clone(), ownsGoal = false, pendingReason = null, verifiedLanding = false
    const started = performance.now()
    const exists = () => !!bot.entities?.[entity.id]
    const finish = (error, reason) => {
      if (!error && !owns()) error = new Error('Pickup pathfinder replaced')
      if (settled) return
      settled = true; clearInterval(timer)
      signal?.removeEventListener('abort', aborted)
      bot.removeListener('entityGone', gone); bot.removeListener('playerCollect', collected)
      bot.removeListener('goal_reached', reached); bot.removeListener('goal_updated', changed); bot.removeListener('path_update', pathUpdate)
      // Serialization gives this pursuit exclusive movement ownership. Never clear a replacement goal.
      if (ownsGoal && owns() && (pathfinder.goal === undefined || pathfinder.goal === goal)) {
        try { pathfinder.setGoal(null) } catch {}
        if (owns() && (pathfinder.goal == null || pathfinder.goal === goal)) {
          try { bot.clearControlStates?.() } catch {}
        }
      }
      if (error) reject(error); else resolve(waitForLanding ? { reason, started: ownsGoal, landingVerified: verifiedLanding } : { reason })
    }
    const aborted = () => finish(abortError())
    const deadlineReached = () => performance.now() - started >= timeoutMs;
    const readyToStop = () => {
      if (!waitForLanding) return true;
      if (bot.entity.onGround !== true) return false;
      try {
        const destination = atDestination ? atDestination() : typeof goal.isEnd === 'function' ? goal.isEnd(bot.entity.position.floored()) : !['x','y','z'].every(k => Number.isFinite(goal[k])) || ['x','y','z'].every(k => Math.floor(bot.entity.position[k]) === goal[k]);
        return Boolean(destination && safeToStop());
      } catch (error) { finish(error instanceof Error ? error : new Error('Landing safety check failed')); return false; }
    };
    const requestFinish = reason => {
      if (!owns()) return finish(new Error('Pickup pathfinder replaced'));
      if (deadlineReached()) return finish(new Error('Pickup navigation exceeded its local time budget'));
      if (pendingReason !== 'collected') pendingReason = reason;
      if (readyToStop()) { verifiedLanding = waitForLanding; finish(null, pendingReason); }
    };
    // An item can be collected during a jump. Keep the already-certified goal
    // until its grounded certified destination rather than abandoning a landing midflight.
    const gone = e => { if (e.id === entity.id) requestFinish('target_gone') }
    const collected = (collector, item) => { if (collector?.id === bot.entity.id && item?.id === entity.id) requestFinish('collected') }
    const reached = g => { if (!g || g === goal) requestFinish(pendingReason || 'arrived') }
    const changed = g => { if (!owns()) return finish(new Error('Pickup pathfinder replaced')); if (ownsGoal && g !== goal) finish(signal?.aborted ? abortError() : new Error('Pickup navigation goal replaced')) }
    const pathUpdate = result => {
      if (!owns()) return finish(new Error('Pickup pathfinder replaced'))
      if (result.status === 'noPath' || result.status === 'timeout') finish(new Error(`Pickup navigation ${result.status}`))
    }
    if (signal?.aborted) return aborted()
    if (!owns()) return finish(new Error('Pickup pathfinder replaced or ownership lost'))
    if (!exists()) {
      if (!waitForLanding) return finish(null, 'target_gone');
      try {
        if (bot.entity.onGround !== true || !safeToStop()) return finish(Object.assign(new Error('Drop vanished before pursuit from an unverified landing'), { code: 'PICKUP_UNSAFE_SETTLEMENT' }));
      } catch (error) { return finish(error instanceof Error ? error : new Error('Landing safety check failed')); }
      return finish(null, 'target_gone_before_pursuit');
    }
    signal?.addEventListener('abort', aborted, { once: true })
    bot.on('entityGone', gone); bot.on('playerCollect', collected); bot.on('goal_reached', reached); bot.on('goal_updated', changed); bot.on('path_update', pathUpdate)
    timer = setInterval(() => {
      if (signal?.aborted) return aborted()
      if (!owns()) return finish(new Error('Pickup pathfinder replaced'))
      if (deadlineReached()) return finish(new Error('Pickup navigation exceeded its local time budget'))
      if (!exists()) requestFinish('target_gone')
      if (settled) return
      if (pendingReason && readyToStop()) return requestFinish(pendingReason)
      const now = performance.now()
      if (bot.entity.position.distanceTo(position) >= 0.35) { position = bot.entity.position.clone(); lastMove = now }
      if (now - started >= timeoutMs) finish(new Error('Pickup navigation exceeded its local time budget'))
      else if (now - lastMove >= stallMs) finish(new Error('Pickup navigation made no movement progress'))
    }, pollMs)
    try { if (!owns()) throw new Error('Navigation ownership changed before starting'); ownsGoal = true; pathfinder.setGoal(goal) } catch (error) { finish(error) }
  })
}

// Bound walking separately from the whole collection action, so a blocked
// approach can be recorded and another resource tried before the action expires.
export function walkToGoal(bot, goal, { signal, timeoutMs = 15000, stallMs = 3000, pollMs = 100, ownershipGuard = null } = {}) {
  return new Promise((resolve, reject) => {
    const pathfinder = bot.pathfinder
    const owns = () => { try { return bot.pathfinder === pathfinder && (ownershipGuard == null || (typeof ownershipGuard === 'function' && ownershipGuard() === true)) } catch { return false } };
    let settled = false, timer, ownsGoal = false;
    let position = bot.entity.position.clone(), lastMove = performance.now();
    const started = lastMove;
    const finish = error => {
      if (!error && !owns()) error = new Error('Walking pathfinder replaced');
      if (settled) return;
      settled = true; clearInterval(timer);
      signal?.removeEventListener('abort', aborted);
      bot.removeListener('goal_reached', reached); bot.removeListener('goal_updated', changed); bot.removeListener('path_update', pathUpdate);
      if (ownsGoal && owns() && (pathfinder.goal === undefined || pathfinder.goal === goal)) {
        try { pathfinder.setGoal(null); } catch {}
        // setGoal emits synchronously: another owner may start from its listener.
        if (owns() && (pathfinder.goal == null || pathfinder.goal === goal)) {
          try { bot.clearControlStates?.(); } catch {}
        }
      }
      if (error) reject(error); else resolve({ arrived: true });
    };
    const aborted = () => finish(abortError());
    const reached = g => {
      if (!owns()) return finish(new Error('Walking pathfinder replaced'));
      if (g && g !== goal) return;
      if (typeof goal.isEnd === 'function' && !goal.isEnd(bot.entity.position.floored())) return;
      finish();
    };
    const changed = g => { if (!owns()) return finish(new Error('Walking pathfinder replaced')); if (ownsGoal && g !== goal) finish(signal?.aborted ? abortError() : new Error('Walking navigation goal replaced')); };
    const pathUpdate = result => { if (!owns()) return finish(new Error('Walking pathfinder replaced')); if (['noPath', 'timeout'].includes(result.status)) finish(new Error(`Walking route ${result.status}`)); };
    if (signal?.aborted) return aborted();
    if (!owns()) return finish(new Error('Walking pathfinder replaced or ownership lost'));
    if (typeof goal.isEnd === 'function' && goal.isEnd(bot.entity.position.floored())) return finish();
    signal?.addEventListener('abort', aborted, { once: true });
    bot.on('goal_reached', reached); bot.on('goal_updated', changed); bot.on('path_update', pathUpdate);
    timer = setInterval(() => {
      if (signal?.aborted) return aborted();
      if (!owns()) return finish(new Error('Walking pathfinder replaced'));
      const now = performance.now();
      if (bot.entity.position.distanceTo(position) >= 0.35) { position = bot.entity.position.clone(); lastMove = now; }
      if (now - started >= timeoutMs) finish(new Error('Walking route exceeded its local time budget'));
      else if (now - lastMove >= stallMs) finish(new Error('Walking route made no movement progress'));
    }, pollMs);
    try { if (!owns()) throw new Error('Navigation ownership changed before starting'); ownsGoal = true; pathfinder.setGoal(goal); } catch (error) { finish(error); }
  });
}

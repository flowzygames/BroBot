// Private prepared-world executor. No public tool definition or starter route.
// Call only under the existing Actions/ActionRunner physical lock. The hooks
// are trusted in-process operations, never JSON-supplied callbacks or receipts.
import { Vec3 } from 'vec3'
import { planSoilStair } from './soil-stair-plan.js'
import { assertTerrainTrusted, terrainTrustStatus } from '../terrain-trust.js'
import { isDryLanding, isHazardFreeBody, hasObservedStandingSupport } from '../body-hazards.js'
import { hasAnchoredLeafLanding } from '../starter-leaf-support.js'

const air = block => ['air', 'cave_air', 'void_air'].includes(block?.name)
const finite = p => p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k]))
const cellKey = p => `${p.x},${p.y},${p.z}`
const columnKey = p => `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`
const supports = (block, feet) => block.y < feet.y && block.y + 1 >= feet.y - .03
  && feet.x + .31 > block.x && feet.x - .31 < block.x + 1
  && feet.z + .31 > block.z && feet.z - .31 < block.z + 1
const matches = (block, expected) => block && block.name === expected.name
  && block.stateId === expected.stateId && block.type === expected.type
  && Boolean(block.isWaterlogged) === expected.waterlogged
  && block.boundingBox === expected.boundingBox
  && JSON.stringify(block.shapes) === JSON.stringify(expected.shapes)

export async function executeSoilStair({ bot, home, signal, operationDeadline,
  ownershipGuard, validatePolicy, protectedPositions, mine, walk, halt }) {
  if (![ownershipGuard, validatePolicy, protectedPositions, mine, walk, halt].every(fn => typeof fn === 'function')) throw Error('Private soil execution requires trusted ownership and operation hooks')
  if (!Number.isFinite(operationDeadline)) throw Error('Private soil execution requires a runner deadline')
  const owner = { entity: bot.entity, client: bot._client, world: bot.world, registry: bot.registry, pathfinder: bot.pathfinder }
  const deadline = Math.min(operationDeadline, performance.now() + 60000)
  let failure = null, inFlight = null, confirmed = 0, dependentClears = 0, landings = 0, timer, monitor, stationary = null
  const listeners = [], retained = [], landingObservations = [], planningDiagnostics = []
  const progress = () => ({ experimental: true, completed: false, planning_diagnostics: [...planningDiagnostics], confirmed_soil_edits: confirmed, confirmed_dependent_clears: dependentClears, unfinished_soil_target: inFlight ? [...inFlight.target] : null, terrain_trusted: terrainTrustStatus(bot).trusted, verified_descents: landings, landing_observations: landingObservations.map(sample => ({ ...sample, position: [...sample.position], velocity: [...sample.velocity], target: [...sample.target] })) })
  const check = () => {
    if (failure) throw failure
    signal?.throwIfAborted()
    assertTerrainTrusted(bot)
    if (ownershipGuard() !== true) throw Error('Private soil control ownership changed')
    if (validatePolicy() !== true) throw Error('Private soil movement policy changed')
    if (Object.entries(owner).some(([key, value]) => bot[key === 'client' ? '_client' : key] !== value)) throw Error('Private soil play session changed')
    if (performance.now() >= deadline) throw Error('Private soil operation deadline reached')
    if (!Number.isFinite(bot.health) || bot.health < 12 || !Number.isFinite(bot.food) || bot.food < 10) throw Error('Private soil health or food threshold failed')
  }
  const fail = reason => {
    if (!failure) failure = reason instanceof Error ? reason : new Error(reason)
    try { halt(failure) } catch { /* The operation still fails and drains. */ }
  }
  const dependencies = proof => {
    check()
    for (const expected of proof.dependencies) {
      if (!matches(bot.blockAt(new Vec3(...expected.position)), expected)) throw Error('Private soil route dependency changed')
    }
    check()
  }
  const atStage = coordinates => {
    check()
    const expected = new Vec3(...coordinates), actual = bot.entity.position, velocity = bot.entity.velocity
    if (!finite(actual) || !finite(velocity) || bot.entity.onGround !== true
      || Math.abs(actual.y - expected.y) > .03 || Math.hypot(actual.x - expected.x, actual.z - expected.z) > .35
      || velocity.y > .03 || velocity.y < -.1 || Math.hypot(velocity.x, velocity.z) > .08
      || !isDryLanding(bot) || !hasObservedStandingSupport(bot) || !hasAnchoredLeafLanding(bot, actual)) throw Error('Private soil stage is not a settled supported landing')
  }
  const feet = () => {
    const fresh = protectedPositions()
    if (!Array.isArray(fresh) || fresh.length > 128 || fresh.some(p => !finite(p))) throw Error('Private soil protected positions are invalid')
    return [...retained, home, bot.entity.position, ...fresh]
  }
  const waitSettled = async coordinates => {
    const until = Math.min(deadline, performance.now() + 2000)
    let stable = 0
    while (performance.now() < until) {
      check()
      try { atStage(coordinates); stable++ } catch (error) {
        check(); stable = 0
      }
      if (stable >= 2) return
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    throw Error('Private soil landing did not settle')
  }
  try {
    check()
    const plan = await planSoilStair(bot, home, { signal, protectedPositions: feet(), budgetMs: Math.min(1000, deadline - performance.now()), onDiagnostic: detail => { if (planningDiagnostics.length >= 8) planningDiagnostics.splice(1, 1); planningDiagnostics.push(detail) } })
    check()
    if (!plan) throw Error('No observed forward soil staircase is available')
    stationary = plan.origin
    retained.push(new Vec3(...plan.origin))
    const proofs = [plan.approach, plan.staged, plan.stoneAccess,
      ...plan.edits.flatMap(edit => [edit.before, edit.after, ...(edit.landing ? [edit.landing] : [])])]
    const watched = new Set(proofs.flatMap(proof => proof.dependencies.map(cell => cell.position.join(','))))
    const columns = new Set([...watched].map(k => columnKey(new Vec3(...k.split(',').map(Number)))))
    const onBlock = (before, after) => {
      try {
        const p = after?.position, old = before?.position
        if (!finite(p) || !finite(old) || ![p.x,p.y,p.z,old.x,old.y,old.z].every(Number.isInteger)) return fail('Malformed soil terrain observation')
        if (!watched.has(cellKey(p)) && !watched.has(cellKey(old))) return
        const permitted=inFlight && [inFlight.expected,...(inFlight.dependents??[])].find(expected=>expected.position.join(',')===cellKey(p));
        if (permitted && cellKey(old)===cellKey(p) && air(after) && (matches(before,permitted)||air(before))) return
        if (before.name !== after.name || before.stateId !== after.stateId || Boolean(before.isWaterlogged) !== Boolean(after.isWaterlogged)
          || JSON.stringify(before.shapes) !== JSON.stringify(after.shapes)) fail('Observed soil route terrain changed')
      } catch { fail('Malformed soil terrain observation') }
    }
    const onColumn = p => {
      try {
        if (!finite(p) || p.y !== 0 || p.x % 16 || p.z % 16 || columns.has(columnKey(p))) fail('Soil route column changed')
      } catch { fail('Malformed soil column observation') }
    }
    const onEntity = entity => {
      if (entity === bot.entity || entity?.id === bot.entity?.id || entity?.name === 'item') return
      fail('Entity changed during private soil execution')
    }
    const operational = () => {
      try {
        check()
        if (!isHazardFreeBody(bot)) throw Error('Private soil body entered unsafe terrain')
        if (stationary) atStage(stationary)
        if (inFlight && feet().some(p => supports(new Vec3(...inFlight.target), p))) throw Error('Private soil target became a protected support')
      } catch (error) { fail(error) }
    }
    listeners.push(['health', operational], ['physicsTick', operational], ['blockUpdate', onBlock], ['chunkColumnLoad', onColumn], ['chunkColumnUnload', onColumn])
    for (const event of ['spawn', 'respawn', 'end', 'terrainUntrusted']) listeners.push([event, () => fail('Soil play session invalidated')])
    for (const event of ['entitySpawn', 'entityGone', 'entityMoved', 'entityUpdate']) listeners.push([event, onEntity])
    for (const [event, listener] of listeners) bot.on(event, listener)
    timer = setTimeout(() => fail('Private soil operation deadline reached'), Math.max(1, deadline - performance.now()))
    timer.unref?.()
    monitor = setInterval(operational, 50)
    monitor.unref?.()
    dependencies(plan.approach)
    atStage(plan.origin)
    dependencies(plan.staged)
    stationary = null
    await walk(plan.approach.routes.at(-1), plan.stage, signal, deadline, ownershipGuard)
    await waitSettled(plan.stage)
    stationary = plan.stage
    dependencies(plan.staged)
    retained.push(bot.entity.position.clone())
    let stage = plan.stage
    for (const edit of plan.edits) {
      const validate = () => {
        dependencies(edit.before)
        atStage(stage)
        const target = new Vec3(...edit.target)
        if (!matches(bot.blockAt(target), edit.expected) || [target,...(edit.dependents??[]).map(cell=>new Vec3(...cell.position))].some(cell=>feet().some(position => supports(cell, position)))) throw Error('Private soil edit target or protected support changed')
      }
      validate()
      inFlight = edit
      await mine(new Vec3(...edit.target), edit.expected.name, validate, signal, deadline, edit.dependents??[])
      confirmed++
      dependentClears += edit.dependents?.length ?? 0
      inFlight = null
      check()
      dependencies(edit.after)
      if (edit.landing) {
        dependencies(edit.landing)
        stationary = null
        await walk(edit.landing.routes.at(-1), edit.landing.stage, signal, deadline, ownershipGuard)
        await waitSettled(edit.landing.stage)
        dependencies(edit.landing)
        stage = edit.landing.stage
        stationary = stage
        retained.push(bot.entity.position.clone())
        landings++
        landingObservations.push({ target: [...stage], position: bot.entity.position.toArray(), velocity: bot.entity.velocity.toArray(), onGround: bot.entity.onGround, health: bot.health, food: bot.food, observedAt: new Date().toISOString() })
      }
    }
    dependencies(plan.stoneAccess)
    atStage(stage)
    const stone = bot.blockAt(new Vec3(...plan.stone))
    if (stone?.name !== 'stone') throw Error('Exposed stone changed before final inspection')
    return { ...progress(), completed: true, exposed_stone: plan.stone, position: bot.entity.position.toArray(), stone_mined: false }
  } catch (error) {
    const result = failure || (error instanceof Error ? error : new Error(String(error)))
    result.result = { ...result.result, ...progress() }
    throw result
  } finally {
    clearTimeout(timer)
    clearInterval(monitor)
    for (const [event, listener] of listeners) bot.removeListener(event, listener)
  }
}

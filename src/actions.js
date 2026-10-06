import { randomUUID } from 'node:crypto'
import { retainOperationResult } from './action-error-result.js'
import { executeSoilStair } from './experimental/soil-stair-execute.js'
import { collectExposedSoilStone } from './experimental/soil-stone-collect.js'
import { assertStarterLeafSupport, hasAnchoredLeafLanding } from './starter-leaf-support.js'
import { sameItemIdentity, itemStackCapacity } from './item-identity.js'
import { pickupRouteBudget, PICKUP_ROUTE_BUDGET } from './pickup-route-budget.js'
import { PickupProbeLedger } from './pickup-probe-ledger.js'
import { runStarterRetreat } from './starter-retreat.js'
import { interactionSession, prepareObservedActivation, confirmSleep, confirmWake, interactionVisible, visibleInteractionFace } from './guarded-activation.js'
import { confirmedMining, MINING_DEADLINE_INSUFFICIENT } from './experimental/confirmed-mining.js'
import { assertTerrainTrusted } from './terrain-trust.js'
import { DropRetryCache } from './drop-retry-cache.js'
import { awaitPassiveLanding } from './passive-settlement.js'
import { isDryLanding, isAtPickupStandingCell } from './body-hazards.js'
import { certifyWorkstationEgress } from './workstation-egress.js'
import { sectionSearchDistance } from './block-search.js'
import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { configureCollisionMargin } from './collision-margin.js'
import { configureCollisionContact } from './collision-contact.js'
import { ownOxygenLevel } from './oxygen.js'
import { planLeafNotch } from './canopy-descent.js'
import { inspectMiningGoalSpace, MINING_NO_GOAL_SPACE } from './mining-goal-space.js'
import { BlockSearchCursor } from './block-search-cursor.js'
import { EmptySearchContinuation } from './empty-search-continuation.js'
import { hasStarterFood } from './starter-foods.js'
import { retainedLeafAnchor } from './construction-guards.js'
import { planReturnablePath, planRankedRoutes, pursueDroppedItem, walkToGoal, isFluidBearingBlock, WATER_BEARING_BLOCK_NAMES, STARTER_AVOID_BLOCK_NAMES } from './navigation-guards.js'

const { Movements, goals } = pathfinderPackage
const AIR = new Set(['air', 'cave_air', 'void_air'])
const DIRECTIONS = [new Vec3(0, -1, 0), new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1), new Vec3(0, 1, 0)]
const FOOD_EXCLUDE = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'chorus_fruit', 'suspicious_stew'])
const CRAFT_HINTS = ['oak_planks', 'spruce_planks', 'birch_planks', 'jungle_planks', 'acacia_planks', 'dark_oak_planks', 'mangrove_planks', 'cherry_planks', 'stick', 'crafting_table', 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'stone_axe', 'iron_axe', 'stone_sword', 'iron_sword', 'furnace', 'torch', 'chest', 'bucket', 'shield', 'bread', 'white_bed', 'flint_and_steel', 'bow', 'arrow', 'ender_eye']
const SMELTS = { raw_iron: 'iron_ingot', iron_ore: 'iron_ingot', deepslate_iron_ore: 'iron_ingot', raw_gold: 'gold_ingot', gold_ore: 'gold_ingot', deepslate_gold_ore: 'gold_ingot', nether_gold_ore: 'gold_ingot', raw_copper: 'copper_ingot', copper_ore: 'copper_ingot', deepslate_copper_ore: 'copper_ingot', sand: 'glass', red_sand: 'glass', cobblestone: 'stone', stone: 'smooth_stone', netherrack: 'nether_brick', clay_ball: 'brick', clay: 'terracotta', cactus: 'green_dye', wet_sponge: 'sponge', beef: 'cooked_beef', porkchop: 'cooked_porkchop', chicken: 'cooked_chicken', mutton: 'cooked_mutton', rabbit: 'cooked_rabbit', cod: 'cooked_cod', salmon: 'cooked_salmon', potato: 'baked_potato', kelp: 'dried_kelp' }

export function visibleBlockFace (world, eye, target, reach = 4.5) {
  const centers = [target.offset(0.5, 0.5, 0.5), ...DIRECTIONS.map(d => target.offset(0.5 + d.x * 0.499, 0.5 + d.y * 0.499, 0.5 + d.z * 0.499))]
  for (const center of centers) {
    const delta = center.minus(eye)
    const distance = delta.norm()
    if (distance > reach || distance < 0.001) continue
    const hit = world.raycast(eye, delta.scaled(1 / distance), Math.min(reach, distance + 0.01))
    if (hit?.position?.equals(target)) return true
  }
  return false
}

// Pathfinder 2.4.5's GoalLookAtBlock adds eye height to the target block in
// its distance test. Evaluate from the player's eyes instead, including for
// high supports that can be reached while standing on the ground.
export class BlockFaceGoal extends goals.Goal {
  constructor (target, world, { eyeHeight = 1.62, reach = 4.5 } = {}) {
    super()
    this.target = target; this.world = world; this.eyeHeight = eyeHeight; this.reach = reach
    this.x = target.x; this.y = target.y; this.z = target.z
  }

  heuristic (node) { return Math.max(0, node.offset(0.5, this.eyeHeight, 0.5).distanceTo(this.target.offset(0.5, 0.5, 0.5)) - this.reach) }
  isEnd (node) { return visibleBlockFace(this.world, node.offset(0.5, this.eyeHeight, 0.5), this.target, this.reach) }
}

export class InteractionGoal extends BlockFaceGoal {
  isEnd(node){return visibleInteractionFace(this.world,node.offset(.5,this.eyeHeight,.5),this.target,this.reach)}
}
export class StarterScoutGoal extends goals.GoalNearXZ {
  constructor(target,accept){super(target.x,target.z,1);this.accept=accept}
  isEnd(node){return super.isEnd(node)&&this.accept(node)}
}

const str = description => ({ type: 'string', description })
const number = (description, minimum, maximum, integer = false) => ({ type: integer ? 'integer' : 'number', description, minimum, maximum })
const optional = schema => ({ ...schema, type: [schema.type, 'null'] })
const posSchema = { x: number('World X coordinate', -29999984, 29999984, true), y: number('World Y coordinate', -2048, 2048, true), z: number('World Z coordinate', -29999984, 29999984, true) }
const def = (name, description, properties) => ({ type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } })

export const definitions = [
  def('inspect', 'Read real position, health, inventory, visible entities, nearby useful blocks, and immediately craftable recipe hints. This does not reveal unloaded terrain.', { radius: optional(number('Block search radius; default 16', 1, 32, true)) }),
  def('descend_notch', 'Experimental bounded descent: remove at most one observed adjacent leaf to step down one block, only with a verified walking return route and retained leaf-support anchors. Requires health 12+, food 10+, and a grounded start. Refuses unsupported terrain. Does not perform a complete treetop escape.', {}),
  def('go_to', 'Walk to a loaded location within 128 blocks. Never digs or places blocks while navigating. Radius 0 requires standing at the exact block.', { ...posSchema, radius: optional(number('Acceptable distance; default 1', 0, 8)), returnable: optional({ type: 'boolean', description: 'Certify a terrain-preserving round trip before walking; default false' }) }),
  def('follow', 'Follow a visible player for a bounded number of seconds; repeat if necessary. Never changes terrain.', { player: str('Exact visible player username'), duration: optional(number('Seconds; default 15', 1, 60)), distance: optional(number('Following distance; default 3', 1, 8)) }),
  def('collect', 'Mine up to the requested number of named blocks using a suitable owned tool, then pick up nearby drops. Reports blocks mined and actual inventory gains separately. Requires visible reachable blocks.', { block: str('Exact registry block name, for example oak_log or iron_ore'), count: number('Number of blocks to mine', 1, 64, true), radius: optional(number('Search radius; default 24', 1, 64, true)), skip_positions: optional({ type: 'array', maxItems: 128, items: { type: 'object', properties: { x: number('X', -29999984, 29999984, true), y: number('Y', -2048, 2048, true), z: number('Z', -29999984, 29999984, true) }, required: ['x', 'y', 'z'], additionalProperties: false }, description: 'Previously unreachable positions to skip for this request; default none' }) }),
  def('dig_at', 'Mine one exact loaded block and collect drops using an appropriate owned tool. Useful for planned stairs, tunnels, or clearing a specific obstruction. Refuses to mine under the bot, expose adjacent water/lava, or release an overhead falling block.', { ...posSchema, expected_block: optional(str('Refuse if the target no longer has this block name; default no precondition')) }),
  def('craft', 'Craft a requested number of output items from existing ingredients. May place an owned crafting table nearby. Does not gather ingredients. Recipe batch output can exceed count.', { item: str('Exact output item name'), count: number('Number of output items wanted, not recipe repetitions', 1, 256, true) }),
  def('smelt', 'Smelt owned items in a nearby empty furnace; may place an owned furnace. Supplies fuel and waits for verified inventory output. Up to 8 items per call.', { item: str('Input item name'), count: number('Number of input items', 1, 8, true), fuel: optional(str('Owned fuel item name; null chooses coal, charcoal, planks, or logs')) }),
  def('place', 'Place one owned block at an exact air location adjacent to a solid support. Never replaces existing blocks. Walks into reach and verifies the server block.', { block: str('Inventory block item name'), ...posSchema }),
  def('build', 'Build an inventory-backed floor, wall, or box in the positive XYZ directions, at most 256 blocks. Floor uses width/depth; wall uses width/height (depth must be 1). Requires an existing solid foundation and reachable placement faces; reports partial construction honestly. Does not clear occupied space.', { block: str('Inventory block item name'), shape: { type: 'string', enum: ['floor', 'wall', 'box'] }, ...posSchema, width: number('X size', 1, 16, true), height: number('Y size; 1 for floor', 1, 16, true), depth: number('Z size; 1 for wall', 1, 16, true), hollow: optional({ type: 'boolean', description: 'For box, build only the six outer faces; default true' }) }),
  def('equip', 'Equip an existing item in hand, off-hand, or an armor slot.', { item: str('Owned item name'), destination: optional({ type: 'string', enum: ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet', null], description: 'Equipment slot; null defaults to hand' }) }),
  def('eat', 'Eat a safe owned food item if hungry, verifying food/health or inventory change.', { item: optional(str('Food item name; null chooses safe food automatically')) }),
  def('attack', 'Attack one visible non-player mob with a suitable owned melee weapon for at most duration seconds. Never attacks players, pets with a known owner, or non-living entities. Stops at low health.', { entity_id: optional(number('Specific visible mob entity id', 0, 2147483647, true)), mob: optional(str('Mob registry name if no entity id')), duration: optional(number('Maximum seconds; default 15', 1, 45)) }),
  def('give', 'Walk to a visible player and drop a requested number of owned items toward them. Verifies inventory removal; cannot guarantee which player collects dropped items.', { player: str('Visible player username'), item: str('Owned item name'), count: number('Number of items', 1, 256, true) }),
  def('sleep', 'Find and enter a nearby bed. Reports failure if the server refuses sleep.', {}),
  def('wake', 'Explicitly leave the current bed and wait for the server to confirm waking. Requires the bot to be sleeping.', {}),
  def('activate', 'Right-click a loaded reachable block, such as a door, button, lever, or workstation. Reports observed block/window change, not unverified mechanism results.', { ...posSchema }),
  def('use_item', 'Use an owned/current held item in a chosen direction for a bounded time, then release it. Yaw/pitch are radians. Useful for bow, shield, fishing, eyes of ender, or other right-click items. Reports actual item use and inventory changes, not guessed hits.', { item: optional(str('Item to equip, or null for current held item')), yaw: optional(number('Yaw radians; null keeps current direction', -Math.PI, Math.PI)), pitch: optional(number('Pitch radians; positive looks up', -Math.PI / 2, Math.PI / 2)), duration: optional(number('Hold seconds before release; default 1', 0, 10)) }),
  def('pickup', 'Walk over nearby dropped item entities and report verified inventory gains.', { radius: optional(number('Maximum radius; default 12', 1, 32, true)), entity_ids: optional({ type: 'array', maxItems: 64, items: number('Observed item entity id', 0, 2147483647, true), description: 'Only recover these observed item ids; null chooses all nearby drops, an empty list chooses none' }) }),
  def('explore', 'Walk a bounded distance in a compass direction while loading new terrain, without digging or placing.', { direction: optional({ type: 'string', enum: ['north', 'south', 'east', 'west', null], description: 'Compass direction; null uses current facing' }), distance: optional(number('Distance; default 24', 4, 96, true)), returnable: optional({ type: 'boolean', description: 'Require a verified walking return path before exploration; default false' }), alternatives: optional({ type: 'array', maxItems: 3, items: { type: 'string', enum: ['north', 'east', 'south', 'west'] }, description: 'Ranked fallback directions; requires explicit direction and returnable true; shares one planning budget' }) })
]

function abortError () { const error = new Error('Action cancelled'); error.name = 'AbortError'; return error }
function assert (condition, message) { if (!condition) throw new Error(message) }
function cleanName (value, label = 'item') { assert(typeof value === 'string' && /^[a-z0-9_]+$/.test(value.replace(/^minecraft:/, '')), `Invalid ${label} name`); return value.replace(/^minecraft:/, '') }
function numeric (value, fallback, min, max, integer = false) { const n = value ?? fallback; assert(typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max && (!integer || Number.isInteger(n)), `Expected ${integer ? 'integer' : 'number'} between ${min} and ${max}`); return n }
function plainPos (p) { return p && { x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, z: Math.round(p.z * 100) / 100 } }
function isAir (block) { return !!block && AIR.has(block.name) }
function isSolid (block) { return !!block && block.boundingBox === 'block' && !['lava', 'water', 'fire'].includes(block.name) }
function matchesPlacedBlock (actual, item) {
  if (actual === item) return true
  if (item === 'torch') return actual === 'wall_torch'
  if (item === 'soul_torch') return actual === 'soul_wall_torch'
  if (item === 'redstone_torch') return actual === 'redstone_wall_torch'
  if (item.endsWith('_sign') && !item.includes('hanging')) return actual === item.replace(/_sign$/, '_wall_sign')
  if (item.endsWith('_banner')) return actual === item.replace(/_banner$/, '_wall_banner')
  return false
}

/** One serialized physical action at a time. In-flight inventory operations drain before reuse. */
const PRIVATE_SOIL = Symbol('private soil executor')
export function createActions (bot, { memory, log = () => {}, movementBoundary = () => null, starterProtectedPositions = () => [] } = {}) {
  configureCollisionMargin(bot)
  configureCollisionContact(bot)
  let active = null
  let lastSession = null
  let lastOwnershipGuard = null
  const owns = guard => { try { return guard == null || guard() === true } catch { return false } }
  let movements = null
  const emptySearch = new EmptySearchContinuation(bot)
  const dropRetryCache = new DropRetryCache(bot)
  const items = () => bot.inventory?.items() ?? []
  const itemCount = name => items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0)
  const inventoryMap = () => Object.fromEntries([...new Set(items().map(i => i.name))].map(name => [name, itemCount(name)]))
  const changes = before => { const after = inventoryMap(); return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)]).filter(([, count]) => count !== 0)) }
  const owned = name => { const item = items().find(i => i.name === name); assert(item, `No ${name} in inventory`); return item }
  const dimension = () => bot.game?.dimension ?? bot.entity?.dimension ?? 'unknown'
  const loaded = p => { const b = bot.blockAt(p); assert(b, `Chunk not loaded at ${JSON.stringify(plainPos(p))}`); return b }
  const nearby = (name, radius = 32, accept = () => true) => {
    const id = bot.registry?.blocksByName?.[name]?.id
    if (id == null) return null
    const origin = bot.entity.position
    // Mineflayer's section-octahedron search misses diagonal adjacent chunks
    // at small radii. Check the actual local sphere for nearby workstations.
    if (radius <= 8) {
      const base = origin.floored()
      let closest = null
      let distance = Infinity
      for (let x = -radius; x <= radius; x++) for (let y = -radius; y <= radius; y++) for (let z = -radius; z <= radius; z++) {
        const p = base.offset(x, y, z)
        const d = p.distanceTo(origin)
        if (d > radius || d >= distance) continue
        const block = bot.blockAt(p)
        if (block?.type === id && accept(block)) { closest = block; distance = d }
      }
      return closest
    }
    const positions = bot.findBlocks({ matching: id, maxDistance: sectionSearchDistance(radius), count: 256 }).filter(p => p.distanceTo(origin) <= radius && accept(bot.blockAt(p))).sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))
    return positions.length ? bot.blockAt(positions[0]) : null
  }
  const staleSession = session => session && (session.changed || bot.entity !== session.entity || bot._client !== session.client || dimension() !== session.dimension)
  const checked = ctx => { assertTerrainTrusted(bot); assert(owns(ctx?.ownershipGuard), 'Action cancelled: physical ownership changed'); if (staleSession(ctx?.session)) throw new Error('Action cancelled: play session changed'); if (ctx?.signal?.aborted || ctx?.cancelled) throw abortError(); assert(bot.entity?.position, 'Bot has not spawned'); if (bot.health != null) assert(bot.health > 0, 'Bot is dead') }
  const step = async (ctx, fn) => { checked(ctx); const result = await fn(); checked(ctx); return result }

  function stop ({ sessionChanged = false, finishedCleanup = false } = {}) {
    if (finishedCleanup && !active && !sessionChanged && !staleSession(lastSession)) emptySearch.finishedCleanup()
    else emptySearch.clear()
    if (sessionChanged && lastSession) lastSession.changed = true
    // Runner cleanup can call the retired facade again after its active lock
    // was released. Its last admitted session still owns inventory cleanup.
    sessionChanged ||= Boolean(staleSession(lastSession))
    const ownershipGuard = active?.ownershipGuard ?? lastOwnershipGuard
    if (active) { active.cancelled = true; active.controller.abort() }
    try { if (owns(ownershipGuard)) bot.pathfinder?.setGoal(null) } catch {}
    try { if (owns(ownershipGuard)) bot.stopDigging?.() } catch {}
    // Switching slots cancels a drawn bow without releasing an unintended arrow.
    try { if (owns(ownershipGuard) && !sessionChanged && bot.usingHeldItem && bot.heldItem?.name === 'bow') bot.setQuickBarSlot?.(((bot.quickBarSlot ?? 0) + 1) % 9) } catch {}
    try { if (owns(ownershipGuard) && !sessionChanged) bot.deactivateItem?.() } catch {}
    try { if (owns(ownershipGuard)) bot.clearControlStates?.() } catch {}
    try { if (owns(ownershipGuard) && !sessionChanged && bot.currentWindow) Promise.resolve(bot.closeWindow(bot.currentWindow)).catch(() => {}) } catch {}
  }

  async function pause (ctx, ms) {
    checked(ctx)
    await new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); ctx.signal?.removeEventListener('abort', cancel) }
      const cancel = () => { done(); reject(abortError()) }
      const timer = setTimeout(() => { done(); resolve() }, ms)
      ctx.signal?.addEventListener('abort', cancel, { once: true })
      if (ctx.signal?.aborted) cancel()
    })
    checked(ctx)
  }

  const insideBoundary = p => {
    const bound = movementBoundary()
    if (!bound) return true
    assert(bound.center && ['x', 'y', 'z'].every(k => Number.isFinite(bound.center[k])) && Number.isFinite(bound.radius) && bound.radius > 0, 'Invalid movement boundary')
    return p && Math.hypot(p.x - bound.center.x, p.y - bound.center.y, p.z - bound.center.z) <= bound.radius
  }

  function configureMovement () {
    assert(bot.pathfinder, 'Mineflayer pathfinder plugin is required')
    if (!movements) {
      movements = new Movements(bot)
      movements.canDig = false
      movements.allow1by1towers = false
      movements.allowParkour = false
      movements.scafoldingBlocks = []
      movements.maxDropDown = 3
      // Enforce job bounds while planning every path, not only after an action
      // has already wandered outside the area. Ordinary direct actions have no
      // job boundary. Keep the margin inside the controller's hard stop radius.
      movements.exclusionAreasStep.push(block => insideBoundary(block.position) ? 0 : 1000)
      movements.exclusionAreasStep.push(block => movementBoundary() && block.isWaterlogged ? 1000 : 0)
    }
    // Starter gathering is a dry-land objective. The library otherwise allows
    // water and freezing powder snow as costly walking destinations, even for
    // a returnable pickup route. Starter jobs have no certified cold protection.
    for (const name of STARTER_AVOID_BLOCK_NAMES) {
      const id = bot.registry?.blocksByName?.[name]?.id
      if (id != null) {
        if (movementBoundary()) movements.blocksToAvoid.add(id)
        else movements.blocksToAvoid.delete(id)
      }
    }
    // Reapply on every preparation, including reverse-route certification.
    // A cached foodless scout must never disable a later direct action/retreat.
    movements.allowSprinting = active?.allowSprinting !== false
    bot.pathfinder.setMovements(movements)
  }

  function coordinates (args, ctx, integer = true) {
    const p = new Vec3(numeric(args.x, undefined, -29999984, 29999984, integer), numeric(args.y, undefined, -2048, 2048, integer), numeric(args.z, undefined, -29999984, 29999984, integer))
    const minY = bot.game?.minY ?? -64
    const maxY = minY + (bot.game?.height ?? 384)
    assert(p.y >= minY && p.y < maxY, `Y must be within this world's build range ${minY}..${maxY - 1}`)
    assert(p.distanceTo(ctx.origin) <= 128, 'Target is more than 128 blocks from action start; use bounded waypoints')
    assert(insideBoundary(p), 'Target is outside the current job movement boundary')
    return p
  }

  async function navigate (ctx, target, radius = 1, { requireLoaded = true, lookAt = false, returnable = false, walkingTimeoutMs = 15000, interaction = false } = {}) {
    checked(ctx)
    assert(target.distanceTo(ctx.origin) <= 128, 'Target is more than 128 blocks from action start')
    assert(insideBoundary(target), 'Target is outside the current job movement boundary')
    if (requireLoaded) loaded(target)
    configureMovement()
    const FaceGoal=interaction?InteractionGoal:BlockFaceGoal
    let goal = lookAt ? new FaceGoal(target, bot.world, { reach: 4, eyeHeight: bot.entity.eyeHeight ?? 1.62 }) : radius === 0 ? new goals.GoalBlock(target.x, target.y, target.z) : new goals.GoalNear(target.x, target.y, target.z, radius)
    let legPlanningBudget=1600
    if (ctx.starterScope && returnable && lookAt && !interaction) {
      const used=ctx.planningUsed??0,started=performance.now()
      if(used>=7000)throw Object.assign(Error('Collection return-path planning budget exhausted'),{code:'COLLECTION_PLANNING_LIMIT'})
      let space
      try { space=inspectMiningGoalSpace(bot,movements,goal,{budgetMs:Math.min(20,7000-used),signal:ctx.signal}) }
      finally {const elapsed=performance.now()-started;ctx.planningUsed=used+elapsed;legPlanningBudget=Math.max(0,legPlanningBudget-elapsed)}
      checked(ctx)
      if(space.status==='none')throw Object.assign(Error('No possible dry interaction stance in fully observed target neighborhood'),{code:MINING_NO_GOAL_SPACE})
    }
    if (returnable) goal = await returnableGoal(ctx, goal, null, legPlanningBudget)
    await step(ctx, () => returnable ? walkToGoal(bot, goal, { signal: ctx.signal, timeoutMs: walkingTimeoutMs }) : bot.pathfinder.goto(goal))
    if (!lookAt) assert(radius === 0 ? bot.entity.position.floored().equals(target.floored()) : bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) <= radius + 1.2, 'Navigation ended before reaching the requested location')
  }

  async function returnableGoal (ctx, goal, fixedEndpoint = null, planningBudget = 1600, validateNode = null, onCertifiedPaths = null) {
    checked(ctx)
    configureMovement()
    const used = ctx.planningUsed ?? 0
    if (used >= 7000) throw Object.assign(new Error('Collection return-path planning budget exhausted'), { code: 'COLLECTION_PLANNING_LIMIT' })
    const start = performance.now()
    try {
      // A player can stand across a block edge while its center is above air.
      // Requiring the floored center as a reverse endpoint invents an impossible
      // standing cell. Verify a real walking route back within one block instead.
      const home = ctx.origin.floored()
      const planned = await planReturnablePath(bot, movements, goal, new goals.GoalNear(home.x, home.y, home.z, 1), { signal: ctx.signal, planningBudget: Math.min(1600, 7000 - used, planningBudget), fixedEndpoint, validateNode, onCertifiedPaths, yieldControl: () => pause(ctx, 0) })
      checked(ctx)
      assert(!validateNode||validateNode(planned.endpoint),'Verified route endpoint is outside the starter scout boundary')
      return new goals.GoalBlock(planned.endpoint.x, planned.endpoint.y, planned.endpoint.z)
    } catch (error) {
      if (used + performance.now() - start >= 7000) error.code = 'COLLECTION_PLANNING_LIMIT'
      throw error
    } finally { ctx.planningUsed = used + performance.now() - start }
  }

  function visibleHere (block) {
    if (!block?.position) return false
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
    if (bot.world?.raycast) return visibleBlockFace(bot.world, eye, block.position, 4.5)
    return eye.distanceTo(block.position.offset(0.5, 0.5, 0.5)) <= 4.5 && (!bot.canSeeBlock || bot.canSeeBlock(block))
  }

  async function approachBlock (ctx, p, { returnable = false, interaction = false } = {}) {
    loaded(p)
    const visible = () => interaction?interactionVisible(bot,loaded(p)):visibleHere(loaded(p))
    if (!visible()) await navigate(ctx, p, 3, { lookAt: true, returnable, interaction })
    assert(visible(), 'Target block remains out of reach or behind an obstruction')
  }

  function visiblePlayer (username) {
    assert(typeof username === 'string' && /^[^\u0000-\u001f\u007f]{1,32}$/.test(username), 'Invalid player username')
    const entity = bot.players?.[username]?.entity
    assert(entity && entity !== bot.entity, `Player ${username} is not visible`)
    return entity
  }

  function snapshot () {
    assertTerrainTrusted(bot)
    const position = bot.entity?.position
    return {
      connected: !!position,
      position: plainPos(position), dimension: dimension(), health: bot.health ?? null, food: bot.food ?? null, oxygen: ownOxygenLevel(bot),
      time: bot.time?.timeOfDay ?? null, is_raining: bot.isRaining ?? false, sleeping: !!bot.isSleeping,
      inventory: items().map(i => ({ name: i.name, count: i.count, durability_used: i.durabilityUsed ?? null })),
      equipment: Object.fromEntries(Object.entries({ helmet: 5, chestplate: 6, leggings: 7, boots: 8, off_hand: 45 }).map(([name, slot]) => { const item = bot.inventory?.slots?.[slot]; return [name, item ? { name: item.name, count: item.count, durability_used: item.durabilityUsed ?? null } : null] })),
      held_item: bot.heldItem?.name ?? null,
      entities: position ? Object.values(bot.entities ?? {}).filter(e => e !== bot.entity && e.position && e.position.distanceTo(position) <= 48).sort((a, b) => { const score = e => e.position.distanceTo(position) - (e.type === 'hostile' && e.position.distanceTo(position) < 8 ? 100 : 0); return score(a) - score(b) }).slice(0, 24).map(e => ({ id: e.id, name: e.name ?? e.displayName ?? e.type, type: e.type, username: e.username ?? null, position: plainPos(e.position), distance: Math.round(e.position.distanceTo(position) * 10) / 10 })) : []
    }
  }

  async function inspect (args, ctx) {
    const radius = numeric(args.radius, 16, 1, 32, true)
    const useful = (bot.registry?.blocksArray ?? []).filter(b => /(_log|_ore|_stem|_bed)$/.test(b.name) || ['crafting_table', 'furnace', 'chest', 'nether_portal', 'end_portal', 'end_portal_frame', 'obsidian', 'lava', 'water', 'sugar_cane', 'wheat'].includes(b.name)).map(b => b.id)
    const positions = useful.length ? bot.findBlocks({ matching: useful, maxDistance: radius, count: 64 }) : []
    const table = nearby('crafting_table', 4)
    const craftable = []
    for (const name of CRAFT_HINTS) {
      checked(ctx)
      const id = bot.registry?.itemsByName?.[name]?.id
      if (id != null) {
        const recipes = bot.recipesFor?.(id, null, 1, table) ?? []
        if (recipes.length) craftable.push({ item: name, output_per_craft: recipes[0].result.count, requires_table: !!recipes[0].requiresTable })
      }
    }
    const localBlocks = []
    const feet = bot.entity.position.floored()
    for (let y = -1; y <= 2; y++) for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
      const p = feet.offset(x, y, z)
      const block = bot.blockAt(p)
      if (block && !isAir(block)) localBlocks.push({ name: block.name, position: plainPos(p) })
    }
    return { ...snapshot(), nearby_blocks: positions.map(p => ({ name: bot.blockAt(p)?.name, position: plainPos(p) })), local_blocks: localBlocks, local_blocks_note: 'Non-air blocks within 2 blocks horizontally and Y -1..+2 relative to feet, for choosing precise digs and supports.', craftable_hints: craftable, recipe_note: 'Hints are a limited list; craft checks all recipes for the requested item.' }
  }

  async function pickupInternal (ctx, radius = 12, entityIds = null) {
    const safeLanding = () => isDryLanding(bot) && (!ctx.starterScope || hasAnchoredLeafLanding(bot,bot.entity.position))
    const safeDestination = p => !ctx.starterScope || hasAnchoredLeafLanding(bot,p.offset(.5,0,.5))
    assert(entityIds == null || (Array.isArray(entityIds) && entityIds.length <= 64 && entityIds.every(id => Number.isSafeInteger(id) && id >= 0 && id <= 2147483647)), 'entity_ids must contain at most 64 valid item ids')
    const allowed = entityIds == null ? null : new Set(entityIds)
    const before = inventoryMap()
    const drops = () => Object.values(bot.entities ?? {}).filter(e => e.name === 'item' && (!allowed || allowed.has(e.id)) && e.position && insideBoundary(e.position) && e.position.distanceTo(bot.entity.position) <= radius && e.position.distanceTo(ctx.origin) <= 128)
    // All pickup passes inside one physical action share this bounded retry
    // ledger. Mining another block must not reset three failed probes for the
    // same lingering drop; a new physical action can inspect and retry afresh.
    const attempts = ctx.pickupAttempts ??= new Map()
    const failures = []
    let planningLimited = (ctx.planningUsed ?? 0) >= 7000
    let pickupLimited = false, routeBudgetLimited = false
    // Shared soft allowance for all pickup passes in this physical action.
    // Yield partial evidence before repeated local pursuits consume the runner timeout.
    const started = performance.now()
    const remaining = () => Math.max(0, 8000 - (ctx.pickupUsed ?? 0) - (performance.now() - started))
    const navigationRemaining = () => Math.max(0, remaining() - 500)
    const probes = new PickupProbeLedger(bot)
    try {
    for (let n = 0; n < 24 && !planningLimited; n++) {
      checked(ctx)
      if (navigationRemaining() <= 0) { pickupLimited = drops().length > 0; break }
      const target = drops().filter(e => !probes.spent(e) && !dropRetryCache.deferred(e,ctx.starterScope) && (attempts.get(e.id) ?? 0) < 3).sort((a, b) => (attempts.get(a.id) ?? 0) - (attempts.get(b.id) ?? 0) || a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
      if (!target) break
      // Drops from upper logs/ores are often still falling. Walking to their
      // airborne Y creates an impossible path; project onto loaded ground.
      const dropPosition = target.position.floored()
      const destinations = []
      configureMovement()
      const passable = b => b && (isAir(b) || /^(short_grass|tall_grass|fern|large_fern|leaf_litter)$/.test(b.name) || (b.name === 'snow' && b.shapes?.length === 0)) && b.boundingBox === 'empty' && !movements.blocksToAvoid.has(b.type) && !movements.liquids.has(b.type)
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        for (let down = -1; down <= 8; down++) {
          const p = dropPosition.offset(x, -down, z)
          if (passable(bot.blockAt(p)) && passable(bot.blockAt(p.offset(0, 1, 0))) && isSolid(bot.blockAt(p.offset(0, -1, 0)))) { if (safeDestination(p)) destinations.push(p); break }
        }
      }
      // A cell close to the bot can still be outside item-pickup reach,
      // especially diagonally. Aim at the drop rather than the nearest cell.
      destinations.sort((a, b) => a.offset(0.5, 0, 0.5).distanceTo(target.position) - b.offset(0.5, 0, 0.5).distanceTo(target.position))
      const probeContext = probes.context(target)
      const count = Math.min(3,destinations.length), rotation = (attempts.get(target.id) ?? 0) % (count || 1)
      const next = Array.from({length:count},(_,i)=>destinations[(rotation+i)%count]).find(p=>!probes.tried(target,probeContext,p))
      if(count && !next){probes.exhaust(target,probeContext);continue}
      attempts.set(target.id, (attempts.get(target.id) ?? 0) + 1)
      let destination = null, pursuitStarted = false
      const pursuitInventory = inventoryMap()
      let collectedByBot = false
      const observedCollection = (collector, item) => { if (collector?.id === bot.entity.id && item?.id === target.id) collectedByBot = true }
      bot.on('playerCollect', observedCollection)
      try {
        assert(destinations.length, 'No validated standing space near dropped item')
        // Give each drop one destination attempt before retrying a blocked
        // neighbor. One unreachable item must not monopolize the shared budget.
        const p = next
        destination = p
        let goal, certifiedPath
        try { goal = await returnableGoal(ctx, new goals.GoalBlock(p.x, p.y, p.z), p, Math.min(1600, navigationRemaining()), null, paths => { certifiedPath=paths.forward }) }
        catch(error){
          if(error.name!=='AbortError' && /^(No verified returnable walking route|Return-path planning budget exhausted|Collection return-path planning budget exhausted)/.test(error.message))probes.failed(target,probeContext,p)
          throw error
        }
        checked(ctx)
        assert(safeDestination(p), 'Pickup leaf landing lost its retained log anchor')
        if (navigationRemaining() <= 0) { pickupLimited = drops().length > 0; break }
        if (ctx.starterScope) {
          const admission=pickupRouteBudget(bot.entity.position,certifiedPath,Math.min(6000,navigationRemaining()))
          if (!admission.admitted) {
            const failure={id:target.id,error:admission.reason,code:PICKUP_ROUTE_BUDGET,destination:plainPos(p),...admission}
            failures.push(failure)
            ctx.pickupFailures=[...(ctx.pickupFailures??[]),failure].slice(-64)
            routeBudgetLimited=true
            log('pickup',`Drop ${target.id} route refused before movement`,failure)
            // No pursuit occurred, so this is neither an unsafe landing nor
            // durable evidence that the item is unreachable. Rotate bounded
            // alternatives without poisoning the cross-action retry cache.
            continue
          }
        }
        pursuitStarted = true
        const outcome = await pursueDroppedItem(bot, goal, target, { signal: ctx.signal, timeoutMs: Math.min(6000, navigationRemaining()), waitForLanding: true, safeToStop: safeLanding, atDestination: () => isAtPickupStandingCell(bot,p) })
        if (outcome.landingVerified && !ctx.pickupSettledFailure) ctx.pickupUnverified = false
        log('pickup', `Drop ${target.id} pursuit ended: ${outcome.reason}`, { id: target.id, destination: plainPos(p), position: plainPos(bot.entity.position), onGround: bot.entity.onGround, reason: outcome.reason, started: outcome.started, landingVerified: outcome.landingVerified })
        checked(ctx)
        await pause(ctx, Math.min(200, remaining()))
        // A safe arrival proves the landing, not collection. Allow the existing
        // bounded packet-settlement grace before considering material progress.
        if (!bot.entities?.[target.id] || collectedByBot || outcome.reason === 'collected') {
          dropRetryCache.succeeded(target, ctx.starterScope)
        } else if (bot.entities[target.id] === target && outcome.landingVerified && outcome.reason === 'arrived'
          && !Object.values(changes(pursuitInventory)).some(delta => delta > 0)) {
          const failure = { id: target.id, error: 'Reached a grounded pickup position but the item remains without inventory progress', code: 'PICKUP_NO_COLLECTION_PROGRESS' }
          dropRetryCache.failed(target, ctx.starterScope, failure.error)
          failures.push(failure)
          ctx.pickupFailures = [...(ctx.pickupFailures ?? []), failure].slice(-64)
          log('pickup', `Drop ${target.id} remains after grounded arrival`, { id: target.id, code: failure.code, position: plainPos(bot.entity.position), onGround: bot.entity.onGround, navigationLandingVerified: true })
        }
      } catch (error) {
        checked(ctx)
        ctx.pickupUnverified = true
        dropRetryCache.failed(target,ctx.starterScope,error.message)
        let passivelySettled = false
        const neededSettlement = !safeLanding()
        if (neededSettlement && pursuitStarted && error.message !== 'Pickup navigation goal replaced') {
          passivelySettled = await awaitPassiveLanding(bot, { signal:ctx.signal, deadline:performance.now()+Math.min(500,remaining()) }) && safeLanding()
          checked(ctx)
          if (passivelySettled) ctx.pickupSettledFailure = true
        }
        log('pickup', `Drop ${target.id} pursuit failed: ${error.message}`, { id:target.id, destination:destination?plainPos(destination):null, position:plainPos(bot.entity.position), onGround:bot.entity.onGround, landingVerified:false, passivelySettled })
        if ((neededSettlement && !passivelySettled) || !safeLanding()) throw Object.assign(new Error('Pickup ended without a verified grounded dry stop. Work halted; the world keeps running.'), {code:'PICKUP_UNSAFE_SETTLEMENT',result:{inventory_changes:changes(before),remaining_drops:drops().map(e=>({id:e.id,position:plainPos(e.position)})),landing_verified:false}})
        planningLimited = error.code === 'COLLECTION_PLANNING_LIMIT'
        const failure = { id: target.id, error: error.message, code: error.code ?? null }
        failures.push(failure)
        ctx.pickupFailures = [...(ctx.pickupFailures ?? []), failure].slice(-64)
        if (passivelySettled) break
        if (!planningLimited && remaining() > 0) await pause(ctx, Math.min(150, remaining()))
      } finally { bot.removeListener('playerCollect', observedCollection) }
    }
    pickupLimited ||= (remaining() <= 0 || routeBudgetLimited) && drops().length > 0
    if (!safeLanding()) throw Object.assign(new Error('Pickup ended without a verified grounded dry stop. Work halted; the world keeps running.'), {code:'PICKUP_UNSAFE_SETTLEMENT',result:{inventory_changes:changes(before),remaining_drops:drops().map(e=>({id:e.id,position:plainPos(e.position)})),landing_verified:false}})
    return { deferred_drops:drops().map(e=>dropRetryCache.deferred(e,ctx.starterScope)).filter(Boolean), passive_settlement:Boolean(ctx.pickupSettledFailure), pursuit_unverified:Boolean(ctx.pickupUnverified), landing_verified:!ctx.pickupUnverified, inventory_changes: changes(before), remaining_drops: drops().map(e => ({ id: e.id, position: plainPos(e.position) })), unreachable: [...(ctx.pickupFailures ?? failures)], planning_limited: planningLimited, pickup_limited: pickupLimited }
    } finally { probes.dispose();ctx.pickupUsed = (ctx.pickupUsed ?? 0) + Math.max(0, performance.now() - started) }
  }

  async function collect (args, ctx) {
    const name = cleanName(args.block, 'block')
    const definition = bot.registry?.blocksByName?.[name]
    assert(definition, `Unknown block ${name}`)
    const count = numeric(args.count, undefined, 1, 64, true)
    const radius = numeric(args.radius, 24, 1, 64, true)
    const before = inventoryMap()
    assert(args.skip_positions == null || (Array.isArray(args.skip_positions) && args.skip_positions.length <= 128), 'skip_positions must be an array of at most 128 coordinates')
    const skipped = new Set((args.skip_positions ?? []).map(p => {
      assert(p && ['x', 'y', 'z'].every(k => Number.isSafeInteger(p[k]) && Math.abs(p[k]) <= (k === 'y' ? 2048 : 29999984)), 'Invalid skipped block coordinate')
      return new Vec3(p.x, p.y, p.z).toString()
    }))
    const failures = []
    let mined = 0
    let searchLimited = false
    let consecutiveFailures = 0
    let pickup = { remaining_drops: [], unreachable: [], planning_limited: false }
    let planningLimited = false
    let candidateCache = null, candidateRevision = 0
    let searchScans = 0, searchReuses = 0
    let searchEvidence = null, searchEvidenceContext = null, stopReason = 'requested_count', rankingLimited = false
    let searchLease = null, searchContinued = false, continuationSaved = false
    const invalidateCandidates = () => { candidateRevision++; candidateCache = null }
    const invalidateSearchPose = () => {
      if (searchEvidenceContext && (!bot.entity?.position?.equals(searchEvidenceContext.position) || bot.world !== searchEvidenceContext.world || dimension() !== searchEvidenceContext.dimension)) searchEvidenceContext.invalidated = true
    }
    const invalidateOnMovement = () => {
      invalidateSearchPose()
      if (candidateCache && !bot.entity?.position?.equals(candidateCache.position)) invalidateCandidates()
    }
    const invalidateOnBlockUpdate = (oldBlock, newBlock) => {
      const positions = [oldBlock?.position, newBlock?.position]
      // Candidate ordering also reads diagonal support neighbors. Distant
      // updates cannot change this bounded list, but routes are still freshly
      // certified before every approach. Unknown event geometry is conservative.
      if (!candidateCache || positions.some(p => !p || !['x','y','z'].every(k => Number.isFinite(p[k])))
        || positions.some(p => candidateCache.position.floored().distanceTo(p) <= radius + 2)) invalidateCandidates()
    }
    const worldEvents = ['chunkColumnLoad', 'chunkColumnUnload']
    bot.on('blockUpdate', invalidateOnBlockUpdate)
    for (const event of worldEvents) bot.on(event, invalidateCandidates)
    bot.on('physicsTick', invalidateOnMovement)
    bot.on('move', invalidateSearchPose)
    try {
    while (mined < count) {
      checked(ctx)
      // Filter before findBlocks applies its count cap. Dense buried stone must
      // not hide a farther exposed face or consume the pathfinding failure budget.
      // Mineflayer applies useExtraInfo to real positioned blocks (not palettes).
      // Time/count budgets are checked on matching blocks, not a hard timeout
      // for findBlocks itself; its fixed radius also bounds nonmatching scans.
      let candidates = []
      const scanRevision = candidateRevision
      const scanPosition = bot.entity.position.clone(), scanWorld = bot.world, scanDimension = dimension()
      const boundaryKey = JSON.stringify(movementBoundary())
      const canReuse = candidateCache && candidateCache.position.equals(bot.entity.position)
        && candidateCache.dimension === dimension() && candidateCache.boundaryKey === boundaryKey
      if (canReuse) {
        candidates = candidateCache.positions.filter(p => {
          checked(ctx)
          if (skipped.has(p.toString()) || p.distanceTo(bot.entity.position.floored()) > radius || p.distanceTo(ctx.origin) > 128 || !insideBoundary(p)) return false
          const block = bot.blockAt(p)
          return block?.name === name && DIRECTIONS.some(d => isAir(bot.blockAt(p.plus(d)))) && !miningEnvironmentIssue(block)
        })
      }
      // Reuse only the already observed untried candidates. Exhaustion gets a
      // fresh bounded scan so an earlier count/time cap cannot hide later cells.
      if (canReuse && candidates.length) { searchReuses++; searchEvidence = { source:'cached_candidates', coverage_complete:false, termination:'cached_candidates', observed_candidates:candidates.length, skipped_positions:skipped.size }; searchEvidenceContext=null }
      else {
      searchScans++
      searchEvidenceContext={position:scanPosition,world:scanWorld,dimension:scanDimension,boundaryKey,revision:scanRevision}
      const searchOrigin = bot.entity.position.floored()
      const searchLimit = Symbol('collection search limit')
      const deadline = performance.now() + 500
      let inspected = 0
      const accept = block => {
        checked(ctx)
        const p = block.position
        if (!p || p.distanceTo(searchOrigin) > radius || p.distanceTo(ctx.origin) > 128 || !insideBoundary(p) || skipped.has(p.toString())) return false
        if (!DIRECTIONS.some(d => isAir(bot.blockAt(p.plus(d))))) return false
        if (miningEnvironmentIssue(block)) return false
        candidates.push(p)
        return true
      }
      // Only the first, completely empty search may cross an action boundary.
      // No route, candidate verdict, or previous action callback is retained.
      if (searchScans === 1 && ctx.starterScope && ctx.parentSignal instanceof AbortSignal && ctx.runnerSignal instanceof AbortSignal
        && typeof bot.world?.getColumn === 'function' && Number.isSafeInteger(bot.game?.minY) && Number.isSafeInteger(bot.game?.height)) {
        const key = JSON.stringify([ctx.starterScope, definition.id, radius, count, [...skipped].sort(), boundaryKey])
        searchLease = emptySearch.begin({ key, parentSignal:ctx.parentSignal, actionSignal:ctx.runnerSignal,
          terrainDependency:{origin:searchOrigin,radius:radius+1},
          createCursor:() => new BlockSearchCursor(bot, { matching:definition.id, point:searchOrigin, maxDistance:sectionSearchDistance(radius), count:512 }) })
      }
      if (searchLease) {
        searchContinued = searchLease.resumed
        const page = searchLease.cursor.scan({ accept, check:() => checked(ctx) })
        searchEvidence={source:'cursor',observation_id:randomUUID(),origin:plainPos(searchOrigin),radius,block:name,
          filter:'exposed_environment_safe_in_bounds',termination:page.termination,coverage_complete:page.coverageComplete,observed_candidates:page.accepted,
          unloaded_columns:page.unloadedColumns,unknown_cells:page.unknownCells,skipped_positions:skipped.size}
        searchLimited ||= page.limited
        if (candidates.length || !page.resumable) { emptySearch.release(searchLease); searchLease = null }
      } else try {
        searchEvidence={source:'native',observation_id:randomUUID(),origin:plainPos(searchOrigin),radius,block:name,
          filter:'exposed_environment_safe_in_bounds',termination:'native_unverified',coverage_complete:false,observed_candidates:0,skipped_positions:skipped.size}
        const found = bot.findBlocks({ matching:definition.id, maxDistance:sectionSearchDistance(radius), count:512, useExtraInfo:block => {
          checked(ctx)
          if (++inspected > 65536 || performance.now() >= deadline) throw searchLimit
          return accept(block)
        } })
        searchEvidence.observed_candidates=candidates.length
        if(Array.isArray(found)&&found.length>=512)searchEvidence.termination='native_result_cap'
      } catch (error) {
        if (error !== searchLimit) throw error
        searchLimited = true
        if(searchEvidence){searchEvidence.termination='native_budget_or_match_limit';searchEvidence.observed_candidates=candidates.length}
      }
      }
      // Nearby depth can be a misleading shortcut: prefer surface-height resources
      // before trying a dense cave face. Returnability is still verified separately.
      const effort = p => {
        // Drops scatter off ledges. Prefer a supported landing area to a cliff
        // edge, without excluding trees or resources that lack a full platform.
        const stableLanding = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].every(([x, z]) => isSolid(bot.blockAt(p.offset(x, -1, z))))
        // Upper trunk logs normally have air beside their supporting log.
        // Prefer a nearby hand-reachable trunk over walking to another tree base.
        // Approach, line-of-sight, support and pickup checks still run unchanged.
        const nearbyTrunk = /_log$/.test(name) && p.distanceTo(bot.entity.position) <= 4
        return p.distanceTo(bot.entity.position) + (nearbyTrunk ? 0 : 3 * Math.abs(p.y - bot.entity.position.y)) + (stableLanding || nearbyTrunk ? 0 : 32)
      }
      rankingLimited ||= candidates.length > 128
      const choices = candidates.sort((a, b) => effort(a) - effort(b)).slice(0, 128)
      // Mineflayer may visit a whole section layer before its count cap. Cache
      // ranked choices, never the raw iteration prefix that can omit better cells.
      if (candidateRevision === scanRevision) candidateCache = { positions: choices.map(p => p.clone()), position: bot.entity.position.clone(), dimension: dimension(), boundaryKey }
      if (!choices.length) { stopReason='no_ranked_candidates'; break }
      const p = choices[0]
      skipped.add(p.toString())
      try {
        await approachBlock(ctx, p, { returnable: true })
        const block = loaded(p)
        if (block.name !== name) continue
        await harvestBlock(ctx, p)
        mined++
        invalidateCandidates()
        consecutiveFailures = 0
        await pause(ctx, 300)
        pickup = await pickupInternal(ctx, 6)
        if (ctx.pickupSettledFailure || pickup.planning_limited || pickup.pickup_limited) { planningLimited = pickup.planning_limited; stopReason=ctx.pickupSettledFailure?'pickup_unverified':pickup.planning_limited?'planning_limit':'pickup_limit'; break }
      } catch (error) {
        checked(ctx)
        if(error.code===MINING_DEADLINE_INSUFFICIENT){error.result={...error.result,completed:false,mined,inventory_changes:changes(before),remaining_drops:pickup.remaining_drops};throw error}
        if (error.code === 'PICKUP_UNSAFE_SETTLEMENT') { error.result = { ...error.result, completed:false, mined, inventory_changes:changes(before) }; throw error }
        planningLimited = error.code === 'COLLECTION_PLANNING_LIMIT'
        failures.push({ position: plainPos(p), error: error.message, code: error.code ?? null })
        if (planningLimited) { stopReason='planning_limit'; break }
        if (++consecutiveFailures >= 8) { stopReason='candidate_failure_limit'; break }
      }
    }
    if (mined && !ctx.pickupSettledFailure && !planningLimited && !pickup.pickup_limited) {
      await pause(ctx, 300)
      try { pickup = await pickupInternal(ctx, 12) } catch (error) {
        if (error.code === 'PICKUP_UNSAFE_SETTLEMENT') error.result = { ...error.result, completed:false, mined, inventory_changes:changes(before) }
        throw error
      }
    }
    if (!mined && !failures.length && searchLimited && searchLease) continuationSaved = emptySearch.retain(searchLease)
    ctx.searchContinuationSaved = continuationSaved
    const contextStable=Boolean(searchEvidenceContext && !searchEvidenceContext.invalidated && searchEvidenceContext.world===bot.world
      && searchEvidenceContext.position.equals(bot.entity.position) && searchEvidenceContext.dimension===dimension()
      && searchEvidenceContext.boundaryKey===JSON.stringify(movementBoundary()) && searchEvidenceContext.revision===candidateRevision)
    const ordinarySearch=searchEvidence?{...searchEvidence,context_stable:contextStable,ranking_limited:rankingLimited,collection_loop_stop:stopReason,
      complete_empty:searchEvidence.source==='cursor' && searchEvidence.coverage_complete===true && searchEvidence.termination==='traversal_complete'
        && searchEvidence.observed_candidates===0 && searchEvidence.skipped_positions===0 && contextStable && mined===0 && failures.length===0 && !searchLimited && !rankingLimited}:null
    const result = { ordinary_search:ordinarySearch, search_continued:searchContinued, search_continuation_saved:continuationSaved, search_scans:searchScans, search_reuses:searchReuses, deferred_drops:pickup.deferred_drops??[], passive_settlement:Boolean(ctx.pickupSettledFailure), pickup_landing_verified:!ctx.pickupUnverified, pickup_pursuit_unverified:Boolean(ctx.pickupUnverified), completed: mined === count && !ctx.pickupUnverified && !planningLimited && !pickup.planning_limited && !pickup.pickup_limited && pickup.remaining_drops.length === 0, requested: count, mined, inventory_changes: changes(before), remaining_drops: pickup.remaining_drops, pickup_failures: pickup.unreachable, failures, search_limited: searchLimited, planning_limited: planningLimited || pickup.planning_limited, pickup_limited: Boolean(pickup.pickup_limited) }
    if (!mined) throw Object.assign(new Error(`Could not collect ${name}: ${failures[0]?.error ?? (searchLimited ? 'bounded search exhausted; try moving closer or a smaller radius' : 'no exposed loaded candidates found')}`), { result })
    return result
    } finally {
      if (!continuationSaved && searchLease) emptySearch.release(searchLease)
      for (const event of worldEvents) bot.removeListener(event, invalidateCandidates)
      bot.removeListener('blockUpdate', invalidateOnBlockUpdate)
      bot.removeListener('physicsTick', invalidateOnMovement)
      bot.removeListener('move', invalidateSearchPose)
    }
  }

  function miningEnvironmentIssue (block) {
    if (!block?.position) return 'Mining target is unloaded'
    if (block.isWaterlogged) return 'Mining would release water from a waterlogged block'
    const p = block.position
    const neighbors = DIRECTIONS.filter(d => d.y >= 0).map(d => bot.blockAt(p.plus(d)))
    if (!neighbors.every(b => b && !isFluidBearingBlock(b))) return 'Mining would expose adjacent liquid or an unloaded block'
    const above = bot.blockAt(p.offset(0, 1, 0))
    if (/^(sand|red_sand|gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$|_concrete_powder$/.test(above.name)) return `Mining would release overhead falling block ${above.name}`
    return null
  }

  async function harvestBlock (ctx, p, { expectedBlock = null, requireCurrentReach = false, beforeDig = null, dependentBlocks = [], onConfirmed = null } = {}) {
    if (requireCurrentReach) assert(visibleHere(loaded(p)), 'Mining target is no longer visible from the certified stage')
    else await approachBlock(ctx, p)
    const original = loaded(p)
    const validateTarget = () => {
      const block = loaded(p)
      assert(!isAir(block), 'Requested block is already air')
      assert(block.name === original.name && (expectedBlock == null || block.name === expectedBlock), 'Target block changed before mining')
      const feet = bot.entity.position.floored()
      const position = bot.entity.position
      const touchesFootprint = position.x + 0.31 > p.x && position.x - 0.31 < p.x + 1 && position.z + 0.31 > p.z && position.z - 0.31 < p.z + 1
      const supportsFootprint = touchesFootprint && p.y < position.y && p.y + 1 >= position.y - 0.1
      assert(!(p.x === feet.x && p.z === feet.z && p.y < feet.y) && !supportsFootprint, 'Will not dig the block supporting the bot')
      assert(block.diggable && bot.canDigBlock(block), `Cannot dig ${block.name} from this position`)
      const issue = miningEnvironmentIssue(block)
      assert(!issue, issue)
      if (ctx.starterScope) assertStarterLeafSupport(bot, block, {home:movementBoundary()?.center,positions:starterProtectedPositions()})
      if (requireCurrentReach) assert(visibleHere(block), 'Mining target is no longer visible from the certified stage')
      return block
    }
    const block = validateTarget()
    let tool = bot.pathfinder?.bestHarvestTool(block)
    if (!tool || (block.canHarvest && !block.canHarvest(tool.type))) {
      tool = items().filter(item => !block.canHarvest || block.canHarvest(item.type)).sort((a, b) => (block.digTime?.(a.type, false, false, false, [], bot.entity.effects) ?? 0) - (block.digTime?.(b.type, false, false, false, [], bot.entity.effects) ?? 0))[0]
    }
    if (tool) await step(ctx, () => bot.equip(tool, 'hand'))
    assert(!block.canHarvest || block.canHarvest(bot.heldItem?.type ?? null), `Need a suitable tool to harvest ${block.name}; refusing to destroy it without drops`)
    // Mineflayer normally awaits lookAt inside dig(). Look first, then make
    // the final checks and use its supported 'ignore' mode so no hidden look
    // await can separate validation from the start-dig packet.
    await step(ctx, () => bot.lookAt(p.offset(0.5, 0.5, 0.5), true))
    await step(ctx, () => {
      const current = validateTarget()
      assert(!current.canHarvest || current.canHarvest(bot.heldItem?.type ?? null), `Need a suitable tool to harvest ${current.name}; refusing to destroy it without drops`)
      beforeDig?.()
      const pending = confirmedMining({ bot, block: current, signal: ctx.signal, operationDeadline:ctx.operationDeadline, dependentBlocks })
      return onConfirmed ? pending.then(receipt => { onConfirmed(receipt); return receipt }) : pending
    })
    assert(isAir(loaded(p)), `Confirmed mining target is no longer air`)
    return block.name
  }

  async function digAt (args, ctx) {
    const p = coordinates(args, ctx)
    const block = loaded(p)
    if (isAir(block)) return { completed: true, mined: 0, already_air: true, position: plainPos(p), inventory_changes: {} }
    const before = inventoryMap()
    const expectedBlock = args.expected_block == null ? null : cleanName(args.expected_block, 'block')
    assert(expectedBlock == null || block.name === expectedBlock, 'Target block changed before mining')
    const name = await harvestBlock(ctx, p, { expectedBlock })
    await pause(ctx, 350)
    let pickup
    try { pickup = await pickupInternal(ctx, 8) } catch (error) {
      if (error.code === 'PICKUP_UNSAFE_SETTLEMENT') error.result = { ...error.result, completed:false, mined:1, block:name, position:plainPos(p), inventory_changes:changes(before) }
      throw error
    }
    return { deferred_drops:pickup.deferred_drops??[], passive_settlement:Boolean(ctx.pickupSettledFailure), completed: !pickup.pursuit_unverified && pickup.remaining_drops.length === 0, pickup_landing_verified:pickup.landing_verified, mined: 1, block: name, position: plainPos(p), inventory_changes: changes(before), remaining_drops: pickup.remaining_drops, pickup_failures: pickup.unreachable }
  }

  async function descendNotch (args, ctx) {
    assert(bot.health >= 12 && bot.food >= 10, 'Descent requires health 12+ and food 10+')
    const priorDeadline=ctx.operationDeadline,localDeadline=performance.now()+20000
    ctx.operationDeadline=priorDeadline===undefined?localDeadline:Math.min(priorDeadline,localDeadline)
    const deadline = setTimeout(() => stop(), 20000)
    const dryStep = block => isFluidBearingBlock(block) ? 1000 : 0
    let onCorridorChange = null, constrained = null
    try {
      configureMovement()
      movements.exclusionAreasStep.push(dryStep)
      for (const name of WATER_BEARING_BLOCK_NAMES) {
        const id = bot.registry.blocksByName[name]?.id
        if (id != null) movements.blocksToAvoid.add(id)
      }
      const bound = movementBoundary()
      const home = bound ? new Vec3(bound.center.x, bound.center.y, bound.center.z).floored() : ctx.origin.floored()
      const plan = await planLeafNotch(bot, home, { signal: ctx.signal })
      assert(plan, 'No certified one-leaf descent is available from this grounded position')
      const target = new Vec3(...plan.landing)
      assert(insideBoundary(target), 'Descent would leave the job boundary')
      let targetCleared = false
      const validateSupports = () => {
        for (const cell of plan.corridor) {
          const p = new Vec3(...cell.position)
          if (!targetCleared && p.equals(target)) continue
          const block = loaded(p)
          assert(!isFluidBearingBlock(block) && block.name === cell.name && JSON.stringify(block.shapes) === JSON.stringify(cell.shapes), 'Certified descent corridor geometry changed')
        }
        for (const coordinates of plan.protectedBlocks) {
          const block = loaded(new Vec3(...coordinates))
          assert(!isFluidBearingBlock(block), 'A protected descent support became wet')
          if (/_leaves$/.test(block.name)) assert(retainedLeafAnchor(p => bot.blockAt(p), block.position), 'A return leaf lost its retained log anchor')
          else assert(/_log$/.test(block.name), 'A protected log anchor changed')
        }
      }
      const watched = new Set(plan.protectedBlocks.map(p => p.join(',')))
      for (const p of plan.routes.flat()) for (let dx=-1; dx<=1; dx++) for (let dy=-1; dy<=1; dy++) for (let dz=-1; dz<=1; dz++) watched.add([p[0]+dx,p[1]+dy,p[2]+dz].join(','))
      onCorridorChange = (oldBlock, newBlock) => {
        const p = newBlock?.position ?? oldBlock?.position
        if (p?.equals(target) && oldBlock?.name === plan.dig.expected_block && isAir(newBlock)) return
        if (p && watched.has(p.toArray().join(',')) && (!oldBlock || !newBlock || oldBlock.name !== newBlock.name || Boolean(oldBlock.isWaterlogged) !== Boolean(newBlock.isWaterlogged) || JSON.stringify(oldBlock.shapes) !== JSON.stringify(newBlock.shapes))) stop()
      }
      bot.on('blockUpdate', onCorridorChange)
      const validateStage = () => {
        assert(bot.entity.onGround && bot.entity.position.distanceTo(ctx.origin) <= 0.1, 'Bot moved from its certified descent stage')
        assert(bot.health >= 12 && bot.food >= 10, 'Health or food changed before mining')
        assert(visibleHere(loaded(target)), 'Descent leaf is no longer visible from the stage')
        validateSupports()
      }
      validateStage()
      await harvestBlock(ctx, target, { expectedBlock: plan.dig.expected_block, requireCurrentReach: true, beforeDig: validateStage })
      targetCleared = true
      validateSupports()
      const allowed = new Set(plan.routes.flat().map(p => p.join(',')))
      constrained = Object.create(movements)
      constrained.getNeighbors = node => movements.getNeighbors(node).filter(next => allowed.has([next.x, next.y, next.z].join(',')))
      bot.pathfinder.setMovements(constrained)
      const goal = new goals.GoalBlock(target.x, target.y, target.z)
      await planReturnablePath(bot, constrained, goal, new goals.GoalBlock(home.x, home.y, home.z), { signal: ctx.signal, fixedEndpoint: target })
      validateSupports()
      assert(bot.health >= 12 && bot.food >= 10, 'Health or food changed before descent')
      await step(ctx, () => walkToGoal(bot, goal, { signal: ctx.signal, timeoutMs: 6000 }))
      const settleUntil = Date.now() + 2000
      while (!(bot.entity.onGround && bot.entity.position.floored().equals(target) && Math.abs(bot.entity.position.y - target.y) < 0.03)) {
        assert(Date.now() < settleUntil, 'Descent did not settle on its certified landing')
        await pause(ctx, 50)
      }
      validateSupports()
      assert(bot.health >= 12, 'Health fell below the safe descent threshold')
      return { completed: true, mined: 1, descended_blocks: 1, position: plainPos(bot.entity.position), return_home: plainPos(home), experimental: true }
    } finally {
      clearTimeout(deadline)
      ctx.operationDeadline=priorDeadline
      if (onCorridorChange) bot.removeListener('blockUpdate', onCorridorChange)
      if (constrained && bot.pathfinder.movements === constrained) bot.pathfinder.setMovements(movements)
      if (movements) movements.exclusionAreasStep = movements.exclusionAreasStep.filter(guard => guard !== dryStep)
    }
  }

  async function privateSoilStair (args, ctx, collectStone = false) {
    assert(ctx.privateSoil === PRIVATE_SOIL && typeof ctx.ownershipGuard === 'function', 'Private soil execution requires an owned internal invocation')
    const pathfinder = bot.pathfinder, parentGuard = ctx.ownershipGuard
    let expectedMovement = null, expectedNeighbors = null
    const ownedControl = () => owns(parentGuard) && bot.pathfinder === pathfinder
      && (expectedMovement === null || pathfinder.movements === expectedMovement)
    ctx.ownershipGuard = ownedControl
    lastOwnershipGuard = ownedControl
    configureMovement()
    checked(ctx)
    const base = pathfinder.movements
    expectedMovement = base
    expectedNeighbors = base.getNeighbors
    const policyKeys = Object.keys(base).filter(key => !['bot', 'entityIntersections'].includes(key))
    const copy = value => value instanceof Set ? new Set(value) : Array.isArray(value) ? [...value] : value
    const policy = Object.fromEntries(policyKeys.map(key => [key, copy(base[key])]))
    const validPolicy = () => ownedControl() && expectedMovement.getNeighbors === expectedNeighbors && policyKeys.every(key => {
      const current = expectedMovement[key], expected = policy[key]
      if (expected instanceof Set) return current instanceof Set && current.size === expected.size && [...expected].every(value => current.has(value))
      if (Array.isArray(expected)) return Array.isArray(current) && current.length === expected.length && current.every((value, i) => value === expected[i])
      return current === expected
    })
    const bound = movementBoundary()
    assert(bound?.center, 'Private soil execution requires an explicit home boundary')
    const home = new Vec3(bound.center.x, bound.center.y, bound.center.z)
    const priorDeadline = ctx.operationDeadline
    return (collectStone ? collectExposedSoilStone : executeSoilStair)({
      ...(collectStone ? { exposure: args.exposure } : {}),
      bot, home, signal: ctx.signal, operationDeadline: ctx.operationDeadline,
      ownershipGuard: ownedControl, validatePolicy: validPolicy, protectedPositions: starterProtectedPositions,
      halt: () => stop(),
      mine: async (target, expectedBlock, validate, signal, deadline, dependents = [], onConfirmed = null) => {
        ctx.operationDeadline = Math.min(priorDeadline, deadline)
        try { return await harvestBlock(ctx, target, { expectedBlock, requireCurrentReach: true, beforeDig: validate, onConfirmed, dependentBlocks: dependents.map(cell=>loaded(new Vec3(...cell.position))) }) }
        finally { ctx.operationDeadline = priorDeadline }
      },
      walk: async (route, stage, signal, deadline) => {
        checked(ctx)
        assert(ownedControl(), 'Private soil movement owner changed')
        const edges = new Set()
        for (let i = 1; i < route.length; i++) edges.add(`${route[i - 1].join(',')}>${route[i].join(',')}`)
        const constrained = Object.create(base)
        constrained.entityIntersections = { ...base.entityIntersections }
        constrained.getNeighbors = function (node) {
          return base.getNeighbors.call(this, node).filter(next => !next.toBreak?.length && !next.toPlace?.length && !next.parkour
            && edges.has(`${node.x},${node.y},${node.z}>${next.x},${next.y},${next.z}`))
        }
        try {
          expectedMovement = constrained
          expectedNeighbors = constrained.getNeighbors
          pathfinder.setMovements(constrained)
          checked(ctx)
          const target = new Vec3(...stage).floored()
          const timeoutMs = Math.min(10000, deadline - performance.now())
          assert(timeoutMs > 0, 'Private soil movement deadline reached')
          await step(ctx, () => walkToGoal(bot, new goals.GoalBlock(target.x, target.y, target.z), { signal, timeoutMs, ownershipGuard: ownedControl }))
        } finally {
          if (ownedControl() && pathfinder.movements === constrained) {
            expectedMovement = base
            expectedNeighbors = base.getNeighbors
            pathfinder.setMovements(base)
          }
        }
      }
    })
  }

  async function moveOutOfBlock (ctx, p) {
    const feet = bot.entity.position.floored()
    const position = bot.entity.position
    const overlaps = position.x + 0.31 > p.x && position.x - 0.31 < p.x + 1 && position.z + 0.31 > p.z && position.z - 0.31 < p.z + 1 && position.y + (bot.entity.height ?? 1.8) > p.y && position.y < p.y + 1
    if (!overlaps) return
    const candidates = [new Vec3(2, 0, 0), new Vec3(-2, 0, 0), new Vec3(0, 0, 2), new Vec3(0, 0, -2)].map(d => feet.plus(d)).filter(q => isAir(bot.blockAt(q)) && isAir(bot.blockAt(q.offset(0, 1, 0))) && isSolid(bot.blockAt(q.offset(0, -1, 0))))
    assert(candidates.length, 'Bot occupies placement location and cannot find a safe place to stand')
    await navigate(ctx, candidates[0], 0)
  }

  async function placeOne (ctx, name, p, { beforePlace = null } = {}) {
    checked(ctx)
    const current = loaded(p)
    if (matchesPlacedBlock(current.name, name)) return { placed: false, already_present: true, position: plainPos(p) }
    assert(isAir(current), `Refusing to overwrite ${current.name} at ${JSON.stringify(plainPos(p))}`)
    assert(bot.registry.blocksByName[name], `${name} is not a placeable registry block`)
    owned(name)
    await moveOutOfBlock(ctx, p)
    let supports = DIRECTIONS.map(d => ({ reference: bot.blockAt(p.plus(d)), face: d.scaled(-1) })).filter(s => isSolid(s.reference))
    assert(supports.length, 'No adjacent solid support; place a supported foundation/scaffold first')
    supports.sort((a, b) => a.reference.position.distanceTo(bot.entity.position) - b.reference.position.distanceTo(bot.entity.position))
    const failures = []
    for (const support of supports) {
      try {
        await approachBlock(ctx, support.reference.position)
        await moveOutOfBlock(ctx, p)
        assert(isAir(loaded(p)), 'Placement location became occupied')
        await step(ctx, () => bot.equip(owned(name), 'hand'))
        checked(ctx)
        assert(typeof bot._placeBlockWithOptions === 'function', 'Guarded block placement is unavailable')
        // Finish aiming before final checks. The pinned placement helper can
        // then send synchronously without a second hidden look await.
        await step(ctx, () => bot.lookAt(support.reference.position.offset(0.5+support.face.x*0.5,0.5+support.face.y*0.5,0.5+support.face.z*0.5)))
        const proof = beforePlace ? await beforePlace() : null
        checked(ctx)
        assert(isAir(loaded(p)), 'Placement location became occupied')
        assert(isSolid(loaded(support.reference.position)), 'Placement support changed')
        if (proof) assert(proof.validate(), 'Workstation exit geometry or position changed before placement')
        assert(bot.heldItem?.name === name && bot.heldItem.count > 0, 'Held placement item changed before placement')
        bot.setControlState('sneak', true)
        try { await step(ctx, () => bot._placeBlockWithOptions(loaded(support.reference.position), support.face, { forceLook:'ignore', swingArm:'right' })) } finally { bot.setControlState('sneak', false) }
        await pause(ctx, 100)
        assert(matchesPlacedBlock(loaded(p).name, name), `Server placement mismatch: expected ${name}, observed ${loaded(p).name}`)
        return { placed: true, block: loaded(p).name, position: plainPos(p) }
      } catch (error) {
        checked(ctx)
        if (matchesPlacedBlock(loaded(p).name, name)) return { placed: true, block: loaded(p).name, position: plainPos(p) }
        failures.push(error.message)
      }
    }
    throw new Error(`Could not place ${name}: ${failures.join('; ')}`)
  }

  async function workstation (ctx, name) {
    // Reuse a workstation already in reach. If carrying one, place it locally
    // rather than crossing difficult terrain to a distant duplicate.
    let block = nearby(name, 4, visibleHere) ?? (itemCount(name) ? null : nearby(name, 24))
    if (block) { await approachBlock(ctx, block.position); return loaded(block.position) }
    owned(name)
    const feet = bot.entity.position.floored()
    const candidates = []
    for (let r = 1; r <= 3; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue
      const p = feet.offset(x, 0, z)
      if (isAir(bot.blockAt(p)) && isSolid(bot.blockAt(p.offset(0, -1, 0)))) candidates.push(p)
    }
    if (!candidates.length) throw Object.assign(new Error(`No safe nearby location to place ${name}`), {code:'WORKSTATION_EGRESS_UNVERIFIED',workstation:name})
    configureMovement()
    let planningRemaining = 2500
    const certify = async p => {
      checked(ctx)
      const started = performance.now()
      try {
        const proof = await certifyWorkstationEgress(bot, movements, p, name, { signal:ctx.signal, budgetMs:planningRemaining })
        if (!proof) throw Object.assign(new Error(`Placing ${name} here would not preserve a verified local walking exit`), {code:'WORKSTATION_EGRESS_UNVERIFIED',workstation:name})
        return proof
      } finally { planningRemaining -= performance.now() - started }
    }
    const failures = []
    for (const p of candidates) {
      if (planningRemaining <= 0) break
      try {
        await certify(p)
        await placeOne(ctx, name, p, { beforePlace:() => certify(p) })
        return loaded(p)
      } catch (error) { checked(ctx); failures.push({message:error.message,code:error.code}) }
    }
    const error = new Error(`No verified local exit for automatic ${name} placement: ${failures.at(-1)?.message ?? 'planning budget exhausted'}`)
    if (failures.length && failures.every(f=>f.code==='WORKSTATION_EGRESS_UNVERIFIED')) Object.assign(error,{code:'WORKSTATION_EGRESS_UNVERIFIED',workstation:name})
    throw error
  }

  async function craft (args, ctx) {
    const name = cleanName(args.item)
    const definition = bot.registry.itemsByName[name]
    assert(definition, `Unknown item ${name}`)
    const wanted = numeric(args.count, undefined, 1, 256, true)
    const before = itemCount(name)
    let table = nearby('crafting_table', 4, visibleHere)
    let produced = 0
    let batches = 0
    while (produced < wanted) {
      checked(ctx)
      let recipes = bot.recipesFor(definition.id, null, 1, table)
      if (!recipes.length && !table && (nearby('crafting_table', 24) || itemCount('crafting_table'))) {
        // Mineflayer uses table presence as a recipe filter, not its distance.
        // Check ingredients first so a missing cobblestone does not trigger a
        // long journey to a table that cannot help with the requested craft.
        assert(bot.recipesFor(definition.id, null, 1, true).length, `Cannot craft ${name}: missing ingredients; produced ${produced}/${wanted}`)
        table = await workstation(ctx, 'crafting_table')
        recipes = bot.recipesFor(definition.id, null, 1, table)
      }
      assert(recipes.length, `Cannot craft ${name}: missing ingredients or crafting table; produced ${produced}/${wanted}`)
      const recipe = recipes[0]
      if (recipe.requiresTable) { assert(table, 'Recipe requires a crafting table'); await approachBlock(ctx, table.position) }
      const batchOutput = await craftBatch(ctx, recipe, recipe.requiresTable ? table : null)
      // Mineflayer's 2x2 craft can return before the final inventory click is
      // reconciled. Refresh before counting output or choosing the next recipe.
      if (typeof bot._syncWindow === 'function') await step(ctx, () => bot._syncWindow(bot.inventory))
      batches++
      const previous = produced
      // Restoring a preexisting cursor/grid stack is not newly crafted output.
      // The synchronized path returns a receipt only after verified storage.
      // Keep the legacy native fallback's inventory-delta accounting explicit.
      if (batchOutput == null) produced = itemCount(name) - before
      else {
        assert(Number.isSafeInteger(batchOutput) && batchOutput > 0, 'Invalid confirmed crafting output')
        produced += batchOutput
      }
      assert(produced > previous && batches <= wanted, `Craft did not increase ${name} inventory`)
    }
    return { item: name, requested: wanted, crafted: produced, inventory_count: itemCount(name), recipe_batches: batches }
  }

  function inventorySession (ctx, window) {
    const sync = async () => {
      await step(ctx, () => bot._syncWindow(window))
      // A stale click itself can trigger window_items before the explicit
      // refresh reply. Allow those ordered replies to drain across two physics
      // ticks before reading the authoritative cursor or sending another click.
      await pause(ctx, 100)
    }
    const click = async (slot, button = 0) => { await step(ctx, () => bot.clickWindow(slot, button, 0)); await sync() }
    const confirmed = async (predicate, message) => {
      for (let retry = 0; !predicate() && retry < 2; retry++) await sync()
      assert(predicate(), message)
    }
    const inventorySlots = () => Array.from({ length: window.inventoryEnd - window.inventoryStart }, (_, index) => window.inventoryStart + index)
    async function storeCursor (preferred) {
      for (let attempts = 0; window.selectedItem; attempts++) {
        checked(ctx)
        assert(attempts < 40, 'Could not store inventory cursor item')
        const item = window.selectedItem
        const capacity = itemStackCapacity(item)
        assert(capacity > 0, 'Cannot verify the cursor item stack capacity; refusing an uncertain click')
        const slots = inventorySlots()
        const same = slot => { const there = window.slots[slot]; return sameItemIdentity(there,item) && there.count < itemStackCapacity(there) }
        let destination = preferred != null && (!window.slots[preferred] || same(preferred)) ? preferred : slots.find(same)
        if (destination == null) destination = slots.find(slot => !window.slots[slot])
        assert(destination != null, 'Inventory is full; the cursor still holds an item')
        const there = window.slots[destination]
        const moved = Math.min(item.count, (there ? itemStackCapacity(there) : capacity) - (there?.count ?? 0))
        const remaining = item.count - moved
        const expectedStored = (there?.count ?? 0) + moved
        await click(destination)
        await confirmed(() => (remaining === 0 ? !window.selectedItem : sameItemIdentity(window.selectedItem,item) && window.selectedItem.count === remaining) && sameItemIdentity(window.slots[destination],item) && window.slots[destination].count === expectedStored, 'Server did not confirm storing the cursor item; refusing to repeat an uncertain click')
        preferred = undefined
      }
    }
    async function put (name, count, destination) {
      await storeCursor()
      let remaining = count
      while (remaining > 0) {
        checked(ctx)
        const source = inventorySlots().find(slot => window.slots[slot]?.name === name)
        assert(source != null, `No ${name} left in the server inventory`)
        const item = window.slots[source]
        const sourceCount = item.count
        const amount = Math.min(remaining, sourceCount)
        await click(source)
        await confirmed(() => !window.slots[source] && window.selectedItem?.type === item.type && window.selectedItem.count === sourceCount, 'Server did not confirm picking up the transfer stack')
        if (amount === sourceCount) {
          await click(destination)
          await confirmed(() => !window.selectedItem, 'Server did not accept the full transfer stack')
        } else {
          for (let placed = 1; placed <= amount; placed++) {
            await click(destination, 1)
            await confirmed(() => window.selectedItem?.type === item.type && window.selectedItem.count === sourceCount - placed, 'Server did not confirm the partial item transfer')
          }
          await storeCursor(source)
        }
        remaining -= amount
      }
    }
    async function take (slot) {
      await storeCursor()
      const item = window.slots[slot]
      assert(item, 'There is no output to take')
      const count = item.count
      await click(slot)
      await confirmed(() => window.selectedItem?.type === item.type && window.selectedItem.count === count, 'Server did not confirm taking the output stack')
      await storeCursor()
      return count
    }
    return { sync, click, confirmed, inventorySlots, storeCursor, put, take }
  }

  async function craftBatch (ctx, recipe, table) {
    if (typeof bot.clickWindow !== 'function' || typeof bot._syncWindow !== 'function') {
      await step(ctx, () => bot.craft(recipe, 1, table))
      return null
    }
    // Mineflayer's putAway/putSelectedItemRange use internal optimistic clicks
    // which cannot be synchronized by wrapping the public clickWindow method.
    // Drive every grid, cursor, and inventory click explicitly and reconcile
    // each with the server. This also puts a cancellation check at each click.
    let window
    const size = table ? 3 : 2
    let completed = false
    try {
      checked(ctx)
      // Retain the acquired window inside cleanup scope before checking any
      // cancellation that arrived while the open operation was pending.
      window = table ? await bot.openBlock(table) : bot.inventory
      checked(ctx)
      const { sync, click, confirmed, inventorySlots, storeCursor } = inventorySession(ctx, window)
      async function emptyGrid () {
        await storeCursor()
        for (let slot = 1; slot <= size * size; slot++) {
          if (window.slots[slot]) { await click(slot); await storeCursor() }
        }
      }
      await sync()
      await emptyGrid()
      const plan = []
      const used = new Set()
      for (let y = 0; y < (recipe.inShape?.length ?? 0); y++) {
        const row = recipe.inShape[y]
        assert(y < size && row.length <= size, 'Recipe does not fit this crafting grid')
        for (let x = 0; x < row.length; x++) {
          if (row[x].id < 0) continue
          const slot = 1 + x + y * size
          plan.push({ slot, ingredient: row[x] })
          used.add(slot)
        }
      }
      const extra = Array.from({ length: size * size }, (_, index) => index + 1).filter(slot => !used.has(slot))
      for (const ingredient of recipe.ingredients ?? []) {
        for (let n = 0; n < Math.abs(ingredient.count ?? 1); n++) {
          const slot = extra.shift()
          assert(slot != null, 'Shapeless recipe does not fit this crafting grid')
          plan.push({ slot, ingredient })
        }
      }
      for (const { slot, ingredient } of plan) {
        checked(ctx)
        const source = inventorySlots().find(index => { const item = window.slots[index]; return item && item.type === ingredient.id && (ingredient.metadata == null || item.metadata === ingredient.metadata) })
        assert(source != null, 'Recipe ingredient disappeared from the server inventory')
        const sourceCount = window.slots[source].count
        await click(source)
        await confirmed(() => !window.slots[source] && window.selectedItem?.type === ingredient.id && window.selectedItem.count === sourceCount, 'Server did not confirm picking up a crafting ingredient')
        await click(slot, 1)
        await confirmed(() => window.slots[slot]?.type === ingredient.id && window.slots[slot].count === 1 && (sourceCount === 1 ? !window.selectedItem : window.selectedItem?.type === ingredient.id && window.selectedItem.count === sourceCount - 1), 'Server did not confirm placing a crafting ingredient')
        await storeCursor(source)
      }
      const output = window.slots[0]
      assert(output?.type === recipe.result.id && output.count >= recipe.result.count, 'Server did not produce the requested crafting recipe')
      const outputCount = output.count
      await click(0)
      await confirmed(() => window.selectedItem?.type === recipe.result.id && window.selectedItem.count === outputCount, 'Server did not confirm taking the crafted output')
      await storeCursor()
      // Container ingredients (for example milk buckets) can leave remainders.
      await emptyGrid()
      await sync()
      completed = true
      return outputCount
    } finally {
      if (!staleSession(ctx.session) && window && (table || !completed)) { try { await bot.closeWindow(window) } catch {} }
    }
  }

  function fuelUnits (name) {
    if (name === 'coal_block') return 80
    if (name === 'coal' || name === 'charcoal') return 8
    if (name === 'dried_kelp_block') return 20
    if (name === 'blaze_rod') return 12
    if (/^(stripped_)?(crimson|warped)_/.test(name)) return 0
    if (/_planks$|_log$|_wood$/.test(name)) return 1.5
    if (name === 'stick') return 0.5
    if (name === 'bamboo') return 0.25
    return 0
  }

  async function smelt (args, ctx) {
    const name = cleanName(args.item)
    const count = numeric(args.count, undefined, 1, 8, true)
    const output = SMELTS[name] ?? (/_log$|_wood$/.test(name) ? 'charcoal' : null)
    assert(output, `Smelting recipe for ${name} is not supported by this action`)
    assert(itemCount(name) >= count, `Need ${count} ${name}, have ${itemCount(name)}`)
    let fuelName = args.fuel == null ? null : cleanName(args.fuel, 'fuel')
    if (fuelName) assert(fuelUnits(fuelName) > 0, 'Unsupported fuel; provide coal, charcoal, planks, or logs')
    const block = await workstation(ctx, 'furnace')
    let furnace
    let before
    let closed = false
    try {
      checked(ctx)
      furnace = await bot.openFurnace(block)
      checked(ctx)
      before = itemCount(output)
      assert(!furnace.inputItem() && !furnace.outputItem() && !furnace.fuelItem(), 'Furnace is occupied; refusing to mix with existing items')
      const transaction = inventorySession(ctx, furnace)
      await transaction.sync()
      // Contents can change while synchronization is pending. Refuse newly
      // observed input, output or fuel before transferring anything.
      assert(!furnace.inputItem() && !furnace.outputItem() && !furnace.fuelItem(), 'Furnace is occupied; refusing to mix with existing items')
      const windowCount = () => furnace.slots.slice(furnace.inventoryStart, furnace.inventoryEnd).filter(item => item?.name === output).reduce((total, item) => total + item.count, 0)
      const windowBefore = windowCount()
      // Reuse heat from earlier batches. Re-inserting coal while the furnace
      // is already hot wastes fuel and can strand it in an occupied fuel slot.
      const existingSeconds = Math.max(0, (furnace.fuelSeconds ?? 0) - 2)
      const fuelNeeded = Math.max(0, count - existingSeconds / 10)
      if (fuelNeeded > 0 && !fuelName) fuelName = ['coal', 'charcoal', ...items().filter(i => /_planks$|_log$/.test(i.name)).map(i => i.name)].find(n => fuelUnits(n) * Math.max(0, itemCount(n) - (n === name ? count : 0)) >= fuelNeeded)
      assert(fuelNeeded === 0 || (fuelName && fuelUnits(fuelName) > 0), 'No supported fuel sufficient for this batch; provide coal, charcoal, planks, or logs')
      const fuelCount = fuelNeeded === 0 ? 0 : Math.ceil(fuelNeeded / fuelUnits(fuelName))
      assert(fuelCount === 0 || itemCount(fuelName) >= fuelCount + (fuelName === name ? count : 0), `Need ${fuelCount} ${fuelName} for fuel in addition to the input`)
      await transaction.put(name, count, 0)
      if (fuelCount > 0) await transaction.put(fuelName, fuelCount, 1)
      const deadline = Date.now() + count * 11000 + 10000
      while (windowCount() - windowBefore < count && Date.now() < deadline) {
        checked(ctx)
        const result = furnace.outputItem()
        if (result) { assert(result.name === output, `Unexpected furnace output ${result.name}`); await transaction.take(2) }
        if (windowCount() - windowBefore < count) await pause(ctx, 500)
      }
      const received = windowCount() - windowBefore
      assert(received >= count, `Smelting timed out: received ${received}/${count} ${output}; remaining items may be inside furnace`)
      // Container inventory changes are copied back to bot.inventory on close.
      // Counting the closed inventory earlier would miss successfully taken output.
      await step(ctx, () => furnace.close())
      closed = true
      await step(ctx, () => bot._syncWindow(bot.inventory))
      await pause(ctx, 100)
      const produced = itemCount(output) - before
      assert(produced >= count, `Furnace output was taken but inventory confirmation received only ${produced}/${count} ${output}`)
      return { input: name, output, smelted: produced, furnace: plainPos(block.position), fuel_added: { item: fuelName, count: fuelCount }, existing_heat_seconds: existingSeconds }
    } finally { if (!staleSession(ctx.session) && furnace && !closed) { try { await furnace.close() } catch {} } }
  }

  async function build (args, ctx) {
    const name = cleanName(args.block, 'block')
    assert(bot.registry.blocksByName[name], `Unknown block ${name}`)
    assert(['floor', 'wall', 'box'].includes(args.shape), 'shape must be floor, wall, or box')
    const width = numeric(args.width, undefined, 1, 16, true)
    const height = numeric(args.height, undefined, 1, 16, true)
    const depth = numeric(args.depth, undefined, 1, 16, true)
    assert(args.hollow == null || typeof args.hollow === 'boolean', 'hollow must be boolean or null')
    assert(args.shape !== 'floor' || height === 1, 'floor requires height 1')
    assert(args.shape !== 'wall' || depth === 1, 'wall requires depth 1')
    const origin = coordinates(args, ctx)
    const positions = []
    for (let y = 0; y < height; y++) for (let z = 0; z < depth; z++) for (let x = 0; x < width; x++) {
      if (args.shape === 'box' && args.hollow !== false && x > 0 && x < width - 1 && y > 0 && y < height - 1 && z > 0 && z < depth - 1) continue
      positions.push(coordinates(origin.offset(x, y, z), ctx))
    }
    assert(positions.length <= 256, 'Build exceeds 256 blocks; divide it into smaller sections')
    // Check the whole shape before changing the world. Existing matching blocks count as built.
    const todo = positions.filter(p => { const block = loaded(p); assert(isAir(block) || matchesPlacedBlock(block.name, name), `Build intersects ${block.name} at ${JSON.stringify(plainPos(p))}; choose empty space`); return !matchesPlacedBlock(block.name, name) })
    assert(itemCount(name) >= todo.length, `Build needs ${todo.length} ${name}; have ${itemCount(name)}`)
    let placed = 0
    const remaining = [...todo]
    const failures = []
    while (remaining.length) {
      checked(ctx)
      const index = remaining.findIndex(p => DIRECTIONS.some(d => isSolid(bot.blockAt(p.plus(d)))))
      if (index < 0) { failures.push({ error: 'Remaining blocks have no solid support; provide a foundation or explicit scaffold with place' }); break }
      const p = remaining[index]
      try { await placeOne(ctx, name, p); placed++; remaining.splice(index, 1) } catch (error) { checked(ctx); failures.push({ position: plainPos(p), error: error.message }); break }
    }
    const verified = positions.filter(p => matchesPlacedBlock(bot.blockAt(p)?.name, name)).length
    return { completed: verified === positions.length, block: name, expected: positions.length, placed, already_present: positions.length - todo.length, verified, remaining: remaining.slice(0, 32).map(plainPos), failures }
  }

  async function eat (args, ctx) {
    assert(bot.food < 20, 'Food bar is already full')
    const preferred = args.item == null ? null : cleanName(args.item, 'food')
    const available = items().filter(i => (!preferred || i.name === preferred) && !FOOD_EXCLUDE.has(i.name) && bot.registry.foodsByName?.[i.name]).sort((a, b) => (bot.registry.foodsByName[b.name].foodPoints ?? 0) - (bot.registry.foodsByName[a.name].foodPoints ?? 0))
    assert(available.length, 'No safe food in inventory')
    const item = available[0]
    const before = { food: bot.food, count: itemCount(item.name), health: bot.health }
    await step(ctx, () => bot.equip(item, 'hand'))
    await step(ctx, () => bot.consume())
    assert(bot.food > before.food || bot.health > before.health || itemCount(item.name) < before.count, 'Server did not confirm eating')
    return { eaten: item.name, food: bot.food, health: bot.health }
  }

  async function attack (args, ctx) {
    const id = args.entity_id == null ? null : numeric(args.entity_id, undefined, 0, 2147483647, true)
    const name = args.mob == null ? null : cleanName(args.mob, 'mob')
    assert(id !== null || name, 'Provide entity_id or mob')
    const valid = entity => entity && entity !== bot.entity && entity.position && !entity.username && entity.type !== 'player' && ['mob', 'animal', 'hostile', 'passive', 'water_creature', 'ambient'].includes(entity.type) && !entity.owner && !entity.ownerUUID && !entity.tamed
    const entity = id !== null ? bot.entities[id] : Object.values(bot.entities ?? {}).filter(e => valid(e) && e.name === name).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
    assert(valid(entity), 'Target must be a visible living non-player mob without a known owner')
    assert(entity.position.distanceTo(ctx.origin) <= 48, 'Target is too far away')
    const duration = numeric(args.duration, 15, 1, 45)
    const weapon = items().filter(i => /_sword$|_axe$/.test(i.name)).sort((a, b) => { const rank = s => (/netherite/.test(s) ? 6 : /diamond/.test(s) ? 5 : /iron/.test(s) ? 4 : /stone/.test(s) ? 3 : /golden/.test(s) ? 2 : 1) + (/_sword$/.test(s) ? 0.5 : 0); return rank(b.name) - rank(a.name) })[0]
    if (weapon) await step(ctx, () => bot.equip(weapon, 'hand'))
    configureMovement()
    let died = false
    let hits = 0
    const onDeath = e => { if (e.id === entity.id) died = true }
    bot.on('entityDead', onDeath)
    const deadline = Date.now() + duration * 1000
    try {
      while (Date.now() < deadline && !died && bot.entities[entity.id]) {
        checked(ctx)
        assert(bot.health > 6, 'Combat stopped because health is low')
        const target = bot.entities[entity.id]
        assert(valid(target), 'Target changed or is no longer attackable')
        assert(target.position.distanceTo(ctx.origin) <= 64, 'Combat target moved beyond action range')
        if (target.position.distanceTo(bot.entity.position) > 2.8) bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
        else {
          bot.pathfinder.setGoal(null)
          await step(ctx, () => bot.lookAt(target.position.offset(0, Math.min(target.height ?? 1, 1), 0), true))
          checked(ctx)
          bot.attack(target)
          hits++
        }
        await pause(ctx, /_axe$/.test(bot.heldItem?.name ?? '') ? 1100 : 650)
      }
      return { target_id: entity.id, mob: entity.name, attacks_sent: hits, killed: died, target_visible: !!bot.entities[entity.id], timed_out: Date.now() >= deadline && !died }
    } finally { bot.removeListener('entityDead', onDeath); bot.pathfinder.setGoal(null) }
  }

  const handlers = {
    private_soil_stair: privateSoilStair,
    private_soil_collect: (args,ctx) => privateSoilStair(args,ctx,true),
    starter_retreat: (args,ctx) => runStarterRetreat(bot,args,{signal:ctx.signal,check:()=>checked(ctx),guard:ctx.recoveryGuard,abort:error=>{ctx.controller.abort(error);stop()},prepareMovement:()=>{configureMovement();return movements}}),
    inspect, collect, craft, smelt, build, eat, attack, dig_at: digAt, descend_notch: descendNotch,
    go_to: async (args, ctx) => { const target = coordinates(args, ctx); const radius = numeric(args.radius, 1, 0, 8); await navigate(ctx, target, radius, { returnable: args.returnable === true, walkingTimeoutMs: 45000 }); return { arrived: true, position: plainPos(bot.entity.position), target: plainPos(target), radius } },
    place: async (args, ctx) => placeOne(ctx, cleanName(args.block, 'block'), coordinates(args, ctx)),
    pickup: async (args, ctx) => pickupInternal(ctx, numeric(args.radius, 12, 1, 32, true), args.entity_ids),
    equip: async (args, ctx) => { const name = cleanName(args.item); const destination = args.destination ?? 'hand'; assert(['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'].includes(destination), 'Invalid equipment slot'); await step(ctx, () => bot.equip(owned(name), destination)); const slot = destination === 'hand' ? bot.heldItem : bot.inventory.slots[bot.getEquipmentDestSlot(destination)]; assert(slot?.name === name, `Equip was not confirmed in ${destination}`); return { equipped: name, destination } },
    follow: async (args, ctx) => {
      const player = visiblePlayer(args.player)
      const duration = numeric(args.duration, 15, 1, 60)
      const distance = numeric(args.distance, 3, 1, 8)
      assert(player.position.distanceTo(ctx.origin) <= 64, 'Player is too far away')
      configureMovement()
      bot.pathfinder.setGoal(new goals.GoalFollow(player, distance), true)
      const deadline = Date.now() + duration * 1000
      try { while (Date.now() < deadline) { checked(ctx); const current = visiblePlayer(args.player); assert(current.position.distanceTo(ctx.origin) <= 128, 'Player moved beyond follow range'); await pause(ctx, 250) } } finally { bot.pathfinder.setGoal(null) }
      return { followed: args.player, seconds: duration, distance: Math.round(visiblePlayer(args.player).position.distanceTo(bot.entity.position) * 10) / 10 }
    },
    give: async (args, ctx) => {
      const target = visiblePlayer(args.player)
      const name = cleanName(args.item)
      const count = numeric(args.count, undefined, 1, 256, true)
      const before = itemCount(name)
      assert(before >= count, `Need ${count} ${name}; have ${before}`)
      await navigate(ctx, target.position.floored(), 1)
      const current = visiblePlayer(args.player)
      assert(current.position.distanceTo(bot.entity.position) <= 4, 'Player moved out of giving range')
      await step(ctx, () => bot.lookAt(current.position.offset(0, 1, 0), true))
      // Forced look updates local physics first. Give two ticks for the look
      // packet to reach the server before its toss velocity is calculated.
      await pause(ctx, 100)
      assert(visiblePlayer(args.player).position.distanceTo(bot.entity.position) <= 3, 'Player moved out of giving range')
      const item = owned(name)
      await step(ctx, () => bot.toss(item.type, item.metadata ?? null, count))
      if (typeof bot._syncWindow === 'function') { await step(ctx, () => bot._syncWindow(bot.inventory)); await pause(ctx, 100) }
      assert(before - itemCount(name) >= count, 'Inventory did not confirm the full dropped amount')
      return { dropped_for: args.player, item: name, count, delivery: 'dropped nearby; recipient pickup unverified' }
    },
    sleep: async (args, ctx) => {
      const session=interactionSession(bot,()=>checked(ctx),{overworldOnly:true})
      try {
        const ready=()=>{
          session.check()
          assert(!bot.isSleeping,'Already sleeping')
          assert((bot.isRaining&&bot.thunderState>0)||(bot.time?.timeOfDay>=12541&&bot.time.timeOfDay<=23458),'It is not night or a thunderstorm')
        }
        ready()
        const bed=bot.findBlock({matching:block=>bot.isABed(block),maxDistance:32})
        assert(bed,'No loaded nearby bed')
        await approachBlock(ctx,bed.position,{interaction:true})
        session.check()
        const send=await prepareObservedActivation(bot,loaded(bed.position),{check:ready,requireBed:true})
        await confirmSleep(bot,send,{signal:ctx.signal,check:()=>session.check()})
        session.check()
        return {sleeping:true,bed:plainPos(bed.position)}
      } finally {session.dispose()}
    },
    wake: async (args,ctx) => {
      const session=interactionSession(bot,()=>checked(ctx))
      try {
        session.check()
        assert(bot.version==='1.21.8','Explicit waking is verified only for Minecraft Java 1.21.8')
        assert(bot.isSleeping===true,'Bot is already awake')
        const send=()=>{
          session.check()
          assert(bot.isSleeping===true,'Sleeping state changed before wake request')
          assert(Number.isSafeInteger(bot.entity.id)&&bot.entity.id>=0,'Wake requires a valid player entity')
          bot._client.write('entity_action',{entityId:bot.entity.id,actionId:'stop_sleeping',jumpBoost:0})
        }
        await confirmWake(bot,send,{signal:ctx.signal,check:()=>session.check()})
        session.check()
        return {awake:true}
      } finally {session.dispose()}
    },
    activate: async (args, ctx) => {
      const session=interactionSession(bot,()=>checked(ctx))
      try {
      const p = coordinates(args, ctx)
      await approachBlock(ctx, p,{interaction:true})
      const block = loaded(p)
      const before = block.stateId
      const send=await prepareObservedActivation(bot,block,{check:()=>session.check()})
      send()
      await pause(ctx, 150)
      session.check()
      const result = { activated: block.name, position: plainPos(p), block_changed: loaded(p).stateId !== before, opened_window: bot.currentWindow?.type ?? null }
      if (bot.currentWindow) await step(ctx, () => bot.closeWindow(bot.currentWindow))
      session.check()
      return result
      } finally {session.dispose()}
    },
    use_item: async (args, ctx) => {
      const duration = numeric(args.duration, 1, 0, 10)
      const currentYaw = Math.atan2(Math.sin(bot.entity.yaw ?? 0), Math.cos(bot.entity.yaw ?? 0))
      const yaw = numeric(args.yaw, currentYaw, -Math.PI, Math.PI)
      const pitch = numeric(args.pitch, bot.entity.pitch ?? 0, -Math.PI / 2, Math.PI / 2)
      if (args.item != null) await step(ctx, () => bot.equip(owned(cleanName(args.item)), 'hand'))
      assert(bot.heldItem, 'Nothing is held')
      const name = bot.heldItem.name
      const before = inventoryMap()
      await step(ctx, () => bot.look(yaw, pitch, true))
      checked(ctx)
      bot.activateItem()
      try { await pause(ctx, duration * 1000) } finally { if (!staleSession(ctx.session)) bot.deactivateItem() }
      return { used: name, seconds: duration, inventory_changes: changes(before) }
    },
    explore: async (args, ctx) => {
      const distance = numeric(args.distance, 24, 4, 96, true)
      const vectors = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
      assert(args.direction == null || (typeof args.direction === 'string' && Object.hasOwn(vectors, args.direction)), 'Invalid compass direction')
      const alternatives = args.alternatives ?? []
      assert(Array.isArray(alternatives) && alternatives.length <= 3 && alternatives.every(d => typeof d === 'string' && Object.hasOwn(vectors, d)), 'Invalid exploration alternatives')
      assert(!alternatives.length || (Object.hasOwn(vectors, args.direction) && args.returnable === true), 'Exploration alternatives require an explicit direction and verified return route')
      assert(new Set([args.direction, ...alternatives]).size === alternatives.length + 1, 'Exploration directions must be distinct')
      const start = bot.entity.position.clone()
      const boundedScout=Boolean(ctx.starterScope)&&args.returnable===true
      const scoutNodeAllowed=node=>node&&['x','y','z'].every(k=>Number.isFinite(node[k]))
        &&Math.abs(node.x)<29999984&&Math.abs(node.z)<29999984
        &&insideBoundary(new Vec3(node.x,node.y,node.z))&&insideBoundary(new Vec3(node.x+.5,node.y,node.z+.5))
      const targetFor = direction => {
        const [dx, dz] = direction == null ? [-Math.sin(bot.entity.yaw ?? 0), -Math.cos(bot.entity.yaw ?? 0)] : vectors[direction]
        const target = start.offset(dx * distance, 0, dz * distance).floored()
        assert(Math.abs(target.x) < 29999984 && Math.abs(target.z) < 29999984, 'Exploration exceeds world bounds')
        assert(insideBoundary(target), 'Exploration target is outside the current job movement boundary')
        return boundedScout?new StarterScoutGoal(target,scoutNodeAllowed):new goals.GoalXZ(target.x, target.z)
      }
      configureMovement()
      let direction = args.direction, tried = [direction], routeAttempts = [], goal
      if (args.returnable === true && args.direction != null) {
        const selected = await planRankedRoutes([direction, ...alternatives], async (candidate, budget) => {
          checked(ctx)
          return returnableGoal(ctx, targetFor(candidate), null, budget,boundedScout?scoutNodeAllowed:null)
        }, { signal: ctx.signal })
        goal = selected.route; direction = selected.candidate; tried = selected.tried; routeAttempts = selected.outcomes
      } else {
        goal = targetFor(direction)
        if (args.returnable === true) goal = await returnableGoal(ctx, goal,null,1600,boundedScout?scoutNodeAllowed:null)
      }
      // Never switch candidates after movement starts: a walking failure ends
      // this scout and the controller must inspect the real position again.
      try {
        if(boundedScout)assert(scoutNodeAllowed(goal),'Selected starter scout landing is outside its boundary')
        await step(ctx, () => bot.pathfinder.goto(goal))
        if(boundedScout)assert(insideBoundary(bot.entity.position),'Starter scout ended outside its movement boundary')
        const actual = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z)
        assert(actual >= distance - 2, 'Exploration ended before requested distance')
        return { explored: true, direction, directions_tried: tried, route_attempts: routeAttempts, distance: Math.round(actual * 10) / 10, position: plainPos(bot.entity.position) }
      } catch (error) { error.result = { ...(error.result ?? {}), directions_tried: tried, route_attempts: routeAttempts }; throw error }

    }
  }

  async function execute (name, args = {}, signal, executionContext = {}) {
    let operationDeadline
    try {
    emptySearch.dispatch(name, executionContext.parentSignal)
    assertTerrainTrusted(bot)
    assert(Object.hasOwn(handlers, name), `Unknown action ${name}`)
    if (name === 'private_soil_stair' || name === 'private_soil_collect') assert(executionContext.privateSoil === PRIVATE_SOIL && typeof executionContext.ownershipGuard === 'function', 'Private soil execution requires an owned internal invocation')
    assert(args && typeof args === 'object' && !Array.isArray(args), 'Action arguments must be an object')
    assert(executionContext.ownershipGuard == null || typeof executionContext.ownershipGuard === 'function', 'Physical ownership guard must be a function')
    assert(owns(executionContext.ownershipGuard), 'Action cancelled: physical ownership changed')
    assert(!active, 'Another physical action is running or draining after cancellation')
    if (signal?.aborted) throw abortError()
    assert(bot.entity?.position, 'Bot has not spawned')
    const deadlines=[executionContext.jobDeadline,executionContext.actionDeadline].filter(value=>value!==undefined)
    assert(deadlines.every(Number.isFinite),'Operation deadlines must be finite monotonic timestamps')
    operationDeadline=deadlines.length?Math.min(...deadlines):undefined
    } catch (error) { emptySearch.clear(); throw error }
    const controller = new AbortController()
    const session = { entity: bot.entity, client: bot._client, dimension: dimension(), changed: false }
    lastSession = session
    lastOwnershipGuard = executionContext.ownershipGuard ?? null
    const allowSprinting = !(executionContext.starterScope && name === 'explore' && args.returnable === true && !hasStarterFood(items()))
    const ctx = { privateSoil: executionContext.privateSoil, ownershipGuard: lastOwnershipGuard, parentSignal:executionContext.parentSignal, runnerSignal:signal, allowSprinting, session, operationDeadline, starterScope:executionContext.starterScope, recoveryGuard:executionContext.recoveryGuard, signal: controller.signal, controller, cancelled: false, origin: bot.entity.position.clone() }
    active = ctx
    // A coordinate is meaningful only in the play session that admitted it.
    // Latch transitions even if the dimension later changes back. Stop promptly,
    // but retain the physical lock until the old operation has fully drained.
    const sessionEvents = ['respawn', 'spawn', 'end']
    const sessionChanged = () => { session.changed = true; stop({ sessionChanged: true }) }
    for (const event of sessionEvents) bot.on(event, sessionChanged)
    const cancel = () => stop()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      checked(ctx)
      const result = await handlers[name](args, ctx)
      try { checked(ctx) } catch (error) { throw retainOperationResult(error, { result }) }
      return result
    } catch (error) {
      if (!ctx.searchContinuationSaved) emptySearch.clear()
      // Cancellation may reject inside an awaited helper before its next check.
      // Preserve the session failure instead of hiding it behind that rejection.
      if (staleSession(ctx.session)) {
        try { checked(ctx) } catch (sessionError) { throw retainOperationResult(sessionError, error) }
      }
      throw error
    } finally {
      for (const event of sessionEvents) bot.removeListener(event, sessionChanged)
      signal?.removeEventListener('abort', cancel)
      try { if (owns(ctx.ownershipGuard)) bot.pathfinder?.setGoal(null) } catch {}
      try { if (owns(ctx.ownershipGuard)) bot.clearControlStates?.() } catch {}
      active = null
    }
  }

  return { execute, stop, collectExposedStone:(exposure,signal,context={})=>execute('private_soil_collect',{exposure},signal,{...context,privateSoil:PRIVATE_SOIL}), excavateSoil:(signal,context={})=>execute('private_soil_stair',{},signal,{...context,privateSoil:PRIVATE_SOIL}), invalidateSearch:() => emptySearch.clear(), snapshot, definitions, retreatFromHostile:(args,signal,context)=>execute('starter_retreat',args,signal,context) }
}

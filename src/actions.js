import pathfinderPackage from 'mineflayer-pathfinder'
import { Vec3 } from 'vec3'
import { configureCollisionMargin } from './collision-margin.js'
import { planReturnablePath, pursueDroppedItem } from './navigation-guards.js'

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

const str = description => ({ type: 'string', description })
const number = (description, minimum, maximum, integer = false) => ({ type: integer ? 'integer' : 'number', description, minimum, maximum })
const optional = schema => ({ ...schema, type: [schema.type, 'null'] })
const posSchema = { x: number('World X coordinate', -29999984, 29999984, true), y: number('World Y coordinate', -2048, 2048, true), z: number('World Z coordinate', -29999984, 29999984, true) }
const def = (name, description, properties) => ({ type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } })

export const definitions = [
  def('inspect', 'Read real position, health, inventory, visible entities, nearby useful blocks, and immediately craftable recipe hints. This does not reveal unloaded terrain.', { radius: optional(number('Block search radius; default 16', 1, 32, true)) }),
  def('go_to', 'Walk to a loaded location within 128 blocks. Never digs or places blocks while navigating. Radius 0 requires standing at the exact block.', { ...posSchema, radius: optional(number('Acceptable distance; default 1', 0, 8)) }),
  def('follow', 'Follow a visible player for a bounded number of seconds; repeat if necessary. Never changes terrain.', { player: str('Exact visible player username'), duration: optional(number('Seconds; default 15', 1, 60)), distance: optional(number('Following distance; default 3', 1, 8)) }),
  def('collect', 'Mine up to the requested number of named blocks using a suitable owned tool, then pick up nearby drops. Reports blocks mined and actual inventory gains separately. Requires visible reachable blocks.', { block: str('Exact registry block name, for example oak_log or iron_ore'), count: number('Number of blocks to mine', 1, 64, true), radius: optional(number('Search radius; default 24', 1, 64, true)) }),
  def('dig_at', 'Mine one exact loaded block and collect drops using an appropriate owned tool. Useful for planned stairs, tunnels, or clearing a specific obstruction. Refuses to mine under the bot, expose adjacent water/lava, or release an overhead falling block.', { ...posSchema }),
  def('craft', 'Craft a requested number of output items from existing ingredients. May place an owned crafting table nearby. Does not gather ingredients. Recipe batch output can exceed count.', { item: str('Exact output item name'), count: number('Number of output items wanted, not recipe repetitions', 1, 256, true) }),
  def('smelt', 'Smelt owned items in a nearby empty furnace; may place an owned furnace. Supplies fuel and waits for verified inventory output. Up to 8 items per call.', { item: str('Input item name'), count: number('Number of input items', 1, 8, true), fuel: optional(str('Owned fuel item name; null chooses coal, charcoal, planks, or logs')) }),
  def('place', 'Place one owned block at an exact air location adjacent to a solid support. Never replaces existing blocks. Walks into reach and verifies the server block.', { block: str('Inventory block item name'), ...posSchema }),
  def('build', 'Build an inventory-backed floor, wall, or box in the positive XYZ directions, at most 256 blocks. Floor uses width/depth; wall uses width/height (depth must be 1). Requires an existing solid foundation and reachable placement faces; reports partial construction honestly. Does not clear occupied space.', { block: str('Inventory block item name'), shape: { type: 'string', enum: ['floor', 'wall', 'box'] }, ...posSchema, width: number('X size', 1, 16, true), height: number('Y size; 1 for floor', 1, 16, true), depth: number('Z size; 1 for wall', 1, 16, true), hollow: optional({ type: 'boolean', description: 'For box, build only the six outer faces; default true' }) }),
  def('equip', 'Equip an existing item in hand, off-hand, or an armor slot.', { item: str('Owned item name'), destination: optional({ type: 'string', enum: ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet', null], description: 'Equipment slot; null defaults to hand' }) }),
  def('eat', 'Eat a safe owned food item if hungry, verifying food/health or inventory change.', { item: optional(str('Food item name; null chooses safe food automatically')) }),
  def('attack', 'Attack one visible non-player mob with a suitable owned melee weapon for at most duration seconds. Never attacks players, pets with a known owner, or non-living entities. Stops at low health.', { entity_id: optional(number('Specific visible mob entity id', 0, 2147483647, true)), mob: optional(str('Mob registry name if no entity id')), duration: optional(number('Maximum seconds; default 15', 1, 45)) }),
  def('give', 'Walk to a visible player and drop a requested number of owned items toward them. Verifies inventory removal; cannot guarantee which player collects dropped items.', { player: str('Visible player username'), item: str('Owned item name'), count: number('Number of items', 1, 256, true) }),
  def('sleep', 'Find and enter a nearby bed. Reports failure if the server refuses sleep.', {}),
  def('activate', 'Right-click a loaded reachable block, such as a door, button, lever, or workstation. Reports observed block/window change, not unverified mechanism results.', { ...posSchema }),
  def('use_item', 'Use an owned/current held item in a chosen direction for a bounded time, then release it. Yaw/pitch are radians. Useful for bow, shield, fishing, eyes of ender, or other right-click items. Reports actual item use and inventory changes, not guessed hits.', { item: optional(str('Item to equip, or null for current held item')), yaw: optional(number('Yaw radians; null keeps current direction', -Math.PI, Math.PI)), pitch: optional(number('Pitch radians; positive looks up', -Math.PI / 2, Math.PI / 2)), duration: optional(number('Hold seconds before release; default 1', 0, 10)) }),
  def('pickup', 'Walk over nearby dropped item entities and report verified inventory gains.', { radius: optional(number('Maximum radius; default 12', 1, 32, true)) }),
  def('explore', 'Walk a bounded distance in a compass direction while loading new terrain, without digging or placing.', { direction: optional({ type: 'string', enum: ['north', 'south', 'east', 'west', null], description: 'Compass direction; null uses current facing' }), distance: optional(number('Distance; default 24', 4, 96, true)) })
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
export function createActions (bot, { memory, log = () => {} } = {}) {
  configureCollisionMargin(bot)
  let active = null
  let movements = null
  const items = () => bot.inventory?.items() ?? []
  const itemCount = name => items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0)
  const inventoryMap = () => Object.fromEntries([...new Set(items().map(i => i.name))].map(name => [name, itemCount(name)]))
  const changes = before => { const after = inventoryMap(); return Object.fromEntries([...new Set([...Object.keys(before), ...Object.keys(after)])].map(name => [name, (after[name] ?? 0) - (before[name] ?? 0)]).filter(([, count]) => count !== 0)) }
  const owned = name => { const item = items().find(i => i.name === name); assert(item, `No ${name} in inventory`); return item }
  const dimension = () => bot.game?.dimension ?? bot.entity?.dimension ?? 'unknown'
  const loaded = p => { const b = bot.blockAt(p); assert(b, `Chunk not loaded at ${JSON.stringify(plainPos(p))}`); return b }
  const nearby = (name, radius = 32) => {
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
        if (block?.type === id) { closest = block; distance = d }
      }
      return closest
    }
    const positions = bot.findBlocks({ matching: id, maxDistance: Math.ceil(radius * Math.sqrt(3) + 24), count: 256 }).filter(p => p.distanceTo(origin) <= radius).sort((a, b) => a.distanceTo(origin) - b.distanceTo(origin))
    return positions.length ? bot.blockAt(positions[0]) : null
  }
  const checked = ctx => { if (ctx?.signal?.aborted || ctx?.cancelled) throw abortError(); assert(bot.entity?.position, 'Bot has not spawned'); if (bot.health != null) assert(bot.health > 0, 'Bot is dead') }
  const step = async (ctx, fn) => { checked(ctx); const result = await fn(); checked(ctx); return result }

  function stop () {
    if (active) { active.cancelled = true; active.controller.abort() }
    try { bot.pathfinder?.setGoal(null) } catch {}
    try { bot.stopDigging?.() } catch {}
    // Switching slots cancels a drawn bow without releasing an unintended arrow.
    try { if (bot.usingHeldItem && bot.heldItem?.name === 'bow') bot.setQuickBarSlot?.(((bot.quickBarSlot ?? 0) + 1) % 9) } catch {}
    try { bot.deactivateItem?.() } catch {}
    try { bot.clearControlStates?.() } catch {}
    try { if (bot.currentWindow) Promise.resolve(bot.closeWindow(bot.currentWindow)).catch(() => {}) } catch {}
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

  function configureMovement () {
    assert(bot.pathfinder, 'Mineflayer pathfinder plugin is required')
    if (!movements) {
      movements = new Movements(bot)
      movements.canDig = false
      movements.allow1by1towers = false
      movements.allowParkour = false
      movements.scafoldingBlocks = []
      movements.maxDropDown = 3
    }
    bot.pathfinder.setMovements(movements)
  }

  function coordinates (args, ctx, integer = true) {
    const p = new Vec3(numeric(args.x, undefined, -29999984, 29999984, integer), numeric(args.y, undefined, -2048, 2048, integer), numeric(args.z, undefined, -29999984, 29999984, integer))
    const minY = bot.game?.minY ?? -64
    const maxY = minY + (bot.game?.height ?? 384)
    assert(p.y >= minY && p.y < maxY, `Y must be within this world's build range ${minY}..${maxY - 1}`)
    assert(p.distanceTo(ctx.origin) <= 128, 'Target is more than 128 blocks from action start; use bounded waypoints')
    return p
  }

  async function navigate (ctx, target, radius = 1, { requireLoaded = true, lookAt = false, returnable = false } = {}) {
    checked(ctx)
    assert(target.distanceTo(ctx.origin) <= 128, 'Target is more than 128 blocks from action start')
    if (requireLoaded) loaded(target)
    configureMovement()
    let goal = lookAt ? new BlockFaceGoal(target, bot.world, { reach: 4, eyeHeight: bot.entity.eyeHeight ?? 1.62 }) : radius === 0 ? new goals.GoalBlock(target.x, target.y, target.z) : new goals.GoalNear(target.x, target.y, target.z, radius)
    if (returnable) goal = await returnableGoal(ctx, goal)
    await step(ctx, () => bot.pathfinder.goto(goal))
    if (!lookAt) assert(radius === 0 ? bot.entity.position.floored().equals(target.floored()) : bot.entity.position.distanceTo(target.offset(0.5, 0, 0.5)) <= radius + 1.2, 'Navigation ended before reaching the requested location')
  }

  async function returnableGoal (ctx, goal) {
    checked(ctx)
    configureMovement()
    const used = ctx.planningUsed ?? 0
    assert(used < 7000, 'Collection return-path planning budget exhausted')
    const start = performance.now()
    try {
      const home = ctx.origin.floored()
      const planned = await planReturnablePath(bot, movements, goal, new goals.GoalBlock(home.x, home.y, home.z), { signal: ctx.signal, planningBudget: Math.min(1600, 7000 - used), yieldControl: () => pause(ctx, 0) })
      checked(ctx)
      return new goals.GoalBlock(planned.endpoint.x, planned.endpoint.y, planned.endpoint.z)
    } finally { ctx.planningUsed = used + performance.now() - start }
  }

  async function approachBlock (ctx, p, { returnable = false } = {}) {
    loaded(p)
    const visible = () => {
      const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
      if (bot.world?.raycast) return visibleBlockFace(bot.world, eye, p, 4.5)
      return eye.distanceTo(p.offset(0.5, 0.5, 0.5)) <= 4.5 && (!bot.canSeeBlock || bot.canSeeBlock(loaded(p)))
    }
    if (!visible()) await navigate(ctx, p, 3, { lookAt: true, returnable })
    assert(visible(), 'Target block remains out of reach or behind an obstruction')
  }

  function visiblePlayer (username) {
    assert(typeof username === 'string' && /^[^\u0000-\u001f\u007f]{1,32}$/.test(username), 'Invalid player username')
    const entity = bot.players?.[username]?.entity
    assert(entity && entity !== bot.entity, `Player ${username} is not visible`)
    return entity
  }

  function snapshot () {
    const position = bot.entity?.position
    return {
      connected: !!position,
      position: plainPos(position), dimension: dimension(), health: bot.health ?? null, food: bot.food ?? null, oxygen: bot.oxygenLevel ?? null,
      time: bot.time?.timeOfDay ?? null, is_raining: bot.isRaining ?? false, sleeping: !!bot.isSleeping,
      inventory: items().map(i => ({ name: i.name, count: i.count, durability_used: i.durabilityUsed ?? null })),
      equipment: Object.fromEntries(Object.entries({ helmet: 5, chestplate: 6, leggings: 7, boots: 8, off_hand: 45 }).map(([name, slot]) => { const item = bot.inventory?.slots?.[slot]; return [name, item ? { name: item.name, count: item.count, durability_used: item.durabilityUsed ?? null } : null] })),
      held_item: bot.heldItem?.name ?? null,
      entities: position ? Object.values(bot.entities ?? {}).filter(e => e !== bot.entity && e.position && e.position.distanceTo(position) <= 48).sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position)).slice(0, 24).map(e => ({ id: e.id, name: e.name ?? e.displayName ?? e.type, type: e.type, username: e.username ?? null, position: plainPos(e.position), distance: Math.round(e.position.distanceTo(position) * 10) / 10 })) : []
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

  async function pickupInternal (ctx, radius = 12) {
    const before = inventoryMap()
    const drops = () => Object.values(bot.entities ?? {}).filter(e => e.name === 'item' && e.position && e.position.distanceTo(bot.entity.position) <= radius && e.position.distanceTo(ctx.origin) <= 128)
    const attempts = new Map()
    const failures = []
    for (let n = 0; n < 24; n++) {
      checked(ctx)
      const target = drops().filter(e => (attempts.get(e.id) ?? 0) < 3).sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0]
      if (!target) break
      attempts.set(target.id, (attempts.get(target.id) ?? 0) + 1)
      // Drops from upper logs/ores are often still falling. Walking to their
      // airborne Y creates an impossible path; project onto loaded ground.
      const dropPosition = target.position.floored()
      const destinations = []
      configureMovement()
      const passable = b => b && (isAir(b) || /^(short_grass|tall_grass|fern|large_fern|leaf_litter)$/.test(b.name)) && b.boundingBox === 'empty' && !movements.blocksToAvoid.has(b.type) && !movements.liquids.has(b.type)
      for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
        for (let down = -1; down <= 8; down++) {
          const p = dropPosition.offset(x, -down, z)
          if (passable(bot.blockAt(p)) && passable(bot.blockAt(p.offset(0, 1, 0))) && isSolid(bot.blockAt(p.offset(0, -1, 0)))) { destinations.push(p); break }
        }
      }
      // A cell close to the bot can still be outside item-pickup reach,
      // especially diagonally. Aim at the drop rather than the nearest cell.
      destinations.sort((a, b) => a.offset(0.5, 0, 0.5).distanceTo(target.position) - b.offset(0.5, 0, 0.5).distanceTo(target.position))
      try {
        assert(destinations.length, 'No validated standing space near dropped item')
        let goal, lastError
        for (const p of destinations.slice(0, 3)) {
          try { goal = await returnableGoal(ctx, new goals.GoalBlock(p.x, p.y, p.z)); break } catch (error) { checked(ctx); lastError = error }
        }
        if (!goal) throw lastError ?? new Error('No returnable route to dropped item')
        checked(ctx)
        await pursueDroppedItem(bot, goal, target, { signal: ctx.signal })
        checked(ctx)
        await pause(ctx, 200)
      } catch (error) { checked(ctx); failures.push({ id: target.id, error: error.message }); await pause(ctx, 150) }
    }
    return { inventory_changes: changes(before), remaining_drops: drops().map(e => ({ id: e.id, position: plainPos(e.position) })), unreachable: failures }
  }

  async function collect (args, ctx) {
    const name = cleanName(args.block, 'block')
    const definition = bot.registry?.blocksByName?.[name]
    assert(definition, `Unknown block ${name}`)
    const count = numeric(args.count, undefined, 1, 64, true)
    const radius = numeric(args.radius, 24, 1, 64, true)
    const before = inventoryMap()
    const skipped = new Set()
    const failures = []
    let mined = 0
    let searchLimited = false
    let consecutiveFailures = 0
    while (mined < count) {
      checked(ctx)
      // Filter before findBlocks applies its count cap. Dense buried stone must
      // not hide a farther exposed face or consume the pathfinding failure budget.
      // Mineflayer applies useExtraInfo to real positioned blocks (not palettes).
      // Time/count budgets are checked on matching blocks, not a hard timeout
      // for findBlocks itself; its fixed radius also bounds nonmatching scans.
      const candidates = []
      const searchOrigin = bot.entity.position.floored()
      const searchLimit = Symbol('collection search limit')
      const deadline = performance.now() + 500
      let inspected = 0
      try {
        bot.findBlocks({ matching: definition.id, maxDistance: radius, count: 512, useExtraInfo: block => {
          checked(ctx)
          if (++inspected > 65536 || performance.now() >= deadline) throw searchLimit
          const p = block.position
          if (!p || p.distanceTo(searchOrigin) > radius || p.distanceTo(ctx.origin) > 128 || skipped.has(p.toString())) return false
          if (!DIRECTIONS.some(d => isAir(bot.blockAt(p.plus(d))))) return false
          candidates.push(p)
          return true
        } })
      } catch (error) {
        if (error !== searchLimit) throw error
        searchLimited = true
      }
      // Nearby depth can be a misleading shortcut: prefer surface-height resources
      // before trying a dense cave face. Returnability is still verified separately.
      const effort = p => {
        // Drops scatter off ledges. Prefer a supported landing area to a cliff
        // edge, without excluding trees or resources that lack a full platform.
        const stableLanding = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]].every(([x, z]) => isSolid(bot.blockAt(p.offset(x, -1, z))))
        return p.distanceTo(bot.entity.position) + 3 * Math.abs(p.y - bot.entity.position.y) + (stableLanding ? 0 : 32)
      }
      const choices = candidates.sort((a, b) => effort(a) - effort(b)).slice(0, 128)
      if (!choices.length) break
      const p = choices[0]
      skipped.add(p.toString())
      try {
        await approachBlock(ctx, p, { returnable: true })
        const block = loaded(p)
        if (block.name !== name) continue
        await harvestBlock(ctx, p)
        mined++
        consecutiveFailures = 0
        await pause(ctx, 300)
        await pickupInternal(ctx, 6)
      } catch (error) {
        checked(ctx)
        failures.push({ position: plainPos(p), error: error.message })
        if (++consecutiveFailures >= 8) break
      }
    }
    let pickup = { remaining_drops: [], unreachable: [] }
    if (mined) { await pause(ctx, 300); pickup = await pickupInternal(ctx, 12) }
    const result = { completed: mined === count && pickup.remaining_drops.length === 0, requested: count, mined, inventory_changes: changes(before), remaining_drops: pickup.remaining_drops, pickup_failures: pickup.unreachable, failures, search_limited: searchLimited }
    if (!mined) throw Object.assign(new Error(`Could not collect ${name}: ${failures[0]?.error ?? (searchLimited ? 'bounded search exhausted; try moving closer or a smaller radius' : 'no exposed loaded candidates found')}`), { result })
    return result
  }

  async function harvestBlock (ctx, p) {
    await approachBlock(ctx, p)
    const block = loaded(p)
    assert(!isAir(block), 'Requested block is already air')
    const feet = bot.entity.position.floored()
    assert(!(p.x === feet.x && p.z === feet.z && p.y < feet.y), 'Will not dig the block supporting the bot')
    assert(block.diggable && bot.canDigBlock(block), `Cannot dig ${block.name} from this position`)
    const neighbors = DIRECTIONS.filter(d => d.y >= 0).map(d => bot.blockAt(p.plus(d)))
    assert(neighbors.every(b => b && !['water', 'lava'].includes(b.name)), 'Mining would expose adjacent liquid or an unloaded block')
    const above = loaded(p.offset(0, 1, 0))
    assert(!/^(sand|red_sand|gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$|_concrete_powder$/.test(above.name), `Mining would release overhead falling block ${above.name}`)
    let tool = bot.pathfinder?.bestHarvestTool(block)
    if (!tool || (block.canHarvest && !block.canHarvest(tool.type))) {
      tool = items().filter(item => !block.canHarvest || block.canHarvest(item.type)).sort((a, b) => (block.digTime?.(a.type, false, false, false, [], bot.entity.effects) ?? 0) - (block.digTime?.(b.type, false, false, false, [], bot.entity.effects) ?? 0))[0]
    }
    if (tool) await step(ctx, () => bot.equip(tool, 'hand'))
    assert(!block.canHarvest || block.canHarvest(bot.heldItem?.type ?? null), `Need a suitable tool to harvest ${block.name}; refusing to destroy it without drops`)
    await step(ctx, () => bot.dig(block, true))
    assert(loaded(p).name !== block.name, `Server did not confirm mining ${block.name}`)
    return block.name
  }

  async function digAt (args, ctx) {
    const p = coordinates(args, ctx)
    const block = loaded(p)
    if (isAir(block)) return { completed: true, mined: 0, already_air: true, position: plainPos(p), inventory_changes: {} }
    const before = inventoryMap()
    const name = await harvestBlock(ctx, p)
    await pause(ctx, 350)
    const pickup = await pickupInternal(ctx, 8)
    return { completed: pickup.remaining_drops.length === 0, mined: 1, block: name, position: plainPos(p), inventory_changes: changes(before), remaining_drops: pickup.remaining_drops, pickup_failures: pickup.unreachable }
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

  async function placeOne (ctx, name, p) {
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
        bot.setControlState('sneak', true)
        try { await step(ctx, () => bot.placeBlock(loaded(support.reference.position), support.face)) } finally { bot.setControlState('sneak', false) }
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
    let block = nearby(name, 4) ?? (itemCount(name) ? null : nearby(name, 24))
    if (block) { await approachBlock(ctx, block.position); return loaded(block.position) }
    owned(name)
    const feet = bot.entity.position.floored()
    const candidates = []
    for (let r = 1; r <= 3; r++) for (let x = -r; x <= r; x++) for (let z = -r; z <= r; z++) {
      if (Math.max(Math.abs(x), Math.abs(z)) !== r) continue
      const p = feet.offset(x, 0, z)
      if (isAir(bot.blockAt(p)) && isSolid(bot.blockAt(p.offset(0, -1, 0)))) candidates.push(p)
    }
    assert(candidates.length, `No safe nearby location to place ${name}`)
    await placeOne(ctx, name, candidates[0])
    block = loaded(candidates[0])
    return block
  }

  async function craft (args, ctx) {
    const name = cleanName(args.item)
    const definition = bot.registry.itemsByName[name]
    assert(definition, `Unknown item ${name}`)
    const wanted = numeric(args.count, undefined, 1, 256, true)
    const before = itemCount(name)
    let table = nearby('crafting_table', 4)
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
      await craftBatch(ctx, recipe, recipe.requiresTable ? table : null)
      // Mineflayer's 2x2 craft can return before the final inventory click is
      // reconciled. Refresh before counting output or choosing the next recipe.
      if (typeof bot._syncWindow === 'function') await step(ctx, () => bot._syncWindow(bot.inventory))
      batches++
      const previous = produced
      produced = itemCount(name) - before
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
        const slots = inventorySlots()
        const same = slot => { const there = window.slots[slot]; return there && there.type === item.type && there.metadata === item.metadata && there.count < there.stackSize }
        let destination = preferred != null && (!window.slots[preferred] || same(preferred)) ? preferred : slots.find(same)
        if (destination == null) destination = slots.find(slot => !window.slots[slot])
        assert(destination != null, 'Inventory is full; the cursor still holds an item')
        const there = window.slots[destination]
        const moved = Math.min(item.count, (there?.stackSize ?? item.stackSize ?? 64) - (there?.count ?? 0))
        const remaining = item.count - moved
        const expectedStored = (there?.count ?? 0) + moved
        await click(destination)
        await confirmed(() => (remaining === 0 ? !window.selectedItem : window.selectedItem?.type === item.type && window.selectedItem.count === remaining) && window.slots[destination]?.type === item.type && window.slots[destination].count === expectedStored, 'Server did not confirm storing the cursor item; refusing to repeat an uncertain click')
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
    if (typeof bot.clickWindow !== 'function' || typeof bot._syncWindow !== 'function') return step(ctx, () => bot.craft(recipe, 1, table))
    // Mineflayer's putAway/putSelectedItemRange use internal optimistic clicks
    // which cannot be synchronized by wrapping the public clickWindow method.
    // Drive every grid, cursor, and inventory click explicitly and reconcile
    // each with the server. This also puts a cancellation check at each click.
    const window = table ? await step(ctx, () => bot.openBlock(table)) : bot.inventory
    const size = table ? 3 : 2
    let completed = false
    const { sync, click, confirmed, inventorySlots, storeCursor } = inventorySession(ctx, window)
    async function emptyGrid () {
      await storeCursor()
      for (let slot = 1; slot <= size * size; slot++) {
        if (window.slots[slot]) { await click(slot); await storeCursor() }
      }
    }
    try {
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
    } finally {
      if (table || !completed) { try { await bot.closeWindow(window) } catch {} }
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
    const furnace = await step(ctx, () => bot.openFurnace(block))
    const before = itemCount(output)
    let closed = false
    try {
      assert(!furnace.inputItem() && !furnace.outputItem() && !furnace.fuelItem(), 'Furnace is occupied; refusing to mix with existing items')
      const transaction = inventorySession(ctx, furnace)
      await transaction.sync()
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
    } finally { if (!closed) { try { await furnace.close() } catch {} } }
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
    inspect, collect, craft, smelt, build, eat, attack, dig_at: digAt,
    go_to: async (args, ctx) => { const target = coordinates(args, ctx); const radius = numeric(args.radius, 1, 0, 8); await navigate(ctx, target, radius); return { arrived: true, position: plainPos(bot.entity.position), target: plainPos(target), radius } },
    place: async (args, ctx) => placeOne(ctx, cleanName(args.block, 'block'), coordinates(args, ctx)),
    pickup: async (args, ctx) => pickupInternal(ctx, numeric(args.radius, 12, 1, 32, true)),
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
      assert(dimension() === 'overworld' || dimension() === 'minecraft:overworld', 'Beds can explode outside the overworld; sleep is restricted to the overworld')
      const bed = bot.findBlock({ matching: block => bot.isABed(block), maxDistance: 32 })
      assert(bed, 'No loaded nearby bed')
      await approachBlock(ctx, bed.position)
      await step(ctx, () => bot.sleep(loaded(bed.position)))
      assert(bot.isSleeping, 'Server did not confirm sleep')
      return { sleeping: true, bed: plainPos(bed.position) }
    },
    activate: async (args, ctx) => {
      const p = coordinates(args, ctx)
      await approachBlock(ctx, p)
      const block = loaded(p)
      const before = block.stateId
      await step(ctx, () => bot.activateBlock(block))
      await pause(ctx, 150)
      const result = { activated: block.name, position: plainPos(p), block_changed: loaded(p).stateId !== before, opened_window: bot.currentWindow?.type ?? null }
      if (bot.currentWindow) await step(ctx, () => bot.closeWindow(bot.currentWindow))
      return result
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
      try { await pause(ctx, duration * 1000) } finally { bot.deactivateItem() }
      return { used: name, seconds: duration, inventory_changes: changes(before) }
    },
    explore: async (args, ctx) => {
      const distance = numeric(args.distance, 24, 4, 96, true)
      const vectors = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] }
      assert(args.direction == null || vectors[args.direction], 'Invalid compass direction')
      const [dx, dz] = args.direction == null ? [-Math.sin(bot.entity.yaw ?? 0), -Math.cos(bot.entity.yaw ?? 0)] : vectors[args.direction]
      const start = bot.entity.position.clone()
      const target = start.offset(dx * distance, 0, dz * distance).floored()
      assert(Math.abs(target.x) < 29999984 && Math.abs(target.z) < 29999984, 'Exploration exceeds world bounds')
      configureMovement()
      await step(ctx, () => bot.pathfinder.goto(new goals.GoalXZ(target.x, target.z)))
      const actual = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z)
      assert(actual >= distance - 2, 'Exploration ended before requested distance')
      return { explored: true, distance: Math.round(actual * 10) / 10, position: plainPos(bot.entity.position) }
    }
  }

  async function execute (name, args = {}, signal) {
    assert(Object.hasOwn(handlers, name), `Unknown action ${name}`)
    assert(args && typeof args === 'object' && !Array.isArray(args), 'Action arguments must be an object')
    assert(!active, 'Another physical action is running or draining after cancellation')
    if (signal?.aborted) throw abortError()
    assert(bot.entity?.position, 'Bot has not spawned')
    const controller = new AbortController()
    const ctx = { signal: controller.signal, controller, cancelled: false, origin: bot.entity.position.clone() }
    active = ctx
    const cancel = () => stop()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      checked(ctx)
      const result = await handlers[name](args, ctx)
      checked(ctx)
      return result
    } finally {
      signal?.removeEventListener('abort', cancel)
      try { bot.pathfinder?.setGoal(null) } catch {}
      try { bot.clearControlStates?.() } catch {}
      active = null
    }
  }

  return { execute, stop, snapshot, definitions }
}

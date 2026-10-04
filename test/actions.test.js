import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import minecraftData from 'minecraft-data'
import { Vec3 } from 'vec3'
import { createActions, definitions } from '../src/actions.js'

const registry = minecraftData('1.21.11')

function fakeBot () {
  const bot = new EventEmitter()
  const blocks = new Map()
  const stacks = []
  bot.registry = registry
  bot.entity = { id: 1, position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0, height: 1.62, onGround: true, effects: {} }
  bot.health = 20
  bot.food = 10
  bot.game = { minY: -64, height: 384, dimension: 'overworld' }
  bot.entities = { 1: bot.entity }
  bot.players = {}
  bot.inventory = { items: () => stacks.filter(i => i.count > 0), slots: [] }
  bot.clearControlStates = () => {}
  bot.setControlState = () => {}
  bot.stopDigging = () => {}
  bot.deactivateItem = () => {}
  bot.blockAt = p => blocks.get(p.floored().toString()) ?? { name: 'air', type: registry.blocksByName.air.id, position: p.floored(), boundingBox: 'empty', stateId: 0 }
  bot.canSeeBlock = () => true
  bot.pathfinder = { setMovements: () => {}, setGoal: () => {}, goto: async goal => { bot.entity.position = new Vec3(goal.x + 0.5, goal.y ?? 64, goal.z + 0.5) }, bestHarvestTool: () => null }
  bot.pathfinder.goal = null
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal; bot.emit('goal_updated', goal)
    if (goal) Promise.resolve(bot.pathfinder.goto(goal)).then(() => { if (bot.pathfinder.goal === goal) bot.emit('goal_reached', goal) }, () => bot.emit('path_update', { status: 'noPath' }))
  }
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) { yield { result: { status: 'success', path: [{ x: goal.x, y: goal.y ?? start.y, z: goal.z }] } } }
  bot.findBlock = ({ matching }) => [...blocks.values()].find(b => typeof matching === 'function' ? matching(b) : Array.isArray(matching) ? matching.includes(b.type) : b.type === matching) ?? null
  bot.findBlocks = options => [...blocks.values()].filter(b => Array.isArray(options.matching) ? options.matching.includes(b.type) : b.type === options.matching)
    .filter(b => typeof options.useExtraInfo !== 'function' || options.useExtraInfo(b))
    .map(b => b.position).sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position)).slice(0, options.count ?? 1)
  bot.equip = async item => { bot.heldItem = item }
  bot.look = async () => {}
  bot.lookAt = async () => {}
  bot.placeBlock = async (reference, face) => { putBlock(bot.heldItem.name, reference.position.plus(face)); bot.heldItem.count-- }
  bot._placeBlockWithOptions = (...args) => bot.placeBlock(...args)
  bot.canDigBlock = () => true
  bot.recipesFor = () => []
  bot.recipesAll = () => []
  bot.addItem = (name, count = 1) => { const item = { name, count, type: registry.itemsByName[name].id, metadata: 0 }; stacks.push(item); return item }
  function putBlock (name, p, extra = {}) { const b = { name, type: registry.blocksByName[name].id, position: p, boundingBox: name === 'air' ? 'empty' : 'block', stateId: registry.blocksByName[name].defaultState, diggable: true, canHarvest: () => true, ...extra }; blocks.set(p.toString(), b); return b }
  bot.putBlock = putBlock
  bot.removeBlock = p => blocks.delete(p.toString())
  return bot
}

test('Responses definitions have strict, complete object schemas', () => {
  for (const definition of definitions) {
    assert.equal(definition.type, 'function')
    assert.equal(definition.strict, true)
    assert.equal(definition.parameters.additionalProperties, false)
    assert.deepEqual(definition.parameters.required, Object.keys(definition.parameters.properties))
  }
})

test('navigation rejects excessive distance and out-of-world coordinates before movement', async () => {
  const bot = fakeBot()
  let moved = false
  bot.pathfinder.goto = async () => { moved = true }
  const actions = createActions(bot)
  await assert.rejects(actions.execute('go_to', { x: 200, y: 64, z: 0, radius: 1 }), /128 blocks/)
  await assert.rejects(actions.execute('go_to', { x: 0, y: -65, z: 0, radius: 1 }), /build range/)
  assert.equal(moved, false)
})

test('navigation disables terrain modification and verifies actual arrival', async () => {
  const bot = fakeBot()
  let movement
  bot.pathfinder.setMovements = value => { movement = value }
  bot.pathfinder.goto = async () => {}
  await assert.rejects(createActions(bot).execute('go_to', { x: 30, y: 64, z: 0, radius: 1 }), /before reaching/)
  assert.equal(movement.canDig, false)
  assert.equal(movement.allow1by1towers, false)
  assert.deepEqual(movement.scafoldingBlocks, [])
})

test('abort drains an in-flight equipment operation and prevents later item use', async () => {
  const bot = fakeBot()
  bot.addItem('bow')
  const controller = new AbortController()
  let resolveEquip
  bot.equip = () => new Promise(resolve => { resolveEquip = resolve })
  let activated = 0
  bot.activateItem = () => { activated++ }
  const actions = createActions(bot)
  const pending = actions.execute('use_item', { item: 'bow', yaw: 0, pitch: 0, duration: 0 }, controller.signal)
  controller.abort()
  await assert.rejects(actions.execute('inspect', { radius: 1 }), /running or draining/)
  resolveEquip()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(activated, 0)
  assert.equal((await actions.execute('inspect', { radius: 1 })).connected, true)
})

test('already aborted actions never mutate equipment', async () => {
  const bot = fakeBot()
  bot.addItem('bow')
  let equipped = false
  bot.equip = async () => { equipped = true }
  await assert.rejects(createActions(bot).execute('equip', { item: 'bow' }, AbortSignal.abort()), { name: 'AbortError' })
  assert.equal(equipped, false)
})

test('build validates every occupied location before placing any block', async () => {
  const bot = fakeBot()
  bot.addItem('oak_planks', 10)
  bot.putBlock('chest', new Vec3(3, 64, 0))
  let placed = 0
  bot.placeBlock = async () => { placed++ }
  await assert.rejects(createActions(bot).execute('build', { block: 'oak_planks', shape: 'floor', x: 2, y: 64, z: 0, width: 2, height: 1, depth: 1, hollow: null }), /intersects chest/)
  assert.equal(placed, 0)
})

test('build does not conjure materials and verifies server placement', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.putBlock('stone', new Vec3(3, 63, 0))
  const actions = createActions(bot)
  const args = { block: 'oak_planks', shape: 'floor', x: 2, y: 64, z: 0, width: 2, height: 1, depth: 1, hollow: null }
  await assert.rejects(actions.execute('build', args), /needs 2 oak_planks/)
  bot.addItem('oak_planks', 2)
  const result = await actions.execute('build', args)
  assert.equal(result.completed, true)
  assert.equal(result.verified, 2)
  assert.equal(result.placed, 2)
  assert.equal(bot.inventory.items().length, 0)
})

test('unsupported floating build reports incomplete without pretending success', async () => {
  const bot = fakeBot()
  bot.addItem('oak_planks', 2)
  const result = await createActions(bot).execute('build', { block: 'oak_planks', shape: 'floor', x: 2, y: 64, z: 0, width: 2, height: 1, depth: 1 })
  assert.equal(result.completed, false)
  assert.equal(result.placed, 0)
  assert.match(result.failures[0].error, /no solid support/)
})

test('placing a torch accepts its server-selected wall variant', async () => {
  const bot = fakeBot()
  bot.addItem('torch')
  bot.putBlock('stone', new Vec3(2, 64, 0))
  bot.placeBlock = async (reference, face) => { bot.putBlock('wall_torch', reference.position.plus(face)); bot.heldItem.count-- }
  const result = await createActions(bot).execute('place', { block: 'torch', x: 2, y: 64, z: 1 })
  assert.equal(result.placed, true)
  assert.equal(result.block, 'wall_torch')
})

test('craft interprets count as output units, not recipe repetitions', async () => {
  const bot = fakeBot()
  const log = bot.addItem('oak_log', 1)
  bot.recipesFor = id => id === registry.itemsByName.oak_planks.id && log.count ? [{ result: { count: 4 }, requiresTable: false }] : []
  let calls = 0
  bot.craft = async (recipe, count) => { assert.equal(count, 1); calls++; log.count--; bot.addItem('oak_planks', 4) }
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 4 })
  assert.equal(calls, 1)
  assert.equal(result.crafted, 4)
})

test('craft waits for server inventory reconciliation before choosing another batch', async () => {
  const bot = fakeBot()
  const log = bot.addItem('oak_log', 2)
  let reconciled = true
  let synced = 0
  bot.recipesFor = () => reconciled && log.count ? [{ result: { count: 4 }, requiresTable: false }] : []
  bot.craft = async () => { log.count--; bot.addItem('oak_planks', 4); reconciled = false }
  bot._syncWindow = async window => { assert.equal(window, bot.inventory); reconciled = true; synced++ }
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.equal(synced, 2)
})

test('craft finds an adjacent table across a diagonal chunk boundary', async () => {
  const bot = fakeBot()
  const position = new Vec3(-1, 64, -1)
  bot.putBlock('crafting_table', position)
  bot.findBlocks = () => [] // Simulate Mineflayer's small-radius section-search miss.
  bot.findBlock = () => null
  bot.recipesFor = (type, metadata, count, table) => table ? [{ result: { count: 1 }, requiresTable: true }] : []
  bot.craft = async (recipe, count, table) => { assert.ok(table.position.equals(position)); bot.addItem('wooden_pickaxe') }
  const result = await createActions(bot).execute('craft', { item: 'wooden_pickaxe', count: 1 })
  assert.equal(result.crafted, 1)
})

test('real crafting path synchronizes every cursor/grid/output click and preserves leftover ingredients', async () => {
  const bot = fakeBot()
  const logType = registry.itemsByName.oak_log.id
  const plankType = registry.itemsByName.oak_planks.id
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(46).fill(null), cursor: null }
  server.slots[36] = stack('oak_log', 2)
  const inventory = { slots: Array(46).fill(null), selectedItem: null, inventoryStart: 9, inventoryEnd: 45, items () { return this.slots.slice(9, 45).filter(Boolean) } }
  bot.inventory = inventory
  const pending = []
  const recipe = { result: { id: plankType, count: 4 }, requiresTable: false, inShape: null, ingredients: [{ id: logType, metadata: null, count: -1 }] }
  bot.recipesFor = () => inventory.items().some(item => item.type === logType) ? [recipe] : []
  bot.craft = async () => { throw new Error('Native optimistic craft must not run') }
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0, 'Every click must be reconciled before the next'); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (slot === 0) { assert.equal(server.cursor, null); server.cursor = server.slots[0]; server.slots[1] = null }
      else if (button === 1) { assert.equal(server.slots[slot], null); server.slots[slot] = { ...server.cursor, count: 1 }; server.cursor.count--; if (!server.cursor.count) server.cursor = null }
      else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); server.slots[slot].count += server.cursor.count; server.cursor = null }
      server.slots[0] = server.slots[1]?.type === logType ? stack('oak_planks', 4) : null
    }
    inventory.slots = server.slots.map(item => item && { ...item })
    inventory.selectedItem = server.cursor && { ...server.cursor }
  }
  await bot._syncWindow()
  const result = await createActions(bot).execute('craft', { item: 'oak_planks', count: 8 })
  assert.equal(result.crafted, 8)
  assert.deepEqual(inventory.items().map(item => [item.name, item.count]), [['oak_planks', 8]])
  assert.equal(server.cursor, null)
  assert.equal(server.slots[1], null)
})

test('mining refuses blocks whose drops require an unavailable tool', async () => {
  const bot = fakeBot()
  bot.putBlock('diamond_ore', new Vec3(2, 64, 0), { canHarvest: () => false })
  let mined = false
  bot.dig = async () => { mined = true }
  await assert.rejects(createActions(bot).execute('collect', { block: 'diamond_ore', count: 1, radius: 8 }), /suitable tool/)
  assert.equal(mined, false)
})

test('mining distinguishes mined blocks from inventory collection', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  bot.putBlock('oak_log', p)
  bot.dig = async () => bot.removeBlock(p)
  const result = await createActions(bot).execute('collect', { block: 'oak_log', count: 2, radius: 8 })
  assert.equal(result.mined, 1)
  assert.equal(result.completed, false)
  assert.deepEqual(result.inventory_changes, {})
})

test('collection filters enclosed stone before the 128-candidate cap', async () => {
  const bot = fakeBot()
  for (let x = -4; x <= 4; x++) for (let y = 54; y <= 62; y++) for (let z = -4; z <= 4; z++) {
    const shell = Math.abs(x) === 4 || Math.abs(z) === 4 || y === 54 || y === 62
    bot.putBlock(shell ? 'dirt' : 'stone', new Vec3(x, y, z))
  }
  const exposed = new Vec3(12, 64, 0)
  bot.putBlock('stone', exposed)
  const unfiltered = bot.findBlocks({ matching: registry.blocksByName.stone.id, count: 128 })
  assert.equal(unfiltered.length, 128)
  assert.equal(unfiltered.some(p => p.equals(exposed)), false)
  const approached = []
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    if (goal.target) approached.push(goal.target)
    const p = goal.target ? goal.target.offset(-1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  bot.pathfinder.goto = async goal => { bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5) }
  bot.dig = async block => { assert.ok(block.position.equals(exposed)); bot.removeBlock(exposed); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 })
  assert.equal(result.completed, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
  assert.equal(result.search_limited, false)
  assert.deepEqual(approached, [exposed])
})

test('collection rejects enclosed or unloaded faces without attempting a path', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  bot.putBlock('stone', p)
  bot.blockAt = position => position.equals(p) ? { name: 'stone', position: p } : null
  let moved = false
  bot.pathfinder.goto = async () => { moved = true }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 }), /no exposed loaded candidates/)
  assert.equal(moved, false)
})

test('collection bounds matching-block inspection and reports an incomplete search', async () => {
  const bot = fakeBot()
  let inspected = 0
  bot.findBlocks = options => {
    while (true) { inspected++; options.useExtraInfo({ position: new Vec3(1000, 64, 0) }) }
  }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 }), error => {
    assert.match(error.message, /bounded search exhausted/)
    assert.equal(error.result.search_limited, true)
    return true
  })
  assert.ok(inspected <= 65537)
})

test('collection keeps exposed candidates found before its scan budget is exhausted', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  const block = bot.putBlock('stone', p)
  bot.findBlocks = options => {
    options.useExtraInfo(block)
    while (true) options.useExtraInfo({ position: new Vec3(1000, 64, 0) })
  }
  bot.dig = async () => { bot.removeBlock(p); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 })
  assert.equal(result.completed, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
  assert.equal(result.search_limited, true)
})

test('collection propagates cancellation during candidate scanning', async () => {
  const bot = fakeBot()
  const controller = new AbortController()
  bot.findBlocks = options => { controller.abort(); options.useExtraInfo({ position: new Vec3(2, 64, 0) }) }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 }, controller.signal), { name: 'AbortError' })
})

test('mining prefers harvest eligibility over an unsuitable faster golden tool', async () => {
  const bot = fakeBot()
  const gold = bot.addItem('golden_pickaxe')
  const iron = bot.addItem('iron_pickaxe')
  const p = new Vec3(2, 64, 0)
  bot.putBlock('diamond_ore', p, { canHarvest: type => type === iron.type })
  bot.pathfinder.bestHarvestTool = () => gold
  bot.dig = async () => { assert.equal(bot.heldItem.name, 'iron_pickaxe'); bot.removeBlock(p); bot.addItem('diamond') }
  const result = await createActions(bot).execute('collect', { block: 'diamond_ore', count: 1, radius: 8 })
  assert.equal(result.inventory_changes.diamond, 1)
})

test('dig_at removes only the specified block and verifies resulting inventory', async () => {
  const bot = fakeBot()
  const p = new Vec3(2, 64, 0)
  bot.putBlock('oak_log', p)
  bot.putBlock('oak_log', new Vec3(3, 64, 0))
  bot.dig = async block => { assert.ok(block.position.equals(p)); bot.removeBlock(p); bot.addItem('oak_log') }
  const result = await createActions(bot).execute('dig_at', { x: 2, y: 64, z: 0 })
  assert.equal(result.mined, 1)
  assert.equal(result.inventory_changes.oak_log, 1)
  assert.equal(bot.blockAt(new Vec3(3, 64, 0)).name, 'oak_log')
})

test('dig_at refuses support removal, liquid exposure, and overhead falling blocks', async () => {
  const bot = fakeBot()
  let dug = false
  bot.dig = async () => { dug = true }
  const actions = createActions(bot)
  bot.putBlock('stone', new Vec3(0, 63, 0))
  await assert.rejects(actions.execute('dig_at', { x: 0, y: 63, z: 0 }), /supporting the bot/)
  const p = new Vec3(2, 64, 0)
  bot.putBlock('stone', p)
  bot.putBlock('lava', new Vec3(3, 64, 0))
  await assert.rejects(actions.execute('dig_at', { x: 2, y: 64, z: 0 }), /adjacent liquid/)
  bot.removeBlock(new Vec3(3, 64, 0))
  bot.putBlock('gravel', new Vec3(2, 65, 0))
  await assert.rejects(actions.execute('dig_at', { x: 2, y: 64, z: 0 }), /overhead falling/)
  assert.equal(dug, false)
})

test('pickup projects falling drops onto reachable ground', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 66.5, 0.5) }
  bot.pathfinder.goto = async goal => { assert.equal(goal.y, 64); bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5); delete bot.entities[2]; bot.addItem('oak_log') }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(result.inventory_changes.oak_log, 1)
  assert.deepEqual(result.remaining_drops, [])
})

test('give supports an exact visible Bedrock username with a prefix and space', async () => {
  const bot = fakeBot()
  const item = bot.addItem('oak_planks', 2)
  bot.players['.Player Name'] = { entity: { position: new Vec3(2, 64, 0) } }
  bot.toss = async (type, metadata, count) => { item.count -= count }
  const result = await createActions(bot).execute('give', { player: '.Player Name', item: 'oak_planks', count: 1 })
  assert.equal(result.dropped_for, '.Player Name')
  assert.equal(item.count, 1)
})

test('combat rejects players before any attack', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, username: 'Friend', type: 'player', name: 'player', position: new Vec3(2, 64, 0) }
  let attacked = false
  bot.attack = () => { attacked = true }
  await assert.rejects(createActions(bot).execute('attack', { entity_id: 2, mob: null, duration: 1 }), /non-player mob/)
  assert.equal(attacked, false)
})

test('sleep refuses dimensions where beds explode', async () => {
  const bot = fakeBot()
  bot.game.dimension = 'the_nether'
  await assert.rejects(createActions(bot).execute('sleep', {}), /overworld/)
})

test('smelt refuses occupied furnace and leaves existing items alone', async () => {
  const bot = fakeBot()
  bot.addItem('raw_iron', 1)
  bot.addItem('coal', 1)
  bot.putBlock('furnace', new Vec3(2, 64, 0))
  let closed = false
  let transferred = false
  bot.openFurnace = async () => ({ inputItem: () => ({ name: 'raw_gold', count: 1 }), outputItem: () => null, fuelItem: () => null, close: () => { closed = true }, putInput: async () => { transferred = true } })
  await assert.rejects(createActions(bot).execute('smelt', { item: 'raw_iron', count: 1, fuel: null }), /occupied/)
  assert.equal(transferred, false)
  assert.equal(closed, true)
})

test('smelt synchronizes partial input/fuel stacks and verifies actual output transfer', async () => {
  const bot = fakeBot()
  bot.putBlock('furnace', new Vec3(2, 64, 0))
  const stack = (name, count) => ({ name, type: registry.itemsByName[name].id, metadata: 0, count, stackSize: 64 })
  const server = { slots: Array(39).fill(null), cursor: null }
  server.slots[3] = stack('sand', 3)
  server.slots[4] = stack('coal', 3)
  let closed = false
  let carried = server.slots.slice(3).filter(Boolean).map(item => ({ ...item }))
  const furnace = { slots: server.slots.map(item => item && { ...item }), selectedItem: null, inventoryStart: 3, inventoryEnd: 39, inputItem () { return this.slots[0] }, fuelItem () { return this.slots[1] }, outputItem () { return this.slots[2] }, close () { closed = true; carried = this.slots.slice(3).filter(Boolean).map(item => ({ ...item })) } }
  // Match Mineflayer: the open container owns inventory changes until close.
  bot.inventory.items = () => carried
  bot.openFurnace = async () => { closed = false; return furnace }
  furnace.putInput = furnace.putFuel = furnace.takeOutput = async () => { throw new Error('Native unsynchronized furnace transfer must not run') }
  const pending = []
  bot.clickWindow = async (slot, button) => { assert.equal(pending.length, 0); pending.push({ slot, button }) }
  bot._syncWindow = async () => {
    for (const { slot, button } of pending.splice(0)) {
      if (button === 1) {
        if (!server.slots[slot]) server.slots[slot] = { ...server.cursor, count: 0 }
        server.slots[slot].count++
        server.cursor.count--
        if (!server.cursor.count) server.cursor = null
      } else if (!server.cursor) { server.cursor = server.slots[slot]; server.slots[slot] = null }
      else if (!server.slots[slot]) { server.slots[slot] = server.cursor; server.cursor = null }
      else { assert.equal(server.slots[slot].type, server.cursor.type); server.slots[slot].count += server.cursor.count; server.cursor = null }
      if (server.slots[0]?.name === 'sand' && (server.slots[1]?.name === 'coal' || furnace.fuelSeconds >= 10)) { server.slots[2] = stack('glass', server.slots[0].count); server.slots[0] = null; server.slots[1] = null }
    }
    furnace.slots = server.slots.map(item => item && { ...item })
    furnace.selectedItem = server.cursor && { ...server.cursor }
  }
  const actions = createActions(bot)
  const result = await actions.execute('smelt', { item: 'sand', count: 2, fuel: 'coal' })
  assert.equal(result.smelted, 2)
  assert.equal(closed, true)
  assert.equal(server.cursor, null)
  assert.deepEqual(Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])), { sand: 1, coal: 2, glass: 2 })
  furnace.fuelSeconds = 60
  const again = await actions.execute('smelt', { item: 'sand', count: 1, fuel: null })
  assert.equal(again.fuel_added.count, 0)
  assert.equal(again.smelted, 1)
  assert.deepEqual(Object.fromEntries(bot.inventory.items().map(item => [item.name, item.count])), { coal: 2, glass: 3 })
})

test('use_item accepts existing yaw outside the negative-pi to pi interval', async () => {
  const bot = fakeBot()
  bot.entity.yaw = 5.5
  bot.heldItem = bot.addItem('bow')
  let yaw
  bot.look = async value => { yaw = value }
  bot.activateItem = () => {}
  const result = await createActions(bot).execute('use_item', { item: null, yaw: null, pitch: null, duration: 0 })
  assert.equal(result.used, 'bow')
  assert.ok(yaw >= -Math.PI && yaw <= Math.PI)
})

test('direct stop interrupts a held bow without releasing an unintended arrow', async () => {
  const bot = fakeBot()
  bot.heldItem = bot.addItem('bow')
  bot.quickBarSlot = 0
  let activated
  const began = new Promise(resolve => { activated = resolve })
  const operations = []
  bot.activateItem = () => { bot.usingHeldItem = true; activated() }
  bot.setQuickBarSlot = slot => { operations.push('slot'); bot.quickBarSlot = slot; bot.heldItem = null }
  bot.deactivateItem = () => { operations.push('release') }
  const actions = createActions(bot)
  const pending = actions.execute('use_item', { item: null, yaw: 0, pitch: 0, duration: 10 })
  await began
  actions.stop()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(operations[0], 'slot')
  assert.equal(operations[1], 'release')
})

test('block-face navigation measures elevated supports from player eyes and rejects obstructions', async () => {
  const { BlockFaceGoal, visibleBlockFace } = await import('../src/actions.js')
  const target = new Vec3(16, 68, -6)
  const observedEyes = []
  const world = { raycast: (eye, direction, range) => { assert.ok(range > 2 && range <= 4); assert.ok(Math.abs(direction.norm() - 1) < 0.00001); observedEyes.push(eye); return { position: target } } }
  const goal = new BlockFaceGoal(target, world, { eyeHeight: 1.62, reach: 4 })
  assert.equal(goal.isEnd(new Vec3(16, 65, -4)), true)
  assert.equal(observedEyes[0].y, 66.62)
  assert.equal(goal.isEnd(new Vec3(16, 59, -4)), false)
  assert.equal(visibleBlockFace({ raycast: () => ({ position: new Vec3(16, 66, -5) }) }, new Vec3(16.5, 66.62, -3.5), target, 4), false)
})

test('pickup refuses an item with no validated standing cell', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64.5, 0.5) }
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.putBlock('oak_log', new Vec3(2, 65, 0))
  let traveled = 0
  bot.pathfinder.setGoal = goal => { if (goal) traveled++ }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(traveled, 0)
  assert.equal(result.remaining_drops.length, 1)
  assert.ok(result.unreachable.every(f => /standing space/.test(f.error)))
})

test('pickup disappearance is not fabricated as inventory gain', async () => {
  const bot = fakeBot()
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64.5, 0.5) }
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal
    if (goal) { const target = bot.entities[2]; delete bot.entities[2]; bot.emit('entityGone', target) }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.deepEqual(result.inventory_changes, {})
  assert.deepEqual(result.remaining_drops, [])
  assert.equal(bot.listenerCount('entityGone'), 0)
})

test('collection considers level ground beyond the nearest 128 deep exposed targets', async () => {
  const bot = fakeBot()
  for (let i = 0; i < 160; i++) bot.putBlock('stone', new Vec3(3 + i % 10, 53 + Math.floor(i / 40), Math.floor(i / 10) % 4))
  const surface = new Vec3(25, 64, 0)
  bot.putBlock('stone', surface)
  for (const [x, z] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) bot.putBlock('dirt', surface.offset(x, -1, z))
  let firstApproach
  bot.pathfinder.getPathFromTo = function * (m, start, goal) {
    if (goal.target) firstApproach ??= goal.target
    const p = goal.target ? goal.target.offset(-1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  bot.dig = async block => { assert.ok(block.position.equals(surface)); bot.removeBlock(surface); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 })
  assert.ok(firstApproach.equals(surface))
  assert.equal(result.inventory_changes.cobblestone, 1)
})

test('craft rejects missing ingredients before traveling to a distant table', async () => {
  const bot = fakeBot()
  bot.putBlock('crafting_table', new Vec3(20, 64, 0))
  bot.recipesFor = () => []
  bot.pathfinder.goto = async () => { throw new Error('Must not travel without ingredients') }
  await assert.rejects(createActions(bot).execute('craft', { item: 'stone_pickaxe', count: 1 }), /missing ingredients/)
})

test('collection prefers supported drop landings over a closer ledge', async () => {
  const bot = fakeBot()
  const ledge = new Vec3(2, 64, 0)
  const supported = new Vec3(3, 64, 0)
  bot.putBlock('stone', ledge)
  bot.putBlock('stone', supported)
  for (const [x, z] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) bot.putBlock('dirt', supported.offset(x, -1, z))
  bot.dig = async block => { assert.ok(block.position.equals(supported)); bot.removeBlock(supported); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 8 })
  assert.equal(result.inventory_changes.cobblestone, 1)
})

test('craft checks prospective table recipes before placing a carried table', async () => {
  const bot = fakeBot()
  bot.addItem('crafting_table')
  bot.recipesFor = () => []
  bot.placeBlock = async () => { throw new Error('Must not place a table without ingredients') }
  await assert.rejects(createActions(bot).execute('craft', { item: 'stone_pickaxe', count: 1 }), /missing ingredients/)
  assert.equal(bot.inventory.items()[0].count, 1)
})

test('collection failure budget resets when a block is successfully harvested', async () => {
  const bot = fakeBot()
  // A successful harvest between two runs of four rejected candidates must
  // allow the second success, rather than stop at eight lifetime failures.
  const positions = Array.from({ length: 10 }, (_, i) => new Vec3(i + 1, 64, 0))
  positions.forEach(p => bot.putBlock('stone', p))
  bot.canDigBlock = block => [5, 10].includes(block.position.x)
  bot.dig = async block => { bot.removeBlock(block.position); bot.addItem('cobblestone') }
  bot.pathfinder.getPathFromTo = function * (m, start, goal) {
    const p = goal.target ? goal.target.offset(-1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 2, radius: 16 })
  assert.equal(result.mined, 2)
  assert.equal(result.failures.length, 8)
  assert.equal(result.inventory_changes.cobblestone, 2)
})

test('pickup can use a diagonal grass-covered landing without terrain modification', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.1, 64, 2.1) }
  const landing = new Vec3(1, 64, 1)
  bot.putBlock('stone', landing.offset(0, -1, 0))
  bot.putBlock('short_grass', landing, { boundingBox: 'empty' })
  let reached = false
  bot.pathfinder.setMovements = m => { assert.equal(m.canDig, false) }
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal
    if (goal) {
      assert.deepEqual([goal.x, goal.y, goal.z], [1, 64, 1]); reached = true
      const drop = bot.entities[2]; delete bot.entities[2]; bot.addItem('cobblestone'); bot.emit('playerCollect', bot.entity, drop)
    }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(reached, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
  assert.equal(result.remaining_drops.length, 0)
})

test('craft uses a carried table locally instead of traveling to a distant duplicate', async () => {
  const bot = fakeBot()
  bot.putBlock('crafting_table', new Vec3(20, 64, 0))
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('dirt',new Vec3(x,63,z))
  bot.addItem('crafting_table')
  const recipe = { requiresTable: true, result: { count: 1 } }
  bot.recipesFor = (id, meta, count, table) => table ? [recipe] : []
  bot.pathfinder.goto = async () => { throw new Error('Must not travel to a distant table when carrying one') }
  bot.craft = async (r, count, table) => {
    assert.ok(table.position.equals(new Vec3(-1, 64, -1)))
    bot.addItem('stone_pickaxe')
  }
  const result = await createActions(bot).execute('craft', { item: 'stone_pickaxe', count: 1 })
  assert.equal(result.crafted, 1)
  assert.equal(bot.blockAt(new Vec3(-1, 64, -1)).name, 'crafting_table')
})

test('pickup does not treat hazardous empty-collision blocks as standing space', async () => {
  for (const name of ['water', 'lava', 'fire', 'sweet_berry_bush', 'powder_snow']) {
    const bot = fakeBot()
    bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.5, 64, 0.5) }
    bot.putBlock('stone', new Vec3(2, 63, 0))
    bot.putBlock(name, new Vec3(2, 64, 0), { boundingBox: 'empty' })
    bot.pathfinder.setGoal = goal => { assert.equal(goal, null) }
    const result = await createActions(bot).execute('pickup', { radius: 8 })
    assert.equal(result.remaining_drops.length, 1)
  }
})

test('pickup aims at the drop rather than a nearer but out-of-reach standing cell', async () => {
  const bot = fakeBot()
  bot.entities[2] = { id: 2, name: 'item', position: new Vec3(2.9, 64, 0.5) }
  bot.putBlock('stone', new Vec3(1, 63, 0))
  bot.putBlock('stone', new Vec3(2, 63, 0))
  bot.pathfinder.setGoal = goal => {
    bot.pathfinder.goal = goal
    if (goal) {
      assert.deepEqual([goal.x, goal.y, goal.z], [2, 64, 0])
      const drop = bot.entities[2]; delete bot.entities[2]; bot.addItem('oak_log'); bot.emit('playerCollect', bot.entity, drop)
    }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(result.inventory_changes.oak_log, 1)
})

test('collection honors bounded caller exclusions before selecting a target', async () => {
  const bot = fakeBot(), skip = new Vec3(1, 64, 0), wanted = new Vec3(2, 64, 0);
  bot.putBlock('oak_log', skip); bot.putBlock('oak_log', wanted);
  bot.dig = async block => { assert.ok(block.position.equals(wanted)); bot.removeBlock(wanted); bot.addItem('oak_log'); };
  const result = await createActions(bot).execute('collect', { block: 'oak_log', count: 1, radius: 8, skip_positions: [{ x: 1, y: 64, z: 0 }] });
  assert.equal(result.inventory_changes.oak_log, 1);
  await assert.rejects(createActions(bot).execute('collect', { block: 'oak_log', count: 1, skip_positions: Array(129).fill({ x: 1, y: 64, z: 0 }) }), /at most 128/);
});

test('job movement boundary filters collection targets and constrains path nodes', async () => {
  const bot = fakeBot(); let movement;
  bot.pathfinder.setMovements = m => { movement = m; };
  const inside = new Vec3(2, 64, 0), outside = new Vec3(5, 64, 0);
  bot.putBlock('oak_log', outside); bot.putBlock('oak_log', inside);
  let boundary = { center: { x: 0.5, y: 64, z: 0.5 }, radius: 3 };
  const actions = createActions(bot, { movementBoundary: () => boundary });
  bot.dig = async b => { assert.ok(b.position.equals(inside)); bot.removeBlock(inside); bot.addItem('oak_log'); };
  await actions.execute('collect', { block: 'oak_log', count: 1, radius: 8 });
  await assert.rejects(actions.execute('go_to', { x: 5, y: 64, z: 0, radius: 0 }), /movement boundary/);
  await actions.execute('go_to', { x: 1, y: 64, z: 0, radius: 0 });
  assert.equal(movement.exclusionStep({ position: inside }), 0);
  assert.ok(movement.exclusionStep({ position: outside }) > 100);
  boundary = null;
  assert.equal(movement.exclusionStep({ position: outside }), 0);
});

test('mining protects support under the full player footprint at a block edge', async () => {
  const bot = fakeBot(); bot.entity.position = new Vec3(1.05, 65, 0.5);
  bot.putBlock('stone', new Vec3(0, 64, 0));
  bot.dig = async () => { throw new Error('Must not remove an overlapping support'); };
  await assert.rejects(createActions(bot).execute('dig_at', { x: 0, y: 64, z: 0 }), /supporting/);
});

test('targeted clearing refuses a block that no longer matches the observed type', async () => {
  const bot = fakeBot(); bot.putBlock('chest', new Vec3(2, 64, 0));
  let mined = false; bot.dig = async () => { mined = true; };
  await assert.rejects(createActions(bot).execute('dig_at', { x: 2, y: 64, z: 0, expected_block: 'stone' }), /changed/);
  assert.equal(mined, false);
});

test('return anchor permits a neighboring supported cell but never a two-block shortcut', async () => {
 const bot = fakeBot(); let plans = 0;
 bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
   plans++;
   if(plans === 2) {
     assert.equal(goal.isEnd({x:0,y:64,z:1}),true);
     assert.equal(goal.isEnd({x:0,y:64,z:2}),false);
     assert.equal(goal.isEnd({x:0,y:62,z:0}),false);
     yield {result:{status:'success',path:[{x:0,y:64,z:1}]}};
   } else yield {result:{status:'success',path:[{x:0,y:64,z:-4}]}};
 };
 const result = await createActions(bot).execute('explore',{direction:'north',distance:4,returnable:true});
 assert.equal(result.explored,true); assert.equal(plans,2);
});

test('wood collection prefers a reachable upper trunk over a distant supported tree base', async () => {
 const bot=fakeBot(),upper=new Vec3(1,66,0),distant=new Vec3(10,64,0);
 bot.putBlock('oak_log',upper);bot.putBlock('oak_log',distant);
 for(const [x,z]of [[0,0],[-1,0],[1,0],[0,-1],[0,1]])bot.putBlock('dirt',distant.offset(x,-1,z));
 bot.dig=async block=>{assert.ok(block.position.equals(upper));bot.removeBlock(upper);bot.addItem('oak_log');};
 const result=await createActions(bot).execute('collect',{block:'oak_log',count:1,radius:16});assert.equal(result.inventory_changes.oak_log,1);
});

test('nearby hostiles remain visible when dropped items crowd the observation cap',()=>{
 const bot=fakeBot();for(let id=2;id<40;id++)bot.entities[id]={id,name:'item',type:'other',position:new Vec3(0.6,64,0.6)};
 bot.entities[100]={id:100,name:'creeper',type:'hostile',position:new Vec3(5,64,0.5)};
 const state=createActions(bot).snapshot();assert.equal(state.entities.length,24);assert.equal(state.entities[0].id,100);assert.equal(state.entities[0].distance,4.5);
});

test('collection stops harvesting and pursuing when its shared planning budget is exhausted', async t => {
  const bot = fakeBot()
  let now = 0, plans = 0, digs = 0, pursuits = 0
  t.mock.method(performance, 'now', () => now)
  for (let x = 0; x < 8; x++) for (let z = -1; z <= 1; z++) bot.putBlock('dirt', new Vec3(x, 63, z))
  bot.putBlock('oak_log', new Vec3(2, 64, 0))
  bot.putBlock('oak_log', new Vec3(3, 64, 0))
  bot.dig = async block => {
    digs++; bot.removeBlock(block.position)
    bot.entities[99] = { id: 99, name: 'item', position: new Vec3(4.5, 64, .5) }
  }
  bot.pathfinder.getPathFromTo = function * () { plans++; now += 7100; yield { result: { status: 'partial', path: [] } } }
  bot.pathfinder.goto = async () => { pursuits++ }
  const result = await createActions(bot).execute('collect', { block: 'oak_log', count: 2, radius: 8 })
  assert.equal(digs, 1)
  assert.equal(plans, 1)
  assert.equal(pursuits, 0)
  assert.equal(result.completed, false)
  assert.equal(result.planning_limited, true)
  assert.equal(result.remaining_drops[0].id, 99)
  assert.equal(result.pickup_failures.length, 1)
  assert.equal(result.pickup_failures[0].code, 'COLLECTION_PLANNING_LIMIT')
  assert.deepEqual(result.inventory_changes, {})
})

test('pickup gives a farther item a turn before retrying the closest blocked item', async () => {
  const bot = fakeBot(), planned = []
  for (let x = 0; x < 8; x++) for (let z = -1; z <= 1; z++) bot.putBlock('dirt', new Vec3(x, 63, z))
  bot.entities[10] = { id: 10, name: 'item', position: new Vec3(2.5, 64, .5) }
  bot.entities[11] = { id: 11, name: 'item', position: new Vec3(5.5, 64, .5) }
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    const reverse = goal.x === 0
    if (reverse) planned.push(start.x)
    yield { result: { status: (reverse ? start.x : goal.x) === 2 ? 'noPath' : 'success', path: [{ x: goal.x, y: goal.y, z: goal.z }] } }
  }
  bot.pathfinder.goto = async goal => {
    bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5)
    if (goal.x === 5) { delete bot.entities[11]; bot.addItem('oak_log'); delete bot.entities[10] }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.deepEqual(planned.slice(0, 2), [2, 5])
  assert.equal(result.inventory_changes.oak_log, 1)
  assert.equal(result.planning_limited, false)
})

test('pickup stops on cumulative planning exhaustion after fairly rotating targets and cells', async t => {
  const bot = fakeBot(), planned = []
  let now = 0
  t.mock.method(performance, 'now', () => now)
  for (let x = 0; x < 8; x++) for (let z = -1; z <= 1; z++) bot.putBlock('dirt', new Vec3(x, 63, z))
  bot.entities[10] = { id: 10, name: 'item', position: new Vec3(2.5, 64, .5) }
  bot.entities[11] = { id: 11, name: 'item', position: new Vec3(5.5, 64, .5) }
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    planned.push([start.x, start.z]); now += 1601
    yield { result: { status: 'partial', path: [] } }
  }
  const result = await createActions(bot).execute('pickup', { radius: 8 })
  assert.equal(planned.length, 5)
  assert.deepEqual(result.unreachable.map(f => f.id), [10, 11, 10, 11, 10])
  assert.notDeepEqual(planned[0], planned[2])
  assert.notDeepEqual(planned[1], planned[3])
  assert.equal(result.planning_limited, true)
  assert.equal(result.unreachable.at(-1).code, 'COLLECTION_PLANNING_LIMIT')
  assert.equal(result.remaining_drops.length, 2)
  assert.deepEqual(result.inventory_changes, {})
})

test('mining refuses a waterlogged target even when surrounding blocks are dry', async () => {
  const bot = fakeBot()
  bot.putBlock('oak_leaves', new Vec3(2, 64, 0), { isWaterlogged: true })
  let dug = false
  bot.dig = async () => { dug = true }
  await assert.rejects(createActions(bot).execute('dig_at', { x: 2, y: 64, z: 0 }), /waterlogged/)
  assert.equal(dug, false)
})

test('scoped pickup ignores unrelated drops and an empty target list does not move', async () => {
  const bot = fakeBot(), pursued = []
  for (let x=0;x<8;x++) for(let z=-1;z<=1;z++) bot.putBlock('dirt',new Vec3(x,63,z))
  bot.entities[10] = { id:10, name:'item', position:new Vec3(2.5,64,.5) }
  bot.entities[11] = { id:11, name:'item', position:new Vec3(5.5,64,.5) }
  bot.pathfinder.goto = async goal => { pursued.push(goal.x); bot.entity.position = new Vec3(goal.x+.5,goal.y,goal.z+.5); delete bot.entities[11]; bot.addItem('cobblestone') }
  const actions = createActions(bot)
  const empty = await actions.execute('pickup', { radius:8, entity_ids:[] })
  assert.deepEqual(empty.remaining_drops,[]); assert.equal(pursued.length,0)
  const result = await actions.execute('pickup', { radius:8, entity_ids:[11] })
  assert.deepEqual(pursued,[5]); assert.equal(result.inventory_changes.cobblestone,1); assert.ok(bot.entities[10]); assert.deepEqual(result.remaining_drops,[])
  for (const entity_ids of ['all',[-1],[1.5],Array(65).fill(1)]) await assert.rejects(actions.execute('pickup',{entity_ids}),/valid item ids/)
})

test('starter movement avoids water while ordinary direct movement keeps its original policy', async () => {
  const bot=fakeBot();let bounded=true,movement;
  bot.pathfinder.setMovements=value=>{movement=value}
  const actions=createActions(bot,{movementBoundary:()=>bounded?{center:{x:0,y:64,z:0},radius:20}:null})
  await actions.execute('go_to',{x:2,y:64,z:0,radius:0})
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.water.id),true)
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.bubble_column.id),true)
  bounded=false
  await actions.execute('go_to',{x:3,y:64,z:0,radius:0})
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.water.id),false)
  assert.equal(movement.blocksToAvoid.has(registry.blocksByName.lava.id),true)
})

test('actual starter neighbor generation rejects water, aquatic plants and waterlogged standing cells', async () => {
  const {default:loadBlock}=await import('prismarine-block'),{default:Move}=await import('mineflayer-pathfinder/lib/move.js')
  const Block=loadBlock('1.21.11')
  for(const name of ['water','bubble_column','kelp','kelp_plant','seagrass','tall_seagrass','oak_sign']) {
    const bot=fakeBot();let bounded=true,movement
    bot.blockAt=p=>{const q=p.floored(),column=q.x===1&&q.z===0&&(q.y===64||q.y===65);const b=Block.fromStateId(registry.blocksByName[q.y===63?'stone':column?name:'air'].defaultState,0);b.position=q;if(column&&name==='oak_sign')b.isWaterlogged=true;return b}
    bot.pathfinder.setMovements=value=>{movement=value}
    const actions=createActions(bot,{movementBoundary:()=>bounded?{center:{x:0,y:64,z:0},radius:20}:null})
    await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
    const forward=()=>movement.getNeighbors(new Move(0,64,0,0,0)).some(p=>p.x===1&&p.y===64&&p.z===0)
    assert.equal(forward(),false,`${name} must not be a starter walking destination`)
    bounded=false;await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
    assert.equal(forward(),true,`${name} retains the original direct-command movement policy`)
  }
})

test('craft chooses a visible nearby table instead of a closer obstructed one', async () => {
  const bot=fakeBot(),hidden=new Vec3(1,64,0),visible=new Vec3(3,64,0)
  bot.putBlock('crafting_table',hidden);bot.putBlock('crafting_table',visible)
  bot.canSeeBlock=block=>!block.position.equals(hidden)
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[]
  bot.craft=async(recipe,count,table)=>{assert.ok(table.position.equals(visible));bot.addItem('wooden_pickaxe')}
  const result=await createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1})
  assert.equal(result.crafted,1)
})

test('craft places a carried table locally when the nearby existing table is obstructed', async () => {
  const bot=fakeBot(),hidden=new Vec3(2,64,0)
  bot.putBlock('crafting_table',hidden);bot.addItem('crafting_table')
  for(let x=-3;x<=3;x++)for(let z=-3;z<=3;z++)bot.putBlock('stone',new Vec3(x,63,z))
  bot.canSeeBlock=block=>!block.position.equals(hidden)
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[]
  bot.craft=async(recipe,count,table)=>{assert.ok(!table.position.equals(hidden));bot.addItem('wooden_pickaxe')}
  const result=await createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1})
  assert.equal(result.crafted,1)
})

test('pickup accepts zero-shape snow cover but refuses raised snow as an integer standing cell', async () => {
 for(const raised of [false,true]) {
  const bot=fakeBot();
  for(let x=1;x<=3;x++)for(let z=-1;z<=1;z++) {
   bot.putBlock('dirt',new Vec3(x,63,z));
   bot.putBlock('snow',new Vec3(x,64,z),{boundingBox:'empty',shapes:raised?[[0,0,0,1,.125,1]]:[]});
  }
  bot.entities[99]={id:99,name:'item',position:new Vec3(2.5,64,.5)};
  let walked=0;
  bot.pathfinder.goto=async goal=>{walked++;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);delete bot.entities[99];bot.addItem('cobblestone');};
  const result=await createActions(bot).execute('pickup',{radius:8,entity_ids:[99]});
  if(raised){assert.equal(walked,0);assert.deepEqual(result.inventory_changes,{});assert.equal(result.remaining_drops.length,1);}
  else{assert.equal(walked,1);assert.equal(result.inventory_changes.cobblestone,1);assert.equal(result.remaining_drops.length,0);}
 }
});

test('harvesting refuses an adjacent waterlogged block before digging',async()=>{
 const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('oak_log',p);bot.putBlock('oak_leaves',p.offset(1,0,0),{isWaterlogged:true});let dug=false;bot.dig=async()=>{dug=true;};
 await assert.rejects(createActions(bot).execute('dig_at',{x:p.x,y:p.y,z:p.z,expected_block:'oak_log'}),/adjacent liquid/);assert.equal(dug,false);
});

test('harvesting rejects water-bearing plants and bubble columns beside a target',async()=>{
 for(const name of ['kelp','kelp_plant','seagrass','tall_seagrass','bubble_column']) {
  const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('oak_log',p);bot.putBlock(name,p.offset(1,0,0),{isWaterlogged:false});let dug=false;bot.dig=async()=>{dug=true;};
  await assert.rejects(createActions(bot).execute('dig_at',{x:p.x,y:p.y,z:p.z,expected_block:'oak_log'}),/adjacent liquid/,name);assert.equal(dug,false,name);
 }
});

test('experimental descent refuses low health before touching terrain', async () => {
  const bot = fakeBot(); bot.health = 8;
  let digs = 0; bot.dig = async () => { digs++ };
  await assert.rejects(createActions(bot).execute('descend_notch', {}), /health 12/);
  assert.equal(digs, 0);
});

test('experimental descent refuses an ungrounded start without mining', async () => {
  const bot = fakeBot(); bot.food = 20; bot.entity.onGround = false;
  let digs = 0; bot.dig = async () => { digs++ };
  await assert.rejects(createActions(bot).execute('descend_notch', {}), /No certified/);
  assert.equal(digs, 0);
});

test('exploration alternatives certify before one move and report rejected directions', async () => {
  const bot=fakeBot();let moves=0;const go=bot.pathfinder.goto;
  bot.pathfinder.goto=async goal=>{moves++;return go(goal)};
  bot.pathfinder.getPathFromTo=function*(m,start,goal){yield{result:goal.z<0?{status:'noPath',path:[]}:{status:'success',path:[{x:goal.x,y:goal.y??64,z:goal.z}]}}};
  const result=await createActions(bot).execute('explore',{direction:'north',distance:12,returnable:true,alternatives:['east','south']});
  assert.equal(result.direction,'east');assert.deepEqual(result.directions_tried,['north','east']);assert.equal(moves,1);
  assert.equal(result.route_attempts[0].status,'unverified');
});
test('exploration cannot fall back after a partial physical walk fails', async () => {
  const bot=fakeBot();let moves=0;
  bot.pathfinder.goto=async()=>{moves++;bot.entity.position.x+=2;throw Error('Walking stalled')};
  await assert.rejects(createActions(bot).execute('explore',{direction:'north',distance:12,returnable:true,alternatives:['east']}),/Walking stalled/);
  assert.equal(moves,1);assert.equal(bot.entity.position.x,2.5);
});
test('exploration rejects malformed, duplicate or unguarded alternatives before movement', async () => {
  for(const args of [
    {direction:'north',returnable:false,alternatives:['east']},
    {direction:null,returnable:true,alternatives:['east']},
    {direction:'north',returnable:true,alternatives:['north']},
    {direction:'north',returnable:true,alternatives:['east','south','west','north']},
    {direction:'north',returnable:true,alternatives:['bogus']},
  ]){
    const bot=fakeBot();let moved=false;bot.pathfinder.goto=async()=>{moved=true};
    await assert.rejects(createActions(bot).execute('explore',{distance:12,...args}));assert.equal(moved,false);
  }
});
test('explicit returnable go_to rejects one-way route before movement', async () => {
  const bot=fakeBot();let plans=0,moved=false;
  bot.pathfinder.getPathFromTo=function*(m,start,goal){yield{result:++plans===1?{status:'success',path:[{x:goal.x,y:64,z:goal.z}]}:{status:'noPath',path:[]}}};
  bot.pathfinder.goto=async()=>{moved=true};
  await assert.rejects(createActions(bot).execute('go_to',{x:80,y:64,z:0,returnable:true}),/No verified returnable/);
  assert.equal(plans,2);assert.equal(moved,false);
});
test('verified long return leg remains bounded but is not cut off by the old15-second walk limit', async t => {
  let now=0;t.mock.method(performance,'now',()=>now);
  const bot=fakeBot();let release,started=false;
  bot.pathfinder.goto=goal=>new Promise(resolve=>{started=true;release=()=>{bot.entity.position=new Vec3(goal.x+0.5,goal.y,goal.z+0.5);resolve()}});
  const pending=createActions(bot).execute('go_to',{x:80,y:64,z:0,returnable:true});
  let finished=false;pending.then(()=>{finished=true},()=>{finished=true});
  while(!started)await new Promise(resolve=>setImmediate(resolve));
  now=20000;bot.entity.position.x=60;
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(finished,false);
  release();assert.equal((await pending).arrived,true);
});

test('starter neighbor generation refuses powder snow and restores direct movement policy', async () => {
  const {default:loadBlock}=await import('prismarine-block'),{default:Move}=await import('mineflayer-pathfinder/lib/move.js')
  const Block=loadBlock('1.21.11'),bot=fakeBot();let bounded=true,movement
  bot.blockAt=p=>{const q=p.floored(),column=q.x===1&&q.z===0&&(q.y===64||q.y===65);const b=Block.fromStateId(registry.blocksByName[q.y===63?'stone':column?'powder_snow':'air'].defaultState,0);b.position=q;return b}
  bot.pathfinder.setMovements=value=>{movement=value}
  const actions=createActions(bot,{movementBoundary:()=>bounded?{center:{x:0,y:64,z:0},radius:20}:null})
  await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
  const forward=()=>movement.getNeighbors(new Move(0,64,0,0,0)).some(p=>p.x===1&&p.y===64&&p.z===0)
  assert.equal(forward(),false,'starter must not walk into freezing powder snow')
  bounded=false;await actions.execute('go_to',{x:0,y:64,z:0,radius:0})
  assert.equal(forward(),true,'ordinary direct commands retain their existing policy')
})

test('a single explicit returnable scout reports failed probe evidence without moving', async () => {
  const bot=fakeBot();let moves=0;
  bot.pathfinder.goto=async()=>{moves++};
  bot.pathfinder.getPathFromTo=function*(){yield{result:{status:'noPath',path:[]}}};
  await assert.rejects(createActions(bot).execute('explore',{direction:'west',distance:64,returnable:true}),error=>{
    assert.deepEqual(error.result.directions_tried,['west']);
    assert.equal(error.result.route_attempts.length,1);
    assert.equal(error.result.route_attempts[0].status,'unverified');return true;
  });
  assert.equal(moves,0);
});

test('collection yields partial progress and remaining drops when pickup time is spent', async t => {
  const bot=fakeBot();let now=0,digs=0,pursuits=0;
  t.mock.method(performance,'now',()=>now);
  for(let x=0;x<8;x++)for(let z=-1;z<=1;z++)bot.putBlock('dirt',new Vec3(x,63,z));
  bot.putBlock('oak_log',new Vec3(2,64,0));bot.putBlock('oak_log',new Vec3(3,64,0));
  bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.addItem('oak_log');bot.entities[99]={id:99,name:'item',position:new Vec3(4.5,64,.5)}};
  bot.pathfinder.goto=async()=>{pursuits++;now+=8100};
  const actions=createActions(bot);
  const result=await actions.execute('collect',{block:'oak_log',count:2,radius:8});
  assert.equal(digs,1);assert.equal(pursuits,1);assert.equal(result.completed,false);
  assert.equal(result.pickup_limited,true);assert.equal(result.inventory_changes.oak_log,1);
  assert.deepEqual(result.remaining_drops.map(x=>x.id),[99]);
  assert.equal(bot.pathfinder.goal,null);
  bot.pathfinder.goto=async()=>{pursuits++;now+=100;delete bot.entities[99];bot.addItem('oak_log')};
  const next=await actions.execute('pickup',{radius:8,entity_ids:[99]});
  assert.equal(pursuits,2);assert.equal(next.pickup_limited,false);assert.equal(next.remaining_drops.length,0);
});

test('pickup allowance accumulates across multiple mining passes in one collection', async t => {
  const bot=fakeBot();let now=0,digs=0,pursuits=0;
  t.mock.method(performance,'now',()=>now);
  for(let x=0;x<8;x++)for(let z=-1;z<=1;z++)bot.putBlock('dirt',new Vec3(x,63,z));
  for(let x=2;x<=4;x++)bot.putBlock('oak_log',new Vec3(x,64,0));
  bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.entities[99]={id:99,name:'item',position:new Vec3(5.5,64,.5)}};
  bot.pathfinder.goto=async goal=>{pursuits++;bot.entity.position=new Vec3(goal.x+.5,goal.y??64,goal.z+.5);now+=4500;if(pursuits===1){delete bot.entities[99];bot.addItem('oak_log')}};
  const result=await createActions(bot).execute('collect',{block:'oak_log',count:3,radius:8});
  assert.equal(digs,2);assert.equal(pursuits,2);assert.equal(result.mined,2);
  assert.equal(result.completed,false);assert.equal(result.pickup_limited,true);
  assert.equal(result.inventory_changes.oak_log,1);assert.equal(result.remaining_drops[0].id,99);
});
test('cancelling pickup still rejects collection and cleans navigation rather than reporting success', async () => {
  const bot=fakeBot(),controller=new AbortController();let digs=0;
  for(let x=0;x<8;x++)for(let z=-1;z<=1;z++)bot.putBlock('dirt',new Vec3(x,63,z));
  bot.putBlock('oak_log',new Vec3(2,64,0));bot.putBlock('oak_log',new Vec3(3,64,0));
  bot.dig=async block=>{digs++;bot.removeBlock(block.position);bot.entities[99]={id:99,name:'item',position:new Vec3(5.5,64,.5)}};
  bot.pathfinder.goto=async()=>{controller.abort()};
  await assert.rejects(createActions(bot).execute('collect',{block:'oak_log',count:2,radius:8},controller.signal));
  assert.equal(digs,1);assert.equal(bot.pathfinder.goal,null);
  for(const event of ['entityGone','playerCollect','goal_reached','goal_updated','path_update'])assert.equal(bot.listenerCount(event),0,event);
});

test('collection discovers loaded diagonal-section stone within its original radius', async () => {
  const { realSectionSearch } = await import('./helpers/section-search.js')
  const bot = fakeBot()
  const target = new Vec3(-17, 64, -17)
  const block = bot.putBlock('stone', target)
  bot.findBlocks = realSectionSearch(bot, [block])
  assert.deepEqual(bot.findBlocks({ matching: block.type, maxDistance: 32, count: 512 }), [])
  bot.pathfinder.getPathFromTo = function * (movement, start, goal) {
    const p = goal.target ? goal.target.offset(1, 0, 0) : new Vec3(goal.x, goal.y, goal.z)
    yield { result: { status: 'success', path: [p] } }
  }
  bot.dig = async b => { assert.ok(b.position.equals(target)); bot.removeBlock(target); bot.addItem('cobblestone') }
  const result = await createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 })
  assert.equal(result.completed, true)
  assert.equal(result.inventory_changes.cobblestone, 1)
})

test('expanded section search still refuses resources outside the requested sphere', async () => {
  const { realSectionSearch } = await import('./helpers/section-search.js')
  const bot = fakeBot()
  const target = new Vec3(-25, 64, -25)
  const block = bot.putBlock('stone', target)
  bot.findBlocks = realSectionSearch(bot, [block])
  let moved = false
  bot.pathfinder.goto = async () => { moved = true }
  await assert.rejects(createActions(bot).execute('collect', { block: 'stone', count: 1, radius: 32 }), /Could not collect/)
  assert.equal(moved, false)
})

test('automatic workstation placement cancels during look without sending a placement', async () => {
  const bot=fakeBot(),controller=new AbortController();let placed=0;
  bot.addItem('crafting_table');
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('stone',new Vec3(x,63,z));
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[];
  bot.lookAt=async()=>{controller.abort()};
  bot._placeBlockWithOptions=async()=>{placed++};
  await assert.rejects(createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1},controller.signal),{name:'AbortError'});
  assert.equal(placed,0);assert.equal(bot.inventory.items().find(i=>i.name==='crafting_table').count,1);
});

test('automatic workstation rechecks terrain changed during its final look', async () => {
  const bot=fakeBot();let placed=0;
  bot.addItem('crafting_table');
  for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)bot.putBlock('stone',new Vec3(x,63,z));
  bot.recipesFor=(type,metadata,count,table)=>table?[{result:{count:1},requiresTable:true}]:[];
  bot.lookAt=async()=>{for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)if(x||z)bot.removeBlock(new Vec3(x,63,z))};
  bot._placeBlockWithOptions=async()=>{placed++};
  await assert.rejects(createActions(bot).execute('craft',{item:'wooden_pickaxe',count:1}),/No verified local exit/);
  assert.equal(placed,0);
});

function collectionPathFixture(bot) {
  bot.pathfinder.getPathFromTo = function * (movement,start,goal) {
    const p=goal.target ? goal.target.offset(-1,0,0) : new Vec3(goal.x,goal.y,goal.z)
    yield {result:{status:'success',path:[p]}}
  }
}
test('stationary mining vetoes do not starve a farther safe collection candidate',async()=>{
  const bot=fakeBot();collectionPathFixture(bot)
  for(const x of [2,3])for(const z of [-2,-1,0,1]){const p=new Vec3(x,64,z);bot.putBlock('stone',p);bot.putBlock('water',p.offset(0,1,0))}
  const safe=new Vec3(14,64,0);bot.putBlock('stone',safe)
  bot.dig=async block=>{assert.ok(block.position.equals(safe));bot.removeBlock(safe);bot.addItem('cobblestone')}
  const result=await createActions(bot).execute('collect',{block:'stone',count:1,radius:24})
  assert.equal(result.mined,1);assert.equal(result.failures.length,0)
})
test('collection rejects static hazards before walking and retries after their removal',async()=>{
  for(const hazard of ['waterlogged','liquid','falling','unloaded']){
    const bot=fakeBot(),p=new Vec3(12,64,0);collectionPathFixture(bot)
    bot.putBlock('stone',p,{isWaterlogged:hazard==='waterlogged'})
    if(hazard==='liquid')bot.putBlock('water',p.offset(0,1,0))
    if(hazard==='falling')bot.putBlock('gravel',p.offset(0,1,0))
    const original=bot.blockAt;let unloaded=hazard==='unloaded'
    bot.blockAt=q=>unloaded&&q.equals(p.offset(0,1,0))?null:original(q)
    let walks=0;const old=bot.pathfinder.getPathFromTo;bot.pathfinder.getPathFromTo=function*(...a){walks++;yield*old(...a)}
    const actions=createActions(bot);await assert.rejects(actions.execute('collect',{block:'stone',count:1,radius:24}),/Could not collect/)
    assert.equal(walks,0,`do not plan a route to ${hazard}`)
    unloaded=false;bot.putBlock('stone',p);bot.removeBlock(p.offset(0,1,0))
    bot.dig=async block=>{bot.removeBlock(block.position);bot.addItem('cobblestone')}
    assert.equal((await actions.execute('collect',{block:'stone',count:1,radius:24})).mined,1)
  }
})
test('fresh mining checks reject liquid appearing while equipping a tool',async()=>{
  const bot=fakeBot(),p=new Vec3(2,64,0);bot.putBlock('stone',p)
  const tool=bot.addItem('wooden_pickaxe');bot.pathfinder.bestHarvestTool=()=>tool
  bot.equip=async item=>{bot.heldItem=item;bot.putBlock('water',p.offset(0,1,0))}
  let dug=false;bot.dig=async()=>{dug=true;bot.removeBlock(p)}
  await assert.rejects(createActions(bot).execute('dig_at',{x:2,y:64,z:0}),/adjacent liquid/)
  assert.equal(dug,false)
})
test('real Mineflayer search filters unsafe resources before the 512-candidate cap',async()=>{
  const {realSectionSearch}=await import('./helpers/section-search.js')
  const bot=fakeBot();collectionPathFixture(bot);const stones=[]
  for(let x=2;x<=15;x++)for(let z=0;z<=15;z++)for(const y of [64,66,68]){
    const p=new Vec3(x,y,z);stones.push(bot.putBlock('stone',p));bot.putBlock('water',p.offset(0,1,0))
  }
  const safe=new Vec3(40,64,0);stones.push(bot.putBlock('stone',safe))
  bot.findBlocks=realSectionSearch(bot,stones)
  const unfiltered=bot.findBlocks({matching:registry.blocksByName.stone.id,maxDistance:64,count:512})
  assert.equal(unfiltered.length,512);assert.equal(unfiltered.some(p=>p.equals(safe)),false)
  bot.dig=async block=>{assert.ok(block.position.equals(safe));bot.removeBlock(safe);bot.addItem('cobblestone')}
  const result=await createActions(bot).execute('collect',{block:'stone',count:1,radius:64})
  assert.equal(result.mined,1);assert.equal(result.failures.length,0);assert.equal(result.search_limited,false)
})

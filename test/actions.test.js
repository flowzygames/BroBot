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
  bot.entity = { id: 1, position: new Vec3(0.5, 64, 0.5), yaw: 0, pitch: 0, height: 1.62, effects: {} }
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
  bot.putBlock('dirt', new Vec3(-1, 63, -1))
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
  assert.equal(movement.exclusionAreasStep.at(-1)({ position: inside }), 0);
  assert.ok(movement.exclusionAreasStep.at(-1)({ position: outside }) > 100);
  boundary = null;
  assert.equal(movement.exclusionAreasStep.at(-1)({ position: outside }), 0);
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

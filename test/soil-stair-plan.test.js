import { Vec3 } from 'vec3'
import test from 'node:test'
import assert from 'node:assert/strict'
import { planSoilStair } from '../src/experimental/soil-stair-plan.js'
import { soilWorld } from './helpers/soil-world.js'

test('saved-world fixture certifies a bounded forward stair without mutating the bot', async () => {
  const { bot, home, protectedPositions } = soilWorld()
  const position = bot.entity.position.clone(), movement = bot.pathfinder.movements
  const listeners = Object.fromEntries(bot.eventNames().map(name => [name, bot.listenerCount(name)]))
  bot.dig = () => assert.fail('read-only planner must not dig')
  bot.pathfinder.setGoal = () => assert.fail('read-only planner must not walk')
  const plan = await planSoilStair(bot, home, { protectedPositions, budgetMs: 2000 })
  assert.ok(plan)
  assert.equal(plan.experimental, true)
  assert.equal(plan.edits.length, 5)
  assert.deepEqual(plan.stage, [130.5, 63, 81.5])
  assert.deepEqual(plan.stone, [133, 60, 81])
  assert.ok(plan.edits.every(edit => edit.before.dependencies.length && edit.after.dependencies.length))
  assert.deepEqual(bot.entity.position, position)
  assert.equal(bot.pathfinder.movements, movement)
  assert.deepEqual(Object.fromEntries(bot.eventNames().map(name => [name, bot.listenerCount(name)])), listeners)
  for (const edit of plan.edits) assert.equal(bot.blockAt(new Vec3(...edit.target)).name, edit.expected.name)
})

for (const [name, mutate] of [
  ['missing pickaxe', ({ bot }) => { bot.inventory.items = () => [] }],
  ['invalid pickaxe count', ({ bot }) => { bot.inventory.items = () => [{ name: 'wooden_pickaxe', count: NaN }] }],
  ['low health', ({ bot }) => { bot.health = 11 }],
  ['invalid food', ({ bot }) => { bot.food = NaN }],
  ['unsupported version', ({ bot }) => { bot.version = '1.20.4' }],
  ['airborne pose', ({ bot }) => { bot.entity.onGround = false }],
  ['rising pose', ({ bot }) => { bot.entity.velocity.y = .1 }],
  ['nonstandard height', ({ bot }) => { bot.physics = { playerHeight: 3 } }],
  ['invalid width', ({ bot }) => { bot.physics = { playerHalfWidth: NaN } }],
  ['invalid eye height', ({ bot }) => { bot.entity.eyeHeight = NaN }],
  ['dig-enabled movement', ({ bot }) => { bot.pathfinder.movements.canDig = true }],
  ['parkour-enabled movement', ({ bot }) => { bot.pathfinder.movements.allowParkour = true }],
  ['missing origin floor', ({ overrides }) => { overrides.set('129,63,81', null) }],
  ['fluid-bearing origin floor', ({ overrides }) => { overrides.set('129,63,81', 'water') }]
]) test(`refuses ${name}`, async () => {
  const world = soilWorld(); mutate(world)
  assert.equal(await planSoilStair(world.bot, world.home, { protectedPositions: world.protectedPositions }), null)
})

for (const [name, mutation] of [
  ['plain-coordinate relevant block update', (bot, p) => bot.emit('blockUpdate', { position: { x: p.x, y: p.y, z: p.z } }, { position: p })],
  ['malformed block update', bot => bot.emit('blockUpdate', {}, {})],
  ['throwing block position getter', bot => bot.listeners('blockUpdate').at(-1)({ get position() { throw Error('bad geometry') } }, {})],
  ['relevant column unload', (bot, p) => bot.emit('chunkColumnUnload', new Vec3(Math.floor(p.x / 16) * 16, 0, Math.floor(p.z / 16) * 16))],
  ['away-and-back movement', bot => { const before = bot.entity.position; bot.entity.position = before.offset(1, 0, 0); bot.emit('move'); bot.entity.position = before }],
  ['movement classification mutation', bot => bot.pathfinder.movements.emptyBlocks.add(bot.registry.blocksByName.stone.id)],
  ['movement cost mutation', bot => { bot.pathfinder.movements.entityCost = 0 }],
  ['client replacement', bot => { bot._client = {} }]
]) test(`rejects reentrant ${name} and removes its listeners`, async () => {
  const { bot, home, protectedPositions } = soilWorld()
  const before = new Map(bot.eventNames().map(name => [name, bot.listeners(name)]))
  const read = bot.blockAt
  let mutated = false
  bot.blockAt = p => {
    const result = read(p)
    if (!mutated) { mutated = true; mutation(bot, p) }
    return result
  }
  assert.equal(await planSoilStair(bot, home, { protectedPositions, budgetMs: 2000 }), null)
  assert.deepEqual(new Map(bot.eventNames().map(name => [name, bot.listeners(name)])), before)
})

test('aborted planning propagates cancellation and cleans up', async () => {
  const { bot, home } = soilWorld(), controller = new AbortController()
  controller.abort(new Error('cancelled by owner'))
  const before = bot.listenerCount('blockUpdate')
  await assert.rejects(planSoilStair(bot, home, { signal: controller.signal }), /cancelled by owner/)
  assert.equal(bot.listenerCount('blockUpdate'), before)
})

test('malformed collision shapes fail closed', async () => {
  const { bot, home } = soilWorld(), read = bot.blockAt
  bot.blockAt = p => { const b = read(p); if (b) b.shapes = [null]; return b }
  assert.equal(await planSoilStair(bot, home), null)
})

test('protected support covering the forward stair is never proposed', async () => {
  const { bot, home, fixture } = soilWorld()
  // Cover every plausible edit in the small staging neighborhood. The planner
  // may refuse; it must never trade an existing standing surface for access.
  const protectedPositions = []
  for (let x = 126; x <= 134; x++) for (let z = 79; z <= 84; z++) protectedPositions.push(new Vec3(x + .5, 63, z + .5))
  const plan = await planSoilStair(bot, home, { protectedPositions, budgetMs: 2000 })
  if (plan) for (const edit of plan.edits) for (const p of protectedPositions) {
    const [x, y, z] = edit.target
    assert.ok(!(y < p.y && y + 1 >= p.y - .03 && p.x + .31 > x && p.x - .31 < x + 1 && p.z + .31 > z && p.z - .31 < z + 1))
  }
  assert.equal(fixture.source.kind, 'saved-world static snapshot, not live observations')
})

test('each edit proof describes only the hypothetical removals already applied', async () => {
  const { bot, home, protectedPositions } = soilWorld()
  const plan = await planSoilStair(bot, home, { protectedPositions, budgetMs: 2000 })
  assert.ok(plan)
  const removed = new Set()
  for (const edit of plan.edits) {
    for (const dependency of edit.before.dependencies) {
      const name = removed.has(dependency.position.join(',')) ? 'air' : bot.blockAt(new Vec3(...dependency.position)).name
      assert.equal(dependency.name, name)
    }
    removed.add(edit.target.join(','))
    for (const dependency of edit.after.dependencies) {
      const name = removed.has(dependency.position.join(',')) ? 'air' : bot.blockAt(new Vec3(...dependency.position)).name
      assert.equal(dependency.name, name)
    }
  }
})

test('malformed path results are refused', async () => {
  const { bot, home, protectedPositions } = soilWorld()
  bot.pathfinder.getPathFromTo = function* () { yield { result: { status: 'success', path: null } } }
  assert.equal(await planSoilStair(bot, home, { protectedPositions }), null)
})

test('expired planning budget leaves no listeners behind', async () => {
  const { bot, home } = soilWorld(), count = bot.listenerCount('blockUpdate')
  assert.equal(await planSoilStair(bot, home, { budgetMs: .000001 }), null)
  assert.equal(bot.listenerCount('blockUpdate'), count)
})

test('private start nodes avoid raw reads for hypothetical standing cells', async () => {
  const { bot, home, protectedPositions } = soilWorld(), original = bot.pathfinder.getPathFromTo
  let count = 0
  bot.pathfinder.getPathFromTo = function* (movement, from, goal, options) {
    assert.ok(options.startMove)
    assert.equal(options.startMove.x, Math.floor(from.x))
    assert.equal(options.startMove.y, Math.floor(from.y))
    assert.equal(options.startMove.z, Math.floor(from.z))
    count++
    yield* original(movement, from, goal, options)
  }
  assert.ok(await planSoilStair(bot, home, { protectedPositions, budgetMs: 2000 }))
  assert.ok(count > 10)
})

test('declared passable dropped-item motion does not invalidate terrain-only planning', async () => {
  const { bot, home, protectedPositions } = soilWorld({ flat: true }), read = bot.blockAt
  const item = { id: 77, name: 'item', position: new Vec3(1.5, 65, .5), width: .25, height: .25 }
  bot.entities[item.id] = item
  let emitted = false
  bot.blockAt = p => { const block = read(p); if (!emitted) { emitted = true; bot.emit('entityMoved', item) } return block }
  assert.ok(await planSoilStair(bot, home, { protectedPositions }))
})

for (const policy of ['not passable', 'explicitly avoided']) test(`item motion still invalidates when ${policy}`, async () => {
  const { bot, home } = soilWorld({ flat: true }), read = bot.blockAt
  const item = { id: 77, name: 'item', position: new Vec3(1.5, 65, .5), width: .25, height: .25 }
  bot.entities[item.id] = item
  if (policy === 'not passable') bot.pathfinder.movements.passableEntities.delete('item')
  else bot.pathfinder.movements.entitiesToAvoid.add('item')
  let emitted = false
  bot.blockAt = p => { const block = read(p); if (!emitted) { emitted = true; bot.emit('entityMoved', item) } return block }
  assert.equal(await planSoilStair(bot, home), null)
})

for (const moved of [false, true]) test(`own entity event preserves the existing exact pose guard, moved=${moved}`, async () => {
  const { bot, home } = soilWorld({ flat: true }), read = bot.blockAt
  let emitted = false
  bot.blockAt = p => {
    const block = read(p)
    if (!emitted) {
      emitted = true
      const original = bot.entity.position
      if (moved) bot.entity.position = original.offset(1, 0, 0)
      bot.emit('entityMoved', bot.entity)
      bot.entity.position = original
    }
    return block
  }
  const plan = await planSoilStair(bot, home)
  if (moved) assert.equal(plan, null)
  else assert.ok(plan)
})

for (const event of ['entityMoved', 'entityGone']) test(`unregistered item ${event} cannot bypass invalidation`, async () => {
  const { bot, home } = soilWorld({ flat: true }), read = bot.blockAt
  let emitted = false
  bot.blockAt = p => {
    const block = read(p)
    if (!emitted) { emitted = true; bot.emit(event, { id: 77, name: 'item', position: new Vec3(1, 65, 0) }) }
    return block
  }
  assert.equal(await planSoilStair(bot, home), null)
})

test('malformed registered item geometry fails closed without throwing through its event', async () => {
  const { bot, home } = soilWorld({ flat: true }), read = bot.blockAt
  const item = { id: 77, name: 'item', position: { get x() { throw Error('invalid geometry') } } }
  bot.entities[item.id] = item
  let emitted = false
  bot.blockAt = p => { const block = read(p); if (!emitted) { emitted = true; bot.emit('entityMoved', item) } return block }
  assert.equal(await planSoilStair(bot, home), null)
})

test('a transient malformed entity policy is latched instead of authorizing an ignored item', async () => {
  const { bot, home } = soilWorld({ flat: true }), read = bot.blockAt
  const item = { id: 77, name: 'item', position: new Vec3(1, 65, 0) }; bot.entities[item.id] = item
  let emitted = false
  bot.blockAt = p => {
    const block = read(p)
    if (!emitted) {
      emitted = true
      const saved = bot.pathfinder.movements.passableEntities
      bot.pathfinder.movements.passableEntities = null
      bot.emit('entityMoved', item)
      bot.pathfinder.movements.passableEntities = saved
    }
    return block
  }
  assert.equal(await planSoilStair(bot, home), null)
})

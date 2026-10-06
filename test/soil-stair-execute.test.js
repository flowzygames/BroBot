import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { executeSoilStair } from '../src/experimental/soil-stair-execute.js'
import { soilWorld } from './helpers/soil-world.js'

function fixture() {
  const world = soilWorld(), controller = new AbortController(), digs = [], walks = []
  world.bot.entity.velocity.y = -.0784 // Normal grounded prismarine-physics gravity/drag tail
  let owned = true
  const options = {
    bot: world.bot, home: world.home, signal: controller.signal,
    operationDeadline: performance.now() + 30000,
    ownershipGuard: () => owned,
    validatePolicy: () => true,
    protectedPositions: () => world.protectedPositions,
    halt: reason => controller.abort(reason),
    mine: async (target, expected, validate) => {
      validate()
      const before = world.bot.blockAt(target)
      assert.equal(before.name, expected)
      world.overrides.set(target.toArray().join(','), 'air')
      world.bot.emit('blockUpdate', before, world.bot.blockAt(target))
      digs.push(target.toArray())
      // A modeled stand-in for Actions.harvestBlock; this is not a raw receipt.
      return expected
    },
    walk: async (route, stage) => {
      assert.ok(route.length)
      walks.push(stage)
      world.bot.entity.position = new Vec3(...stage)
    }
  }
  return { ...world, controller, options, digs, walks, retire: () => { owned = false } }
}

test('private modeled executor makes five soil edits and two landings without mining stone', async () => {
  const f = fixture(), before = f.bot.listenerCount('blockUpdate')
  const result = await executeSoilStair(f.options)
  assert.equal(result.completed, true)
  assert.equal(result.confirmed_soil_edits, 5)
  assert.equal(result.verified_descents, 2)
  assert.equal(result.stone_mined, false)
  assert.equal(f.digs.length, 5)
  assert.equal(f.walks.length, 3)
  assert.equal(f.bot.blockAt(new Vec3(...result.exposed_stone)).name, 'stone')
  assert.equal(f.bot.listenerCount('blockUpdate'), before)
})

test('fresh protected footprint introduced after planning prevents the first dig', async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => { await walk(...args); f.protectedPositions.push(new Vec3(131.5, 63, 81.5)) }
  await assert.rejects(executeSoilStair(f.options), /protected support/)
  assert.equal(f.digs.length, 0)
})

test('private executor rejects a callback that reports arrival at the wrong height', async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => { await walk(...args); f.bot.entity.position.y++ }
  await assert.rejects(executeSoilStair(f.options), /did not settle/)
  assert.equal(f.digs.length, 0)
})

test('target replacement after approach prevents mining', async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => { await walk(...args); f.overrides.set('131,62,81', 'stone') }
  await assert.rejects(executeSoilStair(f.options), /dependency changed/)
  assert.equal(f.digs.length, 0)
})

test('owned cancellation after a confirmed hook preserves partial progress and removes watches', async () => {
  const f = fixture(), mine = f.options.mine, before = f.bot.listenerCount('blockUpdate')
  f.options.mine = async (...args) => { await mine(...args); f.controller.abort(Error('owner stopped')) }
  await assert.rejects(executeSoilStair(f.options), error => {
    assert.equal(error.result.confirmed_soil_edits, 1)
    assert.equal(error.result.completed, false)
    return /owner stopped/.test(error.message)
  })
  assert.equal(f.digs.length, 1)
  assert.equal(f.bot.listenerCount('blockUpdate'), before)
})

test('private executor tolerates its own item drop but stops an interfering entity', async () => {
  for (const name of ['item', 'zombie']) {
    const f = fixture(), mine = f.options.mine
    f.options.mine = async (...args) => { await mine(...args); f.bot.emit('entitySpawn', { id: 99, name }) }
    if (name === 'item') assert.equal((await executeSoilStair(f.options)).completed, true)
    else await assert.rejects(executeSoilStair(f.options), /Entity changed/)
  }
})

test('private executor loses authority after an approach handoff without digging', async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => { await walk(...args); f.retire() }
  await assert.rejects(executeSoilStair(f.options), /ownership changed/)
  assert.equal(f.digs.length, 0)
})

for (const mode of ['health', 'displacement', 'policy']) test(`operational monitor stops ${mode} change during an awaited modeled dig`, async () => {
  const f = fixture(); let policy = true, began = false
  f.options.validatePolicy = () => policy
  f.options.mine = async (target, expected, validate, signal) => {
    validate(); began = true
    if (mode === 'health') f.bot.health = 5
    else if (mode === 'displacement') f.bot.entity.position.x += 1
    else policy = false
    f.bot.emit('health')
    await new Promise(resolve => setTimeout(resolve, 20))
    signal.throwIfAborted()
  }
  await assert.rejects(executeSoilStair(f.options), /threshold|settled|policy/)
  assert.equal(began, true)
  assert.equal(f.digs.length, 0)
})

test('landing-only changed dependency is checked before the descent walk', async () => {
  const f = fixture(), mine = f.options.mine
  f.options.mine = async (...args) => {
    await mine(...args)
    if (f.digs.length === 1) f.overrides.set('130,60,81', 'air')
  }
  await assert.rejects(executeSoilStair(f.options), /dependency changed/)
  assert.equal(f.digs.length, 1)
  assert.equal(f.walks.length, 1)
})

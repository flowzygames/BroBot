import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { executeSoilStair } from '../src/experimental/soil-stair-execute.js'
import { planSoilStair } from '../src/experimental/soil-stair-plan.js'
import { soilWorld } from './helpers/soil-world.js'

function fixture() {
  const world = soilWorld({ flat: true }), controller = new AbortController(), digs = [], walks = []
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
  assert.equal(result.landing_observations.length, 2)
  assert.ok(result.landing_observations.every(sample => sample.onGround && sample.position[1] === sample.target[1]))
  assert.equal(result.stone_mined, false)
  assert.equal(f.digs.length, 5)
  assert.equal(f.walks.length, 4)
  assert.equal(f.bot.blockAt(new Vec3(...result.exposed_stone)).name, 'stone')
  assert.equal(f.bot.listenerCount('blockUpdate'), before)
})

test('fresh protected footprint introduced after planning prevents the first dig', async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => { await walk(...args); f.protectedPositions.push(new Vec3(1.5, 65, .5)) }
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
  f.options.walk = async (...args) => { await walk(...args); f.overrides.set('1,64,0', 'stone') }
  await assert.rejects(executeSoilStair(f.options), /dependency changed/)
  assert.equal(f.digs.length, 0)
})

for (const frozen of [false, true]) test(`owned cancellation retains partial progress, frozen=${frozen}`, async () => {
  const f = fixture(), mine = f.options.mine, before = f.bot.listenerCount('blockUpdate')
  f.options.mine = async (...args) => { await mine(...args); f.controller.abort(frozen ? Object.freeze(Error('owner stopped')) : Error('owner stopped')) }
  await assert.rejects(executeSoilStair(f.options), error => {
    assert.equal(error.result.confirmed_soil_edits, 1)
    assert.equal(error.result.unfinished_soil_target, null)
    assert.equal(error.result.completed, false)
    if (frozen) assert.equal(error.cause, f.controller.signal.reason)
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
  const plan = await planSoilStair(f.bot, f.home, { protectedPositions: f.protectedPositions })
  assert.ok(plan)
  const index = plan.edits.findIndex(edit => edit.landing && edit.landing.dependencies.some(cell => !edit.after.dependencies.some(other => other.position.join(',') === cell.position.join(','))))
  assert.ok(index >= 0, 'fixture must exercise a landing-only dependency')
  const edit = plan.edits[index]
  const extra = edit.landing.dependencies.find(cell => !edit.after.dependencies.some(other => other.position.join(',') === cell.position.join(',')))
  f.options.mine = async (...args) => {
    await mine(...args)
    if (f.digs.length === index + 1) f.overrides.set(extra.position.join(','), extra.name === 'air' ? 'stone' : 'air')
  }
  await assert.rejects(executeSoilStair(f.options), /dependency changed/)
  assert.equal(f.digs.length, index + 1)
  assert.equal(f.walks.length, 1 + plan.edits.slice(0, index).filter(edit => edit.landing).length)
})


test('final mining stage backs away from an offset second landing without weakening support guards', async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => {
    await walk(...args)
    if (f.walks.length === 3) f.bot.entity.position.x += .19999997
  }
  const result = await executeSoilStair(f.options)
  assert.equal(result.verified_descents, 2)
  assert.equal(result.confirmed_soil_edits, 5)
  assert.equal(result.mining_stage.onGround, true)
  assert.equal(result.mining_stage.position[1], result.exposed_stone[1] + 2)
  assert.equal(result.stone_mined, false)
})

for (const mode of ['cancel', 'owner', 'terrain', 'visibility']) test(`final climb ${mode} failure retains five edits without completed access`, async () => {
  const f = fixture(), walk = f.options.walk
  f.options.walk = async (...args) => {
    await walk(...args)
    if (f.walks.length !== 4) return
    if (mode === 'cancel') f.controller.abort(Error('cancel final climb'))
    if (mode === 'owner') f.retire()
    if (mode === 'terrain') f.overrides.set('1,63,0', 'air')
    if (mode === 'visibility') f.bot.world.raycast = () => null
  }
  await assert.rejects(executeSoilStair(f.options), error => {
    assert.equal(error.result.completed, false)
    assert.equal(error.result.confirmed_soil_edits, 5)
    assert.equal(error.result.verified_descents, 2)
    return true
  })
  assert.equal(f.digs.length, 5)
})

test('changed final-climb support after the fifth edit stops before the fourth walk', async () => {
  const f = fixture(), mine = f.options.mine
  f.options.mine = async (...args) => {
    await mine(...args)
    if (f.digs.length === 5) f.overrides.set('1,63,0', 'air')
  }
  await assert.rejects(executeSoilStair(f.options), error => {
    assert.equal(error.result.confirmed_soil_edits, 5)
    assert.equal(error.result.completed, false)
    return true
  })
  assert.equal(f.walks.length, 3)
})

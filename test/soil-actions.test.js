import test from 'node:test'
import assert from 'node:assert/strict'
import { soilActions } from './helpers/soil-actions.js'
import { terrainTrustStatus } from '../src/terrain-trust.js'

const until = async predicate => { const deadline = Date.now() + 4000; while (!predicate()) { assert.ok(Date.now() < deadline, 'fixture wait expired'); await new Promise(resolve => setImmediate(resolve)) } }

test('private facade runs real mining receipt protocol and preserves stone', async () => {
  const f = soilActions(), result = await f.run()
  assert.equal(result.confirmed_soil_edits, 5)
  assert.equal(result.verified_descents, 2)
  assert.equal(f.counters().digs, 5)
  assert.equal(result.stone_mined, false)
  assert.equal(terrainTrustStatus(f.bot).trusted, true)
  assert.equal(f.runner.active, null)
})

test('private facade refuses changed policy during final mining aim without digging', async () => {
  const f = soilActions()
  f.bot.lookAt = async () => { f.bot.pathfinder.movements.canDig = true }
  await assert.rejects(f.run(), /movement policy changed/)
  assert.equal(f.counters().digs, 0)
  assert.equal(terrainTrustStatus(f.bot).trusted, true)
})

test('private facade pathfinder takeover during aim survives outer and late cleanup', async () => {
  const f = soilActions(); let writes = 0
  f.bot.lookAt = async () => {
    f.bot.pathfinder = { setGoal() { writes++ }, movements: {} }
    f.bot.clearControlStates = () => { writes++ }
    f.bot.stopDigging = () => { writes++ }
  }
  await assert.rejects(f.run(), /ownership changed/)
  f.actions.stop()
  assert.equal(writes, 0)
  assert.equal(f.counters().digs, 0)
})

test('cancelling an attempted private dig quarantines terrain and retains the runner lock through drain', async () => {
  const f = soilActions(); let release, entered = false
  f.bot.dig = () => new Promise(resolve => { entered = true; release = resolve })
  const pending = f.run()
  await until(() => entered)
  f.runner.stop('owner cancelled fixture')
  assert.equal(terrainTrustStatus(f.bot).trusted, false)
  assert.ok(f.runner.active)
  await assert.rejects(f.runner.run('other', async () => {}), /Still stopping/)
  release()
  await assert.rejects(pending, error => {
    assert.match(error.message, /owner cancelled fixture/)
    assert.equal(error.result.confirmed_soil_edits, 0)
    assert.ok(error.result.unfinished_soil_target)
    assert.equal(error.result.terrain_trusted, false)
    return true
  })
  assert.equal(f.runner.active, null)
})

test('private facade jointly confirms a predictable thin-snow clearance without weakening terrain watching', async () => {
  const f = soilActions()
  f.overrides.set('3,65,0', 'snow')
  const result = await f.run()
  assert.equal(result.confirmed_soil_edits, 5)
  assert.equal(result.confirmed_dependent_clears, 1)
  assert.equal(result.verified_descents, 2)
  assert.equal(terrainTrustStatus(f.bot).trusted, true)
})

test('declared thin-snow clearance does not permit an unrelated terrain change', async () => {
  const f = soilActions(); f.overrides.set('3,65,0', 'snow')
  const dig = f.bot.dig
  f.bot.dig = async block => {
    await dig(block)
    const p = f.bot.entity.position.floored().offset(0, -1, 0), before = f.bot.blockAt(p)
    f.overrides.set(p.toArray().join(','), 'air')
    f.bot.emit('blockUpdate', before, f.bot.blockAt(p))
  }
  await assert.rejects(f.run(), /Observed soil route terrain changed/)
  assert.equal(terrainTrustStatus(f.bot).trusted, false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { soilActions } from './helpers/soil-actions.js'
import { planExposedStoneRemoval } from '../src/experimental/soil-stair-plan.js'
import { RETIRE_TEMPORARY_SOIL_LANDINGS, recordSoilExposure } from '../src/experimental/soil-exposure-record.js'

async function exposed() {
  const f = soilActions()
  f.bot.on('goal_reached', () => { if (f.bot.entity.position.x === 2.5 && f.bot.entity.position.y === 63) f.bot.entity.position.x += .19999997 })
  const result = await f.run()
  return { ...f, result }
}
const policy = { temporaryRetirement: RETIRE_TEMPORARY_SOIL_LANDINGS }

test('post-exposure removal defaults to retaining an actual overlapping private landing', async () => {
  const f = await exposed()
  assert.equal(await planExposedStoneRemoval(f.bot,f.result),null)
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,{temporaryRetirement:true}),null)
})

test('explicit private retirement certifies one named stone with fresh post-removal home and pickup routes', async () => {
  const f = await exposed(), before = f.counters().digs
  const proof = await planExposedStoneRemoval(f.bot,f.result,policy)
  assert.ok(proof)
  assert.equal(proof.readOnly,true)
  assert.deepEqual(proof.target,[3,62,0])
  assert.equal(proof.retiredTemporaryLandings.length,1)
  assert.deepEqual(proof.after.stage,proof.stage)
  assert.deepEqual(proof.pickup.routes.at(-1)[0],[1,64,0])
  assert.equal(f.counters().digs,before)
  assert.equal(f.bot.blockAt(new Vec3(...proof.target)).name,'stone')
})

test('external protection at the same temporary coordinate cannot be retired', async () => {
  const f = await exposed(), external = new Vec3(2.69999997,63,.5)
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,{...policy,protectedPositions:[external]}),null)
  assert.deepEqual(external.toArray(),[2.69999997,63,.5])
})

test('copied or JSON exposure cannot manufacture in-process provenance', async () => {
  const f = await exposed()
  for (const value of [{...f.result},JSON.parse(JSON.stringify(f.result)),{}]) assert.equal(await planExposedStoneRemoval(f.bot,value,policy),null)
})

test('post-exposure connection replacement refuses the old receipt', async () => {
  const f = await exposed(); f.bot._client = {}
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
})

test('a changed target or missing pickup support cannot be certified', async () => {
  for (const cell of ['3,62,0','3,61,0']) {
    const f = await exposed(); f.overrides.set(cell,'air')
    assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
  }
})

for (const velocity of [[.2,-.0784,0],[0,-2,0]]) test(`unsettled current velocity ${velocity} refuses removal proof`, async () => {
  const f = await exposed(); f.bot.entity.velocity = new Vec3(...velocity)
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
})

test('changed dimension refuses provenance even if object identities remain', async () => {
  const f = await exposed(); f.bot.game.dimension = 'the_nether'
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
})

test('counterfactual route failure refuses despite successful pre-removal routes', async () => {
  const f = await exposed(), search = f.bot.pathfinder.getPathFromTo
  let before = 0, after = 0
  f.bot.pathfinder.getPathFromTo = function* (movement,...args) {
    if (movement.bot.blockAt(new Vec3(3,62,0)).name === 'air') { after++; yield {result:{status:'noPath',path:[]}}; return }
    before++; yield* search.call(this,movement,...args)
  }
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
  assert.ok(before > 0 && after > 0)
})

test('external protection introduced while planning invalidates the proposed proof', async () => {
  const f = await exposed(), search = f.bot.pathfinder.getPathFromTo, protectedPositions = []
  f.bot.pathfinder.getPathFromTo = function* (...args) {
    protectedPositions.push(new Vec3(2.69999997,63,.5))
    yield* search.apply(this,args)
  }
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,{...policy,protectedPositions}),null)
})

test('mutating public exposure fields cannot retarget or erase private provenance', async () => {
  const f = await exposed()
  f.result.exposed_stone = [10,62,0]; f.result.landing_observations.length = 0
  assert.equal(await planExposedStoneRemoval(f.bot,f.result),null)
  const proof = await planExposedStoneRemoval(f.bot,f.result,policy)
  assert.deepEqual(proof.target,[3,62,0])
  const target = cell => cell.position.join(',') === '3,62,0'
  assert.equal(proof.before.dependencies.find(target).name,'stone')
  assert.equal(proof.after.dependencies.find(target).name,'air')
  assert.equal(proof.pickup.dependencies.find(target).name,'air')
})

for (const event of ['spawn','respawn','end','terrainUntrusted']) test(`between-call ${event} revokes receipt even with unchanged identities`, async () => {
  const f = await exposed(); f.bot.emit(event)
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
})

test('external protection seen during excavation survives later callback removal', async () => {
  const f = soilActions(), point = new Vec3(2.69999997,63,.5)
  f.bot.on('goal_reached', () => {
    if (f.bot.entity.position.x === 2.5 && f.bot.entity.position.y === 63) f.protectedPositions.push(point)
    if (f.bot.entity.position.x === 1.5 && f.bot.entity.position.y === 64) {
      const i=f.protectedPositions.indexOf(point); if(i>=0) f.protectedPositions.splice(i,1)
    }
  })
  const result = await f.run()
  assert.ok(!f.protectedPositions.includes(point))
  assert.equal(await planExposedStoneRemoval(f.bot,result,policy),null)
})

test('current physical support and exhausted planning budget refuse certification', async () => {
  const f = await exposed()
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,{...policy,budgetMs:0}),null)
  f.bot.entity.position = new Vec3(3.5,63,.5)
  assert.equal(await planExposedStoneRemoval(f.bot,f.result,policy),null)
})

test('cancellation propagates without a certificate or leftover planning listeners', async () => {
  const f = await exposed(), controller = new AbortController(), before = f.bot.listenerCount('blockUpdate')
  controller.abort(Error('cancel removal proof'))
  await assert.rejects(planExposedStoneRemoval(f.bot,f.result,{...policy,signal:controller.signal}),/cancel removal proof/)
  assert.equal(f.bot.listenerCount('blockUpdate'),before)
})


test('repeated successful exposure records do not multiply epoch listeners', async () => {
  const f = await exposed(), events = ['spawn','respawn','end','terrainUntrusted']
  const before = events.map(event => f.bot.listenerCount(event))
  for (let i=0;i<20;i++) recordSoilExposure({exposed_stone:[3,62,0]}, {
    bot:f.bot, origin:[.5,65,.5], home:f.home.toArray(), protectedPositions:[], temporaryLandings:[]
  })
  assert.deepEqual(events.map(event => f.bot.listenerCount(event)),before)
})

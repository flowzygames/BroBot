import test from 'node:test'
import assert from 'node:assert/strict'
import { ownOxygenLevel } from '../src/oxygen.js'

test('modern oxygen comes from our entity, never another mob changing the shared field', () => {
  const bot={registry:{entitiesByName:{player:{metadataKeys:['flags','air_supply']}}},entity:{id:1,name:'player',metadata:{1:300}},oxygenLevel:0}
  assert.equal(ownOxygenLevel(bot),20)
  bot.entity.metadata[1]=60;bot.oxygenLevel=20
  assert.equal(ownOxygenLevel(bot),4)
  delete bot.entity.metadata[1];assert.equal(ownOxygenLevel(bot),null)
})
test('legacy oxygen retains self-filtered breath handling and unknown values remain unknown', () => {
  assert.equal(ownOxygenLevel({oxygenLevel:12}),12)
  assert.equal(ownOxygenLevel({}),null)
  assert.equal(ownOxygenLevel({oxygenLevel:NaN}),null)
})

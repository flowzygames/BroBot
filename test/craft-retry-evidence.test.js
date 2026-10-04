import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { craftGeometryKey } from '../src/craft-retry-evidence.js';

function fixture() {
  const blocks = new Map();
  const bot = { entity:{position:new Vec3(.5,64,.5)}, game:{dimension:'overworld'}, blockAt:p=>blocks.get(p.toString())??{name:'air',stateId:0,boundingBox:'empty',shapes:[]} };
  return {bot,blocks};
}
test('craft retry geometry ignores distant terrain but retains local block-state changes',()=>{
  const {bot,blocks}=fixture(), original=craftGeometryKey(bot);
  blocks.set(new Vec3(100,64,0).toString(),{name:'stone',stateId:1,boundingBox:'block'});
  assert.equal(craftGeometryKey(bot),original);
  blocks.set(new Vec3(7,64,0).toString(),{name:'oak_trapdoor',stateId:10,boundingBox:'block'});
  const closed=craftGeometryKey(bot);assert.notEqual(closed,original);
  blocks.set(new Vec3(7,64,0).toString(),{name:'oak_trapdoor',stateId:11,boundingBox:'block'});
  assert.notEqual(craftGeometryKey(bot),closed);
});
test('unknown-to-loaded craft geometry changes and read failures remain bounded hints',()=>{
  const {bot}=fixture();bot.blockAt=()=>null;
  const unknown=craftGeometryKey(bot);bot.blockAt=()=>{throw Error('unavailable')};assert.equal(craftGeometryKey(bot),unknown);
  bot.blockAt=()=>({name:'air',stateId:0,boundingBox:'empty',shapes:[]});assert.notEqual(craftGeometryKey(bot),unknown);
  bot.entity.position.x=NaN;assert.equal(craftGeometryKey(bot),null);
});

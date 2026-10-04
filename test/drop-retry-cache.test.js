import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {DropRetryCache} from '../src/drop-retry-cache.js';
function fixture(){let now=0;const terrain=new Map(),bot={game:{dimension:'overworld'},entity:{position:new Vec3(.5,64,.5)},blockAt:p=>terrain.get(p.toString())??{name:'air',stateId:0}},item={id:7,name:'item',position:new Vec3(3.5,64,.5)},cache=new DropRetryCache(bot,{now:()=>now});return{bot,item,cache,terrain,setTime:n=>{now=n}}}
function failThree(f){for(let i=0;i<3;i++)f.cache.failed(f.item,'job/1','No path')}
test('three failed starter attempts defer unchanged drops while explicit pickup bypasses cache',()=>{
 const f=fixture();failThree(f);assert.equal(f.cache.deferred(f.item,'job/1').failures,3);assert.equal(f.cache.deferred(f.item,undefined),null);assert.ok(f.cache.deferred(f.item,'job/1'));
});
test('meaningful displacement, observed nearby terrain, new identity and dimension release a deferral',()=>{
 for(const change of ['bot','item','terrain','identity','dimension']){
  const f=fixture();failThree(f);if(change==='bot')f.bot.entity.position.x+=4;if(change==='item')f.item.position.x+=1;if(change==='terrain')f.terrain.set(new Vec3(3,63,0).toString(),{name:'dirt',stateId:10});if(change==='identity')f.item={...f.item};if(change==='dimension')f.bot.game.dimension='the_nether';
  assert.equal(f.cache.deferred(f.item,'job/1'),null,change);
 }
});
test('small movement retains original observation anchors and unrelated inventory cannot reset deferral',()=>{
 const f=fixture();f.cache.failed(f.item,'job/1','No path');f.bot.entity.position.x+=1;f.cache.failed(f.item,'job/1','No path');f.bot.entity.position.x+=1;f.cache.failed(f.item,'job/1','No path');
 f.bot.inventory={items:()=>[{name:'cobblestone',count:1}]};assert.ok(f.cache.deferred(f.item,'job/1'));f.bot.entity.position.x+=2;assert.equal(f.cache.deferred(f.item,'job/1'),null);
});
test('deferrals expire, reset on new job/session and clear after verified success',()=>{
 for(const change of ['time','scope','success']){const f=fixture();failThree(f);if(change==='time')f.setTime(30000);if(change==='success')f.cache.succeeded(f.item,'job/1');assert.equal(f.cache.deferred(f.item,change==='scope'?'job/2':'job/1'),null)}
});
test('cache stays bounded and malformed position cannot create a deferral',()=>{
 const f=fixture();for(let id=0;id<150;id++)f.cache.failed({...f.item,id},'job/1','No path');assert.equal(f.cache.records.size,128);f.item.position.x=NaN;f.cache.failed(f.item,'job/1','No path');assert.equal(f.cache.deferred(f.item,'job/1'),null);
});
test('world-read failures make the optimization a cache miss instead of throwing',()=>{
 const f=fixture();failThree(f);f.bot.blockAt=()=>{throw Error('unavailable')};assert.doesNotThrow(()=>f.cache.failed(f.item,'job/1','No path'));assert.equal(f.cache.deferred(f.item,'job/1'),null);
});

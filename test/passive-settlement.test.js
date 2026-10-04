import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import {awaitPassiveLanding} from '../src/passive-settlement.js';
function fixture(){let time=0;const bot=new EventEmitter(),blocks=new Map();Object.assign(bot,{entity:{position:new Vec3(.5,64.5,.5),velocity:new Vec3(0,-.4,0),onGround:false},pathfinder:{goal:null},blockAt:p=>blocks.has(p.toString())?blocks.get(p.toString()):{name:'air'}});return{bot,blocks,now:()=>time,setTime:n=>{time=n}}}
test('passive settling requires two fresh dry grounded physics samples and never mutates controls',async()=>{
 const f=fixture();f.bot.setControlState=f.bot.clearControlStates=f.bot.pathfinder.setGoal=()=>{throw Error('must not steer')};
 const pending=awaitPassiveLanding(f.bot,{deadline:500,now:f.now});f.bot.entity.onGround=true;f.bot.entity.velocity.y=0;
 f.bot.emit('physicsTick');assert.equal(f.bot.listenerCount('physicsTick'),1);f.bot.emit('physicsTick');assert.equal(await pending,true);assert.equal(f.bot.listenerCount('physicsTick'),0);
});
test('late grounding loses to the deadline and a single sample cannot complete',async()=>{
 const f=fixture(),pending=awaitPassiveLanding(f.bot,{deadline:500,now:f.now});f.bot.entity.onGround=true;f.bot.emit('physicsTick');f.setTime(500);f.bot.emit('physicsTick');assert.equal(await pending,false);
});
test('fluids, unknown body cells and later hazards reject passive settlement',async()=>{
 for(const block of [null,{name:'lava'},{name:'water'},{name:'powder_snow'}]){const f=fixture();f.blocks.set(new Vec3(0,64,0).toString(),block);assert.equal(await awaitPassiveLanding(f.bot,{deadline:500,now:f.now}),false)}
 const f=fixture(),pending=awaitPassiveLanding(f.bot,{deadline:500,now:f.now});f.blocks.set(new Vec3(0,64,0).toString(),{name:'water'});f.bot.emit('physicsTick');assert.equal(await pending,false);
});
test('cancellation and replacement goals stop observation without clearing their owner',async()=>{
 const f=fixture(),controller=new AbortController(),pending=awaitPassiveLanding(f.bot,{signal:controller.signal,deadline:500,now:f.now});controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(f.bot.listenerCount('physicsTick'),0);
 const g=fixture(),goal={x:4},p=awaitPassiveLanding(g.bot,{deadline:500,now:g.now});g.bot.pathfinder.goal=goal;g.bot.emit('goal_updated',goal);assert.equal(await p,false);assert.equal(g.bot.pathfinder.goal,goal);
});
test('exhausted or oversized reserve, rising motion and ongoing fall never claim settlement',async()=>{
 const f=fixture();assert.equal(await awaitPassiveLanding(f.bot,{deadline:0,now:f.now}),false);assert.equal(await awaitPassiveLanding(f.bot,{deadline:501,now:f.now}),false);
 f.bot.entity.velocity.y=.2;assert.equal(await awaitPassiveLanding(f.bot,{deadline:500,now:f.now}),false);f.bot.entity.velocity.y=-.4;
 const p=awaitPassiveLanding(f.bot,{deadline:500,now:f.now});f.setTime(500);f.bot.emit('physicsTick');assert.equal(await p,false);
});
test('failed world reads reject settling without throwing from a physics listener',async()=>{
 const f=fixture(),p=awaitPassiveLanding(f.bot,{deadline:500,now:f.now});f.bot.blockAt=()=>{throw Error('chunk read failed')};assert.doesNotThrow(()=>f.bot.emit('physicsTick'));assert.equal(await p,false);assert.equal(f.bot.listenerCount('physicsTick'),0);
 assert.equal(await awaitPassiveLanding(f.bot,{deadline:500,now:f.now}),false);
});
test('slow world reads cannot certify grounding after the absolute deadline',async()=>{
 const f=fixture(),read=f.bot.blockAt,p=awaitPassiveLanding(f.bot,{deadline:500,now:f.now});f.bot.entity.onGround=true;f.bot.entity.velocity.y=0;f.bot.emit('physicsTick');
 f.bot.blockAt=position=>{f.setTime(500);return read(position)};f.bot.emit('physicsTick');assert.equal(await p,false);
 const g=fixture(),get=g.bot.blockAt;g.bot.blockAt=position=>{g.setTime(500);return get(position)};assert.equal(await awaitPassiveLanding(g.bot,{deadline:500,now:g.now}),false);assert.equal(g.bot.listenerCount('physicsTick'),0);
});

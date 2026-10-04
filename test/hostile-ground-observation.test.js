import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { observeGroundForRetreat } from '../src/hostile-ground-observation.js';
function fixture(){
 const bot=Object.assign(new EventEmitter(),{entity:{position:new Vec3(.5,64,.5),velocity:new Vec3(0,0,0),onGround:true},pathfinder:{goal:null},getControlState:()=>false,blockAt:p=>({name:p.y===63?'stone':'air',boundingBox:p.y===63?'block':'empty',shapes:p.y===63?[[0,0,0,1,1,1]]:[],position:p})});
 return bot;
}
const next=()=>new Promise(r=>setTimeout(r,5));
async function tick(bot,{ground=true,vy=0}={}){bot.entity.onGround=ground;bot.entity.velocity.y=vy;bot.emit('physicsTick');await next();}
const clean=bot=>{assert.equal(bot.listenerCount('physicsTick'),0);assert.equal(bot.listenerCount('goal_updated'),0);};
test('fresh ground flags over observed air do not establish a recovery floor',async()=>{
 const bot=fixture();bot.blockAt=p=>({name:'air',boundingBox:'empty',shapes:[],position:p});
 const pending=observeGroundForRetreat(bot,{deadline:performance.now()+500});await tick(bot);assert.equal(await pending,false);clean(bot);
});
test('recovery ground observation requires a quiet window and spaced grounded samples',async()=>{
 let now=0;const bot=fixture(),pending=observeGroundForRetreat(bot,{deadline:500,now:()=>now});let done=false;pending.then(()=>{done=true});
 await tick(bot);await tick(bot);assert.equal(done,false);
 now=150;await tick(bot);await tick(bot);assert.equal(done,false);
 now=190;await tick(bot);assert.equal(await pending,true);clean(bot);
});
test('grounded catch-up ticks before delayed knockback cannot start retreat',async()=>{
 let now=0;const bot=fixture(),pending=observeGroundForRetreat(bot,{deadline:900,now:()=>now});let done=false;pending.then(()=>{done=true});
 await tick(bot);now=20;await tick(bot);assert.equal(done,false);
 now=60;await tick(bot,{ground:false,vy:.3});assert.equal(done,false);
 now=350;await tick(bot,{ground:false,vy:-.2});now=400;await tick(bot);now=450;await tick(bot);
 assert.equal(await pending,true);clean(bot);
});
test('recovery passively observes rising knockback then uses descending settlement',async()=>{
 const bot=fixture();bot.entity.onGround=false;bot.entity.velocity.y=.4;
 const pending=observeGroundForRetreat(bot,{deadline:performance.now()+900});
 await tick(bot,{ground:false,vy:.2});await tick(bot,{ground:false,vy:-.2});await tick(bot);await tick(bot);
 assert.equal(await pending,true);clean(bot);
});
test('renewed ascent after descent and absent fresh ticks never certify recovery ground',async()=>{
 const bot=fixture();bot.entity.onGround=false;bot.entity.velocity.y=-.2;
 const pending=observeGroundForRetreat(bot,{deadline:performance.now()+500});
 await tick(bot,{ground:false,vy:-.2});await tick(bot,{ground:false,vy:.2});assert.equal(await pending,false);clean(bot);
 assert.equal(await observeGroundForRetreat(bot,{deadline:performance.now()+20}),false);clean(bot);
});
test('recovery ground observation rejects another movement owner and invalid observations',async()=>{
 for(const mutate of [b=>{b.pathfinder.goal={};},b=>{b.getControlState=()=>true;},b=>{b.entity.velocity.y=NaN;},b=>{b.blockAt=()=>null;}]){
  const bot=fixture();mutate(bot);await assert.rejects(observeGroundForRetreat(bot,{deadline:performance.now()+500}));clean(bot);
 }
});
test('recovery ground observation rechecks safety and cleans up on cancellation',async()=>{
 const bot=fixture(),controller=new AbortController();const pending=observeGroundForRetreat(bot,{signal:controller.signal,deadline:performance.now()+500});
 controller.abort();await assert.rejects(pending,{name:'AbortError'});clean(bot);
 let safe=true;const guarded=observeGroundForRetreat(bot,{deadline:performance.now()+500,check:()=>{if(!safe)throw Error('health changed');}});
 safe=false;const rejected=assert.rejects(guarded,/health changed/);bot.emit('physicsTick');await rejected;clean(bot);
});
test('grounded detached leaves and stale grounded flags with upward velocity are not certified',async()=>{
 const bot=fixture();bot.blockAt=p=>({name:p.y===63?'oak_leaves':'air',boundingBox:p.y===63?'block':'empty',shapes:p.y===63?[[0,0,0,1,1,1]]:[],position:p});
 const pending=observeGroundForRetreat(bot,{deadline:performance.now()+500});await tick(bot);assert.equal(await pending,false);clean(bot);
 const other=fixture();other.entity.velocity.y=.3;
 const stale=observeGroundForRetreat(other,{deadline:performance.now()+30});await tick(other,{ground:true,vy:.3});assert.equal(await stale,false);clean(other);
});

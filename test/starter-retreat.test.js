import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { createActions } from '../src/actions.js';
import { recoveryStandingSpace } from '../src/starter-retreat.js';

function fixture(){
 const registry=minecraftData('1.21.8'),bot=new EventEmitter();
 Object.assign(bot,{version:'1.21.8',registry,_client:new EventEmitter(),health:20,food:20,game:{dimension:'overworld',minY:-64,height:384},entity:{id:1,position:new Vec3(.5,64,.5),velocity:new Vec3(0,0,0),onGround:true,effects:{}},inventory:{items:()=>[],slots:[]},players:{},clearControlStates(){},getControlState:()=>false,setControlState(){},stopDigging(){},deactivateItem(){}});
 bot.entities={1:bot.entity,22:{id:22,name:'zombie',type:'hostile',position:new Vec3(1.5,64,.5),width:.6,height:1.95}};
 bot.blockAt=p=>{const q=p.floored(),solid=q.y===63&&Math.abs(q.x)<=8&&Math.abs(q.z)<=8;return{name:solid?'stone':'air',type:registry.blocksByName[solid?'stone':'air'].id,position:q,boundingBox:solid?'block':'empty',shapes:solid?[[0,0,0,1,1,1]]:[]};};
 let moves=0;
 bot.pathfinder={goal:null,movements:null,setMovements(m){this.movements=m;},getPathFromTo:function*(m,start,goal){
  const path=[];let x=Math.floor(start.x),z=Math.floor(start.z);
  while(x!==goal.x){x+=Math.sign(goal.x-x);path.push(new Vec3(x,goal.y,z));}
  while(z!==goal.z){z+=Math.sign(goal.z-z);path.push(new Vec3(x,goal.y,z));}
  yield{result:{status:'success',path}};
 },setGoal(goal){this.goal=goal;bot.emit('goal_updated',goal);if(goal){moves++;queueMicrotask(()=>{if(this.goal!==goal)return;bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);bot.emit('goal_reached',goal);});}}};
 const home=new Vec3(.5,64,.5),actions=createActions(bot,{movementBoundary:()=>({center:home,radius:256})});
 const run=(overrides={},signal)=>actions.retreatFromHostile({sourceId:22,home,dimension:'overworld',deadline:performance.now()+8000,...overrides},signal,{starterScope:'job/1',recoveryGuard:()=>{}});
 return{bot,actions,run,moves:()=>moves};
}
async function ticking(bot,operation){const timer=setInterval(()=>bot.emit('physicsTick'),10);try{return await operation();}finally{clearInterval(timer);}}

test('private retreat makes one bounded terrain-preserving leg and verifies supported separation',async()=>{
 const f=fixture();const result=await ticking(f.bot,()=>f.run());
 assert.equal(result.separated,true);assert.equal(f.moves(),1);assert.ok(result.observedSeparation>=4);assert.ok(f.bot.entity.position.distanceTo(new Vec3(.5,64,.5))<=8);
 assert.equal(f.bot.pathfinder.movements.canDig,false);assert.equal(f.bot.pathfinder.goal,null);
 assert.equal(f.actions.definitions.some(d=>d.name==='starter_retreat'),false);
 assert.equal(f.bot.listenerCount('physicsTick'),0);
});
test('retreat rejects paths that approach the attacker and never moves on failed certification',async()=>{
 const f=fixture();let probes=0;
 f.bot.pathfinder.getPathFromTo=function*(m,start,goal){probes++;assert.equal(m.maxDropDown,0);assert.equal(m.allowParkour,false);yield{result:{status:'success',path:[new Vec3(1,64,0),new Vec3(goal.x,goal.y,goal.z)]}};};
 await assert.rejects(ticking(f.bot,()=>f.run()),/No verified local retreat route/);
 assert.equal(f.moves(),0);assert.ok(probes<=4);assert.equal(f.bot.listenerCount('physicsTick'),0);
});
test('retreat rejects unsafe intermediate support and lower-elevation preflight nodes',async()=>{
 for(const kind of ['oak_leaves','magma_block','campfire','sweet_berry_bush','drop']){
  const f=fixture(),read=f.bot.blockAt;
  f.bot.blockAt=p=>{
   if(kind==='drop'&&p.x===-1&&p.z===0&&p.y===62)return{...read(new Vec3(0,63,0)),position:p};
   if(kind==='drop'&&p.x===-1&&p.z===0&&p.y===63)return{...read(new Vec3(0,64,0)),position:p};
   if(kind!=='drop'&&p.x===-1&&p.z===0&&p.y===63)return{...read(p),name:kind};
   return read(p);
  };
  f.bot.pathfinder.getPathFromTo=function*(m,start,goal){yield{result:{status:'success',path:[new Vec3(-1,kind==='drop'?63:64,0),new Vec3(goal.x,goal.y,goal.z)]}};};
  await assert.rejects(ticking(f.bot,()=>f.run()),/No verified local retreat route/,kind);assert.equal(f.moves(),0);
 }
});
test('retreat constrains live neighbor generation against detached support and diagonal drops',async()=>{
 for(const kind of ['leaf','drop']){
  const f=fixture(),read=f.bot.blockAt;let checked=0,installed=false;
  f.bot.blockAt=p=>{
   if(p.x===-1&&p.z===0){
    if(kind==='leaf'&&p.y===63)return{...read(p),name:'oak_leaves'};
    if(kind==='drop'&&p.y===62)return{...read(new Vec3(0,63,0)),position:p};
    if(kind==='drop'&&p.y===63)return{...read(new Vec3(0,64,0)),position:p};
   }return read(p);
  };
  f.bot.pathfinder.setMovements=function(m){this.movements=m;if(!installed){installed=true;m.getNeighbors=()=>[new Vec3(-1,kind==='drop'?63:64,0)];}};
  f.bot.pathfinder.getPathFromTo=function*(m,start,goal){checked++;assert.deepEqual(m.getNeighbors(new Vec3(0,64,0)),[]);yield{result:{status:'success',path:[new Vec3(goal.x,goal.y,goal.z)]}};};
  await ticking(f.bot,()=>f.run());assert.ok(checked>=2,kind);
 }
});
test('retreat rejects unsupported threats, unknown support and occupied player destinations',async()=>{
 for(const mode of ['player-source','skeleton','floor','players']){
  const f=fixture();if(mode==='player-source')f.bot.entities[22].type='player';
  if(mode==='skeleton')f.bot.entities[23]={id:23,name:'skeleton',type:'hostile',position:new Vec3(4,64,0)};
  if(mode==='floor')f.bot.blockAt=p=>({name:'air',type:0,boundingBox:'empty',shapes:[],position:p});
  if(mode==='players')for(const [i,[x,z]] of [[6,0],[-6,0],[0,6],[0,-6]].entries())f.bot.entities[30+i]={id:30+i,type:'player',username:`Fixture${i}`,position:new Vec3(x+.5,64,z+.5)};
  await assert.rejects(ticking(f.bot,()=>f.run()));assert.equal(f.moves(),0,mode);
 }
});
test('retreat does not report success after an airborne goal event or lost separation',async()=>{
 for(const mode of ['airborne','approached']){
  const f=fixture();
  f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal)queueMicrotask(()=>{
   if(this.goal!==goal)return;f.bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);
   if(mode==='airborne'){f.bot.entity.onGround=false;f.bot.entity.velocity.y=.2;}
   else f.bot.entities[22].position=f.bot.entity.position.offset(1,0,0);
   f.bot.emit('goal_reached',goal);
  });};
  await assert.rejects(ticking(f.bot,()=>f.run()));assert.equal(f.bot.listenerCount('physicsTick'),0);
 }
});
test('retreat cancellation and deadline expiry cannot start late movement',async()=>{
 const f=fixture(),controller=new AbortController();const pending=f.run({},controller.signal);controller.abort();await assert.rejects(pending);assert.equal(f.moves(),0);assert.equal(f.bot.listenerCount('physicsTick'),0);
 const timed=fixture();timed.bot.pathfinder.getPathFromTo=function*(){while(true)yield{result:{status:'partial',path:[]}};};
 await assert.rejects(ticking(timed.bot,()=>timed.run({deadline:performance.now()+60})));assert.equal(timed.moves(),0);assert.equal(timed.bot.listenerCount('physicsTick'),0);
});
test('retreat deadline and cancellation drain an active walk without accepting success',async()=>{
 for(const mode of ['deadline','cancel']){
  const f=fixture(),controller=new AbortController();let entered=false;
  f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal){entered=true;if(mode==='cancel')setTimeout(()=>controller.abort(),10);}};
  await assert.rejects(ticking(f.bot,()=>f.run({deadline:performance.now()+350},controller.signal)));
  assert.equal(entered,true,mode);assert.equal(f.bot.pathfinder.goal,null);assert.equal(f.bot.listenerCount('physicsTick'),0);
 }
});
test('retreat invalidates an active corridor when floor or leaf anchor changes ahead',async()=>{
 for(const kind of ['floor','anchor']){
  const f=fixture(),read=f.bot.blockAt;let changed=false;
  if(kind==='anchor')f.bot.blockAt=p=>p.x===-2&&p.z===0&&p.y===63?{...read(p),name:'oak_leaves'}:p.x===-2&&p.z===0&&p.y===62?{...read(new Vec3(0,63,0)),position:p,name:changed?'air':'oak_log',boundingBox:changed?'empty':'block'}:read(p);
  f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal)queueMicrotask(()=>{
   changed=true;const position=new Vec3(-2,kind==='floor'?63:62,0);f.bot.emit('blockUpdate',{position},{position,name:'air'});
  });};
  await assert.rejects(ticking(f.bot,()=>f.run()),/corridor changed/,kind);assert.equal(f.bot.pathfinder.goal,null);
  for(const event of ['physicsTick','blockUpdate','chunkColumnLoad','chunkColumnUnload','path_update'])assert.equal(f.bot.listenerCount(event),0,event);
 }
});
test('retreat watches remote anchors of swept diagonal corner leaves',async()=>{
 const f=fixture(),read=f.bot.blockAt;
 f.bot.blockAt=p=>p.x===0&&p.y===63&&p.z<=-1&&p.z>=-6?{...read(p),name:'oak_leaves'}:p.x===0&&p.y===63&&p.z===-7?{...read(p),name:'oak_log'}:read(p);
 f.bot.pathfinder.getPathFromTo=function*(m,start,goal){
  yield{result:{status:'success',path:[new Vec3(-1,64,-1),new Vec3(goal.x,goal.y,goal.z)]}};
 };
 f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal)queueMicrotask(()=>{
  const position=new Vec3(0,63,-7);f.bot.emit('blockUpdate',{position,name:'oak_log'},{position,name:'air'});
 });};
 await assert.rejects(ticking(f.bot,()=>f.run()),/corridor changed/);assert.equal(f.bot.pathfinder.goal,null);
});
test('retreat ignores distant chunk streaming but aborts relevant or unknown chunk changes',async()=>{
 for(const event of ['chunkColumnLoad','chunkColumnUnload'])for(const relevant of [false,true,'unknown']){
  const f=fixture();
  f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal)queueMicrotask(()=>{
   f.bot.emit(event,relevant==='unknown'?undefined:new Vec3(relevant?-16:160,0,0));
   if(this.goal!==goal)return;f.bot.entity.position=new Vec3(goal.x+.5,goal.y,goal.z+.5);f.bot.emit('goal_reached',goal);
  });};
  if(relevant)await assert.rejects(ticking(f.bot,()=>f.run()),/Loaded recovery corridor/);
  else assert.equal((await ticking(f.bot,()=>f.run())).separated,true);
  assert.equal(f.bot.pathfinder.goal,null);
 }
});
test('retreat aborts an airborne excursion or controller jump before continuing a walk',async()=>{
 for(const kind of ['airborne','jump']){
  const f=fixture();let jump=false;f.bot.getControlState=name=>name==='jump'&&jump;f.bot.clearControlStates=()=>{jump=false;};
  f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal)queueMicrotask(()=>{
   if(kind==='airborne'){f.bot.entity.onGround=false;f.bot.entity.velocity.y=-.1;f.bot.entity.position.y=64.5;}else jump=true;
   f.bot.emit('physicsTick');
  });};
  await assert.rejects(ticking(f.bot,()=>f.run()),/airborne or jump/);assert.equal(f.bot.pathfinder.goal,null);assert.equal(jump,false);
 }
});
test('retreat rejects a live replan with an unsafe intermediate node',async()=>{
 const f=fixture(),read=f.bot.blockAt;let changed=false;
 f.bot.blockAt=p=>changed&&p.x===-1&&p.z===-1&&p.y===63?{...read(p),name:'magma_block'}:read(p);
 f.bot.pathfinder.setGoal=function(goal){this.goal=goal;f.bot.emit('goal_updated',goal);if(goal)queueMicrotask(()=>{
  changed=true;f.bot.emit('path_update',{status:'success',path:[new Vec3(-.5,64,-.5),new Vec3(goal.x+.5,goal.y,goal.z+.5)]});
 });};
 await assert.rejects(ticking(f.bot,()=>f.run()),/unsafe terrain/);assert.equal(f.bot.pathfinder.goal,null);
});
test('runtime recovery waits for both runner and physical craft locks to drain',async()=>{
 const {Runtime}=await import('../src/runtime.js'),{loadConfig}=await import('../src/config.js');
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'brobot-retreat-drain-')),f=fixture(),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory}));
 let began,drain;const started=new Promise(r=>{began=r});
 const log={name:'oak_log',type:f.bot.registry.itemsByName.oak_log.id,count:1,metadata:0};
 f.bot.inventory.items=()=>[log];f.bot.quit=()=>{};
 f.bot.recipesFor=()=>[{result:{id:f.bot.registry.itemsByName.oak_planks.id,count:4},requiresTable:false}];
 f.bot.craft=async()=>{began();await new Promise(r=>{drain=r});};
 runtime.bot=f.bot;runtime.actions=f.actions;runtime.progression={definitions:[]};runtime.connection='connected';
 runtime.survival.observe=async()=>({wood:'oak'});
 try{
  await ticking(f.bot,async()=>{
   f.bot.entities[22].position=new Vec3(100,64,.5);
   runtime.survival.start();
   let timeout;
   try{await Promise.race([started,runtime.survival.promise.then(()=>{throw Error('Starter ended before entering craft');}),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Craft fixture did not start')),2000);})]);}finally{clearTimeout(timeout);}
   f.bot.entities[22].position=new Vec3(1.5,64,.5);
   runtime.checkHostileHurt({id:22,name:'zombie',type:'hostile'});
   await new Promise(r=>setTimeout(r,25));
   assert.equal(runtime.runner.active.name,'craft');assert.equal(runtime.runner.active.controller.signal.aborted,true);assert.equal(f.moves(),0);
   await assert.rejects(f.actions.execute('pickup',{radius:1}),/running or draining/);
   drain();await runtime.survival.promise;
  });
  assert.equal(runtime.runner.active,null);assert.equal(runtime.survival.state().status,'paused');assert.equal(runtime.survival.state().hostileRecovery.result.separated,true);assert.equal(f.moves(),1);
 }finally{await runtime.close();await rm(directory,{recursive:true,force:true});}
});
test('recovery standing space rejects stale air floors and blocked body geometry',()=>{
 const f=fixture(),read=f.bot.blockAt;assert.equal(recoveryStandingSpace(f.bot,new Vec3(.5,64,.5)),true);
 f.bot.blockAt=p=>p.y===64?{...read(new Vec3(0,63,0)),position:p}:read(p);assert.equal(recoveryStandingSpace(f.bot,new Vec3(.5,64,.5)),false);
});

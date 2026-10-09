import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import registryLoader from 'prismarine-registry';
import blockLoader from 'prismarine-block';
import pf from 'mineflayer-pathfinder';
import { reverseRouteWitness } from '../src/reverse-route-witness.js';
const registry=registryLoader('1.21.8'),Block=blockLoader(registry);
function fixture(){
 const cells=new Map();
 const bot=Object.assign(new EventEmitter(),{registry,version:'1.21.8',entity:{position:new Vec3(.5,64,.5),onGround:true},entities:{},inventory:{items:()=>[]},game:{dimension:'overworld'},pathfinder:{searchRadius:-1},world:{}});
 bot.blockAt=p=>{p=p.floored();const name=cells.get(p.toString())??(p.y===63?'stone':'air');const b=Block.fromStateId(registry.blocksByName[name].defaultState,0);b.position=p;return b;};
 const movements=new pf.Movements(bot);Object.assign(movements,{canDig:false,allow1by1towers:false,allowParkour:false,allowFreeMotion:false,scafoldingBlocks:[]});
 const forward=[1,2,3].map(x=>new Vec3(x,64,0)),origin=new pf.goals.GoalNear(0,64,0,1);
 const run=options=>reverseRouteWitness(bot,movements,forward,origin,{deadline:1000,now:()=>0,budgetMs:12,...options});
 return{bot,movements,forward,origin,cells,run};
}
test('fresh real movement edges prove a reverse walking route to the supplied home',()=>{
 const f=fixture(),r=f.run();assert.ok(r);assert.deepEqual(r.path.map(n=>[n.x,n.y,n.z]),[[2,64,0],[1,64,0]]);
 assert.ok(r.path.every(n=>n.toBreak.length===0&&n.toPlace.length===0));
});
test('no retained node satisfying home cannot be replaced by an invented initial node',()=>{
 const f=fixture();assert.equal(reverseRouteWitness(f.bot,f.movements,f.forward,new pf.goals.GoalBlock(0,64,0),{deadline:performance.now()+1000}),null);
 assert.equal(reverseRouteWitness(f.bot,f.movements,f.forward,new pf.goals.GoalNear(20,64,0,1),{deadline:performance.now()+1000}),null);
});
test('a three-block forward drop is not treated as a reverse jump',()=>{
 const f=fixture();for(let x=0;x<=2;x++)for(let y=63;y<=66;y++)f.cells.set(new Vec3(x,y,0).toString(),'stone');
 const route=[new Vec3(1,67,0),new Vec3(2,67,0),new Vec3(3,64,0)];
 assert.equal(reverseRouteWitness(f.bot,f.movements,route,new pf.goals.GoalNear(0,67,0,1),{deadline:performance.now()+1000}),null);
});
test('changed support and unsafe destination refuse the fast certificate',()=>{
 const f=fixture();f.cells.set(new Vec3(2,63,0).toString(),'air');assert.equal(f.run(),null);
 const g=fixture();assert.equal(g.run({validateNode:n=>n.x!==2}),null);
});
test('unsupported policy, finite search radius and absent true movement implementation defer',()=>{
 for(const change of [f=>f.movements.canDig=true,f=>f.movements.allowParkour=true,f=>f.movements.scafoldingBlocks=[1],f=>f.bot.pathfinder.searchRadius=8]){
  const f=fixture();change(f);assert.equal(f.run(),null);
 }
 const f=fixture();assert.equal(reverseRouteWitness(f.bot,{},f.forward,f.origin,{deadline:performance.now()+1000}),null);
});
test('entity index refresh matches reverse planning before fresh neighbor expansion',()=>{
 const f=fixture(),order=[];f.movements.allowEntityDetection=true;
 const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.clearCollisionIndex=()=>order.push('clear');f.movements.updateCollisionIndex=()=>order.push('update');
 f.movements.getNeighbors=node=>{order.push('neighbors');return neighbors(node);};
 assert.ok(f.run());assert.deepEqual(order,['clear','update','neighbors','neighbors']);
});
test('cancel, local work cap, clock expiry and identity change cannot certify',()=>{
 const f=fixture(),c=new AbortController();c.abort();assert.equal(f.run({signal:c.signal}),null);assert.equal(f.run({maxNodes:2}),null);
 let now=0;assert.equal(f.run({now:()=>now+=5,budgetMs:1}),null);
 const neighbors=f.movements.getNeighbors.bind(f.movements);f.movements.getNeighbors=n=>{f.bot.world={};return neighbors(n);};assert.equal(f.run(),null);
});
test('synchronous terrain events invalidate the witness and all observers are removed',()=>{
 const f=fixture(),neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>{const r=neighbors(n);f.bot.emit('blockUpdate');return r;};
 assert.equal(f.run(),null);assert.equal(f.bot.eventNames().length,0);
 const g=fixture();assert.ok(g.run());assert.equal(g.bot.eventNames().length,0);
});
test('malformed optional caps cannot defeat the fixed work bound',()=>{
 const f=fixture();assert.equal(f.run({maxNodes:NaN}),null);assert.equal(f.run({budgetMs:NaN}),null);
 const long=Array.from({length:65},(_,i)=>new Vec3(i,64,0));
 assert.equal(reverseRouteWitness(f.bot,f.movements,long,f.origin,{deadline:1000,now:()=>0,maxNodes:1000}),null);
});

test('initial endpoint acceptance matches reverse A* without inventing a neighbor',()=>{
 const f=fixture();const r=reverseRouteWitness(f.bot,f.movements,f.forward,new pf.goals.GoalBlock(3,64,0),{deadline:1000,now:()=>0});
 assert.deepEqual(r,{path:[]});
});
test('a generated edge requiring placement cannot certify the witness',()=>{
 const f=fixture(),neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>neighbors(n).map(v=>Object.assign(v,{toPlace:[{}]}));assert.equal(f.run(),null);
});
test('a blocked diagonal is checked in the reverse direction',()=>{
 const f=fixture(),route=[new Vec3(1,64,1),new Vec3(2,64,2)];
 f.cells.set(new Vec3(1,64,2).toString(),'stone');f.cells.set(new Vec3(1,65,2).toString(),'stone');
 f.cells.set(new Vec3(2,64,1).toString(),'stone');f.cells.set(new Vec3(2,65,1).toString(),'stone');
 assert.equal(reverseRouteWitness(f.bot,f.movements,route,new pf.goals.GoalBlock(1,64,1),{deadline:1000,now:()=>0}),null);
});

test('planner integration avoids reverse A* only for a fresh complete witness',async()=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');
 const f=fixture();let calls=0;
 f.bot.pathfinder.getPathFromTo=function*(){calls++;yield{result:{status:'success',path:f.forward}};};
 const result=await planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),f.origin);
 assert.equal(calls,1);assert.equal(result.forwardNodes,3);assert.equal(result.reverseNodes,2);
});
test('inconclusive witness invokes normal reverse A* and retains its failure phase',async()=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');
 const f=fixture();let calls=0;
 f.bot.pathfinder.getPathFromTo=function*(){yield{result:++calls===1?{status:'success',path:f.forward}:{status:'noPath',path:[]}};};
 await assert.rejects(planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),new pf.goals.GoalBlock(0,64,0)),e=>{
  assert.deepEqual(e.result.route_failure,{phase:'reverse',planner_status:'noPath'});return true;
 });assert.equal(calls,2);
});
test('fixed endpoint still performs reverse-first A* with no witness shortcut',async()=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');
 const f=fixture(),starts=[];
 f.bot.pathfinder.getPathFromTo=function*(m,start){starts.push(start.clone());yield{result:{status:'success',path:starts.length===1?[new Vec3(1,64,0)]:f.forward}};};
 await planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),f.origin,{fixedEndpoint:new Vec3(3,64,0)});
 assert.equal(starts.length,2);assert.deepEqual(starts.map(p=>p.toArray()),[[3,64,0],[.5,64,.5]]);
});
test('cancellation during witness is checked before any fallback or acceptance',async()=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');
 const f=fixture(),c=new AbortController();let calls=0;const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>{c.abort();return neighbors(n);};
 f.bot.pathfinder.getPathFromTo=function*(){calls++;yield{result:{status:'success',path:f.forward}};};
 await assert.rejects(planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),f.origin,{signal:c.signal}),e=>{
  assert.equal(e.name,'AbortError');assert.deepEqual(e.result.route_failure,{phase:'reverse'});return true;
 });assert.equal(calls,1);assert.equal(f.bot.eventNames().length,0);
});

test('fresh entity avoidance blocks a previously clear reverse edge',()=>{
 const f=fixture();f.movements.allowEntityDetection=true;f.movements.entitiesToAvoid.add('zombie');
 f.bot.entities[2]={name:'zombie',width:.6,height:1.95,position:new Vec3(2.5,64,.5)};
 assert.equal(f.run(),null);
});
test('global deadline expiry during witness refuses fallback and keeps reverse phase',async t=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');
 const f=fixture();let now=0,calls=0;t.mock.method(performance,'now',()=>now);
 const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>{const result=neighbors(n);now=2000;return result;};
 f.bot.pathfinder.getPathFromTo=function*(){calls++;yield{result:{status:'success',path:f.forward}};};
 await assert.rejects(planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),f.origin),e=>{
  assert.equal(e.message,'Return-path planning budget exhausted');assert.deepEqual(e.result.route_failure,{phase:'reverse'});return true;
 });assert.equal(calls,1);assert.equal(f.bot.eventNames().length,0);
});

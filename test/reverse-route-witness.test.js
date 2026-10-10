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
 const bot=Object.assign(new EventEmitter(),{registry,version:'1.21.8',entity:{position:new Vec3(.5,64,.5),onGround:true},entities:{},inventory:{items:()=>[]},game:{dimension:'overworld',minY:-64,height:384},pathfinder:{searchRadius:-1},world:{}});
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
test('home beyond one fresh final edge cannot be replaced by an invented route',()=>{
 const f=fixture();assert.equal(reverseRouteWitness(f.bot,f.movements,f.forward,new pf.goals.GoalBlock(-1,64,0),{deadline:performance.now()+1000}),null);
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
 await assert.rejects(planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),new pf.goals.GoalBlock(-1,64,0)),e=>{
  assert.deepEqual(e.result.route_failure,{phase:'reverse',planner_status:'noPath',reverse_witness:{status:'declined',reason:'final_edge_unverified',forward_nodes:3,validated_edges:2}});return true;
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
  assert.equal(e.name,'AbortError');assert.deepEqual(e.result.route_failure,{phase:'reverse',reverse_witness:{status:'declined',reason:'cancelled',forward_nodes:3,validated_edges:0}});return true;
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
  assert.equal(e.message,'Return-path planning budget exhausted');assert.deepEqual(e.result.route_failure,{phase:'reverse',reverse_witness:{status:'declined',reason:'planning_deadline',forward_nodes:3,validated_edges:0}});return true;
 });assert.equal(calls,1);assert.equal(f.bot.eventNames().length,0);
});

test('omitted first diagonal is completed by an actual fresh goal edge', async () => {
 const { planReturnablePath } = await import('../src/navigation-guards.js');
 const f = fixture(), route = [1,2,3].map(v => new Vec3(v,64,v));
 let calls = 0, expansions = 0;
 const neighbors = f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors = n => { expansions++; return neighbors(n); };
 f.bot.pathfinder.getPathFromTo = function* () { calls++; yield {result:{status:'success',path:route}}; };
 let certified;
 const result = await planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,3),f.origin,{onCertifiedPaths:p=>{certified=p;}});
 assert.equal(calls,1); assert.equal(expansions,3); assert.equal(result.reverseNodes,3);
 assert.ok(f.origin.isEnd(certified.reverse.at(-1))); assert.equal(f.bot.eventNames().length,0);
});
test('one-node corridor can finish at exact home with one generated Move', () => {
 const f=fixture(), route=[new Vec3(1,64,0)]; let expansions=0, generated;
 const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>{expansions++;const r=neighbors(n);generated=r.find(v=>v.x===0&&v.y===64&&v.z===0);return r;};
 const r=reverseRouteWitness(f.bot,f.movements,route,new pf.goals.GoalBlock(0,64,0),{deadline:1000,now:()=>0,maxNodes:1});
 assert.equal(expansions,1);assert.equal(r.path.length,1);assert.equal(r.path[0],generated);
});
test('full corridor plus final home edge never expands more than 64 nodes',()=>{
 const f=fixture(),route=Array.from({length:64},(_,i)=>new Vec3(i+1,64,0));let expansions=0;
 const neighbors=f.movements.getNeighbors.bind(f.movements);f.movements.getNeighbors=n=>{expansions++;return neighbors(n);};
 const r=reverseRouteWitness(f.bot,f.movements,route,new pf.goals.GoalBlock(0,64,0),{deadline:1000,now:()=>0});
 assert.equal(expansions,64);assert.equal(r.path.length,64);
});
test('final fresh edge can safely descend a real one-block step',()=>{
 const f=fixture();f.cells.set(new Vec3(1,64,0).toString(),'stone');
 const r=reverseRouteWitness(f.bot,f.movements,[new Vec3(1,65,0)],new pf.goals.GoalBlock(0,64,0),{deadline:1000,now:()=>0});
 assert.ok(r);assert.deepEqual(r.path.map(n=>[n.x,n.y,n.z]),[[0,64,0]]);
});
for(const rejection of ['support','validator','break','place','parkour','negative','nan']) test(`final edge rejects ${rejection}`,()=>{
 const f=fixture(),route=[new Vec3(1,64,0)];
 if(rejection==='support')f.cells.set(new Vec3(0,63,0).toString(),'air');
 const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>neighbors(n).map(v=>{
  if(v.x===0&&v.y===64&&v.z===0){
   if(rejection==='break')v.toBreak=[{}];if(rejection==='place')v.toPlace=[{}];
   if(rejection==='parkour')v.parkour=true;if(rejection==='negative')v.cost=-1;if(rejection==='nan')v.cost=NaN;
  }return v;
 });
 const r=reverseRouteWitness(f.bot,f.movements,route,new pf.goals.GoalBlock(0,64,0),{deadline:1000,now:()=>0,validateNode:n=>rejection!=='validator'||n.x!==0});
 assert.equal(r,null);assert.equal(f.bot.eventNames().length,0);
});
for(const invalidation of ['event','identity','cancel','local-expiry','global-expiry']) test(`final edge invalidation ${invalidation} cannot certify`,()=>{
 const f=fixture(),c=new AbortController();let now=0;
 const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>{const r=neighbors(n);
  if(invalidation==='event')f.bot.emit('entityMoved');
  if(invalidation==='identity')f.bot.world={};
  if(invalidation==='cancel')c.abort();
  if(invalidation==='local-expiry')now=13;
  if(invalidation==='global-expiry')now=1001;
  return r;
 };
 const r=reverseRouteWitness(f.bot,f.movements,[new Vec3(1,64,0)],new pf.goals.GoalBlock(0,64,0),{deadline:1000,now:()=>now,signal:c.signal});
 assert.equal(r,null);assert.equal(f.bot.eventNames().length,0);
});
for(const stop of ['cancel','deadline']) test(`final edge ${stop} does not start fallback`,async t=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');const f=fixture(),c=new AbortController();let now=0,calls=0;
 t.mock.method(performance,'now',()=>now);
 const neighbors=f.movements.getNeighbors.bind(f.movements);
 f.movements.getNeighbors=n=>{const r=neighbors(n);if(stop==='cancel')c.abort();else now=2000;return r;};
 f.bot.pathfinder.getPathFromTo=function*(){calls++;yield{result:{status:'success',path:[new Vec3(1,64,0)]}};};
 await assert.rejects(planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(1,64,0),new pf.goals.GoalBlock(0,64,0),{signal:c.signal}),e=>{
  assert.equal(stop==='cancel'?e.name:e.message,stop==='cancel'?'AbortError':'Return-path planning budget exhausted');return true;
 });assert.equal(calls,1);assert.equal(f.bot.eventNames().length,0);
});
test('final goal evaluation that changes terrain cannot certify',()=>{
 const f=fixture(),goal={isEnd:n=>{if(n.x===0){f.bot.emit('blockUpdate');return true;}return false;}};
 assert.equal(reverseRouteWitness(f.bot,f.movements,[new Vec3(1,64,0)],goal,{deadline:1000,now:()=>0}),null);
 assert.equal(f.bot.eventNames().length,0);
});
test('blocked final diagonal is not replaced by a guessed starting cell',()=>{
 const f=fixture();
 for(const [x,z] of [[0,1],[1,0]])for(const y of [64,65])f.cells.set(new Vec3(x,y,z).toString(),'stone');
 assert.equal(reverseRouteWitness(f.bot,f.movements,[new Vec3(1,64,1)],new pf.goals.GoalBlock(0,64,0),{deadline:1000,now:()=>0}),null);
 assert.equal(f.bot.eventNames().length,0);
});

const witnessRecord = (reason, forward_nodes, validated_edges = 0, extra = {}) => ({
 status: ['initial_endpoint','retained_corridor','final_edge'].includes(reason) ? 'success' : 'declined', reason,
 ...(forward_nodes === undefined ? {} : {forward_nodes}), validated_edges, ...extra
});
function observed(f, {forward=f.forward,origin=f.origin,...options}={}) {
 const records=[];
 const result=reverseRouteWitness(f.bot,f.movements,forward,origin,{deadline:1000,now:()=>0,...options,onDiagnostic:record=>{
  assert.equal(f.bot.eventNames().length,0,'diagnostics run only after witness listeners are removed');records.push(record);
 }});
 assert.equal(records.length,1);return {result,record:records[0]};
}
for(const [reason,x,edges] of [['initial_endpoint',3,0],['retained_corridor',1,2],['final_edge',0,3]]) test(`witness success diagnostic ${reason} has exact validated counts`,()=>{
 const f=fixture();let clocks=0,validators=0,neighbors=0;
 const get=f.movements.getNeighbors.bind(f.movements);f.movements.getNeighbors=n=>{neighbors++;return get(n);};
 const {result,record}=observed(f,{origin:new pf.goals.GoalBlock(x,64,0),now:()=>{clocks++;return 0;},validateNode:()=>{validators++;return true;}});
 assert.deepEqual(record,witnessRecord(reason,3,edges));assert.equal(result.path.length,edges);assert.equal(neighbors,edges);
 // Existing samples: initial budget, two refresh checks, three per edge,
 // plus the endpoint check when accepting the initial node or a corridor node.
 assert.equal(clocks,reason==='initial_endpoint'?4:reason==='retained_corridor'?10:12);
 if(reason!=='final_edge')assert.equal(validators,edges);
});
for(const [reason,change,options,expectedNodes] of [
 ['policy',f=>f.movements.canDig=true,{},undefined],
 ['input',()=>{},{forward:[]},0],
 ['input',()=>{},{forward:null},undefined],
 ['input',()=>{},{origin:{}},3],
 ['input',f=>f.forward[0].toBreak=[{}],{},3],
 ['cap',()=>{},{maxNodes:2},3],
 ['cap',()=>{},{maxNodes:NaN},3],
 ['cap',()=>{},{budgetMs:NaN},3],
 ['cancelled',()=>{},{signal:{aborted:true}},3],
 ['local_deadline',()=>{},{budgetMs:0},3],
 ['event',f=>{f.movements.getNeighbors=()=>{f.bot.emit('blockUpdate');return [];};},{},3],
 ['context',f=>{f.movements.getNeighbors=()=>{f.bot.world={};return [];};},{},3],
 ['corridor_unverified',f=>{f.movements.getNeighbors=()=>[];},{},3],
 ['final_edge_unverified',()=>{},{origin:new pf.goals.GoalBlock(-1,64,0)},3],
 ['exception',f=>{f.movements.getNeighbors=()=>{throw Error('private payload');};},{},3]
]) test(`witness decline ${reason} reports only bounded evidence (${expectedNodes})`,()=>{
 const f=fixture();change(f);const {result,record}=observed(f,options);
 assert.equal(result,null);assert.deepEqual(record,witnessRecord(reason,expectedNodes,reason==='final_edge_unverified'?2:0));
 assert.equal(JSON.stringify(record).includes('private'),false);
});
test('witness counts distinguish a hard-capped oversized input from an actual 64-node proof',()=>{
 const f=fixture();
 const oversize=observed(f,{forward:Array.from({length:65},(_,i)=>new Vec3(i+1,64,0)),maxNodes:1000});
 assert.equal(oversize.result,null);assert.deepEqual(oversize.record,witnessRecord('cap',64,0,{forward_nodes_capped:true}));
 const exact=observed(f,{forward:Array.from({length:64},(_,i)=>new Vec3(i+1,64,0)),origin:new pf.goals.GoalBlock(0,64,0)});
 assert.equal(exact.result.path.length,64);assert.deepEqual(exact.record,witnessRecord('final_edge',64,64));
});
test('a later corridor rejection preserves only the already validated edge count',()=>{
 const f=fixture(),get=f.movements.getNeighbors.bind(f.movements);let calls=0;
 f.movements.getNeighbors=n=>++calls===1?get(n):[];
 const {result,record}=observed(f);assert.equal(result,null);assert.deepEqual(record,witnessRecord('corridor_unverified',3,1));
});
test('diagnostic callbacks cannot change returned paths or swallow original cleanup errors',()=>{
 for(const decline of [false,true]) {
  const f=fixture();let callbacks=0;if(decline)f.movements.getNeighbors=()=>{throw Error('movement failed');};
  const result=f.run({onDiagnostic:record=>{callbacks++;assert.equal(f.bot.eventNames().length,0);record.reason='tampered';throw Error('diagnostic failed');}});
  assert.equal(callbacks,1);if(decline)assert.equal(result,null);else assert.equal(result.path.length,2);
 }
 const f=fixture(),original=Error('cleanup failure');let callbacks=0;
 const remove=f.bot.removeListener.bind(f.bot);f.bot.removeListener=(...args)=>{remove(...args);throw original;};
 assert.throws(()=>f.run({onDiagnostic:record=>{callbacks++;assert.deepEqual(record,witnessRecord('exception',3,2));throw Error('diagnostic failed');}}),e=>e===original);
 assert.equal(callbacks,1);
});
test('preflight refusal retains short circuit ordering without reading later input or clock',()=>{
 const f=fixture();f.movements.canDig=true;let inputReads=0,clocks=0;
 const forward=new Proxy([], {get(){inputReads++;throw Error('later input inspected');}});
 const {record}=observed(f,{forward,now:()=>{clocks++;return 0;},signal:{get aborted(){throw Error('later cancellation inspected');}}});
 assert.deepEqual(record,witnessRecord('policy'));assert.equal(inputReads,0);assert.equal(clocks,0);
});
test('event, cancellation, deadline and context keep their original precedence and clock sampling',()=>{
 for(const mode of ['event','cancelled','deadline','context']) {
  const f=fixture();let clocks=0,abortReads=0;
  const signal={get aborted(){abortReads++;return mode==='event'||mode==='cancelled';}};
  // Refresh is before the second unchanged check, after the first succeeds.
  f.movements.allowEntityDetection=true;f.movements.clearCollisionIndex=()=>{};
  let armed=false;f.movements.updateCollisionIndex=()=>{armed=true;f.bot.world={};if(mode==='event')f.bot.emit('blockUpdate');};
  const {record}=observed(f,{signal:{get aborted(){if(!armed)return false;return signal.aborted;}},now:()=>{clocks++;return armed&&mode==='deadline'?12:0;}});
  assert.deepEqual(record,witnessRecord(mode==='deadline'?'local_deadline':mode,3));
  assert.equal(clocks,['event','cancelled'].includes(mode)?2:3);assert.equal(abortReads,mode==='event'?0:1);
 }
});
test('missing edge skips the original trailing guard even when its validator cancels',()=>{
 const f=fixture(),controller=new AbortController();let clocks=0,validations=0;
 const {result,record}=observed(f,{signal:controller.signal,now:()=>{clocks++;return 0;},validateNode:()=>{validations++;controller.abort();return false;}});
 assert.equal(result,null);assert.deepEqual(record,witnessRecord('corridor_unverified',3));assert.equal(clocks,5);assert.equal(validations,1);
});
test('failed input access preserves its original throw and still reports an exception once',()=>{
 const f=fixture(),error=Error('input accessor failed');let callbacks=0;
 Object.defineProperty(f.movements,'canDig',{get(){throw error;}});
 assert.throws(()=>f.run({onDiagnostic:record=>{callbacks++;assert.deepEqual(record,witnessRecord('exception'));}}),e=>e===error);
 assert.equal(callbacks,1);
});
test('successful fallback retains the inconclusive witness without cross-call leakage',async t=>{
 const {planReturnablePath}=await import('../src/navigation-guards.js');t.mock.method(performance,'now',()=>0);
 const f=fixture();let calls=0;
 f.movements.getNeighbors=()=>[];
 f.bot.pathfinder.getPathFromTo=function*(){calls++;yield{result:{status:'success',path:calls%2?f.forward:[new Vec3(0,64,0)]}};};
 const result=await planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),f.origin);
 assert.equal(calls,2);assert.deepEqual(result.reverse_witness,witnessRecord('corridor_unverified',3));
 const fixed=await planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(0,64,0),f.origin,{fixedEndpoint:new Vec3(0,64,0)});
 assert.equal(Object.hasOwn(fixed,'reverse_witness'),false);
 f.bot.pathfinder.getPathFromTo=function*(){yield{result:{status:'noPath',path:[]}};};
 await assert.rejects(planReturnablePath(f.bot,f.movements,new pf.goals.GoalBlock(3,64,0),f.origin),error=>{
  assert.deepEqual(error.result.route_failure,{phase:'forward',planner_status:'noPath'});return true;
 });
});

test('one existing clock sample distinguishes witness slice expiry from caller planning expiry',()=>{
 for(const [time,reason]of[[12,'local_deadline'],[1000,'planning_deadline'],[NaN,'deadline']]){
  const f=fixture();let clocks=0,afterExpansion=false;
  f.movements.getNeighbors=()=>{afterExpansion=true;return [];};
  const {result,record}=observed(f,{now:()=>{clocks++;return afterExpansion?time:0;}});
  assert.equal(result,null);assert.deepEqual(record,witnessRecord(reason,3));assert.equal(clocks,5);
 }
});

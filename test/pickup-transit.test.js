import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import registryLoader from 'prismarine-registry';
import blockLoader from 'prismarine-block';
import WorldSync from 'prismarine-world/src/worldsync.js';
import pathfinder from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';
import {findTransitPickupClearance} from '../src/pickup-transit.js';
import {visibleBlockFace} from '../src/actions.js';
import {findPickupClearance} from '../src/survival-observation.js';

function fixture(seed) {
 const saved=JSON.parse(readFileSync(new URL(seed === 'terminal-pocket' ? './fixtures/pickup-terminal-454806089.json' : `./fixtures/transit-${seed}.json`,import.meta.url),'utf8'));
 const registry=registryLoader(saved.minecraftVersion),Block=blockLoader(registry),overrides=new Map();
 const [minX,minY,minZ]=saved.region.min,[maxX,maxY,maxZ]=saved.region.max,[sx,,sz]=saved.region.size;
 const blockAt=value=>{
  const p=value.floored();if(p.x<minX||p.x>maxX||p.y<minY||p.y>maxY||p.z<minZ||p.z>maxZ)return null;
  const id=overrides.has(p.toString())?overrides.get(p.toString()):saved.region.stateIds[((p.y-minY)*sz+p.z-minZ)*sx+p.x-minX];
  if(id==null)return null;const b=Block.fromStateId(id,0);b.position=p;return b;
 };
 const world={getBlock:blockAt,raycast:WorldSync.prototype.raycast};
 const bot=Object.assign(new EventEmitter(),{registry,blockAt,world,entity:{position:new Vec3(...saved.bot.position),velocity:new Vec3(...saved.bot.velocity),onGround:saved.bot.onGround,eyeHeight:saved.bot.eyeHeight,effects:{}},entities:Object.fromEntries(saved.trackedDrops.map(d=>[d.id,{id:d.id,name:'item',type:'other',position:new Vec3(...d.position)}])),inventory:{items:()=>saved.bot.inventory.map(i=>({...i,type:registry.itemsByName[i.name]?.id}))},game:{minY:-64,height:384},clearControlStates(){}});
 pathfinder.pathfinder(bot);
 const m=new pathfinder.Movements(bot);m.canDig=false;m.allow1by1towers=false;m.allowParkour=false;m.allowFreeMotion=false;m.scafoldingBlocks=[];m.maxDropDown=3;
 const home=new Vec3(...saved.bot.homePosition);
 m.exclusionAreasStep.push(b=>b.position?.distanceTo(home)<=90?0:1000);
 m.exclusionAreasStep.push(b=>b.isWaterlogged?1000:0);
 for(const name of ['water','flowing_water','bubble_column','kelp','kelp_plant','seagrass','tall_seagrass'])if(registry.blocksByName[name])m.blocksToAvoid.add(registry.blocksByName[name].id);
 bot.pathfinder.setMovements(m);
 return {saved,bot,m,registry,overrides,ids:saved.trackedDrops.map(d=>d.id)};
}
function result(f,options={}) {return findTransitPickupClearance(f.bot,f.ids,{now:()=>0,...options});}

test('saved transit pockets produce a visible ordinary clearance without changing world or actor state',()=>{
 for(const seed of [42,1542908414]) {
  const f=fixture(seed),before=JSON.stringify(f.saved),position=f.bot.entity.position.clone(),movement=f.bot.pathfinder.movements;
  const candidate=result(f);assert.ok(candidate,`Expected a bounded candidate for ${seed}`);
  const p=new Vec3(candidate.x,candidate.y,candidate.z),b=f.bot.blockAt(p);
  assert.equal(b.name,candidate.expected_block);assert.ok(visibleBlockFace(f.bot.world,f.bot.entity.position.offset(0,1.62,0),p,4.2));
  assert.ok(p.y>=Math.ceil(position.y-.001));assert.equal(JSON.stringify(f.saved),before);assert.ok(f.bot.entity.position.equals(position));assert.equal(f.bot.pathfinder.movements,movement);assert.equal(f.overrides.size,0);
  if(seed===1542908414)assert.deepEqual(candidate,{x:123,y:65,z:115,expected_block:'dirt'});
  // Independently verify the proposed geometry with installed A*, not this
  // helper's bounded breadth-first probe. No movement or server is involved.
  f.overrides.set(p.toString(),f.registry.blocksByName.air.defaultState);
  const target=new Vec3(...f.saved.targetLanding),origin=position.floored();
  for(const [start,end] of [[position,target],[target,origin]]) {
    const generator=f.bot.pathfinder.getPathFromTo(f.m,start,new pathfinder.goals.GoalBlock(end.x,end.y,end.z),{timeout:1000,tickTimeout:1000,optimizePath:false});
    try {const r=generator.next().value.result;assert.equal(r.status,'success');assert.ok(r.path.every(n=>!n.toBreak.length&&!n.toPlace.length));} finally {generator.return();}
  }

 }
});
test('transit probing fails closed on resource/time exhaustion, missing entities and unsafe movement modes',()=>{
 const f=fixture(1542908414);
 assert.equal(result(f,{maxNodes:1}),null);
 let tick=0;assert.equal(result(f,{now:()=>tick+=100,budgetMs:80}),null);
 assert.equal(findTransitPickupClearance(f.bot,[999999]),null);
 for(const flag of ['canDig','allowParkour','allow1by1towers','allowFreeMotion']){f.m[flag]=true;assert.equal(result(f),null,flag);f.m[flag]=false;}
 f.bot.entity.onGround=false;assert.equal(result(f),null);
});
test('transit probing refuses unseen blocks and hazardous edits',()=>{
 const f=fixture(1542908414);f.bot.world.raycast=()=>null;assert.equal(result(f),null);
 const g=fixture(1542908414);const original=g.bot.blockAt;
 // Every otherwise eligible block is marked waterlogged in this defensive fixture.
 g.bot.blockAt=p=>{const b=original(p);return b?new Proxy(b,{get:(target,k)=>k==='isWaterlogged'?true:Reflect.get(target,k)}):null;};
 assert.equal(result(g),null);
});
test('an already open route needs no additional excavation',()=>{
 const f=fixture(1542908414);f.overrides.set(new Vec3(123,65,115).toString(),f.registry.blocksByName.air.defaultState);
 assert.equal(result(f),null);
});

test('a visible single edit that only permits one-way travel is rejected',()=>{
 const f=fixture(42),only=new Vec3(-37,64,-18),original=f.bot.blockAt;
 f.bot.blockAt=p=>{const b=original(p);return b?new Proxy(b,{get:(target,k)=>k==='diggable'?(b.position.equals(only)?b.diggable:false):Reflect.get(target,k)}):null;};
 assert.equal(result(f),null);
});
test('transit clearance refuses adjacent liquid, falling blocks and unavailable harvest tools',()=>{
 for(const kind of ['water','falling','tool','kelp','kelp_plant','seagrass','tall_seagrass','bubble_column']) {
  const f=fixture(kind==='tool'?42:1542908414),only=kind==='tool'?new Vec3(-38,63,-18):new Vec3(123,65,115),original=f.bot.blockAt;
  if(!['falling','tool'].includes(kind))f.overrides.set(only.offset(0,0,-1).toString(),f.registry.blocksByName[kind].defaultState);
  if(kind==='falling')f.overrides.set(only.offset(0,1,0).toString(),f.registry.blocksByName.sand.defaultState);
  if(kind==='tool')f.bot.inventory.items=()=>[];
  f.bot.blockAt=p=>{const b=original(p);return b?new Proxy(b,{get:(target,k)=>k==='diggable'?(b.position.equals(only)?b.diggable:false):Reflect.get(target,k)}):null;};
  assert.equal(result(f),null,kind);
 }
});

test('runtime exposes transit recovery only while tracked drops and clearance budget remain',async()=>{
 const {Runtime}=await import('../src/runtime.js'),{loadConfig}=await import('../src/config.js');
 const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const directory=await mkdtemp(join(tmpdir(),'brobot-transit-'));
 const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory,OPENAI_API_KEY:''}));
 try {
  const f=fixture(1542908414),gate=new Vec3(123,65,115),origin=new Vec3(123,65,116),target=new Vec3(122,63,116);
  f.bot.world.raycast=()=>({position:gate});
  f.m.getNeighbors=function(node){if(this.bot.blockAt(gate).name!=='air')return[];const next=node.equals(origin)?target:node.equals(target)?origin:null;return next?[Object.assign(next.clone(),{remainingBlocks:0,cost:1,toBreak:[],toPlace:[]})]:[];};
  f.bot.findBlocks=()=>[];f.bot.quit=()=>{};runtime.bot=f.bot;runtime.connection='connected';runtime.execute=async()=>({nearby_blocks:[]});
  runtime.survival.job={recoverDropIds:f.ids,clearanceDigs:7};
  assert.deepEqual((await runtime.survival.observe()).pickupClearance,{x:123,y:65,z:115,expected_block:'dirt'});
  runtime.survival.job.clearanceDigs=8;assert.equal((await runtime.survival.observe()).pickupClearance,null);
  runtime.survival.job={recoverDropIds:[],clearanceDigs:0};assert.equal((await runtime.survival.observe()).pickupClearance,null);
 } finally {await runtime.close();await rm(directory,{recursive:true,force:true});}
});

test('a prior direct-action movement policy cannot authorize starter clearance before dry rules return',()=>{
 for(const name of ['water','bubble_column','kelp','kelp_plant','seagrass','tall_seagrass']) {
  const f=fixture(1542908414);f.m.blocksToAvoid.delete(f.registry.blocksByName[name].id);
  assert.equal(result(f),null,name);
 }
 const f=fixture(1542908414);f.m.maxDropDown=4;assert.equal(result(f),null);f.m.maxDropDown=3;f.m.canOpenDoors=true;assert.equal(result(f),null);
});


test('terminal pocket reconstruction opens a new standing cell when the only existing endpoint is the origin',()=>{
 const f=fixture('terminal-pocket'),before=JSON.stringify(f.saved),position=f.bot.entity.position.clone(),movement=f.bot.pathfinder.movements;
 assert.match(f.saved.classification,/terminal-world/);
 assert.equal(findPickupClearance(f.bot,f.ids),null,'Tracked pocket headroom is occluded from this reconstructed stage');
 const candidate=result(f);assert.deepEqual(candidate,{x:-23,y:61,z:6,expected_block:'stone'});
 const p=new Vec3(candidate.x,candidate.y,candidate.z),target=p.offset(0,-1,0),origin=position.floored();
 assert.equal(f.bot.blockAt(target).name,'air');assert.equal(f.bot.blockAt(target.offset(0,1,0)).name,'stone');
 assert.ok(visibleBlockFace(f.bot.world,position.offset(0,1.62,0),p,4.2));
 assert.ok(f.saved.trackedDrops.some(d=>target.offset(.5,0,.5).distanceTo(new Vec3(...d.position))<=1.4));
 f.overrides.set(p.toString(),f.registry.blocksByName.air.defaultState);
 for(const [start,end] of [[position,target],[target,origin]]){
  const g=f.bot.pathfinder.getPathFromTo(f.m,start,new pathfinder.goals.GoalBlock(end.x,end.y,end.z),{timeout:1000,tickTimeout:1000,optimizePath:false});
  try{const r=g.next().value.result;assert.equal(r.status,'success');assert.ok(r.path.every(n=>!n.toBreak.length&&!n.toPlace.length&&!n.parkour));}finally{g.return();}
 }
 f.overrides.clear();assert.equal(JSON.stringify(f.saved),before);assert.ok(f.bot.entity.position.equals(position));assert.equal(f.bot.pathfinder.movements,movement);
});

test('new pocket standing cells retain node and time budgets',()=>{
 const f=fixture('terminal-pocket');assert.equal(result(f,{maxNodes:1}),null);
 let t=0;assert.equal(result(f,{now:()=>t+=100,budgetMs:80}),null);
});

test('new pocket standing cells require both walking directions',()=>{
 const f=fixture('terminal-pocket'),origin=f.bot.entity.position.floored(),target=new Vec3(-23,60,6),gate=target.offset(0,1,0),original=f.bot.blockAt;
 f.bot.blockAt=p=>{const b=original(p);return b?new Proxy(b,{get:(o,k)=>k==='diggable'?(o.position.equals(gate)?o.diggable:false):Reflect.get(o,k)}):null;};
 f.m.getNeighbors=function(node){return this.bot.blockAt(gate).name==='air'&&node.equals(origin)?[Object.assign(target.clone(),{remainingBlocks:0,cost:1,toBreak:[],toPlace:[]})]:[];};
 assert.equal(result(f),null);
});

test('new pocket standing cells reject missing support, wet headroom and adjacent fluid',()=>{
 for(const kind of ['support','wet','fluid']){
  const f=fixture('terminal-pocket'),gate=new Vec3(-23,61,6),original=f.bot.blockAt;
  if(kind==='support')f.overrides.set(new Vec3(-23,59,6).toString(),f.registry.blocksByName.air.defaultState);
  if(kind==='fluid')f.overrides.set(gate.offset(1,0,0).toString(),f.registry.blocksByName.water.defaultState);
  f.bot.blockAt=p=>{const b=original(p);return b?new Proxy(b,{get:(o,k)=>k==='diggable'?(o.position.equals(gate)?o.diggable:false):k==='isWaterlogged'&&kind==='wet'&&o.position.equals(gate)?true:Reflect.get(o,k)}):null;};
  assert.equal(result(f),null,kind);
 }
});

function onlyPocketGate(f,gate=new Vec3(-23,61,6)) {
 const original=f.bot.blockAt;
 f.bot.blockAt=p=>{const b=original(p);return b?new Proxy(b,{get:(o,k)=>k==='diggable'?(o.position.equals(gate)?o.diggable:false):Reflect.get(o,k)}):null;};
 return gate;
}

test('new pocket cells reject unknown proximity geometry, invisible gates and unavailable tools',()=>{
 for(const kind of ['unknown','invisible','tool']){
  const f=fixture('terminal-pocket');onlyPocketGate(f);f.ids=[362];
  if(kind==='unknown'){const original=f.bot.blockAt;f.bot.blockAt=p=>p.equals(new Vec3(-23,59,5))?null:original(p);}
  if(kind==='invisible')f.bot.world.raycast=()=>null;
  if(kind==='tool')f.bot.inventory.items=()=>[];
  assert.equal(result(f),null,kind);
 }
});

test('new pocket cells stay near the same tracked item and reject two-edit pockets',()=>{
 for(const kind of ['distance','height','untracked','missing','two-edits']){
  const f=fixture('terminal-pocket');onlyPocketGate(f);f.ids=[362];
  if(kind==='distance')f.bot.entities[362].position.z=4.99;
  if(kind==='height')f.bot.entities[362].position.y=60.6;
  if(kind==='untracked')f.ids=[];
  if(kind==='missing')delete f.bot.entities[362];
  if(kind==='two-edits')f.overrides.set(new Vec3(-23,60,6).toString(),f.registry.blocksByName.stone.defaultState);
  assert.equal(result(f),null,kind);
 }
});

test('a new pickup standing cell can remove a feet obstruction without removing its support',()=>{
 const f=fixture('terminal-pocket'),gate=new Vec3(-23,60,6);f.ids=[362];
 f.overrides.set(gate.toString(),f.registry.blocksByName.stone.defaultState);
 f.overrides.set(gate.offset(0,1,0).toString(),f.registry.blocksByName.air.defaultState);
 onlyPocketGate(f,gate);
 assert.deepEqual(result(f),{x:-23,y:60,z:6,expected_block:'stone'});
 assert.equal(f.bot.blockAt(gate.offset(0,-1,0)).name,'grass_block');
});

test('an existing valid pickup cell prevents needless new pocket excavation',()=>{
 const f=fixture('terminal-pocket');f.ids=[362];onlyPocketGate(f);
 f.overrides.set(new Vec3(-23,61,5).toString(),f.registry.blocksByName.air.defaultState);
 const origin=f.bot.entity.position.floored();
 f.m.getNeighbors=node=>node.equals(origin)?[]:[Object.assign(origin.clone(),{remainingBlocks:0,cost:1,toBreak:[],toPlace:[]})];
 assert.equal(result(f),null);
});


test('pre-existing pickup cells on manufactured solid support veto new pocket excavation',()=>{
 for(const name of ['cobblestone','stone_bricks','crafting_table']){
  const f=fixture('terminal-pocket');f.ids=[362];onlyPocketGate(f);
  f.overrides.set(new Vec3(-23,61,5).toString(),f.registry.blocksByName.air.defaultState);
  f.overrides.set(new Vec3(-23,59,5).toString(),f.registry.blocksByName[name].defaultState);
  assert.equal(result(f),null,name);
 }
});

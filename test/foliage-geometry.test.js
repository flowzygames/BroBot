import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EventEmitter} from 'node:events';
import registryLoader from 'prismarine-registry';
import blockLoader from 'prismarine-block';
import WorldSync from 'prismarine-world/src/worldsync.js';
import pathfinder from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';
import {findTreeFoliage} from '../src/survival-observation.js';
import {WATER_BEARING_BLOCK_NAMES} from '../src/navigation-guards.js';

test('saved canopy geometry exposes the missed later-log leaf and a reversible newly opened cell',()=>{
  const saved=JSON.parse(readFileSync(new URL('./fixtures/foliage-924242050.json',import.meta.url),'utf8'));
  const unchanged=JSON.stringify(saved),registry=registryLoader(saved.minecraftVersion),Block=blockLoader(registry),overrides=new Map();
  const {min,max,size,stateIds}=saved.region;
  const blockAt=value=>{const p=value.floored();if(['x','y','z'].some((k,i)=>p[k]<min[i]||p[k]>max[i]))return null;const key=p.toString(),id=overrides.has(key)?overrides.get(key):stateIds[((p.y-min[1])*size[2]+p.z-min[2])*size[0]+p.x-min[0]];if(id==null)return null;const block=Block.fromStateId(id,0);block.position=p;return block;};
  const world={getBlock:blockAt,raycast:WorldSync.prototype.raycast};
  const bot=Object.assign(new EventEmitter(),{registry,blockAt,world,entity:{position:new Vec3(...saved.bot.position),velocity:new Vec3(...saved.bot.velocity),onGround:true,eyeHeight:saved.bot.eyeHeight,effects:{}},entities:{},inventory:{items:()=>[]},game:{minY:-64,height:384},clearControlStates(){}});
  const logs=saved.observedLogs.map(l=>blockAt(new Vec3(...l.position))),eye=bot.entity.position.offset(0,bot.entity.eyeHeight,0),delta=logs[0].position.offset(.5,.5,.5).minus(eye);
  assert.ok(!/_leaves$/.test(world.raycast(eye,delta.scaled(1/delta.norm()),Math.min(4.2,delta.norm()))?.name??''),'Old first-ray strategy must miss this fixture');
  assert.deepEqual(findTreeFoliage(bot,logs),saved.expectedLeaf);
  assert.equal(JSON.stringify(saved),unchanged);assert.deepEqual(bot.entity.position.toArray(),saved.bot.position);
  pathfinder.pathfinder(bot);const m=new pathfinder.Movements(bot);m.canDig=false;m.allowParkour=false;m.allow1by1towers=false;m.scafoldingBlocks=[];m.maxDropDown=3;
  const home=new Vec3(...saved.bot.homePosition);m.exclusionAreasStep.push(b=>b.position.distanceTo(home)<=90?0:1000);m.exclusionAreasStep.push(b=>b.isWaterlogged?1000:0);
  for(const name of WATER_BEARING_BLOCK_NAMES)if(registry.blocksByName[name])m.blocksToAvoid.add(registry.blocksByName[name].id);
  bot.pathfinder.setMovements(m);
  const p=saved.expectedLeaf;overrides.set(new Vec3(p.x,p.y,p.z).toString(),registry.blocksByName.air.defaultState);
  const target=new Vec3(...saved.targetLanding),origin=bot.entity.position.floored();
  for(const [start,end] of [[bot.entity.position,target],[target,origin]]){
    const generator=bot.pathfinder.getPathFromTo(m,start,new pathfinder.goals.GoalBlock(end.x,end.y,end.z),{timeout:1000,tickTimeout:1000,optimizePath:false});
    try{const result=generator.next().value.result;assert.equal(result.status,'success');assert.ok(result.path.every(n=>!n.toBreak.length&&!n.toPlace.length));}finally{generator.return();}
  }
});

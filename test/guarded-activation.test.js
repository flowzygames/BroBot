import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {confirmSleep,confirmWake} from '../src/guarded-activation.js';
import {visibleInteractionFace,interactionVisible} from '../src/guarded-activation.js';
import {InteractionGoal,visibleBlockFace} from '../src/actions.js';
import WorldSync from 'prismarine-world/src/worldsync.js';
import prismarineBlock from 'prismarine-block';
import minecraftData from 'minecraft-data';
import {Vec3} from 'vec3';
test('interaction rays reach noncolliding controls while mining rays remain strict',()=>{
 const registry=minecraftData('1.21.8'),Block=prismarineBlock('1.21.8'),target=new Vec3(3,64,0),eye=new Vec3(.5,65.62,.5);
 for(const name of ['lever','stone_button']){
  let occluded=false;
  const getBlock=p=>{p=p.floored();const type=p.equals(target)?name:occluded&&p.x===1&&p.z===0&&(p.y===64||p.y===65)?'stone':'air';const block=Block.fromStateId(registry.blocksByName[type].defaultState,0);block.position=p;return block;};
  const world={getBlock,raycast:WorldSync.prototype.raycast};
  assert.deepEqual(getBlock(target).shapes,[]);
  assert.equal(visibleBlockFace(world,eye,target),false);
  assert.equal(visibleInteractionFace(world,eye,target),true);
  const goal=new InteractionGoal(target,world);assert.equal(goal.isEnd(new Vec3(0,64,0)),true);
  occluded=true;assert.equal(visibleInteractionFace(world,eye,target),false);assert.equal(goal.isEnd(new Vec3(0,64,0)),false);
  assert.equal(interactionVisible({entity:{position:new Vec3(.5,64,.5),eyeHeight:1.62},world},getBlock(target)),false);
 }
});
test('sleep acknowledgement cleans up after timeout, abort, session change and send failure',async()=>{
 for(const mode of ['timeout','abort','respawn','spawn','end','send']){
  const bot=new EventEmitter(),controller=new AbortController();
  const promise=confirmSleep(bot,()=>{if(mode==='send')throw Error('send failed');},{signal:controller.signal,check:()=>{},timeoutMs:20});
  const rejected=assert.rejects(promise);
  if(mode==='abort')controller.abort();
  if(['respawn','spawn','end'].includes(mode))bot.emit(mode);
  await rejected;for(const e of ['sleep','respawn','spawn','end'])assert.equal(bot.listenerCount(e),0,mode);
 }
});
test('wake confirmation requires observed awake state and cleans every termination',async()=>{
 for(const mode of ['success','wrong-state','timeout','abort','respawn','spawn','end','send']){
  const bot=Object.assign(new EventEmitter(),{isSleeping:true}),controller=new AbortController();
  const pending=confirmWake(bot,()=>{if(mode==='send')throw Error('send failed');},{signal:controller.signal,check:()=>{},timeoutMs:20});
  const outcome=mode==='success'?pending:assert.rejects(pending);
  if(mode==='success'){bot.isSleeping=false;bot.emit('wake');}
  if(mode==='wrong-state')bot.emit('wake');
  if(mode==='abort')controller.abort();
  if(['respawn','spawn','end'].includes(mode))bot.emit(mode);
  await outcome;for(const e of ['wake','sleep','respawn','spawn','end'])assert.equal(bot.listenerCount(e),0,mode);
 }
});
test('invalid sleep-state confirmation inputs install no listeners',()=>{
 const bot=new EventEmitter();assert.throws(()=>confirmWake(bot,()=>{},{signal:{},check:()=>{}}),/Invalid/);assert.equal(bot.eventNames().length,0);
});

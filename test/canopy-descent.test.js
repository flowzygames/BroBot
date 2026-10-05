import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import registryLoader from 'prismarine-registry';
import blockLoader from 'prismarine-block';
import WorldSync from 'prismarine-world/src/worldsync.js';
import pf from 'mineflayer-pathfinder';
import {planLeafNotch} from '../src/canopy-descent.js';
import {WATER_BEARING_BLOCK_NAMES} from '../src/navigation-guards.js';
function fixture(){
 const registry=registryLoader('1.21.8'),Block=blockLoader(registry),cells=new Map([['0,1,0','spruce_leaves'],['1,1,0','spruce_leaves'],['0,0,0','spruce_log'],['1,0,0','spruce_log']]);
 const blockAt=value=>{const p=value.floored(),name=cells.get(p.toArray().join(','))??'air',b=name==='wet_stairs'?Block.fromProperties(registry.blocksByName.oak_stairs.id,{waterlogged:'true',half:'top',facing:'east',shape:'straight'},0):Block.fromStateId(registry.blocksByName[name].defaultState,0);b.position=p;return b;};
 const bot=Object.assign(new EventEmitter(),{registry,blockAt,world:{getBlock:blockAt,raycast:WorldSync.prototype.raycast},entity:{position:new Vec3(.5,2,.5),velocity:new Vec3(0,0,0),onGround:true,eyeHeight:1.62,effects:{}},entities:{},inventory:{items:()=>[]},game:{minY:-64,height:384},clearControlStates(){}});
 pf.pathfinder(bot);const m=new pf.Movements(bot);m.canDig=false;m.allowParkour=false;m.allow1by1towers=false;m.scafoldingBlocks=[];m.maxDropDown=3;
 for(const n of WATER_BEARING_BLOCK_NAMES)if(registry.blocksByName[n])m.blocksToAvoid.add(registry.blocksByName[n].id);
 bot.pathfinder.setMovements(m);return{bot,cells};
}
test('proposes an observed one-leaf descent with a real bidirectional home route',async()=>{
 const {bot,cells}=fixture(),before=JSON.stringify([...cells]);
 const plan=await planLeafNotch(bot,{x:0,y:2,z:0});
 assert.ok(plan);assert.deepEqual(plan.landing,[1,1,0]);assert.deepEqual(plan.dig,{x:1,y:1,z:0,expected_block:'spruce_leaves'});
 assert.equal(plan.routes.length,3);assert.ok(plan.protectedBlocks.some(p=>p.join(',')==='0,0,0'));
 assert.equal(JSON.stringify([...cells]),before);assert.deepEqual(bot.entity.position.toArray(),[.5,2,.5]);
});
test('refuses a landing with no support or disconnected home',async()=>{
 const {bot,cells}=fixture();cells.delete('1,0,0');assert.equal(await planLeafNotch(bot,{x:0,y:2,z:0}),null);
 assert.equal(await planLeafNotch(bot,{x:8,y:2,z:0}),null);
});
test('refuses relaxed movement, airborne starts and exhausted planning budgets',async()=>{
 const {bot}=fixture();bot.entity.onGround=false;assert.equal(await planLeafNotch(bot,{x:0,y:2,z:0}),null);
 bot.entity.onGround=true;bot.pathfinder.movements.canDig=true;assert.equal(await planLeafNotch(bot,{x:0,y:2,z:0}),null);
 bot.pathfinder.movements.canDig=false;assert.equal(await planLeafNotch(bot,{x:0,y:2,z:0},{budgetMs:0}),null);
});
test('cancelled planning fails before changing the world',async()=>{
 const {bot}=fixture();const controller=new AbortController();controller.abort();await assert.rejects(planLeafNotch(bot,{x:0,y:2,z:0},{signal:controller.signal}),{name:'AbortError'});
});

test('standalone return corridor rejects waterlogged non-leaf stairs', async()=>{
 const {bot,cells}=fixture();cells.set('-2,1,0','stone');cells.set('-1,1,0','wet_stairs');
 assert.equal(await planLeafNotch(bot,{x:-2,y:2,z:0}),null);
});

import {createActions} from '../src/actions.js';
import {terrainTrustStatus} from '../src/terrain-trust.js';
function actionFixture(){
 const {bot,cells}=fixture();bot.version='1.21.8';bot._client=new EventEmitter();bot.game.dimension='overworld';bot.digTime=()=>0;bot.health=20;bot.food=20;bot.setControlState=()=>{};bot.stopDigging=()=>{};bot.deactivateItem=()=>{};bot.lookAt=async()=>{};
 const item={name:'shears',type:bot.registry.itemsByName.shears.id,count:1};bot.inventory.items=()=>[item];bot.equip=async i=>{bot.heldItem=i;};bot.canDigBlock=()=>true;
 return{bot,cells};
}
test('descent admits mining against its local twenty-second deadline too',async()=>{
 const {bot}=actionFixture();let digs=0;bot.digTime=()=>15000;bot.dig=async()=>{digs++};
 await assert.rejects(createActions(bot).execute('descend_notch',{},undefined,{jobDeadline:performance.now()+60000,actionDeadline:performance.now()+60000}),{code:'MINING_DEADLINE_INSUFFICIENT'});
 assert.equal(digs,0);assert.equal(terrainTrustStatus(bot).trusted,true);
});
// Drift away from the leaf so the stage guard is exercised independently of the footprint guard.
test('descent rechecks stage after equipping and never digs from a drifting pose',async()=>{
 const {bot}=actionFixture(),listeners=bot.listenerCount('blockUpdate');let digs=0;bot.dig=async()=>{digs++;};bot.equip=async i=>{bot.heldItem=i;bot.entity.position=bot.entity.position.offset(-.3,0,0);};
 await assert.rejects(createActions(bot).execute('descend_notch',{}),/certified descent stage/);
 assert.equal(digs,0);assert.equal(bot.listenerCount('blockUpdate'),listeners);
});
test('cancelling descent during mining stops digging and drains the action',async()=>{
 const {bot}=actionFixture(),controller=new AbortController(),listeners=bot.listenerCount('blockUpdate');let stopped=0,finish;
 bot.dig=()=>new Promise(resolve=>{finish=resolve;queueMicrotask(()=>controller.abort());});
 bot.stopDigging=()=>{stopped++;finish?.();};
 await assert.rejects(createActions(bot).execute('descend_notch',{},controller.signal),{code:'MINING_UNCONFIRMED'});
 assert.equal(terrainTrustStatus(bot).trusted,false);
 assert.ok(stopped>0);assert.equal(bot.listenerCount('blockUpdate'),listeners);
});

test('descent refuses departure if mining invalidates the home support',async()=>{
 const {bot,cells}=actionFixture(),listeners=bot.listenerCount('blockUpdate');let mined=0;
 bot.dig=async block=>{mined++;bot._client.emit('packet',{location:block.position,type:0},{name:'block_change'});cells.delete('1,1,0');cells.delete('0,0,0');};
 await assert.rejects(createActions(bot).execute('descend_notch',{}),/anchor|protected log|corridor geometry/i);
 assert.equal(mined,1);assert.deepEqual(bot.entity.position.toArray(),[.5,2,.5]);assert.equal(bot.listenerCount('blockUpdate'),listeners);
});

test('descent revalidates non-leaf corridor geometry after the equip await',async()=>{
 const {bot,cells}=actionFixture();let digs=0;
 bot.dig=async()=>{digs++;};bot.equip=async i=>{bot.heldItem=i;cells.set('0,0,0','wet_stairs');};
 await assert.rejects(createActions(bot).execute('descend_notch',{}),/corridor geometry/);
 assert.equal(digs,0);
});

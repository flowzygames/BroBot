import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { Vec3 } from 'vec3'
import registryLoader from 'prismarine-registry'
import blockLoader from 'prismarine-block'
import pf from 'mineflayer-pathfinder'
import { BlockFaceGoal, MiningFaceGoal } from '../src/actions.js'
import { inspectMiningGoalSpace } from '../src/mining-goal-space.js'
const require=createRequire(import.meta.url),WorldSync=require('prismarine-world/src/worldsync.js')
const registry=registryLoader('1.21.8'),Block=blockLoader(registry)
function fixture(open=false){
 const cells=new Map(),target=new Vec3(0,64,0)
 const blockAt=p=>{p=p.floored();const name=cells.has(p.toString())?cells.get(p.toString()):(open?'air':'stone');if(name===null)return null;const b=Block.fromStateId(registry.blocksByName[name].defaultState,0);b.position=p;return b}
 cells.set(target.toString(),'stone');cells.set(target.offset(0,1,0).toString(),'air')
 const bot={version:'1.21.8',registry,blockAt,entity:{position:new Vec3(20,64,0)},inventory:{items:()=>[]},game:{minY:-64,height:384}}
 bot.world={getBlock:blockAt,raycast:WorldSync.prototype.raycast}
 const movements=new pf.Movements(bot);Object.assign(movements,{canDig:false,allowParkour:false,allow1by1towers:false,allowFreeMotion:false,scafoldingBlocks:[]})
 const goal=new BlockFaceGoal(target,bot.world,{reach:4,eyeHeight:1.62})
 return{bot,movements,goal,cells,target,run:options=>inspectMiningGoalSpace(bot,movements,goal,{budgetMs:1000,...options})}
}
test('sealed single-cell pocket has no goal space; an open target remains possible',()=>{
 assert.equal(fixture().run().status,'none');assert.equal(fixture(true).run().status,'possible')
})
test('partial shapes and climbable ambiguity defer to normal planning',()=>{
 for(const name of ['oak_slab','oak_stairs','white_carpet','oak_fence','ladder']){
  const f=fixture();f.cells.set(f.target.offset(0,1,0).toString(),name);assert.equal(f.run().status,'unknown',name)
 }
 const f=fixture(),read=f.bot.blockAt;f.bot.blockAt=p=>{if(p.floored().equals(f.target.offset(0,1,0))){const b=Block.fromProperties('snow',{layers:'3'},0);b.position=p.floored();return b}return read(p)};assert.equal(f.run().status,'unknown')
})
test('noncolliding single-layer snow remains possible space rather than a solid obstruction',()=>{
 const f=fixture(true);f.cells.set(f.target.offset(1,0,0).toString(),'snow');assert.equal(f.run().status,'possible')
})
test('a raised fractional-height initial node is never rejected',()=>{
 const f=fixture();f.bot.entity.position.y+=.5;f.bot.entity.onGround=true
 f.goal.isEnd=node=>node.equals(f.bot.entity.position.floored().offset(0,1,0));assert.equal(f.run().status,'possible')
})
test('missing cells and exhausted observation budget cannot prove rejection',()=>{
 const f=fixture();f.cells.set(f.target.offset(0,1,0).toString(),null);assert.equal(f.run().status,'unknown')
 let now=0;assert.equal(fixture().run({budgetMs:5,now:()=>now++}).status,'unknown')
 const failed=fixture();failed.bot.blockAt=()=>{throw Error('chunk unavailable')};assert.equal(failed.run().status,'unknown')
})
test('an initial goal node is preserved even before movement occupancy checks',()=>{
 const f=fixture();f.goal.isEnd=node=>node.equals(f.bot.entity.position.floored());assert.deepEqual(f.run(),{status:'possible',initial:true})
})
test('nonstandard eye height and unsupported policy cannot produce an unsafe veto',()=>{
 const f=fixture(true);f.goal.eyeHeight=.5;assert.equal(f.run().status,'possible')
 f.goal.eyeHeight=9;assert.equal(f.run().status,'unknown');f.goal.eyeHeight=1.62;f.movements.canDig=true;assert.equal(f.run().status,'unknown')
})
test('goal-space observation honors cancellation and safely defers asynchronous ray implementations',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort(Error('Stop observation'))
 assert.throws(()=>f.run({signal:controller.signal}),/Stop observation/)
 const open=fixture(true);open.bot.world.raycast=async()=>null;assert.equal(open.run().status,'unknown')
 open.bot.world.raycast=async()=>{throw Error('unsupported async ray failure')};assert.equal(open.run().status,'unknown');await new Promise(resolve=>setImmediate(resolve))
})
test('three saved natural-world air pockets have no interaction goal space',()=>{
 const data=JSON.parse(readFileSync(new URL('./fixtures/mining-stance-154.json',import.meta.url)))
 const f=fixture(),cells=new Map(data.cells.map(([x,y,z,state])=>[[x,y,z].join(','),state]));let unknown=0
 f.bot.entity.position=new Vec3(...data.origin)
 for(const name of data.movement.avoidBlocks)if(registry.blocksByName[name])f.movements.blocksToAvoid.add(registry.blocksByName[name].id)
 f.bot.blockAt=p=>{p=p.floored();const state=cells.get(p.toArray().join(','));if(state===undefined||state===null){unknown++;return null}const b=Block.fromStateId(state,0);b.position=p;return b}
 f.bot.world.getBlock=f.bot.blockAt
 for(const target of data.targets){
  const goal=new BlockFaceGoal(new Vec3(...target),f.bot.world,data.goal)
  const result=inspectMiningGoalSpace(f.bot,f.movements,goal,{budgetMs:1000})
  assert.equal(result.status,'none',target.join(','));assert.equal(unknown,0)
 }
})

function shaftFixture(){
 const f=fixture();
 for(let y=50;y<=68;y++)f.cells.set(new Vec3(1,y,0).toString(),'air');
 return f;
}
test('unsupported air stances cannot defeat the rejection-only mining preflight',()=>{
 const f=shaftFixture();assert.equal(f.run().status,'none');
 f.cells.set(new Vec3(1,63,0).toString(),'stone');assert.equal(f.run().status,'possible');
});
test('partial missing and climbable stance supports defer rather than proving rejection',()=>{
 for(const name of [null,'oak_slab','ladder']){
  const f=shaftFixture();f.cells.set(new Vec3(1,63,0).toString(),name);assert.equal(f.run().status,'unknown',String(name));
 }
});
test('liquid-foot successors defer when the movement policy allows them',()=>{
 const f=shaftFixture();f.cells.set(new Vec3(1,64,0).toString(),'water');
 assert.equal(f.run().status,'unknown');
});
test('scaffolding-capable movement policy cannot prove an empty stance set',()=>{
 const f=shaftFixture();f.movements.scafoldingBlocks=[registry.itemsByName.dirt.id];
 assert.equal(f.run().status,'unknown');
});
test('a matching initial node remains exempt even when its support is absent',()=>{
 const f=shaftFixture();f.bot.entity.position=new Vec3(1.5,64,.5);
 assert.deepEqual(f.run(),{status:'possible',initial:true});
});

test('mining-specific goal rejects its own support while generic visibility remains unchanged',()=>{
 const target=new Vec3(0,64,0),world={raycast:()=>({position:target})};
 const generic=new BlockFaceGoal(target,world,{reach:4}),mining=new MiningFaceGoal(target,world,{reach:4});
 for(const y of [65,66]){
  const node=new Vec3(0,y,0);assert.equal(generic.isEnd(node),true);assert.equal(mining.isEnd(node),false);
 }
 assert.equal(mining.isEnd(new Vec3(1,64,0)),true);
});
test('self-support-only mining pocket is rejected but adjacent supported stance stays possible',()=>{
 const f=fixture();for(let y=65;y<=72;y++)f.cells.set(new Vec3(0,y,0).toString(),'air');
 const mining=new MiningFaceGoal(f.target,f.bot.world,{reach:4,eyeHeight:1.62});
 const run=()=>inspectMiningGoalSpace(f.bot,f.movements,mining,{budgetMs:1000});
 assert.equal(f.run().status,'possible');assert.equal(run().status,'none');
 f.bot.entity.position=new Vec3(.5,65,.5);assert.equal(run().status,'none','initial visibility cannot override the existing underfoot mining refusal');
 f.bot.entity.position=new Vec3(20,64,0);f.cells.set(new Vec3(1,64,0).toString(),'air');f.cells.set(new Vec3(1,65,0).toString(),'air');
 assert.equal(run().status,'possible');
});

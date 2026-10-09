import test from 'node:test';
import assert from 'node:assert/strict';
import {Vec3} from 'vec3';
import {visibleBlockFace,BlockFaceGoal} from '../src/actions.js';

const directions=[new Vec3(0,-1,0),new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,0,1),new Vec3(0,0,-1),new Vec3(0,1,0)];
// Frozen pre-optimization algorithm: the oracle deliberately performs every
// center construction and uses the original narrow-phase reach/raycast checks.
function legacy(world,eye,target,reach=4.5){
 const centers=[target.offset(.5,.5,.5),...directions.map(d=>target.offset(.5+d.x*.499,.5+d.y*.499,.5+d.z*.499))];
 for(const center of centers){
  const delta=center.minus(eye),distance=delta.norm();
  if(distance>reach||distance<.001)continue;
  const hit=world.raycast(eye,delta.scaled(1/distance),Math.min(reach,distance+.01));
  if(hit?.position?.equals(target))return true;
 }
 return false;
}
function probe(fn,eye,target,reach,hitAt){
 const calls=[];
 const result=fn({raycast:(p,d,r)=>{calls.push([p.x,p.y,p.z,d.x,d.y,d.z,r]);return calls.length===hitAt?{position:target}:hitAt===0?null:{position:target.offset(1,0,0)}}},eye,target,reach);
 return {result,calls};
}
function compare(eye,target,reach){
 for(const hitAt of [0,1,4,8])assert.deepEqual(probe(visibleBlockFace,eye,target,reach,hitAt),probe(legacy,eye,target,reach,hitAt));
}

test('block face broad phase preserves legacy results and exact rays across coordinate grids',()=>{
 for(const target of [new Vec3(0,64,0),new Vec3(-12,70,-9),new Vec3(29999980,64,-29999980)])
  for(const reach of [4,4.5])for(const y of [-6,-2,-.001,0,1.62,5])for(let x=-8;x<=8;x+=2)for(let z=-8;z<=8;z+=2)
   compare(target.offset(x+.37,y,z+.61),target,reach);
});

test('block face reach boundaries keep face edge corner and fractional negative cases',()=>{
 for(const target of [new Vec3(0,0,0),new Vec3(-.75,-64.25,-1.5),new Vec3(-29999980,2047,29999980)])for(const reach of [0,.001,1,4.2,4.5]){
  for(const center of [target.offset(.5,.5,.5),...directions.map(d=>target.offset(.5+d.x*.499,.5+d.y*.499,.5+d.z*.499))]){
   for(const direction of [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(1,1,0).unit(),new Vec3(-1,1,-1).unit()])
    for(const epsilon of [-1e-8,0,1e-8])compare(center.plus(direction.scaled(reach+epsilon)),target,reach);
  }
 }
});

test('far block-face probes avoid target center allocations and perform no rays',()=>{
 const target=new Vec3(3,64,-7);let offsets=0,rays=0;
 const original=target.offset.bind(target);target.offset=(...args)=>{offsets++;return original(...args)};
 const world={raycast:()=>{rays++;return{position:target}}};
 for(const eye of [new Vec3(-100,64,0),new Vec3(3,100,0),new Vec3(3,64,100)])assert.equal(visibleBlockFace(world,eye,target),false);
 assert.equal(offsets,0);assert.equal(rays,0);
});

test('visibility remains live after an occluder changes and never caches a near result',()=>{
 const target=new Vec3(2,64,0),eye=new Vec3(.5,65.62,.5);let blocked=true,calls=0;
 const world={raycast:()=>{calls++;return{position:blocked?target.offset(-1,0,0):target}}};
 assert.equal(visibleBlockFace(world,eye,target),false);const old=calls;blocked=false;
 assert.equal(visibleBlockFace(world,eye,target),true);assert.ok(calls>old);
 blocked=true;assert.equal(visibleBlockFace(world,eye,target),false);
});

test('BlockFaceGoal still uses current player eye height and original ray semantics',()=>{
 const target=new Vec3(16,68,-6),node=new Vec3(16,65,-4),eyeHeight=1.62,reach=4;const calls=[];
 const world={raycast:(p,d,r)=>{calls.push([p.x,p.y,p.z,d.x,d.y,d.z,r]);return{position:target}}};
 assert.equal(new BlockFaceGoal(target,world,{eyeHeight,reach}).isEnd(node),true);
 assert.deepEqual(calls,probe(legacy,node.offset(.5,eyeHeight,.5),target,reach,1).calls);
});

test('non-finite or coerced reach retains legacy fallback behavior',()=>{
 const target=new Vec3(-12,64,-4),eye=target.offset(2,1.62,0);
 for(const reach of [Infinity,NaN,'4.5',undefined,-1])compare(eye,target,reach);
});

test('deterministic node grid reduces target offsets without changing any rays',()=>{
 let oldOffsets=0,newOffsets=0,oldRays=0,newRays=0;
 for(let x=-16;x<=16;x++)for(let z=-16;z<=16;z++){
  const eye=new Vec3(x+.5,65.62,z+.5);
  for(const [fn,isNew] of [[legacy,false],[visibleBlockFace,true]]){
   const target=new Vec3(0,64,0),offset=target.offset.bind(target);
   target.offset=(...args)=>{if(isNew)newOffsets++;else oldOffsets++;return offset(...args)};
   const world={raycast:()=>{if(isNew)newRays++;else oldRays++;return null}};
   assert.equal(fn(world,eye,target,4.5),false);
  }
 }
 assert.equal(newRays,oldRays);assert.ok(oldRays>0);
 assert.equal(oldOffsets,1089*7);assert.ok(newOffsets<oldOffsets/4);
});

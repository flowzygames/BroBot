import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import registryLoader from 'prismarine-registry';
import blockLoader from 'prismarine-block';
import WorldSync from 'prismarine-world/src/worldsync.js';
import { visiblePlacementFace } from '../src/construction-guards.js';
const registry = registryLoader('1.21.8'), Block = blockLoader(registry);
function fixture(extra = []) {
  const solids = new Set(['0,0,0', ...extra]);
  const getBlock = v => { const p = v.floored(); const b = Block.fromStateId(registry.blocksByName[solids.has(p.toArray().join(',')) ? 'stone' : 'air'].defaultState, 0); b.position = p; return b; };
  return { world: { getBlock, raycast: WorldSync.prototype.raycast }, reference: getBlock(new Vec3(0, 0, 0)) };
}
test('specific full-cube attachment face is visible from each outward side', () => {
  const { world, reference } = fixture();
  for (const f of [new Vec3(1,0,0),new Vec3(-1,0,0),new Vec3(0,1,0),new Vec3(0,-1,0),new Vec3(0,0,1),new Vec3(0,0,-1)]) {
    const eye = new Vec3(.5,.5,.5).plus(f.scaled(2));
    assert.equal(visiblePlacementFace(world, eye, reference, f), true);
    assert.equal(visiblePlacementFace(world, eye, reference, f.scaled(-1)), false);
  }
});
test('a visible reference does not authorize its hidden underside', () => {
  const { world, reference } = fixture();
  assert.equal(visiblePlacementFace(world,new Vec3(.5,3,.5),reference,new Vec3(0,-1,0)),false);
});
test('an intervening block rejects the requested face', () => {
  const { world, reference } = fixture(['0,0,-1']);
  assert.equal(visiblePlacementFace(world,new Vec3(.5,.5,-2),reference,new Vec3(0,0,-1)),false);
});
test('placement reach and malformed faces fail closed', () => {
  const { world, reference } = fixture();
  for (const face of [new Vec3(1,1,0),new Vec3(0,0,0),new Vec3(.5,0,0)]) assert.equal(visiblePlacementFace(world,new Vec3(2,.5,.5),reference,face),false);
  assert.equal(visiblePlacementFace(world,new Vec3(6,.5,.5),reference,new Vec3(1,0,0)),false);
});
test('partial collision shapes and missing raycasts fail closed', () => {
  const { world, reference } = fixture();
  assert.equal(visiblePlacementFace({},new Vec3(2,.5,.5),reference,new Vec3(1,0,0)),false);
  assert.equal(visiblePlacementFace(world,new Vec3(2,.5,.5),{...reference,shapes:[[0,0,0,1,.5,1]]},new Vec3(1,0,0)),false);
});

import { retainedLeafAnchor } from '../src/construction-guards.js';
function leafChain(length, removed = null) {
  return p => {
    if (p.y !== 0 || p.z !== 0 || p.x < 0 || p.x > length || p.x === removed) return {name:'air',boundingBox:'empty'};
    return {name:p.x===length?'spruce_log':'spruce_leaves',boundingBox:'block',isWaterlogged:false};
  };
}
test('retained leaf support needs a concrete log within six leaf steps', () => {
  assert.deepEqual(retainedLeafAnchor(leafChain(6),new Vec3(0,0,0)),{leaves:[[0,0,0],[1,0,0],[2,0,0],[3,0,0],[4,0,0],[5,0,0]],anchor:[6,0,0],distance:6});
  assert.equal(retainedLeafAnchor(leafChain(7),new Vec3(0,0,0)),null);
});
test('removing a connector or the anchor invalidates the corridor support', () => {
  assert.equal(retainedLeafAnchor(leafChain(5,3),new Vec3(0,0,0)),null);
  assert.equal(retainedLeafAnchor(leafChain(5,5),new Vec3(0,0,0)),null);
});
test('leaf proof is bounded and refuses waterlogged or unknown floors', () => {
  assert.equal(retainedLeafAnchor(leafChain(6),new Vec3(0,0,0),{maxNodes:2}),null);
  assert.equal(retainedLeafAnchor(()=>null,new Vec3(0,0,0)),null);
  assert.equal(retainedLeafAnchor(()=>({name:'spruce_leaves',boundingBox:'block',isWaterlogged:true}),new Vec3(0,0,0)),null);
});

import {readFileSync} from 'node:fs';
test('real canopy supports retain verified anchors across every four-dig prefix',()=>{
 const saved=JSON.parse(readFileSync(new URL('./fixtures/leaf-anchor-four-dig.json',import.meta.url),'utf8'));
 const overrides=new Set(),{min,max,size,stateIds}=saved.region;
 const read=p=>{const q=p.floored(),a=q.toArray();if(a.some((n,i)=>n<min[i]||n>max[i]))return null;const id=overrides.has(a.join(','))?registry.blocksByName.air.defaultState:stateIds[((q.y-min[1])*size[2]+q.z-min[2])*size[0]+q.x-min[0]];const b=Block.fromStateId(id,0);b.position=q;return b;};
 for(const stage of saved.expectedStages){
   if(stage.afterRemovals)overrides.add(saved.removals[stage.afterRemovals-1].join(','));
   for(const item of stage.protected)assert.deepEqual(retainedLeafAnchor(read,new Vec3(...item.support)),item.proof);
 }
 const allRemoved=new Set(saved.removals.map(a=>a.join(',')));
 for(const item of saved.expectedStages.at(-1).protected){
   assert.ok(!allRemoved.has(item.proof.anchor.join(',')));
   assert.ok(item.proof.leaves.every(a=>!allRemoved.has(a.join(','))));
 }
});

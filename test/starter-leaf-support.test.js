import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { assertStarterLeafSupport, hasAnchoredLeafLanding, STARTER_SUPPORT_PROTECTED } from '../src/starter-leaf-support.js';

test('pickup leaf footprint requires a current anchor across height jitter and adjacent cells',()=>{
 const f=fixture();
 for(const y of [63.98,64,64.02])assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(.5,y,.5)),true);
 f.cells.delete(f.target.position.toString());
 for(const y of [63.98,64,64.02])assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(.5,y,.5)),false);
 f.put('stone',-1,63,0);
 assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(-.05,64,.5)),false);
 assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(-.5,64,.5)),true);
});

test('pickup leaf footprint fails closed on missing cells, failed reads and invalid geometry',()=>{
 const f=fixture();
 f.bot.blockAt=()=>null;assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(.5,64,.5)),false);
 f.bot.blockAt=()=>{throw Error('unloaded')};assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(.5,64,.5)),false);
 assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(NaN,64,.5)),false);
 f.bot.physics={playerHalfWidth:10};assert.equal(hasAnchoredLeafLanding(f.bot,new Vec3(.5,64,.5)),false);
});
function fixture(){
 const cells=new Map();const put=(name,x,y,z)=>{const b={name,position:new Vec3(x,y,z),boundingBox:name==='air'?'empty':'block',isWaterlogged:false};cells.set(b.position.toString(),b);return b;};
 put('oak_leaves',0,63,0);put('oak_leaves',1,63,0);const target=put('oak_log',2,63,0);
 const bot={entity:{position:new Vec3(10.5,64,.5),onGround:true},blockAt:p=>cells.get(p.toString())??{name:'air',boundingBox:'empty',position:p}};
 return{bot,cells,put,target,home:{x:.5,y:64,z:.5}};
}
const refuses=fn=>assert.throws(fn,{code:STARTER_SUPPORT_PROTECTED});
test('refuses removing the final saved-home leaf anchor but permits an independent retained anchor',()=>{
 const f=fixture();refuses(()=>assertStarterLeafSupport(f.bot,f.target,{home:f.home}));
 f.put('oak_leaves',1,63,1);f.put('oak_log',2,63,1);
 assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,f.target,{home:f.home}));
});
test('leaf connectors receive the same protection as logs',()=>{
 const f=fixture(),connector=f.bot.blockAt(new Vec3(1,63,0));
 refuses(()=>assertStarterLeafSupport(f.bot,connector,{home:f.home}));
 f.put('oak_leaves',0,63,1);f.put('oak_leaves',1,63,1);f.put('oak_log',2,63,1);
 assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,connector,{home:f.home}));
});
test('protects current grounded footprint before it is recorded as a between-action waypoint',()=>{
 const f=fixture();f.bot.entity.position=new Vec3(.5,64,.5);
 refuses(()=>assertStarterLeafSupport(f.bot,f.target,{home:{x:10.5,y:64,z:.5}}));
 f.bot.entity.onGround=false;
 assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,f.target,{home:{x:10.5,y:64,z:.5}}));
});
test('retained actual positions protect their support while fractional or explicitly airborne observations do not',()=>{
 const f=fixture(),home={x:10.5,y:64,z:.5};
 refuses(()=>assertStarterLeafSupport(f.bot,f.target,{home,positions:[f.home]}));
 for(const point of [{...f.home,y:64.54},{...f.home,onGround:false}])assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,f.target,{home,positions:[point]}));
});
test('standing-height jitter and footprint edges preserve adjacent supports',()=>{
 const f=fixture();
 for(const y of [63.98,64,64.02])refuses(()=>assertStarterLeafSupport(f.bot,f.target,{home:{x:.9,y,z:.5}}));
});
test('negative coordinates retain exact support geometry',()=>{
 const f=fixture();f.cells.clear();f.put('oak_leaves',-3,63,-1);f.put('oak_leaves',-2,63,-1);const target=f.put('oak_log',-1,63,-1);
 refuses(()=>assertStarterLeafSupport(f.bot,target,{home:{x:-2.5,y:64,z:-.5}}));
});
test('unloaded relevant support and broken block reads fail closed with typed refusal',()=>{
 const f=fixture();f.bot.blockAt=()=>null;refuses(()=>assertStarterLeafSupport(f.bot,f.target,{home:f.home}));
 f.bot.blockAt=()=>{throw Error('unloaded');};refuses(()=>assertStarterLeafSupport(f.bot,f.target,{home:f.home}));
});
test('irrelevant materials, distant targets and already absent supports are not called retained anchors',()=>{
 const f=fixture();assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,{...f.target,name:'stone'},{}));
 assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,{...f.target,position:new Vec3(20,63,0)},{home:f.home}));
 f.cells.delete('0, 63, 0');f.put('air',0,63,0);
 assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,f.target,{home:f.home}));
});
test('support evidence and target inputs stay bounded',()=>{
 const f=fixture();
 for(const options of [{home:null},{home:f.home,positions:Array(129).fill(f.home)}])refuses(()=>assertStarterLeafSupport(f.bot,f.target,options));
 refuses(()=>assertStarterLeafSupport(f.bot,{name:'oak_log'},{home:f.home}));
 assert.doesNotThrow(()=>assertStarterLeafSupport(f.bot,f.target,{home:{x:10.5,y:64,z:.5},positions:[{x:Infinity,y:64,z:0}]}));
});

test('live grounded footprint stays protected inside stop margin beyond the waypoint radius',()=>{
 const f=fixture();f.cells.clear();f.bot.entity.position=new Vec3(257.5,64,.5);
 f.put('oak_leaves',257,63,0);f.put('oak_leaves',256,63,0);const target=f.put('oak_log',255,63,0);
 refuses(()=>assertStarterLeafSupport(f.bot,target,{home:{x:.5,y:64,z:.5}}));
});

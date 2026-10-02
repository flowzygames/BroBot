import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { findPickupClearance, findTreeFoliage, hasPowderSnowContact } from '../src/survival-observation.js';
function fixture() {
  const blocks = new Map();
  const bot = { entity: { position: new Vec3(0.5, 64, 0.5) }, entities: { 10: { id: 10, name: 'item', position: new Vec3(2.5, 63, 0.5) } }, world: { raycast: () => ({ position: new Vec3(2, 64, 0) }) } };
  bot.blockAt = p => blocks.get(p.toString()) ?? { name: 'air', boundingBox: 'empty', position: p };
  const put = (name, y) => blocks.set(new Vec3(2, y, 0).toString(), { name, boundingBox: 'block', position: new Vec3(2, y, 0) });
  put('stone', 62); put('stone', 64);
  return { bot, put };
}
test('pickup recovery identifies reachable headroom above a tracked drop', () => {
  const { bot } = fixture();
  assert.deepEqual(findPickupClearance(bot, [10]), { x: 2, y: 64, z: 0, expected_block: 'stone' });
  assert.equal(findPickupClearance(bot, [99]), null);
});
test('pickup recovery never clears containers, ores or unknown materials', () => {
  for (const name of ['chest', 'furnace', 'diamond_ore', 'water', 'gravel']) {
    const { bot, put } = fixture(); put(name, 64);
    assert.equal(findPickupClearance(bot, [10]), null);
  }
});
test('pickup recovery refuses dangerous support, unseen blocks and support under the bot', () => {
  const a = fixture(); a.put('magma_block', 62); assert.equal(findPickupClearance(a.bot, [10]), null);
  const b = fixture(); b.bot.world.raycast = () => null; assert.equal(findPickupClearance(b.bot, [10]), null);
  const c = fixture(); c.bot.entity.position = new Vec3(2.05, 65, 0.5); assert.equal(findPickupClearance(c.bot, [10]), null);
});

test('pickup recovery can clear a second overhead block needed for a return jump', () => {
  const { bot, put } = fixture(); put('air', 64); put('stone', 65);
  bot.world.raycast = () => ({ position: new Vec3(2, 65, 0) });
  assert.deepEqual(findPickupClearance(bot, [10]), { x: 2, y: 65, z: 0, expected_block: 'stone' });
});

test('tracked drops in a tree canopy can clear leaves above a real log support',()=>{
 const {bot,put}=fixture();put('oak_log',62);put('oak_leaves',64);
 assert.deepEqual(findPickupClearance(bot,[10]),{x:2,y:64,z:0,expected_block:'oak_leaves'});
 put('chest',64);assert.equal(findPickupClearance(bot,[10]),null);
});

test('tracked-drop recovery clears a visible supported leaf wall but not hazardous or lower support',()=>{
 for(const kind of ['safe','hazard','below']){
  const{bot}=fixture();const p=new Vec3(1,kind==='below'?63:64,0);const original=bot.blockAt;
  bot.blockAt=q=>q.equals(p)?{name:'oak_leaves',position:p,boundingBox:'block'}:q.equals(p.offset(0,-1,0))?{name:kind==='hazard'?'magma_block':'stone',position:q,boundingBox:'block'}:original(q);
  bot.world.raycast=()=>({position:p});
  const found=findPickupClearance(bot,[10]);if(kind==='safe')assert.deepEqual(found,{x:1,y:64,z:0,expected_block:'oak_leaves'});else assert.equal(found,null,kind);
 }
});

function foliageFixture() {
  const position = new Vec3(0.5, 64, 0.5), leaf = new Vec3(2, 65, 0);
  const blocks = new Map([[leaf.toString(), { name: 'spruce_leaves', position: leaf, boundingBox: 'block', diggable: true }]]);
  let rays = 0;
  const bot = { entity: { position, eyeHeight: 1.62 }, blockAt: p => blocks.get(p.toString()) ?? {name:'air', position:p, boundingBox:'empty'}, world: { raycast: () => ++rays === 1 ? null : {position:leaf} } };
  const logs = [new Vec3(3,64,0),new Vec3(3,65,0),new Vec3(3,66,0)].map(position => ({name:'spruce_log',position}));
  return {bot,logs,blocks,leaf,rays:()=>rays};
}

test('tree foliage scan continues after the first trunk ray misses an obstruction',()=>{
  const f=foliageFixture(),before=f.bot.entity.position.clone();
  assert.deepEqual(findTreeFoliage(f.bot,f.logs),{x:2,y:65,z:0,expected_block:'spruce_leaves'});
  assert.ok(f.rays()>=3);assert.ok(f.bot.entity.position.equals(before));assert.equal(f.blocks.size,1);
});

test('tree foliage scan rejects lower supports, fluid adjacency, falling blocks and unloaded neighbors',()=>{
  for(const kind of ['support','waterlogged','water','kelp','falling','unknown','not-leaves','water-below','unknown-below']) {
    const f=foliageFixture();f.bot.world.raycast=()=>({position:f.leaf});
    const leaf=f.blocks.get(f.leaf.toString());
    if(kind==='support')f.bot.entity.position.y=66;
    if(kind==='waterlogged')leaf.isWaterlogged=true;
    if(kind==='not-leaves')leaf.name='chest';
    if(kind==='water-below'){const p=f.leaf.offset(0,-1,0);f.blocks.set(p.toString(),{name:'water',position:p});}
    if(kind==='unknown-below'){const original=f.bot.blockAt;f.bot.blockAt=p=>p.equals(f.leaf.offset(0,-1,0))?null:original(p);}
    if(['water','kelp','falling'].includes(kind)) {const p=f.leaf.offset(0,1,0);f.blocks.set(p.toString(),{name:kind==='falling'?'gravel':kind,position:p});}
    if(kind==='unknown'){const original=f.bot.blockAt;f.bot.blockAt=p=>p.equals(f.leaf.offset(1,0,0))?null:original(p);}
    assert.equal(findTreeFoliage(f.bot,f.logs),null,kind);
  }
});

test('tree foliage scan never extends reach or scans more than sixteen observed logs',()=>{
  const f=foliageFixture();let calls=0;f.bot.world.raycast=(eye,direction,reach)=>{assert.ok(reach<=4.2);calls++;return null;};
  const logs=Array.from({length:40},(_,i)=>({name:'spruce_log',position:new Vec3(20+i,65,0)}));
  assert.equal(findTreeFoliage(f.bot,logs),null);assert.equal(calls,16);
  assert.equal(findTreeFoliage(f.bot,null),null);assert.equal(findTreeFoliage({},logs),null);
});

test('tree foliage scan can continue past an unsafe leaf to a different visible safe obstruction',()=>{
  const f=foliageFixture(),unsafe=f.leaf.offset(0,-2,0);f.blocks.set(unsafe.toString(),{name:'spruce_leaves',position:unsafe,boundingBox:'block'});
  let calls=0;f.bot.world.raycast=()=>({position:++calls===1?unsafe:f.leaf});
  assert.deepEqual(findTreeFoliage(f.bot,f.logs),{x:2,y:65,z:0,expected_block:'spruce_leaves'});
});

test('powder contact checks feet, head and body edges without treating nearby snow as contact', () => {
  const {bot}=fixture();
  for (const y of [64,65]) {
    bot.blockAt=p=>({name:p.x===0&&p.y===y&&p.z===0?'powder_snow':'air'});
    assert.equal(hasPowderSnowContact(bot),true);
  }
  bot.entity.position=new Vec3(0.8,64,0.5);
  bot.blockAt=p=>({name:p.x===1&&p.y===64&&p.z===0?'powder_snow':'air'});
  assert.equal(hasPowderSnowContact(bot),true);
  bot.entity.position=new Vec3(0.5,64,0.5);
  assert.equal(hasPowderSnowContact(bot),false);
  bot.blockAt=()=>({name:'snow'});assert.equal(hasPowderSnowContact(bot),false);
});

test('powder contact includes thin overlap but excludes exact face contact', () => {
  const {bot}=fixture();
  bot.blockAt=p=>({name:p.x===1&&p.y===64&&p.z===0?'powder_snow':'air'});
  bot.entity.position=new Vec3(0.7005,64,0.5);assert.equal(hasPowderSnowContact(bot),true);
  bot.entity.position=new Vec3(0.7,64,0.5);assert.equal(hasPowderSnowContact(bot),false);
  bot.blockAt=p=>({name:p.y===66?'powder_snow':'air'});
  bot.entity.position=new Vec3(0.5,64.2005,0.5);assert.equal(hasPowderSnowContact(bot),true);
  bot.entity.position=new Vec3(0.5,64.2,0.5);assert.equal(hasPowderSnowContact(bot),false);
});

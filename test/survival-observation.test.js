import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { findPickupClearance } from '../src/survival-observation.js';
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

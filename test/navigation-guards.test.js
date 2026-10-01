import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { planReturnablePath, pursueDroppedItem } from '../src/navigation-guards.js'
function bot () {
  const b = new EventEmitter()
  b.entity = { id: 1, position: new Vec3(0.5, 70, 0.5) }
  b.entities = { 2: { id: 2, position: new Vec3(2, 70, 0) } }
  b.pathfinder = { goal: null, setGoal (g) { this.goal = g; b.emit('goal_updated', g) } }
  b.clearControlStates = () => { b.clears = (b.clears || 0) + 1 }
  return b
}
const goal = { x: 2, y: 68, z: 0 }, anchor = { x: 0, y: 70, z: 0 }
const result = (status, path = []) => ({ result: { status, path } })
const clean = b => { for (const event of ['entityGone', 'playerCollect', 'goal_reached', 'goal_updated', 'path_update']) assert.equal(b.listenerCount(event), 0, event) }
test('preflight rejects one-way descent without changing movement or the active goal', async () => {
  const b = bot(); let calls = 0
  b.pathfinder.getPathFromTo = function * () { yield ++calls === 1 ? result('success', [goal]) : result('noPath') }
  await assert.rejects(planReturnablePath(b, {}, goal, anchor), /No verified returnable/)
  assert.equal(b.entity.position.y, 70); assert.equal(b.pathfinder.goal, null)
})
test('a verified round trip returns the exact endpoint and preserves safety', async () => {
  const b = bot(); const movements = { canDig: false, allowParkour: false }; let calls = 0
  b.pathfinder.getPathFromTo = function * (m, start) { assert.equal(m, movements); if (++calls === 2) assert.equal(start.y, 68); yield result('success', [calls === 1 ? goal : anchor]) }
  const r = await planReturnablePath(b, movements, goal, anchor)
  assert.equal(r.endpoint.y, 68); assert.equal(r.reverseNodes, 1); assert.equal(movements.canDig, false)
})
test('partial and timed-out searches never certify returnability', async () => {
  const b = bot(); b.pathfinder.getPathFromTo = function * () { yield result('partial'); yield result('timeout') }
  await assert.rejects(planReturnablePath(b, {}, goal, anchor), /timeout/)
})
test('cancel during planning stops before travel and closes the generator', async () => {
  const b = bot(); const c = new AbortController(); let closed = false
  b.pathfinder.getPathFromTo = function * () { try { yield result('partial'); yield result('success') } finally { closed = true } }
  await assert.rejects(planReturnablePath(b, {}, goal, anchor, { signal: c.signal, yieldControl: async () => c.abort() }), { name: 'AbortError' })
  assert.equal(closed, true); assert.equal(b.pathfinder.goal, null)
})
test('terrain-modifying routes are refused even if a planner returns success', async () => {
  const b = bot(); b.pathfinder.getPathFromTo = function * () { yield result('success', [{ ...goal, toBreak: [new Vec3(1, 1, 1)] }]) }
  await assert.rejects(planReturnablePath(b, {}, goal, anchor), /modify terrain/)
})
test('specific item acquisition promptly ends pursuit and removes all listeners', async () => {
  const b = bot(); const item = b.entities[2]; const pending = pursueDroppedItem(b, goal, item)
  b.emit('playerCollect', b.entity, item)
  assert.equal((await pending).reason, 'collected'); assert.equal(b.pathfinder.goal, null); clean(b)
})
test('item disappearance ends pursuit but does not claim inventory acquisition', async () => {
  const b = bot(); const item = b.entities[2]; const pending = pursueDroppedItem(b, goal, item)
  delete b.entities[2]; b.emit('entityGone', item)
  assert.deepEqual(await pending, { reason: 'target_gone' }); clean(b)
})
test('another player collecting a different item cannot cancel pursuit', async () => {
  const b = bot(); const pending = pursueDroppedItem(b, goal, b.entities[2])
  b.emit('playerCollect', { id: 9 }, { id: 3 }); assert.equal(b.pathfinder.goal, goal)
  b.emit('goal_reached', goal); assert.equal((await pending).reason, 'arrived'); clean(b)
})
test('stuck successful replans are bounded locally', async () => {
  const b = bot(); const pending = pursueDroppedItem(b, goal, b.entities[2], { stallMs: 15, timeoutMs: 50, pollMs: 5 })
  b.emit('path_update', { status: 'success', path: [goal] })
  await assert.rejects(pending, /no movement progress/); assert.equal(b.pathfinder.goal, null); clean(b)
})
test('movement cannot evade the overall pickup attempt deadline', async () => {
  const b = bot(); const t = setInterval(() => { b.entity.position.x += 1 }, 4)
  try { await assert.rejects(pursueDroppedItem(b, goal, b.entities[2], { stallMs: 100, timeoutMs: 20, pollMs: 5 }), /local time budget/) } finally { clearInterval(t) }
  clean(b)
})
test('abort releases listeners and goal; replacement goals are never cleared', async () => {
  const b = bot(); const c = new AbortController(); const pending = pursueDroppedItem(b, goal, b.entities[2], { signal: c.signal }); c.abort()
  await assert.rejects(pending, { name: 'AbortError' }); clean(b)
  const p2 = pursueDroppedItem(b, goal, b.entities[2]); const replacement = { x: 8 }; b.pathfinder.setGoal(replacement)
  await assert.rejects(p2, /replaced/); assert.equal(b.pathfinder.goal, replacement); clean(b)
})

test('walking timeout releases its movement and event listeners', async () => {
 const { walkToGoal }=await import('../src/navigation-guards.js');const b=bot();
 await assert.rejects(walkToGoal(b,goal,{stallMs:10,pollMs:2,timeoutMs:100}),/no movement progress/);clean(b);assert.equal(b.pathfinder.goal,null);assert.equal(b.clears,1);
});
test('walking arrival is verified and never clears a replacement goal',async()=>{
 const { walkToGoal }=await import('../src/navigation-guards.js');const b=bot();let arrived=false;const g={isEnd:()=>arrived};
 const p=walkToGoal(b,g);b.emit('goal_reached',g);arrived=true;b.emit('goal_reached',g);assert.deepEqual(await p,{arrived:true});clean(b);
 const other={x:8};const q=walkToGoal(b,goal);b.pathfinder.setGoal(other);await assert.rejects(q,/replaced/);assert.equal(b.pathfinder.goal,other);clean(b);
});
test('walking abort and no-path stop promptly without claiming arrival',async()=>{
 const { walkToGoal }=await import('../src/navigation-guards.js');
 for(const kind of ['abort','path']){const b=bot(),c=new AbortController();const p=walkToGoal(b,goal,{signal:c.signal});if(kind==='abort')c.abort();else b.emit('path_update',{status:'noPath'});await assert.rejects(p,kind==='abort'?/cancelled/:/noPath/);clean(b);assert.equal(b.pathfinder.goal,null);}
});

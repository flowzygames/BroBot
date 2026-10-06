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

test('fixed pickup endpoint rejects an isolated reverse component before forward search', async () => {
 const b=bot(),p=new Vec3(2,68,0),g={isEnd:n=>n.equals(p)};let calls=0;
 b.pathfinder.getPathFromTo=function*(m,start,target){calls++;assert.ok(start.equals(p));assert.equal(target,anchor);yield result('noPath');};
 await assert.rejects(planReturnablePath(b,{},g,anchor,{fixedEndpoint:p}),/No verified returnable/);
 assert.equal(calls,1);assert.equal(b.pathfinder.goal,null);
});
test('fixed pickup endpoint requires both reverse and forward routes under unchanged movement rules', async () => {
 const b=bot(),p=new Vec3(2,68,0),g={isEnd:n=>n.equals(p)},m={canDig:false,allowParkour:false};const starts=[];
 b.pathfinder.getPathFromTo=function*(movement,start,target){assert.equal(movement,m);starts.push(start.clone());yield result('success',[target===anchor?anchor:p]);};
 const r=await planReturnablePath(b,m,g,anchor,{fixedEndpoint:p});
 assert.ok(starts[0].equals(p));assert.ok(starts[1].equals(b.entity.position));assert.ok(r.endpoint.equals(p));assert.equal(m.canDig,false);assert.equal(m.allowParkour,false);
});
test('reverse success cannot hide forward failure or a mismatched endpoint', async () => {
 for(const second of [result('noPath'),result('success',[new Vec3(9,68,0)])]){
  const b=bot(),p=new Vec3(2,68,0),g={isEnd:n=>n.equals(p)};let calls=0;
  b.pathfinder.getPathFromTo=function*(){yield ++calls===1?result('success',[anchor]):second;};
  await assert.rejects(planReturnablePath(b,{},g,anchor,{fixedEndpoint:p}),/No verified|different fixed endpoint/);
 }
});
test('fixed endpoint timeouts and terrain edits remain unknown or unsafe, never success', async () => {
 for(const outcome of [result('timeout'),result('success',[{...anchor,toPlace:[{}]}])]){
  const b=bot(),p=new Vec3(2,68,0),g={isEnd:n=>n.equals(p)};
  b.pathfinder.getPathFromTo=function*(){yield outcome;};
  await assert.rejects(planReturnablePath(b,{},g,anchor,{fixedEndpoint:p}),/timeout|modify terrain/);
 }
});
test('fixed endpoint must satisfy its exact goal before planning begins',async()=>{
 const b=bot();b.pathfinder.getPathFromTo=function*(){throw Error('must not plan');};
 await assert.rejects(planReturnablePath(b,{}, {isEnd:()=>false},anchor,{fixedEndpoint:new Vec3(2,68,0)}),/does not satisfy/);
 await assert.rejects(planReturnablePath(b,{}, {isEnd:()=>true},anchor,{fixedEndpoint:new Vec3(2.1,68,0)}),/exact standing/);
});

test('ranked route probes share one window and reserve time for alternatives', async () => {
  const { planRankedRoutes } = await import('../src/navigation-guards.js');
  let time=0;const budgets=[];
  const r=await planRankedRoutes(['north','east','south','west'],async(direction,budget)=>{
    budgets.push(budget);
    if(direction==='north'){time+=budget;throw Error('Return-path planning budget exhausted');}
    time+=100;return {endpoint:goal};
  },{now:()=>time});
  assert.deepEqual(budgets,[400,400]);assert.equal(r.candidate,'east');assert.equal(time,500);
  assert.deepEqual(r.tried,['north','east']);assert.equal(r.outcomes[0].status,'unverified');
});
test('ranked certification never resets its total deadline after failures', async () => {
  const { planRankedRoutes } = await import('../src/navigation-guards.js');
  let time=0,calls=0;
  await assert.rejects(planRankedRoutes(['north','east','south','west'],async(d,budget)=>{
    calls++;time+=budget;throw Error('No verified returnable walking route (timeout)');
  },{now:()=>time}),error=>{assert.equal(error.result.route_attempts.length,4);return /No verified scout route/.test(error.message)});
  assert.equal(time,1600);assert.equal(calls,4);
});
test('ranked probes propagate cancellation and unexpected errors without trying another route', async () => {
  const { planRankedRoutes } = await import('../src/navigation-guards.js');
  for(const mode of ['abort','disconnect']){
    let calls=0;const c=new AbortController();
    await assert.rejects(planRankedRoutes(['north','east'],async()=>{
      calls++;if(mode==='abort')c.abort();throw Error(mode==='abort'?'No verified returnable walking route (timeout)':'Minecraft is disconnected');
    },{signal:c.signal}));assert.equal(calls,1);
  }
});
test('late route results never certify after the shared deadline', async () => {
  const { planRankedRoutes } = await import('../src/navigation-guards.js');let time=0;
  await assert.rejects(planRankedRoutes(['north','east'],async()=>{time=1601;return{}},{now:()=>time}),/No verified scout route/);
});
test('unexpected ranked-probe failure preserves prior attempts while propagating the original error', async () => {
  const {planRankedRoutes}=await import('../src/navigation-guards.js');const failure=Error('Minecraft is disconnected');
  await assert.rejects(planRankedRoutes(['north','east','west'],async direction=>{
    if(direction==='north')throw Error('No verified returnable walking route (noPath)');throw failure;
  }),error=>{assert.equal(error,failure);assert.deepEqual(error.result.directions_tried,['north','east']);assert.equal(error.result.route_attempts.length,2);return true});
});

test('collecting a drop midair retains the certified landing goal until grounded',async()=>{
 const b=bot();b.entity.onGround=false;let done=false;
 const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,pollMs:5}).then(r=>{done=true;return r});
 b.emit('playerCollect',b.entity,b.entities[2]);await new Promise(r=>setImmediate(r));
 assert.equal(done,false);assert.equal(b.pathfinder.goal,goal);assert.equal(b.clears??0,0);
 b.entity.position=new Vec3(2.5,68,.5);b.entity.onGround=true;b.emit('goal_reached',goal);
 assert.equal((await pending).reason,'collected');assert.equal(b.pathfinder.goal,null);clean(b);
});
test('a disappearing drop midair does not cancel flight, but user cancellation still does',async()=>{
 const b=bot();b.entity.onGround=false;const controller=new AbortController();
 const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,signal:controller.signal,pollMs:5});
 const item=b.entities[2];delete b.entities[2];b.emit('entityGone',item);
 assert.equal(b.pathfinder.goal,goal);controller.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(b.pathfinder.goal,null);clean(b);
});
test('pickup waits past an unsafe grounded point and preserves the collected outcome',async()=>{
 const b=bot();b.entity.onGround=false;let safe=false,done=false;
 const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,safeToStop:()=>safe,pollMs:5}).then(r=>{done=true;return r});
 const item=b.entities[2];b.emit('playerCollect',b.entity,item);delete b.entities[2];b.emit('entityGone',item);
 b.entity.onGround=true;await new Promise(r=>setTimeout(r,15));assert.equal(done,false);assert.equal(b.pathfinder.goal,goal);
 b.entity.position=new Vec3(2.5,68,.5);safe=true;assert.equal((await pending).reason,'collected');clean(b);
});
test('waiting for a landing remains bounded and never overrides a replacement goal',async()=>{
 const b=bot();b.entity.onGround=false;
 const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,pollMs:5,timeoutMs:20,stallMs:100});b.emit('playerCollect',b.entity,b.entities[2]);
 await assert.rejects(pending,/local time budget/);clean(b);
 const next=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true});b.emit('playerCollect',b.entity,b.entities[2]);const replacement={x:9};b.pathfinder.setGoal(replacement);
 await assert.rejects(next,/replaced/);assert.equal(b.pathfinder.goal,replacement);clean(b);
});
test('a failed landing observation rejects the pursuit and releases owned movement',async()=>{
 const b=bot();b.entity.onGround=true;b.entity.position=new Vec3(2.5,68,.5);
 const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,safeToStop:()=>{throw Error('stale world')}});
 b.emit('playerCollect',b.entity,b.entities[2]);await assert.rejects(pending,/stale world/);assert.equal(b.pathfinder.goal,null);clean(b);
});
test('landing after the local deadline cannot beat a slower timer tick',async()=>{
 const b=bot();b.entity.onGround=false;const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,timeoutMs:20,pollMs:75});
 b.emit('playerCollect',b.entity,b.entities[2]);await new Promise(r=>setTimeout(r,35));b.entity.position=new Vec3(2.5,68,.5);b.entity.onGround=true;b.emit('goal_reached',goal);
 await assert.rejects(pending,/local time budget/);clean(b);
});
test('a target gone before pursuit is explicit and cannot bless an unsafe starting pose',async()=>{
 for(const grounded of [false,true]){
  const b=bot(),item=b.entities[2];delete b.entities[2];b.entity.onGround=grounded;
  const pending=pursueDroppedItem(b,goal,item,{waitForLanding:true});
  if(grounded)assert.deepEqual(await pending,{reason:'target_gone_before_pursuit',started:false,landingVerified:false});
  else await assert.rejects(pending,e=>e.code==='PICKUP_UNSAFE_SETTLEMENT');
  assert.equal(b.pathfinder.goal,null);assert.equal(b.clears??0,0);clean(b);
 }
});
test('native airborne arrival cleanup is not reported as a grounded verified arrival',async()=>{
 const b=bot();b.entity.onGround=false;let done=false;
 const pending=pursueDroppedItem(b,goal,b.entities[2],{waitForLanding:true,pollMs:5}).then(r=>{done=true;return r});
 b.emit('goal_reached',goal);b.pathfinder.goal=null;b.clearControlStates();await new Promise(r=>setImmediate(r));assert.equal(done,false);
 b.entity.position=new Vec3(2.5,68,.5);b.entity.onGround=true;
 assert.equal((await pending).landingVerified,true);clean(b);
});

for (const trigger of ['abort', 'arrival', 'path failure', 'poll']) test(`walking ${trigger} preserves a replacement pathfinder even with the same goal`, async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  const b = bot(), controller = new AbortController(), original = b.pathfinder
  const pending = walkToGoal(b, goal, { signal: controller.signal, pollMs: 2, timeoutMs: 100, stallMs: 100 })
  let replacementClears = 0
  b.pathfinder = { goal, setGoal() { replacementClears++ } }
  if (trigger === 'abort') controller.abort()
  else if (trigger === 'arrival') b.emit('goal_reached', goal)
  else if (trigger === 'path failure') b.emit('path_update', { status: 'noPath' })
  await assert.rejects(pending)
  assert.equal(replacementClears, 0)
  assert.equal(b.clears ?? 0, 0)
  assert.equal(original.goal, goal)
  clean(b)
})

test('walking cleanup preserves replacement pathfinder without a goal property', async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  const b = bot(), controller = new AbortController()
  const pending = walkToGoal(b, goal, { signal: controller.signal })
  let writes = 0
  b.pathfinder = { setGoal() { writes++ } }
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(writes, 0)
  assert.equal(b.clears ?? 0, 0)
  clean(b)
  b.emit('goal_reached', goal)
  b.emit('path_update', { status: 'noPath' })
  assert.equal(writes, 0)
})

test('walking cleanup rechecks ownership after synchronous goal-clear listeners', async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  for (const replacePathfinder of [false, true]) {
    const b = bot(), controller = new AbortController(), successor = { x: 99 }
    const pending = walkToGoal(b, goal, { signal: controller.signal })
    const takeOver = cleared => {
      if (cleared !== null) return
      if (replacePathfinder) b.pathfinder = { goal: successor, setGoal() { assert.fail('new pathfinder must be untouched') } }
      else b.pathfinder.goal = successor
    }
    b.on('goal_updated', takeOver)
    controller.abort()
    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(b.pathfinder.goal, successor)
    assert.equal(b.clears ?? 0, 0)
    b.removeListener('goal_updated', takeOver)
    clean(b)
  }
})

for (const trigger of ['abort', 'collect', 'arrival', 'poll']) test(`pickup ${trigger} preserves a replacement pathfinder`, async () => {
  const b = bot(), controller = new AbortController()
  const pending = pursueDroppedItem(b, goal, b.entities[2], { signal: controller.signal, pollMs: 2, timeoutMs: 100, stallMs: 100 })
  let writes = 0
  b.pathfinder = { goal, setGoal() { writes++ } }
  if (trigger === 'abort') controller.abort()
  else if (trigger === 'collect') b.emit('playerCollect', b.entity, b.entities[2])
  else if (trigger === 'arrival') b.emit('goal_reached', goal)
  await assert.rejects(pending)
  assert.equal(writes, 0)
  assert.equal(b.clears ?? 0, 0)
  clean(b)
})

test('pickup cleanup rechecks ownership after synchronous goal-clear listeners', async () => {
  const b = bot(), controller = new AbortController(), successor = { x: 99 }
  const pending = pursueDroppedItem(b, goal, b.entities[2], { signal: controller.signal })
  const takeOver = cleared => { if (cleared === null) b.pathfinder.goal = successor }
  b.on('goal_updated', takeOver)
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(b.pathfinder.goal, successor)
  assert.equal(b.clears ?? 0, 0)
  b.removeListener('goal_updated', takeOver)
  clean(b)
})

for (const initial of [true, false]) test(`walking success predicate cannot replace its owner (${initial ? 'initial' : 'arrival'})`, async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  const b = bot(); let ready = initial, writes = 0
  const target = { isEnd() { if (!ready) return false; b.pathfinder = { setGoal() { writes++ } }; return true } }
  const pending = walkToGoal(b, target)
  if (!initial) { ready = true; b.emit('goal_reached', target) }
  await assert.rejects(pending, /pathfinder replaced/)
  assert.equal(writes, 0)
  assert.equal(b.clears ?? 0, 0)
  clean(b)
})

test('pickup landing predicate cannot transfer ownership and claim verified landing', async () => {
  const b = bot(); b.entity.onGround = true; let writes = 0
  const pending = pursueDroppedItem(b, goal, b.entities[2], { waitForLanding: true, atDestination: () => true,
    safeToStop() { b.pathfinder = { setGoal() { writes++ } }; return true } })
  b.emit('playerCollect', b.entity, b.entities[2])
  await assert.rejects(pending, /pathfinder replaced/)
  assert.equal(writes, 0)
  assert.equal(b.clears ?? 0, 0)
  clean(b)
})

for (const kind of ['walk', 'pickup']) test(`${kind} respects an external owner handoff with the same pathfinder and goal`, async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  const b = bot(), controller = new AbortController(); let current = true
  const options = { signal: controller.signal, ownershipGuard: () => current }
  const pending = kind === 'walk' ? walkToGoal(b, goal, options) : pursueDroppedItem(b, goal, b.entities[2], options)
  current = false
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(b.pathfinder.goal, goal)
  assert.equal(b.clears ?? 0, 0)
  clean(b)
})

for (const kind of ['walk', 'pickup']) test(`${kind} refuses malformed or throwing owner guard before setting a goal`, async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  for (const ownershipGuard of [true, () => false, () => { throw Error('retired') }]) {
    const b = bot(), options = { ownershipGuard }
    await assert.rejects(kind === 'walk' ? walkToGoal(b, goal, options) : pursueDroppedItem(b, goal, b.entities[2], options))
    assert.equal(b.pathfinder.goal, null)
    assert.equal(b.clears ?? 0, 0)
    clean(b)
  }
})

test('false-returning initial walking predicate cannot start a retired pathfinder', async () => {
  const { walkToGoal } = await import('../src/navigation-guards.js')
  const b = bot(); let oldStarts = 0
  b.pathfinder.setGoal = () => { oldStarts++ }
  const target = { isEnd() { b.pathfinder = { goal: target, setGoal() { assert.fail('replacement must be untouched') } }; return false } }
  await assert.rejects(walkToGoal(b, target), /ownership changed/)
  assert.equal(oldStarts, 0)
  assert.equal(b.clears ?? 0, 0)
  clean(b)
})

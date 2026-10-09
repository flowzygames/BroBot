import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { routeFailure, annotateRouteFailure, routeFailureLog } from '../src/route-diagnostics.js';
import { planReturnablePath, planRankedRoutes } from '../src/navigation-guards.js';
import { ActionRunner } from '../src/runner.js';

const origin = { x: 0, y: 70, z: 0 }, endpoint = new Vec3(2, 70, 0);
const goal = { isEnd: p => p.equals(endpoint) };
const outcome = (status, path = []) => ({ result: { status, path } });
function fixture(outcomes) {
  let calls = 0, closed = 0;
  return { bot: { entity: { position: new Vec3(.5, 70, .5) }, pathfinder: {
    getPathFromTo: function* () { try { yield* outcomes[calls++]; } finally { closed++; } }
  } }, calls: () => calls, closed: () => closed };
}
for (const fixed of [false, true]) for (const failedCall of [0, 1]) {
  test(`route diagnostic identifies call ${failedCall + 1}, reverse-first=${fixed}`, async () => {
    const f = fixture(failedCall ? [[outcome('success', [fixed ? origin : endpoint])], [outcome('noPath')]] : [[outcome('noPath')]]);
    await assert.rejects(planReturnablePath(f.bot, {}, goal, origin, fixed ? { fixedEndpoint: endpoint } : {}), error => {
      assert.equal(error.message, 'No verified returnable walking route (noPath)');
      assert.deepEqual(routeFailure(error), { phase: (failedCall === 0) !== fixed ? 'forward' : 'reverse', planner_status: 'noPath' });
      return true;
    });
    assert.equal(f.calls(), failedCall + 1); assert.equal(f.closed(), failedCall + 1);
  });
}
test('partial timeout retains final planner status', async () => {
  const f = fixture([[outcome('partial'), outcome('timeout')]]);
  await assert.rejects(planReturnablePath(f.bot, {}, goal, origin, { yieldControl: async () => {} }), e => {
    assert.deepEqual(routeFailure(e), { phase: 'forward', planner_status: 'timeout' }); return true;
  });
  assert.equal(f.closed(), 1);
});
test('yielded cancellation retains classification and closes the planner', async () => {
  const f = fixture([[outcome('partial'), outcome('success', [endpoint])]]), c = new AbortController();
  await assert.rejects(planReturnablePath(f.bot, {}, goal, origin, { signal: c.signal, yieldControl: async () => c.abort() }), e => {
    assert.equal(e.name, 'AbortError'); assert.equal(e.message, 'Action cancelled');
    assert.deepEqual(routeFailure(e), { phase: 'forward', planner_status: 'partial' }); return true;
  });
  assert.equal(f.closed(), 1);
});
for (const unsafe of ['terrain', 'node']) test(`successful planner does not conceal ${unsafe} rejection`, async () => {
  const f = fixture([[outcome('success', [{ ...endpoint, ...(unsafe === 'terrain' ? { toBreak: [{}] } : {}) }])]]);
  await assert.rejects(planReturnablePath(f.bot, {}, goal, origin, { validateNode: () => unsafe !== 'node' }), e => {
    assert.match(e.message, unsafe === 'terrain' ? /modify terrain/ : /unsafe node/);
    assert.deepEqual(routeFailure(e), { phase: 'forward', planner_status: 'success' }); return true;
  });
});
test('validation and post-certification errors have no invented planning phase', async () => {
  const f = fixture([[outcome('success', [endpoint])], [outcome('success', [origin])]]);
  await assert.rejects(planReturnablePath(f.bot, {}, goal, origin, { fixedEndpoint: new Vec3(3,70,0) }), e => routeFailure(e) === null);
  assert.equal(f.calls(), 0);
  await assert.rejects(planReturnablePath(f.bot, {}, goal, origin, { onCertifiedPaths: () => { throw Error('callback failure'); } }), e => {
    assert.equal(e.message, 'callback failure'); assert.equal(routeFailure(e), null); return true;
  });
});
for (const frozen of [false, true]) test(`annotation preserves progress and error identity semantics, frozen=${frozen}`, () => {
  const original = Object.assign(Error('route stopped'), { name: 'AbortError', code: 'STOP', result: { mined: 2, inventory_changes: { oak_log: 1 } } });
  if (frozen) Object.freeze(original);
  const e = annotateRouteFailure(original, 'reverse', 'partial');
  assert.equal(e.message, original.message); assert.equal(e.name, original.name); assert.equal(e.code, original.code);
  assert.deepEqual(e.result.inventory_changes, { oak_log: 1 }); assert.equal(e.result.mined, 2);
  if (frozen) assert.equal(e.cause, original); else assert.equal(e, original);
  assert.deepEqual(routeFailure(e), { phase: 'reverse', planner_status: 'partial' });
});
test('ranked alternatives retain phase per rejected candidate without changing fallback', async () => {
  const calls = [];
  const r = await planRankedRoutes(['north', 'south'], async direction => {
    calls.push(direction);
    if (direction === 'north') throw annotateRouteFailure(Error('No verified returnable walking route (noPath)'), 'reverse', 'noPath');
    return { endpoint };
  });
  assert.deepEqual(calls, ['north', 'south']); assert.equal(r.candidate, 'south');
  assert.equal(r.outcomes[0].status, 'unverified');
  assert.deepEqual(r.outcomes[0].route_failure, { phase: 'reverse', planner_status: 'noPath' });
  assert.deepEqual(r.outcomes[1], { direction: 'south', status: 'verified' });
});
test('journal projection is bounded and excludes unrelated data and getters', () => {
  let reads = 0;
  const diagnostic = { phase: 'reverse', planner_status: 'noPath', private_path: 'hidden' };
  Object.defineProperty(diagnostic, 'extra', { enumerable: true, get() { reads++; throw Error('getter'); } });
  const entry = { route_failure: diagnostic, direction: 'north', id: 2, position: { x: 1, y: 2, z: 3 }, secret: 'hidden' };
  const error = { result: { route_failure: diagnostic, route_attempts: Array(6).fill(entry), failures: Array(12).fill(entry), secret: 'hidden' } };
  const projected = routeFailureLog(error);
  assert.deepEqual(projected.route_failure, { phase: 'reverse', planner_status: 'noPath' });
  assert.equal(projected.route_attempts.length, 4); assert.equal(projected.route_attempts_omitted_entries, 2);
  assert.equal(projected.failures.length, 8); assert.equal(projected.failures_omitted_entries, 4);
  assert.equal(JSON.stringify(projected).includes('hidden'), false); assert.equal(reads, 0);
  const accessor = Object.defineProperty({}, 'result', { get() { reads++; throw Error('getter'); } });
  assert.equal(routeFailureLog(accessor), null); assert.equal(routeFailure(accessor), null); assert.equal(reads, 0);
  assert.equal(routeFailureLog({ result: { route_failure: { phase: 'unrecognized' } } }), null);
});
for (const cancelled of [false, true]) test(`runner logs sanitized route evidence after failure, cancelled=${cancelled}`, async () => {
  const logs = [], runner = new ActionRunner({ log: (...args) => logs.push(args) });
  await assert.rejects(runner.run('scout', async () => {
    if (cancelled) runner.stop('owner stopped');
    throw annotateRouteFailure(Object.assign(Error('original route failure'), { result: { mined: 2, secret: 'hidden' } }), 'forward', 'noPath');
  }), e => {
    assert.equal(e.message, cancelled ? 'owner stopped' : 'original route failure');
    assert.equal(e.result.mined, 2); return true;
  });
  assert.deepEqual(logs.at(-1), ['error', `scout: ${cancelled ? 'owner stopped' : 'original route failure'}`, { route_failure: { phase: 'forward', planner_status: 'noPath' } }]);
  assert.equal(runner.active, null);
});
test('ordinary runner failure has unchanged two-argument journal entry', async () => {
  const logs = [], runner = new ActionRunner({ log: (...args) => logs.push(args) });
  await assert.rejects(runner.run('inspect', async () => { throw Error('ordinary'); }), /ordinary/);
  assert.deepEqual(logs.at(-1), ['error', 'inspect: ordinary']);
});

test('annotation never invokes result accessors or replaces a failure with diagnostics failure', () => {
 let reads=0;
 const original=Object.assign(Error('original'),{code:'ORIGINAL',result:{mined:2,get other(){reads++;throw Error('getter');}}});
 const error=annotateRouteFailure(original,'forward','noPath');
 assert.equal(error,original);assert.equal(error.code,'ORIGINAL');assert.equal(error.result.mined,2);assert.equal(reads,0);
 const hostile=Object.assign(Error('proxy original'),{result:new Proxy({}, {ownKeys(){throw Error('proxy');}})});
 assert.equal(annotateRouteFailure(hostile,'forward','noPath'),hostile);
 assert.equal(hostile.message,'proxy original');
});

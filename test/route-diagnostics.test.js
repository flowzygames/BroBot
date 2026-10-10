import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { routeFailure, annotateRouteFailure, routeFailureLog, reverseWitness } from '../src/route-diagnostics.js';
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
      assert.deepEqual(routeFailure(error), { phase: (failedCall === 0) !== fixed ? 'forward' : 'reverse', planner_status: 'noPath', ...(!fixed && failedCall === 1 ? { reverse_witness: { status: 'declined', reason: 'policy', validated_edges: 0 } } : {}) });
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

const witness = { status: 'declined', reason: 'corridor_unverified', forward_nodes: 3, validated_edges: 1 };
test('one witness normalizer allowlists status, reason and bounded count fields',()=>{
 const raw={...witness,position:{x:1,y:2,z:3},path:[origin],error:Error('private'),secret:'hidden'};
 assert.deepEqual(reverseWitness(raw),witness);
 for(const field of ['status','reason'])assert.equal(reverseWitness({...witness,[field]:'unknown'}),null);
 assert.equal(reverseWitness({...witness,status:'success'}),null);
 assert.equal(reverseWitness({...witness,status:'declined',reason:'final_edge'}),null);
 for(const bad of [-1,65,1.5,NaN,Infinity,'3',null,{},3n])assert.deepEqual(reverseWitness({...witness,forward_nodes:bad,validated_edges:bad}),{status:witness.status,reason:witness.reason});
 assert.deepEqual(reverseWitness({...witness,forward_nodes:64,forward_nodes_capped:true}),{...witness,forward_nodes:64,forward_nodes_capped:true});
 for(const capped of [false,1,'true',{}])assert.deepEqual(reverseWitness({...witness,forward_nodes_capped:capped}),witness);
 assert.deepEqual(reverseWitness({...witness,forward_nodes_capped:true}),witness);
 assert.equal(reverseWitness(Object.create(witness)),null);
});
test('witness sanitization never invokes accessors on recognized or arbitrary fields',()=>{
 let reads=0;const getter={enumerable:true,get(){reads++;throw Error('do not evaluate');}};
 for(const field of ['status','reason','forward_nodes','validated_edges','forward_nodes_capped','extra']) {
  const raw={...witness};Object.defineProperty(raw,field,getter);
  const output=reverseWitness(raw);
  if(['status','reason'].includes(field))assert.equal(output,null);
  else {const expected={...witness};delete expected[field];assert.deepEqual(output,expected);}
 }
 const reverse={phase:'reverse',planner_status:'noPath'};Object.defineProperty(reverse,'reverse_witness',getter);
 assert.deepEqual(routeFailure({result:{route_failure:reverse}}),{phase:'reverse',planner_status:'noPath'});
 assert.equal(reads,0);
 const hostile=new Proxy({}, {getOwnPropertyDescriptor(){throw Error('hostile descriptor');}});
 assert.equal(reverseWitness(hostile),null);
 assert.deepEqual(routeFailure({result:{route_failure:{phase:'reverse',reverse_witness:hostile}}}),{phase:'reverse'});
});
test('forward phase never copies or inspects reverse witness metadata',()=>{
 let reads=0;const raw={phase:'forward',planner_status:'noPath'};
 Object.defineProperty(raw,'reverse_witness',{get(){reads++;throw Error('must not inspect');}});
 assert.deepEqual(routeFailure({result:{route_failure:raw}}),{phase:'forward',planner_status:'noPath'});
 assert.deepEqual(routeFailure(annotateRouteFailure(Error('forward stopped'),'forward','timeout',witness)),{phase:'forward',planner_status:'timeout'});
 assert.equal(reads,0);
});
for(const frozen of [false,true])test(`reverse annotation preserves identity/progress and sanitized witness, frozen=${frozen}`,()=>{
 const original=Object.assign(Error('route stopped'),{code:'STOP',result:{mined:2,inventory_changes:{oak_log:1}}});
 if(frozen)Object.freeze(original);
 const result=annotateRouteFailure(original,'reverse','partial',{...witness,path:['hidden'],error:original});
 assert.equal(result.message,'route stopped');assert.equal(result.code,'STOP');assert.equal(result.result.mined,2);
 assert.deepEqual(result.result.inventory_changes,{oak_log:1});assert.deepEqual(routeFailure(result),{phase:'reverse',planner_status:'partial',reverse_witness:witness});
 if(frozen)assert.equal(result.cause,original);else assert.equal(result,original);
});
test('nested witness diagnostics share existing aggregation caps and exclude raw paths',()=>{
 let reads=0;
 const raw={...witness,path:['hidden'],coordinates:origin};Object.defineProperty(raw,'extra',{get(){reads++;throw Error('getter');}});
 const failure={phase:'reverse',planner_status:'timeout',reverse_witness:raw};
 const entry={route_failure:failure,direction:'north',id:2};
 const result=routeFailureLog({result:{route_failure:failure,route_attempts:Array(6).fill(entry),failures:Array(12).fill(entry),pickup_failures:Array(66).fill(entry),unreachable:Array(66).fill(entry)}});
 const expected={phase:'reverse',planner_status:'timeout',reverse_witness:witness};assert.deepEqual(result.route_failure,expected);
 for(const [key,cap,omitted]of[['route_attempts',4,2],['failures',8,4],['pickup_failures',64,2],['unreachable',64,2]]){
  assert.equal(result[key].length,cap);assert.equal(result[`${key}_omitted_entries`],omitted);
  for(const record of result[key])assert.deepEqual(record.route_failure,expected);
 }
 assert.equal(reads,0);assert.equal(JSON.stringify(result).includes('hidden'),false);assert.equal(JSON.stringify(result).includes('coordinates'),false);
});
test('ranked reverse attempts retain their local witness and runner emits it through sanitization',async()=>{
 const logs=[],runner=new ActionRunner({log:(...args)=>logs.push(args)});
 await assert.rejects(runner.run('scout',()=>planRankedRoutes(['north','south'],async direction=>{
  if(direction==='north')throw annotateRouteFailure(Error('No verified returnable walking route (noPath)'),'reverse','noPath',witness);
  throw annotateRouteFailure(Error('No verified returnable walking route (timeout)'),'forward','timeout',witness);
 })),error=>{
  const [north,south]=error.result.route_attempts;
  assert.deepEqual(north.route_failure,{phase:'reverse',planner_status:'noPath',reverse_witness:witness});
  assert.deepEqual(south.route_failure,{phase:'forward',planner_status:'timeout'});return true;
 });
 assert.deepEqual(logs.at(-1)[2],{route_attempts:[
  {direction:'north',route_failure:{phase:'reverse',planner_status:'noPath',reverse_witness:witness}},
  {direction:'south',route_failure:{phase:'forward',planner_status:'timeout'}}
 ]});
});

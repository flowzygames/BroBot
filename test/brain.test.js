import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/brain.js';

function fixture(responses, overrides = {}) {
  const data = {}, calls = [], spoken = [];
  const world = { connected: true, inventory: [], dimension: 'overworld' };
  const memory = { get: (k, fallback) => data[k] ?? fallback, set: (k, v) => { data[k] = structuredClone(v); } };
  const config = { apiKey: '', model: 'test-model', maxRequests: 20, maxInputTokens: 1000000, maxOutputTokens: 50000, turnOutputTokens: 2000, stepLimit: 8, intervalMs: 1, ...overrides };
  const client = { responses: { create: async (body, options) => { calls.push({ body, options }); const next=responses.shift(); if(next instanceof Error)throw next; return typeof next==='function'?next(options):next; } } };
  const actions = [];
  const brain = new Brain({ config, memory, definitions: () => [], snapshot: () => structuredClone(world), execute: async (name,args) => { actions.push({name,args}); return {changed:true}; }, stopActions: () => {}, say: text => spoken.push(text), client });
  return { brain, data, calls, spoken, actions, world };
}
const call = (name, args) => ({ status:'completed', output:[{type:'function_call',name,arguments:JSON.stringify(args)}], usage:{input_tokens:100,output_tokens:20} });
const done = () => call('finish_goal',{outcome:'complete',message:'Observed result.'});
test('AI executes one bounded action and passes observed result to next decision', async () => {
  const f=fixture([call('collect',{block:'oak_log',count:1,radius:16}),done()]);
  const execute = f.brain.execute;
  f.brain.execute = async (...args) => { f.world.inventory = [{ name: 'oak_log', count: 1 }]; return execute(...args); };
  await f.brain.start('Gather one log'); await f.brain.active.promise;
  assert.equal(f.actions.length,1);assert.equal(f.data.lastGoal.status,'complete');
  assert.match(f.calls[1].body.input[0].content, /changed/);
  assert.equal(f.calls[0].body.store,false);assert.equal(f.calls[0].body.parallel_tool_calls,false);
  assert.equal(f.data.usage.requests,2);assert.equal(f.data.usage.inputTokens,200);
});
test('invalid model JSON, incomplete responses and concurrent calls never execute actions', async () => {
  for(const response of [
    {status:'incomplete',output:call('collect',{}).output},
    {status:'completed',output:[{type:'function_call',name:'collect',arguments:'not json'}]},
    {status:'completed',output:[...call('collect',{}).output,...call('craft',{}).output]}
  ]){const f=fixture([response]);await f.brain.start('Build');await f.brain.active.promise;assert.equal(f.actions.length,0);assert.equal(f.data.lastGoal.status,'paused');}
});
test('budget refuses requests before spending and failed requests retain reservations', async () => {
  const small=fixture([done()],{maxInputTokens:1});await small.brain.start('Hello');await small.brain.active.promise;assert.equal(small.calls.length,0);
  const failed=fixture([new Error('network')]);await failed.brain.start('Hello');await failed.brain.active.promise;assert.equal(failed.data.usage.requests,1);assert.ok(failed.data.usage.inputTokens>1000);
});
test('stop aborts pending API and prevents a late tool action', async () => {
  let finish;
  const f=fixture([()=>new Promise(resolve=>{finish=resolve;})]);
  await f.brain.start('Build');const task=f.brain.active.promise;
  f.brain.stop();finish(call('collect',{}));await task;
  assert.equal(f.actions.length,0);assert.equal(f.data.lastGoal.status,'paused');
});
test('repeated identical action failures pause rather than loop indefinitely', async () => {
  const f=fixture([call('collect',{block:'stone'}),call('collect',{block:'stone'}),call('collect',{block:'stone'})]);
  f.brain.execute=async()=>{throw new Error('unreachable');};
  await f.brain.start('Collect');await f.brain.active.promise;
  assert.match(f.data.lastGoal.reason,/Repeated failure/);assert.equal(f.calls.length,3);
});
test('explicit ongoing goals require a tool and cannot finish on a planning sentence', async () => {
  const f=fixture([{status:'completed',output:[],output_text:'I will gather wood.'}]);
  await f.brain.start('Gather wood',{persistent:true});await f.brain.active.promise;
  assert.equal(f.calls[0].body.tool_choice,'required');assert.equal(f.data.lastGoal.status,'paused');
});
test('corrupt saved usage fails closed instead of silently bypassing budget comparisons', () => {
  assert.throws(()=>new Brain({config:{apiKey:''},memory:{get:()=>({requests:null})}}),/Saved AI usage is invalid/);
});

test('returned no-progress partial and blocked outcomes stop before a third identical execution', async () => {
  for (const result of [{ completed:false, mined:0 }, { fired:false, blocked:'No reliable trajectory' }, { status:'blocked' }, { outcome:'blocked' }]) {
    const f=fixture(Array.from({length:5},()=>call('collect',{block:'oak_log',count:4})));
    let executed=0;
    f.brain.execute=async()=>{ executed++; return result; };
    await f.brain.start('Collect four logs'); await f.brain.active.promise;
    assert.equal(executed,2); assert.equal(f.calls.length,3);
    assert.match(f.data.lastGoal.reason,/Repeated failure without progress/);
  }
});
test('JSON key order cannot bypass the repeated failure guard', async () => {
  const f=fixture([call('collect',{block:'oak_log',count:4}),call('collect',{count:4,block:'oak_log'}),call('collect',{block:'oak_log',count:4})]);
  let executed=0; f.brain.execute=async()=>{ executed++; return {completed:false,mined:0}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(executed,2); assert.match(f.data.lastGoal.reason,/Repeated failure/);
});
test('changing arguments cannot sustain a no-progress loop', async () => {
  const f=fixture([16,24,32,48].map(radius=>call('collect',{block:'oak_log',count:4,radius})));
  let executed=0; f.brain.execute=async()=>{ executed++; return {completed:false,mined:0}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(executed,3); assert.equal(f.calls.length,3);
  assert.match(f.data.lastGoal.reason,/No progress after three/);
});
test('read-only results, chat and ambient snapshot changes do not reset failed retries', async () => {
  const collect=()=>call('collect',{block:'oak_log',count:4});
  const f=fixture([collect(),call('inspect',{}),collect(),call('say',{message:'Still trying'}),collect()]);
  let executed=0;
  f.brain.execute=async name=>{ f.world.time=(f.world.time||0)+100; if(name==='collect'){executed++;return {completed:false,mined:0};} return {changed:true}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(executed,2); assert.match(f.data.lastGoal.reason,/Repeated failure/);
});
test('partial mining with real progress can continue and completion checks actual inventory', async () => {
  const f=fixture([...Array.from({length:4},()=>call('collect',{block:'oak_log',count:4})),done()]);
  let executed=0;
  f.brain.execute=async()=>{ executed++; f.world.inventory=[{name:'oak_log',count:executed}]; return {completed:false,mined:1,inventory_changes:{oak_log:1}}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(executed,4); assert.equal(f.data.lastGoal.status,'complete');
  assert.equal(f.data.lastGoal.verification.status,'verified');
});
test('mining progress does not prove the requested items were picked up', async () => {
  const f=fixture([call('collect',{block:'oak_log',count:4}),done(),done(),done()]);
  f.brain.execute=async()=>({completed:false,mined:4,inventory_changes:{},remaining_drops:[{id:1}]});
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'paused'); assert.match(f.data.lastGoal.reason,/holds 0/);
  assert.deepEqual(f.spoken,[]);
});
test('observed progress permits recovery after prior failures', async () => {
  const action=()=>call('collect',{block:'oak_log',count:4});
  // Progress from a different action allows recovery without blindly trying the
  // unchanged failed collect action a third time.
  const f=fixture([action(),action(),call('dig_at',{x:0,y:64,z:0}),action(),action(),action()]); let executed=0;
  f.brain.execute=async()=>{ executed++; return {completed:false,mined:executed===3?1:0}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(executed,5); assert.equal(f.calls.length,6); assert.match(f.data.lastGoal.reason,/Repeated failure/);
});
test('thrown and returned failures share the same retry budget', async () => {
  const f=fixture(Array.from({length:3},()=>call('collect',{block:'oak_log',count:4}))); let executed=0;
  f.brain.execute=async()=>{ if(++executed===1)throw new Error('unreachable'); return {completed:false,mined:0}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(executed,2); assert.match(f.data.lastGoal.reason,/Repeated failure/);
});
test('unsupported completion claims cannot complete an empty inventory goal or leak into speech', async () => {
  const f=fixture(['Done','Definitely done','All collected'].map(message=>({...call('finish_goal',{outcome:'complete',message}),output_text:'I collected four logs!'})));
  await f.brain.start('Collect four logs',{persistent:true}); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'paused'); assert.equal(f.actions.length,0); assert.equal(f.calls.length,3);
  assert.match(f.data.lastGoal.reason,/holds 0/); assert.deepEqual(f.spoken,[]);
  assert.equal(JSON.parse(f.calls[1].body.input[0].content).recentResults[0].result.verification.status,'unmet');
});
test('planner can recover from a rejected completion claim', async () => {
  const f=fixture([done(),call('collect',{block:'oak_log',count:4}),done()]);
  f.brain.execute=async()=>{ f.world.inventory=[{name:'oak_log',count:4}]; return {completed:true,mined:4}; };
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'complete'); assert.equal(f.spoken.length,1);
  assert.match(f.spoken[0],/^Verified:/);
});
test('completion checks a fresh snapshot after the model response', async () => {
  const f=fixture([()=>{f.world.inventory=[];return done();}],{stepLimit:1});
  f.world.inventory=[{name:'oak_log',count:4}];
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(JSON.parse(f.calls[0].body.input[0].content).completionCheck.status,'verified');
  assert.equal(f.data.lastGoal.status,'paused'); assert.deepEqual(f.spoken,[]);
});
test('supported goals cannot bypass verification with a text-only reply', async () => {
  const f=fixture([{status:'completed',output:[],output_text:'Collected four logs.'}]);
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(f.calls[0].body.tool_choice,'required'); assert.equal(f.data.lastGoal.status,'paused'); assert.deepEqual(f.spoken,[]);
});
test('ordinary conversation still replies without an action', async () => {
  const f=fixture([{status:'completed',output:[],output_text:'Hey! Ready to explore?'}]);
  await f.brain.start('Hello BroBot'); await f.brain.active.promise;
  assert.equal(f.calls[0].body.tool_choice,'auto'); assert.equal(f.data.lastGoal.status,'replied'); assert.deepEqual(f.spoken,['Hey! Ready to explore?']);
});
test('compound goals and unrecognized wording are explicitly unverified, not falsely failed inventory checks', async () => {
  for(const goal of ['Gather four logs and craft a table','Build a small shelter','Craft a wooden pickaxe','Collect four logs from the forest']) {
    const f=fixture([done()]);
    await f.brain.start(goal,{persistent:true}); await f.brain.active.promise;
    assert.equal(f.data.lastGoal.status,'unverified'); assert.equal(f.data.lastGoal.verification.status,'unverified');
    assert.match(f.spoken[0],/model report is unverified/i);
  }
});
test('honest blocked reports are still accepted immediately', async () => {
  const f=fixture([call('finish_goal',{outcome:'blocked',message:'No reachable trees.'})]);
  await f.brain.start('Collect four logs'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'blocked'); assert.equal(f.calls.length,1); assert.deepEqual(f.spoken,['No reachable trees.']);
});
test('dimension objectives require the actual destination dimension', async () => {
  const f=fixture([done(),call('enter_portal',{kind:'nether',radius:16,timeout:30}),done()]);
  f.brain.execute=async()=>{ f.world.dimension='minecraft:the_nether'; return {transitioned:true,from:'overworld',to:'nether'}; };
  await f.brain.start('Enter the Nether'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'complete'); assert.equal(f.calls.length,3);
});
test('dragon completion requires a death observation, never readiness, disappearance or saved memory', async () => {
  const f=fixture([call('fight_dragon',{duration:5}),done(),done(),done()]);
  Object.assign(f.world,{dimension:'end',inventory:[{name:'dragon_egg',count:1}],entities:[],memory:{notes:['I killed the dragon']},progression:{dragonDeathObserved:true}});
  f.brain.execute=async()=>({dragonDeathObserved:false,exitPortalObserved:true,arrowsFired:10});
  await f.brain.start('Defeat the ender dragon'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'paused'); assert.match(f.data.lastGoal.reason,/No dragon death event/); assert.deepEqual(f.spoken,[]);
});
test('current-goal dragon death evidence survives bounded model history but not a new goal', async () => {
  const f=fixture([call('fight_dragon',{duration:5}),...Array.from({length:9},()=>call('inspect',{})),done(),done(),done(),done()],{stepLimit:16});
  f.world.dimension='end';
  f.brain.execute=async name=>name==='fight_dragon'?{dragonDeathObserved:true}:{entities:[]};
  await f.brain.start('Defeat the dragon'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'complete');
  assert.equal(JSON.parse(f.calls[10].body.input[0].content).recentResults.some(entry=>entry.action==='fight_dragon'),false);
  await f.brain.start('Defeat the dragon'); await f.brain.active.promise;
  assert.equal(f.data.lastGoal.status,'paused'); assert.match(f.data.lastGoal.reason,/No dragon death event/);
});

test('actual pickup and dragon blocked result contracts hit the retry cap', async () => {
  const cases=[
    ['pickup',{radius:12},{inventory_changes:{},remaining_drops:[{id:1}],unreachable:[{id:1,error:'No path'}]}],
    ['fight_dragon',{duration:5},{dragonDeathObserved:false,arrowsFired:0,meleeAttempts:0,blockedCrystals:[{id:1,obstruction:'Wall'}],reason:'Remaining crystals have blocked or out-of-range trajectories.'}],
    ['attack',{entity_id:1,duration:5},{killed:false,timed_out:true,attacks_sent:0,target_visible:true}],
    ['locate_stronghold',{reset:false},{bearingRecorded:false,nearVerticalFlight:true,observed:{first:{x:0,y:70,z:0},last:{x:0,y:75,z:0}}}]
  ];
  for(const [name,args,result] of cases) {
    const f=fixture(Array.from({length:4},()=>call(name,args)),{stepLimit:4}); let executed=0;
    f.brain.execute=async()=>{executed++;return result;};
    await f.brain.start('Keep working',{persistent:true}); await f.brain.active.promise;
    assert.equal(executed,2,name); assert.equal(f.calls.length,3,name); assert.match(f.data.lastGoal.reason,/Repeated failure/,name);
  }
});
test('partial pickups and combat movement remain eligible for recovery', async () => {
  for(const name of ['pickup','fight_dragon']) {
    const f=fixture([...Array.from({length:3},()=>call(name,{})),call('finish_goal',{outcome:'blocked',message:'Review the remaining work.'})]); let executed=0;
    f.world.position={x:0,y:64,z:0};
    f.brain.execute=async()=>{
      executed++;
      if(name==='pickup')return {inventory_changes:{oak_log:1},remaining_drops:[{id:1}],unreachable:[{id:1,error:'No path'}]};
      f.world.position.x+=5;
      return {dragonDeathObserved:false,arrowsFired:0,meleeAttempts:0,blockedCrystals:[{id:1,obstruction:'Wall'}]};
    };
    await f.brain.start('Keep working',{persistent:true}); await f.brain.active.promise;
    assert.equal(executed,3,name); assert.equal(f.data.lastGoal.status,'blocked',name);
  }
});

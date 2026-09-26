import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../src/brain.js';

function fixture(responses, overrides = {}) {
  const data = {}, calls = [], spoken = [];
  const memory = { get: (k, fallback) => data[k] ?? fallback, set: (k, v) => { data[k] = structuredClone(v); } };
  const config = { apiKey: '', model: 'test-model', maxRequests: 20, maxInputTokens: 1000000, maxOutputTokens: 50000, turnOutputTokens: 2000, stepLimit: 8, intervalMs: 1, ...overrides };
  const client = { responses: { create: async (body, options) => { calls.push({ body, options }); const next=responses.shift(); if(next instanceof Error)throw next; return typeof next==='function'?next(options):next; } } };
  const actions = [];
  const brain = new Brain({ config, memory, definitions: () => [], snapshot: () => ({ connected: true }), execute: async (name,args) => { actions.push({name,args}); return {changed:true}; }, stopActions: () => {}, say: text => spoken.push(text), client });
  return { brain, data, calls, spoken, actions };
}
const call = (name, args) => ({ status:'completed', output:[{type:'function_call',name,arguments:JSON.stringify(args)}], usage:{input_tokens:100,output_tokens:20} });
const done = () => call('finish_goal',{outcome:'complete',message:'Observed result.'});
test('AI executes one bounded action and passes observed result to next decision', async () => {
  const f=fixture([call('collect',{block:'oak_log',count:1,radius:16}),done()]);
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

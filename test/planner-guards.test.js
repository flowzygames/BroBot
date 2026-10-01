import test from 'node:test';
import assert from 'node:assert/strict';
import { completionContract, verifyCompletion, actionMadeProgress, recordCompletionEvidence, unsuccessfulResult } from '../src/planner-guards.js';

test('completion contract parsing is whole-goal, bounded and conservative', () => {
  assert.equal(completionContract('Please collect four oak logs.').count,4);
  assert.deepEqual(completionContract('Have at least 12 minecraft:ender_eye!'),{type:'inventory',items:['ender_eye'],count:12});
  for(const goal of ['Collect 0 logs','Collect 9999999999999999999999 logs','Collect four logs and build a hut','Collect four logs without moving','Collect four wood','Can you collect four logs?','Tell me about diamonds','Do not kill the dragon']) assert.equal(completionContract(goal),null,goal);
});
test('inventory completion sums real stacks and rejects missing, malformed, wrong or insufficient items', () => {
  const contract=completionContract('Collect four logs');
  for(const inventory of [undefined,{},[],[{name:'oak_log',count:3}],[{name:'oak_planks',count:4}],[{name:'oak_log',count:'4'}],[{name:'oak_log',count:Infinity}]]) assert.equal(verifyCompletion(contract,{connected:true,inventory}).status,'unmet');
  const inventory=[{name:'oak_log',count:1},{name:'oak_log',count:1},{name:'birch_log',count:2}];
  assert.equal(verifyCompletion(contract,{connected:true,inventory}).status,'verified');
  assert.equal(verifyCompletion(completionContract('Collect four oak logs'),{connected:true,inventory}).status,'unmet');
  assert.equal(verifyCompletion(contract,{connected:false,inventory}).status,'unmet');
});
test('partial building and pickup count as progress, attempts and generic changes do not', () => {
  assert.equal(actionMadeProgress('build',{completed:false,placed:1},{},{}),true);
  assert.equal(actionMadeProgress('pickup',{inventory_changes:{oak_log:1}},{},{}),true);
  assert.equal(actionMadeProgress('build',{completed:false,placed:0,verified:3},{},{}),false);
  assert.equal(actionMadeProgress('collect',{completed:false,mined:0,changed:true},{},{}),false);
  assert.equal(actionMadeProgress('attack',{attacks_sent:10,killed:false},{},{}),false);
  assert.equal(actionMadeProgress('go_to',{arrived:true},{position:{x:1,y:64,z:1}},{position:{x:1,y:64,z:1}}),false);
});
test('dragon event evidence is limited to actual tool results and identified targets', () => {
  const evidence={};
  recordCompletionEvidence(evidence,'progression_status',{}, {dragonDeathObserved:true},{});
  recordCompletionEvidence(evidence,'shoot',{entity_id:1},{deathObserved:true},{entities:[{id:1,name:'cow'}]});
  assert.equal(evidence.dragonDeathObserved,undefined);
  recordCompletionEvidence(evidence,'shoot',{entity_id:2},{deathObserved:true},{entities:[{id:2,name:'ender_dragon'}]});
  assert.equal(evidence.dragonDeathObserved,true);
  const melee={}; recordCompletionEvidence(melee,'attack',{}, {mob:'ender_dragon',killed:true},{});
  assert.equal(melee.dragonDeathObserved,true);
});

test('unfinished combat with actual attacks is not classified as a zero-progress failure', () => {
  assert.equal(unsuccessfulResult('attack',{killed:false,timed_out:true,attacks_sent:4}),false);
  for(const activity of [{arrowsFired:1,meleeAttempts:0},{arrowsFired:0,meleeAttempts:1}]) {
    assert.equal(unsuccessfulResult('fight_dragon',{dragonDeathObserved:false,blockedCrystals:[{id:1}],...activity}),false);
  }
  assert.equal(unsuccessfulResult('fight_dragon',{dragonDeathObserved:false,arrowsFired:0,meleeAttempts:0,blockedCrystals:[],reason:'Combat time budget reached.'}),false);
  assert.equal(actionMadeProgress('fight_dragon',{dragonDeathObserved:false},{position:{x:0,y:64,z:0}},{position:{x:5,y:64,z:0}}),true);
  assert.equal(actionMadeProgress('locate_stronghold',{bearingRecorded:true},{},{}),true);
});

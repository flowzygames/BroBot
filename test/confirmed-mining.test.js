import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { confirmedMining } from '../src/experimental/confirmed-mining.js';
import { terrainTrustStatus } from '../src/terrain-trust.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function fixture() {
  const bot = new EventEmitter(), position = new Vec3(2,64,0);
  const block = { name:'oak_log', stateId:137, position };
  let cache = block, calls = 0, quits = 0;
  Object.assign(bot, { version:'1.21.8', _client:new EventEmitter(), game:{ dimension:'overworld' },
    registry:{ blocksByName:{ air:{minStateId:0}, cave_air:{minStateId:14014}, void_air:{minStateId:14013} } },
    digTime:()=>0, blockAt:()=>cache, quit:()=>{quits++;}, stopDigging:()=>{}, clearControlStates:()=>{},
    dig:async()=>{ calls++; cache={ name:'air',stateId:0,position }; }
  });
  const packet = stateId => {
    bot._client.emit('packet',{ location:position, type:stateId },{ name:'block_change' });
    cache = { name:stateId===0?'air':'oak_log',stateId,position };
  };
  return { bot,block,packet, calls:()=>calls,quits:()=>quits,setCache:value=>{cache=value;} };
}

test('local prediction and ack-only completion cannot succeed and quarantine the bot', async () => {
  const f=fixture();
  const task=confirmedMining({...f,receiptMs:15});
  f.bot._client.emit('packet',{sequenceId:0},{name:'acknowledge_player_digging'});
  await assert.rejects(task,{code:'MINING_UNCONFIRMED'});
  assert.equal(f.calls(),1);assert.equal(f.quits(),1);assert.equal(terrainTrustStatus(f.bot).trusted,false);
  assert.equal(f.bot._client.listenerCount('packet'),0);
});

test('delayed server air after resolved dig succeeds only after matching cache update', async () => {
  const f=fixture();
  const task=confirmedMining({...f,receiptMs:100});
  await sleep(5); f.packet(0);
  assert.equal((await task).serverObservedAir,true);
  assert.equal(terrainTrustStatus(f.bot).trusted,true);assert.equal(f.quits(),0);
  assert.equal(f.bot._client.listenerCount('packet'),0);
});

test('early receipt cannot release the operation before the dig promise drains', async () => {
  const f=fixture();let resolveDig,settled=false;
  f.bot.dig=()=>new Promise(resolve=>{resolveDig=resolve;});
  const task=confirmedMining({...f,receiptMs:100}).then(value=>{settled=true;return value;});
  f.packet(0);await sleep(5);assert.equal(settled,false);
  resolveDig();assert.equal((await task).serverObservedAir,true);
});

test('air followed by solid then air before continuation stays rejected', async () => {
  const f=fixture();
  f.bot.dig=async()=>{f.packet(0);f.packet(137);f.packet(0);};
  await assert.rejects(confirmedMining({...f,receiptMs:100}),{code:'MINING_UNCONFIRMED'});
  assert.equal(terrainTrustStatus(f.bot).trusted,false);
});

test('server air with contradictory cache is rejected', async () => {
  const f=fixture();
  f.bot.dig=async()=>{f.packet(0);f.setCache(f.block);};
  await assert.rejects(confirmedMining({...f,receiptMs:100}),/loaded target disagree/);
});

test('cancellation quarantines immediately but does not release an undrained dig', async () => {
  const f=fixture(),controller=new AbortController();let resolveDig,settled=false;
  f.bot.dig=()=>new Promise(resolve=>{resolveDig=resolve;});
  const task=confirmedMining({...f,signal:controller.signal,receiptMs:100});
  const rejection=assert.rejects(task,{code:'MINING_UNCONFIRMED'}).then(()=>{settled=true;});
  controller.abort();await sleep(5);
  assert.equal(settled,false);assert.equal(terrainTrustStatus(f.bot).trusted,false);
  f.packet(0);resolveDig();await rejection;
  assert.equal(f.bot._client.listenerCount('packet'),0);
});

test('dig rejection quarantines while unsupported protocol and pre-abort never invoke dig', async () => {
  const f=fixture();f.bot.dig=async()=>{throw Error('dig failed');};
  await assert.rejects(confirmedMining({...f,receiptMs:100}),/dig failed/);
  assert.equal(terrainTrustStatus(f.bot).trusted,false);
  const g=fixture();g.bot.version='1.21.11';
  await assert.rejects(confirmedMining({...g}),/1.21.8 only/);
  assert.equal(g.calls(),0);assert.equal(terrainTrustStatus(g.bot).trusted,true);
  const h=fixture(),controller=new AbortController();controller.abort();
  await assert.rejects(confirmedMining({...h,signal:controller.signal}));
  assert.equal(h.calls(),0);assert.equal(terrainTrustStatus(h.bot).trusted,true);
});

test('unsupported duration and missing state fail before dig without quarantine', async () => {
  for (const mutate of [f=>{f.bot.digTime=()=>60000;},f=>{delete f.block.stateId;}]) {
    const f=fixture();mutate(f);await assert.rejects(confirmedMining({...f}));
    assert.equal(f.calls(),0);assert.equal(terrainTrustStatus(f.bot).trusted,true);
  }
});

test('respawn invalidates receipt while new helper calls cannot revive old bot trust', async () => {
  const f=fixture();
  f.bot.dig=async()=>{f.bot._client.emit('packet',{}, {name:'respawn'});};
  await assert.rejects(confirmedMining({...f}),{code:'MINING_UNCONFIRMED'});
  await assert.rejects(confirmedMining({...f}),{code:'TERRAIN_UNTRUSTED'});
});

test('late air after post-dig budget cannot beat a delayed timeout poll', async () => {
  const f=fixture();
  const task=confirmedMining({...f,receiptMs:20});
  const rejection=assert.rejects(task,/post-dig receipt deadline/);
  await sleep(1);
  const until=performance.now()+30;while(performance.now()<until){}
  f.packet(0);await rejection;
  assert.equal(terrainTrustStatus(f.bot).trusted,false);
});

test('raw replacement stops digging synchronously before another finish packet could run', async () => {
  const f=fixture();let resolveDig,stopped=false;
  f.bot.stopDigging=()=>{stopped=true;};
  f.bot.dig=()=>new Promise(resolve=>{resolveDig=resolve;});
  const task=confirmedMining({...f,receiptMs:100});
  const rejection=assert.rejects(task,{code:'MINING_UNCONFIRMED'});
  f.packet(999);
  assert.equal(stopped,true);assert.equal(terrainTrustStatus(f.bot).trusted,false);
  resolveDig();await rejection;
});

test('ActionRunner retains its lock through quarantined cancellation until dig drains', async () => {
  const {ActionRunner}=await import('../src/runner.js');
  const f=fixture(),runner=new ActionRunner(),controller=new AbortController();let resolveDig;
  f.bot.dig=()=>new Promise(resolve=>{resolveDig=resolve;});
  const task=runner.run('dig',signal=>confirmedMining({...f,signal,receiptMs:100}),()=>{},controller.signal);
  const rejection=assert.rejects(task,/Explicit mining stop/);
  controller.abort(Error('Explicit mining stop'));
  await assert.rejects(runner.run('next',async()=>true),/Still stopping/);
  assert.ok(runner.active);resolveDig();await rejection;assert.equal(runner.active,null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, publicConfig } from '../src/config.js';
import { Memory } from '../src/memory.js';
import { ActionRunner } from '../src/runner.js';

test('runner supplies its unchanged monotonic timeout deadline to the operation',async()=>{
 const runner=new ActionRunner({timeoutMs:1000}),before=performance.now();
 await runner.run('probe',async(signal,limits)=>{assert.ok(limits.deadline>=before+1000);assert.ok(limits.deadline<=performance.now()+1000);assert.equal(signal.aborted,false)});
 assert.equal(runner.active,null);
});
import { authorizedChat, parseCommand } from '../src/commands.js';

test('config rejects malformed ports/budgets and never exposes key in public state', () => {
  assert.throws(() => loadConfig({ MC_PORT: 'bad' }));
  assert.throws(() => loadConfig({ MC_PORT: '70000' }));
  assert.throws(() => loadConfig({ AI_MAX_REQUESTS: '0' }));
  assert.throws(() => loadConfig({ MC_AUTH: 'mojang' }));
  const config = loadConfig({ OPENAI_API_KEY: 'secret' });
  assert.equal(config.minecraft.version, '1.21.8');
  assert.equal(JSON.stringify(publicConfig(config)).includes('secret'), false);
});
test('owner chat gating rejects untrusted players and unaddressed messages', () => {
  assert.equal(authorizedChat('Friend', '!bro stop', 'Owner', 'BroBot'), false);
  assert.equal(authorizedChat('Owner', '!bro stop', '', 'BroBot'), false);
  assert.equal(authorizedChat('Owner', 'break my house', 'Owner', 'BroBot'), false);
  assert.equal(authorizedChat('oWnEr', '!bro follow me', 'Owner', 'BroBot'), true);
  assert.equal(authorizedChat('BroBot', '!bro follow me', 'BroBot', 'BroBot'), false);
});
test('commands distinguish named players, waypoints and AI goals', () => {
  assert.deepEqual(parseCommand('!bro follow me', '.BedrockName'), { kind: 'follow', player: '.BedrockName' });
  assert.deepEqual(parseCommand('goto 1 64 2'), { kind: 'coordinates', x: 1, y: 64, z: 2 });
  assert.deepEqual(parseCommand('goto home'), { kind: 'waypoint_go', name: 'home' });
  assert.throws(() => parseCommand('action collect []'));
  assert.throws(() => parseCommand('goto 1 potato 2'));
  assert.equal(parseCommand('build us a cabin').kind, 'goal');
});
test('memory persists dimension-qualified waypoints and protects object keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brobot-memory-'));
  try {
    const memory = new Memory(dir);
    memory.setWaypoint('home', { x: 1, y: 2, z: 3 }, 'overworld');
    memory.note('The cabin is next to a river.');
    assert.equal(new Memory(dir).getWaypoint('home').dimension, 'overworld');
    assert.throws(() => memory.setWaypoint('__proto__', {}, 'overworld'));
    const snapshot = memory.snapshot(); snapshot.waypoints.home.dimension = 'other';
    assert.equal(memory.getWaypoint('home').dimension, 'overworld');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('stop retains action lock until actual inventory operation drains', async () => {
  const runner = new ActionRunner({ timeoutMs: 10000 });
  let release, stopped = 0;
  const work = runner.run('craft', async signal => { await new Promise(resolve => { release = resolve; }); signal.throwIfAborted(); }, () => { stopped++; });
  runner.stop();
  assert.equal(runner.state().stopping, true);
  await assert.rejects(runner.run('build', async () => {}), /Still stopping/);
  release();
  await assert.rejects(work, /Stopped/);
  assert.equal(runner.state(), null);
  assert.ok(stopped >= 1);
});
test('external cancellation releases controls and prevents new work until drained', async () => {
  const runner = new ActionRunner({ timeoutMs: 10000 });
  const controller = new AbortController();
  let finish;
  const work = runner.run('walk', () => new Promise(resolve => { finish = resolve; }), () => {}, controller.signal);
  controller.abort(new Error('world changed'));
  assert.equal(runner.state().stopping, true);
  finish();
  await assert.rejects(work, /world changed/);
});

test('clearing a path preserves the stop reason instead of surfacing GoalChanged', async () => {
  const runner = new ActionRunner({ timeoutMs: 10000 });
  let rejectPath;
  const work = runner.run('walk', () => new Promise((_, reject) => { rejectPath = reject; }), () => rejectPath(new Error('GoalChanged')));
  runner.stop('Stopped by player');
  await assert.rejects(work, /Stopped by player/);
  assert.equal(runner.state(), null);
});
test('a dead connection can be retired without its late cancellation stopping a replacement', async () => {
  const runner = new ActionRunner({ timeoutMs: 10000 });
  const oldSignal = new AbortController();
  let oldDone, newDone;
  const old = runner.run('old', () => new Promise(resolve => { oldDone=resolve; }), () => {}, oldSignal.signal);
  runner.retire();
  const replacement = runner.run('new', () => new Promise(resolve => { newDone=resolve; }));
  oldSignal.abort();
  assert.equal(runner.state().stopping,false);
  oldDone(); await assert.rejects(old,/Connection ended/);
  assert.equal(runner.state().name,'new');
  newDone();await replacement;
});

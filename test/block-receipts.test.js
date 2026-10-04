import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { decodeBlockChanges, observeServerBlock } from '../src/experimental/block-receipts.js';

function fixture(t, options = {}) {
  const bot = new EventEmitter();
  Object.assign(bot, { version: '1.21.8', _client: new EventEmitter(), game: { dimension: 'overworld' },
    registry: { blocksByName: { air: { minStateId: 0 }, cave_air: { minStateId: 14014 }, void_air: { minStateId: 14013 } } } });
  const position = { x: -17, y: 64, z: -1 };
  const observer = observeServerBlock({ bot, position, ...options });
  t.after(() => observer.dispose());
  const send = (name, data) => bot._client.emit('packet', data, { name });
  const update = stateId => send('block_change', { location: position, type: stateId });
  return { bot, observer, position, send, update };
}

test('decodes section records with negative coordinates without 32-bit truncation', () => {
  const stateId = 1_000_000;
  assert.deepEqual(decodeBlockChanges('multi_block_change', { chunkCoordinates: { x: -2, y: -1, z: -1 }, records: [stateId * 4096 + 15 * 256 + 14 * 16 + 13] }),
    [{ position: { x: -17, y: -3, z: -2 }, stateId }]);
  assert.equal(decodeBlockChanges('block_change', { location: { x: 0, y: NaN, z: 0 }, type: 0 }), null);
  assert.equal(decodeBlockChanges('multi_block_change', { chunkCoordinates: { x: 0, y: 0, z: 0 }, records: [-1] }), null);
});

test('local prediction, digging completion, acknowledgments and unrelated updates are not receipts', t => {
  const f = fixture(t);
  f.bot.emit('blockUpdate', { name: 'oak_log' }, { name: 'air' });
  f.bot.emit('diggingCompleted');
  f.send('acknowledge_player_digging', { sequenceId: 0 });
  f.send('block_change', { location: { ...f.position, x: 0 }, type: 0 });
  assert.equal(f.observer.snapshot().serverObservedAir, false);
  assert.equal(f.observer.snapshot().latest, null);
});

test('latest exact server state wins, including replacement after air', t => {
  const f = fixture(t);
  f.update(17);
  assert.equal(f.observer.snapshot().serverObservedAir, false);
  for (const stateId of [0, 14013, 14014]) {
    f.update(stateId);
    assert.equal(f.observer.snapshot().serverObservedAir, true);
    f.update(99);
    assert.equal(f.observer.snapshot().serverObservedAir, false);
  }
  assert.equal(f.observer.snapshot().latest.sequence, 7);
});

test('multiple records for target preserve packet order and ignore nearby coordinates', t => {
  const f = fixture(t);
  const local = 15 * 256 + 15 * 16;
  f.send('multi_block_change', { chunkCoordinates: { x: -2, y: 4, z: -1 }, records: [local, 51 * 4096 + local, 0] });
  assert.equal(f.observer.snapshot().latest.stateId, 51);
  assert.equal(f.observer.snapshot().serverObservedAir, false);
  f.send('multi_block_change', { chunkCoordinates: { x: -2, y: 4, z: -1 }, records: [local] });
  assert.equal(f.observer.snapshot().serverObservedAir, true);
});

test('column reload/unload, respawn, death and disconnect permanently invalidate', t => {
  for (const event of ['map_chunk', 'unload_chunk', 'respawn', 'death', 'end', 'error']) {
    const f = fixture(t);
    f.update(0);
    if (event === 'death') f.bot.emit(event);
    else if (event === 'end' || event === 'error') f.bot._client.emit(event, new Error('closed'));
    else f.send(event, event === 'map_chunk' ? { x: -2, z: -1 } : { chunkX: -2, chunkZ: -1 });
    f.update(0);
    assert.equal(f.observer.snapshot().active, false, event);
    assert.equal(f.observer.snapshot().serverObservedAir, false, event);
    assert.equal(f.bot._client.listenerCount('packet'), 0, event);
  }
});

test('unrelated chunks remain valid while malformed block packets fail closed', t => {
  const f = fixture(t);
  f.send('map_chunk', { x: 4, z: 2 });
  f.update(0);
  assert.equal(f.observer.snapshot().serverObservedAir, true);
  f.send('block_change', { location: f.position, type: '0' });
  assert.equal(f.observer.snapshot().invalidReason, 'malformed_block_update');
});

test('client replacement and dimension changes invalidate even without an event', t => {
  for (const change of ['client', 'dimension']) {
    const f = fixture(t), oldClient = f.bot._client;
    f.update(0);
    if (change === 'client') f.bot._client = new EventEmitter();
    else f.bot.game.dimension = 'the_nether';
    assert.equal(f.observer.snapshot().serverObservedAir, false);
    assert.equal(oldClient.listenerCount('packet'), 0);
  }
});

test('aborted and expired observers never accept late receipts and release listeners', async t => {
  const controller = new AbortController();
  const f = fixture(t, { signal: controller.signal });
  controller.abort();
  f.update(0);
  assert.equal(f.observer.snapshot().invalidReason, 'aborted');
  const g = fixture(t, { timeoutMs: 10 });
  g.update(0);
  await new Promise(resolve => setTimeout(resolve, 20));
  g.update(0);
  assert.equal(g.observer.snapshot().invalidReason, 'deadline_expired');
  assert.equal(g.bot._client.listenerCount('packet'), 0);
  assert.equal(g.bot.listenerCount('death'), 0);
});

test('pre-aborted signal, explicit disposal and immutable snapshots cannot be revived', t => {
  const controller = new AbortController();
  controller.abort();
  const f = fixture(t, { signal: controller.signal });
  assert.equal(f.observer.snapshot().invalidReason, 'aborted');
  const g = fixture(t);
  g.update(0);
  const snapshot = g.observer.snapshot();
  assert.throws(() => { snapshot.latest.stateId = 7; }, TypeError);
  assert.throws(() => { snapshot.position.x = 0; }, TypeError);
  g.observer.dispose();
  g.observer.dispose();
  g.update(0);
  assert.equal(g.observer.snapshot().invalidReason, 'disposed');
  assert.equal(g.observer.snapshot().serverObservedAir, false);
  assert.equal(g.bot._client.listenerCount('packet'), 0);
});

test('unsupported protocol, absent registry, bad bounds and unknown dimension are rejected', t => {
  const f = fixture(t);
  for (const mutate of [b => { b.version = '1.21.7'; }, b => { b.registry = {}; }, b => { b.game = {}; }]) {
    const b = Object.assign(new EventEmitter(), f.bot);
    mutate(b);
    assert.throws(() => observeServerBlock({ bot: b, position: f.position }));
  }
  assert.throws(() => observeServerBlock({ bot: f.bot, position: { x: 30000000, y: 64, z: 0 } }));
  assert.throws(() => observeServerBlock({ bot: f.bot, position: f.position, timeoutMs: Infinity }));
});

test('invalid signal and initialization failure leave no newly installed listeners', t => {
  const f = fixture(t);
  f.observer.dispose();
  assert.throws(() => observeServerBlock({ bot: f.bot, position: f.position, signal: {} }), /AbortSignal/);
  assert.equal(f.bot._client.listenerCount('packet'), 0);
  const on = f.bot.on.bind(f.bot);
  f.bot.on = (event, fn) => { on(event, fn); throw Error('subscription failure'); };
  assert.throws(() => observeServerBlock({ bot: f.bot, position: f.position }), /subscription failure/);
  for (const event of ['packet','end','error']) assert.equal(f.bot._client.listenerCount(event),0);
  assert.equal(f.bot.listenerCount('death'),0);
});

test('packet callback exceptions invalidate earlier air without escaping', t => {
  const f = fixture(t);
  f.update(0);
  assert.doesNotThrow(() => f.send('block_change', { get location() { throw Error('bad packet'); } }));
  assert.equal(f.observer.snapshot().invalidReason,'packet_observation_error');
  assert.equal(f.observer.snapshot().serverObservedAir,false);
});

test('cleanup attempts every removal even if a remover throws', t => {
  const f = fixture(t);
  const remove = f.bot._client.removeListener.bind(f.bot._client);
  f.bot._client.removeListener = (event, fn) => { remove(event, fn); if (event === 'packet') throw Error('remover failure'); };
  assert.doesNotThrow(() => f.observer.dispose());
  for (const event of ['packet','end','error']) assert.equal(f.bot._client.listenerCount(event),0);
  for (const event of ['death','end']) assert.equal(f.bot.listenerCount(event),0);
  assert.deepEqual(f.observer.snapshot().cleanupErrors,['remover failure']);
});

test('elapsed deadline is checked synchronously even before timeout callback runs', t => {
  const f = fixture(t, { timeoutMs: 5 });
  f.update(0);
  const end = performance.now() + 10;
  while (performance.now() < end) { /* block event loop intentionally */ }
  assert.equal(f.observer.snapshot().invalidReason,'deadline_expired');
  assert.equal(f.observer.snapshot().serverObservedAir,false);
});

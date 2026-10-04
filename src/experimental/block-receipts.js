/** Java 1.21.8 raw server block observer.
 * A matching packet is a server observation, not proof that our dig caused it.
 * The caller still owns operation draining, terrain quarantine, and movement.
 */
import { performance } from 'node:perf_hooks';

const integer = Number.isSafeInteger;
const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;
const validPosition = p => p && ['x', 'y', 'z'].every(k => integer(p[k]));

export function decodeBlockChanges(name, data) {
  if (name === 'block_change') {
    if (!validPosition(data?.location) || !integer(data.type) || data.type < 0) return null;
    return [{ position: { ...data.location }, stateId: data.type }];
  }
  if (name !== 'multi_block_change') return [];
  const section = data?.chunkCoordinates;
  if (!validPosition(section) || !Array.isArray(data.records)) return null;
  const changes = [];
  for (const record of data.records) {
    if (!integer(record) || record < 0) return null;
    changes.push({
      position: {
        x: section.x * 16 + Math.floor(record / 256) % 16,
        y: section.y * 16 + record % 16,
        z: section.z * 16 + Math.floor(record / 16) % 16
      },
      stateId: Math.floor(record / 4096)
    });
  }
  return changes;
}

export function observeServerBlock({ bot, position, timeoutMs = 5000, signal, expectedStateId, onInvalidate }) {
  if (bot?.version !== '1.21.8') throw new Error('Block receipt observer supports Java 1.21.8 only');
  if (!validPosition(position) || Math.abs(position.x) > 29999984 || Math.abs(position.z) > 29999984 || Math.abs(position.y) > 2048) {
    throw new Error('A bounded integer block position is required');
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30000) throw new Error('Receipt deadline must be between 0 and 30000ms');
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('A native AbortSignal is required');
  if (expectedStateId !== undefined && (!integer(expectedStateId) || expectedStateId < 0)) throw new Error('Invalid expected block state');
  if (onInvalidate !== undefined && typeof onInvalidate !== 'function') throw new Error('Invalid invalidation callback');
  const client = bot._client;
  if (!client?.on || !client?.removeListener || !bot.on || !bot.removeListener) throw new Error('An observable bot and client are required');
  const airIds = new Set(['air', 'cave_air', 'void_air'].map(name => bot.registry?.blocksByName?.[name]?.minStateId));
  if (airIds.size !== 3 || [...airIds].some(id => !integer(id) || id < 0)) throw new Error('Complete air-state registry is required');
  const target = Object.freeze({ x: position.x, y: position.y, z: position.z });
  const dimension = bot.game?.dimension;
  if (typeof dimension !== 'string') throw new Error('Known dimension is required');
  const deadline = performance.now() + timeoutMs;
  let invalidReason = null, disposed = false, latest = null, sequence = 0, timer;
  const removers = [], cleanupErrors = [];
  const detach = () => {
    clearTimeout(timer);
    for (const remove of removers.splice(0)) {
      try { remove(); } catch (error) { cleanupErrors.push(String(error?.message ?? error)); }
    }
  };
  const invalidate = reason => {
    const first = !invalidReason && !disposed;
    if (first) invalidReason = reason;
    detach();
    if (first && onInvalidate) {
      try { onInvalidate(reason); } catch (error) { cleanupErrors.push(String(error?.message ?? error)); }
    }
  };
  const subscribe = (emitter, event, fn) => {
    removers.push(() => emitter.removeListener(event, fn));
    emitter.on(event, fn);
  };
  const checkContext = () => {
    if (bot._client !== client || bot.game?.dimension !== dimension) invalidate('world_or_client_changed');
    else if (performance.now() >= deadline) invalidate('deadline_expired');
    else if (signal?.aborted) invalidate('aborted');
    return !invalidReason && !disposed;
  };
  const inspectPacket = (data, metadata) => {
    if (!checkContext()) return;
    const name = metadata?.name;
    if (name === 'respawn') return invalidate('respawn');
    if (name === 'map_chunk' || name === 'unload_chunk') {
      const x = name === 'map_chunk' ? data?.x : data?.chunkX;
      const z = name === 'map_chunk' ? data?.z : data?.chunkZ;
      if (x === Math.floor(target.x / 16) && z === Math.floor(target.z / 16)) invalidate('target_column_replaced_or_unloaded');
      return;
    }
    const changes = decodeBlockChanges(name, data);
    if (changes === null) return invalidate('malformed_block_update');
    for (const change of changes) {
      if (same(change.position, target)) {
        if (expectedStateId !== undefined && !airIds.has(change.stateId) &&
            (change.stateId !== expectedStateId || (latest && airIds.has(latest.stateId)))) {
          invalidate('target_replaced');
          return;
        }
        latest = Object.freeze({ stateId: change.stateId, packet: name, sequence: ++sequence });
      }
    }
  };
  const packet = (data, metadata) => {
    try { inspectPacket(data, metadata); } catch { invalidate('packet_observation_error'); }
  };
  try {
  subscribe(client, 'packet', packet);
  subscribe(client, 'end', () => invalidate('disconnected'));
  subscribe(client, 'error', () => invalidate('client_error'));
  subscribe(bot, 'death', () => invalidate('dead'));
  subscribe(bot, 'end', () => invalidate('disconnected'));
  if (signal) {
    const abort = () => invalidate('aborted');
    removers.push(() => signal.removeEventListener('abort', abort));
    signal.addEventListener('abort', abort, { once: true });
  }
  timer = setTimeout(() => invalidate('deadline_expired'), timeoutMs);
  checkContext();
  } catch (error) { detach(); throw error; }
  return Object.freeze({
    snapshot() {
      checkContext();
      return Object.freeze({
        position: target, dimension, latest, cleanupErrors: Object.freeze([...cleanupErrors]),
        active: !invalidReason && !disposed,
        invalidReason: invalidReason ?? (disposed ? 'disposed' : null),
        serverObservedAir: !invalidReason && !disposed && latest !== null && airIds.has(latest.stateId)
      });
    },
    dispose() { disposed = true; detach(); }
  });
}

// Candidate mining transaction. Requires server observation before returning;
// all unconfirmed attempted edits permanently quarantine this bot connection.
import { observeServerBlock } from './block-receipts.js';
import { assertTerrainTrusted, quarantineTerrain } from '../terrain-trust.js';

export const MINING_DEADLINE_INSUFFICIENT='MINING_DEADLINE_INSUFFICIENT';

export async function confirmedMining({ bot, block, signal, receiptMs = 5000, operationDeadline, now=()=>performance.now() }) {
  assertTerrainTrusted(bot);
  signal?.throwIfAborted();
  if (!Number.isFinite(receiptMs) || receiptMs <= 0 || receiptMs > 5000) throw new Error('Receipt budget must be 1–5000ms');
  if (!Number.isSafeInteger(block?.stateId) || block.stateId < 0 || !block.position || ['air','cave_air','void_air'].includes(block.name)) throw new Error('A loaded non-air target with a state ID is required');
  const digMs = bot.digTime?.(block);
  if (!Number.isFinite(digMs) || digMs < 0 || digMs > 24000) throw new Error('Cannot confirm this mining duration within the supported operation budget');
  // Includes a fixed scheduling allowance, without extending after packets.
  const lifetimeMs = Math.ceil(digMs) + receiptMs + 1000;
  const admit=()=>{
    if(operationDeadline===undefined)return;
    const current=now();
    if(!Number.isFinite(operationDeadline)||!Number.isFinite(current)||operationDeadline-current<lifetimeMs)
      throw Object.assign(Error('Not enough remaining time to confirm another mining operation; stopped before digging'),{code:MINING_DEADLINE_INSUFFICIENT});
  };
  admit();
  let attempted = false, failure = null, watch, receiptDeadline = null;
  const fail = reason => {
    if (!failure) failure = Object.assign(new Error(`Mining not confirmed: ${reason}`), { code: 'MINING_UNCONFIRMED' });
    if (attempted) quarantineTerrain(bot,failure);
    return failure;
  };
  const observer = observeServerBlock({ bot, position: block.position, signal, timeoutMs: lifetimeMs, expectedStateId: block.stateId, onInvalidate: reason => fail(reason) });
  const check = () => {
    if (failure) throw failure;
    const observation = observer.snapshot();
    if (!observation.active) throw fail(observation.invalidReason);
    if (signal?.aborted) throw fail('cancelled');
    assertTerrainTrusted(bot);
    return observation;
  };
  const abort = () => fail('cancelled');
  try {
    signal?.throwIfAborted();
    // The monitor can stop and disconnect an uncertain operation, but never
    // wins a Promise.race against dig. Its underlying promise must drain.
    watch = setInterval(() => {
      try { check(); } catch (error) { fail(error.message); }
    },20);
    signal?.addEventListener('abort',abort,{ once:true });
    check();
    admit();
    attempted = true;
    await bot.dig(block,'ignore');
    check();
    receiptDeadline = performance.now() + receiptMs;
    while (true) {
      const observation = check();
      if (performance.now() >= receiptDeadline) throw fail('post-dig receipt deadline expired');
      if (observation.serverObservedAir) {
        const current = bot.blockAt(block.position);
        if (!current || current.stateId !== observation.latest.stateId || !['air','cave_air','void_air'].includes(current.name)) {
          throw fail('server receipt and loaded target disagree');
        }
        return Object.freeze({ serverObservedAir:true, stateId:observation.latest.stateId, packet:observation.latest.packet });
      }
      await new Promise(resolve => setTimeout(resolve,10));
    }
  } catch (error) {
    if (attempted) throw fail(error.message);
    throw error;
  } finally {
    clearInterval(watch);
    signal?.removeEventListener('abort',abort);
    observer.dispose();
  }
}

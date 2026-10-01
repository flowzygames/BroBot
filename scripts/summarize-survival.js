// Honest same-source development reporting. Never selects a best retry or mixes
// different budgets/revisions into one score. No server or paid API calls.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function summarizeSurvival(records, { seeds = ['718224', '42', '20260930'] } = {}) {
  seeds = seeds.map(String);
  if (!seeds.length || new Set(seeds).size !== seeds.length) throw new Error('Scheduled seeds must be nonempty and unique');
  if (!records.length) throw new Error('At least one result is required');
  const first = records[0], bySeed = new Map();
  const signature = r => JSON.stringify([r.commit, r.protocol, r.environment, r.conditions]);
  for (const record of records) {
    if (record.benchmark !== 'Trailhead' || !/^[a-f0-9]{40}$/.test(record.commit ?? '') || record.dirty !== false) throw new Error('Use clean committed Trailhead results');
    if (record.protocol !== 'trailhead-v1' || record.conditions?.timeBudgetSeconds !== 300 || record.conditions?.freshNaturalWorld !== true || record.conditions?.suppliedItems !== false || record.conditions?.preparedTerrain !== false || record.conditions?.mode !== 'survival' || record.conditions?.difficulty !== 'normal' || record.conditions?.spawnRadius !== 0 || record.conditions?.paidModel !== false || record.conditions?.startCommand !== 'survive starter') throw new Error('Only the fixed 300-second natural-world protocol can be scored here');
    if (signature(record) !== signature(first)) throw new Error('Cannot mix source revisions, environments or conditions');
    const seed = String(record.seed);
    if (!seeds.includes(seed) || bySeed.has(seed)) throw new Error('Unexpected or duplicate seed; do not select a best retry');
    if (!['passed', 'failed', 'error', 'unsupported'].includes(record.status)) throw new Error('Run is unfinished or has an unknown status');
    if (record.passed !== (record.status === 'passed')) throw new Error('Pass flag disagrees with recorded status');
    if (record.passed) {
      const final = record.final, home = record.job?.home, inventory = final?.inventory ?? [];
      const owns = name => inventory.some(item => item.name === name && item.count > 0);
      const distance = home?.position && final?.position ? Math.hypot(...['x','y','z'].map(k => final.position[k] - home.position[k])) : NaN;
      if (record.job?.status !== 'complete' || final.connected !== true || !(final.health > 0) || !owns('stone_pickaxe') || !owns('furnace') || !(distance <= 2.5) || final.dimension !== home.dimension || !(record.elapsedMs >= 0 && record.elapsedMs <= 301000)) throw new Error('Passing run lacks verified starter completion evidence');
    }
    bySeed.set(seed, record);
  }
  const cases = seeds.map(seed => {
    const record = bySeed.get(seed);
    return record ? { seed, status: record.status, passed: record.passed, elapsedMs: record.elapsedMs ?? null, reason: record.reason ?? record.error ?? null } : { seed, status: 'not_run', passed: false, elapsedMs: null, reason: 'Scheduled case has no result' };
  });
  return { schemaVersion: 1, benchmark: 'Trailhead', classification: 'development', commit: first.commit, protocol: first.protocol, environment: first.environment, conditions: first.conditions, passed: cases.filter(c => c.passed).length, scheduled: seeds.length, completed: records.length, complete: records.length === seeds.length, cases, note: 'Known development worlds; not evidence of broad or held-out reliability. Retain all individual run records and failed attempts.' };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2), seedOption = args.find(arg => arg.startsWith('--seeds='));
    const files = args.filter(arg => !arg.startsWith('--seeds='));
    const result = summarizeSurvival(files.map(file => JSON.parse(readFileSync(file, 'utf8'))), seedOption ? { seeds: seedOption.slice(8).split(',') } : {});
    console.log(JSON.stringify(result, null, 2));
    if (!result.complete) process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}

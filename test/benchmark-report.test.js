import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSurvival } from '../scripts/summarize-survival.js';
const run = (seed, passed = true) => ({ benchmark: 'Trailhead', commit: 'a'.repeat(40), dirty: false, protocol: 'trailhead-v1', environment: { minecraft: '1.21.8' }, conditions: { timeBudgetSeconds: 300, freshNaturalWorld: true, suppliedItems: false, preparedTerrain: false, mode: 'survival', difficulty: 'normal', spawnRadius: 0, paidModel: false, startCommand: 'survive starter' }, seed: String(seed), status: passed ? 'passed' : 'failed', passed, elapsedMs: 123000, final: { connected: true, health: 20, dimension: 'overworld', position: { x: .5, y: 64, z: .5 }, inventory: [{ name: 'stone_pickaxe', count: 1 }, { name: 'furnace', count: 1 }] }, job: { status: 'complete', home: { dimension: 'overworld', position: { x: .5, y: 64, z: .5 } } } });
test('benchmark report preserves failures and missing scheduled cases in the denominator', () => {
 const report = summarizeSurvival([run(718224), run(42, false)]);
 assert.equal(report.passed, 1); assert.equal(report.scheduled, 3); assert.equal(report.complete, false); assert.equal(report.cases[2].status, 'not_run');
});
test('benchmark report rejects mixed sources, retries, dirty source and different time limits', () => {
 for (const change of [{commit:'b'.repeat(40)}, {dirty:true}, {protocol:'trailhead-development-600s'}, {environment:{minecraft:'other'}}]) assert.throws(() => summarizeSurvival([run(718224), {...run(42), ...change}]));
 assert.throws(() => summarizeSurvival([run(718224), run(718224)]), /duplicate/);
});
test('benchmark report verifies the actual kit and return instead of trusting the pass flag', () => {
 const good = run(718224);
 for (const final of [{...good.final,inventory:[]}, {...good.final,health:0}, {...good.final,position:{x:100,y:64,z:0}}, {...good.final,dimension:'the_nether'}]) assert.throws(() => summarizeSurvival([{...good, final}]), /evidence/);
 assert.throws(() => summarizeSurvival([{...good,passed:false}]), /disagrees/);
});
test('complete same-revision suite reports its measured count without an intelligence score', () => {
 const report = summarizeSurvival([run(718224), run(42), run(20260930)]);
 assert.equal(report.complete, true); assert.equal(report.passed, 3); assert.equal(report.classification, 'development');
});

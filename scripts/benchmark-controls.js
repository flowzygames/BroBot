import assert from 'node:assert/strict';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const repo = resolve(option('repo', '.')), label = option('label', 'working-tree');
const load = file => import(pathToFileURL(join(repo, 'src', file)));
const { parseCommand, authorizedChat } = await load('commands.js');
const { ActionRunner } = await load('runner.js');
const { completionContract, verifyCompletion } = await load('planner-guards.js');
const { Brain } = await load('brain.js');
const result = { schemaVersion: 1, protocol: 'controls-v1', label, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim()), environment: { platform: process.platform, node: process.version }, conditions: { mode: 'local-command-grammar-and-simulated-control-failures', paidModel: false, languageModelUnderstanding: 'not tested' }, cases: [] };
async function trial(group, id, fn) { const c = { group, id, passed: false }; result.cases.push(c); try { await fn(); c.passed = true; } catch (e) { c.error = e.message; } }
const commands = [
  ['stop', { kind: 'stop' }], ['pause', { kind: 'stop' }], ['!bro follow me', { kind: 'follow', player: 'Owner' }],
  ['come here', { kind: 'come', player: 'Owner' }], ['goto 1 64 -2', { kind: 'coordinates', x: 1, y: 64, z: -2 }],
  ['goto camp', { kind: 'waypoint_go', name: 'camp' }], ['remember camp', { kind: 'waypoint', name: 'camp' }],
  ['home', { kind: 'waypoint_go', name: 'home' }], ['inventory', { kind: 'inventory' }], ['status', { kind: 'status' }],
  ['action collect {"block":"stone","count":3}', { kind: 'action', name: 'collect', args: { block: 'stone', count: 3 } }],
  ['goal Gather wood', { kind: 'goal', text: 'Gather wood', persistent: true }],
  ['survive starter', { kind: 'survival', resume: false }], ['survive resume', { kind: 'survival', resume: true }]
];
for (const [input, expected] of commands) await trial('CommandSense', input, () => assert.deepEqual(parseCommand(input, 'Owner'), expected));
await trial('SafetyLatch', 'only-owner-commands', () => { assert.equal(authorizedChat('Stranger', '!bro follow me', 'Owner', 'BroBot'), false); assert.equal(authorizedChat('Owner', '!bro follow me', 'Owner', 'BroBot'), true); });
await trial('SafetyLatch', 'invalid-action-json', () => { assert.throws(() => parseCommand('action collect []')); assert.throws(() => parseCommand('action collect {invalid}')); });
await trial('SafetyLatch', 'stop-retains-lock', async () => {
  const runner = new ActionRunner(); let release;
  const pending = runner.run('work', signal => new Promise(resolve => { release = () => resolve(signal.aborted); }));
  runner.stop('benchmark stop'); await assert.rejects(runner.run('other', async () => {}), /Still/);
  release(); await assert.rejects(pending, /benchmark stop/); assert.equal(runner.state(), null);
});
await trial('SafetyLatch', 'pre-cancelled-does-not-act', async () => {
  const c = new AbortController(); c.abort(new Error('cancelled')); let calls = 0;
  await assert.rejects(new ActionRunner().run('work', async () => { calls++; }, () => {}, c.signal)); assert.equal(calls, 0);
});
await trial('SafetyLatch', 'completion-needs-observed-items', () => {
  assert.equal(verifyCompletion(completionContract('Collect 3 cobblestone'), { inventory: [], connected: true }, {}).status, 'unmet');
});
await trial('SafetyLatch', 'api-failure-does-not-execute', async () => {
  const data = {}; let calls = 0;
  const brain = new Brain({ config: { apiKey: '', model: 'fixture', maxRequests: 2, maxInputTokens: 100000, maxOutputTokens: 10000, turnOutputTokens: 1000, stepLimit: 2, intervalMs: 1 }, memory: { get: (k, d) => data[k] ?? d, set: (k, v) => { data[k] = v; } }, definitions: () => [], snapshot: () => ({ connected: true, inventory: [] }), execute: async () => { calls++; }, stopActions: () => {}, say: () => {}, client: { responses: { create: async () => { throw new Error('Injected network failure'); } } } });
  await brain.start('Collect three cobblestone'); await brain.active.promise;
  assert.equal(calls, 0); assert.equal(data.lastGoal.status, 'paused');
});
result.passed = result.cases.every(c => c.passed); result.finished = new Date().toISOString();
const directory = resolve('.server/benchmarks'); await mkdir(directory, { recursive: true });
const path = join(directory, `controls-${label.replace(/[^a-zA-Z0-9_-]/g, '-')}-${Date.now()}.json`); await writeFile(path, JSON.stringify(result, null, 2));
console.log(JSON.stringify({ passed: result.passed, passedCases: result.cases.filter(c => c.passed).length, total: result.cases.length, result: path }));
// Unsupported older-version cases are legitimate measured failures, not a harness error.

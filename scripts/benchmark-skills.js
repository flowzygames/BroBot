// Fixed prepared skills fixtures, explicitly separate from fresh-world autonomy.
import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const repo = resolve(option('repo', '.')), label = option('label', 'working-tree');
const { Runtime } = await import(pathToFileURL(join(repo, 'src/runtime.js')));
const { loadConfig } = await import(pathToFileURL(join(repo, 'src/config.js')));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const git = args => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
await requireEula(SERVER_DIR, { interactive: false });
const { java } = await setupServer({ log: console.log });
const directory = join(SERVER_DIR, 'benchmarks', `skills-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`);
await mkdir(join(directory, 'plugins'), { recursive: true });
for (const file of ['Geyser-Spigot.jar', 'ViaVersion.jar']) await copyFile(join(SERVER_DIR, 'plugins', file), join(directory, 'plugins', file));
await copyFile(join(SERVER_DIR, 'eula.txt'), join(directory, 'eula.txt'));
const port = Number(process.env.BENCHMARK_JAVA_PORT || 25577);
await writeServerConfig(directory, { port, bedrockPort: Number(process.env.BENCHMARK_BEDROCK_PORT || 19144), smoke: true });
const result = { schemaVersion: 1, protocol: 'skills-v1', label, commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])), environment: { node: process.version, platform: process.platform, minecraft: VERSION }, conditions: { preparedTerrain: true, suppliedIngredients: true, mode: 'survival', difficulty: 'peaceful', paidModel: false, perActionSeconds: 45 }, cases: [], started: new Date().toISOString() };
let output = '', exited = false, runtime;
const stream = createWriteStream(join(directory, 'server.log'));
const server = await spawnServer({ directory, java: java.path, pipe: true });
server.once('close', () => { exited = true; });
for (const source of [server.stdout, server.stderr]) source.on('data', chunk => { output = (output + chunk).slice(-100000); stream.write(chunk); });
async function wait(test, ms, label) { const end = Date.now() + ms; while (!test()) { if (exited || Date.now() > end) throw new Error(`${label}: ${output.slice(-1000)}`); await sleep(100); } }
async function commands(lines) { const marker = `BENCH_${randomUUID()}`; server.stdin.write(`${lines.join('\n')}\nsay ${marker}\n`); await wait(() => output.includes(marker), 15000, 'Fixture commands'); await sleep(300); }
const inventoryCount = name => runtime.bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
async function reset(extra = []) { runtime.stop('Reset isolated benchmark fixture'); await commands(['gamemode survival BroBotBench', 'clear BroBotBench', 'kill @e[type=item]', 'fill -12 64 -12 20 64 20 bedrock', 'fill -12 65 -12 20 70 20 air', 'tp BroBotBench 0.5 65 0.5', ...extra]); await runtime.bot.waitForChunksToLoad(); }
async function runCase(group, id, prepare, perform, verify) {
  const entry = { group, id, passed: false }; result.cases.push(entry);
  const start = Date.now();
  try { await reset(prepare); entry.initialInventory = runtime.snapshot().inventory; entry.result = await perform(); entry.finalInventory = runtime.snapshot().inventory; if (!verify(entry.result)) throw new Error('Observed postcondition was not met.'); entry.passed = true; }
  catch (error) { entry.error = error.message; }
  entry.elapsedMs = Date.now() - start; console.log(`${entry.passed ? 'PASS' : 'FAIL'} ${id}`);
}
try {
  await wait(() => output.includes('Done ('), 300000, 'Startup');
  runtime = new Runtime(loadConfig({ MC_PORT: String(port), MC_USERNAME: 'BroBotBench', BROBOT_DATA_DIR: join(directory, 'memory'), ACTION_TIMEOUT_MS: '45000' })); runtime.connect();
  await wait(() => runtime.connection === 'connected', 60000, 'Bot connection'); await runtime.bot.waitForChunksToLoad();
  const act = (name, args) => runtime.execute(name, args);
  for (const [id, block, drop, count, tool] of [['timber', 'oak_log', 'oak_log', 4, null], ['stone', 'stone', 'cobblestone', 4, 'wooden_pickaxe'], ['iron', 'iron_ore', 'raw_iron', 3, 'stone_pickaxe']]) {
    const prepare = [`fill 5 65 0 ${4 + count} 65 0 ${block}`, ...(tool ? [`give BroBotBench ${tool} 1`] : [])];
    await runCase('MineLine', id, prepare, () => act('collect', { block, count, radius: 16 }), () => inventoryCount(drop) >= count);
  }
  const recipes = [
    ['planks', 'oak_planks', 8, ['oak_log 2']], ['handles', 'stick', 8, ['oak_planks 4']], ['table', 'crafting_table', 1, ['oak_planks 4']],
    ['wood-pick', 'wooden_pickaxe', 1, ['oak_planks 3', 'stick 2', 'crafting_table 1']],
    ['stone-pick', 'stone_pickaxe', 1, ['cobblestone 3', 'stick 2', 'crafting_table 1']],
    ['furnace', 'furnace', 1, ['cobblestone 8', 'crafting_table 1']]
  ];
  for (const [id, item, count, ingredients] of recipes) await runCase('Workbench', id, ingredients.map(i => `give BroBotBench ${i}`), () => act('craft', { item, count }), () => inventoryCount(item) >= count);
  await runCase('Pathfinder', 'wall-detour', ['fill 4 65 -2 4 67 2 stone'], () => act('go_to', { x: 8, y: 65, z: 4, radius: 0 }), () => runtime.bot.entity.position.distanceTo({ x: 8.5, y: 65, z: 4.5 }) < 1);
  await runCase('Pathfinder', 'climb-and-return', ['fill 5 65 0 8 65 3 stone'], async () => { await act('go_to', { x: 7, y: 66, z: 1, radius: 0 }); return act('go_to', { x: 0, y: 65, z: 0, radius: 0 }); }, () => runtime.bot.entity.position.distanceTo({ x: 0.5, y: 65, z: 0.5 }) < 1);
  result.passed = result.cases.every(c => c.passed);
} catch (error) { result.error = error.message; result.passed = false; }
finally {
  if (runtime) await runtime.close(); await stopServer(server, 45000); stream.end(); result.finished = new Date().toISOString();
  const path = join(directory, 'result.json'); await writeFile(path, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, result: path })); if (!result.passed) process.exitCode = 1;
}

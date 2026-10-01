// Fresh natural-world evaluation. The controller receives no seed or console
// access, no prepared terrain, no granted inventory, and only one start command.
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const option = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? fallback;
const repo = resolve(option('repo', '.'));
const { Runtime } = await import(pathToFileURL(join(repo, 'src/runtime.js')));
const { loadConfig } = await import(pathToFileURL(join(repo, 'src/config.js')));
const seed = option('seed', '718224');
const seconds = Number(option('seconds', '300'));
const label = option('label', 'working-tree');
if (!/^-?\d{1,19}$/.test(seed) || !Number.isInteger(seconds) || seconds < 30 || seconds > 900) throw new Error('Use an integer seed and seconds from 30 to 900.');
await requireEula(SERVER_DIR, { interactive: false });
const { java } = await setupServer({ log: console.log });
const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const directory = join(SERVER_DIR, 'benchmarks', runId);
await mkdir(join(directory, 'plugins'), { recursive: true });
for (const name of ['Geyser-Spigot.jar', 'ViaVersion.jar']) await copyFile(join(SERVER_DIR, 'plugins', name), join(directory, 'plugins', name));
await copyFile(join(SERVER_DIR, 'eula.txt'), join(directory, 'eula.txt'));
const port = Number(process.env.BENCHMARK_JAVA_PORT || 25577);
await writeServerConfig(directory, { port, bedrockPort: Number(process.env.BENCHMARK_BEDROCK_PORT || 19144) });
const properties = join(directory, 'server.properties');
await writeFile(properties, `${await readFile(properties, 'utf8')}\nlevel-seed=${seed}\n`);
const git = args => { try { return execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim(); } catch { return null; } };
const result = {
  schemaVersion: 1, benchmark: 'Trailhead', protocol: seconds === 300 ? 'trailhead-v1' : `trailhead-development-${seconds}s`, label,
  commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])),
  environment: { node: process.version, platform: process.platform, minecraft: VERSION }, seed,
  conditions: { freshNaturalWorld: true, difficulty: 'normal', mode: 'survival', suppliedItems: false, preparedTerrain: false, consoleActions: ['spawnRadius=0 before connection only'], spawnRadius: 0, paidModel: false, controller: 'offline-observation-driven', timeBudgetSeconds: seconds, startCommand: 'survive starter' },
  started: new Date().toISOString(), status: 'running', passed: false
};
const stream = createWriteStream(join(directory, 'server.log'));
let output = '', exited = false, runtime, traceTimer;
result.trace = [];
const server = await spawnServer({ directory, java: java.path, pipe: true });
server.once('close', () => { exited = true; });
server.once('error', error => { output += error.message; });
for (const source of [server.stdout, server.stderr]) source.on('data', chunk => { output = (output + chunk).slice(-100000); stream.write(chunk); });
async function waitUntil(test, ms, description) {
  const deadline = Date.now() + ms;
  while (!test()) { if (exited || Date.now() >= deadline) throw new Error(`${description} failed: ${output.slice(-1000)}`); await sleep(100); }
}
try {
  await waitUntil(() => output.includes('Done ('), 300000, 'Server startup');
  // Fix the initial spawn cell, not the terrain or inventory. The controller
  // never receives console access and no interventions occur during the job.
  const marker = `SPAWN_${randomUUID()}`;
  server.stdin.write(`gamerule spawnRadius 0\nsay ${marker}\n`);
  await waitUntil(() => output.includes(marker) && /spawnRadius.*(?:set to: )?0/.test(output), 15000, 'Fixed spawn setup');
  runtime = new Runtime(loadConfig({ MC_PORT: String(port), MC_USERNAME: 'BroBotBench', BROBOT_DATA_DIR: join(directory, 'memory'), ACTION_TIMEOUT_MS: '45000' }));
  runtime.connect();
  await waitUntil(() => runtime.connection === 'connected', 60000, 'Bot connection');
  await runtime.bot.waitForChunksToLoad(); await sleep(1000);
  result.initial = runtime.snapshot();
  // Read-only diagnostic samples. No movement, inventory or world edits.
  const sample = () => {
    if (!runtime?.bot?.entity?.position) return;
    const state = runtime.snapshot(), feet = runtime.bot.entity.position.floored();
    const nearby = [];
    for (let x=-1;x<=1;x++) for(let z=-1;z<=1;z++) for(let y=-1;y<=2;y++) {
      const p=feet.offset(x,y,z), b=runtime.bot.blockAt(p);
      if(b && !['air','cave_air','void_air'].includes(b.name)) nearby.push({name:b.name,x:p.x,y:p.y,z:p.z});
    }
    result.trace.push({at:new Date().toISOString(),position:state.position,health:state.health,food:state.food,action:state.action?.name,inventory:state.inventory,nearby});
    if(result.trace.length>200)result.trace.shift();
  };
  sample(); traceTimer=setInterval(sample,5000);

  if (result.initial.inventory.length || runtime.bot.game.gameMode !== 'survival') throw new Error('Benchmark requires empty survival inventory.');
  if (!runtime.survival) {
    result.status = 'unsupported'; result.reason = 'This version does not implement the offline starter command.'; result.elapsedMs = 0; result.final = runtime.snapshot();
  } else {
  runtime.survival.maxDurationMs = seconds * 1000;
  const started = Date.now();
  result.command = await runtime.command('survive starter');
  await runtime.survival.promise;
  result.elapsedMs = Date.now() - started;
  result.job = runtime.survival.state(); result.final = runtime.snapshot();
  result.passed = result.job.status === 'complete'; result.status = result.passed ? 'passed' : 'failed';
  result.reason = result.job.reason;
  }
} catch (error) { result.status = 'error'; result.error = error.message; }
finally {
  clearInterval(traceTimer);
  if (runtime) await runtime.close();
  await stopServer(server, 45000); stream.end();
  result.finished = new Date().toISOString();
  const path = join(directory, 'result.json'); await writeFile(path, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ benchmark: result.benchmark, seed, status: result.status, elapsedMs: result.elapsedMs, reason: result.reason ?? result.error, result: path }));
  if (!result.passed) process.exitCode = 1;
}

// Console-prepared integration fixture, never called by the production controller.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Vec3 } from 'vec3';
import { execFileSync } from 'node:child_process';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `animal-interrupt-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-animal-interrupt', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared real-server damage event attributed to an observed no-AI polar bear while starter mining is held at aim. Verify early interruption, no mining start and no zombie recovery. Console-induced damage is not a natural attack or rescue demonstration.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-animal-interrupt.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-animal-interrupt.js', import.meta.url))).digest('hex');
await mkdir(directory, { recursive: true });
let releaseAim;
let output = '', runtime, guardActions, child, log, sampleTimer, interrupted;
const interrupt = signal => { interrupted = Error(`Interrupted by ${signal}`); guardActions?.stop(); runtime?.stop(interrupted.message); };
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timed out`)),ms)})]); }
  finally { clearTimeout(timer); }
}
async function waitFor(test, ms, label) {
  const end = Date.now() + ms;
  while (!test()) {
    if (interrupted) throw interrupted;
    if (Date.now() > end) throw Error(`${label} timed out`);
    await sleep(20);
  }
}
async function command(lines) {
  const marker = randomUUID();
  child.stdin.write(lines.join('\n') + `\nsay ${marker}\n`);
  await waitFor(() => output.includes(marker), 10000, 'console acknowledgement');
}
try {
  result.commit=execFileSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8'}).trim();
  result.dirty=Boolean(execFileSync('git',['status','--porcelain'],{cwd:ROOT,encoding:'utf8'}).trim());
  assert.equal(result.dirty,false,'prepared proof requires frozen clean source');
  await requireEula(SERVER_DIR, { interactive: false });
  const { java } = await setupServer({ log: console.log });
  const port = 25641, bedrockPort = 19151;
  if (await pingTcp('127.0.0.1', port)) throw Error('Empty-search diagnostic port already occupied');
  await mkdir(join(directory, 'plugins'), { recursive: true });
  for (const name of ['Geyser-Spigot.jar','ViaVersion.jar']) await copyFile(join(SERVER_DIR,'plugins',name),join(directory,'plugins',name));
  await copyFile(join(SERVER_DIR,'eula.txt'),join(directory,'eula.txt'));
  await writeServerConfig(directory, { port, bedrockPort, smoke: true });
  log = createWriteStream(join(directory,'server.log'));
  child = await spawnServer({ directory, java: java.path, pipe: true });
  for (const stream of [child.stdout,child.stderr]) stream.on('data', chunk => {
    output = (output + chunk.toString()).slice(-200000); log.write(chunk);
  });
  await waitFor(() => output.includes('Done ('), 300000, 'server startup');
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set day',
    'fill -4 62 -4 16 63 16 stone','fill -4 64 -4 16 70 16 air','setblock 2 64 0 oak_log','setworldspawn 0 64 0','gamerule spawnRadius 0',
    'summon polar_bear 12.5 64 12.5 {NoAI:1b,Silent:1b}']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const bot=runtime.bot;
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome']);
  await waitFor(()=>bot.entity.onGround&&bot.health===20&&Object.values(bot.entities).some(e=>e.name==='polar_bear'),5000,'player and bear');
  let held=false;const look=bot.lookAt.bind(bot),write=bot._client.write.bind(bot._client);
  result.packets=[];
  bot._client.write=(name,packet)=>{if(['block_dig','block_place'].includes(name))result.packets.push({name,packet});return write(name,packet)};
  bot.lookAt=async(...args)=>{if(!held){held=true;await new Promise(resolve=>{releaseAim=resolve})}return look(...args)};
  result.before=runtime.snapshot();result.command=await runtime.command('survive starter');
  await waitFor(()=>held&&runtime.runner.active?.name==='collect',10000,'starter held at aim');
  result.heldAction=runtime.runner.state();
  await command(['damage BroBotHome 1 minecraft:mob_attack by @e[type=minecraft:polar_bear,limit=1]']);
  await waitFor(()=>runtime.survival.active?.signal.aborted&&runtime.runner.active?.controller.signal.aborted,5000,'animal attack interrupts active starter');
  result.interruptedHealth=bot.health;
  assert.ok(bot.health>8,'interruption must precede the low-health threshold');
  assert.equal(runtime.survival.hostileRecovery,null);
  assert.ok(!result.packets.some(p=>p.name==='block_dig'&&p.packet.status===0));
  releaseAim();releaseAim=null;
  await waitFor(()=>!runtime.runner.active&&!runtime.survival.active,5000,'cancelled action drains');
  result.job=runtime.survival.state();assert.equal(result.job.status,'paused');assert.match(result.job.reason,/polar_bear.*no supported automatic retreat/);
  result.injuries=runtime.injuryObserver.recent();assert.ok(result.injuries.some(i=>i.kind==='hurt_observation'&&i.source?.name==='polar_bear'&&i.source?.type==='animal'));
  assert.equal(bot.blockAt(new Vec3(2,64,0))?.name,'oak_log');
  assert.ok(!bot.inventory.items().some(i=>i.name==='oak_log'));
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(n=>[n,bot.getControlState(n)]));
  assert.ok(Object.values(result.controls).every(v=>v===false));assert.equal(runtime.connection,'connected');
  result.final=runtime.snapshot();result.passed=true;

} catch (error) {
  result.error = error.stack ?? error.message;
  process.exitCode = 1;
  console.error('FAIL',error.message);
} finally {
  releaseAim?.();
  clearInterval(sampleTimer);
  guardActions?.stop();
  if (runtime) {
    try { result.lastObserved=runtime.snapshot(); result.lastJob=runtime.survival.state(); }
    catch(error) {result.cleanupErrors.push(error.message);}
    try { await bounded(runtime.close(),5000,'runtime close'); }
    catch(error) {result.cleanupErrors.push(error.message);}
  }
  if (child) {
    try { await bounded(stopServer(child,10000),15000,'server stop'); }
    catch(error) {
      result.cleanupErrors.push(error.message);
      child.kill('SIGKILL');
      try {if(child.exitCode===null&&!child.signalCode)await bounded(once(child,'exit'),5000,'forced server exit');}
      catch(exitError){result.cleanupErrors.push(exitError.message);}
    }
  }
  process.off('SIGINT',onInt);process.off('SIGTERM',onTerm);
  log?.end();
  if(interrupted||result.cleanupErrors.length){result.passed=false;process.exitCode=1;result.interrupted=interrupted?.message;}
  result.finished = new Date().toISOString();
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(result.passed ? 'PASS prepared observed-animal interruption' : 'FAIL prepared observed-animal interruption; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

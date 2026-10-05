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
const directory = join(SERVER_DIR, 'smoke', `pickup-route-budget-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-pickup-route-budget', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Console-prepared wall detour with supplied dropped log: starter pickup refuses a long certified route before movement, then reconsiders and collects after the wall opens. Admission is a conservative heuristic, not a travel-time guarantee or natural survival success.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-pickup-route-budget.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-pickup-route-budget.js', import.meta.url))).digest('hex');
await mkdir(directory, { recursive: true });
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
    'fill -4 62 -13 8 63 13 stone','fill -4 64 -13 8 70 13 air','fill 1 64 -9 1 67 9 stone','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const bot=runtime.bot;
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome','summon item 3.5 64.1 .5 {Item:{id:"minecraft:oak_log",count:1},PickupDelay:0}']);
  await waitFor(()=>bot.entity.onGround&&Object.values(bot.entities).some(e=>e.name==='item'),5000,'grounded player and drop');await sleep(500);
  const drop=Object.values(bot.entities).find(e=>e.name==='item'),before=bot.entity.position.clone(),parent=new AbortController();
  const context={starterScope:'prepared/pickup-route-budget'},args={radius:12,entity_ids:[drop.id]};
  let nonNullGoals=0;const original=bot.pathfinder.setGoal.bind(bot.pathfinder);
  bot.pathfinder.setGoal=(goal,...rest)=>{if(goal)nonNullGoals++;return original(goal,...rest)};
  result.before=runtime.snapshot();
  result.refused=await runtime.execute('pickup',args,parent.signal,context);
  result.nonNullGoalsBeforeOpening=nonNullGoals;
  assert.equal(nonNullGoals,0);assert.ok(bot.entity.position.distanceTo(before)<.01);
  assert.equal(result.refused.pickup_limited,true);assert.equal(result.refused.pursuit_unverified,false);
  assert.equal(result.refused.deferred_drops.length,0);assert.ok(result.refused.remaining_drops.some(e=>e.id===drop.id));
  assert.ok(result.refused.unreachable.some(e=>e.code==='PICKUP_ROUTE_BUDGET'));
  result.afterRefusal=runtime.snapshot();
  await command(['fill 1 64 -9 1 67 9 air']);
  await waitFor(()=>bot.blockAt(new Vec3(1,64,0))?.name==='air',5000,'observed wall opening');
  result.retry=await runtime.execute('pickup',args,parent.signal,context);
  assert.equal(result.retry.inventory_changes.oak_log,1);assert.equal(result.retry.remaining_drops.length,0);
  assert.equal(result.retry.pickup_limited,false);assert.ok(nonNullGoals>0);
  parent.abort();
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(n=>[n,bot.getControlState(n)]));
  assert.ok(Object.values(result.controls).every(v=>v===false));assert.equal(runtime.runner.active,null);
  assert.equal(bot.health,20);assert.equal(runtime.connection,'connected');
  result.final=runtime.snapshot();result.passed=true;

} catch (error) {
  result.error = error.stack ?? error.message;
  process.exitCode = 1;
  console.error('FAIL',error.message);
} finally {
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
  console.log(result.passed ? 'PASS prepared pickup route budget' : 'FAIL prepared pickup route budget; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

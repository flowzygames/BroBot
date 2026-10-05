// Console-prepared integration fixture, never called by the production controller.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Vec3 } from 'vec3';
import { execFileSync } from 'node:child_process';
import { createActions } from '../src/actions.js';
import { hasAnchoredLeafLanding } from '../src/starter-leaf-support.js';
import { retainedLeafAnchor } from '../src/construction-guards.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `mining-deadline-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-mining-deadline', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared peaceful arena with one oak log. Starter-job and action deadlines must refuse mining before any start-dig packet or quarantine; a sufficiently budgeted action then mines the same unchanged log with a server receipt and inventory gain. Supplied terrain; no natural-world success claim.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-mining-deadline.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-mining-deadline.js', import.meta.url))).digest('hex');
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
function geometry() {
  return [[0,63,0],[1,63,0],[1,63,1],[2,63,0],[2,63,1],[3,63,0]].map(([x,y,z])=>{
    const block=runtime.bot.blockAt(new Vec3(x,y,z));
    return {x,y,z,name:block?.name,properties:block?.getProperties?.()};
  });
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
  if (await pingTcp('127.0.0.1', port)) throw Error('Home-anchor diagnostic port already occupied');
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
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set day','fill -4 62 -4 4 63 4 stone','fill -4 64 -4 4 70 4 air','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const bot=runtime.bot,target=new Vec3(2,64,0),write=bot._client.write.bind(bot._client),dig=bot.dig.bind(bot);
  // block_dig also carries status5 release-use-item cleanup, which is not a dig.
  result.digPackets=[];result.digs=[];
  bot._client.write=(name,packet)=>{if(name==='block_dig')result.digPackets.push({at:new Date().toISOString(),packet});return write(name,packet);};
  bot.dig=(block,...args)=>{result.digs.push({at:new Date().toISOString(),name:block.name,digMs:bot.digTime(block)});return dig(block,...args);};
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome','setblock 2 64 0 oak_log']);
  await waitFor(()=>bot.entity.onGround&&bot.blockAt(target)?.name==='oak_log'&&bot.inventory.items().length===0,5000,'prepared mining target');
  result.predictedDigMs=bot.digTime(bot.blockAt(target));
  runtime.survival.maxDurationMs=8000;
  result.start=await runtime.command('survive starter');await bounded(runtime.survival.promise,12000,'starter admission');
  result.job=runtime.survival.state();result.afterJob=runtime.snapshot();
  assert.equal(result.job.status,'paused');assert.equal(result.job.history.at(-1)?.code,'MINING_DEADLINE_INSUFFICIENT');
  assert.equal(result.digs.length,0);assert.equal(result.digPackets.filter(p=>[0,1,2].includes(p.packet.status)).length,0);assert.equal(result.afterJob.terrainTrust.trusted,true);assert.equal(bot.blockAt(target).name,'oak_log');
  runtime.runner.timeoutMs=1000;
  try{await runtime.execute('dig_at',{x:2,y:64,z:0},undefined,{jobDeadline:performance.now()+30000});throw Error('short action unexpectedly mined');}
  catch(error){result.actionRefusal={message:error.message,code:error.code};assert.equal(error.code,'MINING_DEADLINE_INSUFFICIENT');}
  assert.equal(result.digs.length,0);assert.equal(result.digPackets.filter(p=>[0,1,2].includes(p.packet.status)).length,0);assert.equal(runtime.snapshot().terrainTrust.trusted,true);assert.equal(bot.blockAt(target).name,'oak_log');
  runtime.runner.timeoutMs=30000;
  result.admitted=await bounded(runtime.execute('dig_at',{x:2,y:64,z:0},undefined,{jobDeadline:performance.now()+30000}),30000,'admitted mining');
  assert.equal(result.admitted.mined,1);assert.equal(result.admitted.inventory_changes.oak_log,1);assert.equal(result.digs.length,1);assert.ok(result.digPackets.some(p=>p.packet.status===0));
  assert.equal(bot.blockAt(target).name,'air');assert.equal(runtime.snapshot().terrainTrust.trusted,true);assert.equal(runtime.connection,'connected');assert.equal(runtime.runner.active,null);
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
  console.log(result.passed ? 'PASS prepared mining deadline admission' : 'FAIL prepared mining deadline admission; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

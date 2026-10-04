// Console-prepared integration fixture, never called by the production controller.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Vec3 } from 'vec3';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `canopy-recovery-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-automatic-canopy-recovery', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Fresh isolated peaceful world with persistent leaves and disabled random ticks. Console supplies a two-leaf ledge, retained log anchor, lower stone walkway, roof, crafting table, six planks and four sticks. The normal starter controller chooses any recovery and crafts a wooden pickaxe. The harness then stops it and separately requests a certified return. This is not natural-world reliability, complete treetop escape or an autonomous finished starter kit.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-canopy-recovery.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-canopy-recovery.js', import.meta.url))).digest('hex');
await mkdir(directory, { recursive: true });
let output = '', runtime, child, log, sampleTimer, interrupted;
const interrupt = signal => { interrupted = Error(`Interrupted by ${signal}`); runtime?.stop(interrupted.message); };
const onInt = () => interrupt('SIGINT'), onTerm = () => interrupt('SIGTERM');
process.on('SIGINT', onInt); process.on('SIGTERM', onTerm);
async function bounded(promise, ms, label) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(`${label} timed out`)),ms)})]); }
  finally { clearTimeout(timer); }
}
function geometry() {
  return [[0,64,0],[0,65,0],[1,65,0],[1,64,0],[1,68,0]].map(([x,y,z])=>{
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
  await requireEula(SERVER_DIR, { interactive: false });
  const { java } = await setupServer({ log: console.log });
  const port = 25639, bedrockPort = 19149;
  if (await pingTcp('127.0.0.1', port)) throw Error('Canopy diagnostic port already occupied');
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
  await command([
    'difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','gamerule randomTickSpeed 0','time set day',
    'fill -10 50 -10 10 75 10 air',
    'setblock 0 64 0 oak_log',
    'setblock 0 65 0 oak_leaves[persistent=true,distance=1,waterlogged=false]',
    'setblock 1 65 0 oak_leaves[persistent=true,distance=2,waterlogged=false]',
    'fill 1 64 0 6 64 0 stone','setblock 1 68 0 stone',
    'setworldspawn 0 66 0','gamerule spawnRadius 0'
  ]);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotCanopy',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  await command(['tp BroBotCanopy 0.5 66 0.5','gamemode survival BroBotCanopy','clear BroBotCanopy','give BroBotCanopy crafting_table 1','give BroBotCanopy oak_planks 6','give BroBotCanopy stick 4']);
  await waitFor(() => runtime.bot.entity.onGround && Math.abs(runtime.bot.entity.position.y-66)<.03 && runtime.bot.inventory.items().some(i=>i.name==='stick'&&i.count===4), 5000, 'prepared grounded inventory');
  result.before = runtime.snapshot(); result.geometryBefore = geometry();
  assert.deepEqual(result.geometryBefore.map(b=>b.name),['oak_log','oak_leaves','oak_leaves','stone','stone']);
  let lastHealth=runtime.bot.health;
  runtime.bot.on('health',()=>{
    result.healthEvents.push({at:new Date().toISOString(),before:lastHealth,after:runtime.bot.health}); lastHealth=runtime.bot.health;
  });
  const execute=runtime.survival.execute;
  runtime.survival.execute=async(name,args,signal)=>{
    const record={name,args:structuredClone(args),before:runtime.snapshot(),geometryBefore:geometry(),started:new Date().toISOString()};
    result.actions.push(record);
    try { const value=await execute(name,args,signal);record.result=structuredClone(value);return value; }
    catch(error){record.error={message:error.message,code:error.code,workstation:error.workstation};throw error;}
    finally {record.after=runtime.snapshot();record.geometryAfter=geometry();record.onGround=runtime.bot.entity.onGround;record.finished=new Date().toISOString();}
  };
  sampleTimer = setInterval(() => {
    if (result.frames.length >= 500) return;
    const bot = runtime.bot, p = bot?.entity?.position;
    result.frames.push({at:new Date().toISOString(),position:p?{x:p.x,y:p.y,z:p.z}:null,onGround:bot?.entity?.onGround,health:bot?.health,action:runtime.runner.active?.name??null});
  }, 100);
  await runtime.command('survive starter');
  await waitFor(() => {
    const history = runtime.survival.job?.history ?? [];
    return history.some(e=>e.action==='craft'&&e.result?.item==='wooden_pickaxe'&&e.result.crafted>=1)
      && runtime.bot.inventory.items().some(i=>i.name==='wooden_pickaxe'&&i.count>=1);
  }, 45000, 'automatic canopy recovery and wooden pickaxe');
  runtime.stop('Prepared canopy fixture reached the wooden-pickaxe checkpoint');
  await waitFor(() => !runtime.survival.active && !runtime.runner.active, 5000, 'starter drain');
  result.history = structuredClone(runtime.survival.job.history);
  const descents = result.actions.filter(e=>e.name==='descend_notch');
  assert.equal(descents.length,1,'the controller must choose exactly one certified descent');
  const descent=descents[0], descentIndex=result.actions.indexOf(descent);
  const failures=result.actions.slice(0,descentIndex).filter(e=>e.name==='craft'&&e.error);
  assert.equal(failures.length,2);
  assert.ok(failures.every(e=>e.error.code==='WORKSTATION_EGRESS_UNVERIFIED'&&e.error.workstation==='crafting_table'));
  assert.equal(descent.result?.completed,true);assert.equal(descent.result?.descended_blocks,1);
  assert.equal(descent.onGround,true);
  assert.ok(Math.abs(descent.before.position.y-66)<.03&&Math.abs(descent.after.position.y-65)<.03);
  assert.equal(descent.geometryAfter[2].name,'air');
  assert.equal(descent.geometryAfter[1].name,'oak_leaves');
  assert.equal(descent.geometryAfter[0].name,'oak_log');
  assert.equal(runtime.bot.health,20);
  result.afterCraft = runtime.snapshot();
  result.explicitReturn = await runtime.execute('go_to',{x:0,y:66,z:0,radius:0,returnable:true});
  await waitFor(() => runtime.bot.entity.onGround && runtime.bot.entity.position.distanceTo({x:.5,y:66,z:.5})<.2, 5000, 'explicit grounded home return');
  result.final = runtime.snapshot();
  assert.equal(result.final.health,20);
  assert.ok(result.healthEvents.every(e=>e.after>=e.before),'no observed health loss allowed in prepared fixture');
  result.passed = true;

} catch (error) {
  result.error = error.stack ?? error.message;
  process.exitCode = 1;
  console.error('FAIL',error.message);
} finally {
  clearInterval(sampleTimer);
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
  console.log(result.passed ? 'PASS prepared automatic canopy step, craft and separate certified return' : 'FAIL prepared canopy recovery; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

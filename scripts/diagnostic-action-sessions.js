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
const directory = join(SERVER_DIR, 'smoke', `action-sessions-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-action-sessions', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared peaceful arenas in Overworld and Nether. Hold a placement aim across a real console-driven dimension transition and verify no placement packet in the replacement world. Hold the completion of a real walk across another transition and verify no false arrival. Console and promise-delay controls are test-only; not a natural survival benchmark.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-action-sessions.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-action-sessions.js', import.meta.url))).digest('hex');
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
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set midnight','fill -4 62 -4 4 63 4 stone','fill -4 64 -4 4 70 4 air','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  guardActions=createActions(runtime.bot,{memory:runtime.memory,log:runtime.log.bind(runtime)});
  const bot=runtime.bot,write=bot._client.write.bind(bot._client),lookAt=bot.lookAt;
  result.packets=[];bot._client.write=(name,packet)=>{if(name==='block_place')result.packets.push({at:new Date().toISOString(),dimension:bot.game.dimension,heldItem:bot.heldItem?.name??null,packet});return write(name,packet);};
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome','give BroBotHome oak_planks 8']);
  await waitFor(()=>bot.entity.onGround&&bot.inventory.items().some(i=>i.name==='oak_planks'),5000,'prepared inventory');
  result.normalPlacement=await bounded(runtime.execute('place',{block:'oak_planks',x:2,y:64,z:0}),10000,'ordinary placement');
  await waitFor(()=>bot.blockAt(new Vec3(2,64,0))?.name==='oak_planks',5000,'server placement');
  await command(['execute in minecraft:the_nether run forceload add -16 -16 15 15']);
  const marker=`NETHER_LOADED_${randomUUID()}`;
  const end=Date.now()+10000;
  while(!output.includes(marker)){
    assert.ok(Date.now()<end,'Nether chunks must load');
    await command([`execute in minecraft:the_nether if loaded -4 64 -4 if loaded 4 64 4 run say ${marker}`]);
    if(!output.includes(marker))await sleep(100);
  }
  await command(['execute in minecraft:the_nether run fill -4 62 -4 4 63 4 stone','execute in minecraft:the_nether run fill -4 64 -4 4 70 4 air']);
  async function transition(world){
    await command([`execute in minecraft:${world} run tp BroBotHome .5 64 .5`]);
    await waitFor(()=>String(bot.game.dimension).includes(world==='the_nether'?'nether':'overworld')&&runtime.connection==='connected',10000,'replacement spawn');
    await bounded(bot.waitForChunksToLoad(),10000,'replacement chunks');
    await waitFor(()=>bot.entity.onGround,5000,'replacement grounding');
  }
  let began,release;const aiming=new Promise(r=>{began=r});
  bot.lookAt=async(...args)=>{await lookAt.apply(bot,args);began();await new Promise(r=>{release=r});};
  const before=result.packets.length;
  const pending=runtime.execute('place',{block:'oak_planks',x:3,y:64,z:0}).then(value=>({value}),error=>({error:error.message}));
  try{
    await bounded(aiming,5000,'placement aim held');await transition('the_nether');
    assert.ok(runtime.runner.active,'old action must retain lock while draining');
    release();result.stalePlacement=await bounded(pending,5000,'old placement drain');
    assert.match(result.stalePlacement.error,/session changed/);assert.equal(result.packets.length,before);
    assert.equal(bot.blockAt(new Vec3(3,64,0))?.name,'air');
  }finally{release?.();bot.lookAt=lookAt;}
  await transition('overworld');
  await command(['setblock 2 64 0 air','setblock 3 64 0 air']);
  await waitFor(()=>bot.blockAt(new Vec3(2,64,0))?.name==='air',5000,'clear walking route');
  const goto=bot.pathfinder.goto;let arrived,resume;const held=new Promise(r=>{arrived=r});
  bot.pathfinder.goto=async(...args)=>{await goto.apply(bot.pathfinder,args);arrived();await new Promise(r=>{resume=r});};
  const walking=runtime.execute('go_to',{x:2,y:64,z:0,radius:1}).then(value=>({value}),error=>({error:error.message}));
  try{
    await bounded(held,10000,'walk completion held');result.walkedInOrigin=runtime.snapshot().position;
    await transition('the_nether');assert.ok(runtime.runner.active);resume();
    result.staleArrival=await bounded(walking,5000,'old walk drain');assert.match(result.staleArrival.error,/session changed/);
  }finally{resume?.();bot.pathfinder.goto=goto;}
  assert.equal(runtime.runner.active,null);assert.equal(bot.health,20);
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(name=>[name,bot.getControlState(name)]));
  assert.ok(Object.values(result.controls).every(value=>value===false));
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
  console.log(result.passed ? 'PASS prepared action session guards' : 'FAIL prepared action session guards; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

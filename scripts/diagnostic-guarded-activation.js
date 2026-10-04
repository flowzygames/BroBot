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
const directory = join(SERVER_DIR, 'smoke', `guarded-activation-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-guarded-activation', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared peaceful arena: verify a real lever toggle, cancellation during delayed aim without a later packet, empty-hand acknowledged sleep, and a real dimension transition during delayed sleep aim without interacting with a Nether bed. Console and aim-delay controls are test-only.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-guarded-activation.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-guarded-activation.js', import.meta.url))).digest('hex');
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
  const lever=new Vec3(2,64,0),foot=new Vec3(1,64,1),head=new Vec3(1,64,2);
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome','setblock 2 64 0 lever[face=floor,facing=north,powered=false]']);
  await waitFor(()=>bot.entity.onGround&&bot.blockAt(lever)?.name==='lever',5000,'prepared lever');
  result.toggle=await bounded(guardActions.execute('activate',{x:2,y:64,z:0}),10000,'guarded lever toggle');
  await waitFor(()=>bot.blockAt(lever)?.getProperties().powered===true,5000,'server lever acknowledgement');
  assert.equal(result.packets.length,1);
  await command(['setblock 2 64 0 lever[face=floor,facing=north,powered=false]']);
  await waitFor(()=>bot.blockAt(lever)?.getProperties().powered===false,5000,'reset lever');
  async function heldAim(operation,change){
    let began,release;const entered=new Promise(r=>{began=r});
    bot.lookAt=async(...args)=>{await lookAt.apply(bot,args);began();await new Promise(r=>{release=r});};
    const count=result.packets.length,pending=operation();const outcome=pending.then(value=>({value}),error=>({error:error.message,name:error.name}));
    try{await bounded(entered,5000,'held aim');await change();release();const end=await bounded(outcome,5000,'drained aim');assert.ok(end.error);assert.equal(result.packets.length,count);return end;}
    finally{release?.();bot.lookAt=lookAt;}
  }
  const controller=new AbortController();
  result.cancelled=await heldAim(()=>guardActions.execute('activate',{x:2,y:64,z:0},controller.signal),async()=>controller.abort());
  await sleep(250);assert.equal(bot.blockAt(lever).getProperties().powered,false);assert.equal(result.cancelled.name,'AbortError');
  await command(['setblock 1 64 1 red_bed[facing=south,part=foot,occupied=false]','setblock 1 64 2 red_bed[facing=south,part=head,occupied=false]','time set midnight','gamerule playersSleepingPercentage 101']);
  await waitFor(()=>bot.isABed(bot.blockAt(foot))&&bot.isABed(bot.blockAt(head))&&bot.time.timeOfDay>=12541,5000,'prepared bed');
  assert.equal(bot.heldItem,null);
  await command(['execute in minecraft:the_nether run forceload add -16 -16 15 15']);
  const loadedMarker=`NETHER_LOADED_${randomUUID()}`,loadEnd=Date.now()+10000;
  while(!output.includes(loadedMarker)){
    assert.ok(Date.now()<loadEnd,'prepared Nether chunks must load');
    await command([`execute in minecraft:the_nether if loaded -4 64 -4 if loaded 4 64 4 run say ${loadedMarker}`]);
    if(!output.includes(loadedMarker))await sleep(100);
  }
  await command(['tp BroBotHome .5 64 .5','time set midnight',
    'execute in minecraft:the_nether run fill -4 62 -4 4 63 4 stone','execute in minecraft:the_nether run fill -4 64 -4 4 70 4 air',
    'execute in minecraft:the_nether run setblock 1 64 1 red_bed[facing=south,part=foot,occupied=false]',
    'execute in minecraft:the_nether run setblock 1 64 2 red_bed[facing=south,part=head,occupied=false]']);
  const bedMarker=`NETHER_BED_${randomUUID()}`;
  await command([`execute in minecraft:the_nether if block 1 64 1 minecraft:red_bed if block 1 64 2 minecraft:red_bed run say ${bedMarker}`]);
  assert.ok(output.includes(bedMarker),'prepared Nether bed must be server-confirmed before the transition');
  await waitFor(()=>bot.entity.onGround&&!bot.isSleeping,5000,'second sleep start');
  result.dimensionRefusal=await heldAim(()=>guardActions.execute('sleep',{}),async()=>{
    await command(['execute in minecraft:the_nether run tp BroBotHome .5 64 .5']);
    await waitFor(()=>String(bot.game.dimension).includes('nether'),10000,'real dimension transition');
    await bounded(bot.waitForChunksToLoad(),10000,'Nether chunks');
  });
  assert.match(result.dimensionRefusal.error,/session changed/);
  assert.equal(bot.blockAt(foot)?.name,'red_bed');assert.equal(bot.blockAt(head)?.name,'red_bed');assert.equal(bot.health,20);
  result.netherBed={foot:bot.blockAt(foot).name,head:bot.blockAt(head).name,health:bot.health};
  await command(['execute in minecraft:overworld run tp BroBotHome .5 64 .5','time set midnight']);
  await waitFor(()=>['overworld','minecraft:overworld'].includes(bot.game.dimension),10000,'return to prepared Overworld');
  await bounded(bot.waitForChunksToLoad(),10000,'Overworld chunks');
  await waitFor(()=>bot.entity.onGround&&!bot.isSleeping&&bot.isABed(bot.blockAt(foot)),5000,'final sleep start');
  // Nether arena preparation can drop local plants, which may be picked up
  // during the transition. Clear supplied-test inventory again for this case.
  await command(['clear BroBotHome']);
  await waitFor(()=>bot.inventory.items().length===0&&bot.heldItem===null,5000,'final empty-hand sleep inventory');
  const beforeSleep=result.packets.length;
  result.sleep=await bounded(guardActions.execute('sleep',{}),10000,'guarded bed sleep');
  assert.equal(result.sleep.sleeping,true);assert.equal(bot.isSleeping,true);assert.equal(result.packets.length,beforeSleep+1);
  assert.equal(result.packets.at(-1).heldItem,null);
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
  console.log(result.passed ? 'PASS prepared guarded block activation' : 'FAIL prepared guarded block activation; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

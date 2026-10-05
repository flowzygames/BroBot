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
import { portalBlueprint } from '../src/progression.js';
import { loadConfig } from '../src/config.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `progression-activation-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-progression-activation', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared complete Nether frame and End frame ring. Hold real progression aiming, cancel ignition, and change dimension before eye insertion; verify no late packets. Then verify ordinary server-confirmed ignition and eye insertion with exact cursor geometry. Console preparation and promise holds are test-only.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-progression-activation.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-progression-activation.js', import.meta.url))).digest('hex');
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
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set midnight','fill -8 62 -8 12 63 12 stone','fill -8 64 -8 12 70 12 air','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  guardActions=createActions(runtime.bot,{memory:runtime.memory,log:runtime.log.bind(runtime)});
  const bot=runtime.bot,write=bot._client.write.bind(bot._client),lookAt=bot.lookAt;
  result.packets=[];bot._client.write=(name,packet)=>{if(name==='block_place')result.packets.push({at:new Date().toISOString(),dimension:bot.game.dimension,heldItem:bot.heldItem?.name??null,packet});return write(name,packet);};
  const blueprint=portalBlueprint(2,64,0,'x');
  const frames=[];
  for(let k=-1;k<=1;k++)for(const [x,z,facing] of [[k+8,6,'south'],[k+8,10,'north'],[6,k+8,'east'],[10,k+8,'west']])frames.push({x,y:64,z,facing});
  const missing=frames[0],eyePosition=new Vec3(missing.x,missing.y,missing.z);
  const frameCommands=frames.map((p,i)=>`setblock ${p.x} ${p.y} ${p.z} end_portal_frame[facing=${p.facing},eye=${i!==0}]`);
  const facingVectors={north:[0,-1],south:[0,1],west:[-1,0],east:[1,0]};
  const stands=frames.map(p=>{const [dx,dz]=facingVectors[p.facing];return `setblock ${p.x-dx} ${p.y} ${p.z-dz} stone`});
  await command(['tp BroBotHome 3.5 64 -1.5','gamemode survival BroBotHome','clear BroBotHome','give BroBotHome flint_and_steel 1','give BroBotHome ender_eye 1',...blueprint.frame.map(p=>`setblock ${p.x} ${p.y} ${p.z} obsidian`),...frameCommands,...stands]);
  await waitFor(()=>bot.entity.onGround&&bot.inventory.items().some(i=>i.name==='ender_eye'),5000,'prepared items');
  async function heldAim(operation,change){
    let began,release;const entered=new Promise(r=>{began=r});
    bot.lookAt=async(...args)=>{await lookAt.apply(bot,args);began();await new Promise(r=>{release=r});};
    const count=result.packets.length,pending=operation();const outcome=pending.then(value=>({value}),error=>({error:error.message}));
    try{await bounded(Promise.race([entered,outcome.then(v=>{throw Error('Action ended before aim: '+JSON.stringify(v))})]),10000,'held progression aim');await change();release();const end=await bounded(outcome,5000,'drained progression aim');assert.ok(end.error);assert.equal(result.packets.length,count);return end;}
    finally{release?.();bot.lookAt=lookAt;}
  }
  result.stoppedIgnition=await heldAim(()=>runtime.execute('build_nether_portal',{x:2,y:64,z:0,axis:'x'}),async()=>runtime.stop('Prepared ignition Stop'));
  assert.match(result.stoppedIgnition.error,/Stop/);
  assert.ok(blueprint.interior.every(p=>bot.blockAt(new Vec3(p.x,p.y,p.z))?.name==='air'));
  await command(['execute in minecraft:the_nether run forceload add -16 -16 15 15']);
  const loaded=`NETHER_LOADED_${randomUUID()}`,deadline=Date.now()+10000;
  while(!output.includes(loaded)){
    assert.ok(Date.now()<deadline,'Nether arena chunks load');
    await command([`execute in minecraft:the_nether if loaded -8 64 -8 if loaded 12 64 12 run say ${loaded}`]);
    if(!output.includes(loaded))await sleep(100);
  }
  await command(['execute in minecraft:the_nether run fill -8 62 -8 12 63 12 stone','execute in minecraft:the_nether run fill -8 64 -8 12 70 12 air',...[...frameCommands,...stands].map(c=>'execute in minecraft:the_nether run '+c)]);
  await command(['tp BroBotHome 7.5 65 4.5']);
  await waitFor(()=>bot.entity.onGround&&bot.blockAt(eyePosition)?.name==='end_portal_frame',5000,'End frame approach');
  result.staleEye=await heldAim(()=>runtime.execute('activate_end_portal',{radius:16}),async()=>{
    await command(['execute in minecraft:the_nether run tp BroBotHome 7.5 64 4.5']);
    await waitFor(()=>String(bot.game.dimension).includes('nether')&&runtime.connection==='connected',10000,'Nether replacement spawn');
    await bounded(bot.waitForChunksToLoad(),10000,'Nether chunks');
  });
  assert.match(result.staleEye.error,/session changed/);
  assert.equal(bot.blockAt(eyePosition)?.getProperties().eye,false);
  await command(['execute in minecraft:overworld run tp BroBotHome 3.5 64 -1.5']);
  await waitFor(()=>String(bot.game.dimension).includes('overworld')&&runtime.connection==='connected',10000,'return Overworld');
  await bounded(bot.waitForChunksToLoad(),10000,'Overworld chunks');await waitFor(()=>bot.entity.onGround,5000,'grounded ignition');
  result.ignition=await bounded(runtime.execute('build_nether_portal',{x:2,y:64,z:0,axis:'x'}),15000,'normal guarded ignition');
  assert.equal(result.ignition.active,true);assert.equal(result.packets.length,1);assert.equal(result.packets[0].heldItem,'flint_and_steel');assert.equal(result.packets[0].packet.cursorY,1);
  await command(['tp BroBotHome 7.5 65 4.5']);await waitFor(()=>bot.entity.onGround,5000,'grounded eye insertion');
  result.eye=await bounded(runtime.execute('activate_end_portal',{radius:16}),15000,'normal guarded eye insertion');
  assert.equal(result.eye.active,true);assert.equal(result.packets.length,2);assert.equal(result.packets[1].heldItem,'ender_eye');assert.equal(result.packets[1].packet.cursorY,.8125);
  assert.ok(result.packets.every(p=>String(p.dimension).includes('overworld')));assert.equal(bot.health,20);assert.equal(runtime.runner.active,null);
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(name=>[name,bot.getControlState(name)]));assert.ok(Object.values(result.controls).every(v=>v===false));
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
  console.log(result.passed ? 'PASS prepared guarded progression activation' : 'FAIL prepared guarded progression activation; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

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
const attackerName=process.env.BROBOT_RETREAT_FIXTURE_MOB??'zombie';
assert.ok(['zombie','husk','zombie_villager'].includes(attackerName),'unsupported prepared attacker');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `hostile-retreat-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-bounded-hostile-retreat', attackerName, started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared flat dry arena at night with distant logs and one ordinary zombie-family melee attacker. An actual starter job receives real melee; the bounded recovery must drain gathering, observe supported ground, certify one local route, move and pause with observed separation. The attacker remains active until recovery terminates. No fake damage, teleport recovery or altered mob speed. This is not ongoing defense or natural-world completion.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-hostile-retreat.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-hostile-retreat.js', import.meta.url))).digest('hex');
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
  // Normal smoke disables monsters at the server level, including this probe.
  // Permit the explicitly summoned zombie; natural spawning remains disabled
  // by gamerule before the player connects.
  const properties=join(directory,'server.properties');
  await writeFile(properties,(await readFile(properties,'utf8')).replace(/^spawn-monsters=false$/m,'spawn-monsters=true'));
  assert.match(await readFile(properties,'utf8'),/^spawn-monsters=true$/m);
  log = createWriteStream(join(directory,'server.log'));
  child = await spawnServer({ directory, java: java.path, pipe: true });
  for (const stream of [child.stdout,child.stderr]) stream.on('data', chunk => {
    output = (output + chunk.toString()).slice(-200000); log.write(chunk);
  });
  await waitFor(() => output.includes('Done ('), 300000, 'server startup');
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set midnight','fill -25 62 -25 25 63 25 stone','fill -25 64 -25 25 71 25 air','fill -25 72 -25 25 79 25 air','fill -25 80 -25 25 87 25 air','fill 22 64 0 22 69 0 oak_log','setworldspawn 0 64 0','gamerule spawnRadius 0','difficulty normal']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome']);
  await waitFor(()=>runtime.bot.entity.onGround && runtime.bot.entity.position.distanceTo(new Vec3(.5,64,.5))<.1,5000,'grounded start');
  result.hurts=[];result.digs=[];result.attacks=[];result.executions=[];result.chunkEvents=[];
  const bot=runtime.bot,dig=bot.dig.bind(bot),attack=bot.attack.bind(bot);
  for(const event of ['chunkColumnLoad','chunkColumnUnload'])bot.on(event,position=>result.chunkEvents.push({event,at:new Date().toISOString(),position,action:runtime.runner.active?.name??null}));
  const controls=()=>Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(name=>[name,bot.getControlState(name)]));
  bot.dig=(block,...args)=>{result.digs.push({at:new Date().toISOString(),name:block.name,position:{x:block.position.x,y:block.position.y,z:block.position.z}});return dig(block,...args);};
  bot.attack=(entity,...args)=>{result.attacks.push({at:new Date().toISOString(),id:entity.id});return attack(entity,...args);};
  let previousHealth=bot.health;
  bot.on('health',()=>{result.healthEvents.push({at:new Date().toISOString(),before:previousHealth,after:bot.health});previousHealth=bot.health;});
  bot.prependListener('entityHurt',(entity,source)=>{
    if(entity?.id!==bot.entity.id)return;
    const active=runtime.runner.active;
    result.hurts.push({at:new Date().toISOString(),source:source?{id:source.id,name:source.name,type:source.type}:null,active:active?.name??null,aborted:active?.controller.signal.aborted??null,digsSoFar:result.digs.length,position:{x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z},healthObserved:bot.health});
  });
  const run=runtime.runner.run.bind(runtime.runner);
  runtime.runner.run=async(name,...args)=>{
    const entry={name,started:new Date().toISOString(),previousActive:runtime.runner.active?.name??null};result.executions.push(entry);
    try{entry.result=await run(name,...args);return entry.result;}catch(error){entry.error=error.message;throw error;}finally{entry.finished=new Date().toISOString();}
  };
  sampleTimer=setInterval(()=>{
    const source=Object.values(bot.entities).find(e=>e.name===attackerName);
    result.frames.push({at:new Date().toISOString(),position:{x:bot.entity.position.x,y:bot.entity.position.y,z:bot.entity.position.z},onGround:bot.entity.onGround,health:bot.health,action:runtime.runner.active?.name??null,controls:controls(),zombie:source?{id:source.id,x:source.position.x,y:source.position.y,z:source.position.z}:null});
  },50);
  assert.equal(Object.values(bot.entities).filter(e=>e.name===attackerName).length,0,'no preexisting zombie');
  await command([`summon ${attackerName} 12.5 64 .5 {Tags:["brobot_hit_probe"],PersistenceRequired:1b,Silent:1b,IsBaby:0b}`]);
  await waitFor(()=>Object.values(bot.entities).some(e=>e.name===attackerName),5000,'prepared zombie observed');
  result.before=runtime.snapshot();result.start=await runtime.command('survive starter');
  await waitFor(()=>result.hurts.some(h=>h.source?.type==='hostile'),10000,'actual melee');
  const hit=result.hurts.find(h=>h.source?.type==='hostile');
  assert.equal(hit.active,'collect');assert.equal(hit.digsSoFar,0,'pre-dig recovery fixture');
  await bounded(runtime.survival.promise,12000,'bounded recovery termination');
  result.beforeAttackerRemoval=runtime.snapshot();result.finalJob=runtime.survival.state();result.finalControls=controls();
  result.attackerBeforeRemoval=bot.entities[hit.source.id]?{id:hit.source.id,position:{x:bot.entities[hit.source.id].position.x,y:bot.entities[hit.source.id].position.y,z:bot.entities[hit.source.id].position.z}}:null;
  result.zombieRemovalAfterRecovery=new Date().toISOString();await command(['kill @e[tag=brobot_hit_probe]']);
  assert.equal(result.finalJob.status,'paused');
  const recovery=result.finalJob.hostileRecovery?.result;
  assert.equal(recovery?.separated,true,'recovery must genuinely verify final separation');
  assert.ok(result.attackerBeforeRemoval,'attacker remained present throughout recovery');
  assert.equal(recovery.sourceId,hit.source.id);assert.ok(recovery.observedSeparation>=4);
  assert.equal(result.digs.length,0);assert.equal(result.attacks.length,0);
  const retreat=result.executions.filter(e=>e.name==='starter_retreat');assert.equal(retreat.length,1);assert.equal(retreat[0].previousActive,null);
  assert.ok(result.frames.some(f=>f.action==='starter_retreat'&&Object.values(f.controls).some(v=>v)),'actual movement controls required');
  assert.ok(Object.values(result.finalControls).every(v=>v===false));assert.equal(bot.pathfinder.goal,null);assert.equal(runtime.runner.active,null);
  assert.equal(runtime.bot,bot);assert.equal(runtime.connection,'connected');
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
  console.log(result.passed ? 'PASS prepared bounded real-melee retreat' : 'FAIL prepared bounded real-melee retreat; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

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
const directory = join(SERVER_DIR, 'smoke', `sprint-protocol-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-sprint-protocol', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared peaceful flat lane. Actual Runtime go_to must produce server-confirmed sprinting and explicit Stop must produce server-confirmed not-sprinting. Server-side entity predicates are the primary state evidence; this is not a speed benchmark.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-sprint-protocol.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-sprint-protocol.js', import.meta.url))).digest('hex');
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
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set day','fill -4 62 -4 55 63 4 stone','fill -4 64 -4 55 70 4 air','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const bot=runtime.bot,write=bot._client.write.bind(bot._client);result.commands=[];result.packets=[];
  bot._client.write=(name,packet)=>{if(name==='entity_action')result.packets.push({at:new Date().toISOString(),packet});return write(name,packet);};
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','effect give BroBotHome minecraft:saturation 1 10 true']);
  await waitFor(()=>bot.entity.onGround&&bot.food===20,5000,'grounded full-food player');
  async function requireSprintFlag(value){
    const marker=`SPRINT_${value}_${randomUUID()}`,end=Date.now()+5000;
    const line=`execute as BroBotHome if predicate {condition:"minecraft:entity_properties",entity:"this",predicate:{flags:{is_sprinting:${value}}}} run say ${marker}`;
    const observed=()=>output.split('\n').find(value=>value.trimEnd().endsWith(`[BroBotHome] ${marker}`));
    while(!observed()){
      assert.ok(Date.now()<end,`server sprint flag ${value} not confirmed`);
      const start=output.length;await command([line]);
      const reply=output.slice(start);result.commands.push({at:new Date().toISOString(),line,reply});
      assert.ok(!/Incorrect argument|Unknown or incomplete|Expected .* at position/.test(reply),'invalid predicate syntax');
      if(!observed())await sleep(100);
    }
    return{value,marker,serverSayLine:observed(),at:new Date().toISOString()};
  }
  result.before=runtime.snapshot();result.feature=bot.supportFeature('entityActionUsesStringMapper');
  result.initialFlag=await requireSprintFlag(false);
  let walk=runtime.execute('go_to',{x:48,y:64,z:0,radius:0});const outcome=walk.then(value=>({value}),error=>({error:error.message}));
  await waitFor(()=>bot.getControlState('sprint')===true,10000,'native pathfinder sprint control');
  result.movingFlag=await requireSprintFlag(true);result.during=runtime.snapshot();
  runtime.stop('Prepared explicit Stop');result.stopped=await bounded(outcome,10000,'movement drain');
  assert.match(result.stopped.error,/Prepared explicit Stop/);
  result.finalFlag=await requireSprintFlag(false);
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(n=>[n,bot.getControlState(n)]));
  assert.ok(Object.values(result.controls).every(v=>v===false));assert.equal(runtime.runner.active,null);
  assert.ok(result.packets.some(p=>p.packet.actionId==='start_sprinting'));assert.ok(result.packets.some(p=>p.packet.actionId==='stop_sprinting'));
  assert.ok(bot.entity.position.distanceTo(new Vec3(.5,64,.5))>0);assert.equal(bot.health,20);assert.equal(runtime.connection,'connected');
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
  console.log(result.passed ? 'PASS prepared server sprint-state protocol' : 'FAIL prepared server sprint-state protocol; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

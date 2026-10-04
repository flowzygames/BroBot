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
const directory = join(SERVER_DIR, 'smoke', `pickup-probes-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-duplicate-pickup-probes', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared peaceful stone enclosure with one item and two standing cells disconnected from the bot. Real reverse-route planning must reject each distinct cell only once while inputs remain unchanged. No movement, collection or terrain editing is expected; this is an efficiency control, not a successful gathering task.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-pickup-probes.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-pickup-probes.js', import.meta.url))).digest('hex');
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
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set day','fill -4 62 -4 8 63 4 stone','fill -4 64 -4 8 70 4 air','fill 2 63 -1 5 66 1 stone','fill 3 64 0 4 65 0 air','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome','summon item 3.5 64 .5 {Item:{id:"minecraft:oak_log",count:1},PickupDelay:0}']);
  const bot=runtime.bot,home=new Vec3(.5,64,.5);
  await waitFor(()=>bot.entity.onGround && bot.entity.position.distanceTo(home)<.1 && Object.values(bot.entities).some(e=>e.name==='item'),5000,'prepared item');
  await sleep(1500);
  const item=Object.values(bot.entities).find(e=>e.name==='item');result.target={id:item.id,position:{x:item.position.x,y:item.position.y,z:item.position.z}};
  result.probes=[];result.digs=[];
  const plan=bot.pathfinder.getPathFromTo.bind(bot.pathfinder),dig=bot.dig.bind(bot);
  bot.pathfinder.getPathFromTo=function * (movement,start,goal,options){result.probes.push({start:{x:start.x,y:start.y,z:start.z},at:new Date().toISOString()});yield * plan(movement,start,goal,options);};
  bot.dig=(block,...args)=>{result.digs.push(block.name);return dig(block,...args);};
  guardActions=createActions(bot,{memory:runtime.memory,log:runtime.log.bind(runtime),movementBoundary:()=>({center:home,radius:256})});
  result.before=runtime.snapshot();
  result.pickup=await bounded(guardActions.execute('pickup',{radius:8,entity_ids:[item.id]},undefined,{starterScope:'prepared-negative-probes'}),15000,'bounded unreachable pickup');
  result.final=runtime.snapshot();
  assert.deepEqual(result.probes.map(p=>p.start),[{x:3,y:64,z:0},{x:4,y:64,z:0}]);
  assert.equal(result.pickup.unreachable.length,2,'no synthetic third failure');
  assert.equal(result.pickup.remaining_drops[0].id,item.id);
  assert.ok(bot.entity.position.distanceTo(home)<.1);assert.equal(bot.entity.onGround,true);
  assert.equal(result.digs.length,0);assert.equal(bot.inventory.items().length,0);
  result.passed=true;

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
  console.log(result.passed ? 'PASS prepared distinct pickup route probes' : 'FAIL prepared distinct pickup route probes; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

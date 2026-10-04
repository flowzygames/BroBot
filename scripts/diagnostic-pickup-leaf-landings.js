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
const directory = join(SERVER_DIR, 'smoke', `pickup-leaf-landings-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-starter-pickup-leaf-landings', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Console-prepared peaceful world, disabled random ticks, stone approach and one leaf destination. Compare actual scoped pickup on detached versus anchored leaves. Records selected goals, inventory gain and final support. This is a controlled landing check, not autonomous exploration or route-wide leaf safety.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-pickup-leaf-landings.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-pickup-leaf-landings.js', import.meta.url))).digest('hex');
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
  await command([
    'difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','gamerule randomTickSpeed 0','time set day',
    'fill -8 50 -8 8 75 8 air','fill -5 61 -5 7 61 5 stone',
    'setblock 0 63 0 stone','setblock 1 63 0 stone',
    'setblock 2 63 0 oak_leaves[persistent=false,distance=7,waterlogged=false]',
    'setworldspawn 0 64 0','gamerule spawnRadius 0'
  ]);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const home=new Vec3(.5,64,.5), support=new Vec3(2,63,0);
  let lastHealth=runtime.bot.health;
  runtime.bot.on('health',()=>{result.healthEvents.push({at:new Date().toISOString(),before:lastHealth,after:runtime.bot.health});lastHealth=runtime.bot.health;});
  guardActions=createActions(runtime.bot,{memory:runtime.memory,log:runtime.log.bind(runtime),movementBoundary:()=>({center:home,radius:256})});
  const selected=[];
  const setGoal=runtime.bot.pathfinder.setGoal.bind(runtime.bot.pathfinder);
  runtime.bot.pathfinder.setGoal=(goal,...args)=>{if(goal)selected.push({x:goal.x,y:goal.y,z:goal.z,at:new Date().toISOString()});return setGoal(goal,...args);};
  for(const anchored of [false,true]){
    await command(['kill @e[type=item]','tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome',`setblock 2 62 0 ${anchored?'oak_log':'air'}`]);
    await waitFor(()=>runtime.bot.entity.onGround && runtime.bot.entity.position.distanceTo(home)<.1 && !runtime.bot.inventory.items().length && Boolean(retainedLeafAnchor(p=>runtime.bot.blockAt(p),support))===anchored,5000,'fixture reset');
    await command(['summon item 2.5 64.1 .5 {Item:{id:"minecraft:oak_log",count:1},PickupDelay:0}']);
    await waitFor(()=>Object.values(runtime.bot.entities).some(e=>e.name==='item'),5000,'item observed');
    const ids=Object.values(runtime.bot.entities).filter(e=>e.name==='item').map(e=>e.id),start=selected.length;
    const entry={anchored,ids,before:runtime.snapshot(),geometryBefore:geometry(),destinationAnchor:retainedLeafAnchor(p=>runtime.bot.blockAt(p),support),started:new Date().toISOString()};result.actions.push(entry);
    entry.result=await bounded(guardActions.execute('pickup',{radius:8,entity_ids:ids},undefined,{starterScope:`prepared-leaf-${anchored}`}),15000,'scoped pickup');
    entry.selectedGoals=selected.slice(start);entry.after=runtime.snapshot();entry.geometryAfter=geometry();entry.finished=new Date().toISOString();
    const position=runtime.bot.entity.position;
    entry.finalLanding={position:{x:position.x,y:position.y,z:position.z},onGround:runtime.bot.entity.onGround,support:runtime.bot.blockAt(position.offset(0,-.001,0).floored())?.name,anchored:hasAnchoredLeafLanding(runtime.bot,position)};
    assert.ok(entry.selectedGoals.length>0,'actual navigation must be exercised');
    if(!anchored)assert.ok(entry.selectedGoals.every(g=>g.x!==2 || g.y!==64 || g.z!==0),'detached leaf must never be selected');
    else assert.ok(entry.selectedGoals.some(g=>g.x===2 && g.y===64 && g.z===0),'anchored leaf should be selected');
    assert.equal(entry.result.inventory_changes.oak_log,1,'actual item gain required');
    assert.equal(entry.result.landing_verified,true);
    assert.equal(entry.finalLanding.onGround,true);
    assert.equal(entry.finalLanding.anchored,true);
    if(anchored)assert.equal(entry.finalLanding.support,'oak_leaves','positive control must physically land on leaf');
    assert.equal(runtime.bot.health,20);
  }
  assert.ok(result.healthEvents.every(e=>e.after>=e.before),'no observed health loss');
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
  console.log(result.passed ? 'PASS prepared pickup leaf landing controls' : 'FAIL prepared pickup leaf landing controls; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

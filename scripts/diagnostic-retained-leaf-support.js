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
import { assertStarterLeafSupport } from '../src/starter-leaf-support.js';
import { retainedLeafAnchor } from '../src/construction-guards.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `retained-leaf-support-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-starter-retained-leaf-support', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Fresh isolated peaceful world with console-prepared leaf supports, log anchors, stone footing, supplied wooden axe and disabled random ticks. The retained waypoint height includes 0.02-block arrival jitter; saved home is a separate stone position. The harness supplies starter scope, home boundary and a retained actual waypoint position. It verifies waypoint guard refusal, permitted removal with an alternate anchor, refusal of the last anchor, a separately requested return and a direct current-footprint guard check using real loaded terrain. It does not run the autonomous starter controller or measure leaf decay timing.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-retained-leaf-support.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-retained-leaf-support.js', import.meta.url))).digest('hex');
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
    'fill -8 50 -8 8 75 8 air','fill -5 62 -5 7 63 5 stone',
    'setblock 0 63 0 oak_leaves[persistent=false,distance=2,waterlogged=false]',
    'setblock 1 63 0 oak_leaves[persistent=false,distance=1,waterlogged=false]',
    'setblock 1 63 1 oak_leaves[persistent=false,distance=2,waterlogged=false]',
    'setblock 2 63 0 oak_log','setworldspawn 3 64 0','gamerule spawnRadius 0'
  ]);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  await command(['tp BroBotHome 3.5 64 0.5','gamemode survival BroBotHome','clear BroBotHome','give BroBotHome wooden_axe 1']);
  await waitFor(() => runtime.bot.entity.onGround && Math.abs(runtime.bot.entity.position.y-64)<.03 && runtime.bot.inventory.items().some(i=>i.name==='wooden_axe'), 5000, 'prepared grounded inventory');
  const home=new Vec3(.5,64.02,.5), savedHome=new Vec3(6.5,64,.5), support=new Vec3(0,63,0), scope={starterScope:'prepared-home-anchor'};
  guardActions=createActions(runtime.bot,{memory:runtime.memory,log:runtime.log.bind(runtime),movementBoundary:()=>({center:savedHome,radius:256}),starterProtectedPositions:()=>[home]});
  result.before=runtime.snapshot();result.geometryBefore=geometry();
  assert.deepEqual(result.geometryBefore.map(b=>b.name),['oak_leaves','oak_leaves','oak_leaves','oak_log','stone','stone']);
  result.initialAnchor=retainedLeafAnchor(p=>runtime.bot.blockAt(p),support);
  assert.deepEqual(result.initialAnchor.anchor,[2,63,0]);
  let lastHealth=runtime.bot.health;result.digCalls=[];
  runtime.bot.on('health',()=>{result.healthEvents.push({at:new Date().toISOString(),before:lastHealth,after:runtime.bot.health});lastHealth=runtime.bot.health;});
  const dig=runtime.bot.dig.bind(runtime.bot);
  runtime.bot.dig=(block,...args)=>{result.digCalls.push({position:{x:block.position.x,y:block.position.y,z:block.position.z},name:block.name,at:new Date().toISOString()});return dig(block,...args);};
  async function attempt(name,args,expectRefusal=false) {
    const entry={name,args,before:runtime.snapshot(),geometryBefore:geometry(),started:new Date().toISOString()};result.actions.push(entry);
    try {
      entry.result=await bounded(guardActions.execute(name,args,undefined,scope),15000,'scoped action');
      if(expectRefusal)throw Error('Expected home-anchor refusal did not occur');
    } catch(error) {
      entry.error=error.message;
      if(!expectRefusal || !/retained leaf anchor beneath protected starter support/.test(error.message))throw error;
    } finally {entry.after=runtime.snapshot();entry.geometryAfter=geometry();entry.finished=new Date().toISOString();}
    return entry;
  }
  await attempt('collect',{block:'oak_log',count:1,radius:4},true);
  assert.equal(result.digCalls.length,0);assert.equal(runtime.bot.blockAt(new Vec3(2,63,0)).name,'oak_log');
  await command(['setblock 2 63 1 oak_log']);
  await waitFor(()=>runtime.bot.blockAt(new Vec3(2,63,1))?.name==='oak_log',5000,'alternate anchor observation');
  const allowed=await attempt('dig_at',{x:2,y:63,z:0});
  assert.equal(allowed.result.mined,1);assert.equal(result.digCalls.length,1);
  assert.equal(runtime.bot.blockAt(new Vec3(2,63,0)).name,'air');
  result.retainedAnchor=retainedLeafAnchor(p=>runtime.bot.blockAt(p),support);
  assert.deepEqual(result.retainedAnchor.anchor,[2,63,1]);
  // Pickup may move onto a neighboring support. Restore a separately verified
  // stone stance so the next refusal tests home anchoring, not current footing.
  result.explicitStoneReposition=await bounded(guardActions.execute('go_to',{x:3,y:64,z:0,radius:0,returnable:true}),15000,'separate stone reposition');
  await waitFor(()=>runtime.bot.entity.onGround && runtime.bot.entity.position.distanceTo(new Vec3(3.5,64,.5))<.2,5000,'grounded stone stance');
  await attempt('dig_at',{x:2,y:63,z:1},true);
  assert.equal(result.digCalls.length,1);assert.equal(runtime.bot.blockAt(new Vec3(2,63,1)).name,'oak_log');
  result.explicitReturn=await bounded(guardActions.execute('go_to',{x:0,y:64,z:0,radius:0,returnable:true}),15000,'separate home return');
  await waitFor(()=>runtime.bot.entity.onGround && runtime.bot.entity.position.distanceTo(home)<.2,5000,'grounded home arrival');
  assert.throws(()=>assertStarterLeafSupport(runtime.bot,runtime.bot.blockAt(new Vec3(2,63,1)),{home:savedHome,positions:[]}),{code:'STARTER_SUPPORT_PROTECTED'});
  result.currentFootprintGuardVerified=true;
  result.final=runtime.snapshot();result.geometryFinal=geometry();
  assert.equal(result.final.health,20);assert.ok(result.healthEvents.every(e=>e.after>=e.before));
  assert.equal(runtime.bot.blockAt(support).name,'oak_leaves');
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
  console.log(result.passed ? 'PASS prepared retained-waypoint anchor protection and separate return' : 'FAIL prepared retained-leaf support guard; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

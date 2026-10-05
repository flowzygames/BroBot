// Console-prepared integration fixture, never called by the production controller.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile, readFile, readdir, cp, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Vec3 } from 'vec3';
import { execFileSync } from 'node:child_process';
import pathfinderPackage from 'mineflayer-pathfinder';
import { createActions, StarterScoutGoal } from '../src/actions.js';
import { hasAnchoredLeafLanding } from '../src/starter-leaf-support.js';
import { retainedLeafAnchor } from '../src/construction-guards.js';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fixture=JSON.parse(await readFile(new URL('../test/fixtures/scout-924-landing.json',import.meta.url),'utf8'));
const sourceDirectory=join(SERVER_DIR,'benchmarks',fixture.provenance.benchmarkRun);
const originalFiles=[...fixture.provenance.regions,fixture.provenance.playerData];
const verifyOriginal=async()=>{for(const f of originalFiles)assert.equal(createHash('sha256').update(await readFile(join(sourceDirectory,f.file))).digest('hex'),f.sha256,`Original snapshot changed: ${f.file}`);};
const directory = join(SERVER_DIR, 'smoke', `scout-landing-replay-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-scout-landing-replay', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Copy of a completed natural-world snapshot, with exact saved starting pose and random ticks frozen. Compare exact-column preflight with the new starter landing region, execute one scout and return to its origin. No terrain is prepared or edited. Not a fresh natural-world completion benchmark.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-scout-landing-replay.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-scout-landing-replay.js', import.meta.url))).digest('hex');
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
  await verifyOriginal();
  for(const world of ['world','world_nether','world_the_end']){try{await stat(join(sourceDirectory,world));}catch(error){if(error.code==='ENOENT')continue;throw error;}await cp(join(sourceDirectory,world),join(directory,world),{recursive:true,force:false,errorOnExist:true});}
  result.originalSnapshot=fixture.provenance;
  await writeServerConfig(directory,{port,bedrockPort,smoke:false});
  log = createWriteStream(join(directory,'server.log'));
  child = await spawnServer({ directory, java: java.path, pipe: true });
  for (const stream of [child.stdout,child.stderr]) stream.on('data', chunk => {
    output = (output + chunk.toString()).slice(-200000); log.write(chunk);
  });
  await waitFor(() => output.includes('Done ('), 300000, 'server startup');
  await command(['gamerule doMobSpawning false','gamerule randomTickSpeed 0','gamerule doDaylightCycle false']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotBench',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const bot=runtime.bot,origin=new Vec3(...fixture.origin),home=new Vec3(...fixture.home),endpoint=new Vec3(...fixture.expected.nearEndpoint);
  await command([`tp BroBotBench ${origin.x} ${origin.y} ${origin.z}`]);
  await bounded(bot.waitForChunksToLoad(),15000,'replay chunks');
  await waitFor(()=>bot.entity.onGround&&bot.entity.position.distanceTo(origin)<.05,5000,'exact recorded standing pose');
  result.fixtureDifferences=[];
  for(const [x,y,z,state] of fixture.cells){const block=bot.blockAt(new Vec3(x,y,z));if(!block||block.stateId!==state)result.fixtureDifferences.push({x,y,z,expected:state,actual:block?.stateId??null});}
  assert.equal(result.fixtureDifferences.length,0,'copied geometry must match the sparse recorded fixture');
  guardActions=createActions(bot,{movementBoundary:()=>({center:home,radius:256})});
  result.digs=[];result.placements=[];
  const dig=bot.dig.bind(bot),place=bot._placeBlockWithOptions.bind(bot);
  bot.dig=(block,...args)=>{result.digs.push({name:block.name,position:block.position});return dig(block,...args);};
  bot._placeBlockWithOptions=(...args)=>{result.placements.push({at:new Date().toISOString()});return place(...args);};
  result.before=runtime.snapshot();
  const native=bot.pathfinder.getPathFromTo;
  // Test-only emulation of the previous exact-column goal; movement settings,
  // world observations, candidate count and planning budgets remain identical.
  bot.pathfinder.getPathFromTo=function*(moves,start,goal,options){yield* native.call(this,moves,start,goal instanceof StarterScoutGoal?new pathfinderPackage.goals.GoalXZ(goal.x,goal.z):goal,options);};
  try{await guardActions.execute('explore',{direction:'east',distance:8,returnable:true},undefined,{starterScope:'replay/exact'});throw Error('Exact-column comparison unexpectedly succeeded');}
  catch(error){result.exact={error:error.message,result:error.result};assert.match(error.message,/noPath/);}
  finally{bot.pathfinder.getPathFromTo=native;}
  assert.ok(bot.entity.position.distanceTo(origin)<.1,'failed exact preflight must not move');
  result.scout=await bounded(guardActions.execute('explore',{direction:'east',distance:8,returnable:true},undefined,{starterScope:'replay/near'}),15000,'bounded nearby landing');
  await waitFor(()=>bot.entity.onGround&&bot.entity.position.floored().equals(endpoint),2000,'grounded certified endpoint');
  assert.equal(result.scout.explored,true);assert.ok(result.scout.distance>=6);assert.ok(bot.entity.position.distanceTo(home)<=256);
  assert.ok(hasAnchoredLeafLanding(bot,bot.entity.position));result.afterScout=runtime.snapshot();
  result.returned=await bounded(guardActions.execute('go_to',{x:Math.floor(origin.x),y:Math.floor(origin.y),z:Math.floor(origin.z),radius:1,returnable:true},undefined,{starterScope:'replay/return'}),15000,'return to recorded origin');
  await waitFor(()=>bot.entity.onGround,2000,'grounded return');assert.ok(bot.entity.position.distanceTo(origin)<=2.2);
  assert.equal(result.digs.length,0);assert.equal(result.placements.length,0);assert.equal(bot.health,20);
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(n=>[n,bot.getControlState(n)]));assert.ok(Object.values(result.controls).every(v=>v===false));
  assert.deepEqual(runtime.snapshot().inventory,result.before.inventory);await verifyOriginal();result.originalUnchanged=true;
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
  try{await verifyOriginal();result.originalUnchanged=true;}catch(error){result.passed=false;process.exitCode=1;result.cleanupErrors.push(error.message);}
  result.finished = new Date().toISOString();
  await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log(result.passed ? 'PASS copied-world scout landing replay' : 'FAIL copied-world scout landing replay; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

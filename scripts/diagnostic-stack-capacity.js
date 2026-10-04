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
const directory = join(SERVER_DIR, 'smoke', `stack-capacity-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-stack-capacity', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Prepared peaceful server with custom-capacity cobblestone stacks and an existing cursor. Exercise full16, partial16 and increased99 capacities with real inventory clicks before crafting ordinary planks. Supplied materials; not autonomous gathering.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-stack-capacity.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-stack-capacity.js', import.meta.url))).digest('hex');
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
  await command(['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set day','fill -4 62 -4 4 63 4 stone','fill -4 64 -4 4 70 4 air','setworldspawn 0 64 0','gamerule spawnRadius 0']);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  guardActions=createActions(runtime.bot,{memory:runtime.memory,log:runtime.log.bind(runtime)});
  const capture=()=>({slots:runtime.bot.inventory.slots.map((i,slot)=>i&&({slot,name:i.name,type:i.type,count:i.count,metadata:i.metadata,components:i.components,removedComponents:i.removedComponents})).filter(Boolean),cursor:runtime.bot.inventory.selectedItem});
  result.cases=[];
  for(const [capacity,existing,cursor] of [[16,16,1],[16,15,2],[99,60,20]]){
    await command(['tp BroBotHome .5 64 .5','gamemode survival BroBotHome','clear BroBotHome',`item replace entity BroBotHome inventory.0 with minecraft:cobblestone[max_stack_size=${capacity}] ${existing}`,`item replace entity BroBotHome inventory.1 with minecraft:cobblestone[max_stack_size=${capacity}] ${cursor}`,'item replace entity BroBotHome hotbar.0 with minecraft:oak_log 2']);
    await waitFor(()=>runtime.bot.entity.onGround && runtime.bot.inventory.slots[9]?.count===existing && runtime.bot.inventory.slots[10]?.count===cursor && runtime.bot.inventory.slots[36]?.count===2,5000,'prepared inventory');
    await bounded(runtime.bot.clickWindow(10,0,0),5000,'prepare cursor');
    await bounded(runtime.bot._syncWindow(runtime.bot.inventory),5000,'prepared cursor sync');
    const entry={capacity,existing,cursor,before:structuredClone(capture())};result.cases.push(entry);
    assert.equal(entry.before.cursor.count,cursor);
    assert.equal(entry.before.cursor.components.find(c=>c.type==='max_stack_size')?.data,capacity);
    entry.craft=await bounded(guardActions.execute('craft',{item:'oak_planks',count:4}),15000,'capacity-safe craft');
    await bounded(runtime.bot._syncWindow(runtime.bot.inventory),5000,'final inventory sync');
    entry.after=structuredClone(capture());
    assert.equal(entry.craft.crafted,4);
    assert.equal(entry.after.slots.filter(i=>i.name==='cobblestone').reduce((n,i)=>n+i.count,0),existing+cursor);
    assert.equal(entry.after.slots.find(i=>i.slot===9).count,Math.min(capacity,existing+cursor));
    assert.ok(entry.after.slots.filter(i=>i.name==='cobblestone').every(i=>i.components.find(c=>c.type==='max_stack_size')?.data===capacity && i.count<=capacity));
    assert.equal(entry.after.slots.filter(i=>i.name==='oak_planks').reduce((n,i)=>n+i.count,0),4);
    assert.equal(entry.after.slots.filter(i=>i.name==='oak_log').reduce((n,i)=>n+i.count,0),1);
    assert.equal(entry.after.cursor,null);
  }
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
  console.log(result.passed ? 'PASS prepared custom-capacity cursor storage' : 'FAIL prepared custom-capacity cursor storage; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

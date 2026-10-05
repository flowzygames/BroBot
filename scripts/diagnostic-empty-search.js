// Console-prepared integration fixture, never called by the production controller.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile, readFile, readdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Vec3 } from 'vec3';
import { execFileSync } from 'node:child_process';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { ROOT, SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const directory = join(SERVER_DIR, 'smoke', `empty-search-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0,8)}`);
const result = {
  kind: 'prepared-custom-empty-search', started: new Date().toISOString(), minecraft: VERSION,
  fixture: 'Console-prepared enclosed ore volume: verify an empty bounded search resumes its geometry across inspect/runner cleanup, and block updates and Stop invalidate it. No natural gathering or pass-rate claim.',
  sourceHashes: {}, passed: false, frames: [], actions: [], healthEvents: [], cleanupErrors: []
};
for (const name of await readdir(new URL('../src/', import.meta.url))) {
  if (name.endsWith('.js')) result.sourceHashes[`src/${name}`] = createHash('sha256').update(await readFile(new URL(`../src/${name}`, import.meta.url))).digest('hex');
}
result.sourceHashes['scripts/diagnostic-empty-search.js'] = createHash('sha256').update(await readFile(new URL('./diagnostic-empty-search.js', import.meta.url))).digest('hex');
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
  if (await pingTcp('127.0.0.1', port)) throw Error('Empty-search diagnostic port already occupied');
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
  const preparation=['difficulty peaceful','gamerule doMobSpawning false','gamerule doDaylightCycle false','time set day'];
  for(let y=32;y<96;y+=4)preparation.push(`fill -32 ${y} -32 31 ${y+3} 31 iron_ore`);
  preparation.push('fill -32 32 -32 31 32 31 bedrock','fill -32 95 -32 31 95 31 bedrock','fill -32 32 -32 -32 95 31 bedrock','fill 31 32 -32 31 95 31 bedrock','fill -32 32 -32 31 95 -32 bedrock','fill -32 32 31 31 95 31 bedrock');
  preparation.push('fill -2 78 -2 2 84 2 bedrock','fill -1 80 -1 1 82 1 air','setworldspawn 0 80 0','gamerule spawnRadius 0');
  await command(preparation);
  runtime = new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHome',BROBOT_DATA_DIR:join(directory,'memory')}));
  runtime.connect();
  await bounded(once(runtime.bot,'spawn'),30000,'spawn');
  await bounded(runtime.bot.waitForChunksToLoad(),30000,'chunk loading');
  const bot=runtime.bot;
  await command(['tp BroBotHome .5 80 .5','gamemode survival BroBotHome','clear BroBotHome']);
  await waitFor(()=>bot.entity.onGround,5000,'grounded player');await sleep(500);
  const original=bot.blockAt.bind(bot),write=bot._client.write.bind(bot._client);
  let visits=[];result.packets=[];
  bot.blockAt=(position,extra)=>{if(extra)visits.push(position.toString());return original(position,extra)};
  bot._client.write=(name,packet)=>{if(['block_dig','block_place'].includes(name))result.packets.push({name,packet});return write(name,packet)};
  const parent=new AbortController(),context={starterScope:'prepared/empty-search'};
  async function collect(label){
    visits=[];
    const started=performance.now();
    const outcome=await runtime.execute('collect',{block:'iron_ore',count:4,radius:32},parent.signal,context).then(value=>({value}),error=>({error:error.message,result:error.result}));
    const record={label,milliseconds:performance.now()-started,outcome,visits:visits.length,first:visits[0],last:visits.at(-1),pose:runtime.snapshot().position};
    result.actions.push(record);assert.equal(outcome.result?.mined,0);assert.equal(outcome.result?.failures.length,0);assert.equal(outcome.result?.search_continuation_saved,true);
    return record;
  }
  const first=await collect('initial empty bounded page');assert.equal(first.outcome.result.search_continued,false);
  await runtime.execute('inspect',{radius:1},parent.signal);
  const second=await collect('continued after inspect');assert.equal(second.outcome.result.search_continued,true);assert.notEqual(first.first,second.first);
  // A real server block update invalidates the retained traversal.
  await command(['setblock 3 80 0 gold_block']);
  await waitFor(()=>bot.blockAt(new Vec3(3,80,0))?.name==='gold_block',5000,'observed block update');
  const changed=await collect('fresh after server terrain change');assert.equal(changed.outcome.result.search_continued,false);assert.equal(changed.first,first.first);
  runtime.stop('Prepared explicit Stop');
  const stopped=await collect('fresh after explicit Stop');assert.equal(stopped.outcome.result.search_continued,false);assert.equal(stopped.first,first.first);
  parent.abort();
  assert.ok(!result.packets.some(p=>p.name==='block_place'||[0,1,2].includes(p.packet.status)));
  result.controls=Object.fromEntries(['forward','back','left','right','jump','sprint','sneak'].map(n=>[n,bot.getControlState(n)]));
  assert.ok(Object.values(result.controls).every(v=>v===false));assert.equal(runtime.runner.active,null);
  assert.equal(bot.health,20);assert.equal(runtime.connection,'connected');
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
  console.log(result.passed ? 'PASS prepared empty search continuation' : 'FAIL prepared empty search continuation; see retained result');
  console.log(`Detailed result: ${join(directory,'result.json')}`);
}

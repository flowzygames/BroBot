// Isolated, console-prepared health interruption check. Not natural survival.
import assert from 'node:assert/strict';
import { mkdir, copyFile, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { once } from 'node:events';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { SERVER_DIR, VERSION, requireEula, setupServer, writeServerConfig, spawnServer, stopServer } from './server.js';
import { pingTcp } from './doctor.js';
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
const directory=join(SERVER_DIR,'smoke',`health-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`);
const result={kind:'prepared-health-interruption',started:new Date().toISOString(),minecraft:VERSION,fixture:'Fresh isolated prepared flat world, supplied log blocks, normal survival with empty inventory. Natural regeneration and mobs disabled. Console applies13 generic damage during real log digging; the ordinary one-second reflex timer is disabled to isolate the health event. Not natural-world reliability or proof of injury prevention.',sourceHashes:{},passed:false};
for(const f of ['src/runtime.js','src/survival.js','src/starter-limits.js','scripts/diagnostic-health-interrupt.js'])result.sourceHashes[f]=createHash('sha256').update(await readFile(new URL('../'+f,import.meta.url))).digest('hex');
await requireEula(SERVER_DIR,{interactive:false});
const {java}=await setupServer({log:console.log});
const port=25637,bedrockPort=19147;
if(await pingTcp('127.0.0.1',port))throw Error('Diagnostic port already occupied');
await mkdir(join(directory,'plugins'),{recursive:true});
for(const f of ['Geyser-Spigot.jar','ViaVersion.jar'])await copyFile(join(SERVER_DIR,'plugins',f),join(directory,'plugins',f));
await copyFile(join(SERVER_DIR,'eula.txt'),join(directory,'eula.txt'));
await writeServerConfig(directory,{port,bedrockPort,smoke:true});
const log=createWriteStream(join(directory,'server.log'));let output='',runtime,child;
async function waitFor(test,ms,label){const end=Date.now()+ms;while(!test()){if(Date.now()>end)throw Error(`${label} timed out`);await sleep(20);}}
async function command(lines){const marker=randomUUID();child.stdin.write(lines.join('\n')+`\nsay ${marker}\n`);await waitFor(()=>output.includes(marker),10000,'console acknowledgement');}
try{
 child=await spawnServer({directory,java:java.path,pipe:true});
 for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{output=(output+c.toString()).slice(-200000);log.write(c);});
 await waitFor(()=>output.includes('Done ('),300000,'server startup');
 await command(['gamerule doMobSpawning false','gamerule naturalRegeneration false','gamerule doDaylightCycle false','time set day','fill -8 64 -8 16 64 8 stone','fill -8 65 -8 16 72 8 air','fill 5 65 0 5 69 0 oak_log','setworldspawn 0 65 0','gamerule spawnRadius 0']);
 runtime=new Runtime(loadConfig({MC_HOST:'127.0.0.1',MC_PORT:String(port),MC_VERSION:VERSION,MC_USERNAME:'BroBotHealth',BROBOT_DATA_DIR:join(directory,'memory')}));
 clearInterval(runtime.reflexTimer);runtime.connect();
 await Promise.race([once(runtime.bot,'spawn'),sleep(30000).then(()=>{throw Error('spawn timeout')})]);
 await runtime.bot.waitForChunksToLoad();
 await command(['tp BroBotHealth 0.5 65 0.5','gamemode survival BroBotHealth','clear BroBotHealth']);await sleep(300);
 assert.equal(runtime.bot.health,20);assert.equal(runtime.bot.inventory.items().length,0);
 await runtime.command('survive starter');
 await waitFor(()=>runtime.runner.active?.name==='collect' && runtime.bot.targetDigBlock,20000,'active real digging');
 const active=runtime.runner.active;result.before={health:runtime.bot.health,action:active.name,digging:runtime.bot.targetDigBlock.name};
 const began=Date.now();await command(['damage BroBotHealth 13 minecraft:generic']);
 await waitFor(()=>active.controller.signal.aborted,1500,'event-driven action interruption');
 await waitFor(()=>!runtime.survival.active&&!runtime.runner.active,5000,'cancelled action settling');
 result.after={health:runtime.bot.health,abortReason:active.controller.signal.reason?.message,jobStatus:runtime.survival.state()?.status,jobReason:runtime.survival.state()?.reason,elapsedMs:Date.now()-began,digging:!!runtime.bot.targetDigBlock};
 assert.ok(runtime.bot.health>6&&runtime.bot.health<=8,'test must exercise the gap above old runtime threshold');
 assert.equal(result.after.jobStatus,'paused');assert.match(result.after.abortReason,/Low health/);assert.equal(result.after.digging,false);result.passed=true;
 console.log('PASS event-driven starter interruption above the old six-health threshold');
}catch(error){result.error=error.message;process.exitCode=1;console.error('FAIL',error.message);}
finally{await runtime?.close();if(child)await stopServer(child);log.end();result.finished=new Date().toISOString();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('Detailed result: '+join(directory,'result.json'));}

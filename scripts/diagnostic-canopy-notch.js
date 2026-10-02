// Prepared diagnostic only. Never used by the production controller.
import assert from 'node:assert/strict';
import {cp,mkdir,copyFile,readFile,writeFile,symlink,readdir} from 'node:fs/promises';
import {createWriteStream} from 'node:fs';
import {once} from 'node:events';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import mineflayer from 'mineflayer';
import pf from 'mineflayer-pathfinder';
import {Vec3} from 'vec3';
import {SERVER_DIR,spawnServer,stopServer} from './server.js';
import {createActions} from '../src/actions.js';
import {planReturnablePath} from '../src/navigation-guards.js';
import {retainedLeafAnchor} from '../src/construction-guards.js';
import {planLeafNotch} from '../src/canopy-descent.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const source=join(SERVER_DIR,'benchmarks/2026-10-01T11-42-32-631Z-c93619a8');
const trunk = process.argv.includes('--trunk'), planned = process.argv.includes('--planned'), actionMode = process.argv.includes('--action');
const id=`canopy-${actionMode ? 'action-notch' : trunk ? 'trunk' : planned ? 'planned-notch' : 'notch'}-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}`;
const directory=join(SERVER_DIR,'smoke',id),port=25631;
const result={kind:'prepared-canopy-notch',sourceWorld:source,started:new Date().toISOString(),fixture:'Copied failed world; fixed time, weather and mobs; reconstructed inventory and staging position. Specified reversible leaf/log digs. Not natural survival, autonomous selection, or proof of long-term leaf support stability.',phases:[],passed:false};
result.sourceHashes={};
for(const file of [...(await readdir(new URL('../src/',import.meta.url))).filter(n=>n.endsWith('.js')).map(n=>'src/'+n),'scripts/server.js','scripts/diagnostic-canopy-notch.js']) result.sourceHashes[file]=createHash('sha256').update(await readFile(new URL('../'+file,import.meta.url))).digest('hex');
await mkdir(directory,{recursive:true});
for(const name of ['world','world_nether','world_the_end','config']) await cp(join(source,name),join(directory,name),{recursive:true});
await copyFile(join(source,'eula.txt'),join(directory,'eula.txt'));
let props=await readFile(join(source,'server.properties'),'utf8');
props=props.replace(/^server-port=.*$/m,`server-port=${port}`).replace(/^server-ip=.*$/m,'server-ip=127.0.0.1');
await writeFile(join(directory,'server.properties'),props);
const base=join(SERVER_DIR,'benchmarks/2026-10-01T07-13-31-523Z-77cb12fa');
for(const name of ['libraries','versions']) await symlink(join(base,name),join(directory,name));
await symlink(join(SERVER_DIR,'restored-cache'),join(directory,'cache'));
const log=createWriteStream(join(directory,'server.log'));let output='',bot,actions,child;
async function waitFor(test,ms=10000){const end=Date.now()+ms;while(!test()){if(Date.now()>end)throw new Error('Diagnostic condition timeout');await sleep(50);}}
async function command(lines){const marker=randomUUID();child.stdin.write(lines.join('\n')+`\nsay ${marker}\n`);await waitFor(()=>output.includes(marker));await sleep(300);}
async function phase(name,fn){const start=Date.now();try{const detail=await fn();result.phases.push({name,passed:true,elapsedMs:Date.now()-start,detail});console.log('PASS',name);}catch(e){result.phases.push({name,passed:false,error:e.message});throw e;}}
function homeAnchor(){const proof=retainedLeafAnchor(p=>bot.blockAt(p),new Vec3(224,84,-32));assert.ok(proof,'Home leaf floor must retain a loaded log anchor');return proof;}
const stage=trunk?new Vec3(225,85,-32):new Vec3(224,85,-31),home=new Vec3(224,85,-32);
let landing=trunk?new Vec3(226,84,-33):new Vec3(225,84,-32);
async function route(a,b){const view=Object.create(bot);view.entity={...bot.entity,position:a.clone()};return planReturnablePath(view,bot.pathfinder.movements,new pf.goals.GoalBlock(b.x,b.y,b.z),new pf.goals.GoalBlock(...a.floored().toArray()),{fixedEndpoint:b,planningBudget:1800});}
async function walk(p){await actions.execute('go_to',{x:p.x,y:p.y,z:p.z,radius:0});await waitFor(()=>bot.entity.onGround&&Math.abs(bot.entity.position.y-p.y)<.03&&bot.entity.position.floored().equals(p));return bot.entity.position.toArray();}
try{
 child=await spawnServer({directory,java:'java',pipe:true});for(const stream of [child.stdout,child.stderr])stream.on('data',d=>{output=(output+d).slice(-200000);log.write(d);});
 await waitFor(()=>output.includes('Done ('),180000);
 await command(['gamerule doMobSpawning false','gamerule doDaylightCycle false','gamerule doWeatherCycle false','gamerule randomTickSpeed 0','difficulty peaceful','time set day','weather clear']);
 bot=mineflayer.createBot({host:'127.0.0.1',port,version:'1.21.8',username:'BroBotNotch',auth:'offline'});bot.on('error',e=>{result.botError=e.message;});await once(bot,'spawn');bot.loadPlugin(pf.pathfinder);
 actions=createActions(bot,{movementBoundary:()=>({center:{x:224,y:85,z:-32},radius:90})});
 await command(['gamemode survival BroBotNotch',`tp BroBotNotch ${stage.x+.5} ${stage.y} ${stage.z+.5}`,'clear BroBotNotch','give BroBotNotch wooden_pickaxe 1','give BroBotNotch spruce_planks 3','give BroBotNotch spruce_log 3','give BroBotNotch stick 2']);
 await waitFor(()=>bot.entity.onGround&&bot.entity.position.floored().equals(stage));
 await bot.waitForChunksToLoad();
 await phase('Staging and original home route',async()=>{await walk(stage);assert.equal(bot.pathfinder.movements.canDig,false);assert.equal(bot.pathfinder.movements.allowParkour,false);assert.equal(bot.pathfinder.movements.maxDropDown,3);return route(bot.entity.position,home);});
 if(actionMode)await phase('Execute observed bounded descent action',async()=>{const result=await actions.execute('descend_notch',{});assert.equal(result.completed,true);assert.equal(result.descended_blocks,1);landing=bot.entity.position.floored();return result;});
 else {
 if(planned)await phase('Select a notch from live observations',async()=>{await bot.waitForChunksToLoad();console.log('MOVEMENT',JSON.stringify({onGround:bot.entity.onGround,position:bot.entity.position,m: Object.fromEntries(['canDig','canOpenDoors','allowFreeMotion','allowParkour','allow1by1towers','maxDropDown'].map(k=>[k,bot.pathfinder.movements[k]]))}));const plan=await planLeafNotch(bot,home);assert.ok(plan,'No certified observed notch');landing=new Vec3(...plan.landing);return plan;});
 await phase('Dig one adjacent lower leaf without removing occupied support',async()=>{assert.equal(bot.blockAt(landing).name,'spruce_leaves');const r=await actions.execute('dig_at',{x:landing.x,y:landing.y,z:landing.z,expected_block:'spruce_leaves'});assert.equal(r.mined,1);assert.equal(bot.blockAt(stage.offset(0,-1,0)).name,'spruce_leaves');return r;});
 await phase('Verify real lower landing and return route',async()=>route(bot.entity.position,landing));
 await phase('Settle on lower landing',async()=>walk(landing));
 }
 if(trunk){
   for(const [name,blocks,end] of [
     ['Enter trunk at Y84',[[227,84,-33]],new Vec3(227,84,-33)],
     ['Enter lower trunk at Y83',[[228,84,-33],[228,83,-33]],new Vec3(228,83,-33)]
   ]) await phase(name,async()=>{
     const digs=[],anchors=[],digStage=bot.entity.position.floored();
     for(const [x,y,z] of blocks){await route(bot.entity.position,digStage);await walk(digStage);assert.equal(bot.blockAt(new Vec3(x,y,z)).name,'spruce_log');homeAnchor();digs.push(await actions.execute('dig_at',{x,y,z,expected_block:'spruce_log'}));anchors.push(homeAnchor());}
     const proof=await route(bot.entity.position,end);const position=await walk(end);await route(bot.entity.position,home);
     return {digs,anchors,proof,position};
   });
 }
 await phase('Return home alive',async()=>{const p=await walk(home);assert.equal(bot.health,20);return {position:p,health:bot.health,inventory:bot.inventory.items().map(({name,count})=>({name,count}))};});
 await phase('Retained home support under normal random ticks',async()=>{const before=homeAnchor();await command(['gamerule randomTickSpeed 3']);await sleep(10000);const after=homeAnchor();assert.equal(bot.health,20);assert.ok(bot.entity.onGround);return {before,after,position:bot.entity.position.toArray(),health:bot.health,observationSeconds:10};});
 result.passed=true;
}catch(e){result.error=e.stack;console.error(e);}finally{actions?.stop();bot?.quit();if(child)await stopServer(child);log.end();result.finished=new Date().toISOString();await writeFile(join(directory,'result.json'),JSON.stringify(result,null,2));console.log(join(directory,'result.json'));}
if(!result.passed)process.exitCode=1;

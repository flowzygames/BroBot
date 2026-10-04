import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { realSectionSearch } from './helpers/section-search.js';

test('starter observes a loaded diagonal tree and ignores logs beyond its sphere', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brobot-search-'));
  const runtime = new Runtime(loadConfig({ BROBOT_DATA_DIR: directory }));
  const registry = minecraftData('1.21.8');
  const target = new Vec3(-33,64,-17), outside = new Vec3(47,79,15);
  const blocks = [target, outside].map((position, i) => {
    const name = i ? 'oak_log' : 'spruce_log', def = registry.blocksByName[name];
    return { name, type: def.id, stateId: def.defaultState, position };
  });
  const bot = { registry, entity: { position: new Vec3(.5,64,.5) }, game: { minY: -64, height: 384 },
    blockAt: p => blocks.find(b => b.position.equals(p)) ?? { name: 'air', type: 0, stateId: 0, position: p.clone() }, quit() {} };
  bot.findBlocks = realSectionSearch(bot, blocks);
  runtime.bot = bot;
  runtime.execute = async () => ({ position: bot.entity.position, nearby_blocks: [] });
  try {
    const observation = await runtime.survival.observe(new AbortController().signal);
    assert.equal(observation.wood, 'spruce');
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

for (const [name, inventory, food, expectedScans, nearTable = false] of [
  ['carried logs ready to craft', [{name:'spruce_log',count:3}],20,0],
  ['pickaxe ready to mine stone', [{name:'wooden_pickaxe',count:1},{name:'stick',count:2}],20,0],
  ['complete kit ready to return', [{name:'stone_pickaxe',count:1},{name:'furnace',count:1}],20,0],
  ['urgent eating', [{name:'bread',count:1}],8,0],
  ['empty inventory needs wood', [],20,1],
  ['removed remembered table requires fresh wood lookup', [{name:'spruce_planks',count:2},{name:'stick',count:4}],20,1,'stale'],
  ['nearby remembered table still needs one plank', [{name:'spruce_planks',count:2},{name:'stick',count:4}],20,1,true],
  ['missing pickaxe handles need wood', [{name:'wooden_pickaxe',count:1}],20,1]
]) test(`starter log discovery is goal-aware: ${name}`,async()=>{
  const directory=await mkdtemp(join(tmpdir(),'brobot-observation-')),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory})),registry=minecraftData('1.21.8');
  const position=new Vec3(.5,64,.5),logPosition=new Vec3(2,64,0);let logScans=0,tableScans=0;
  runtime.survival.job={home:{position:{x:0,y:64,z:0},dimension:'overworld'},tables:nearTable?[{x:1,y:64,z:0}]:[],observedPositions:[]};
  runtime.bot={registry,entity:{position},quit(){},blockAt:p=>({name:p.equals(logPosition)?'spruce_log':nearTable===true&&p.equals(new Vec3(1,64,0))?'crafting_table':'air',position:p,boundingBox:p.equals(logPosition)?'block':'empty'}),
    findBlocks:options=>{if(options.matching.includes(registry.blocksByName.spruce_log.id)){logScans++;return[logPosition]}tableScans++;return nearTable===true?[new Vec3(1,64,0)]:[]}};
  runtime.execute=async()=>({connected:true,position,dimension:'overworld',health:20,food,inventory,entities:[],nearby_blocks:[]});
  try{const observation=await runtime.survival.observe(new AbortController().signal);assert.equal(logScans,expectedScans);assert.equal(tableScans,1);assert.equal(observation.wood,expectedScans?'spruce':undefined);}
  finally{await runtime.close();await rm(directory,{recursive:true,force:true});}
});

test('real runtime invalidates failed searches on block and chunk updates including non-resource stone',async()=>{
  const {EventEmitter}=await import('node:events'),{default:mineflayer}=await import('mineflayer');
  const directory=await mkdtemp(join(tmpdir(),'brobot-terrain-')),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory})),registry=minecraftData('1.21.8');
  const bot=Object.assign(new EventEmitter(),{registry,entity:{position:new Vec3(.5,64,.5)},loadPlugin(){},quit(){},findBlocks:()=>[],blockAt:p=>({name:'air',position:p,boundingBox:'empty'})});
  const create=mineflayer.createBot;mineflayer.createBot=()=>bot;
  let local=[{name:'air',position:{x:1,y:64,z:0}}];
  runtime.execute=async()=>({position:bot.entity.position,nearby_blocks:[],local_blocks:local});
  try{
    runtime.connect();const first=await runtime.survival.observe();assert.equal(first.terrainRevision,0);
    local=[{name:'stone',position:{x:1,y:64,z:0}}];bot.emit('blockUpdate',null,local[0]);
    const changed=await runtime.survival.observe();assert.equal(changed.terrainRevision,1);assert.notDeepEqual(changed.localTerrain,first.localTerrain);
    bot.emit('chunkColumnLoad',new Vec3(16,0,0));bot.emit('chunkColumnUnload',new Vec3(32,0,0));assert.equal((await runtime.survival.observe()).terrainRevision,3);
  }finally{mineflayer.createBot=create;await runtime.close();await rm(directory,{recursive:true,force:true});}
});

test('runtime observation exposes lava at the recorded body position before selecting more work',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'brobot-lava-')),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory})),registry=minecraftData('1.21.8');
 const position=new Vec3(-206.3,62,9.02);
 runtime.survival.job={home:{position:{x:-205,y:65,z:11},dimension:'overworld'},tables:[],observedPositions:[]};
 runtime.bot={registry,entity:{position},quit(){},findBlocks:()=>[],blockAt:p=>({name:p.equals(new Vec3(-207,62,9))?'lava':'air',position:p,boundingBox:'empty'})};
 runtime.execute=async()=>({connected:true,position,dimension:'overworld',health:16,food:20,inventory:[{name:'wooden_pickaxe',count:1},{name:'stick',count:2}],entities:[],nearby_blocks:[]});
 try{const observation=await runtime.survival.observe();assert.equal(observation.lavaContact,true);assert.equal(observation.powderSnowContact,false);assert.equal(observation.wood,undefined)}
 finally{await runtime.close();await rm(directory,{recursive:true,force:true})}
});

test('runtime reports local craft geometry independently of global terrain churn',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'brobot-craft-context-')),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory})),registry=minecraftData('1.21.8');
 const position=new Vec3(.5,64,.5),blocks=new Map();
 runtime.survival.job={home:{position:{x:.5,y:64,z:.5},dimension:'overworld'},tables:[]};
 runtime.bot={registry,entity:{position},game:{dimension:'overworld'},quit(){},findBlocks:()=>[],blockAt:p=>blocks.get(p.toString())??{name:'air',position:p,stateId:0,boundingBox:'empty',shapes:[]}};
 runtime.execute=async()=>({connected:true,position,dimension:'overworld',health:20,food:20,inventory:[{name:'oak_log',count:3}],entities:[],nearby_blocks:[]});
 try{
  const first=await runtime.survival.observe();assert.match(first.craftGeometry,/^[a-f0-9]{64}$/);
  runtime.terrainRevision++;blocks.set(new Vec3(100,64,0).toString(),{name:'stone',stateId:1,boundingBox:'block'});
  const remote=await runtime.survival.observe();assert.notEqual(remote.terrainRevision,first.terrainRevision);assert.equal(remote.craftGeometry,first.craftGeometry);
  blocks.set(new Vec3(7,64,0).toString(),{name:'oak_trapdoor',stateId:10,boundingBox:'block'});
  assert.notEqual((await runtime.survival.observe()).craftGeometry,first.craftGeometry);
 }finally{await runtime.close();await rm(directory,{recursive:true,force:true})}
});

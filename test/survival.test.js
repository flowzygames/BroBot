import test from 'node:test';
import assert from 'node:assert/strict';
import { SurvivalJob, nextStarterStep } from '../src/survival.js';
import { parseCommand } from '../src/commands.js';

function fixture(options = {}) {
  const data = {}, events = [], calls = [];
  const state = { connected: true, dimension: 'overworld', health: 20, food: 20, position: { x: 0.5, y: 64, z: 0.5 }, inventory: [], entities: [] };
  const counts = () => Object.fromEntries(state.inventory.map(i => [i.name, i.count]));
  const add = (name, n) => { const item = state.inventory.find(i => i.name === name); if (item) item.count += n; else state.inventory.push({ name, count: n }); state.inventory = state.inventory.filter(i => i.count > 0); };
  let table = false;
  const execute = async (name, args) => {
    calls.push({ name, args });
    if (name === 'collect') { add(args.block === 'stone' ? 'cobblestone' : args.block, args.count); state.position.x = 10.5; return { completed: true }; }
    if (name === 'craft') {
      const c = counts(), item = args.item;
      const spend = (n, count) => { assert.ok((counts()[n] ?? 0) >= count, `Missing ${n}`); add(n, -count); };
      if (item.endsWith('_planks')) { const wood = item.replace('_planks', ''); const times = Math.ceil(args.count / 4); spend(`${wood}_log`, times); add(item, times * 4); }
      else if (item === 'crafting_table') { spend('oak_planks', 4); add(item, 1); }
      else if (item === 'stick') { spend('oak_planks', 2); add(item, 4); }
      else {
        if (!table) { spend('crafting_table', 1); table = true; }
        if (item === 'wooden_pickaxe') { spend('oak_planks', 3); spend('stick', 2); }
        else if (item === 'stone_pickaxe') { spend('cobblestone', 3); spend('stick', 2); }
        else if (item === 'furnace') spend('cobblestone', 8);
        else throw new Error(`Unsupported fixture recipe ${item}`);
        add(item, 1);
      }
      return { crafted: 1 };
    }
    if (name === 'go_to') { state.position = { x: args.x + 0.5, y: args.y, z: args.z + 0.5 }; return { arrived: true }; }
    if (name === 'explore') { state.position.x += 2; return { explored: true }; }
    if (name === 'eat') { state.food = 20; return { ate: true }; }
    return {};
  };
  const memory = { get: (key, fallback) => structuredClone(data[key] ?? fallback), set: (key, value) => { data[key] = structuredClone(value); } };
  const job = new SurvivalJob({ memory, snapshot: () => structuredClone(state), observe: async () => ({ wood: 'oak', tableInReach: table }), execute, stopActions: () => {}, context: 'test', log: (...e) => events.push(e), intervalMs: 0, ...options });
  return { job, state, memory, data, calls, counts, add, events, execute };
}

test('starter controller completes a multi-step job from empty inventory using fresh state', async () => {
  const f = fixture(); f.job.start(); await f.job.promise;
  assert.equal(f.job.state().status, 'complete');
  assert.equal(f.counts().stone_pickaxe, 1); assert.equal(f.counts().furnace, 1);
  assert.ok(f.calls.length > 8); assert.equal(f.calls.at(-1).name, 'go_to');
});

test('reported action success cannot fake starter completion without actual inventory', async () => {
  const f = fixture({ maxSteps: 8 }); f.job.execute = async () => ({ completed: true, crafted: 1 });
  f.job.start(); await f.job.promise;
  assert.equal(f.job.state().status, 'blocked'); assert.equal(f.counts().stone_pickaxe, undefined);
});

test('missing resources trigger bounded scouting instead of an endless collect retry', async () => {
  const f = fixture(); f.job.observe = async () => ({});
  f.job.start(); await f.job.promise;
  assert.equal(f.calls.length, 8); assert.ok(f.calls.every(c => c.name === 'explore' && c.args.returnable));
  assert.match(f.job.state().reason, /Exploration budget/);
});

test('two blocked collections trigger a different scouting action then resume gathering', async () => {
  const f = fixture(); let rejected = 0;
  f.job.execute = async (name, args, signal) => { if (name === 'collect' && rejected++ < 2) throw new Error('Blocked route'); return f.execute(name, args, signal); };
  f.job.start(); await f.job.promise;
  assert.equal(f.job.state().status, 'complete'); assert.ok(f.calls.some(c => c.name === 'explore'));
  assert.equal(f.data.survivalJob.history.filter(e => e.error === 'Blocked route').length, 2);
});

test('partial gathering counts only inventory and recovers observed drops', async () => {
  const f = fixture(); let partial = true;
  f.job.execute = async (name, args, signal) => {
    if (name === 'collect' && partial) { partial = false; return { mined: 1, completed: false, remaining_drops: [{ id: 2 }] }; }
    if (name === 'pickup') { f.add('oak_log', 1); f.calls.push({ name, args }); return { inventory_changes: { oak_log: 1 } }; }
    return f.execute(name, args, signal);
  };
  f.job.start(); await f.job.promise;
  assert.equal(f.job.state().status, 'complete'); assert.equal(f.calls[0].name, 'pickup');
});

test('stop waits for a late action to drain and requires explicit resume', async () => {
  const f = fixture(); let release; const original = f.job.execute;
  f.job.execute = () => new Promise(resolve => { release = resolve; });
  f.job.start(); while (!release) await new Promise(r => setImmediate(r));
  f.job.stop('User stop'); assert.throws(() => f.job.start(), /already running/);
  release({}); await f.job.promise;
  assert.equal(f.job.state().status, 'paused'); assert.equal(f.job.state().reason, 'User stop');
  f.job.execute = original; f.job.start({ resume: true }); await f.job.promise;
  assert.equal(f.job.state().status, 'complete');
});

test('death, disconnect, dimension change and low food never certify completion', async () => {
  for (const change of [{ health: 0 }, { connected: false }, { dimension: 'the_nether' }, { food: 5 }]) {
    const f = fixture(); const original = f.job.observe;
    f.job.observe = async () => { Object.assign(f.state, change); return original(); };
    f.job.start(); await f.job.promise;
    assert.equal(f.job.state().status, 'blocked'); assert.equal(f.calls.length, 0);
  }
});

test('held food is consumed before low-hunger work continues', async () => {
  const f = fixture(); f.state.food = 9; f.add('bread', 1);
  f.job.start(); await f.job.promise;
  assert.equal(f.calls[0].name, 'eat'); assert.equal(f.job.state().status, 'complete');
});

test('restart pauses an interrupted job and does not launch work automatically', async () => {
  const f = fixture(); f.job.start(); await f.job.promise;
  f.data.survivalJob.status = 'running';
  const restored = new SurvivalJob({ memory: f.memory, context: 'test' });
  assert.equal(restored.active, null); assert.equal(restored.state().status, 'paused');
  assert.match(restored.state().reason, /Process restarted/);
});

test('resume refuses a different connection', async () => {
  const f = fixture({ maxSteps: 1 }); f.job.start(); await f.job.promise;
  f.job.context = 'other'; assert.throws(() => f.job.start({ resume: true }), /another connection/);
});

test('different wood species cannot trap prerequisite crafting behind leftover planks', () => {
  const state = { connected: true, health: 20, food: 20, dimension: 'overworld', position: { x: 0, y: 64, z: 0 }, inventory: [{ name: 'oak_planks', count: 1 }, { name: 'birch_log', count: 1 }] };
  const job = { home: { position: state.position, dimension: state.dimension } };
  assert.equal(nextStarterStep(state, job, { wood: 'birch' }).args.item, 'birch_planks');
});

test('starter and resume commands are explicit offline commands', () => {
  assert.deepEqual(parseCommand('survive starter'), { kind: 'survival', resume: false });
  assert.deepEqual(parseCommand('!bro survive resume'), { kind: 'survival', resume: true });
  assert.throws(() => parseCommand('survive forever'));
});

test('invalid saved starter jobs fail closed', () => {
  assert.throws(() => new SurvivalJob({ memory: { get: () => ({ version: 1, status: 'running', history: null }) } }), /Saved starter job is invalid/);
});

test('starter time budget cancels a pending action and never starts another', async () => {
  const f = fixture({ maxDurationMs: 15 }); let attempts = 0;
  f.job.execute = (name, args, signal) => new Promise((resolve, reject) => {
    attempts++; signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  const alive = setTimeout(() => {}, 100);
  try { f.job.start(); await f.job.promise; } finally { clearTimeout(alive); }
  assert.equal(attempts, 1); assert.equal(f.job.state().status, 'paused'); assert.match(f.job.state().reason, /time budget/);
});

test('recovery remembers unreachable resource coordinates across action retries', async () => {
  const f = fixture(); let failures = 0, skipped = false;
  f.job.execute = async (name, args, signal) => {
    if (name === 'collect' && failures++ === 0) throw Object.assign(new Error('Blocked route'), { result: { failures: [{ position: { x: 2, y: 64, z: 0 }, error: 'No verified returnable route' }] } });
    if (name === 'collect' && args.skip_positions) { skipped = true; assert.deepEqual(args.skip_positions[0], { x: 2, y: 64, z: 0 }); }
    return f.execute(name, args, signal);
  };
  f.job.start(); await f.job.promise;
  assert.equal(skipped, true); assert.equal(f.job.state().status, 'complete');
});

test('blocked tree gathering can clear an observed leaf obstruction within a bounded budget', async () => {
  const f = fixture(); let failures = 0, cleared = false;
  f.job.observe = async () => ({ wood: 'oak', tableInReach: f.counts().wooden_pickaxe > 0, foliage: { x: 2, y: 65, z: 0 } });
  f.job.execute = async (name, args, signal) => {
    if (name === 'collect' && failures++ < 2) throw new Error('Blocked route');
    if (name === 'dig_at') { cleared = true; assert.deepEqual(args, { x: 2, y: 65, z: 0 }); return { mined: 1 }; }
    return f.execute(name, args, signal);
  };
  f.job.start(); await f.job.promise;
  assert.equal(cleared, true); assert.equal(f.job.state().clearings, 1); assert.equal(f.job.state().status, 'complete');
});

test('runtime tree observation is not starved by ore and returns only a nearby leaf obstruction', async () => {
  const { Runtime } = await import('../src/runtime.js');
  const { loadConfig } = await import('../src/config.js');
  const { Vec3 } = await import('vec3');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'brobot-observe-'));
  const runtime = new Runtime(loadConfig({ BROBOT_DATA_DIR: dir }));
  runtime.execute = async () => ({ position: { x: 0.5, y: 64, z: 0.5 }, nearby_blocks: Array.from({ length: 64 }, () => ({ name: 'iron_ore', position: { x: 2, y: 60, z: 0 } })) });
  runtime.bot = {
    registry: { blocksArray: [{ id: 1, name: 'oak_log' }, { id: 2, name: 'iron_ore' }] },
    entity: { position: new Vec3(0.5, 64, 0.5) },
    findBlocks: ({ matching }) => { assert.deepEqual(matching, [1]); return [new Vec3(4, 64, 0)]; },
    blockAt: p => ({ name: 'oak_log', position: p }),
    world: { raycast: (eye, direction, distance) => { assert.ok(Math.abs(direction.norm() - 1) < 0.001); assert.ok(distance <= 4.2); return { name: 'oak_leaves', position: new Vec3(2, 65, 0) }; } }, quit: () => {}
  };
  try { assert.deepEqual(await runtime.survival.observe(), { wood: 'oak', foliage: { x: 2, y: 65, z: 0, expected_block: 'oak_leaves' }, pickupClearance: null, tables: [], tableInReach: false }); }
  finally { await runtime.close(); await rm(dir, { recursive: true, force: true }); }
});

test('completion on the final allowed action is verified rather than lost to the step limit', async () => {
  const f = fixture({ maxSteps: 1 }); f.add('stone_pickaxe', 1); f.add('furnace', 1);
  const original = f.job.observe;
  f.job.observe = async () => { f.state.position.x = 8; return original(); };
  f.job.start(); await f.job.promise;
  assert.equal(f.calls.length, 1); assert.equal(f.job.state().status, 'complete');
});

test('starter returns to a known table instead of requiring redundant wood', () => {
  const state = { connected: true, health: 20, food: 20, dimension: 'overworld', position: { x: 20, y: 64, z: 0 }, inventory: [{ name: 'wooden_pickaxe', count: 1 }, { name: 'stick', count: 2 }, { name: 'cobblestone', count: 11 }, { name: 'birch_planks', count: 3 }] };
  const table = { x: 0, y: 64, z: 2 };
  const job = { home: { position: { x: 0, y: 64, z: 0 }, dimension: 'overworld' }, tables: [table] };
  const step = nextStarterStep(state, job, { wood: 'birch', tableInReach: false });
  assert.equal(step.name, 'go_to'); assert.equal(step.waypointKind, 'table'); assert.equal(step.args.z, 2);
  job.ignoredTables = [table];
  assert.equal(nextStarterStep(state, job, { wood: 'birch', tableInReach: false }).name, 'collect');
});

test('drop recovery can clear a verified head block and then resume pickup', async () => {
  const f = fixture(); let dropped = false, cleared = false;
  f.job.observe = async () => ({ wood: 'oak', tableInReach: f.counts().wooden_pickaxe > 0, pickupClearance: dropped && !cleared ? { x: 2, y: 64, z: 0, expected_block: 'stone' } : null });
  f.job.execute = async (name, args, signal) => {
    if (name === 'collect' && !dropped) { dropped = true; return { completed: false, remaining_drops: [{ id: 2 }] }; }
    if (name === 'dig_at') { cleared = true; assert.equal(args.expected_block, 'stone'); return { mined: 1 }; }
    if (name === 'pickup') { assert.deepEqual(args.entity_ids, [2]); assert.equal(cleared, true); f.add('oak_log', 1); return { inventory_changes: { oak_log: 1 }, remaining_drops: [] }; }
    return f.execute(name, args, signal);
  };
  f.job.start(); await f.job.promise;
  assert.equal(cleared, true); assert.equal(f.job.state().status, 'complete'); assert.equal(f.job.state().clearanceDigs, 1);
});

test('explicit resume grants a new bounded step budget while preserving total progress', async () => {
  const f = fixture({ maxSteps: 1 });
  f.job.start(); await f.job.promise;
  assert.equal(f.job.state().status, 'blocked');
  assert.equal(f.job.state().steps, 1);
  for (let attempt = 0; attempt < 30 && f.job.state().status !== 'complete'; attempt++) {
    const previous = f.job.state().steps;
    f.job.start({ resume: true }); await f.job.promise;
    assert.ok(f.job.state().steps <= previous + 1);
  }
  assert.equal(f.job.state().status, 'complete');
  assert.ok(f.job.state().steps > 1);
  assert.equal(f.counts().stone_pickaxe, 1);
  assert.equal(f.counts().furnace, 1);
});

test('starter gathers the kit stone before returning to a distant crafting table', () => {
 const state={connected:true,health:20,food:20,dimension:'overworld',position:{x:8,y:64,z:0},inventory:[{name:'wooden_pickaxe',count:1},{name:'stick',count:2},{name:'cobblestone',count:3}]};
 const job={home:{position:{x:0,y:64,z:0},dimension:'overworld'},tables:[{x:0,y:64,z:0}]};
 const away=nextStarterStep(state,job,{tableInReach:false});assert.equal(away.name,'collect');assert.equal(away.args.count,4);
 const near=nextStarterStep(state,job,{tableInReach:true});assert.equal(near.name,'craft');assert.equal(near.args.item,'stone_pickaxe');
 state.inventory.find(i=>i.name==='cobblestone').count=11;
 assert.equal(nextStarterStep(state,job,{tableInReach:false}).waypointKind,'table');
});

test('starter observes its crafting table even when generic inspection is full of ore', async () => {
 const { Runtime }=await import('../src/runtime.js');const { loadConfig }=await import('../src/config.js');const {Vec3}=await import('vec3');const{mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'brobot-table-observe-'));const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:dir}));
 runtime.execute=async()=>({position:{x:0.5,y:64,z:0.5},nearby_blocks:Array.from({length:64},()=>({name:'iron_ore',position:{x:0,y:60,z:0}}))});
 runtime.bot={registry:{blocksArray:[{id:1,name:'oak_log'},{id:2,name:'crafting_table'}]},entity:{position:new Vec3(0.5,64,0.5)},findBlocks:({matching})=>matching[0]===2?[new Vec3(2,64,0)]:[],blockAt:p=>({name:'crafting_table',position:p}),quit:()=>{}};
 try{const observation=await runtime.survival.observe();assert.equal(observation.tableInReach,true);assert.equal(observation.tables.length,1);assert.equal(observation.tables[0].x,2);}finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('starter gathers its initial wooden prerequisites in one bounded batch',()=>{
 const state={connected:true,health:20,food:20,dimension:'overworld',position:{x:0,y:64,z:0},inventory:[]};const job={home:{position:state.position,dimension:'overworld'}};
 assert.equal(nextStarterStep(state,job,{wood:'oak'}).args.count,3);
 state.inventory=[{name:'wooden_pickaxe',count:1}];
 const step=nextStarterStep(state,job,{wood:'oak'});assert.equal(step.args.count,1);
});

test('starter excludes known failed tree coordinates before the observation result cap',async()=>{
 const {Runtime}=await import('../src/runtime.js');const{loadConfig}=await import('../src/config.js');const{Vec3}=await import('vec3');const{mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'brobot-log-filter-'));const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:dir}));
 runtime.execute=async()=>({position:{x:0.5,y:64,z:0.5},nearby_blocks:[]});runtime.survival.job={excluded:{oak_log:[{x:1,y:64,z:0}]}};
 const blocks=[{name:'oak_log',position:new Vec3(1,64,0)},{name:'birch_log',position:new Vec3(2,64,0)}];
 runtime.bot={registry:{blocksArray:[{id:1,name:'oak_log'},{id:2,name:'birch_log'}]},entity:{position:new Vec3(0.5,64,0.5)},findBlocks:({useExtraInfo})=>blocks.filter(useExtraInfo).map(b=>b.position),blockAt:p=>blocks.find(b=>b.position.equals(p)),quit:()=>{}};
 try{assert.equal((await runtime.survival.observe()).wood,'birch');}finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('verified terrain clearing retries nearby blocked resources without forgetting distant failures',async()=>{
 const f=fixture();let attempts=0,cleared=false;
 const near={x:2,y:64,z:0},far={x:30,y:64,z:0};
 f.job.observe=async()=>({wood:'oak',tableInReach:f.counts().wooden_pickaxe>0,foliage:{x:2,y:65,z:0,expected_block:'oak_leaves'}});
 f.job.execute=async(name,args,signal)=>{
  if(name==='collect'&&attempts++<2){f.job.job.ignoredTables=[near,far];throw Object.assign(new Error('Blocked route'),{result:{failures:[near,far].map(position=>({position,error:'Blocked route'}))}});}
  if(name==='dig_at'){cleared=true;return{mined:1,completed:true};}
  if(name==='collect'&&cleared){assert.ok(!args.skip_positions?.some(p=>p.x===near.x));assert.ok(args.skip_positions?.some(p=>p.x===far.x));assert.deepEqual(f.job.job.ignoredTables,[far]);cleared=false;}
  return f.execute(name,args,signal);
 };
 f.job.start();await f.job.promise;assert.equal(f.job.state().status,'complete');assert.ok(f.data.survivalJob.history.some(h=>h.action==='dig_at'&&h.progress));
});

test('starter log observation and gathering share a bounded radius beyond the old 32-block fringe',async()=>{
 const {STARTER_LOG_RADIUS}=await import('../src/survival.js');assert.equal(STARTER_LOG_RADIUS,48);
 const state={connected:true,health:20,food:20,dimension:'overworld',position:{x:0,y:64,z:0},inventory:[]};const job={home:{position:state.position,dimension:'overworld'}};
 assert.equal(nextStarterStep(state,job,{wood:'oak'}).args.radius,STARTER_LOG_RADIUS);
 const {Runtime}=await import('../src/runtime.js');const{loadConfig}=await import('../src/config.js');const{Vec3}=await import('vec3');const{mkdtemp,rm}=await import('node:fs/promises');const{tmpdir}=await import('node:os');const{join}=await import('node:path');
 const dir=await mkdtemp(join(tmpdir(),'brobot-log-radius-'));const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:dir}));runtime.execute=async()=>({position:state.position,nearby_blocks:[]});const p=new Vec3(40,64,0);
 runtime.bot={registry:{blocksArray:[{id:1,name:'oak_log'}]},entity:{position:new Vec3(0.5,64,0.5)},findBlocks:({maxDistance})=>{assert.equal(maxDistance,48);return[p];},blockAt:q=>({name:'oak_log',position:q}),quit:()=>{}};
 try{assert.equal((await runtime.survival.observe()).wood,'oak');}finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('starter crafts from verified materials instead of chasing unnecessary leftover drops',async()=>{
 const f=fixture();let first=true;
 f.job.execute=async(name,args,signal)=>{
   if(name==='pickup')throw new Error('Unnecessary pickup should not run');
   const result=await f.execute(name,args,signal);
   if(name==='collect'&&first){first=false;return{...result,remaining_drops:[{id:99}]};}
   return result;
 };
 f.job.start();await f.job.promise;assert.equal(f.job.state().status,'complete');
});

test('a shared planning budget limit does not blacklist an unplanned resource', async () => {
  const f = fixture(); let first = true;
  f.job.execute = async (name, args, signal) => {
    if (name === 'collect' && first) {
      first = false;
      throw Object.assign(new Error('Collection return-path planning budget exhausted'), { result: { planning_limited: true, failures: [{ position: { x: 2, y: 64, z: 0 }, error: 'Collection return-path planning budget exhausted', code: 'COLLECTION_PLANNING_LIMIT' }] } });
    }
    if (name === 'collect') assert.ok(!args.skip_positions?.some(p => p.x === 2));
    return f.execute(name, args, signal);
  };
  f.job.start(); await f.job.promise;
  assert.equal(f.job.state().status, 'complete');
  assert.deepEqual(f.job.state().excluded.oak_log, []);
});

test('successful clearance cancels stale pickup when the tracked drops are already gone', async () => {
  const f=fixture();let first=true,cleared=false,pickups=0;
  f.job.observe=async()=>({wood:'oak',tableInReach:f.counts().wooden_pickaxe>0,pickupClearance:!first&&!cleared?{x:2,y:64,z:0,expected_block:'stone'}:null});
  f.job.execute=async(name,args,signal)=>{
    if(name==='collect'&&first){first=false;return{mined:1,completed:false,remaining_drops:[{id:2}]};}
    if(name==='dig_at'){cleared=true;return{mined:1,remaining_drops:[]};}
    if(name==='pickup'){pickups++;throw Error('Stale recovery must not chase unrelated litter');}
    return f.execute(name,args,signal);
  };
  f.job.start();await f.job.promise;assert.equal(f.job.state().status,'complete');assert.equal(pickups,0);assert.equal(cleared,true);
});

test('low air blocks new starter work and immediately interrupts an active action', async () => {
  const f=fixture();f.state.oxygen=8;
  assert.match(nextStarterStep(f.state,{home:{position:f.state.position,dimension:'overworld'}}).blocked,/Air is low/);
  f.state.oxygen=20;
  let began;const started=new Promise(resolve=>{began=resolve});
  f.job.execute=async(name,args,signal)=>{began();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();};
  f.job.start();await started;f.state.oxygen=10;f.job.checkAir();await f.job.promise;
  assert.equal(f.job.state().status,'paused');assert.match(f.job.state().reason,/world keeps running/);
});

test('another entity air update cannot pause the starter or mask its own low air', async () => {
  const {ownOxygenLevel}=await import('../src/oxygen.js');const f=fixture();
  const bot={registry:{entitiesByName:{player:{metadataKeys:['flags','air_supply']}}},entity:{name:'player',metadata:{1:300}},oxygenLevel:20};
  f.job.snapshot=()=>({...structuredClone(f.state),oxygen:ownOxygenLevel(bot)});
  let began;const started=new Promise(resolve=>{began=resolve});
  f.job.execute=async(name,args,signal)=>{began();await new Promise(resolve=>signal.addEventListener('abort',resolve,{once:true}));signal.throwIfAborted();};
  f.job.start();await started;
  bot.oxygenLevel=0;f.job.checkAir();assert.equal(f.job.active.signal.aborted,false);
  bot.entity.metadata[1]=60;bot.oxygenLevel=20;f.job.checkAir();await f.job.promise;
  assert.equal(f.job.state().status,'paused');assert.match(f.job.state().reason,/Air is low/);
});

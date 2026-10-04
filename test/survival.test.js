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
  assert.equal(f.calls.length, 24); assert.ok(f.calls.every(c => c.name === 'explore' && c.args.returnable));
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
    blockAt: p => ({ name: p.equals(new Vec3(4,64,0)) ? 'oak_log' : p.equals(new Vec3(2,65,0)) ? 'oak_leaves' : 'air', position: p }),
    world: { raycast: (eye, direction, distance) => { assert.ok(Math.abs(direction.norm() - 1) < 0.001); assert.ok(distance <= 4.2); return { name: 'oak_leaves', position: new Vec3(2, 65, 0) }; } }, quit: () => {}
  };
  try { assert.deepEqual(await runtime.survival.observe(), { powderSnowContact: false, wood: 'oak', foliage: { x: 2, y: 65, z: 0, expected_block: 'oak_leaves' }, pickupClearance: null, tables: [], tableInReach: false }); }
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
 runtime.bot={registry:{blocksArray:[{id:1,name:'oak_log'}]},entity:{position:new Vec3(0.5,64,0.5)},findBlocks:({maxDistance,useExtraInfo})=>{assert.equal(maxDistance,108);assert.equal(useExtraInfo({name:'oak_log',position:p}),true);assert.equal(useExtraInfo({name:'oak_log',position:new Vec3(49,64,0)}),false);return[p];},blockAt:q=>({name:'oak_log',position:q}),quit:()=>{}};
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

test('repeated blocked crafting executes its scouting recovery instead of spinning to the step cap', async () => {
  const f=fixture();let scouted=false,craftFailures=0;
  f.job.execute=async(name,args,signal)=>{
    if(name==='craft'&&args.item==='wooden_pickaxe'&&!scouted){craftFailures++;throw Error('Target block remains out of reach or behind an obstruction');}
    if(name==='explore')scouted=true;
    return f.execute(name,args,signal);
  };
  f.job.start();await f.job.promise;
  assert.equal(scouted,true);assert.equal(craftFailures,2);assert.equal(f.job.state().status,'complete');
  assert.equal(f.calls.filter(call=>call.name==='explore').length,1);
});

test('starter distinguishes a nearby obstructed table from a visible usable table', async () => {
  const {Runtime}=await import('../src/runtime.js');const {loadConfig}=await import('../src/config.js');const {Vec3}=await import('vec3');const {mkdtemp,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'brobot-table-visibility-'));const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:dir}));const position=new Vec3(2,64,0);
  runtime.execute=async()=>({position:{x:.5,y:64,z:.5},nearby_blocks:[]});
  runtime.bot={registry:{blocksArray:[{id:2,name:'crafting_table'}]},entity:{position:new Vec3(.5,64,.5)},findBlocks:({matching})=>matching.includes(2)?[position]:[],blockAt:p=>({name:'crafting_table',position:p}),world:{raycast:()=>({position:new Vec3(1,64,0)})},quit:()=>{}};
  try {
    const blocked=await runtime.survival.observe();assert.equal(blocked.tableInReach,false);assert.equal(blocked.tables.length,1);
    runtime.bot.world.raycast=()=>({position});assert.equal((await runtime.survival.observe()).tableInReach,true);
  } finally {await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('capitalized owner pronouns resolve locally without changing literal player names', () => {
 assert.deepEqual(parseCommand('Follow Me','Player'),{kind:'follow',player:'Player'});
 assert.deepEqual(parseCommand('Come Here','Player'),{kind:'come',player:'Player'});
 assert.deepEqual(parseCommand('follow MixedCaseName','Player'),{kind:'follow',player:'MixedCaseName'});
});

test('same-session resume recovers scoped drops after an inter-step pause and keeps its reason', async () => {
 const f=fixture({intervalMs:30});let harvested=false;
 f.job.observe=async()=>harvested?{}:{wood:'oak'};
 f.job.execute=async(name,args)=>{
  f.calls.push({name,args});
  if(name==='collect'&&!harvested){harvested=true;setImmediate(()=>f.job.stop('User stop'));return{mined:3,remaining_drops:[{id:42}]};}
  if(name==='pickup'){setImmediate(()=>f.job.stop('Recovery checked'));return{remaining_drops:[]};}
  return{};
 };
 f.job.start();await f.job.promise;
 assert.equal(f.job.state().status,'paused');assert.equal(f.job.state().reason,'User stop');assert.deepEqual(f.job.state().recoverDropIds,[42]);
 f.calls.length=0;f.job.start({resume:true});await f.job.promise;
 assert.equal(f.calls[0].name,'pickup');assert.deepEqual(f.calls[0].args.entity_ids,[42]);assert.equal(f.job.state().reason,'Recovery checked');
});

test('resume discards entity IDs after a new play session or process restoration', async () => {
 let session=1;const f=fixture({intervalMs:30,session:()=>session});
 f.job.execute=async()=>{setImmediate(()=>f.job.stop('Pause'));return{remaining_drops:[{id:42}]};};
 f.job.start();await f.job.promise;assert.deepEqual(f.job.state().recoverDropIds,[42]);
 session++;f.calls.length=0;
 f.job.execute=async(name,args)=>{f.calls.push({name,args});setImmediate(()=>f.job.stop('Checked'));return{};};
 f.job.start({resume:true});await f.job.promise;assert.notEqual(f.calls[0].name,'pickup');assert.deepEqual(f.job.state().recoverDropIds,[]);
 f.data.survivalJob.recoverDropIds=[42];
 const restored=new SurvivalJob({memory:f.memory,snapshot:()=>structuredClone(f.state),observe:async()=>({wood:'oak'}),execute:f.job.execute,stopActions:()=>{},context:'test',session:()=>session,intervalMs:30});
 f.calls.length=0;restored.execute=async(name,args)=>{f.calls.push({name,args});setImmediate(()=>restored.stop('Checked'));return{};};
 restored.start({resume:true});await restored.promise;assert.notEqual(f.calls[0].name,'pickup');assert.deepEqual(restored.state().recoverDropIds,[]);
});

test('low air during the inter-step sleep keeps the above-water safety instruction', async () => {
 const f=fixture({intervalMs:30});f.job.execute=async()=>{setImmediate(()=>{f.state.oxygen=8;f.job.checkAir();});return{};};
 f.job.start();await f.job.promise;assert.equal(f.job.state().status,'paused');assert.match(f.job.state().reason,/Bring BroBot above water/);
});

test('tree observation sorts a bounded wider sample before selecting its sixteen local logs',async()=>{
  const {Runtime}=await import('../src/runtime.js'),{loadConfig}=await import('../src/config.js'),{Vec3}=await import('vec3');
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'brobot-tree-sample-')),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:dir,OPENAI_API_KEY:''}));
  const near=new Vec3(2,64,0),far=Array.from({length:16},(_,i)=>new Vec3(20+i,64,0));
  runtime.execute=async()=>({position:{x:.5,y:64,z:.5},nearby_blocks:[]});
  runtime.bot={registry:{blocksArray:[{id:1,name:'oak_log'},{id:2,name:'birch_log'}]},entity:{position:new Vec3(.5,64,.5)},findBlocks:options=>{assert.equal(options.count,128);assert.equal(options.maxDistance,108);return [...far,near];},blockAt:p=>({name:p.equals(near)?'birch_log':'oak_log',position:p}),world:{raycast:()=>null},quit(){}};
  try{assert.equal((await runtime.survival.observe()).wood,'birch');}finally{await runtime.close();await rm(dir,{recursive:true,force:true});}
});

test('scout recovery records actual attempted alternatives and partial observation positions', async () => {
  const f=fixture({maxSteps:2}); f.job.observe=async()=>({});
  f.job.execute=async(name,args)=>{
    assert.equal(name,'explore');const tried=[args.direction,args.alternatives[0]];
    f.state.position.x+=3;
    throw Object.assign(Error('Partial walk failed'),{result:{directions_tried:tried}});
  };
  f.job.start();await f.job.promise;
  const saved=f.job.state();assert.equal(saved.scouts,2);assert.equal(saved.scoutAttempts.length,4);
  assert.deepEqual(saved.scoutAttempts[0].origin,{x:0.5,y:64,z:0.5});
  assert.deepEqual(saved.scoutAttempts[2].origin,{x:3.5,y:64,z:0.5});
  assert.ok(saved.observedPositions.some(p=>p.x===3.5));
  assert.ok(saved.observedPositions.every(p=>p.x===0.5||p.x===3.5));
});
test('cancelled scout retains actual probe evidence without counting desired targets as visited', async () => {
  const f=fixture();f.job.observe=async()=>({});
  f.job.execute=async(name,args)=>{
    const directions_tried=[args.direction,args.alternatives[0]];
    f.job.stop('Player cancelled');throw Object.assign(Error('Action cancelled'),{name:'AbortError',result:{directions_tried}});
  };
  f.job.start();await f.job.promise;const s=f.job.state();
  assert.equal(s.status,'paused');assert.equal(s.scouts,1);assert.equal(s.scoutAttempts.length,2);
  assert.deepEqual(s.observedPositions,[{x:0.5,y:64,z:0.5}]);
});
test('expanded starter allows work beyond90 but blocks beyond262', () => {
  const f=fixture(),job={home:{position:{x:0,y:64,z:0},dimension:'overworld'}};
  f.state.position.x=200;assert.ok(!nextStarterStep(f.state,job,{}).blocked);
  f.state.position.x=263;assert.match(nextStarterStep(f.state,job,{}).blocked,/262-block/);
});
test('far starter home return follows observed short legs without claiming early completion', () => {
  const f=fixture();f.add('stone_pickaxe',1);f.add('furnace',1);
  const job={home:{position:{x:0.5,y:64,z:0.5},dimension:'overworld'},observedPositions:[0.5,70.5,140.5,210.5].map(x=>({x,y:64,z:0.5}))};
  f.state.position.x=230.5;
  for(const x of [140,70,0]){
    const step=nextStarterStep(f.state,job,{});assert.equal(step.name,'go_to');assert.equal(step.args.x,x);assert.equal(step.args.returnable,true);
    assert.ok(Math.abs(step.args.x-f.state.position.x)<97);f.state.position.x=x+0.5;
  }
  assert.equal(nextStarterStep(f.state,job,{}).complete,true);
});
test('far return never invents an unobserved midpoint or claims a completed kit at distance', () => {
  const f=fixture();f.add('stone_pickaxe',1);f.add('furnace',1);f.state.position.x=230;
  const step=nextStarterStep(f.state,{home:{position:{x:0,y:64,z:0},dimension:'overworld'}},{});
  assert.match(step.blocked,/No observed intermediate waypoint/);assert.ok(!step.complete);
});
test('far table travel keeps actual table identity while choosing a local observed hop', () => {
  const f=fixture();f.state.position.x=230;
  const table={x:0,y:64,z:0},job={home:{position:table,dimension:'overworld'},tables:[table],observedPositions:[{x:150,y:64,z:0},{x:70,y:64,z:0}]};
  const step=nextStarterStep(f.state,job,{});
  assert.equal(step.name,'go_to');assert.equal(step.args.x,150);assert.equal(step.args.returnable,true);
  assert.deepEqual(step.waypointTarget,table);
});
test('unloaded remembered table survives observations but never counts as reachable until loaded', async () => {
  const {Runtime}=await import('../src/runtime.js'),{loadConfig}=await import('../src/config.js'),{Vec3}=await import('vec3');
  const {mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
  const dir=await mkdtemp(join(tmpdir(),'brobot-unloaded-table-')),r=new Runtime(loadConfig({BROBOT_DATA_DIR:dir}));
  const table={x:2,y:64,z:0};let block=null;
  r.survival.job={tables:[table]};r.execute=async()=>({position:{x:0,y:64,z:0},nearby_blocks:[]});
  r.bot={registry:{blocksArray:[{name:'crafting_table',id:1}]},entity:{position:new Vec3(0,64,0)},findBlocks:()=>[],blockAt:()=>block,canSeeBlock:()=>true,quit:()=>{}};
  try{
    let o=await r.survival.observe();assert.deepEqual(o.tables,[table]);assert.equal(o.tableInReach,false);
    block={name:'air'};o=await r.survival.observe();assert.equal(o.tables.length,0);
    block={name:'crafting_table'};o=await r.survival.observe();assert.equal(o.tableInReach,true);
  }finally{await r.close();await rm(dir,{recursive:true,force:true})}
});
test('expanded return can retrace a U-shaped observed trail away from home first', () => {
  const f=fixture();f.add('stone_pickaxe',1);f.add('furnace',1);f.state.position={x:160,y:64,z:0};
  const observedPositions=[[0,0],[0,64],[0,128],[64,128],[128,128],[176,96],[176,48],[160,0]].map(([x,z])=>({x,y:64,z}));
  const job={home:{position:{x:0,y:64,z:0},dimension:'overworld'},observedPositions};
  for(let i=0;i<12;i++){
    const step=nextStarterStep(f.state,job,{});if(step.complete)return;
    assert.equal(step.name,'go_to');assert.equal(step.args.returnable,true);
    assert.ok(Math.hypot(f.state.position.x-step.args.x,f.state.position.z-step.args.z)<=96);
    f.state.position={x:step.args.x,y:step.args.y,z:step.args.z};
  }
  assert.fail('Observed return chain did not converge');
});
test('a rejected shortcut uses an alternative observed edge rather than repeating it', () => {
  const f=fixture();f.add('stone_pickaxe',1);f.add('furnace',1);f.state.position={x:150,y:64,z:0};
  const job={home:{position:{x:0,y:64,z:0},dimension:'overworld'},observedPositions:[{x:80,y:64,z:0},{x:140,y:64,z:60},{x:70,y:64,z:60}],ignoredTravelEdges:[{from:f.state.position,to:{x:80,y:64,z:0}}]};
  const step=nextStarterStep(f.state,job,{});assert.equal(step.name,'go_to');assert.notEqual(step.args.z,0);
});
test('a remembered table without a candidate breadcrumb route does not block local rebuilding', () => {
  const f=fixture();f.state.position.x=200;
  const job={home:{position:{x:0,y:64,z:0},dimension:'overworld'},tables:[{x:0,y:64,z:0}]};
  const step=nextStarterStep(f.state,job,{wood:'oak'});
  assert.equal(step.name,'collect');assert.equal(step.args.block,'oak_log');
});
test('two failed shortcut executions persist an edge exclusion and return by another observed chain', async () => {
  const f=fixture({maxSteps:12});f.add('stone_pickaxe',1);f.add('furnace',1);
  let failures=0;
  f.job.execute=async(name,args,signal)=>{
    if(name==='go_to'&&args.x===80&&args.z===0&&Math.hypot(f.state.position.x-150,f.state.position.z)<2){f.calls.push({name,args});failures++;throw Error('No verified returnable walking route (noPath)');}
    return f.execute(name,args,signal);
  };
  f.job.start();f.state.position={x:150,y:64,z:0};
  f.job.job.observedPositions=[{x:80,y:64,z:0},{x:140,y:64,z:60},{x:70,y:64,z:60}];
  await f.job.promise;
  assert.equal(failures,2);assert.equal(f.job.state().ignoredTravelEdges.length,1);
  assert.equal(f.calls[2].args.z,60);assert.equal(f.job.state().status,'complete');
});

test('starter refuses gathering or completion while already touching powder snow', () => {
  const state={connected:true,dimension:'overworld',health:20,food:20,position:{x:0,y:64,z:0},inventory:[],entities:[]};
  const job={home:{position:state.position,dimension:'overworld'}};
  for (const inventory of [[],[{name:'stone_pickaxe',count:1},{name:'furnace',count:1}]]) {
    const result=nextStarterStep({...state,inventory},job,{wood:'spruce',powderSnowContact:true});
    assert.match(result.blocked,/freezing continues/);assert.equal(result.name,undefined);assert.equal(result.complete,undefined);
  }
});

test('starter requests only missing wood after crafting some prerequisites', () => {
  const state={connected:true,dimension:'overworld',health:20,food:20,position:{x:0,y:64,z:0},entities:[],inventory:[{name:'crafting_table',count:1},{name:'stick',count:4},{name:'spruce_planks',count:2}]};
  const job={home:{position:state.position,dimension:'overworld'}};
  const step=nextStarterStep(state,job,{wood:'spruce'});
  assert.equal(step.name,'collect');assert.equal(step.args.count,1);
  const placed=nextStarterStep({...state,inventory:state.inventory.filter(i=>i.name!=='crafting_table')},job,{wood:'spruce',tableInReach:true});
  assert.equal(placed.name,'collect');assert.equal(placed.args.count,1);
});

test('starter wood deficit retains missing table and stick requirements', () => {
  const state={connected:true,dimension:'overworld',health:20,food:20,position:{x:0,y:64,z:0},entities:[],inventory:[{name:'spruce_planks',count:1}]};
  const job={home:{position:state.position,dimension:'overworld'}};
  const step=nextStarterStep(state,job,{wood:'spruce'});
  assert.equal(step.name,'collect');assert.equal(step.args.count,2);
  assert.equal(nextStarterStep({...state,inventory:[]},job,{wood:'spruce'}).args.count,3);
});

test('unverified whole scout sweeps back off locally and a shorter successful move grows distance gradually', async () => {
  const f=fixture({maxSteps:4}),distances=[];f.job.observe=async()=>({});
  f.job.execute=async(name,args)=>{
    assert.equal(name,'explore');assert.equal(args.returnable,true);distances.push(args.distance);
    const directions_tried=[args.direction,...args.alternatives];
    if(args.distance>6)throw Object.assign(Error('Routes unverified'),{result:{directions_tried,route_attempts:directions_tried.map(direction=>({direction,status:'unverified'}))}});
    f.state.position.x+=6;
    return {explored:true,distance:6,directions_tried:[args.direction],route_attempts:[{direction:args.direction,status:'verified'}]};
  };
  f.job.start();await f.job.promise;
  assert.deepEqual(distances,[12,6,10,5]);
  assert.equal(f.job.state().scouts,4);assert.equal(f.job.state().status,'blocked');
});
test('incomplete or cancelled planning sweeps never shrink subsequent scout legs', async () => {
  for(const status of ['unverified','cancelled','verified']){
    const f=fixture({maxSteps:3}),distances=[];f.job.observe=async()=>({});
    f.job.execute=async(name,args)=>{
      distances.push(args.distance);
      throw Object.assign(Error('Incomplete probe'),{result:{directions_tried:[args.direction],route_attempts:[{direction:args.direction,status}]}});
    };
    f.job.start();await f.job.promise;
    assert.deepEqual(distances,[12,12,24]);assert.ok(f.job.state().scoutAttempts.every(a=>!a.exhausted));
  }
});

test('a boundary-constrained single-direction sweep can trigger local backoff', async () => {
  const f=fixture({maxSteps:2}),distances=[];f.job.observe=async()=>({});
  f.job.execute=async(name,args)=>{
    distances.push(args.distance);const directions_tried=[args.direction,...args.alternatives];
    if(distances.length===1)assert.deepEqual(directions_tried,['west']);
    throw Object.assign(Error('No route'),{result:{directions_tried,route_attempts:[null,...directions_tried.map(direction=>({direction,status:'unverified'}))]}});
  };
  // The controller's first observation occurs after home is established.
  f.job.observe=async()=>{f.state.position.x=256.4;return {}};
  f.job.start();await f.job.promise;
  assert.deepEqual(distances,[12,6]);
});

test('scout continuity records actual completed endpoints and distinguishes revisits', async () => {
  const f=fixture({maxSteps:2});f.job.observe=async()=>({});
  f.job.execute=async(name,args)=>{
    assert.equal(name,'explore');f.state.position.x=f.state.position.x===0.5?12.5:0.5;
    return {explored:true,distance:12};
  };
  f.job.start();await f.job.promise;
  assert.deepEqual(f.job.state().lastScoutSuccess.endpoint,{x:0.5,y:64,z:0.5});
  assert.equal(f.job.state().lastScoutSuccess.novel,false);
});
test('a claimed scout or a verified route without actual displacement cannot establish continuity', async () => {
  const f=fixture({maxSteps:1});f.job.observe=async()=>({});
  f.job.execute=async()=>({explored:true,distance:12,route_attempts:[{direction:'north',status:'verified'}]});
  f.job.start();await f.job.promise;assert.equal(f.job.state().lastScoutSuccess,undefined);
});

test('uninterrupted successful scouting preserves the original distance schedule', async () => {
  const f=fixture({maxSteps:6}),distances=[];f.job.observe=async()=>({});
  f.job.execute=async(name,args)=>{
    distances.push(args.distance);f.state.position.x+=args.distance;
    return {explored:true,distance:args.distance};
  };
  f.job.start();await f.job.promise;
  assert.deepEqual(distances,[12,12,24,24,36,36]);
  assert.equal(f.job.state().lastScoutSuccess.adaptive,false);
});


test('finished kit cancels a queued scouting recovery and returns home', async () => {
  const f = fixture(); let observations = 0; const executed = [];
  f.job.observe = async () => {
    observations++;
    if (observations === 4) { f.add('stone_pickaxe', 1); f.add('furnace', 1); }
    return { wood: 'oak' };
  };
  f.job.execute = async (name, args) => {
    executed.push(name);
    if (name === 'collect') { f.state.position.x = 10.5; throw Error('Blocked route'); }
    return f.execute(name, args);
  };
  f.job.start(); await f.job.promise;
  assert.deepEqual(executed, ['collect', 'collect', 'go_to']);
  assert.equal(f.job.state().status, 'complete');
  assert.equal(f.job.state().scouts, 0);
});

test('finished kit cancels queued leaf clearance without digging', async () => {
  const f = fixture(); let observations = 0; const executed = [];
  f.job.observe = async () => {
    observations++;
    if (observations === 4) { f.add('stone_pickaxe', 1); f.add('furnace', 1); }
    return { wood: 'oak', foliage: { x: 11, y: 65, z: 0, expected_block: 'oak_leaves' } };
  };
  f.job.execute = async (name, args) => {
    executed.push(name);
    if (name === 'collect') { f.state.position.x = 10.5; throw Error('Blocked route'); }
    return f.execute(name, args);
  };
  f.job.start(); await f.job.promise;
  assert.deepEqual(executed, ['collect', 'collect', 'go_to']);
  assert.equal(f.job.state().status, 'complete');
});


test('urgent food recovery outranks a queued scouting recovery', async () => {
  const f = fixture({maxSteps: 3}); let observations = 0; const executed = [];
  f.job.observe = async () => {
    if (++observations === 4) { f.state.food = 8; f.add('bread', 1); }
    return { wood: 'oak' };
  };
  f.job.execute = async (name, args) => {
    executed.push(name);
    if (name === 'collect') throw Error('Blocked route');
    return f.execute(name, args);
  };
  f.job.start(); await f.job.promise;
  assert.deepEqual(executed, ['collect', 'collect', 'eat']);
  assert.equal(f.state.food, 20);
  assert.equal(f.job.state().scouts, 0);
  assert.notEqual(f.job.state().status, 'complete');
});

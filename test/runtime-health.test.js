import test from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../src/runtime.js';

function fixture(health, { starter = true, action = 'collect', aborted = false } = {}) {
  const stops = [];
  const runtime = Object.create(Runtime.prototype);
  runtime.bot = { health, food: 20, inventory: { items: () => [] } };
  runtime.connection = 'connected'; runtime.closed = false;
  runtime.survival = { active: starter };
  const controller = new AbortController(); if (aborted) controller.abort();
  runtime.runner = { active: action ? { name: action, controller } : null };
  runtime.stop = reason => { stops.push(reason); controller.abort(); };
  return { runtime, stops };
}

test('starter interrupts ongoing gathering at the recorded 6.783 health, before its action finishes', () => {
  const { runtime, stops } = fixture(6.783);
  runtime.reflex();
  assert.equal(stops.length, 1);
  assert.match(stops[0], /health/i);
  assert.equal(runtime.runner.active.controller.signal.aborted, true);
});
test('starter health boundary matches the between-action guard', () => {
  for (const [health, expected] of [[8,1],[8.001,0],[20,0]]) {
    const { runtime, stops } = fixture(health); runtime.reflex(); assert.equal(stops.length, expected);
  }
});
test('direct control keeps its existing health boundary and eating can finish', () => {
  for (const [health, options, expected] of [[7,{starter:false},0],[6,{starter:false},1],[6,{action:'eat'},0],[6,{aborted:true},0],[6,{action:null},0]]) {
    const {runtime,stops}=fixture(health,options);runtime.reflex();assert.equal(stops.length,expected);
  }
});

test('health events stop an active starter action immediately and stale connections cannot stop new work', async () => {
  const { EventEmitter } = await import('node:events');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { default: mineflayer } = await import('mineflayer');
  const { default: minecraftData } = await import('minecraft-data');
  const { Vec3 } = await import('vec3');
  const { loadConfig } = await import('../src/config.js');
  const directory = await mkdtemp(join(tmpdir(), 'brobot-health-'));
  const runtime = new Runtime(loadConfig({ BROBOT_DATA_DIR: directory }));
  const bot = Object.assign(new EventEmitter(), { health: 20, food: 20, registry: minecraftData('1.21.8'),
    entity: { position: new Vec3(.5,64,.5) }, loadPlugin() {}, quit() {}, inventory: { items: () => [] } });
  const create = mineflayer.createBot; mineflayer.createBot = () => bot;
  let stops = 0; const oldStop = runtime.stop;
  try {
    runtime.connect(); runtime.connection = 'connected';
    runtime.survival.active = { controller: new AbortController() };
    runtime.runner.active = { name: 'collect', controller: new AbortController(), cleanup() {} };
    runtime.stop = () => { stops++; runtime.runner.active.controller.abort(); };
    bot.health = 7.5; bot.emit('health'); assert.equal(stops,1);
    bot.emit('health'); assert.equal(stops,1, 'already stopping must not repeat');
    runtime.runner.active = { name:'collect',controller:new AbortController(),cleanup(){} };
    runtime.bot = {...bot, health:20, quit(){}};
    bot.health = 1; bot.emit('health'); assert.equal(stops,1,'ignore retired connection');
  } finally {
    mineflayer.createBot = create; runtime.runner.active = null; runtime.survival.active = null;
    runtime.stop = oldStop; await runtime.close(); await rm(directory,{recursive:true,force:true});
  }
});

test('lethal health updates leave cancellation reason to the death handler', () => {
  for (const health of [0,-1]) {
    const {runtime,stops}=fixture(health);runtime.checkHealth();assert.equal(stops.length,0);
    assert.equal(runtime.runner.active.controller.signal.aborted,false);
  }
});

test('an observed hostile hit interrupts starter collection before a low-health packet',()=>{
 const {runtime,stops}=fixture(20);
 runtime.checkHostileHurt({id:175,name:'zombie',type:'hostile'});
 assert.equal(stops.length,1);assert.match(stops[0],/Hostile attack.*world keeps running/);
 assert.equal(runtime.runner.active.controller.signal.aborted,true);
 runtime.checkHostileHurt({type:'hostile'});assert.equal(stops.length,1);
});
test('hostile-hit interruption is scoped and never guesses an unavailable source',()=>{
 for(const [options,source,health] of [[{starter:false},{type:'hostile'},20],[{action:'eat'},{type:'hostile'},20],[{action:null},{type:'hostile'},20],[{aborted:true},{type:'hostile'},20],[{},null,10],[{},{name:'zombie'},10],[{},{type:'player'},10],[{},{type:'hostile'},0]]){
  const {runtime,stops}=fixture(health,options);runtime.checkHostileHurt(source);assert.equal(stops.length,0);
 }
});

test('real runtime wiring reacts to observed attackers and ignores retired connections', async()=>{
 const {EventEmitter}=await import('node:events'),{mkdtemp,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path');
 const {default:mineflayer}=await import('mineflayer'),{default:minecraftData}=await import('minecraft-data'),{Vec3}=await import('vec3'),{loadConfig}=await import('../src/config.js');
 const directory=await mkdtemp(join(tmpdir(),'brobot-hostile-')),runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory}));
 const bot=Object.assign(new EventEmitter(),{health:20,food:20,registry:minecraftData('1.21.8'),entity:{id:7,position:new Vec3(.5,64,.5)},loadPlugin(){},quit(){},inventory:{items:()=>[]}});
 const create=mineflayer.createBot;mineflayer.createBot=()=>bot;const oldStop=runtime.stop;let stops=0;
 try{
  runtime.connect();runtime.connection='connected';runtime.survival.active=new AbortController();
  runtime.runner.active={name:'collect',controller:new AbortController(),cleanup(){}};
  runtime.stop=()=>{stops++;runtime.runner.active.controller.abort()};
  bot.emit('entityHurt',{id:8},{name:'zombie',type:'hostile'});assert.equal(stops,0);
  for(const source of [{id:175,name:'zombie',type:'hostile'},{id:681,name:'polar_bear',type:'animal'}]){
    runtime.runner.active={name:'collect',controller:new AbortController(),cleanup(){}};
    bot.emit('entityHurt',bot.entity,source);assert.equal(bot.health,20);
  }
  assert.equal(stops,2);
  runtime.runner.active={name:'collect',controller:new AbortController(),cleanup(){}};
  runtime.bot={...bot,quit(){}};bot.emit('entityHurt',bot.entity,{id:681,name:'polar_bear',type:'animal'});assert.equal(stops,2);
 }finally{
  mineflayer.createBot=create;runtime.runner.active=null;runtime.survival.active=null;runtime.stop=oldStop;await runtime.close();await rm(directory,{recursive:true,force:true});
 }
});

test('explicit polar bear attack pauses starter work before a low-health packet without zombie recovery',()=>{
 const {runtime,stops}=fixture(20);let recovery=0
 runtime.survival.requestHostileRecovery=()=>{recovery++;return true}
 runtime.checkHostileHurt({id:681,name:'polar_bear',type:'animal'})
 assert.equal(stops.length,1);assert.match(stops[0],/polar_bear.*no supported automatic retreat.*world keeps running/)
 assert.equal(runtime.runner.active.controller.signal.aborted,true);assert.equal(recovery,0)
})
test('observed animal interruption preserves manual, eating, inactive and cancelled scopes',()=>{
 for(const options of [{starter:false},{action:'eat'},{aborted:true}]){
  const {runtime,stops}=fixture(20,options)
  runtime.checkHostileHurt({id:681,name:'polar_bear',type:'animal'});assert.equal(stops.length,0)
 }
})
test('animal interruption requires an identified observed source and never guesses from proximity',()=>{
 for(const source of [null,{name:'polar_bear'},{type:'animal',name:'polar_bear'},{type:'animal',id:-1,name:'polar_bear'},{type:'animal',id:2},{type:'animal',id:2,name:''},{type:'player',id:2,name:'polar_bear'}]){
  const {runtime,stops}=fixture(20);runtime.checkHostileHurt(source);assert.equal(stops.length,0)
 }
})

test('animal guard rejects dead or retired runtimes and malformed IDs but handles other observed animals',()=>{
 for(const state of ['dead','disconnected','closed','fractional','nonfinite']){
  const {runtime,stops}=fixture(state==='dead'?0:20)
  if(state==='disconnected')runtime.connection='disconnected'
  if(state==='closed')runtime.closed=true
  const id=state==='fractional'?1.5:state==='nonfinite'?NaN:681
  runtime.checkHostileHurt({id,name:'polar_bear',type:'animal'});assert.equal(stops.length,0,state)
 }
 const {runtime,stops}=fixture(20)
 runtime.checkHostileHurt({id:22,name:'wolf',type:'animal'})
 assert.equal(stops.length,1);assert.match(stops[0],/Observed wolf attack/)
})

test('observed attacks between starter actions abort the parent before more work starts',()=>{
 for(const source of [{id:681,name:'polar_bear',type:'animal'},{id:175,name:'zombie',type:'hostile'}]){
  const {runtime,stops}=fixture(20,{action:null});const parent=new AbortController();runtime.survival.active=parent
  runtime.stop=reason=>{stops.push(reason);parent.abort(Error(reason))}
  runtime.checkHostileHurt(source)
  assert.equal(parent.signal.aborted,true);assert.equal(stops.length,1)
  assert.match(stops[0],/between starter actions/)
  runtime.checkHostileHurt(source);assert.equal(stops.length,1)
 }
})
test('idle attack guard leaves absent, stopped and unidentified jobs alone',()=>{
 for(const options of [{starter:false,action:null},{action:null}]){
  const {runtime,stops}=fixture(20,options)
  runtime.checkHostileHurt({type:'hostile'})
  assert.equal(stops.length,0)
 }
 const {runtime,stops}=fixture(20,{action:null});const parent=new AbortController();parent.abort();runtime.survival.active=parent
 runtime.checkHostileHurt({id:1,name:'polar_bear',type:'animal'});assert.equal(stops.length,0)
})

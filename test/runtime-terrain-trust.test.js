import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import mineflayer from 'mineflayer';
import minecraftData from 'minecraft-data';
import { Vec3 } from 'vec3';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { quarantineTerrain } from '../src/terrain-trust.js';
import { createProgression } from '../src/progression.js';

function fakeBot() {
  return Object.assign(new EventEmitter(), { health:20, food:20, players:{}, registry:minecraftData('1.21.8'),
    entity:{ position:new Vec3(.5,64,.5) }, game:{ dimension:'overworld' },loadPlugin(){},quit(){},clearControlStates(){},stopDigging(){}, inventory:{items:()=>[]} });
}

test('quarantine synchronously pauses runtime work and cannot be reset by spawn', async () => {
  const directory=await mkdtemp(join(tmpdir(),'brobot-trust-'));
  const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory})),bot=fakeBot();
  const create=mineflayer.createBot;mineflayer.createBot=()=>bot;
  try {
    runtime.connect();runtime.connection='connected';
    const controller=new AbortController();runtime.runner.active={name:'collect',controller,cleanup(){}};
    let brainStopped=0,starterStopped=0;
    runtime.brain.stop=()=>{brainStopped++;};runtime.survival.stop=()=>{starterStopped++;};
    quarantineTerrain(bot,'missing receipt');
    assert.equal(runtime.connection,'quarantined');assert.equal(controller.signal.aborted,true);
    assert.ok(brainStopped>0);assert.ok(starterStopped>0);
    assert.equal(runtime.snapshot().connected,false);assert.equal(runtime.snapshot().terrainTrust.trusted,false);
    await assert.rejects(runtime.execute('inspect',{}),{code:'TERRAIN_UNTRUSTED'});
    bot.emit('spawn');assert.equal(runtime.connection,'quarantined');
    const before=runtime.lastEat;runtime.reflex();assert.equal(runtime.lastEat,before);
    bot.emit('end','closed');assert.equal(runtime.runner.active,null);assert.equal(runtime.bot,null);
  } finally { mineflayer.createBot=create;runtime.runner.active=null;await runtime.close();await rm(directory,{recursive:true,force:true}); }
});

test('old bot quarantine cannot stop a replacement runtime connection', async () => {
  const directory=await mkdtemp(join(tmpdir(),'brobot-old-trust-'));
  const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory})),old=fakeBot(),fresh=fakeBot();
  const create=mineflayer.createBot;mineflayer.createBot=()=>old;
  try {
    runtime.connect();runtime.bot=fresh;runtime.connection='connected';
    let stops=0;runtime.brain.stop=()=>{stops++;};runtime.survival.stop=()=>{stops++;};
    quarantineTerrain(old,'old receipt');
    assert.equal(stops,0);assert.equal(runtime.connection,'connected');assert.equal(runtime.bot,fresh);
  } finally { mineflayer.createBot=create;await runtime.close();await rm(directory,{recursive:true,force:true}); }
});

test('starter refuses to combine an earlier inspect with a replacement connection', async () => {
  const directory=await mkdtemp(join(tmpdir(),'brobot-observe-trust-'));
  const runtime=new Runtime(loadConfig({BROBOT_DATA_DIR:directory}));
  runtime.bot=fakeBot();let finish;
  runtime.execute=()=>new Promise(resolve=>{finish=resolve;});
  try {
    const observation=runtime.survival.observe();runtime.bot=fakeBot();finish({position:{x:0,y:64,z:0}});
    await assert.rejects(observation,/connection changed/);
  } finally { await runtime.close();await rm(directory,{recursive:true,force:true}); }
});

test('fresh progression facade on a quarantined bot cannot invoke raw actions', async () => {
  const bot=fakeBot();let calls=0;quarantineTerrain(bot,'missing receipt');
  const progression=createProgression(bot,{actions:{execute:()=>{calls++;},stop(){}},memory:null});
  await assert.rejects(progression.execute('shoot',{}),{code:'TERRAIN_UNTRUSTED'});
  assert.equal(calls,0);
});

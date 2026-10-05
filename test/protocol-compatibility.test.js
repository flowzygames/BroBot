import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {Vec3} from 'vec3';
import data from 'minecraft-data';
import protocol from 'minecraft-protocol';
import physicsPlugin from 'mineflayer/lib/plugins/physics.js';
import pluginLoader from 'mineflayer/lib/plugin_loader.js';
import {pinnedSprintCompatibility} from '../src/protocol-compatibility.js';
function fixture(version){
 const registry=data(version),packets=[];
 const bot=Object.assign(new EventEmitter(),{version,registry,supportFeature:n=>registry.supportFeature(n),_client:new EventEmitter(),entity:{id:21,position:new Vec3(0,64,0),velocity:new Vec3(0,0,0)}});
 const serializer=protocol.createSerializer({state:'play',isServer:false,version}),deserializer=protocol.createDeserializer({state:'play',isServer:true,version});
 bot._client.write=(name,params)=>packets.push(deserializer.parsePacketBuffer(serializer.createPacketBuffer({name,params})).data);
 return{bot,packets};
}
test('pinned native sprint numbers decode to riding jumps without compatibility',()=>{
 const {bot,packets}=fixture('1.21.8');physicsPlugin(bot,{physicsEnabled:false});bot.setControlState('sprint',true);bot.clearControlStates();
 assert.deepEqual(packets.map(p=>p.params.actionId),['start_riding_jump','stop_riding_jump']);
});
test('queued compatibility corrects actual physics sprint and clear-controls packets',()=>{
 const {bot,packets}=fixture('1.21.8'),original=bot.supportFeature;
 pluginLoader(bot,{physicsEnabled:false});bot.loadPlugin(physicsPlugin);bot.loadPlugin(pinnedSprintCompatibility);
 let observed;bot.loadPlugin(b=>{observed=b.supportFeature('entityActionUsesStringMapper')});bot.emit('inject_allowed');assert.equal(observed,true);
 const feature=bot.supportFeature;pinnedSprintCompatibility(bot);assert.equal(bot.supportFeature,feature);
 assert.equal(bot.supportFeature('newPlayerInputPacket'),original('newPlayerInputPacket'));
 bot.setControlState('sprint',true);bot.clearControlStates();assert.deepEqual(packets.map(p=>p.params.actionId),['start_sprinting','stop_sprinting']);
 bot.setControlState('sneak',true);bot.setControlState('sneak',false);
 assert.deepEqual(packets.slice(-2).map(p=>[p.name,p.params.inputs.shift]),[['player_input',true],['player_input',false]]);
});
test('older correctly mapped versions keep original feature support and packet meanings',()=>{
 const {bot,packets}=fixture('1.21.5'),original=bot.supportFeature;physicsPlugin(bot,{physicsEnabled:false});pinnedSprintCompatibility(bot);
 assert.equal(bot.supportFeature,original);bot.setControlState('sprint',true);bot.clearControlStates();
 assert.deepEqual(packets.map(p=>p.params.actionId),['start_sprinting','stop_sprinting']);
});
test('already-correct feature support is left untouched',()=>{
 const bot={version:'1.21.8',supportFeature:()=>true},original=bot.supportFeature;pinnedSprintCompatibility(bot);assert.equal(bot.supportFeature,original);
});

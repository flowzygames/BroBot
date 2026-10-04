import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeOwnInjuries } from '../src/injury-observer.js';
function fixture(){
 const bot=Object.assign(new EventEmitter(),{entity:{id:7,position:{x:1,y:64,z:2}},game:{dimension:'overworld'},health:20});
 const logs=[],order=[];let current=true;
 const observer=observeOwnInjuries(bot,{isCurrent:()=>current,log:(type,message,data)=>{order.push('log');logs.push({type,message,data})},action:()=> 'collect',onHealth:()=>order.push('guard')});
 return{bot,logs,order,observer,retire:()=>{current=false}};
}
test('own hurt observations retain a copied source including id zero without player usernames',()=>{
 const f=fixture(),source={id:0,name:'zombie',type:'hostile',username:'private-player'};
 f.bot.emit('entityHurt',{id:9},source);assert.equal(f.logs.length,0);
 f.bot.emit('entityHurt',f.bot.entity,source);source.name='changed';f.bot.entity.position.x=99;
 assert.equal(f.logs[0].data.source.id,0);assert.equal(f.logs[0].data.source.name,'zombie');assert.equal(f.logs[0].data.position.x,1);
 assert.equal(JSON.stringify(f.logs).includes('private-player'),false);
 const copy=f.observer.recent();copy[0].source.name='mutated';assert.equal(f.observer.recent()[0].source.name,'zombie');f.observer.dispose();
});
test('missing or unknown sources never imply no attacker or a guessed environmental cause',()=>{
 const f=fixture();f.bot.emit('entityHurt');assert.equal(f.logs.length,0);
 f.bot.emit('entityHurt',f.bot.entity);assert.equal(f.logs[0].data.sourceStatus,'unavailable');assert.equal(f.logs[0].data.source,null);
 f.bot.emit('entityHurt',f.bot.entity,{id:15});assert.equal(f.logs[1].data.source.id,15);assert.match(f.logs[1].message,/observed entity/);
 f.bot.entity.id=undefined;f.bot.emit('entityHurt',{});assert.equal(f.logs.length,2);f.observer.dispose();
});
test('health baseline follows healing and food updates; logs only measured decreases after safety handling',()=>{
 const f=fixture();f.bot.emit('health');f.bot.emit('health');assert.equal(f.logs.length,0);
 f.bot.health=16;f.bot.emit('health');assert.equal(f.logs[0].data.loss,4);assert.deepEqual(f.order.slice(-2),['guard','log']);
 f.bot.health=18;f.bot.emit('health');f.bot.health=15;f.bot.emit('health');assert.equal(f.logs[1].data.loss,3);
 assert.equal(f.logs[1].data.cause,'unattributed');f.observer.dispose();
});
test('hurt and health ordering never attributes a health loss to a nearby hurt event',()=>{
 for(const first of ['hurt','health']){
  const f=fixture();f.bot.emit('health');
  const hurt=()=>f.bot.emit('entityHurt',f.bot.entity,{id:2,name:'skeleton'});
  const health=()=>{f.bot.health=14;f.bot.emit('health')};
  if(first==='hurt'){hurt();health()}else{health();hurt()}
  hurt();assert.equal(f.logs.filter(e=>e.data.kind==='health_loss').length,1);
  assert.equal(f.logs.find(e=>e.data.kind==='health_loss').data.cause,'unattributed');
  assert.equal(f.logs.find(e=>e.data.kind==='hurt_observation').data.health_observed,first==='hurt'?20:14);f.observer.dispose();
 }
});
test('initial spawn, respawn and invalid health reset baseline without inventing damage',()=>{
 const f=fixture();f.bot.health=undefined;f.bot.emit('spawn');f.bot.emit('health');f.bot.health=12;f.bot.emit('health');assert.equal(f.logs.length,0);
 f.bot.health=10;f.bot.emit('health');assert.equal(f.logs.length,1);f.bot.emit('respawn');f.bot.health=5;f.bot.emit('health');f.bot.emit('spawn');assert.equal(f.logs.length,1);assert.equal(f.observer.recent().length,0);
 f.bot.health=NaN;f.bot.emit('health');f.bot.health=1;f.bot.emit('health');assert.equal(f.logs.length,1);f.observer.dispose();
});
test('lethal loss is retained, history is bounded and ended or retired connections stay silent',()=>{
 const f=fixture();f.bot.emit('health');for(let h=19;h>=0;h--){f.bot.health=h;f.bot.emit('health')}
 assert.equal(f.logs.at(-1).data.after,0);assert.equal(f.observer.recent().length,8);
 f.retire();f.bot.emit('entityHurt',f.bot.entity);assert.equal(f.logs.length,20);
 f.bot.emit('end');assert.equal(f.bot.listenerCount('health'),0);assert.equal(f.bot.listenerCount('entityHurt'),0);f.observer.dispose();
});

test('installed Mineflayer respawn ordering retains the first new-life health loss',async()=>{
 const {createRequire}=await import('node:module');const inject=createRequire(import.meta.url)('mineflayer/lib/plugins/health');
 const f=fixture();f.bot._client=new EventEmitter();f.bot._client.write=()=>{};f.bot.supportFeature=()=>false;
 inject(f.bot,{respawn:false});
 const update=health=>f.bot._client.emit('update_health',{health,food:20,foodSaturation:5});
 update(20);update(0);assert.equal(f.logs.at(-1).data.loss,20);
 f.bot._client.emit('respawn',{});update(20);assert.equal(f.observer.recent().length,0);
 update(17);assert.equal(f.observer.recent()[0].kind,'health_loss');assert.equal(f.observer.recent()[0].before,20);assert.equal(f.observer.recent()[0].after,17);assert.equal(f.observer.recent()[0].loss,3);
 f.observer.dispose();
});

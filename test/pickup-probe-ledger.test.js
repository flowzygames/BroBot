import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Vec3 } from 'vec3';
import { PickupProbeLedger, PICKUP_PROBE_EVENTS } from '../src/pickup-probe-ledger.js';
function fixture(){const bot=Object.assign(new EventEmitter(),{entity:{position:new Vec3(.5,64,.5)},game:{dimension:'overworld'}}),target={position:new Vec3(2.5,64,.5)},cell=new Vec3(2,64,0);return{bot,target,cell,ledger:new PickupProbeLedger(bot)};}
test('negative pickup evidence invalidates on every observed collision event and disposes listeners',()=>{
 const {bot,target,cell,ledger}=fixture();
 for(const event of PICKUP_PROBE_EVENTS){const context=ledger.context(target);ledger.failed(target,context,cell);ledger.exhaust(target,context);assert.equal(ledger.spent(target),true);bot.emit(event);assert.equal(ledger.spent(target),false);assert.equal(ledger.tried(target,ledger.context(target),cell),false);}
 ledger.dispose();for(const event of PICKUP_PROBE_EVENTS)assert.equal(bot.listenerCount(event),0);
});
test('negative pickup evidence uses exact origin, target, dimension and entity identity',()=>{
 const {bot,target,cell,ledger}=fixture();
 try{
  const original=ledger.context(target);ledger.failed(target,original,cell);ledger.exhaust(target,original);
  assert.equal(ledger.spent({...target}),false);
  bot.entity.onGround=true;assert.equal(ledger.spent(target),false);delete bot.entity.onGround;
  bot.entity.position.x+=.00001;assert.equal(ledger.spent(target),false);bot.entity.position.x=.5;
  target.position.y+=.1;assert.equal(ledger.spent(target),false);target.position.y=64;
  bot.game.dimension='end';assert.equal(ledger.spent(target),false);
 }finally{ledger.dispose();}
});
test('a failure captured before a planning-time change never suppresses the changed context',()=>{
 const {bot,target,cell,ledger}=fixture();
 try{const captured=ledger.context(target);bot.emit('entityMoved');ledger.failed(target,captured,cell);assert.equal(ledger.tried(target,ledger.context(target),cell),false);}finally{ledger.dispose();}
});
test('pickup negative ledger is bounded and a fresh invocation has no remembered failures',()=>{
 const {bot,cell,ledger}=fixture();let target;
 for(let i=0;i<100;i++){target={position:new Vec3(i,64,0)};const key=ledger.context(target);for(let n=0;n<10;n++)ledger.failed(target,key,new Vec3(n,64,0));}
 assert.equal(ledger.entries.size,64);assert.ok([...ledger.entries.values()].every(e=>e.cells.size<=3));ledger.dispose();
 const fresh=new PickupProbeLedger(bot);try{assert.equal(fresh.tried(target,fresh.context(target),cell),false);}finally{fresh.dispose();}
});

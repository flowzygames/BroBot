import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { EmptyCollectionRetry } from '../src/empty-collection-retry.js';

function fixture() {
  const bot=Object.assign(new EventEmitter(),{entity:{position:{x:.5,y:64,z:.5},onGround:true},_client:{},world:{},registry:{},game:{dimension:'overworld',minY:-64,height:384}});
  let now=0,boundary={center:{x:0,y:64,z:0},radius:256};
  const parent=new AbortController(), tracker=new EmptyCollectionRetry(bot,{now:()=>now,boundary:()=>boundary});
  const begin=()=>tracker.begin({origin:{x:0,y:64,z:0},radius:32,block:'stone',parentSignal:parent.signal});
  const evidence={source:'cursor',coverage_complete:true,context_stable:true,termination:'traversal_complete',complete_empty:true,observed_candidates:0,skipped_positions:0,query_skipped_positions:0,unloaded_columns:0,unknown_cells:0,block:'stone',radius:32,origin:{x:0,y:64,z:0}};
  return {bot,parent,tracker,begin,evidence,setTime:value=>{now=value;},setBoundary:value=>{boundary=value;}};
}
test('only a confirmed empty receipt mints a transient key',()=>{
  const f=fixture(),l=f.begin();assert.equal(f.tracker.key(),null);assert.ok(f.tracker.confirm(l,f.evidence));assert.equal(typeof f.tracker.key(),'string');f.tracker.clear();assert.equal(f.bot.listenerCount('blockUpdate'),0);
});
for(const [key,value] of [['source','native'],['coverage_complete',false],['context_stable',false],['termination','page_limit'],['complete_empty',false],['observed_candidates',1],['query_skipped_positions',1],['query_skipped_positions',undefined],['query_skipped_positions',null],['query_skipped_positions','0'],['query_skipped_positions',-1],['query_skipped_positions',0.5],['skipped_positions',-1],['skipped_positions',undefined],['skipped_positions',0.5],['skipped_positions',NaN],['skipped_positions','0'],['unloaded_columns',1],['unknown_cells',1],['block','dirt'],['radius',31],['origin',{x:1,y:64,z:0}]])test(`empty retry refuses mismatched or incomplete receipt ${key}`,()=>{
 const f=fixture(),l=f.begin();assert.equal(f.tracker.confirm(l,{...f.evidence,[key]:value}),false);assert.equal(f.tracker.key(),null);assert.equal(f.bot.listenerCount('blockUpdate'),0);
});
test('distant valid block and column updates preserve the hint through read-only dispatch',()=>{
 const f=fixture(),l=f.begin();f.tracker.confirm(l,f.evidence);const key=f.tracker.key();
 f.bot.emit('blockUpdate',{position:{x:1000,y:64,z:0}},{position:{x:1000,y:64,z:0}});
 f.bot.emit('chunkColumnLoad',{x:1024,y:0,z:1024});f.bot.emit('chunkColumnUnload',{x:-1024,y:0,z:-1024});
 f.tracker.dispatch('inspect',f.parent.signal);f.tracker.dispatch('explore',f.parent.signal);assert.equal(f.tracker.key(),key);f.tracker.clear();
});
for(const [name,event,args] of [
 ['boundary neighbor','blockUpdate',[{position:{x:33,y:64,z:0}},{position:{x:33,y:64,z:0}}]],
 ['missing old block','blockUpdate',[null,{position:{x:1000,y:64,z:0}}]],
 ['missing new block','blockUpdate',[{position:{x:1000,y:64,z:0}},null]],
 ['fractional geometry','blockUpdate',[{position:{x:1000.5,y:64,z:0}},{position:{x:1000.5,y:64,z:0}}]],
 ['near column','chunkColumnLoad',[{x:32,y:0,z:0}]],
 ['column overlaps negative boundary','chunkColumnUnload',[{x:-48,y:0,z:0}]],
 ['malformed column','chunkColumnLoad',[{x:1000,y:0,z:1000}]],
 ['respawn','respawn',[]],['quarantine','terrainUntrusted',[]],['disconnect','end',[]]
])test(`empty retry invalidates on ${name}`,()=>{
 const f=fixture(),l=f.begin();f.tracker.confirm(l,f.evidence);f.bot.emit(event,...args);assert.equal(f.tracker.key(),null);assert.equal(f.bot.listenerCount(event),0);
});
test('dependency change before receipt publication prevents minting',()=>{
 const f=fixture(),l=f.begin();f.bot.emit('blockUpdate',{position:{x:0,y:64,z:0}},{position:{x:0,y:64,z:0}});assert.equal(f.tracker.confirm(l,f.evidence),false);assert.equal(f.tracker.key(),null);
});
for(const change of ['away-back','world','client','entity','dimension','boundary','abort','expiry','query','other-action','other-parent','airborne'])test(`empty retry rejects stale ${change}`,()=>{
 const f=fixture(),l=f.begin();f.tracker.confirm(l,f.evidence);
 if(change==='away-back'){f.bot.entity.position.x++;f.bot.emit('move');f.bot.entity.position.x--;f.bot.emit('move');}
 if(change==='world')f.bot.world={};if(change==='client')f.bot._client={};if(change==='entity')f.bot.entity={...f.bot.entity};
 if(change==='dimension')f.bot.game.dimension='nether';if(change==='boundary')f.setBoundary({center:{x:1,y:64,z:0},radius:256});
 if(change==='abort')f.parent.abort();if(change==='expiry')f.setTime(30000);
 if(change==='query')f.tracker.dispatch('collect',f.parent.signal);if(change==='other-action')f.tracker.dispatch('dig_at',f.parent.signal);
 if(change==='other-parent')f.tracker.dispatch('inspect',new AbortController().signal);if(change==='airborne')f.bot.entity.onGround=false;
 assert.equal(f.tracker.key(),null);assert.equal(f.bot.listenerCount('blockUpdate'),0);
});

test('real expiry releases listeners without a key read and old callbacks cannot clear a successor',async()=>{
 const f=fixture();f.tracker.ttlMs=10;const expired=f.begin();assert.ok(f.tracker.confirm(expired,f.evidence));
 await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.tracker.lease,null);assert.equal(f.bot.listenerCount('blockUpdate'),0);
 f.tracker.ttlMs=30000;const old=f.begin();f.tracker.confirm(old,f.evidence);const next=f.begin();f.tracker.confirm(next,f.evidence);const key=f.tracker.key();
 old.invalidate();expired.invalidate();assert.equal(f.tracker.key(),key);f.tracker.clear();
});

test('explicit zero query skips permits distant historical skips without weakening dependencies',()=>{
 const f=fixture(),l=f.begin();assert.ok(f.tracker.confirm(l,{...f.evidence,skipped_positions:11,query_skipped_positions:0}));
 const key=f.tracker.key();assert.equal(typeof key,'string');
 f.bot.emit('blockUpdate',{position:{x:1000,y:64,z:0}},{position:{x:1000,y:64,z:0}});assert.equal(f.tracker.key(),key);
 f.bot.emit('blockUpdate',{position:{x:33,y:64,z:0}},{position:{x:33,y:64,z:0}});assert.equal(f.tracker.key(),null);
});

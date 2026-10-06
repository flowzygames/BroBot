import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {Vec3} from 'vec3'
import {EmptySearchContinuation} from '../src/empty-search-continuation.js'
import {installSearchTrace} from '../scripts/lib/search-trace.js'
function fixture(){
 const bot=Object.assign(new EventEmitter(),{_client:{},world:{},registry:{},game:{dimension:'overworld',minY:-64,height:384},entity:{position:new Vec3(.5,64,.5),velocity:new Vec3(0,0,0),yaw:0,pitch:0,onGround:true}})
 const parent=new AbortController(),action=new AbortController(),state=new EmptySearchContinuation(bot,{now:()=>100})
 const begin=()=>state.begin({key:'same',parentSignal:parent.signal,actionSignal:action.signal,createCursor:()=>({resumable:true})})
 return{bot,parent,action,state,begin}
}
test('diagnostic trace attributes snapshot changes without altering invalidation',()=>{
 const events=[],restore=installSearchTrace(EmptySearchContinuation,e=>events.push(e)),f=fixture()
 try{const lease=f.begin();assert.equal(f.state.retain(lease),true);f.bot.entity.yaw=.1;f.bot.emit('physicsTick');assert.equal(f.state.lease,null)
 const clear=events.find(e=>e.event==='clear');assert.equal(clear.trigger.name,'physicsTick');assert.deepEqual(clear.changes,[{field:'yaw',before:0,after:.1}]);assert.equal(f.begin().resumed,false)
 }finally{f.state.clear();restore()}
})
test('diagnostic trace preserves cursor identity over normal cleanup and resume',()=>{
 const events=[],f=fixture(),emit=f.bot.emit,owned=Object.hasOwn(f.bot,'emit'),restore=installSearchTrace(EmptySearchContinuation,e=>events.push(e))
 try{const first=f.begin();f.state.retain(first);f.state.dispatch('inspect',f.parent.signal);f.state.finishedCleanup();const next=f.begin();assert.equal(next.cursor,first.cursor);assert.equal(next.resumed,true)
 const begin=events.filter(e=>e.event==='begin');assert.equal(begin[0].cursorId,begin[1].cursorId);assert.equal(events.find(e=>e.event==='clear').caller,'begin')
 }finally{f.state.clear();restore();assert.equal(f.bot.emit,emit);assert.equal(Object.hasOwn(f.bot,'emit'),owned)}
})
test('throwing trace callback and bounded output do not affect cancellation',()=>{
 for(const throws of [true,false]){let count=0;const restore=installSearchTrace(EmptySearchContinuation,()=>{count++;if(throws)throw Error('sink unavailable')},{limit:2}),f=fixture()
 try{const lease=f.begin();assert.equal(f.state.retain(lease),true);f.parent.abort();assert.equal(f.state.lease,null);assert.ok(count<=2)}finally{f.state.clear();restore()}}
})
test('trace separates parent cancellation from action cancellation and records column geometry',()=>{
 for(const kind of ['parent','action','column']){const events=[],restore=installSearchTrace(EmptySearchContinuation,e=>events.push(e)),f=fixture()
 try{f.state.retain(f.begin());if(kind==='column')f.bot.emit('chunkColumnLoad',new Vec3(-16,0,32));else f[kind].abort()
 const clear=events.find(e=>e.event==='clear');assert.equal(clear.parentAborted,kind==='parent');assert.equal(clear.actionAborted,kind==='action');if(kind==='column')assert.deepEqual(clear.trigger.column,{x:-16,y:0,z:32})
 }finally{f.state.clear();restore()}}
})

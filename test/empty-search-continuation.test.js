import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { Vec3 } from 'vec3'
import { EmptySearchContinuation } from '../src/empty-search-continuation.js'

function fixture () {
  const bot = Object.assign(new EventEmitter(), { _client: {}, world: {}, registry: {}, game: { dimension: 'overworld', minY: -64, height: 384 }, entity: { position: new Vec3(.5, 64, .5), velocity: new Vec3(0, 0, 0), yaw: 0, pitch: 0, onGround: true } })
  const parent = new AbortController(), action = new AbortController(), state = new EmptySearchContinuation(bot)
  let created = 0
  const begin = (overrides = {}) => state.begin({ key: 'job/query', parentSignal: parent.signal, actionSignal: action.signal, createCursor: () => ({ resumable: true, id: ++created }), ...overrides })
  const stage = () => { const lease = begin(); assert.equal(state.retain(lease), true); return lease }
  return { bot, parent, action, state, begin, stage }
}

test('same parent read-only inspect and finished cleanup preserve only eligible geometry', () => {
  const f = fixture(), first = f.stage()
  f.state.dispatch('inspect', f.parent.signal); f.state.finishedCleanup()
  const next = f.begin({ actionSignal: new AbortController().signal })
  assert.equal(next.resumed, true); assert.equal(next.cursor, first.cursor)
  assert.equal(first.invalid, true); f.state.release(next)
  for (const name of f.bot.eventNames()) assert.equal(f.bot.listenerCount(name), 0)
})

for (const kind of ['parent-abort', 'action-abort', 'mutation', 'parent-change', 'query-change', 'world', 'entity', 'client', 'registry', 'dimension', 'minY', 'height', 'pose', 'velocity', 'yaw', 'pitch', 'grounded', 'away-back', 'blockUpdate', 'chunkColumnLoad', 'chunkColumnUnload', 'respawn', 'spawn', 'end', 'terrainUntrusted']) test(`pending empty search invalidates on ${kind}`, () => {
  const f = fixture(), old = f.stage()
  if (kind === 'parent-abort') f.parent.abort()
  else if (kind === 'action-abort') f.action.abort()
  else if (kind === 'mutation') f.state.dispatch('craft', f.parent.signal)
  else if (kind === 'parent-change') f.state.dispatch('inspect', new AbortController().signal)
  else if (['world', 'entity', 'client', 'registry'].includes(kind)) f.bot[kind === 'client' ? '_client' : kind] = { ...f.bot[kind === 'client' ? '_client' : kind] }
  else if (kind === 'dimension') f.bot.game.dimension = 'the_nether'
  else if (kind === 'minY') f.bot.game.minY = 0
  else if (kind === 'height') f.bot.game.height = 256
  else if (kind === 'pose') f.bot.entity.position.x += .0001
  else if (kind === 'velocity') f.bot.entity.velocity.y = -.01
  else if (kind === 'yaw' || kind === 'pitch') f.bot.entity[kind] += .01
  else if (kind === 'grounded') f.bot.entity.onGround = false
  else if (kind === 'away-back') { f.bot.entity.position.x++; f.bot.emit('physicsTick'); f.bot.entity.position.x-- }
  else if (kind !== 'query-change') f.bot.emit(kind)
  const next = f.begin({ key: kind === 'query-change' ? 'changed query' : 'job/query', actionSignal: new AbortController().signal })
  assert.ok(!next || !next.resumed); assert.equal(old.invalid, true)
  f.state.clear()
})

test('expiry and aborted settlement cannot resurrect a cursor', async () => {
  const f = fixture(); f.state.ttlMs = 10
  const lease = f.stage(); await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(f.state.lease, null); assert.equal(f.state.retain(lease), false)
  const other = fixture(), active = other.begin(); other.parent.abort()
  assert.equal(other.state.retain(active), false); assert.equal(other.state.lease, null)
})

const scope = (radius=33,origin=new Vec3(0,64,0)) => ({origin,radius})
const block = p => ({position:p})
function scopedStage(f,dependency=scope()) {
 const lease=f.begin({terrainDependency:dependency});assert.ok(lease);assert.equal(f.state.retain(lease),true);return lease
}
for(const [label,event,args,retained] of [
 ['far block update','blockUpdate',[block(new Vec3(190,61,153)),block(new Vec3(190,61,153))],true],
 ['boundary neighbor','blockUpdate',[block(new Vec3(33,64,0)),block(new Vec3(33,64,0))],false],
 ['outside boundary','blockUpdate',[block(new Vec3(34,64,0)),block(new Vec3(34,64,0))],true],
 ['old outside new inside','blockUpdate',[block(new Vec3(100,64,0)),block(new Vec3(0,64,0))],false],
 ['missing old block','blockUpdate',[null,block(new Vec3(100,64,0))],false],
 ['fractional event position','blockUpdate',[block(new Vec3(100.5,64,0)),block(new Vec3(100,64,0))],false],
 ['far loaded column','chunkColumnLoad',[new Vec3(64,0,32)],true],
 ['far negative unloaded column','chunkColumnUnload',[new Vec3(-64,0,-32)],true],
 ['intersecting loaded column','chunkColumnLoad',[new Vec3(32,0,0)],false],
 ['intersecting negative column','chunkColumnUnload',[new Vec3(-48,0,0)],false],
 ['nonaligned column','chunkColumnLoad',[new Vec3(1,0,0)],false],
 ['malformed column height','chunkColumnUnload',[new Vec3(64,1,32)],false],
 ['global trust loss','terrainUntrusted',[Error('uncertain terrain')],false]
])test(`collection dependency scope handles ${label}`,()=>{
 const f=fixture(),lease=scopedStage(f)
 try{f.bot.emit(event,...args);assert.equal(f.state.lease===lease,retained);if(retained){const next=f.begin({terrainDependency:scope()});assert.equal(next.resumed,true);assert.equal(next.cursor,lease.cursor)}}finally{f.state.clear()}
})
test('column tangency is relevant at both positive and negative boundaries',()=>{
 for(const x of [32,-48]){const f=fixture();scopedStage(f,scope(32));f.bot.emit('chunkColumnLoad',new Vec3(x,0,0));assert.equal(f.state.lease,null)}
})
test('caller scope mutation cannot alter the retained dependency boundary',()=>{
 const f=fixture(),dependency=scope(),lease=scopedStage(f,dependency)
 dependency.origin.x=1000;dependency.radius=1
 f.bot.emit('blockUpdate',block(new Vec3(0,64,0)),block(new Vec3(0,64,0)))
 assert.equal(f.state.lease,null);assert.equal(lease.terrainDependency.origin.x,0);assert.equal(lease.terrainDependency.radius,33)
})
for(const kind of ['radius','origin','remove','add'])test(`changed ${kind} scope cannot reuse a cursor`,()=>{
 const f=fixture(),old=kind==='add'?f.stage():scopedStage(f)
 const dependency=kind==='radius'?scope(34):kind==='origin'?scope(33,new Vec3(1,64,0)):kind==='remove'?null:scope()
 const next=f.begin({terrainDependency:dependency});assert.equal(next.resumed,false);assert.notEqual(next.cursor,old.cursor);f.state.clear()
})
for(const dependency of [{},{origin:new Vec3(0,64,0),radius:66},{origin:new Vec3(.5,64,0),radius:33},{origin:new Vec3(0,64,0),radius:NaN}])test(`malformed dependency clears an old lease: ${JSON.stringify(dependency)}`,()=>{
 const f=fixture();scopedStage(f);assert.equal(f.begin({terrainDependency:dependency}),null);assert.equal(f.state.lease,null)
})
test('scoped cursors preserve all exact pose and parent cancellation guards',()=>{
 for(const kind of ['yaw','velocity','parent']){const f=fixture();scopedStage(f)
 if(kind==='parent')f.parent.abort();else{if(kind==='yaw')f.bot.entity.yaw+=.001;else f.bot.entity.velocity.y=-.001;f.bot.emit('physicsTick')}
 assert.equal(f.state.lease,null)
 }
})
test('a throwing terrain event geometry fails closed',()=>{
 const f=fixture();scopedStage(f);const bad={get position(){throw Error('bad geometry')}}
 assert.doesNotThrow(()=>f.bot.emit('blockUpdate',bad,bad));assert.equal(f.state.lease,null)
})

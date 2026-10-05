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

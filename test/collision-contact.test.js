import test from 'node:test'
import assert from 'node:assert/strict'
import AABB from 'prismarine-physics/lib/aabb.js'
import { clipContactOffset, configureCollisionContact, contactEpsilon } from '../src/collision-contact.js'

const original = Object.fromEntries(['X', 'Y', 'Z'].map(axis => [axis, AABB.prototype['computeOffset' + axis]]))
test('recorded grass-corner contact clips inward movement instead of penetrating a solid block', () => {
  const p = { x: -27.562169459617916, y: 69, z: -4.30000003 }, w = .30000003
  const wall = new AABB(-28, 69, -4, -27, 70, -3), body = new AABB(p.x-w,p.y,p.z-w,p.x+w,p.y+1.80000018,p.z+w)
  assert.equal(body.maxZ, -3.9999999999999996)
  assert.equal(wall.computeOffsetZ(body, .07664669213170061), .07664669213170061)
  assert.equal(clipContactOffset(wall, body, .07664669213170061, 'Z', original.Z), 0)
  assert.equal(clipContactOffset(wall, body, -.1, 'Z', original.Z), -.1)
})
test('near-contact tolerance preserves real overlap, separation, outward and tangential motion on every axis', () => {
 for (const axis of ['X','Y','Z']) for (const origin of [-30, 30, 29999980]) for (const direction of [-1,1]) {
  const wall = new AABB(origin,origin,origin,origin+1,origin+1,origin+1), body = new AABB(origin+.1,origin+.1,origin+.1,origin+.9,origin+.9,origin+.9)
  const face = direction > 0 ? 'max' : 'min', boundary = direction > 0 ? origin : origin+1, epsilon = contactEpsilon(boundary,boundary)
  body[face+axis] = boundary + direction*epsilon/2
  body[(direction > 0 ? 'min':'max')+axis] = body[face+axis]-direction*.6
  assert.equal(clipContactOffset(wall,body,direction*.1,axis,original[axis]),0)
  assert.equal(clipContactOffset(wall,body,-direction*.1,axis,original[axis]),-direction*.1)
  assert.equal(clipContactOffset(wall,body,0,axis,original[axis]),0)
  body[face+axis] = boundary+direction*.01
  assert.equal(clipContactOffset(wall,body,direction*.1,axis,original[axis]),direction*.1)
  body[face+axis] = boundary-direction*.02
  assert.equal(clipContactOffset(wall,body,direction*.1,axis,original[axis]),original[axis].call(wall,body,direction*.1))
  const otherAxis=['X','Y','Z'].find(a=>a!==axis);body['min'+otherAxis]=origin+2;body['max'+otherAxis]=origin+3
  body[face+axis] = boundary+direction*epsilon/2
  assert.equal(clipContactOffset(wall,body,direction*.1,axis,original[axis]),direction*.1)
 }
})
test('simulation adapter is version-scoped, idempotent and restores original methods on return and error', () => {
 const physics={simulatePlayer(){assert.notEqual(AABB.prototype.computeOffsetZ,original.Z);return 7}},bot={version:'1.21.8',physics}
 assert.equal(configureCollisionContact(bot),true);assert.equal(configureCollisionContact(bot),false);assert.equal(physics.simulatePlayer(),7)
 for(const axis of ['X','Y','Z'])assert.equal(AABB.prototype['computeOffset'+axis],original[axis])
 const failing={version:'1.21.8',physics:{simulatePlayer(){throw Error('fixture')}}};configureCollisionContact(failing);assert.throws(()=>failing.physics.simulatePlayer(),/fixture/)
 for(const axis of ['X','Y','Z'])assert.equal(AABB.prototype['computeOffset'+axis],original[axis])
 const other={version:'1.21.11',physics:{simulatePlayer(){}}};assert.equal(configureCollisionContact(other),false)
})
test('nested synchronous simulations restore their entry-time wrappers', () => {
 const inner={version:'1.21.8',physics:{simulatePlayer(){assert.notEqual(AABB.prototype.computeOffsetZ,original.Z)}}};configureCollisionContact(inner)
 const outer={version:'1.21.8',physics:{simulatePlayer(){const entered=AABB.prototype.computeOffsetZ;inner.physics.simulatePlayer();assert.equal(AABB.prototype.computeOffsetZ,entered)}}};configureCollisionContact(outer);outer.physics.simulatePlayer();assert.equal(AABB.prototype.computeOffsetZ,original.Z)
})

test('actual client simulation no longer predicts a sprint through the recorded grass corner', async () => {
  const { default: physicsPackage } = await import('prismarine-physics')
  const { default: minecraftData } = await import('minecraft-data')
  const { default: loadBlock } = await import('prismarine-block')
  const { Vec3 } = await import('vec3')
  const registry = minecraftData('1.21.8'), Block = loadBlock('1.21.8')
  const world = { getBlock(p) {
    const q=p.floored(), solid=q.y===68 || (q.x===-28&&q.y===69&&q.z===-4)
    const block=Block.fromStateId(registry.blocksByName[solid?'grass_block':'air'].defaultState,0);block.position=q;return block
  } }
  const physics=physicsPackage.Physics(registry,world);physics.playerHalfWidth=.30000003;physics.playerHeight=1.80000018
  const bot={version:'1.21.8',physics,entity:{position:new Vec3(-27.562169459617916,69,-4.30000003),velocity:new Vec3(0,-.0784000015258789,0),onGround:true,yaw:-2.216326669485908,pitch:0,effects:{},attributes:{}},inventory:{slots:Array(46).fill(null)},jumpTicks:0,jumpQueued:false}
  const controls={forward:true,sprint:true,jump:false,back:false,left:false,right:false,sneak:false}
  const before=bot.entity.position.clone(), originalState=new physicsPackage.PlayerState(bot,controls)
  physics.simulatePlayer(originalState,world)
  assert.ok(originalState.pos.z+physics.playerHalfWidth > -3.99, 'Unpatched predictor penetrates the wall')
  configureCollisionContact(bot)
  const corrected=new physicsPackage.PlayerState(bot,controls)
  physics.simulatePlayer(corrected,world)
  assert.ok(corrected.pos.z+physics.playerHalfWidth <= -4+1e-9)
  assert.ok(corrected.pos.x > before.x, 'Tangential movement along the wall remains allowed')
  assert.ok(bot.entity.position.equals(before), 'Adapter never moves the live entity directly')
})

test('partial adapter installation failure restores methods already replaced', () => {
  const descriptor = Object.getOwnPropertyDescriptor(AABB.prototype, 'computeOffsetY')
  const bot = { version: '1.21.8', physics: { simulatePlayer() { throw new Error('Must not reach simulator') } } }
  configureCollisionContact(bot)
  try {
    Object.defineProperty(AABB.prototype, 'computeOffsetY', { ...descriptor, writable: false })
    assert.throws(() => bot.physics.simulatePlayer(), TypeError)
    assert.equal(AABB.prototype.computeOffsetX, original.X)
    assert.equal(AABB.prototype.computeOffsetZ, original.Z)
  } finally { Object.defineProperty(AABB.prototype, 'computeOffsetY', descriptor) }
})

test('expanded predictor clips inward motion at the recorded exact-edge leaf overhang', () => {
  const p = { x: 129.7, y: 64, z: 81.5 }, half = .30000003
  const leaf = new AABB(130, 65, 81, 131, 66, 82)
  const body = new AABB(p.x - half, p.y, p.z - half, p.x + half, p.y + 1.80000018, p.z + half)
  const overlap = body.maxX - leaf.minX
  assert.ok(overlap > 2.9e-8 && overlap < 3.1e-8)
  assert.equal(original.X.call(leaf, body, .05), .05)
  assert.equal(clipContactOffset(leaf, body, .05, 'X', original.X), 0)
  assert.equal(clipContactOffset(leaf, body, -.05, 'X', original.X), -.05)
  assert.equal(clipContactOffset(leaf, body, -.05, 'Z', original.Z), -.05)
})

test('real predictor preserves wall sliding from the recorded expanded-body overhang contact', async () => {
  const { default: physicsPackage } = await import('prismarine-physics')
  const { default: minecraftData } = await import('minecraft-data')
  const { default: loadBlock } = await import('prismarine-block')
  const { Vec3 } = await import('vec3')
  const registry = minecraftData('1.21.8'), Block = loadBlock('1.21.8')
  const world = { getBlock(position) {
    const p = position.floored()
    const leaf = p.x === 130 && p.y === 65 && p.z === 81
    const ground = p.y <= (p.x <= 129 ? 63 : 62)
    const block = Block.fromStateId(registry.blocksByName[leaf ? 'spruce_leaves' : ground ? 'grass_block' : 'air'].defaultState, 0)
    block.position = p
    return block
  } }
  const physics = physicsPackage.Physics(registry, world)
  physics.playerHalfWidth = .30000003; physics.playerHeight = 1.80000018
  const bot = { version: '1.21.8', physics,
    entity: { position: new Vec3(129.7, 64, 81.5), velocity: new Vec3(0, -.0784000015258789, 0), onGround: true,
      yaw: Math.atan2(-.8, 1), pitch: 0, effects: {}, attributes: {} },
    inventory: { slots: Array(46).fill(null) }, jumpTicks: 0, jumpQueued: false }
  const controls = { forward: true, sprint: true, jump: false, back: false, left: false, right: false, sneak: false }
  const predicted = new physicsPackage.PlayerState(bot, controls)
  physics.simulatePlayer(predicted, world)
  assert.ok(predicted.pos.x > 129.75, 'Uncorrected predictor moves into the leaf')
  configureCollisionContact(bot)
  const corrected = new physicsPackage.PlayerState(bot, controls)
  physics.simulatePlayer(corrected, world)
  assert.equal(corrected.pos.x, 129.7)
  assert.equal(corrected.vel.x, 0)
  assert.ok(corrected.pos.z < 81.45, 'Safe tangential movement remains available')
  assert.deepEqual(bot.entity.position.toArray(), [129.7, 64, 81.5], 'Prediction never directly moves the live entity')
})

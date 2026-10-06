// Read-only proposal for a bounded five-soil-edit straight staircase.
// Not routed to Runtime or the starter. A future executor must reconfirm every
// edit, footprint, route dependency and physical landing before proceeding.
import { Vec3 } from 'vec3'
import pathfinderPackage from 'mineflayer-pathfinder'
import blockLoader from 'prismarine-block'
import Move from 'mineflayer-pathfinder/lib/move.js'
import WorldSync from 'prismarine-world/src/worldsync.js'
import { assertTerrainTrusted } from '../terrain-trust.js'
import { retainedLeafAnchor } from '../construction-guards.js'
import { STARTER_MOVEMENT_RADIUS } from '../starter-limits.js'
import { isFluidBearingBlock, STARTER_AVOID_BLOCK_NAMES } from '../navigation-guards.js'

const { goals } = pathfinderPackage
const AIR = new Set(['air', 'cave_air', 'void_air'])
const SOIL = new Set(['dirt', 'grass_block'])
const HAZARDS = new Set([...STARTER_AVOID_BLOCK_NAMES,'magma_block','fire','soul_fire','campfire','soul_campfire','cactus','wither_rose','sweet_berry_bush'])
const SIDES = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]]
const HORIZONTAL = [[1,0],[-1,0],[0,1],[0,-1]]
const FALLING = /^(sand|red_sand|gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$|_concrete_powder$/
const finite = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]))
const key = p => `${p.x},${p.y},${p.z}`
const integer = p => finite(p) && ['x','y','z'].every(k => Number.isInteger(p[k]))
const columnKey = p => `${Math.floor(p.x/16)},${Math.floor(p.z/16)}`
const cube = b => b?.boundingBox === 'block' && b.shapes?.length === 1 && b.shapes[0].length === 6
  && b.shapes[0].every((n,i) => n === (i < 3 ? 0 : 1)) && !isFluidBearingBlock(b)
const air = b => AIR.has(b?.name) && b.boundingBox === 'empty'
const supports = (block,feet) => block.y < feet.y && block.y+1 >= feet.y-.03
  && feet.x+.31 > block.x && feet.x-.31 < block.x+1 && feet.z+.31 > block.z && feet.z-.31 < block.z+1
const signature = b => ({ position:b.position.toArray(), name:b.name, stateId:b.stateId ?? null,
  type:b.type, waterlogged:Boolean(b.isWaterlogged), boundingBox:b.boundingBox, shapes:b.shapes.map(s => [...s]) })
const unavailable = reason => Object.assign(Error('Soil staircase cannot be certified from current observations'), {code:'SOIL_PLAN_UNAVAILABLE', reason:reason??'observation or policy unavailable'})

export async function planSoilStair(bot, home, { signal, protectedPositions = [], budgetMs = 1000, onDiagnostic = null } = {}) {
  const report = detail => { try { if (typeof onDiagnostic === 'function') onDiagnostic(detail) } catch { /* Diagnostics cannot authorize or disrupt work. */ } }
  assertTerrainTrusted(bot)
  const entity = bot.entity, client = bot._client, world = bot.world, registry = bot.registry
  const pathfinder = bot.pathfinder, movement = pathfinder?.movements, initial = entity?.position
  const readBlock = bot.blockAt, searchPath = pathfinder?.getPathFromTo
  report({kind:'start',position:finite(initial)?[initial.x,initial.y,initial.z]:null,velocity:finite(entity?.velocity)?[entity.velocity.x,entity.velocity.y,entity.velocity.z]:null,onGround:entity?.onGround,eyeHeight:entity?.eyeHeight})
  if (bot.version !== '1.21.8' || !finite(initial) || typeof initial.clone !== 'function' || !finite(home) || !entity.onGround || !finite(entity.velocity) || entity.velocity.y > 0
    || Math.abs(initial.y-Math.round(initial.y)) > .03 || initial.distanceTo(home) > STARTER_MOVEMENT_RADIUS
    || !client || !world || !registry || typeof pathfinder?.getPathFromTo !== 'function'
    || !Array.isArray(protectedPositions) || protectedPositions.length > 128 || protectedPositions.some(p => !finite(p))
    || !Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 2000) return null
  let policy = null
  const sameSet = (a,b) => a.size===b.size && [...a].every(value=>b.has(value))
  const validMovement = () => pathfinder.movements === movement && movement?.canDig === false && movement.canOpenDoors === false
    && movement.allowParkour === false && movement.allowFreeMotion === false && movement.allow1by1towers === false
    && movement.maxDropDown === 3 && movement.scafoldingBlocks?.length === 0
    && Array.isArray(movement.exclusionAreasStep) && movement.blocksToAvoid instanceof Set && movement.liquids instanceof Set
    && movement.passableEntities instanceof Set && movement.entitiesToAvoid instanceof Set
    && STARTER_AVOID_BLOCK_NAMES.every(n => !registry.blocksByName[n] || movement.blocksToAvoid.has(registry.blocksByName[n].id))
    && (!policy || (sameSet(movement.blocksToAvoid,policy.avoid) && sameSet(movement.liquids,policy.liquids)
      && movement.exclusionAreasStep.length===policy.step.length && movement.exclusionAreasStep.every((fn,i)=>fn===policy.step[i])))
  const hasPickaxe = () => {try {const items=bot.inventory?.items();return Array.isArray(items)&&items.length<=256&&items.some(i=>Number.isSafeInteger(i.count)&&i.count>0&&typeof i.name==='string'&&/_pickaxe$/.test(i.name))}catch{return false}}
  const healthy = () => Number.isFinite(bot.health)&&bot.health>=12&&Number.isFinite(bot.food)&&bot.food>=10
  if (!validMovement() || !hasPickaxe() || !healthy()) return null
  policy={avoid:new Set(movement.blocksToAvoid),liquids:new Set(movement.liquids),step:[...movement.exclusionAreasStep]}
  if ([['playerHeight',1.8],['playerHalfWidth',.3]].some(([k,expected]) => bot.physics?.[k]!=null && (!Number.isFinite(bot.physics[k]) || Math.abs(bot.physics[k]-expected)>1e-6))
    || (entity.eyeHeight!=null && (!Number.isFinite(entity.eyeHeight) || entity.eyeHeight<=0 || entity.eyeHeight>1.8))) return null
  const movementKeys=Object.keys(movement).filter(k=>k!=='bot')
  const clonePolicy = value => value instanceof Set ? new Set(value) : Array.isArray(value) ? [...value]
    : value && typeof value==='object' ? {...value} : value
  const movementSnapshot=Object.fromEntries(movementKeys.map(k=>[k,clonePolicy(movement[k])]))
  const policyUnchanged = () => Object.keys(movement).filter(k=>k!=='bot').length===movementKeys.length && movementKeys.every(k=>{
    const a=movement[k],b=movementSnapshot[k]
    if (b instanceof Set) return a instanceof Set && sameSet(a,b)
    if (Array.isArray(b)) return Array.isArray(a) && a.length===b.length && a.every((v,i)=>v===b[i])
    if (b && typeof b==='object') return a && typeof a==='object' && Object.keys(a).length===Object.keys(b).length && Object.keys(b).every(k=>a[k]===b[k])
    return a===b
  })
  const origin = initial.clone(), homePoint = new Vec3(home.x,home.y,home.z), homeCell = homePoint.floored()
  const protectedFeet = [origin,homePoint,...protectedPositions.map(p => new Vec3(p.x,p.y,p.z))]
  const pose = () => JSON.stringify([entity.position?.toArray(),[entity.velocity?.x,entity.velocity?.y,entity.velocity?.z],entity.onGround,
    entity.yaw,entity.pitch,entity.eyeHeight,entity.height,entity.width,bot.physics?.playerHeight,bot.physics?.playerHalfWidth,
    bot.game?.dimension,bot.game?.minY,bot.game?.height])
  const initialPose = pose(), deadline = performance.now()+budgetMs, cache = new Map(), columns = new Set(), listeners = []
  const Block = blockLoader(registry)
  let changed = false, missing = 0, recorder = null, invalidation = null
  const invalidate = reason => { changed = true; invalidation ??= typeof reason === 'string' ? reason : 'observation event' }
  const check = () => {
    signal?.throwIfAborted(); assertTerrainTrusted(bot)
    if (changed) throw unavailable(invalidation)
    if (performance.now() >= deadline) throw unavailable('planning budget exhausted')
    if (cache.size > 32768 || !validMovement() || !hasPickaxe()
      || bot.entity !== entity || bot._client !== client || bot.world !== world || bot.registry !== registry
      || bot.pathfinder !== pathfinder || bot.blockAt !== readBlock || pathfinder.getPathFromTo !== searchPath || pose() !== initialPose || !healthy()) throw unavailable()
  }
  const onPose = () => { try { if (pose()!==initialPose) { report({kind:'pose-change',before:JSON.parse(initialPose),after:JSON.parse(pose())}); invalidate('own pose changed') } } catch { invalidate() } }
  const onBlock = (before,after) => {
    try {
      const positions = [before?.position,after?.position]
      if (positions.some(p => !integer(p)) || positions.some(p => cache.has(key(p)))) { report({kind:'block-event',positions:positions.map(p=>finite(p)?[p.x,p.y,p.z]:null)}); invalidate('local or malformed block event') }
    } catch { invalidate() }
  }
  const onColumn = p => {
    try {
      if (!integer(p) || p.y !== 0 || p.x%16 !== 0 || p.z%16 !== 0 || columns.has(columnKey(p))) invalidate('local or malformed column event')
    } catch { invalidate() }
  }
  listeners.push(['move',onPose],['physicsTick',onPose],['blockUpdate',onBlock],['chunkColumnLoad',onColumn],['chunkColumnUnload',onColumn])
  for (const event of ['spawn','respawn','end','terrainUntrusted','entitySpawn','entityGone','entityMoved','entityUpdate']) listeners.push([event,entity=>{
    if (event.startsWith('entity')) {
      try {
        if (!policyUnchanged()) { invalidate('movement policy changed during entity event'); return }
        if (entity === bot.entity) { onPose(); return }
        if (entity?.name === 'item' && Number.isSafeInteger(entity.id) && finite(entity.position)
          && movementSnapshot.passableEntities.has('item') && !movementSnapshot.entitiesToAvoid.has('item')
          && bot.entities?.[entity.id] === entity) return
      } catch { invalidate('malformed entity event'); return }
      try { report({kind:'entity-event',event,id:entity?.id,name:entity?.name,own:entity===bot.entity,position:finite(entity?.position)?[entity.position.x,entity.position.y,entity.position.z]:null}) } catch {}
    }
    invalidate(event)
  }])
  for (const [event,fn] of listeners) bot.on(event,fn)
  const observed = position => {
    check()
    const p = position.floored(), k = key(p)
    columns.add(columnKey(p))
    if (!cache.has(k)) {
      cache.set(k,null)
      const block = readBlock.call(bot,p)
      if (!block || !Array.isArray(block.shapes) || block.shapes.some(s => !Array.isArray(s) || s.length !== 6 || s.some(v => !Number.isFinite(v)))) cache.set(k,null)
      else {
        const copy = Object.assign(Object.create(Object.getPrototypeOf(block)),block)
        Object.defineProperties(copy,{
          position:{value:p.clone(),writable:true,configurable:true},
          shapes:{value:block.shapes.map(s => [...s]),writable:true,configurable:true},
          isWaterlogged:{value:Boolean(block.isWaterlogged),writable:true,configurable:true}
        })
        cache.set(k,copy)
      }
    }
    const block = cache.get(k)
    if (!block) missing++
    if (recorder) recorder.add(k)
    return block
  }
  const view = removed => {
    const virtual = Object.create(bot), graph = Object.create(Object.getPrototypeOf(movement))
    for (const k of movementKeys) graph[k]=clonePolicy(movementSnapshot[k])
    virtual.blockAt = position => {
      const p=position.floored(),k=key(p)
      if (!removed.has(k)) return observed(p)
      check(); if (recorder) recorder.add(k)
      const block=Block.fromStateId(registry.blocksByName.air.defaultState,0);block.position=p;return block
    }
    virtual.world={getBlock:virtual.blockAt,raycast:WorldSync.prototype.raycast}
    graph.bot=virtual
    graph.exclusionAreasStep=[...movementSnapshot.exclusionAreasStep,b=>isFluidBearingBlock(b)||b.position.distanceTo(homePoint)>STARTER_MOVEMENT_RADIUS?1000:0]
    return {bot:virtual,graph,read:virtual.blockAt,world:virtual.world}
  }
  const visible = (v,stage,target) => {
    const eye=stage.offset(0,entity.eyeHeight??1.62,0)
    for (const side of [[0,0,0],...SIDES]) {
      const delta=target.offset(.5+side[0]*.499,.5+side[1]*.499,.5+side[2]*.499).minus(eye),length=delta.norm()
      if (length>.001 && length<=4.2 && v.world.raycast(eye,delta.scaled(1/length),length+.01)?.position?.equals(target)) return true
    }
    return false
  }
  const route = async (v,from,to) => {
    check(); if (!policyUnchanged()) throw unavailable()
    const absent=missing, parentRecorder=recorder, pathKeys=new Set()
    recorder=pathKeys
    try {
    const feetBlock=v.read(from)
    if (Math.abs(from.y-Math.round(from.y))>.03 || !feetBlock || feetBlock.boundingBox!=='empty' || feetBlock.shapes.length || isFluidBearingBlock(feetBlock) || HAZARDS.has(feetBlock.name)) return null
    const start=from.floored()
    const generator=searchPath.call(pathfinder,v.graph,from,new goals.GoalBlock(to.x,to.y,to.z),
      {startMove:new Move(start.x,start.y,start.z,0,0),timeout:Math.max(1,Math.min(150,deadline-performance.now())),tickTimeout:25,optimizePath:false})
    let result
    try { for (const step of generator) {
      check();result=step?.result
      if (!result || !Array.isArray(result.path)) return null
      if (result.status!=='partial') break
      await new Promise(resolve=>setTimeout(resolve,0))
    }} finally { generator.return?.() }
    check()
    if (!policyUnchanged()) throw unavailable()
    if (missing!==absent || result?.status!=='success' || !Array.isArray(result.path) || result.path.some(n=>!integer(n)||n.toBreak?.length||n.toPlace?.length||n.parkour)) return null
    const nodes=[from.floored(),...result.path.map(p=>new Vec3(p.x,p.y,p.z))]
    if (!nodes.at(-1).equals(to) || nodes.some(p=>!p.toArray().every(Number.isInteger)||p.distanceTo(homePoint)>STARTER_MOVEMENT_RADIUS)) return null
    nodes.dependencyKeys=pathKeys
    return nodes
    } finally {
      recorder=parentRecorder
      if (parentRecorder) for (const k of pathKeys) parentRecorder.add(k)
    }
  }
  const corridor = (v,paths) => {
    for (const path of paths) for (const node of path) for (let x=-1;x<=1;x++) for (let y=-1;y<=2;y++) for (let z=-1;z<=1;z++) {
      const p=node.offset(x,y,z),b=v.read(p)
      if (!b || isFluidBearingBlock(b) || HAZARDS.has(b.name)) return false
      if (y===-1 && /_leaves$/.test(b.name) && !retainedLeafAnchor(v.read,p)) return false
    }
    return true
  }
  const record = (v,keys) => {
    const blocks=[...keys].map(k=>v.read(new Vec3(...k.split(',').map(Number))))
    return blocks.every(Boolean)?blocks.map(signature):null
  }
  const certificate = async (v,stage,extra=[],validate=()=>true) => {
    const keys=new Set();recorder=keys
    try {
      for (const path of extra) for (const k of path.dependencyKeys??[]) keys.add(k)
      const back=await route(v,stage,homeCell),out=back&&await route(v,homePoint,stage.floored())
      if (!back||!out || !corridor(v,[back,out,...extra]) || !validate()) return null
      const dependencies=record(v,keys)
      if (!dependencies) return null
      return {stage:stage.toArray(),routes:[back,out,...extra].map(path=>path.map(p=>p.toArray())),dependencies}
    } finally { recorder=null }
  }
  const dryStage = (v,p) => air(v.read(p)) && air(v.read(p.offset(0,1,0))) && cube(v.read(p.offset(0,-1,0))) && !HAZARDS.has(v.read(p.offset(0,-1,0)).name)
  const dependentSnow = (v,target,footprints) => {
    const above=v.read(target.offset(0,1,0));
    if (!above) return null;
    if (air(above) || cube(above)) return [];
    if (above.name==='snow' && above.stateId===registry.blocksByName.snow?.defaultState
      && above.boundingBox==='empty' && above.shapes.length===0
      && above.position.distanceTo(homePoint)<=STARTER_MOVEMENT_RADIUS
      && !footprints.some(p=>supports(above.position,p))) return [above];
    return null;
  }
  const safeEdit = (v,target,stage,footprints) => {
    const block=v.read(target)
    return block && SOIL.has(block.name) && cube(block) && target.distanceTo(homePoint)<=STARTER_MOVEMENT_RADIUS
      && !footprints.some(p=>supports(target,p)) && visible(v,stage,target)
      && SIDES.every(d=>{const b=v.read(target.offset(...d));return b&&!isFluidBearingBlock(b)&&!HAZARDS.has(b.name)})
      && !FALLING.test(v.read(target.offset(0,1,0)).name) && dependentSnow(v,target,footprints)!==null
  }
  try {
    check();const initialView=view(new Set())
    if (!dryStage(initialView,origin)) { report({kind:'refusal',reason:'initial dry stage unavailable',footBlock:cache.get(key(origin.floored()))?.name}); return null }
    const starts=[]
    for (let x=-2;x<=2;x++) for (let z=-2;z<=2;z++) for (let y=-2;y<=1;y++) {
      const p=origin.floored().offset(x+.5,y,z+.5)
      if (p.distanceTo(origin)<=3 && dryStage(initialView,p)) starts.push(p)
    }
    starts.sort((a,b)=>a.distanceTo(origin)-b.distanceTo(origin)||a.x-b.x||a.z-b.z||a.y-b.y)
    for (const stage of starts.slice(0,24)) for (const [dx,dz] of HORIZONTAL) {
      check();const p=stage.floored(),q=p.offset(dx,-1,dz),r=p.offset(2*dx,-2,2*dz),s=p.offset(3*dx,-2,3*dz),stone=s.offset(0,-1,0)
      const sequence=[{target:q,landing:q},{target:r.offset(0,1,0)},{target:r,landing:r},{target:s.offset(0,1,0)},{target:s}]
      if (observed(stone)?.name!=='stone' || sequence.some(({target})=>{const b=observed(target);return !b||!SOIL.has(b.name)||!cube(b)||protectedFeet.some(f=>supports(target,f))})) continue
      const removed=new Set(),v=view(removed),footprints=[...protectedFeet,stage]
      const approach=await route(v,origin,p)
      if (!approach) continue
      const initial=await certificate(v,origin,[approach]),staged=initial&&await certificate(v,stage)
      if (!initial||!staged) continue
      let current=stage,ok=true;const edits=[]
      for (const step of sequence) {
        if (!safeEdit(v,step.target,current,footprints)) {ok=false;break}
        const before=await certificate(v,current,[],()=>safeEdit(v,step.target,current,footprints))
        if (!before) {ok=false;break}
        const expected=signature(v.read(step.target)),dependents=dependentSnow(v,step.target,footprints).map(signature);
        removed.add(key(step.target));for(const dependent of dependents)removed.add(dependent.position.join(','))
        const after=await certificate(v,current)
        if (!after) {ok=false;break}
        const edit={target:step.target.toArray(),expected,dependents,before,after}
        if (step.landing) {
          const landing=step.landing.offset(.5,0,.5)
          if (!dryStage(v,landing)) {ok=false;break}
          const walk=await route(v,current,step.landing),landed=walk&&await certificate(v,landing,[walk])
          if (!landed) {ok=false;break}
          edit.landing=landed;current=landing;footprints.push(landing)
        }
        edits.push(edit)
      }
      if (!ok) continue
      // A settled pathfinder arrival may be offset within its block. Return
      // one step up before exposing a mining stage, rather than accepting a
      // nominal center whose actual footprint can overlap the stone support.
      const miningStage=q.offset(.5,0,.5)
      const reposition=await route(v,current,q)
      const stoneStaging=reposition&&await certificate(v,miningStage,[reposition])
      if (!stoneStaging) continue
      current=miningStage
      const stoneAccess=await certificate(v,current,[],()=>visible(v,current,stone)&&!footprints.some(f=>supports(stone,f))
        && SIDES.every(d=>{const b=v.read(stone.offset(...d));return b&&!isFluidBearingBlock(b)&&!HAZARDS.has(b.name)})
        && !FALLING.test(v.read(stone.offset(0,1,0)).name))
      if (!stoneAccess) continue
      removed.add(key(stone));const pickup=stone.offset(.5,0,.5)
      if (!dryStage(v,pickup)) continue
      const walk=await route(v,current,stone),pickupProof=walk&&await certificate(v,pickup,[walk])
      if (!pickupProof) continue
      check(); if (!policyUnchanged()) throw unavailable()
      return {schemaVersion:1,experimental:true,origin:origin.toArray(),home:homePoint.toArray(),stage:stage.toArray(),
        approach:initial,staged,edits,stone:stone.toArray(),stoneStaging,stoneAccess,hypotheticalPickup:pickupProof,observedCells:cache.size}
    }
    report({kind:'refusal',reason:'no candidate certified',observedCells:cache.size}); return null
  } catch (error) {
    if (error?.code==='SOIL_PLAN_UNAVAILABLE') { report({kind:'refusal',reason:error.reason,observedCells:cache.size}); return null }
    throw error
  } finally {
    for (const [event,fn] of listeners) bot.removeListener(event,fn)
  }
}

// Private owned transaction. No Runtime/public tool or automatic starter route.
import { Vec3 } from 'vec3'
import { planExposedStoneRemoval } from './soil-stair-plan.js'
import { RETIRE_TEMPORARY_SOIL_LANDINGS, readSoilExposure } from './soil-exposure-record.js'
import { assertTerrainTrusted, terrainTrustStatus } from '../terrain-trust.js'
import { isDryLanding, isHazardFreeBody, hasObservedStandingSupport } from '../body-hazards.js'
import { hasAnchoredLeafLanding } from '../starter-leaf-support.js'

const finite = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]))
const key = p => `${p.x},${p.y},${p.z}`
const supports = (target,p) => target.y < p.y && target.y+1 >= p.y-.03 && p.x+.31>target.x && p.x-.31<target.x+1 && p.z+.31>target.z && p.z-.31<target.z+1
const air = block => ['air','cave_air','void_air'].includes(block?.name)
const matches = (block,expected) => block && block.name===expected.name && block.stateId===expected.stateId && block.type===expected.type
  && Boolean(block.isWaterlogged)===expected.waterlogged && block.boundingBox===expected.boundingBox && JSON.stringify(block.shapes)===JSON.stringify(expected.shapes)

export async function collectExposedSoilStone({bot,home,exposure,signal,operationDeadline,ownershipGuard,validatePolicy,protectedPositions,mine,walk,halt}) {
  if (![ownershipGuard,validatePolicy,protectedPositions,mine,walk,halt].every(fn=>typeof fn==='function') || !Number.isFinite(operationDeadline)) throw Error('Private stone collection requires owned operation hooks and deadline')
  const owner={entity:bot.entity,client:bot._client,world:bot.world,registry:bot.registry,pathfinder:bot.pathfinder}
  const provenance=readSoilExposure(bot,exposure), dimension=bot.game?.dimension
  const sameInventorySession=()=>provenance && provenance.session.epoch===provenance.epoch && bot.game?.dimension===dimension
    && ['entity','world','registry'].every(k=>bot[k]===owner[k]) && bot._client===owner.client
  const deadline=Math.min(operationDeadline,performance.now()+30000), listeners=[]
  let failure=null, timer, monitor, proof, target, stationary=null, inFlight=false, confirmed=0, acquired=0, returned=false, editAttempted=false, inventoryBefore=null, inventoryCurrent=false, receipt=null
  const progress=()=>({experimental:true,completed:false,confirmed_stone_edits:confirmed,mining_hook_entered:editAttempted,stone_receipt:receipt,cobblestone_acquired:acquired,inventory_observation_current:inventoryCurrent,returned_home:returned,unfinished_stone_target:inFlight&&target?target.toArray():null,terrain_trusted:terrainTrustStatus(bot).trusted})
  const check=()=>{
    if(failure)throw failure
    signal?.throwIfAborted();assertTerrainTrusted(bot)
    if(!readSoilExposure(bot,exposure))throw Error('Private stone exposure session is no longer valid')
    if(ownershipGuard()!==true||validatePolicy()!==true)throw Error('Private stone control or policy changed')
    if(Object.entries(owner).some(([k,v])=>bot[k==='client'?'_client':k]!==v))throw Error('Private stone play session changed')
    if(performance.now()>=deadline)throw Error('Private stone deadline reached')
    if(!Number.isFinite(bot.health)||bot.health<12||!Number.isFinite(bot.food)||bot.food<10)throw Error('Private stone health or food threshold failed')
  }
  const fail=reason=>{failure??=reason instanceof Error?reason:Error(reason);try{halt(failure)}catch{}}
  const external=()=>{
    const points=protectedPositions()
    if(!Array.isArray(points)||points.length>128||points.some(p=>!finite(p)))throw Error('Private stone external protections are invalid')
    return points.map(p=>new Vec3(p.x,p.y,p.z))
  }
  const dependencies=certificate=>{check();for(const cell of certificate.dependencies)if(!matches(bot.blockAt(new Vec3(...cell.position)),cell))throw Error('Private stone route dependency changed');check()}
  const settled=stage=>{
    check();const p=bot.entity.position,v=bot.entity.velocity
    if(!finite(p)||!finite(v)||bot.entity.onGround!==true||Math.abs(p.y-stage[1])>.03||Math.hypot(p.x-stage[0],p.z-stage[2])>.35
      ||v.y<-.1||v.y>.03||Math.hypot(v.x,v.z)>.08||!isDryLanding(bot)||!hasObservedStandingSupport(bot)||!hasAnchoredLeafLanding(bot,p))throw Error('Private stone landing is not settled')
  }
  const waitSettled=async stage=>{
    const until=Math.min(deadline,performance.now()+2000);let stable=0
    while(performance.now()<until){check();try{settled(stage);stable++}catch{check();stable=0}if(stable>=2)return;await new Promise(r=>setTimeout(r,50))}
    throw Error('Private stone landing did not settle')
  }
  const cobble=()=>{
    const items=bot.inventory.items();if(!Array.isArray(items)||items.length>256)throw Error('Invalid private stone inventory observation')
    let count=0;for(const item of items)if(item.name==='cobblestone'){if(!Number.isSafeInteger(item.count)||item.count<0)throw Error('Invalid cobblestone count');count+=item.count;if(!Number.isSafeInteger(count))throw Error('Invalid total cobblestone count')}
    return count
  }
  try {
    check()
    proof=await planExposedStoneRemoval(bot,exposure,{signal,protectedPositions:external(),budgetMs:Math.min(1000,deadline-performance.now()),temporaryRetirement:RETIRE_TEMPORARY_SOIL_LANDINGS})
    check();if(!proof)throw Error('No fresh private stone-removal certificate is available')
    if(!finite(home)||!home.equals(new Vec3(...proof.home)))throw Error('Private stone home changed')
    target=new Vec3(...proof.target);stationary=proof.stage
    const watched=new Set([proof.before,proof.after,proof.pickup].flatMap(p=>p.dependencies.map(c=>c.position.join(','))))
    const columns=new Set([...watched].map(k=>{const [x,,z]=k.split(',').map(Number);return `${Math.floor(x/16)},${Math.floor(z/16)}`}))
    const protect=()=>{if([...proof.durableProtectedFeet.map(p=>new Vec3(...p)),...external(),...(!confirmed ? [bot.entity.position] : [])].some(p=>supports(target,p)))throw Error('Private stone target became a durable protected support')}
    const operational=()=>{try{check();if(!isHazardFreeBody(bot))throw Error('Private stone body entered unsafe terrain');if(stationary)settled(stationary);protect()}catch(error){fail(error)}}
    const onBlock=(before,after)=>{
      try{
        const a=before?.position,b=after?.position
        if(!finite(a)||!finite(b)||![a.x,a.y,a.z,b.x,b.y,b.z].every(Number.isInteger))return fail('Malformed private stone terrain observation')
        if(!watched.has(key(a))&&!watched.has(key(b)))return
        if(inFlight&&key(a)===key(target)&&key(b)===key(target)&&air(after)&&(matches(before,proof.expected)||air(before)))return
        if(before.name!==after.name||before.stateId!==after.stateId||Boolean(before.isWaterlogged)!==Boolean(after.isWaterlogged)||JSON.stringify(before.shapes)!==JSON.stringify(after.shapes))fail('Private stone observed terrain changed')
      }catch{fail('Malformed private stone terrain observation')}
    }
    const onColumn=p=>{try{if(!finite(p)||p.y!==0||p.x%16||p.z%16||columns.has(`${Math.floor(p.x/16)},${Math.floor(p.z/16)}`))fail('Private stone route column changed')}catch{fail('Malformed private stone column observation')}}
    const onEntity=entity=>{try{check();if(entity===bot.entity){operational();return}if(entity?.name==='item'&&Number.isSafeInteger(entity.id)&&finite(entity.position)&&bot.entities?.[entity.id]===entity&&bot.pathfinder.movements.passableEntities.has('item')&&!bot.pathfinder.movements.entitiesToAvoid.has('item'))return;fail('Entity changed during private stone collection')}catch(error){fail(error)}}
    listeners.push(['health',operational],['physicsTick',operational],['blockUpdate',onBlock],['chunkColumnLoad',onColumn],['chunkColumnUnload',onColumn])
    for(const event of ['spawn','respawn','end','terrainUntrusted'])listeners.push([event,()=>fail('Private stone session invalidated')])
    for(const event of ['entitySpawn','entityGone','entityMoved','entityUpdate'])listeners.push([event,onEntity])
    for(const [event,fn]of listeners)bot.on(event,fn)
    timer=setTimeout(()=>fail('Private stone deadline reached'),Math.max(1,deadline-performance.now()));timer.unref?.()
    monitor=setInterval(operational,50);monitor.unref?.()
    // Validate every future route dependency before committing the edit. Only
    // the one hypothetical air cell is translated back to its observed stone.
    const preEdit={dependencies:[proof.before,proof.after,proof.pickup].flatMap(p=>p.dependencies).map(cell=>cell.position.join(',')===key(target)?proof.expected:cell)}
    const validate=()=>{protect();dependencies(preEdit);settled(proof.stage);check()}
    validate();inventoryBefore=cobble();editAttempted=true;inFlight=true
    await mine(target,'stone',validate,signal,deadline,[],value=>{
      if(value?.serverObservedAir!==true)throw Error('Private stone hook lacks a confirmed raw receipt')
      confirmed=1;inFlight=false;receipt={serverObservedAir:true,stateId:value.stateId,packet:value.packet}
    })
    if(confirmed!==1)throw Error('Private stone hook returned without a confirmed receipt')
    check();protect();dependencies(proof.after);settled(proof.stage)
    dependencies(proof.pickup);stationary=null
    await walk(proof.pickup.routes.at(-1),proof.pickup.stage,signal,deadline,ownershipGuard)
    await waitSettled(proof.pickup.stage);stationary=proof.pickup.stage;dependencies(proof.pickup)
    const pickupUntil=Math.min(deadline,performance.now()+3000)
    while(performance.now()<pickupUntil){check();settled(proof.pickup.stage);acquired=Math.max(0,cobble()-inventoryBefore);inventoryCurrent=true;if(acquired>=1)break;await new Promise(r=>setTimeout(r,50))}
    if(acquired<1)throw Error('Private stone pickup did not increase observed cobblestone inventory')
    dependencies(proof.pickup);stationary=null;inventoryCurrent=false
    await walk(proof.pickup.routes[0],proof.home,signal,deadline,ownershipGuard)
    await waitSettled(proof.home);stationary=proof.home;dependencies(proof.after);dependencies(proof.pickup)
    returned=true;check();acquired=Math.max(0,cobble()-inventoryBefore);inventoryCurrent=true;if(acquired<1)throw Error('Private stone inventory gain was lost before returning home')
    return {...progress(),completed:true,target:[...proof.target],position:bot.entity.position.toArray(),health:bot.health,food:bot.food}
  }catch(error){inventoryCurrent=false;if(inventoryBefore!==null&&sameInventorySession()){try{acquired=Math.max(0,cobble()-inventoryBefore);inventoryCurrent=true}catch{}}const result=failure||(error instanceof Error?error:Error(String(error)));result.result={...result.result,...progress()};throw result}
  finally{clearTimeout(timer);clearInterval(monitor);for(const [event,fn]of listeners)bot.removeListener(event,fn)}
}

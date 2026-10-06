import test from 'node:test'
import assert from 'node:assert/strict'
import { Vec3 } from 'vec3'
import { soilActions } from './helpers/soil-actions.js'
import { planExposedStoneRemoval } from '../src/experimental/soil-stair-plan.js'
import { RETIRE_TEMPORARY_SOIL_LANDINGS } from '../src/experimental/soil-exposure-record.js'
import { terrainTrustStatus } from '../src/terrain-trust.js'

async function fixture() {
  const f = soilActions();const exposure = await f.run()
  const tool=f.bot.inventory.items()[0];let count=0,owned=true
  f.bot.inventory.items=()=>[tool,...(count?[{name:'cobblestone',type:f.bot.registry.itemsByName.cobblestone.id,count}]:[])]
  const dig=f.bot.dig
  f.bot.dig=async block=>{await dig(block);if(block.name==='stone')count++}
  const collect=()=>f.runner.run('private stone fixture',(signal,context)=>f.actions.collectExposedStone(exposure,signal,
    {actionDeadline:context.deadline,ownershipGuard:()=>owned,starterScope:'fixture/soil'}),()=>f.actions.stop())
  return {...f,exposure,collect,retireCollector:()=>{owned=false},setCount:value=>{count=value}}
}

test('private owned collection confirms one stone, observes cobblestone and returns home', async()=>{
  const f=await fixture(),r=await f.collect()
  assert.equal(r.completed,true);assert.equal(r.confirmed_stone_edits,1);assert.equal(r.cobblestone_acquired,1);assert.equal(r.returned_home,true)
  assert.equal(f.bot.entity.position.distanceTo(f.home),0)
  assert.equal(terrainTrustStatus(f.bot).trusted,true)
})

test('public execute cannot invoke private stone collector',async()=>{
  const f=await fixture()
  await assert.rejects(f.actions.execute('private_soil_collect',{exposure:f.exposure}),/owned internal invocation/)
  assert.ok(!f.actions.definitions.some(d=>(d.name??d.function?.name)==='private_soil_collect'))
})

test('new external support after exposure prevents any stone dig',async()=>{
  const f=await fixture(),before=f.counters().digs
  f.protectedPositions.push(new Vec3(3.5,63,.5))
  await assert.rejects(f.collect(),/certificate/)
  assert.equal(f.counters().digs,before)
})

test('external support introduced while equipping is rechecked before dig',async()=>{
  const f=await fixture(),before=f.counters().digs,equip=f.bot.equip
  f.bot.equip=async item=>{await equip(item);f.protectedPositions.push(new Vec3(3.5,63,.5))}
  await assert.rejects(f.collect(),/protected support/)
  assert.equal(f.counters().digs,before)
})

test('missing observed cobblestone keeps physical edit partial, never completed',async()=>{
  const f=await fixture(),dig=f.bot.dig
  f.bot.dig=async block=>{await dig(block);f.setCount(0)}
  await assert.rejects(f.collect(),error=>{
    assert.match(error.message,/increase observed cobblestone/)
    assert.equal(error.result.confirmed_stone_edits,1)
    assert.equal(error.result.completed,false)
    assert.equal(error.result.returned_home,false)
    return true
  })
})


test('changed future pickup dependency is detected before committing the stone edit',async()=>{
  const f=await fixture(),before=f.counters().digs
  const proof=await planExposedStoneRemoval(f.bot,f.exposure,{temporaryRetirement:RETIRE_TEMPORARY_SOIL_LANDINGS,protectedPositions:f.protectedPositions})
  const keys=new Set(proof.before.dependencies.map(cell=>cell.position.join(',')))
  const extra=proof.pickup.dependencies.find(cell=>!keys.has(cell.position.join(',')))
  assert.ok(extra,'fixture needs a future-route-only observation')
  const equip=f.bot.equip
  f.bot.equip=async item=>{await equip(item);f.overrides.set(extra.position.join(','),extra.name==='air'?'stone':'air')}
  await assert.rejects(f.collect(),/dependency changed/)
  assert.equal(f.counters().digs,before)
})

test('cancellation after confirmed receipt retains the physical edit and inventory evidence',async()=>{
  const f=await fixture(),read=f.bot.blockAt,dig=f.bot.dig
  let ready=false,queued=false
  f.bot.dig=async block=>{await dig(block);if(block.name==='stone')ready=true}
  f.bot.blockAt=p=>{
    const block=read(p)
    if(ready&&!queued&&p.x===3&&p.y===62&&p.z===0&&block.name==='air'){
      queued=true;queueMicrotask(()=>f.runner.stop('cancel after raw receipt'))
    }
    return block
  }
  await assert.rejects(f.collect(),error=>{
    assert.equal(error.result.confirmed_stone_edits,1)
    assert.equal(error.result.stone_receipt.serverObservedAir,true)
    assert.equal(error.result.unfinished_stone_target,null)
    assert.equal(error.result.cobblestone_acquired,1)
    assert.equal(error.result.completed,false)
    return true
  })
})


test('ownership loss after raw confirmation preserves effects without completing the task',async()=>{
  const f=await fixture(),read=f.bot.blockAt,dig=f.bot.dig
  let ready=false,queued=false
  f.bot.dig=async block=>{await dig(block);if(block.name==='stone')ready=true}
  f.bot.blockAt=p=>{const block=read(p);if(ready&&!queued&&p.x===3&&p.y===62&&p.z===0&&block.name==='air'){queued=true;queueMicrotask(f.retireCollector)}return block}
  await assert.rejects(f.collect(),error=>{
    assert.equal(error.result.confirmed_stone_edits,1)
    assert.equal(error.result.cobblestone_acquired,1)
    assert.equal(error.result.completed,false)
    return true
  })
})

for(const leg of [1,2])test(`ownership replacement during private walk ${leg} stops and retains observed gain`,async()=>{
  const f=await fixture();let walked=0
  f.bot.on('goal_reached',()=>{if(++walked===leg)f.retireCollector()})
  await assert.rejects(f.collect(),error=>{
    assert.equal(error.result.confirmed_stone_edits,1)
    assert.equal(error.result.cobblestone_acquired,1)
    assert.equal(error.result.completed,false)
    assert.equal(error.result.returned_home,false)
    return true
  })
})

test('cancellation during an unconfirmed dig keeps the physical lock until the dig drains',async()=>{
  const f=await fixture();let entered=false,release
  f.bot.dig=()=>new Promise(resolve=>{entered=true;release=resolve})
  const pending=f.collect(),until=Date.now()+4000
  while(!entered){assert.ok(Date.now()<until);await new Promise(r=>setImmediate(r))}
  f.runner.stop('stop pending private stone dig')
  assert.equal(terrainTrustStatus(f.bot).trusted,false)
  await assert.rejects(f.runner.run('other',async()=>{}),/Still stopping/)
  release()
  await assert.rejects(pending,error=>{
    assert.equal(error.result.confirmed_stone_edits,0)
    assert.deepEqual(error.result.unfinished_stone_target,[3,62,0])
    assert.equal(error.result.completed,false)
    return true
  })
  assert.equal(f.runner.active,null)
})

test('inventory lost on the return leg prevents completed collection',async()=>{
  const f=await fixture();let walked=0
  f.bot.on('goal_reached',()=>{if(++walked===2)f.setCount(0)})
  await assert.rejects(f.collect(),error=>{
    assert.match(error.message,/inventory gain was lost/)
    assert.equal(error.result.cobblestone_acquired,0)
    assert.equal(error.result.returned_home,true)
    assert.equal(error.result.completed,false)
    return true
  })
})

test('pathfinder replacement during pickup leaves successor controls untouched',async()=>{
  const f=await fixture();let cleared=0,successor
  f.bot.once('goal_reached',()=>{
    successor={...f.bot.pathfinder,goal:{successor:true},setGoal:goal=>{if(goal===null)cleared++}}
    f.bot.pathfinder=successor
  })
  await assert.rejects(f.collect(),error=>{
    assert.equal(error.result.confirmed_stone_edits,1)
    assert.equal(error.result.cobblestone_acquired,1)
    assert.equal(error.result.inventory_observation_current,true)
    return true
  })
  assert.equal(cleared,0)
  assert.deepEqual(successor.goal,{successor:true})
})

test('malformed movement policy on an item event halts without throwing through the emitter',async()=>{
  const f=await fixture()
  f.bot.dig=async()=>{
    const item={id:99,name:'item',position:new Vec3(3.5,62,.5)}
    f.bot.entities[item.id]=item
    f.bot.pathfinder.movements.passableEntities=null
    assert.doesNotThrow(()=>f.bot.emit('entityMoved',item))
  }
  await assert.rejects(f.collect(),/policy|cancelled/i)
  assert.equal(f.runner.active,null)
  assert.equal(terrainTrustStatus(f.bot).trusted,false)
})

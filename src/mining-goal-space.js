import { Vec3 } from 'vec3'
export const MINING_NO_GOAL_SPACE = 'MINING_NO_GOAL_SPACE'

// A rejection-only preflight for the pinned integer-node walking planner.
// It proves no interaction stance exists; it never certifies a route. Partial
// geometry, missing observations and exhausted time defer to normal planning.
export function inspectMiningGoalSpace (bot, movements, goal, { budgetMs = 20, signal, now = () => performance.now() } = {}) {
  const started = now(), unknown = reason => ({ status: 'unknown', reason })
  if (bot.version !== '1.21.8' || movements.canDig !== false || movements.canOpenDoors !== false || movements.allowParkour !== false || movements.allow1by1towers !== false || movements.allowFreeMotion !== false) return unknown('unsupported movement policy')
  if (typeof bot.world?.raycast !== 'function' || !Number.isFinite(goal.reach) || goal.reach <= 0 || goal.reach > 4 || !Number.isFinite(goal.eyeHeight) || goal.eyeHeight <= 0 || goal.eyeHeight > 3 || !Number.isFinite(budgetMs) || budgetMs <= 0) return unknown('unsupported goal or budget')
  const target=goal.target
  if (!target || !['x','y','z'].every(k=>Number.isInteger(target[k]))) return unknown('invalid target')
  const unresolved=Symbol('unresolved'), blocks=new Map()
  const check=()=>{signal?.throwIfAborted();if(now()-started>=budgetMs)throw unresolved}
  const fullCube=b=>b.boundingBox==='block' && b.shapes?.length===1 && b.shapes[0].length===6 && b.shapes[0].every((value,i)=>value===(i<3?0:1))
  const read=p=>{
    check();p=p.floored();const key=p.toString();if(blocks.has(key))return blocks.get(key)
    const b=bot.blockAt(p)
    if(!b || !Array.isArray(b.shapes) || (b.shapes.length&&!fullCube(b)) || movements.climbables?.has(b.type) || movements.carpets?.has(b.type))throw unresolved
    blocks.set(key,b);return b
  }
  const world={getBlock:read,raycast(...args){const hit=bot.world.raycast.apply(this,args);if(hit&&typeof hit.then==='function'){Promise.resolve(hit).catch(()=>{});throw unresolved}return hit}}
  const probe=Object.assign(Object.create(Object.getPrototypeOf(goal)),goal,{world})
  const blocked=b=>fullCube(b) || movements.blocksToAvoid?.has(b.type) || b.isWaterlogged===true
  try {
    // A* accepts its initial node before generating validated neighbors.
    const start=bot.entity.position.floored()
    // Pinned pathfinder can raise its initial integer node on a partial-height
    // grounded block. Include both possibilities rather than narrow that case.
    if(probe.isEnd(start)||probe.isEnd(start.offset(0,1,0)))return {status:'possible',initial:true}
    const radius=Math.ceil(goal.reach+1)
    const lowY=Math.floor(target.y-goal.reach-goal.eyeHeight)-1
    const highY=Math.ceil(target.y+1+goal.reach-goal.eyeHeight)+1
    if((2*radius+1)**2*(highY-lowY+2)>4096)return unknown('enumeration cap')
    // Load the whole ray/body envelope. No unloaded gap can be interpreted as
    // opaque terrain or empty space. Bounds deliberately overapproximate reach.
    for(let x=target.x-radius;x<=target.x+radius;x++)for(let y=lowY;y<=highY+1;y++)for(let z=target.z-radius;z<=target.z+radius;z++)read(new Vec3(x,y,z))
    let examined=0
    for(let x=target.x-radius;x<=target.x+radius;x++)for(let y=lowY;y<=highY;y++)for(let z=target.z-radius;z<=target.z+radius;z++){
      check();const node=new Vec3(x,y,z);examined++
      if(!blocked(read(node))&&!blocked(read(node.offset(0,1,0)))&&probe.isEnd(node))return {status:'possible',examined}
    }
    check();return {status:'none',examined,observed:blocks.size}
  } catch(error) {
    signal?.throwIfAborted()
    if(error===unresolved)return unknown('partial, unloaded or time-limited observation')
    return unknown('observation failed')
  }
}

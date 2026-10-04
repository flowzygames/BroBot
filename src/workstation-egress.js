import { Vec3 } from 'vec3';
import pathfinder from 'mineflayer-pathfinder';
import { planReturnablePath, isFluidBearingBlock, STARTER_AVOID_BLOCK_NAMES } from './navigation-guards.js';

// Preserve a nontrivial local walking exit before placing an automatic
// workstation. This is a local egress proof, not a promise of a route home.
export async function certifyWorkstationEgress(bot, movements, target, name, { signal, budgetMs = 600 } = {}) {
  signal?.throwIfAborted();
  const position = bot.entity?.position;
  if (!position || !target || !bot.entity.onGround || Math.abs(position.y-Math.round(position.y)) > 0.05 || !Number.isFinite(budgetMs) || budgetMs <= 0) return null;
  const overlaps = () => { const p=bot.entity.position; return p.x+0.31>target.x && p.x-0.31<target.x+1 && p.z+0.31>target.z && p.z-0.31<target.z+1 && p.y+(bot.entity.height??1.8)>target.y && p.y<target.y+1; };
  if(overlaps())return null;
  const originalPosition = position.clone();
  const start = position.floored(), deadline = performance.now() + Math.min(600, budgetMs);
  const definition = bot.registry.blocksByName[name];
  if (!definition || !['crafting_table', 'furnace'].includes(name)) return null;
  const unsafe = block => !block || isFluidBearingBlock(block) || STARTER_AVOID_BLOCK_NAMES.includes(block.name);
  const standing = (read, p) => {
    const feet = read(p), head = read(p.offset(0,1,0)), floor = read(p.offset(0,-1,0));
    return ![feet,head,floor].some(unsafe) && feet.boundingBox === 'empty' && head.boundingBox === 'empty' && floor.boundingBox === 'block';
  };
  const reads = new Map();
  const fingerprint = block => block ? JSON.stringify([block.name,block.stateId,block.boundingBox,block.shapes,Boolean(block.isWaterlogged)]) : null;
  const read = p => {
    const block=bot.blockAt(p), key=p.toString();
    if(!reads.has(key))reads.set(key,{position:p.clone(),value:fingerprint(block)});
    return block;
  };
  const targetBlock=read(target), support=read(target.offset(0,-1,0));
  if(unsafe(targetBlock)||unsafe(support)||targetBlock.boundingBox!=='empty'||support.boundingBox!=='block')return null;
  const validate = () => !signal?.aborted && bot.entity.onGround && !overlaps() && Math.abs(bot.entity.position.y-Math.round(bot.entity.position.y))<=0.05 && bot.entity.position.distanceTo(originalPosition) <= 0.1
    && [...reads.values()].every(entry=>fingerprint(bot.blockAt(entry.position))===entry.value);
  const view = placed => {
    const virtual = Object.create(bot);
    virtual.entity = { ...bot.entity, position: position.clone() };
    virtual.entities = Object.fromEntries(Object.entries(bot.entities ?? {}).map(([id,entity])=>[id,entity===bot.entity?virtual.entity:entity]));
    virtual.blockAt = p => {
      const q = p.floored();
      if (placed && q.equals(target)) return { name, type: definition.id, stateId: definition.defaultState, position:q, boundingBox:'block', shapes:[[0,0,0,1,1,1]], isWaterlogged:false };
      const block = read(q);
      return block ? { ...block, position:q, shapes:(block.shapes ?? []).map(shape => [...shape]) } : null;
    };
    const graph = Object.create(movements);
    graph.bot = virtual;
    graph.entityIntersections = { ...movements.entityIntersections };
    graph.canDig = false; graph.allowParkour = false; graph.allow1by1towers = false; graph.canOpenDoors = false; graph.allowFreeMotion = false; graph.scafoldingBlocks = [];
    graph.getNeighbors = node => movements.getNeighbors.call(graph, node).filter(next => next.distanceTo(start) <= 6 && !next.toBreak?.length && !next.toPlace?.length && !next.parkour && standing(virtual.blockAt, next));
    return { bot:virtual, graph };
  };
  const baseline = view(false), placed = view(true);
  if (!standing(baseline.bot.blockAt, start) || !standing(placed.bot.blockAt, start)) return null;
  const candidates = [];
  for (let r=2;r<=4;r++) for (let dx=-r;dx<=r;dx++) for (let dz=-r;dz<=r;dz++) for (const dy of [0,-1,1]) {
    if(Math.max(Math.abs(dx),Math.abs(dz))!==r)continue;
    const p=start.offset(dx,dy,dz);
    if (!p.equals(target) && standing(baseline.bot.blockAt,p) && standing(placed.bot.blockAt,p)) candidates.push(p);
  }
  for (const witness of candidates.slice(0,12)) {
    signal?.throwIfAborted();
    if (performance.now() >= deadline) return null;
    try {
      for (const v of [baseline,placed]) {
        const remaining=deadline-performance.now(); if(remaining<=0)return null;
        await planReturnablePath(v.bot,v.graph,new pathfinder.goals.GoalBlock(witness.x,witness.y,witness.z),new pathfinder.goals.GoalBlock(start.x,start.y,start.z),{signal,planningBudget:Math.min(100,remaining),fixedEndpoint:witness});
      }
      if (!validate()) return null;
      return { witness:witness.toArray(), origin:start.toArray(), localRadius:6, validate };
    } catch(error) { if(signal?.aborted || error.name==='AbortError')throw error; }
  }
  return null;
}

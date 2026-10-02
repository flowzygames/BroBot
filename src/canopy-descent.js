import { Vec3 } from 'vec3';
import pf from 'mineflayer-pathfinder';
import { retainedLeafAnchor } from './construction-guards.js';
import { WATER_BEARING_BLOCK_NAMES, isFluidBearingBlock } from './navigation-guards.js';
const air = b => b && ['air','cave_air','void_air'].includes(b.name) && b.boundingBox === 'empty' && !isFluidBearingBlock(b);
const cube = b => b?.boundingBox === 'block' && b.shapes?.length === 1 && b.shapes[0].length === 6 && b.shapes[0].every((v,i) => v === (i < 3 ? 0 : 1)) && !isFluidBearingBlock(b);

// Read-only, one-step descent proposal. No coordinate templates from test worlds.
// The executor must re-plan at its actual grounded position before mutation.
export async function planLeafNotch(bot, home, { signal, budgetMs = 400, maxCandidates = 8 } = {}) {
  const m = bot.pathfinder?.movements, position = bot.entity?.position;
  if (!position || !home || !['x','y','z'].every(k => Number.isInteger(home[k])) || !bot.entity.onGround || Math.abs(position.y-Math.round(position.y)) > .03) return null;
  if (!m || m.canDig !== false || m.canOpenDoors !== false || m.allowFreeMotion !== false || m.allowParkour !== false || m.allow1by1towers !== false || m.scafoldingBlocks?.length !== 0 || m.maxDropDown !== 3 || !bot.world?.raycast) return null;
  if (WATER_BEARING_BLOCK_NAMES.some(n => bot.registry.blocksByName[n] && !m.blocksToAvoid.has(bot.registry.blocksByName[n].id))) return null;
  if (!Number.isFinite(budgetMs) || budgetMs <= 0 || !Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 8) return null;
  const origin=position.floored(), homeCell=new Vec3(home.x,home.y,home.z), eye=position.offset(0,bot.entity.eyeHeight??1.62,0), deadline=performance.now()+budgetMs;
  if(origin.distanceTo(homeCell)>90) return null;
  const check=()=>{signal?.throwIfAborted();return performance.now()<deadline;};
  const view=removed=>{
    const virtual=Object.create(bot);let unknown=false;
    virtual.blockAt=p=>{
      const q=p.floored();
      if(removed?.equals(q))return {name:'air',type:bot.registry.blocksByName.air.id,position:q,boundingBox:'empty',shapes:[],isWaterlogged:false};
      const b=bot.blockAt(q);if(!b){unknown=true;return null;}
      return {...b,position:q,shapes:(b.shapes??[]).map(s=>[...s])};
    };
    const graph=Object.create(m);graph.bot=virtual;graph.entityIntersections={...m.entityIntersections};graph.exclusionAreasStep=[...m.exclusionAreasStep,b=>isFluidBearingBlock(b)?1000:0];
    return {graph,blockAt:virtual.blockAt,unknown:()=>unknown};
  };
  const path=async(v,start,end)=>{
    if(!check())return null;
    const generator=bot.pathfinder.getPathFromTo(v.graph,start,new pf.goals.GoalBlock(end.x,end.y,end.z),{timeout:Math.max(1,Math.min(50,deadline-performance.now())),tickTimeout:15,optimizePath:false});
    try {
      for(const value of generator){
        if(!check())return null;
        const r=value.result;
        if(r.status==='partial'){await new Promise(resolve=>setTimeout(resolve,0));continue;}
        if(r.status!=='success'||v.unknown()||r.path.some(n=>n.toBreak?.length||n.toPlace?.length||n.parkour))return null;
        return [start.floored(),...r.path.map(n=>new Vec3(n.x,n.y,n.z))];
      }
    } finally {generator.return?.();}
    return null;
  };
  const baseline=view(null);
  if(!await path(baseline,position,homeCell)||!await path(baseline,homeCell,origin))return null;
  let examined=0;
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++){
    if(!dx&&!dz)continue;
    if(++examined>maxCandidates||!check())return null;
    const target=origin.offset(dx,-1,dz), b=bot.blockAt(target);
    if(!cube(b)||!/_leaves$/.test(b.name)||b.diggable===false||!air(bot.blockAt(target.offset(0,1,0)))||!air(bot.blockAt(target.offset(0,2,0)))||!cube(bot.blockAt(target.offset(0,-1,0))))continue;
    if(position.x+.31>target.x&&position.x-.31<target.x+1&&position.z+.31>target.z&&position.z-.31<target.z+1)continue;
    const neighbors=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]].map(d=>bot.blockAt(target.offset(...d)));
    if(neighbors.some(n=>!n||isFluidBearingBlock(n)))continue;
    const delta=target.offset(.5,.5,.5).minus(eye),distance=delta.norm();
    if(distance>4.2||!bot.world.raycast(eye,delta.scaled(1/distance),distance+.01)?.position?.equals(target))continue;
    const v=view(target),paths=[];
    for(const [start,end] of [[position,target],[target,homeCell],[homeCell,target]]){const route=await path(v,start,end);if(!route)break;paths.push(route);}
    if(paths.length!==3)continue;
    const protectedBlocks=new Map();let safe=true;
    // Conservatively protect adjacent solid floors as well as path endpoints,
    // covering the contact footprint near turns and jump transitions.
    for(const node of paths.flat())for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){
      const floor=node.offset(x,-1,z),support=v.blockAt(floor);
      if(!support||isFluidBearingBlock(support)){safe=false;continue;}
      if([node,node.offset(0,1,0)].some(p=>{const b=v.blockAt(p);return !b||isFluidBearingBlock(b);})){safe=false;continue;}
      if(!/_leaves$/.test(support.name))continue;
      const proof=retainedLeafAnchor(v.blockAt,floor);
      if(!proof){safe=false;continue;}
      for(const a of [...proof.leaves,proof.anchor])protectedBlocks.set(a.join(','),a);
    }
    if(!safe||v.unknown()||!check())continue;
    const corridor=new Map();
    for(const node of paths.flat())for(let x=-1;x<=1;x++)for(let y=-1;y<=1;y++)for(let z=-1;z<=1;z++){
      const p=node.offset(x,y,z),block=v.blockAt(p);
      if(!block||isFluidBearingBlock(block)){safe=false;continue;}
      corridor.set(p.toArray().join(','),{position:p.toArray(),name:block.name,shapes:block.shapes.map(s=>[...s])});
    }
    if(!safe||!check())continue;
    return {corridor:[...corridor.values()],stage:origin.toArray(),landing:target.toArray(),home:homeCell.toArray(),dig:{x:target.x,y:target.y,z:target.z,expected_block:b.name},protectedBlocks:[...protectedBlocks.values()],routes:paths.map(p=>p.map(n=>n.toArray()))};
  }
  return null;
}

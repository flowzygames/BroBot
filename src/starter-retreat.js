import { Vec3 } from 'vec3';
import pathfinderPackage from 'mineflayer-pathfinder';
import { planReturnablePath, walkToGoal } from './navigation-guards.js';
import { isDryLanding, isHazardFreeBody, hasObservedStandingSupport } from './body-hazards.js';
import { hasAnchoredLeafLanding } from './starter-leaf-support.js';
import { observeGroundForRetreat } from './hostile-ground-observation.js';
import { ownOxygenLevel } from './oxygen.js';
import { STARTER_MIN_HEALTH, STARTER_MOVEMENT_RADIUS } from './starter-limits.js';

const { Movements, goals }=pathfinderPackage;
const MELEE=new Set(['zombie','husk','zombie_villager']);
const finite=p=>p&&['x','y','z'].every(k=>Number.isFinite(p[k]));
const need=(value,message)=>{if(!value)throw Error(message);};
const plain=p=>({x:p.x,y:p.y,z:p.z});
const segmentDistance=(p,a,b)=>{
  const dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=dx*dx+dy*dy+dz*dz;
  const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy+(p.z-a.z)*dz)/length)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy,p.z-a.z-t*dz);
};

export function recoveryStandingSpace(bot,position) {
  if(!finite(position))return false;
  const half=bot.physics?.playerHalfWidth??.3,height=bot.physics?.playerHeight??1.8;
  if(!Number.isFinite(half)||half<=0||half>1||!Number.isFinite(height)||height<=0||height>4)return false;
  const rounded=Math.round(position.y),y=Math.abs(position.y-rounded)<=.03?rounded:position.y;
  const p=new Vec3(position.x,y,position.z);
  const shadow={entity:{position:p,onGround:true},physics:bot.physics,blockAt:q=>bot.blockAt(q)};
  if(!isHazardFreeBody(shadow)||!hasObservedStandingSupport(shadow)||!hasAnchoredLeafLanding(bot,p))return false;
  try{
    for(let x=Math.floor(p.x-half+1e-7);x<=Math.floor(p.x+half-1e-7);x++)for(let z=Math.floor(p.z-half+1e-7);z<=Math.floor(p.z+half-1e-7);z++)
      for(let h=Math.floor(p.y+1e-7);h<=Math.floor(p.y+height-1e-7);h++)if(bot.blockAt(new Vec3(x,h,z))?.boundingBox!=='empty')return false;
  }catch{return false;}
  return true;
}

// Private starter-only action. One short leg, then pause. This is not combat,
// continuous fleeing, or a guarantee against a later attack.
export async function runStarterRetreat(bot,args,{signal,check,guard,abort,prepareMovement}) {
  need(typeof guard==='function','Recovery requires an active starter identity guard');
  need(finite(args.home)&&Number.isSafeInteger(args.sourceId),'Recovery requires a valid home and explicit attacker');
  const remaining=()=>args.deadline-performance.now();
  need(Number.isFinite(args.deadline)&&remaining()>0&&remaining()<=8000,'Recovery has no valid remaining deadline');
  const source=bot.entities?.[args.sourceId];
  need(source?.id===args.sourceId&&source.type==='hostile'&&MELEE.has(source.name)&&finite(source.position),'Only an observed supported melee attacker can trigger this retreat');
  let origin=null,frame=null,constrained=null,base=null,failure=null,walking=false,terrainRevision=0,pathGuard=null;
  let watchedNodes=[],anchorSupports=[],reverseNodes=[];
  const baseline=new Map();
  const threats=()=>{
    need(bot.entities?.[args.sourceId]===source&&finite(source.position),'Recovery attacker observation changed');
    const entities=Object.values(bot.entities??{});need(entities.length<=1024,'Too many entities to verify a bounded retreat');
    need(entities.filter(e=>e.type==='hostile').every(e=>finite(e.position)),'Recovery has an unknown hostile position');
    const hostiles=entities.filter(e=>e.type==='hostile'&&finite(e.position)&&e.position.distanceTo(bot.entity.position)<=16);
    need(hostiles.length<=8&&hostiles.includes(source)&&hostiles.every(e=>MELEE.has(e.name)),'Nearby threat context exceeds the melee-only recovery scope');
    const players=entities.filter(e=>e.id!==bot.entity.id&&(e.type==='player'||typeof e.username==='string'));
    need(players.every(e=>finite(e.position)),'Recovery has an unknown player position');
    return {hostiles,players};
  };
  const pointAllowed=position=>{
    if(!finite(position)||!origin||position.distanceTo(origin)>8||position.distanceTo(new Vec3(args.home.x,args.home.y,args.home.z))>STARTER_MOVEMENT_RADIUS)return false;
    for(const e of frame.hostiles){
      const minimum=baseline.get(e.id);if(minimum==null||position.distanceTo(e.position)+.35<minimum)return false;
    }
    return frame.players.every(e=>position.distanceTo(e.position)>=1.25);
  };
  const safety=()=>{
    if(failure)throw failure;
    check();guard();need(remaining()>0,'Hostile recovery deadline expired');
    need(bot.game?.dimension===args.dimension,'Recovery dimension changed');
    need(finite(bot.entity?.position)&&bot.entity.position.distanceTo(new Vec3(args.home.x,args.home.y,args.home.z))<=STARTER_MOVEMENT_RADIUS,'Recovery left the starter boundary');
    need(Number.isFinite(bot.health)&&bot.health>STARTER_MIN_HEALTH,'Recovery health is too low or unknown');
    const air=ownOxygenLevel(bot);need(!Number.isFinite(air)||air>10,'Recovery air is too low');
    need(isHazardFreeBody(bot),'Recovery encountered unknown or hazardous body space');
    frame=threats();
    if(origin){
      need(frame.hostiles.every(e=>baseline.has(e.id)),'A new hostile entered the recovery area');
      need(pointAllowed(bot.entity.position),'Recovery no longer preserves local threat spacing');
    }
    if(walking){
      need(bot.entity.onGround===true&&Number.isFinite(bot.entity.velocity?.y)&&bot.entity.velocity.y<=0&&Math.abs(bot.entity.position.y-origin.y)<=.03&&bot.getControlState('jump')!==true,'Grounded-only retreat was interrupted by an airborne or jump state');
      need(recoveryStandingSpace(bot,bot.entity.position),'Recovery lost its supported footing');
    }
  };
  const fail=error=>{failure??=error;abort(failure);};
  const monitor=()=>{try{safety();}catch(error){fail(error);}};
  const watch=nodes=>{
    need(nodes.length<=1024,'Recovery corridor exceeds its evidence bound');
    watchedNodes=nodes.map(p=>new Vec3(p.x,p.y,p.z));
    // Include adjacent swept corner cells, not just node centers: a diagonal
    // can depend on a leaf whose remote anchor is outside the route corridor.
    const supports=new Map();
    for(const node of watchedNodes)for(let x=-1;x<=1;x++)for(let z=-1;z<=1;z++){
      const p=node.offset(x,-1,z);
      if(/_leaves$/.test(bot.blockAt(p)?.name??''))supports.set(`${p.x},${p.y},${p.z}`,p);
    }
    anchorSupports=[...supports.values()];
  };
  const relevant=position=>!finite(position)||watchedNodes.some(p=>Math.abs(p.x-position.x)<=1&&Math.abs(p.z-position.z)<=1&&position.y>=p.y-1&&position.y<=p.y+2)
    ||anchorSupports.some(p=>Math.abs(p.x-position.x)+Math.abs(p.y-position.y)+Math.abs(p.z-position.z)<=6);
  const changedBlock=(oldBlock,newBlock)=>{terrainRevision++;if(walking&&relevant(newBlock?.position??oldBlock?.position))fail(Error('Observed recovery corridor changed during movement'));};
  const relevantChunk=corner=>{
    if(!corner||!Number.isInteger(corner.x)||!Number.isInteger(corner.z)||corner.x%16||corner.z%16)return true;
    const distance=(value,min)=>Math.max(min-value,0,value-(min+15));
    return watchedNodes.some(p=>distance(p.x,corner.x)<=1&&distance(p.z,corner.z)<=1)
      ||anchorSupports.some(p=>distance(p.x,corner.x)+distance(p.z,corner.z)<=6);
  };
  const changedChunk=corner=>{terrainRevision++;if(walking&&relevantChunk(corner))fail(Error('Loaded recovery corridor changed during movement'));};
  const timer=setTimeout(()=>fail(Error('Hostile recovery deadline expired')),Math.max(0,remaining()));
  bot.on('physicsTick',monitor);
  bot.on('blockUpdate',changedBlock);bot.on('chunkColumnLoad',changedChunk);bot.on('chunkColumnUnload',changedChunk);
  try{
    safety();
    need(await observeGroundForRetreat(bot,{signal,deadline:args.deadline,check:safety}),'Recovery could not observe stable supported ground');
    safety();origin=bot.entity.position.clone();
    need(Math.abs(origin.y-Math.round(origin.y))<=.03&&recoveryStandingSpace(bot,origin),'Recovery requires clear full-height standing space');
    const initialSeparation=origin.distanceTo(source.position);
    for(const e of frame.hostiles)baseline.set(e.id,Math.min(4,origin.distanceTo(e.position)));
    const feet=new Vec3(Math.floor(origin.x),Math.round(origin.y),Math.floor(origin.z));
    const candidates=[[6,0],[-6,0],[0,6],[0,-6]].map(([x,z])=>feet.offset(x,0,z)).filter(p=>{
      const center=p.offset(.5,0,.5);
      return pointAllowed(center)&&recoveryStandingSpace(bot,center)&&center.distanceTo(source.position)>=initialSeparation+2&&frame.hostiles.every(e=>center.distanceTo(e.position)>=4);
    }).sort((a,b)=>Math.min(...frame.hostiles.map(e=>b.offset(.5,0,.5).distanceTo(e.position)))-Math.min(...frame.hostiles.map(e=>a.offset(.5,0,.5).distanceTo(e.position)))||a.x-b.x||a.z-b.z);
    need(candidates.length,'No observed local retreat destination improves separation');
    base=prepareMovement();constrained=new Movements(bot);Object.assign(constrained,base);
    constrained.canDig=false;constrained.canOpenDoors=false;constrained.allow1by1towers=false;constrained.allowParkour=false;constrained.allowFreeMotion=false;constrained.maxDropDown=0;constrained.scafoldingBlocks=[];
    const spacingNode=p=>finite(p)&&pointAllowed(new Vec3(p.x+.5,p.y,p.z+.5));
    const allowedNode=p=>spacingNode(p)&&p.y===feet.y&&recoveryStandingSpace(bot,new Vec3(p.x+.5,p.y,p.z+.5));
    const edgeAllowed=(a,b)=>{
      if(!allowedNode(a)||!allowedNode(b)||Math.abs(a.x-b.x)>1||Math.abs(a.z-b.z)>1||a.y!==b.y)return false;
      const from=new Vec3(a.x+.5,a.y,a.z+.5),to=new Vec3(b.x+.5,b.y,b.z+.5),half=bot.physics?.playerHalfWidth??.3;
      // Conservative swept footprint: reject unsafe corner cells even where
      // a diagonal centerline alone would miss the player's body width.
      for(let x=Math.floor(Math.min(from.x,to.x)-half+1e-7);x<=Math.floor(Math.max(from.x,to.x)+half-1e-7);x++)
        for(let z=Math.floor(Math.min(from.z,to.z)-half+1e-7);z<=Math.floor(Math.max(from.z,to.z)+half-1e-7);z++)if(!allowedNode(new Vec3(x,a.y,z)))return false;
      return frame.hostiles.every(e=>segmentDistance(e.position,from,to)+.35>=baseline.get(e.id))&&frame.players.every(e=>segmentDistance(e.position,from,to)>=1.25);
    };
    // The library also asks exclusion callbacks about head blocks, so keep
    // feet/support certification on actual movement nodes instead.
    constrained.exclusionAreasStep=[...base.exclusionAreasStep,block=>spacingNode(block.position)?0:1000];
    const neighbors=constrained.getNeighbors;
    constrained.getNeighbors=function(node){return neighbors.call(this,node).filter(next=>!next.toBreak?.length&&!next.toPlace?.length&&edgeAllowed(node,next));};
    bot.pathfinder.setMovements(constrained);
    const planningEnd=Math.min(args.deadline,performance.now()+1600),attempts=[];let destination=null;
    for(let index=0;index<candidates.length;index++){
      safety();const budget=Math.min(remaining(),planningEnd-performance.now());if(budget<=0)break;
      const p=candidates[index],goal=new goals.GoalBlock(p.x,p.y,p.z);
      try{
        const revision=terrainRevision;let certified;
        await planReturnablePath(bot,constrained,goal,new goals.GoalNear(feet.x,feet.y,feet.z,1),{signal,fixedEndpoint:p,planningBudget:budget/(candidates.length-index),validateNode:allowedNode,onCertifiedPaths:paths=>{certified=paths;}});
        safety();need(recoveryStandingSpace(bot,p.offset(.5,0,.5))&&allowedNode(p),'Retreat destination changed after planning');
        need(revision===terrainRevision,'Terrain changed during retreat certification');
        reverseNodes=certified.reverse;watch([feet,...certified.forward,...reverseNodes]);
        attempts.push({destination:plain(p),verified:true});destination=p;break;
      }catch(error){safety();attempts.push({destination:plain(p),verified:false,reason:error.message});}
    }
    need(destination,'No verified local retreat route');
    pathGuard=result=>{
      if(!walking)return;
      try{
        safety();need(result?.status==='success'&&Array.isArray(result.path)&&result.path.length<=512,'Live retreat replan is not fully verified');
        const nodes=result.path.map(p=>{
          need(finite(p)&&!p.toBreak?.length&&!p.toPlace?.length&&Math.abs(p.y-Math.round(p.y))<=.03,'Live retreat replan has unsupported geometry');
          return new Vec3(Math.floor(p.x),Math.round(p.y),Math.floor(p.z));
        });
        need(nodes.length?nodes.at(-1).equals(destination):bot.entity.position.floored().equals(destination),'Live retreat replan ended at another destination');
        let previous=new Vec3(Math.floor(bot.entity.position.x),Math.round(bot.entity.position.y),Math.floor(bot.entity.position.z));
        for(const node of nodes){need(allowedNode(node)&&edgeAllowed(previous,node),'Live retreat replan crossed unsafe terrain');previous=node;}
        watch([feet,...nodes,...reverseNodes]);
      }catch(error){fail(error);}
    };
    bot.on('path_update',pathGuard);
    walking=true;
    await walkToGoal(bot,new goals.GoalBlock(destination.x,destination.y,destination.z),{signal,timeoutMs:Math.min(4000,remaining()),stallMs:1800,pollMs:50});
    safety();
    need(await observeGroundForRetreat(bot,{signal,deadline:Math.min(args.deadline,performance.now()+500),check:safety}),'Retreat did not finish on verified ground');
    safety();
    need(bot.entity.position.floored().equals(destination)&&isDryLanding(bot)&&recoveryStandingSpace(bot,bot.entity.position),'Retreat ended outside its certified destination');
    const separation=bot.entity.position.distanceTo(source.position);
    need(separation>=4&&separation>=initialSeparation+2&&frame.hostiles.every(e=>bot.entity.position.distanceTo(e.position)>=4),'Retreat ended without enough observed melee separation');
    return {separated:true,sourceId:source.id,from:plain(origin),position:plain(bot.entity.position),destination:plain(destination),initialSeparation,observedSeparation:separation,routeAttempts:attempts,note:'Momentary observed melee separation only; gathering stays paused and the world keeps running.'};
  }catch(error){throw failure??error;}
  finally{
    clearTimeout(timer);bot.removeListener('physicsTick',monitor);
    bot.removeListener('blockUpdate',changedBlock);bot.removeListener('chunkColumnLoad',changedChunk);bot.removeListener('chunkColumnUnload',changedChunk);
    if(pathGuard)bot.removeListener('path_update',pathGuard);
    if(constrained&&bot.pathfinder.movements===constrained)bot.pathfinder.setMovements(base);
  }
}

import { Vec3 } from 'vec3';
import { retainedLeafAnchor } from './construction-guards.js';

export const STARTER_SUPPORT_PROTECTED = 'STARTER_SUPPORT_PROTECTED';
const valid = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= (k === 'y' ? 2048 : 29999984));
const refuse = (message, support) => Object.assign(new Error(message), { code:STARTER_SUPPORT_PROTECTED, ...(support ? { support:{x:support.x,y:support.y,z:support.z} } : {}) });

// A pickup destination can be detached before it ever becomes a retained
// waypoint. This checks only the landing footprint, not every traversed cell.
// Do not cache across planning or packet settlement: anchors can disappear.
export function hasAnchoredLeafLanding(bot, position) {
  if (!valid(position) || typeof bot.blockAt !== 'function') return false;
  const half = bot.physics?.playerHalfWidth ?? .3;
  if (!Number.isFinite(half) || half <= 0 || half > 1) return false;
  const top = Math.round(position.y);
  const y = Math.abs(position.y-top) <= .03 ? top-1 : Math.floor(position.y-1e-7);
  try {
    for (let x = Math.floor(position.x-half+1e-7); x <= Math.floor(position.x+half-1e-7); x++) {
      for (let z = Math.floor(position.z-half+1e-7); z <= Math.floor(position.z+half-1e-7); z++) {
        const p = new Vec3(x,y,z), block = bot.blockAt(p);
        if (!block) return false;
        if (/_leaves$/.test(block.name) && !retainedLeafAnchor(q => bot.blockAt(q),p)) return false;
      }
    }
    return true;
  } catch { return false; }
}

// Conservative protection for currently observed leaf supports at retained
// positions. This is not a reservation of every route, nor a decay prediction.
export function assertStarterLeafSupport(bot, target, { home, positions = [] } = {}) {
  if (!/_(log|leaves)$/.test(target?.name ?? '')) return;
  if (!valid(target.position) || !['x','y','z'].every(k => Number.isInteger(target.position[k]))) throw refuse('Starter mining requires a valid target position');
  if (!valid(home) || !Array.isArray(positions) || positions.length > 128) throw refuse('Starter mining requires bounded, valid support evidence');
  const current=bot.entity?.onGround === true ? bot.entity.position : null;
  const points=[home,...positions];
  if (current) points.push(current);
  const supports=new Map();
  for (const point of points) {
    if (!valid(point) || point.onGround === false || (point!==current && Math.hypot(point.x-home.x,point.y-home.y,point.z-home.z)>256)) continue;
    // Do not round an airborne/interpolated arrival such as73.54 into an
    // observed full-block standing height. Keep the established0.03 tolerance.
    const top=Math.round(point.y);
    if (Math.abs(point.y-top)>0.03) continue;
    for(let x=Math.floor(point.x-.31);x<=Math.floor(point.x+.31);x++)for(let z=Math.floor(point.z-.31);z<=Math.floor(point.z+.31);z++){
      const support=new Vec3(x,top-1,z);
      if(Math.abs(target.position.x-x)+Math.abs(target.position.y-support.y)+Math.abs(target.position.z-z)>6)continue;
      supports.set(support.toString(),support);
    }
  }
  const afterRemoval=position=>position.equals(target.position)
    ? {name:'air',boundingBox:'empty',position,isWaterlogged:false}
    : bot.blockAt(position);
  for(const support of supports.values()){
    const message=`Cannot remove a retained leaf anchor beneath protected starter support (${support.x},${support.y},${support.z})`;
    let block,proof;
    try{
      block=bot.blockAt(support);
      if(!block)throw refuse(message,support);
      if(!/_leaves$/.test(block.name))continue;
      proof=retainedLeafAnchor(afterRemoval,support);
    }catch{throw refuse(message,support);}
    if(!proof)throw refuse(message,support);
  }
}

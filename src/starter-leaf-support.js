import { Vec3 } from 'vec3';
import { retainedLeafAnchor } from './construction-guards.js';

export const STARTER_SUPPORT_PROTECTED = 'STARTER_SUPPORT_PROTECTED';
const valid = p => p && ['x','y','z'].every(k => Number.isFinite(p[k]) && Math.abs(p[k]) <= (k === 'y' ? 2048 : 29999984));
const refuse = (message, support) => Object.assign(new Error(message), { code:STARTER_SUPPORT_PROTECTED, ...(support ? { support:{x:support.x,y:support.y,z:support.z} } : {}) });

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

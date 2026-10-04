import { Vec3 } from 'vec3';
import { isFluidBearingBlock } from './navigation-guards.js';
const HAZARDS = new Set(['powder_snow','magma_block','fire','soul_fire','campfire','soul_campfire','cactus','wither_rose','sweet_berry_bush']);
function cells(bot, includeSupport=false) {
  const p=bot.entity?.position;
  if(!p||!['x','y','z'].every(k=>Number.isFinite(p[k]))||!bot.blockAt)return null;
  const half=bot.physics?.playerHalfWidth??.3,height=bot.physics?.playerHeight??1.8;
  if(!Number.isFinite(half)||half<=0||half>1||!Number.isFinite(height)||height<=0||height>4)return null;
  const found=[];
  for(let x=Math.floor(p.x-half+1e-7);x<=Math.floor(p.x+half-1e-7);x++)
    for(let z=Math.floor(p.z-half+1e-7);z<=Math.floor(p.z+half-1e-7);z++)
      for(let y=Math.floor(p.y+(includeSupport?-1e-7:1e-7));y<=Math.floor(p.y+height-1e-7);y++){
        try { found.push(bot.blockAt(new Vec3(x,y,z))) } catch { found.push(null) }
      }
  return found;
}
export const hasPowderSnowContact=bot=>Boolean(cells(bot)?.some(b=>b?.name==='powder_snow'));
export const hasLavaContact=bot=>Boolean(cells(bot)?.some(b=>b&&['lava','flowing_lava'].includes(b.name)));
export function isHazardFreeBody(bot) {
  const blocks=cells(bot,true);
  return Boolean(blocks?.length)&&blocks.every(b=>b&&!isFluidBearingBlock(b)&&!HAZARDS.has(b.name));
}
export const isDryLanding=bot=>bot.entity?.onGround===true&&isHazardFreeBody(bot);

// Fresh ground flags alone can lag a disappearing floor. Require observed
// collision contact beneath at least part of the player's actual footprint.
// This is an extra recovery preflight, not a change to ordinary movement.
export function hasObservedStandingSupport(bot) {
 const p=bot.entity?.position,half=bot.physics?.playerHalfWidth??.3;
 if(!p||![p.x,p.y,p.z,half].every(Number.isFinite)||half<=0||half>1)return false;
 const top=Math.round(p.y),y=Math.abs(p.y-top)<=.03?top-1:Math.floor(p.y-1e-7);
 let contact=false;
 try{
  for(let x=Math.floor(p.x-half+1e-7);x<=Math.floor(p.x+half-1e-7);x++)for(let z=Math.floor(p.z-half+1e-7);z<=Math.floor(p.z+half-1e-7);z++){
   const b=bot.blockAt(new Vec3(x,y,z));
   if(!b||isFluidBearingBlock(b)||HAZARDS.has(b.name))return false;
   if(b.boundingBox!=='block'||!Array.isArray(b.shapes))continue;
   contact ||= b.shapes.some(s=>s.length===6&&s.every(Number.isFinite)&&s[3]>s[0]&&s[4]>s[1]&&s[5]>s[2]
    && Math.abs(y+s[4]-p.y)<=.03 && Math.min(x+s[3],p.x+half)-Math.max(x+s[0],p.x-half)>1e-7
    && Math.min(z+s[5],p.z+half)-Math.max(z+s[2],p.z-half)>1e-7);
  }
 }catch{return false;}
 return contact;
}

// Preserve legitimate slab-height arrivals without the library's broad +1Y
// allowance, which can otherwise accept a whole-block-wrong position.
export function isAtPickupStandingCell(bot,target) {
  const p=bot.entity?.position;
  if(!p||!['x','y','z'].every(k=>Number.isFinite(p[k])&&Number.isInteger(target[k]))||Math.floor(p.x)!==target.x||Math.floor(p.z)!==target.z)return false;
  if(Math.abs(p.y-target.y)<=.03 || Math.floor(p.y)===target.y)return true;
  if(p.y>=target.y || p.y<=target.y-1)return false;
  const support=bot.blockAt(new Vec3(target.x,target.y-1,target.z));
  if(!support||isFluidBearingBlock(support)||!Array.isArray(support.shapes))return false;
  const x=p.x-target.x,z=p.z-target.z;
  return support.shapes.some(s=>s.length===6&&s.every(Number.isFinite)&&s[4]>0&&s[4]<1&&x>=s[0]&&x<=s[3]&&z>=s[2]&&z<=s[5]&&Math.abs(p.y-(target.y-1+s[4]))<=.03);
}

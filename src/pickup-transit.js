import { Vec3 } from 'vec3';
import { visibleBlockFace } from './actions.js';
import { isFluidBearingBlock, WATER_BEARING_BLOCK_NAMES } from './navigation-guards.js';

const AIR = new Set(['air', 'cave_air', 'void_air']);
const NATURAL = new Set(['stone', 'dirt', 'grass_block', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate']);
const FOLIAGE = /_leaves$/;
const supportable = b => b?.boundingBox === 'block' && (NATURAL.has(b.name) || /_(log|leaves)$/.test(b.name));
const key = p => `${p.x},${p.y},${p.z}`;
const FALLING = /^(sand|red_sand|gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$|_concrete_powder$/;
const SIDES = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]];

// A small, read-only counterfactual probe. It never changes the bot/world or
// executes its computed routes. The ordinary dig and pickup actions revalidate
// the real terrain, support, tool, expected block and actual inventory afterward.
export function findTransitPickupClearance(bot, ids = [], { budgetMs = 80, maxNodes = 512, now = () => performance.now() } = {}) {
  const movement = bot.pathfinder?.movements, position = bot.entity?.position;
  if (!position || !Array.isArray(ids) || !ids.length || !bot.world?.raycast || !movement?.getNeighbors || !bot.registry?.blocksByName?.air) return null;
  if (movement.canDig !== false || movement.allowParkour !== false || movement.allow1by1towers !== false || movement.allowFreeMotion !== false || movement.scafoldingBlocks?.length !== 0) return null;
  if (typeof movement.blocksToAvoid?.has !== 'function' || typeof movement.liquids?.has !== 'function' || movement.maxDropDown !== 3 || movement.canOpenDoors !== false) return null;
  if (WATER_BEARING_BLOCK_NAMES.some(name => bot.registry.blocksByName[name] && !movement.blocksToAvoid.has(bot.registry.blocksByName[name].id))) return null;
  if (bot.entity.onGround === false || Math.abs(position.y - Math.round(position.y)) > 0.05) return null;
  const origin = new Vec3(Math.floor(position.x), Math.round(position.y), Math.floor(position.z)), eye = position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
  const deadline = now() + budgetMs; let visited = 0;
  const exhausted = () => now() >= deadline || visited >= maxNodes;
  const items = ids.map(id => bot.entities?.[id]).filter(e => e?.name === 'item' && e.position?.distanceTo(position) <= 6).sort((a,b) => a.position.distanceTo(position) - b.position.distanceTo(position)).slice(0,8);
  if (!items.length) return null;
  const passable = b => b && !b.isWaterlogged && b.boundingBox === 'empty' && (AIR.has(b.name) || /^(short_grass|tall_grass|fern|large_fern|leaf_litter)$/.test(b.name) || (b.name === 'snow' && b.shapes?.length === 0)) && !movement.blocksToAvoid.has(b.type) && !movement.liquids.has(b.type);
  if (!passable(bot.blockAt(origin)) || !passable(bot.blockAt(origin.offset(0,1,0))) || !supportable(bot.blockAt(origin.offset(0,-1,0)))) return null;
  const cells = new Map();
  for (const item of items) for (let x=-1;x<=1;x++) for (let z=-1;z<=1;z++) {
    for (let down=-1;down<=8;down++) {
      if (exhausted()) return null;
      const p=item.position.floored().offset(x,-down,z);
      if (passable(bot.blockAt(p)) && passable(bot.blockAt(p.offset(0,1,0))) && supportable(bot.blockAt(p.offset(0,-1,0)))) { cells.set(key(p),p); break; }
    }
  }
  const endpoints = [...cells.values()].sort((a,b)=>a.distanceTo(position)-b.distanceTo(position)).slice(0,12);
  // Some drops sit in one-block-high pockets with no standing endpoint yet.
  // Existing reachable cells (including our own origin) are not evidence that
  // those drops can be collected. Only consider a new cell for an item with no
  // pre-existing supported standing cell close enough to it.
  const nearDrop = (p, item) => Math.abs(p.y - item.position.y) <= 0.5 && p.offset(0.5, 0, 0.5).distanceTo(item.position) <= 1.4;
  const standing = (getBlock, p, naturalOnly = true) => {
    const floor = getBlock(p.offset(0, -1, 0));
    return passable(getBlock(p)) && passable(getBlock(p.offset(0, 1, 0))) && (naturalOnly ? supportable(floor) : floor?.boundingBox === 'block') &&
      !isFluidBearingBlock(floor) && !movement.blocksToAvoid.has(floor.type) && !movement.liquids.has(floor.type);
  };
  const pocketItems = items.filter(item => {
    const base = item.position.floored();
    for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
      for (let y = Math.ceil(item.position.y - 0.5); y <= Math.floor(item.position.y + 0.5); y++) {
        if (exhausted()) return false;
        const p = new Vec3(base.x + x, y, base.z + z);
        if (!nearDrop(p, item)) continue;
        // Unknown cells cannot prove that an existing destination is absent.
        if ([-1, 0, 1].some(dy => !bot.blockAt(p.offset(0, dy, 0)))) return false;
        if (standing(q => bot.blockAt(q), p, false)) return false;
      }
    }
    return true;
  });
  if (!endpoints.length && !pocketItems.length) return null;
  function view(removed = null) {
    let unknown=false;
    const virtualBot=Object.create(bot);
    virtualBot.blockAt=p=>{
      const q=p.floored();
      if (removed?.equals(q)) return {name:'air',type:bot.registry.blocksByName.air.id,position:q,boundingBox:'empty',shapes:[],isWaterlogged:false};
      const b=bot.blockAt(q);
      if (!b) { unknown=true; return null; }
      // Movements annotates blocks. Give it disposable copies, never live ones.
      return {...b,position:q,shapes:(b.shapes??[]).map(s=>[...s]),isWaterlogged:Boolean(b.isWaterlogged)};
    };
    const graph=Object.create(movement);graph.bot=virtualBot;graph.entityIntersections={...movement.entityIntersections};
    return {graph,reset:()=>{unknown=false;},unknown:()=>unknown};
  }
  function reach(v,start,end) {
    v.reset();let clipped=false,head=0;
    const first=Object.assign(new Vec3(start.x,start.y,start.z),{remainingBlocks:0,cost:0,toBreak:[],toPlace:[]});
    const queue=[first],seen=new Set([key(first)]);
    while (head<queue.length) {
      if (exhausted() || head>=128) return 'unknown';
      const node=queue[head++];visited++;
      if (node.equals(end)) return 'reachable';
      for (const next of v.graph.getNeighbors(node)) {
        if (next.toBreak?.length || next.toPlace?.length || next.parkour || next.cost>100) continue;
        if (next.distanceTo(origin)>8 || Math.abs(next.y-origin.y)>5) { clipped=true; continue; }
        const id=key(next);if(seen.has(id))continue;seen.add(id);queue.push(next);
      }
    }
    return clipped || v.unknown() ? 'unknown' : 'unreachable';
  }
  const baseline=view();
  const sealed=endpoints.filter(p=>reach(baseline,p,origin)==='unreachable');
  if ((!sealed.length && !pocketItems.length) || exhausted()) return null;
  const candidates=[];
  for(let x=-2;x<=2;x++)for(let z=-2;z<=2;z++)for(let y=0;y<=3;y++) {
    if(exhausted())return null;
    const p=origin.offset(x,y,z),b=bot.blockAt(p);
    if(!b || (!NATURAL.has(b.name)&&!FOLIAGE.test(b.name)) || b.isWaterlogged || b.diggable===false || p.y<Math.ceil(position.y-0.001))continue;
    if(eye.distanceTo(p.offset(.5,.5,.5))>4.5 || !visibleBlockFace(bot.world,eye,p,4.2))continue;
    const neighbors=SIDES.map(([dx,dy,dz])=>bot.blockAt(p.offset(dx,dy,dz)));
    if(neighbors.some(n=>!n||isFluidBearingBlock(n)||movement.liquids.has(n.type)) || FALLING.test(bot.blockAt(p.offset(0,1,0))?.name??''))continue;
    const held=bot.heldItem?.type??null, inventory=bot.inventory?.items?.()??[];
    if(b.canHarvest && !b.canHarvest(held) && !inventory.some(i=>b.canHarvest(i.type)))continue;
    candidates.push(b);
  }
  const priorities = sealed.length ? sealed : pocketItems.map(item => item.position);
  candidates.sort((a,b)=>Math.min(...priorities.map(p=>p.distanceTo(a.position)))+a.position.distanceTo(position)-Math.min(...priorities.map(p=>p.distanceTo(b.position)))-b.position.distanceTo(position));
  for(const block of candidates.slice(0,12)) {
    const hypothesis=view(block.position);
    const opened = [block.position.offset(0, -1, 0), block.position].filter(p =>
      !standing(q => bot.blockAt(q), p) && standing(q => hypothesis.graph.bot.blockAt(q), p) &&
      pocketItems.some(item => nearDrop(p, item)));
    const targets = [...new Map([...sealed, ...opened].map(p => [key(p), p])).values()].slice(0, 12);
    for(const endpoint of targets) {
      if(exhausted())return null;
      if(reach(hypothesis,endpoint,origin)==='reachable' && reach(hypothesis,origin,endpoint)==='reachable') {
        return {x:block.position.x,y:block.position.y,z:block.position.z,expected_block:block.name};
      }
    }
  }
  return null;
}

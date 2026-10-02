import { Vec3 } from 'vec3';
import { visibleBlockFace } from './actions.js';
import { isFluidBearingBlock } from './navigation-guards.js';
const AIR = new Set(['air', 'cave_air', 'void_air']);
const CLEARABLE = new Set(['stone', 'dirt', 'grass_block', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate']);
const clearable = name => CLEARABLE.has(name) || /_leaves$/.test(name ?? '');
const supportable = name => CLEARABLE.has(name) || /_(log|leaves)$/.test(name ?? '');

// Recover our observed drops from one-block-high pockets. Never clear a
// container, ore, unknown block, supporting block, liquid, or unseen obstruction.
export function findPickupClearance(bot, ids = []) {
  if (!Array.isArray(ids) || !bot.world?.raycast || !bot.entity?.position) return null;
  const position = bot.entity.position, eye = position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
  const items = ids.map(id => bot.entities?.[id]).filter(e => e?.name === 'item' && e.position?.distanceTo(position) <= 6).sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position));
  for (const item of items) {
    // A canopy wall can hide the standing cell near our own dropped item.
    // Clear only a visible leaf at feet/head height, never the floor below us.
    const delta = item.position.offset(0, 0.3, 0).minus(eye);
    const hit = delta.norm() > 0 ? bot.world.raycast(eye, delta.scaled(1 / delta.norm()), Math.min(4.2, delta.norm())) : null;
    const obstruction = hit?.position ? bot.blockAt(hit.position) : null;
    const below = obstruction?.position ? bot.blockAt(obstruction.position.offset(0, -1, 0)) : null;
    const lower = obstruction?.position ? bot.blockAt(obstruction.position.offset(0, -2, 0)) : null;
    const supported = (supportable(below?.name) && below.boundingBox === 'block') || (AIR.has(below?.name) && supportable(lower?.name) && lower.boundingBox === 'block');
    if (supported && /_leaves$/.test(obstruction?.name ?? '') && obstruction.position.y >= Math.ceil(position.y - 0.001) && visibleBlockFace(bot.world, eye, obstruction.position, 4.2)) {
      const p = obstruction.position;
      return { x: p.x, y: p.y, z: p.z, expected_block: obstruction.name };
    }
    const feet = item.position.floored(), first = bot.blockAt(feet.offset(0, 1, 0)), second = bot.blockAt(feet.offset(0, 2, 0)), floor = bot.blockAt(feet.offset(0, -1, 0));
    // Two standing cells alone may not leave room to jump back out of a
    // one-block dip. Permit one additional overhead block, still one dig per
    // observation and within the shared clearance budget.
    const head = clearable(first?.name) ? first : AIR.has(first?.name) && clearable(second?.name) ? second : null;
    if (!AIR.has(bot.blockAt(feet)?.name) || !supportable(floor?.name) || floor.boundingBox !== 'block' || !clearable(head?.name)) continue;
    const p = head.position;
    const overlaps = position.x + 0.31 > p.x && position.x - 0.31 < p.x + 1 && position.z + 0.31 > p.z && position.z - 0.31 < p.z + 1;
    if (overlaps && p.y < position.y && p.y + 1 >= position.y - 0.1) continue;
    if (!visibleBlockFace(bot.world, eye, p, 4.2)) continue;
    return { x: p.x, y: p.y, z: p.z, expected_block: head.name };
  }
  return null;
}

// A lower trunk ray may pass through a gap while another observed trunk ray
// hits the leaf wall that is actually blocking approach. Keep the existing
// bounded log sample, try several rays, and leave excavation to normal dig_at.
export function findTreeFoliage(bot, logs = []) {
  if (!Array.isArray(logs) || !bot.world?.raycast || !bot.entity?.position || !bot.blockAt) return null;
  const position = bot.entity.position, eye = position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
  const candidates = logs.slice(0, 16).filter(block => block?.position && /_log$/.test(block.name ?? '')).sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position));
  for (const tree of candidates) {
    const delta = tree.position.offset(0.5, 0.5, 0.5).minus(eye), distance = delta.norm();
    if (!Number.isFinite(distance) || distance <= 0) continue;
    const hit = bot.world.raycast(eye, delta.scaled(1 / distance), Math.min(4.2, distance));
    const leaf = hit?.position ? bot.blockAt(hit.position) : null;
    if (!leaf?.position || !/_leaves$/.test(leaf.name ?? '') || leaf.isWaterlogged || leaf.diggable === false || leaf.position.y < Math.ceil(position.y - 0.001)) continue;
    const neighbors = [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0],[0,-1,0]].map(([x,y,z]) => bot.blockAt(leaf.position.offset(x,y,z)));
    if (neighbors.some(block => !block || isFluidBearingBlock(block))) continue;
    if (/^(sand|red_sand|gravel|anvil|chipped_anvil|damaged_anvil|pointed_dripstone)$|_concrete_powder$/.test(neighbors[4].name)) continue;
    if (!visibleBlockFace(bot.world, eye, leaf.position, 4.2)) continue;
    const p = leaf.position;
    return { x: p.x, y: p.y, z: p.z, expected_block: leaf.name };
  }
  return null;
}

// Check the observed player body, including block-edge overlap. Route avoidance
// cannot protect a bot that already spawned or was displaced into powder snow.
export function hasPowderSnowContact(bot) {
  const p = bot.entity?.position;
  if (!p || !['x','y','z'].every(k => Number.isFinite(p[k])) || !bot.blockAt) return false;
  for (let x=Math.floor(p.x-0.3+1e-7);x<=Math.floor(p.x+0.3-1e-7);x++)
    for (let z=Math.floor(p.z-0.3+1e-7);z<=Math.floor(p.z+0.3-1e-7);z++)
      for (let y=Math.floor(p.y+1e-7);y<=Math.floor(p.y+1.8-1e-7);y++)
        if (bot.blockAt(new Vec3(x,y,z))?.name === 'powder_snow') return true;
  return false;
}

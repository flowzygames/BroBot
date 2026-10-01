import { visibleBlockFace } from './actions.js';
const AIR = new Set(['air', 'cave_air', 'void_air']);
const CLEARABLE = new Set(['stone', 'dirt', 'grass_block', 'andesite', 'diorite', 'granite', 'tuff', 'deepslate']);

// Recover our observed drops from one-block-high pockets. Never clear a
// container, ore, unknown block, supporting block, liquid, or unseen obstruction.
export function findPickupClearance(bot, ids = []) {
  if (!Array.isArray(ids) || !bot.world?.raycast || !bot.entity?.position) return null;
  const position = bot.entity.position, eye = position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);
  const items = ids.map(id => bot.entities?.[id]).filter(e => e?.name === 'item' && e.position?.distanceTo(position) <= 6).sort((a, b) => a.position.distanceTo(position) - b.position.distanceTo(position));
  for (const item of items) {
    const feet = item.position.floored(), first = bot.blockAt(feet.offset(0, 1, 0)), second = bot.blockAt(feet.offset(0, 2, 0)), floor = bot.blockAt(feet.offset(0, -1, 0));
    // Two standing cells alone may not leave room to jump back out of a
    // one-block dip. Permit one additional overhead block, still one dig per
    // observation and within the shared clearance budget.
    const head = CLEARABLE.has(first?.name) ? first : AIR.has(first?.name) && CLEARABLE.has(second?.name) ? second : null;
    if (!AIR.has(bot.blockAt(feet)?.name) || !CLEARABLE.has(floor?.name) || floor.boundingBox !== 'block' || !CLEARABLE.has(head?.name)) continue;
    const p = head.position;
    const overlaps = position.x + 0.31 > p.x && position.x - 0.31 < p.x + 1 && position.z + 0.31 > p.z && position.z - 0.31 < p.z + 1;
    if (overlaps && p.y < position.y && p.y + 1 >= position.y - 0.1) continue;
    if (!visibleBlockFace(bot.world, eye, p, 4.2)) continue;
    return { x: p.x, y: p.y, z: p.z, expected_block: head.name };
  }
  return null;
}

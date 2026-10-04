import { createHash } from 'node:crypto';
import { Vec3 } from 'vec3';

// A retry hint, never a placement certificate. The physical action still checks
// its complete geometry, tool, visibility, cancellation and walking exit.
// Eight blocks form a bounded local retry-evidence envelope. This is not a
// complete fingerprint of every planner read; changes farther away may wait
// for new pose/context before retry. Unrelated chunks must not reopen loops.
export function craftGeometryKey(bot) {
  const p = bot.entity?.position;
  if (!p || !['x', 'y', 'z'].every(k => Number.isFinite(p[k]))) return null;
  const origin = new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
  const hash = createHash('sha256');
  hash.update(JSON.stringify([origin.x, origin.y, origin.z, bot.game?.dimension]));
  for (let x = -8; x <= 8; x++) for (let y = -8; y <= 8; y++) for (let z = -8; z <= 8; z++) {
    let block;
    try { block = bot.blockAt(origin.offset(x, y, z)); } catch { block = null; }
    hash.update(JSON.stringify(block ? [block.name, block.stateId ?? null, block.boundingBox, Boolean(block.isWaterlogged), block.shapes ?? null] : null));
    hash.update(';');
  }
  return hash.digest('hex');
}

import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const require = createRequire(import.meta.url);
const inject = require('mineflayer/lib/plugins/blocks');

// Use the installed library's real section iterator and palette filtering,
// with explicitly loaded sparse sections. No server or world changes.
export function realSectionSearch(bot, targets) {
  const search = Object.assign(new EventEmitter(), {
    registry: bot.registry, _client: new EventEmitter(), game: bot.game,
    entity: bot.entity, supportFeature: () => false
  });
  inject(search, { version: bot.registry.version.minecraftVersion });
  const sections = new Map();
  for (const block of targets) {
    const p = block.position;
    const key = `${Math.floor(p.x / 16)},${Math.floor(p.z / 16)}`;
    const column = sections.get(key) ?? { sections: {} };
    const index = Math.floor(p.y / 16) + Math.abs(bot.game.minY >> 4);
    column.sections[index] ??= { palette: [] };
    column.sections[index].palette.push(block.stateId);
    sections.set(key, column);
  }
  search.world = {
    getColumn: (x, z) => sections.get(`${x},${z}`) ?? null,
    getBlock: p => bot.blockAt(p)
  };
  return search.findBlocks;
}

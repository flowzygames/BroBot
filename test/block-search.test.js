import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { sectionSearchDistance } from '../src/block-search.js';
import { realSectionSearch } from './helpers/section-search.js';
const registry = minecraftData('1.21.8');
function fixture(positions) {
  const type = registry.blocksByName.spruce_log;
  const blocks = positions.map(position => ({ position, type: type.id, name: type.name, stateId: type.defaultState }));
  const bot = { registry, game: { minY: -64, height: 384 }, entity: { position: new Vec3(.5,64,.5) },
    blockAt: p => blocks.find(b => b.position.equals(p)) ?? { type: 0, name: 'air', position: p.clone(), stateId: 0 } };
  bot.findBlocks = realSectionSearch(bot, blocks);
  return bot;
}
for (const [radius, target] of [[32, new Vec3(-17,64,-17)], [48, new Vec3(-33,64,-17)], [32, new Vec3(-17,47,-17)]]) {
  test(`sphere enumeration finds diagonal resource ${target} at radius ${radius}`, () => {
    const bot = fixture([target]), origin = bot.entity.position.floored();
    const options = { matching: registry.blocksByName.spruce_log.id, count: 128, useExtraInfo: b => b.position.distanceTo(origin) <= radius };
    assert.deepEqual(bot.findBlocks({ ...options, maxDistance: radius }), []);
    assert.deepEqual(bot.findBlocks({ ...options, maxDistance: sectionSearchDistance(radius) }), [target]);
  });
}
test('sphere filtering happens before the count cap', () => {
  const target = new Vec3(-17,64,-17), outside = new Vec3(31,79,15);
  const bot = fixture([target, outside]);
  const found = bot.findBlocks({ matching: registry.blocksByName.spruce_log.id, maxDistance: sectionSearchDistance(32), count: 1,
    useExtraInfo: b => b.position.distanceTo(bot.entity.position.floored()) <= 32 });
  assert.deepEqual(found, [target]);
});
test('section search rejects unbounded or invalid radii', () => {
  for (const radius of [0, -1, 65, Infinity, NaN]) assert.throws(() => sectionSearchDistance(radius), RangeError);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import minecraftData from 'minecraft-data';
import { Runtime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { realSectionSearch } from './helpers/section-search.js';

test('starter observes a loaded diagonal tree and ignores logs beyond its sphere', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'brobot-search-'));
  const runtime = new Runtime(loadConfig({ BROBOT_DATA_DIR: directory }));
  const registry = minecraftData('1.21.8');
  const target = new Vec3(-33,64,-17), outside = new Vec3(47,79,15);
  const blocks = [target, outside].map((position, i) => {
    const name = i ? 'oak_log' : 'spruce_log', def = registry.blocksByName[name];
    return { name, type: def.id, stateId: def.defaultState, position };
  });
  const bot = { registry, entity: { position: new Vec3(.5,64,.5) }, game: { minY: -64, height: 384 },
    blockAt: p => blocks.find(b => b.position.equals(p)) ?? { name: 'air', type: 0, stateId: 0, position: p.clone() }, quit() {} };
  bot.findBlocks = realSectionSearch(bot, blocks);
  runtime.bot = bot;
  runtime.execute = async () => ({ position: bot.entity.position, nearby_blocks: [] });
  try {
    const observation = await runtime.survival.observe(new AbortController().signal);
    assert.equal(observation.wood, 'spruce');
  } finally { await runtime.close(); await rm(directory, { recursive: true, force: true }); }
});

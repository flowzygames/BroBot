import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { terrainTrustStatus, assertTerrainTrusted, quarantineTerrain } from '../src/terrain-trust.js';

function fixture() {
  const bot = new EventEmitter(), calls = [];
  bot.pathfinder = { setGoal: value => calls.push(['goal',value]) };
  bot.clearControlStates = () => calls.push(['controls']);
  bot.stopDigging = () => calls.push(['dig']);
  bot.quit = reason => calls.push(['quit',reason]);
  return { bot, calls };
}

test('fresh bot is trusted while quarantined bot stays rejected across respawn', () => {
  const { bot } = fixture();
  assert.equal(terrainTrustStatus(bot).trusted,true);
  assert.doesNotThrow(() => assertTerrainTrusted(bot));
  quarantineTerrain(bot,'missing server receipt');
  bot.emit('spawn'); bot.game = { dimension: 'the_nether' };
  assert.throws(() => assertTerrainTrusted(bot), { code: 'TERRAIN_UNTRUSTED' });
  assert.equal(terrainTrustStatus(bot).reason,'missing server receipt');
  assert.doesNotThrow(() => assertTerrainTrusted(fixture().bot));
});

test('quarantine is visible before synchronous stop hooks or event listeners run', () => {
  const { bot, calls } = fixture();
  bot.stopDigging = () => assert.throws(() => assertTerrainTrusted(bot), { code: 'TERRAIN_UNTRUSTED' });
  bot.on('terrainUntrusted', error => {
    assert.equal(error.code,'TERRAIN_UNTRUSTED');
    assert.throws(() => assertTerrainTrusted(bot), { code: 'TERRAIN_UNTRUSTED' });
  });
  quarantineTerrain(bot,Error('uncertain edit'));
  assert.equal(calls.filter(c => c[0] === 'quit').length,1);
});

test('quarantine is idempotent, preserves first reason and does not repeat shutdown', () => {
  const { bot, calls } = fixture();
  const first = quarantineTerrain(bot,'first');
  assert.deepEqual(quarantineTerrain(bot,'second'),first);
  assert.equal(calls.filter(c => c[0] === 'quit').length,1);
  assert.throws(() => { first.trusted = true; },TypeError);
});

test('throwing cleanup and notification hooks do not stop disconnection attempt', () => {
  const { bot, calls } = fixture();
  bot.pathfinder.setGoal = () => { throw Error('goal failed'); };
  bot.clearControlStates = () => { throw Error('controls failed'); };
  bot.stopDigging = () => { throw Error('dig failed'); };
  bot.on('terrainUntrusted', () => { throw Error('listener failed'); });
  assert.doesNotThrow(() => quarantineTerrain(bot,'unsafe'));
  assert.equal(calls.filter(c => c[0] === 'quit').length,1);
  assert.equal(terrainTrustStatus(bot).trusted,false);
});

test('client fallback closes bots without a quit method', () => {
  const { bot } = fixture(); let closed = false;
  delete bot.quit; bot._client = { end: () => { closed = true; } };
  quarantineTerrain(bot,'unsafe');
  assert.equal(closed,true);
});

test('failed quit falls back to client end while successful quit is not duplicated', () => {
  for (const throws of [false,true]) {
    const {bot}=fixture();let ended=0;
    bot.quit=()=>{if(throws)throw Error('quit failed');};bot._client={end:()=>{ended++;}};
    quarantineTerrain(bot,'unsafe');assert.equal(ended,throws?1:0);
  }
});

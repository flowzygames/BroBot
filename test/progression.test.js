import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec3 } from 'vec3';
import { createProgression, endPortalEdges, findEndPortalRing, observeProgression, portalBlueprint, progressionDefinitions, solveBowShot, triangulateBearings } from '../src/progression.js';

test('portal blueprint is a supported closed 14-block frame with six empty interior cells', () => {
  for (const axis of ['x', 'z']) {
    const { frame, interior, igniteOn } = portalBlueprint(10, 64, -20, axis);
    const key = p => `${p.x},${p.y},${p.z}`;
    assert.equal(new Set(frame.map(key)).size, 14);
    assert.equal(interior.length, 6);
    assert.ok(interior.every(p => !frame.map(key).includes(key(p))));
    assert.equal(igniteOn.y, 64);
    assert.ok(frame.some(p => p.y === 68));
    assert.ok(frame.every(p => axis === 'x' ? p.z === -20 : p.x === 10));
  }
});

test('eye triangulation recovers a stronghold estimate from two and three real directions', () => {
  const bearings = [{ x: 0, z: 0, dx: 1000, dz: 600 }, { x: 128, z: 0, dx: 872, dz: 600 }, { x: 0, z: 128, dx: 1000, dz: 472 }];
  for (const sample of [bearings.slice(0, 2), bearings]) {
    const result = triangulateBearings(sample);
    assert.equal(result.ok, true);
    assert.equal(result.x, 1000); assert.equal(result.z, 600); assert.equal(result.residual, 0);
  }
});

test('eye triangulation refuses same-place, parallel, backward, and conflicting bearings', () => {
  assert.equal(triangulateBearings([]).ok, false);
  assert.equal(triangulateBearings([{ x: 0, z: 0, dx: 1, dz: 1 }, { x: 2, z: 0, dx: 1, dz: 2 }]).ok, false);
  assert.equal(triangulateBearings([{ x: 0, z: 0, dx: 1, dz: 0 }, { x: 0, z: 64, dx: 1, dz: 0 }]).ok, false);
  assert.equal(triangulateBearings([{ x: 0, z: 0, dx: -1, dz: -1 }, { x: 64, z: 0, dx: 1, dz: -1 }]).ok, false);
  assert.equal(triangulateBearings([{ x: 0, z: 0, dx: 1, dz: 1 }, { x: 100, z: 0, dx: -1, dz: 1 }, { x: 0, z: 200, dx: 1, dz: 0 }]).ok, false);
  assert.throws(() => triangulateBearings([{ x: 0, z: 0, dx: NaN, dz: 1 }, { x: 0, z: 100, dx: 1, dz: 1 }]), /Invalid/);
});

test('bow solver reaches flat and elevated crystal targets and declines impossible shots', () => {
  for (const target of [{ x: 30, y: 65, z: 0 }, { x: -35, y: 88, z: 20 }, { x: 0, y: 100, z: -40 }]) {
    const shot = solveBowShot({ x: 0, y: 65, z: 0 }, target);
    assert.ok(shot); assert.ok(shot.miss < 0.4); assert.ok(shot.ticks > 0);
    assert.equal(shot.path.at(-1).x, target.x); assert.equal(shot.path.at(-1).z, target.z);
    assert.ok(Math.abs(shot.path.at(-1).y - target.y) < 0.4);
  }
  assert.equal(solveBowShot({ x: 0, y: 0, z: 0 }, { x: 150, y: 0, z: 0 }), null);
  assert.equal(solveBowShot({ x: 0, y: 0, z: 0 }, { x: 30, y: 500, z: 0 }), null);
});

function ringFrames() {
  const frames = [];
  for (let k = -1; k <= 1; k++) {
    frames.push({ position: new Vec3(k, 30, -2), facing: 'south' }, { position: new Vec3(k, 30, 2), facing: 'north' }, { position: new Vec3(-2, 30, k), facing: 'east' }, { position: new Vec3(2, 30, k), facing: 'west' });
  }
  return frames;
}

test('portal detection rejects missing and reversed frames before consuming eyes', () => {
  const valid = findEndPortalRing(ringFrames());
  assert.deepEqual(valid.center, { x: 0, y: 30, z: 0 }); assert.equal(valid.frames.length, 12);
  assert.equal(findEndPortalRing(ringFrames().slice(1)), null);
  const reversed = ringFrames(); reversed[0].facing = 'north';
  assert.equal(findEndPortalRing(reversed), null);
});

test('End portal entry approaches a solid rim and refuses gaps, hazards, and obstructed headroom', () => {
  const portal = { position: new Vec3(0, 64, 0), name: 'end_portal', boundingBox: 'empty' };
  const key = p => `${p.x},${p.y},${p.z}`;
  const blocks = new Map([[key(portal.position), portal]]);
  const blockAt = p => blocks.get(key(p)) ?? { name: 'air', boundingBox: 'empty' };
  assert.equal(endPortalEdges([portal], blockAt).length, 0);
  blocks.set('1,64,0', { name: 'end_portal_frame', boundingBox: 'block' });
  assert.deepEqual(endPortalEdges([portal], blockAt).map(e => e.standing), [new Vec3(1, 65, 0)]);
  blocks.set('1,66,0', { name: 'stone', boundingBox: 'block' });
  assert.equal(endPortalEdges([portal], blockAt).length, 0);
  blocks.delete('1,66,0'); blocks.set('1,64,0', { name: 'magma_block', boundingBox: 'block' });
  assert.equal(endPortalEdges([portal], blockAt).length, 0);
});

test('inventory readiness never claims game completion', () => {
  assert.match(observeProgression({ inventory: [], dimension: 'minecraft:overworld' }).next, /logs/);
  const prep = observeProgression({ inventory: [{ name: 'obsidian', count: 14 }, { name: 'flint_and_steel', count: 1 }], dimension: 'overworld' });
  assert.equal(prep.canBuildFullNetherPortal, true);
  const late = observeProgression({ inventory: { ender_eye: 12, bow: 1, arrow: 64 }, dimension: 'minecraft:the_end' });
  assert.equal(late.dimension, 'end'); assert.equal(late.hasBowAndArrows, true); assert.equal(late.completion, 'unverified');
});

test('all exposed tool schemas are strict and require every declared property', () => {
  for (const definition of progressionDefinitions) {
    assert.equal(definition.strict, true); assert.equal(definition.parameters.additionalProperties, false);
    assert.deepEqual(definition.parameters.required.sort(), Object.keys(definition.parameters.properties).sort());
  }
});

test('an aborted progression request has no game side effects', async () => {
  let calls = 0;
  const progression = createProgression({}, { actions: { execute() { calls++; }, stop() { calls++; } } });
  const controller = new AbortController(); controller.abort(new Error('Stop now'));
  await assert.rejects(progression.execute('build_nether_portal', { x: 0, y: 64, z: 0, axis: 'x' }, controller.signal), /Stop now/);
  assert.equal(calls, 0);
});

test('cancelling while stepping off an End portal rim releases forward movement', async () => {
  const controller = new AbortController(), controls = [];
  const portalPosition = new Vec3(0, 64, 0);
  const bot = {
    game: { dimension: 'overworld' }, entity: { position: new Vec3(3.5, 65, 0.5) },
    registry: { blocksByName: { end_portal: { id: 119 } } },
    findBlocks: () => [portalPosition],
    blockAt(p) {
      if (p.equals(portalPosition)) return { name: 'end_portal', position: p, boundingBox: 'empty' };
      if (p.equals(new Vec3(1, 64, 0))) return { name: 'end_portal_frame', position: p, boundingBox: 'block' };
      return { name: 'air', position: p, boundingBox: 'empty' };
    },
    async look() {},
    setControlState(control, value) {
      controls.push([control, value]);
      if (value) controller.abort(new Error('Owner stopped entry'));
    }
  };
  const actions = {
    async execute(name, args) {
      assert.equal(name, 'go_to');
      assert.deepEqual(args, { x: 1, y: 65, z: 0, radius: 0 });
      bot.entity.position = new Vec3(1.5, 65, 0.5);
    },
    stop() {}
  };
  const progression = createProgression(bot, { actions });
  await assert.rejects(progression.execute('enter_portal', { kind: 'end', radius: 8, timeout: 10 }, controller.signal), /Owner stopped entry/);
  assert.deepEqual(controls, [['forward', true], ['forward', false]]);
});

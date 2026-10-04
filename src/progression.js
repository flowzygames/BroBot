import { assertTerrainTrusted } from './terrain-trust.js';
import { Vec3 } from 'vec3';

const AIR = new Set(['air', 'cave_air', 'void_air']);
const FACING = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const number = (minimum, maximum, description) => ({ type: 'integer', minimum, maximum, description });
const coordinate = number(-29999900, 29999900, 'An integer world block coordinate.');
const tool = (name, description, properties) => ({
  type: 'function', name, description, strict: true,
  parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false }
});

export const progressionDefinitions = [
  tool('progression_status', 'Inspect inventory-based survival milestones and observed End progress. Guidance is not proof that a task was completed.', {}),
  tool('build_nether_portal', 'Build and ignite a full 4-wide, 5-high obsidian portal on an already clear, supported site. Needs up to 14 obsidian and flint_and_steel. x/y/z is the bottom-left frame block. Existing correct obsidian is reused.', { x: coordinate, y: number(-63, 314, 'Bottom frame height.'), z: coordinate, axis: { type: 'string', enum: ['x', 'z'] } }),
  tool('enter_portal', 'Walk into a nearby active portal and confirm an actual dimension change. Does not create a portal.', { kind: { type: 'string', enum: ['nether', 'end'] }, radius: number(2, 32, 'Search radius in blocks.'), timeout: number(10, 60, 'Maximum seconds to wait, including approach.') }),
  tool('locate_stronghold', 'Throw one eye of ender in the Overworld and observe its flight. Records a bearing; two or more throws from positions at least 16 blocks apart can estimate a stronghold. Move roughly 64 blocks sideways between throws. Uses a real inventory eye; never uses /locate or world seed.', { reset: { type: 'boolean', description: 'Clear old bearings before this throw, for example after changing worlds.' } }),
  tool('activate_end_portal', 'Find a complete inward-facing End portal frame ring, insert missing inventory eyes through visible top faces, and verify portal blocks appear. Refuses malformed rings and insufficient eyes.', { radius: number(4, 32, 'Search radius in loaded terrain.' ) }),
  tool('shoot', 'Fire a bounded number of fully charged bow shots at a currently visible entity using a simulated arrow trajectory. Requires a bow and arrows. Reports observations, not assumed kills. Do not use on friendly players.', { entity_id: number(0, 2147483647, 'Entity id from inspect.'), shots: number(1, 8, 'Maximum arrows to fire.') }),
  tool('fight_dragon', 'Bounded End combat: shoot exposed End crystals, attack the perched dragon body on the pinned Minecraft 1.21.8, and stop at low health or blocked objectives. Caged crystals may need their bars removed with building/mining first. No victory is claimed without a death observation.', { duration: number(5, 120, 'Maximum combat seconds.') })
];

function dimension(value) {
  return String(value ?? 'unknown').replace(/^minecraft:/, '').replace(/^the_/, '');
}

function inventoryCounts(inventory) {
  if (Array.isArray(inventory)) return inventory.reduce((all, item) => {
    if (item && typeof item.name === 'string') all[item.name] = (all[item.name] ?? 0) + Math.max(0, Number(item.count) || 0);
    return all;
  }, {});
  return inventory && typeof inventory === 'object' ? inventory : {};
}

/** Inventory is evidence of readiness, never evidence that the dragon was defeated. */
export function observeProgression(snapshot = {}) {
  const counts = inventoryCounts(snapshot.inventory);
  const has = name => Number(counts[name] ?? 0) > 0;
  const count = name => Number(counts[name] ?? 0);
  const inDimension = dimension(snapshot.dimension ?? snapshot.game?.dimension);
  const tools = ['stone', 'iron', 'diamond', 'netherite'].some(material => has(`${material}_pickaxe`));
  const armor = ['helmet', 'chestplate', 'leggings', 'boots'].filter(slot =>
    ['iron', 'diamond', 'netherite'].some(material => has(`${material}_${slot}`) || snapshot.equipment?.[slot]?.name === `${material}_${slot}`));
  const bow = has('bow') && (count('arrow') + count('spectral_arrow') + count('tipped_arrow')) > 0;
  const eyesPotential = count('ender_eye') + Math.min(count('ender_pearl'), count('blaze_powder') + 2 * count('blaze_rod'));
  const facts = {
    dimension: inDimension, tools, armorPiecesCarriedOrObserved: armor.length,
    obsidian: count('obsidian'), canBuildFullNetherPortal: count('obsidian') >= 14 && has('flint_and_steel'),
    blazeRods: count('blaze_rod'), enderPearls: count('ender_pearl'), eyes: count('ender_eye'),
    potentialEyes: eyesPotential, hasBowAndArrows: bow
  };
  let next;
  if (inDimension === 'end') {
    next = bow ? 'Check food, armor, and health. Destroy exposed crystals; remove cage bars safely before attacking protected crystals. Fight the dragon during its perch, then verify death.' : 'Acquire a bow and arrows or arrange a safe way to reach crystals. Avoid staring at endermen. A dragon sighting is not a victory.';
  } else if (inDimension === 'nether') {
    next = count('blaze_rod') < 7 ? 'Remember the return portal. Explore loaded terrain for a fortress, fight blazes from cover, and collect blaze rods. Keep food, blocks, and gold armor available.' : 'Collect ender pearls through hunting or piglin barter, return to the Overworld, and craft eyes. Keep spare eyes for throws and breakage.';
  } else if (eyesPotential >= 12) {
    next = 'Craft eyes, reserve at least 12 for empty frames plus spare throws, and take separated eye bearings in the Overworld. Travel toward the estimate, take another bearing, then search the stronghold for the portal room.';
  } else if (facts.canBuildFullNetherPortal || count('blaze_rod') > 0) {
    next = 'Prepare food, iron armor, a shield, spare blocks, and a gold armor piece. Build or find a Nether portal; obtain blaze rods and ender pearls.';
  } else if (tools) {
    next = 'Secure food and shelter, mine and smelt iron, equip armor and a shield, and gather portal materials. Obsidian mining requires a diamond or netherite pickaxe; a found portal is another route.';
  } else {
    next = 'Gather logs, craft planks, sticks, a crafting table and wooden pickaxe, then collect cobblestone and make stone tools. Secure renewable food and shelter before exploring.';
  }
  return { ...facts, next, completion: 'unverified', note: 'Readiness inferred from current inventory; it does not certify survival progression or game completion.' };
}

export function portalBlueprint(x, y, z, axis = 'x') {
  if (![x, y, z].every(Number.isInteger) || !['x', 'z'].includes(axis)) throw new Error('Portal needs integer coordinates and axis x or z.');
  const at = (a, b) => ({ x: x + (axis === 'x' ? a : 0), y: y + b, z: z + (axis === 'z' ? a : 0) });
  const frame = [0, 1, 2, 3].map(a => at(a, 0));
  for (let b = 1; b < 4; b++) frame.push(at(0, b), at(3, b));
  frame.push(at(0, 4), at(1, 4), at(2, 4), at(3, 4));
  const interior = [];
  for (let b = 1; b < 4; b++) for (let a = 1; a < 3; a++) interior.push(at(a, b));
  return { frame, interior, igniteOn: at(1, 0) };
}

/** Least-squares intersection of observed X/Z rays; rejects unreliable geometry. */
export function triangulateBearings(bearings) {
  if (!Array.isArray(bearings) || bearings.length < 2) return { ok: false, reason: 'At least two observed eye bearings are required.' };
  const rays = bearings.map(b => {
    const length = Math.hypot(b.dx, b.dz);
    if (![b.x, b.z, b.dx, b.dz].every(Number.isFinite) || length < 0.0001) throw new Error('Invalid eye bearing.');
    return { x: b.x, z: b.z, dx: b.dx / length, dz: b.dz / length };
  });
  let baseline = 0;
  for (const a of rays) for (const b of rays) baseline = Math.max(baseline, Math.hypot(a.x - b.x, a.z - b.z));
  if (baseline < 16) return { ok: false, reason: 'Move at least 16 blocks sideways before another throw; 64 blocks is preferable.', baseline };
  let a = 0, b = 0, c = 0, u = 0, v = 0;
  for (const ray of rays) {
    const nx = -ray.dz, nz = ray.dx, d = nx * ray.x + nz * ray.z;
    a += nx * nx; b += nx * nz; c += nz * nz; u += nx * d; v += nz * d;
  }
  const determinant = a * c - b * b;
  if (determinant / (rays.length * rays.length) < 0.000025) return { ok: false, reason: 'Bearings are too nearly parallel. Take another throw farther sideways.', baseline };
  const x = (u * c - b * v) / determinant;
  const z = (a * v - b * u) / determinant;
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 29999900 || Math.abs(z) > 29999900) return { ok: false, reason: 'Intersection is outside the world bounds.' };
  if (rays.some(r => (x - r.x) * r.dx + (z - r.z) * r.dz < -8)) return { ok: false, reason: 'The rays intersect behind a throw. Reset bearings after passing a stronghold or changing worlds.' };
  const residual = Math.sqrt(rays.reduce((sum, r) => sum + ((x - r.x) * -r.dz + (z - r.z) * r.dx) ** 2, 0) / rays.length);
  if (residual > 8) return { ok: false, reason: 'Bearings disagree by more than 8 blocks. Observe another throw or reset old bearings.', residual };
  return { ok: true, x: Math.round(x), z: Math.round(z), baseline: Math.round(baseline), residual: Math.round(residual * 100) / 100, note: 'An estimate from eye flight, not a portal room location. Confirm with another throw near the estimate.' };
}

/** Simulate a fully charged bow: 3 blocks/tick, 0.99 drag, 0.05 gravity. */
export function solveBowShot(origin, target) {
  if (![origin?.x, origin?.y, origin?.z, target?.x, target?.y, target?.z].every(Number.isFinite)) throw new Error('Bow coordinates must be finite.');
  const dx = target.x - origin.x, dz = target.z - origin.z, distance = Math.hypot(dx, dz);
  if (distance < 0.5 || distance > 96) return null;
  const evaluate = pitch => {
    let h = 0, y = origin.y, vh = Math.cos(pitch) * 3, vy = Math.sin(pitch) * 3;
    const path = [{ x: origin.x, y, z: origin.z }];
    for (let tick = 1; tick <= 100; tick++) {
      const nextH = h + vh, nextY = y + vy;
      if (nextH >= distance) {
        const fraction = (distance - h) / vh;
        const impactY = y + vy * fraction;
        path.push({ x: target.x, y: impactY, z: target.z });
        return { pitch, yaw: Math.atan2(-dx, -dz), miss: Math.abs(impactY - target.y), ticks: tick - 1 + fraction, path };
      }
      h = nextH; y = nextY;
      path.push({ x: origin.x + h * dx / distance, y, z: origin.z + h * dz / distance });
      vh *= 0.99; vy = vy * 0.99 - 0.05;
    }
    return null;
  };
  let best = null;
  for (let degrees = -70; degrees <= 80; degrees += 0.5) {
    const candidate = evaluate(degrees * Math.PI / 180);
    if (candidate && (!best || candidate.miss < best.miss)) best = candidate;
  }
  if (!best) return null;
  const coarsePitch = best.pitch;
  for (let step = -10; step <= 10; step++) {
    const candidate = evaluate(coarsePitch + step * 0.05 * Math.PI / 180);
    if (candidate && candidate.miss < best.miss) best = candidate;
  }
  return best.miss <= 0.4 ? best : null;
}

/** A ring must contain all 12 frames, each facing its central 3x3 opening. */
export function findEndPortalRing(frames) {
  const byPosition = new Map(frames.map(f => [`${f.position.x},${f.position.y},${f.position.z}`, f]));
  for (const frame of frames) {
    const facing = frame.getProperties?.().facing ?? frame.facing;
    const direction = FACING[facing];
    if (!direction) continue;
    for (let shift = -1; shift <= 1; shift++) {
      const center = { x: frame.position.x + direction[0] * 2 + direction[1] * shift, y: frame.position.y, z: frame.position.z + direction[1] * 2 - direction[0] * shift };
      const ring = [];
      for (let offset = -1; offset <= 1; offset++) {
        ring.push([center.x + offset, center.z - 2, 'south'], [center.x + offset, center.z + 2, 'north'], [center.x - 2, center.z + offset, 'east'], [center.x + 2, center.z + offset, 'west']);
      }
      const found = ring.map(([x, z, wanted]) => {
        const f = byPosition.get(`${x},${center.y},${z}`);
        return f && (f.getProperties?.().facing ?? f.facing) === wanted ? f : null;
      });
      if (found.every(Boolean)) return { center, frames: found };
    }
  }
  return null;
}

/** End portals are non-solid: approach an adjacent support, then step into the verified opening. */
export function endPortalEdges(portals, blockAt) {
  const edges = [];
  for (const portal of portals) {
    for (const [dx, dz] of Object.values(FACING)) {
      const support = portal.position.offset(dx, 0, dz);
      const floor = blockAt(support), feet = blockAt(support.offset(0, 1, 0)), head = blockAt(support.offset(0, 2, 0));
      if (!floor || floor.boundingBox !== 'block' || ['magma_block', 'campfire', 'soul_campfire', 'cactus'].includes(floor.name)) continue;
      if (!feet || !head || !AIR.has(feet.name) || !AIR.has(head.name)) continue;
      if (!AIR.has(blockAt(portal.position.offset(0, 1, 0))?.name) || !AIR.has(blockAt(portal.position.offset(0, 2, 0))?.name)) continue;
      edges.push({ standing: support.offset(0, 1, 0), portal: portal.position });
    }
  }
  return edges;
}

function assertInteger(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be an integer from ${min} to ${max}.`);
}

function checked(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Action cancelled.');
}

function pause(ms, signal) {
  checked(signal);
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, ms);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason instanceof Error ? signal.reason : new Error('Action cancelled.')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

export function createProgression(bot, { actions, memory, log = () => {} }) {
  const checkSignal = checked;
  const checkedBot = signal => { assertTerrainTrusted(bot); checkSignal(signal); };
  const state = new Map();
  const get = (key, fallback) => memory?.get ? memory.get(key, fallback) : (state.get(key) ?? fallback);
  const set = (key, value) => memory?.set ? memory.set(key, value) : state.set(key, value);
  const block = p => bot.blockAt(new Vec3(p.x, p.y, p.z));
  const items = () => bot.inventory.items();
  const count = name => items().filter(i => i.name === name).reduce((sum, i) => sum + i.count, 0);
  const here = () => dimension(bot.game?.dimension);
  const health = signal => {
    checkedBot(signal);
    if (!bot.entity?.position || bot.health <= 0) throw new Error('Bot is not alive and spawned.');
    if (bot.health <= 8) throw new Error('Combat stopped: health is at or below four hearts. Eat and recover before retrying.');
  };
  const act = async (name, args, signal) => { checkedBot(signal); const result = await actions.execute(name, args, signal); checkedBot(signal); return result; };
  const equip = (name, signal) => act('equip', { item: name, destination: 'hand' }, signal);
  const approach = (p, signal, radius = 2) => act('go_to', { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), radius }, signal);
  const findBlocks = (name, radius, countLimit = 128) => {
    const type = bot.registry.blocksByName[name];
    if (!type) return [];
    return bot.findBlocks({ matching: type.id, maxDistance: radius, count: countLimit }).map(p => bot.blockAt(p)).filter(Boolean);
  };
  const waitUntil = async (predicate, ms, signal) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { checkedBot(signal); const result = predicate(); if (result) return result; await pause(100, signal); }
    checkedBot(signal);
    return null;
  };
  const eyes = () => bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0);

  async function clickTop(reference, signal) {
    checkedBot(signal);
    const eye = eyes(), target = reference.position.offset(0.5, 0.81, 0.5), delta = target.minus(eye);
    if (delta.norm() > 4.5) throw new Error('Top face is outside interaction reach.');
    const hit = bot.world.raycast(eye, delta.normalize(), 4.5);
    if (!hit?.position.equals(reference.position) || hit.face !== 1) throw new Error('Top face is obstructed. Approach from above the frame, outside the portal opening.');
    await bot.activateBlock(reference, new Vec3(0, 1, 0), new Vec3(0.5, 0.8125, 0.5));
    checkedBot(signal);
  }

  async function buildPortal(args, signal) {
    for (const key of ['x', 'z']) assertInteger(args[key], -29999900, 29999900, key);
    assertInteger(args.y, -63, 314, 'y');
    if (!['x', 'z'].includes(args.axis)) throw new Error('axis must be x or z.');
    if (here() === 'end') throw new Error('Nether portals cannot operate in the End.');
    if (bot.entity.position.distanceTo(new Vec3(args.x, args.y, args.z)) > 48) throw new Error('Approach within 48 blocks of the build site first.');
    const blueprint = portalBlueprint(args.x, args.y, args.z, args.axis);
    const needed = blueprint.frame.filter(p => block(p)?.name !== 'obsidian');
    for (const p of needed) {
      const b = block(p);
      if (!b || !AIR.has(b.name)) throw new Error(`Frame site ${p.x},${p.y},${p.z} must be loaded and clear air; found ${b?.name ?? 'unloaded terrain'}.`);
    }
    for (const p of blueprint.interior) {
      const b = block(p);
      if (!b || !(AIR.has(b.name) || ['fire', 'nether_portal'].includes(b.name))) throw new Error(`Portal opening is blocked at ${p.x},${p.y},${p.z}. Clear it first.`);
    }
    for (const p of blueprint.frame.slice(0, 4)) {
      const support = block({ ...p, y: p.y - 1 });
      if (!support || support.boundingBox !== 'block') throw new Error('All four bottom frame positions need existing solid support.');
    }
    if (!needed.length && blueprint.interior.some(p => block(p)?.name === 'nether_portal')) {
      const entry = blueprint.interior[0];
      memory?.setWaypoint?.(`portal_${here()}`, entry, bot.game.dimension);
      return { active: true, alreadyActive: true, placed: 0, entry, dimension: here() };
    }
    if (count('obsidian') < needed.length) throw new Error(`Need ${needed.length} more obsidian for this full frame; inventory has ${count('obsidian')}.`);
    if (!count('flint_and_steel')) throw new Error('Need flint_and_steel to ignite the portal.');
    let placed = 0;
    try {
      for (const p of needed) {
        // Standing next to a tall upright can hide its upper support faces.
        // Back out to a clear, grounded viewing position before placing the roof.
        if (p.y === args.y + 4) {
          const offsets = [2, -2, 1, -1];
          let positioned = false;
          for (const offset of offsets) {
            const stand = { x: p.x + (args.axis === 'z' ? offset : 0), y: args.y, z: p.z + (args.axis === 'x' ? offset : 0) };
            if (!AIR.has(block(stand)?.name) || !AIR.has(block({ ...stand, y: stand.y + 1 })?.name) || block({ ...stand, y: stand.y - 1 })?.boundingBox !== 'block') continue;
            try { await approach(stand, signal, 0); positioned = true; break; } catch { checkedBot(signal); }
          }
          if (!positioned) throw new Error('No reachable clear ground outside the frame gives access to its top.');
        }
        await act('place', { block: 'obsidian', ...p }, signal);
        if (block(p)?.name !== 'obsidian') throw new Error('Placement was not observed.');
        placed++;
      }
      if (!blueprint.interior.some(p => block(p)?.name === 'nether_portal')) {
        await approach({ ...blueprint.igniteOn, y: blueprint.igniteOn.y + 1 }, signal, 2);
        await equip('flint_and_steel', signal);
        const reference = block(blueprint.igniteOn);
        const eye = eyes(), top = reference.position.offset(0.5, 1, 0.5), delta = top.minus(eye);
        const distance = delta.norm();
        if (distance > 4.5) throw new Error('Cannot reach the bottom interior frame block to ignite it.');
        const hit = bot.world.raycast(eye, delta.scaled(1 / distance), distance + 0.1);
        if (hit && !hit.position.equals(reference.position)) throw new Error('Ignition face is obstructed.');
        await bot.activateBlock(reference, new Vec3(0, 1, 0), new Vec3(0.5, 1, 0.5));
        checkedBot(signal);
      }
      const active = await waitUntil(() => blueprint.interior.some(p => block(p)?.name === 'nether_portal'), 3000, signal);
      if (!active) throw new Error('Frame exists, but no active portal blocks were observed after ignition.');
      const entry = blueprint.interior[0];
      memory?.setWaypoint?.(`portal_${here()}`, entry, bot.game.dimension);
      return { active: true, placed, entry, dimension: here() };
    } catch (error) {
      error.message = `${error.message} Portal attempt placed ${placed} blocks; placed obsidian remains for a retry.`;
      throw error;
    }
  }

  async function enterPortal(args, signal) {
    if (!['nether', 'end'].includes(args.kind)) throw new Error('kind must be nether or end.');
    assertInteger(args.radius, 2, 32, 'radius'); assertInteger(args.timeout, 10, 60, 'timeout');
    const candidates = findBlocks(args.kind === 'nether' ? 'nether_portal' : 'end_portal', args.radius);
    candidates.sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
    if (!candidates.length) throw new Error(`No active ${args.kind} portal is loaded within ${args.radius} blocks.`);
    const start = here(), entry = candidates[0].position;
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    signal?.addEventListener('abort', forwardAbort, { once: true });
    checkedBot(signal);
    const timer = setTimeout(() => controller.abort(new Error('Portal approach or dimension transition timed out.')), args.timeout * 1000);
    const arrival = setInterval(() => { if (here() !== start) actions.stop(); }, 100);
    try {
      if (args.kind === 'end') {
        const edges = endPortalEdges(candidates, p => block(p));
        edges.sort((a, b) => a.standing.distanceTo(bot.entity.position) - b.standing.distanceTo(bot.entity.position));
        if (!edges.length) throw new Error('No clear, supported edge next to the active End portal is loaded. Prepare safe access first.');
        let edge = null, lastError;
        for (const candidate of edges.slice(0, 8)) {
          try { await approach(candidate.standing, controller.signal, 0); edge = candidate; break; }
          catch (error) { if (here() !== start) break; checkedBot(controller.signal); lastError = error; }
        }
        if (!edge && here() === start) throw lastError ?? new Error('No safe End portal edge was reachable.');
        if (here() === start) {
          if (block(edge.portal)?.name !== 'end_portal') throw new Error('The portal opening is no longer active.');
          const target = edge.portal.offset(0.5, 0, 0.5);
          const dx = target.x - bot.entity.position.x, dz = target.z - bot.entity.position.z;
          if (Math.hypot(dx, dz) > 1.7 || Math.abs(bot.entity.position.y - edge.standing.y) > 0.5) throw new Error('The bot did not reach the expected safe portal edge.');
          actions.stop();
          await bot.look(Math.atan2(-dx, -dz), 0, true); checkedBot(controller.signal);
          const enteredBy = Date.now() + 2000;
          bot.setControlState('forward', true);
          try {
            while (here() === start && Date.now() < enteredBy) {
              checkedBot(controller.signal);
              const p = bot.entity.position;
              if (Math.hypot(target.x - p.x, target.z - p.z) < 0.2) break;
              if (p.y < edge.portal.y - 0.5) throw new Error('The bot fell below the expected portal surface without a dimension change.');
              await pause(25, controller.signal);
            }
          } finally { bot.setControlState('forward', false); }
        }
      } else {
        try { await approach(entry, controller.signal, 0); } catch (error) { if (here() === start) throw error; }
      }
      const changed = await waitUntil(() => here() !== start, args.timeout * 1000, controller.signal);
      if (!changed) throw new Error('The bot reached the portal but no dimension change was observed.');
      await pause(500, signal);
      memory?.setWaypoint?.(`portal_${here()}`, { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }, bot.game.dimension);
      return { transitioned: true, from: start, to: here(), position: { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z } };
    } finally { clearTimeout(timer); clearInterval(arrival); signal?.removeEventListener('abort', forwardAbort); actions.stop(); }
  }

  async function locateStronghold(args, signal) {
    if (typeof args.reset !== 'boolean') throw new Error('reset must be a boolean.');
    if (here() !== 'overworld') throw new Error('Eyes locate strongholds in the Overworld; return there first.');
    if (!count('ender_eye')) throw new Error('An ender_eye is required for an observed throw.');
    if (args.reset) set('eyeBearings', []);
    await equip('ender_eye', signal);
    const start = bot.entity.position.clone(), oldIds = new Set(Object.keys(bot.entities));
    let tracked = null;
    const samples = [];
    const sample = entity => {
      if (tracked && entity.id !== tracked.id) return;
      if (!tracked) {
        if (entity.name !== 'eye_of_ender' || oldIds.has(String(entity.id)) || entity.position.distanceTo(start) > 6) return;
        tracked = entity;
      }
      samples.push({ x: entity.position.x, y: entity.position.y, z: entity.position.z });
    };
    bot.on('entitySpawn', sample); bot.on('entityMoved', sample);
    try {
      await bot.look(bot.entity.yaw, 0.35, true); checkedBot(signal);
      bot.activateItem();
      await waitUntil(() => tracked, 2500, signal);
      if (!tracked) throw new Error('No newly thrown eye entity was observed. Check that there is open space above; do not assume a bearing.');
      await pause(1800, signal);
      sample(tracked);
    } finally { bot.removeListener('entitySpawn', sample); bot.removeListener('entityMoved', sample); bot.deactivateItem(); }
    if (samples.length < 2) throw new Error('Insufficient eye movement packets were observed.');
    const first = samples[0], last = samples[samples.length - 1];
    const travel = Math.hypot(last.x - first.x, last.z - first.z);
    if (travel < 2) return { bearingRecorded: false, nearVerticalFlight: true, observed: { first, last }, guidance: 'Eye flight had little horizontal travel. You may be close to the stronghold, or the trajectory was obstructed. Reobserve from a clear nearby location before digging.' };
    const bearing = { x: first.x, z: first.z, dx: (last.x - first.x) / travel, dz: (last.z - first.z) / travel, observedAt: new Date().toISOString() };
    const previous = get('eyeBearings', []);
    const bearings = [...(Array.isArray(previous) ? previous : []), bearing].slice(-12);
    set('eyeBearings', bearings);
    const estimate = triangulateBearings(bearings);
    if (estimate.ok) memory?.setWaypoint?.('stronghold_estimate', { x: estimate.x, y: start.y, z: estimate.z }, bot.game.dimension);
    return { bearingRecorded: true, bearings: bearings.length, bearing, estimate, suggestedNextThrow: { x: Math.round(start.x - bearing.dz * 64), z: Math.round(start.z + bearing.dx * 64) }, guidance: 'Pick a safe route to a sideways sampling position. The suggested coordinate is not a checked path. Collect the dropped eye if it survived.' };
  }

  async function activateEndPortal(args, signal) {
    assertInteger(args.radius, 4, 32, 'radius');
    const ring = findEndPortalRing(findBlocks('end_portal_frame', args.radius, 64));
    if (!ring) throw new Error('No complete, correctly oriented 12-frame End portal ring was found in loaded terrain.');
    const hasEye = f => [true, 'true'].includes(f.getProperties().eye);
    const missing = ring.frames.filter(f => !hasEye(f));
    if (count('ender_eye') < missing.length) throw new Error(`This ring needs ${missing.length} eyes; inventory has ${count('ender_eye')}.`);
    let inserted = 0;
    for (const original of missing) {
      checkedBot(signal);
      let frame = block(original.position);
      if (hasEye(frame)) continue;
      const facing = FACING[frame.getProperties().facing];
      const outside = { x: frame.position.x - facing[0], y: frame.position.y + 1, z: frame.position.z - facing[1] };
      await approach(outside, signal, 0);
      await equip('ender_eye', signal);
      frame = block(original.position);
      await clickTop(frame, signal);
      if (!await waitUntil(() => hasEye(block(original.position)), 2000, signal)) throw new Error(`Eye insertion was not observed at ${frame.position}. ${inserted} eyes were inserted before stopping.`);
      inserted++;
    }
    const active = await waitUntil(() => block(ring.center)?.name === 'end_portal', 3000, signal);
    if (!active) throw new Error('Frames were filled, but the center is not an active End portal. No transition was attempted.');
    memory?.setWaypoint?.('end_portal', ring.center, bot.game.dimension);
    return { active: true, inserted, center: ring.center };
  }

  function clearTrajectory(shot) {
    for (let i = 1; i < shot.path.length; i++) {
      const previous = new Vec3(shot.path[i - 1].x, shot.path[i - 1].y, shot.path[i - 1].z);
      const next = new Vec3(shot.path[i].x, shot.path[i].y, shot.path[i].z);
      if (!bot.blockAt(next)) return { clear: false, reason: 'Arrow trajectory crosses unloaded terrain.' };
      const delta = next.minus(previous);
      const distance = delta.norm();
      if (distance < 0.001) continue;
      const hit = bot.world.raycast(previous, delta.scaled(1 / distance), distance);
      if (hit) return { clear: false, reason: `Arrow trajectory is blocked by ${hit.name}.`, position: hit.position };
    }
    return { clear: true };
  }

  async function fireArrow(entity, signal) {
    health(signal);
    if (!count('bow')) throw new Error('A bow is required.');
    if (!items().some(i => ['arrow', 'spectral_arrow', 'tipped_arrow'].includes(i.name))) throw new Error('Arrows are required.');
    if (entity.type === 'player' || entity.username) throw new Error('This ranged combat tool does not attack players.');
    if (entity.name === 'end_crystal' && entity.position.distanceTo(bot.entity.position) < 8) return { fired: false, blocked: 'End crystal is too close: back away at least 8 blocks before shooting an explosive crystal.' };
    actions.stop();
    await equip('bow', signal);
    let fired = false;
    try {
      bot.activateItem();
      await pause(1100, signal);
      const live = bot.entities[entity.id];
      if (!live) return { fired: false, targetPresent: false };
      const target = live.position.offset(0, Math.min(1, (live.height ?? 1) * 0.5), 0);
      const shot = solveBowShot(eyes().offset(0, -0.1, 0), target);
      if (!shot) return { fired: false, blocked: 'No reliable bow trajectory within 96 horizontal blocks.' };
      const trajectory = clearTrajectory(shot);
      if (!trajectory.clear) return { fired: false, blocked: trajectory.reason, obstruction: trajectory.position };
      await bot.look(shot.yaw, shot.pitch, true); checkedBot(signal);
      bot.deactivateItem(); fired = true;
      await pause(Math.min(3500, Math.max(700, shot.ticks * 50 + 300)), signal);
      return { fired: true, targetPresent: Boolean(bot.entities[entity.id]) };
    } finally {
      if (!fired && bot.usingHeldItem) {
        // Switching away cancels a bow draw without releasing an un-aimed arrow.
        bot.setQuickBarSlot((bot.quickBarSlot + 1) % 9);
        bot.deactivateItem();
      }
    }
  }

  async function shoot(args, signal) {
    assertInteger(args.entity_id, 0, 2147483647, 'entity_id'); assertInteger(args.shots, 1, 8, 'shots');
    const target = bot.entities[args.entity_id];
    if (!target) throw new Error('That entity is not currently loaded.');
    let deathObserved = false, shots = 0;
    const died = e => { if (e.id === args.entity_id) deathObserved = true; };
    bot.on('entityDead', died);
    try {
      for (let i = 0; i < args.shots && bot.entities[args.entity_id]; i++) {
        const result = await fireArrow(target, signal);
        if (!result.fired) return { shots, deathObserved, ...result };
        shots++;
      }
      return { shots, deathObserved, targetPresent: Boolean(bot.entities[args.entity_id]) };
    } finally { bot.removeListener('entityDead', died); }
  }

  function safeGround(x, z, startY) {
    for (let y = Math.floor(startY) + 2; y >= Math.floor(startY) - 12; y--) {
      const floor = block({ x, y: y - 1, z }), feet = block({ x, y, z }), head = block({ x, y: y + 1, z });
      if (floor?.boundingBox === 'block' && !['magma_block', 'cactus'].includes(floor.name) && feet && AIR.has(feet.name) && head && AIR.has(head.name)) return { x, y, z };
    }
    return null;
  }

  async function fightDragon(args, parentSignal) {
    assertInteger(args.duration, 5, 120, 'duration');
    if (here() !== 'end') throw new Error('Dragon combat is only available in the End.');
    health(parentSignal);
    const budget = new AbortController();
    const signal = parentSignal ? AbortSignal.any([parentSignal, budget.signal]) : budget.signal;
    const timer = setTimeout(() => budget.abort(new Error('Combat duration elapsed.')), args.duration * 1000);
    const until = Date.now() + args.duration * 1000, initial = bot.entity.position.clone();
    let arrows = 0, meleeAttempts = 0, deathObserved = false, reason = 'Combat time budget reached.';
    const blockedCrystals = new Map(), vanishedCrystals = new Set();
    const died = entity => { if (entity.name === 'ender_dragon') deathObserved = true; };
    const result = () => ({ dragonDeathObserved: deathObserved, exitPortalObserved: findBlocks('end_portal', 64, 16).length > 0, arrowsFired: arrows, meleeAttempts, crystalsNoLongerPresent: [...vanishedCrystals], blockedCrystals: [...blockedCrystals].map(([id, obstruction]) => ({ id, obstruction })), reason, note: 'Attack attempts and entity disappearance are not kill confirmations. This controller does not certify an autonomous full-game run.' });
    bot.on('entityDead', died);
    try {
      while (Date.now() < until) {
        health(signal);
        if (here() !== 'end') { reason = 'Bot left the End.'; break; }
        if (deathObserved) { reason = 'Dragon death event observed.'; break; }
        if (bot.food < 16) {
          await act('eat', {}, signal);
          health(signal);
        }
        const entities = Object.values(bot.entities);
        const cloud = entities.find(e => e.name === 'area_effect_cloud' && e.position.distanceTo(bot.entity.position) < 7);
        if (cloud) {
          const away = bot.entity.position.minus(cloud.position); const length = Math.hypot(away.x, away.z) || 1;
          const escape = safeGround(Math.floor(bot.entity.position.x + away.x / length * 9), Math.floor(bot.entity.position.z + away.z / length * 9), bot.entity.position.y);
          if (!escape) { reason = 'Dragon breath nearby; no checked escape ground found. Retreat manually.'; break; }
          await approach(escape, signal, 1); continue;
        }
        const crystals = entities.filter(e => e.name === 'end_crystal').sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position));
        const crystal = crystals.find(e => !blockedCrystals.has(e.id));
        if (crystal) {
          const result = await fireArrow(crystal, signal);
          if (result.fired) { arrows++; if (!result.targetPresent) vanishedCrystals.add(crystal.id); }
          else blockedCrystals.set(crystal.id, result.blocked ?? 'Target disappeared before firing.');
          if (arrows >= 32) { reason = 'Arrow budget reached; inspect remaining crystals.'; break; }
          continue;
        }
        if (crystals.length) { reason = 'Remaining crystals have blocked or out-of-range trajectories. Remove cages or move to a safe shooting position before retrying.'; break; }
        const dragon = entities.find(e => e.name === 'ender_dragon');
        if (!dragon) { reason = 'No dragon is currently loaded. Absence alone does not prove victory.'; break; }
        const keys = bot.registry.entitiesByName.ender_dragon?.metadataKeys ?? [];
        const phase = dragon.metadata?.[keys.indexOf('phase')];
        if (phase === 9) { await pause(500, signal); continue; }
        if (![6, 7].includes(phase)) { await pause(400, signal); continue; }
        if (bot.version !== '1.21.8') { reason = 'Multipart dragon melee is implemented only for the pinned Minecraft 1.21.8.'; break; }
        const weapon = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'netherite_axe', 'diamond_axe', 'iron_axe'].find(name => count(name));
        if (!weapon) { reason = 'A stone-or-better sword or iron-or-better axe is required for perched melee.'; break; }
        // Vanilla 1.21.8 allocates the dragon's head, neck, and body parts at
        // parent id + 1, + 2, and + 3. Attacking the parent does not hit a part.
        // The broad body is a conservative target; its damage is below head damage.
        const distance = dragon.position.distanceTo(eyes());
        if (distance > 4) {
          const ground = safeGround(Math.floor(dragon.position.x), Math.floor(dragon.position.z + 3), dragon.position.y);
          if (!ground || new Vec3(ground.x, ground.y, ground.z).distanceTo(initial) > 64) { reason = 'No checked perch approach exists nearby. Move to the central island safely.'; break; }
          await approach(ground, signal, 1); continue;
        }
        await equip(weapon, signal); health(signal);
        const current = bot.entities[dragon.id];
        const currentPhase = current?.metadata?.[keys.indexOf('phase')];
        if (!current || ![6, 7].includes(currentPhase)) continue;
        await bot.lookAt(current.position, true); checkedBot(signal);
        bot.attack({ id: current.id + 3 }); meleeAttempts++;
        await pause(700, signal);
      }
      if (deathObserved) set('dragonDeathObserved', { at: new Date().toISOString(), dimension: 'end', evidence: 'entityDead event for ender_dragon' });
      return result();
    } catch (error) {
      checkedBot(parentSignal);
      if (!budget.signal.aborted) throw error;
      return result();
    } finally { clearTimeout(timer); bot.removeListener('entityDead', died); actions.stop(); }
  }

  const handlers = {
    progression_status: () => ({ ...observeProgression(actions.snapshot()), savedEyeBearings: get('eyeBearings', []).length, dragonDeathObservation: get('dragonDeathObserved', null) }),
    build_nether_portal: buildPortal, enter_portal: enterPortal, locate_stronghold: locateStronghold,
    activate_end_portal: activateEndPortal, shoot, fight_dragon: fightDragon
  };
  let running = false;
  return {
    definitions: progressionDefinitions,
    async execute(name, args = {}, signal) {
      if (!Object.hasOwn(handlers, name)) throw new Error(`Unknown progression tool: ${name}`);
      if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Progression arguments must be an object.');
      checkedBot(signal);
      if (running) throw new Error('A progression action is already running. Cancel it before starting another.');
      running = true;
      const stop = () => { if (bot.usingHeldItem && bot.heldItem?.name === 'bow') bot.setQuickBarSlot((bot.quickBarSlot + 1) % 9); actions.stop(); };
      signal?.addEventListener('abort', stop, { once: true });
      try { return await handlers[name](args, signal); }
      catch (error) { if (typeof log === 'function') log('progression_error', `${name}: ${error.message}`); throw error; }
      finally { signal?.removeEventListener('abort', stop); running = false; }
    }
  };
}

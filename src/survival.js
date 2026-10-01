import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';

export const STARTER_LOG_RADIUS = 48;
const LOW_AIR_MESSAGE = 'Air is low. Work stopped, but the world keeps running. Bring BroBot above water before resuming.';
const WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'pale_oak'];
const FOODS = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'carrot', 'apple'];
const countItems = state => Object.fromEntries((state.inventory ?? []).map(i => [i.name, (state.inventory ?? []).filter(j => j.name === i.name).reduce((n, j) => n + j.count, 0)]));
const distance = (a, b) => a && b ? Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) : Infinity;
const dimension = d => String(d).replace(/^minecraft:/, '');
const action = (name, args, reason) => ({ name, args, reason });

// An explicit offline controller, not a substitute label for an untested LLM.
// Every decision is recomputed from observed inventory/world state. No assumed
// recipe success, granted items, teleport, seed lookup, or console commands.
export function nextStarterStep(state, job, observation = {}) {
  const items = countItems(state);
  const has = name => (items[name] ?? 0) > 0;
  if (!state.connected || !state.position) return { blocked: 'Minecraft is disconnected.' };
  if (dimension(state.dimension) !== dimension(job.home.dimension)) return { blocked: 'The world dimension changed. Start a new job in the intended world.' };
  if (Number.isFinite(state.oxygen) && state.oxygen <= 10) return { blocked: LOW_AIR_MESSAGE };
  if (state.health <= 8) return { blocked: 'Health is too low to continue gathering safely.' };
  if (distance(state.position, job.home.position) > 96) return { blocked: 'The starter job reached its 96-block travel boundary.' };
  if (state.food != null && state.food <= 10) {
    const food = FOODS.find(has);
    return food ? action('eat', { item: food }, 'Recover hunger before working.') : { blocked: 'Food is low and no supported safe food is carried.' };
  }
  if ((state.entities ?? []).some(e => e.type === 'hostile' && e.distance < 6)) return { blocked: 'A hostile mob is too close for unarmored starter gathering.' };
  if (has('stone_pickaxe') && has('furnace')) {
    if (distance(state.position, job.home.position) <= 2.5) return { complete: true, evidence: { stone_pickaxe: items.stone_pickaxe, furnace: items.furnace, homeDistance: distance(state.position, job.home.position) } };
    return action('go_to', { x: Math.floor(job.home.position.x), y: Math.floor(job.home.position.y), z: Math.floor(job.home.position.z), radius: 1 }, 'Return to the job starting point with the starter kit.');
  }
  const ensurePlanks = wanted => {
    if (WOODS.some(w => (items[`${w}_planks`] ?? 0) >= wanted)) return null;
    const wood = WOODS.find(w => has(`${w}_log`));
    if (wood) return action('craft', { item: `${wood}_planks`, count: Math.min(wanted - (items[`${wood}_planks`] ?? 0), items[`${wood}_log`] * 4) }, 'Turn carried logs into the needed planks.');
    if (!observation.wood) return { scout: 'No supported tree logs are visible nearby.' };
    const startingTools = !['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].some(has);
    const logCount = startingTools ? 3 : Math.max(1, Math.min(3, Math.ceil(wanted / 4)));
    return action('collect', { block: `${observation.wood}_log`, count: logCount, radius: STARTER_LOG_RADIUS }, startingTools ? 'Gather one bounded batch for the table, sticks and first pickaxe.' : 'Gather only the wood currently needed.');
  };
  const table = has('crafting_table') || observation.tableInReach;
  const ensureTable = () => {
    const ignored = job.ignoredTables ?? [];
    const known = (job.tables ?? []).filter(p => distance(p, job.home.position) <= 90).filter(p => !ignored.some(q => distance(p, q) < 1)).sort((a, b) => distance(a, state.position) - distance(b, state.position))[0];
    if (known) return { ...action('go_to', { x: known.x, y: known.y, z: known.z, radius: 2 }, 'Return to an observed crafting table instead of searching for more wood.'), waypointKind: 'table' };
    return ensurePlanks(4) ?? action('craft', { item: 'crafting_table', count: 1 }, 'Make a portable crafting table.');
  };
  const hasMiningTool = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe', 'netherite_pickaxe'].some(has);
  if (!hasMiningTool) {
    if (!table) return ensureTable();
    if ((items.stick ?? 0) < 2) return ensurePlanks(2) ?? action('craft', { item: 'stick', count: 4 }, 'Make pickaxe handles.');
    return ensurePlanks(3) ?? action('craft', { item: 'wooden_pickaxe', count: 1 }, 'Craft the first mining tool.');
  }
  if (!has('stone_pickaxe') && (items.stick ?? 0) < 2) return ensurePlanks(2) ?? action('craft', { item: 'stick', count: 4 }, 'Prepare stone-pickaxe handles.');
  // If the table is elsewhere, gather the full kit before making a return trip.
  // Upgrade immediately when a usable table is already nearby.
  const requiredStone = has('stone_pickaxe') ? 8 : table ? 3 : 11;
  if ((items.cobblestone ?? 0) < requiredStone) {
    const needed = requiredStone - (items.cobblestone ?? 0);
    return action('collect', { block: 'stone', count: Math.min(needed, 4), radius: 32 }, 'Collect a bounded batch of stone and verify its drops.');
  }
  if (!table) return ensureTable();
  return has('stone_pickaxe') ? action('craft', { item: 'furnace', count: 1 }, 'Craft a furnace from eight verified cobblestone.') : action('craft', { item: 'stone_pickaxe', count: 1 }, 'Upgrade to a stone pickaxe.');
}

export class SurvivalJob {
  constructor({ memory, snapshot, observe, execute, stopActions, context, log = () => {}, maxSteps = 64, maxDurationMs = 600000, intervalMs = 150 }) {
    Object.assign(this, { memory, snapshot, observe, execute, stopActions, context, log, maxSteps, maxDurationMs, intervalMs });
    this.active = null;
    this.job = memory.get('survivalJob', null);
    if (this.job && (this.job.version !== 1 || typeof this.job.context !== 'string' || !Array.isArray(this.job.history) || !Number.isSafeInteger(this.job.steps) || this.job.steps < 0 || !Number.isSafeInteger(this.job.scouts) || this.job.scouts < 0 || !this.job.home?.position || !['x', 'y', 'z'].every(k => Number.isFinite(this.job.home.position[k])) || !['running', 'paused', 'blocked', 'complete'].includes(this.job.status))) throw new Error('Saved starter job is invalid. Restore its record before resuming.');
    if (this.job?.status === 'running') { this.job.status = 'paused'; this.job.reason = 'Process restarted. Resume explicitly after checking the world.'; this.save(); }
  }
  save() { this.memory.set('survivalJob', this.job); }
  state() { return this.job ? structuredClone({ ...this.job, history: this.job.history.slice(-8), stopping: Boolean(this.active?.signal.aborted) }) : null; }
  stop(reason = 'Paused by player') { this.active?.abort(new Error(reason)); this.stopActions(reason); }
  checkAir() {
    const oxygen = this.snapshot().oxygen;
    if (this.active && Number.isFinite(oxygen) && oxygen <= 10) this.stop(LOW_AIR_MESSAGE);
  }
  start({ resume = false } = {}) {
    if (this.active) throw new Error('A starter job is already running or stopping.');
    const state = this.snapshot();
    if (!state.connected || !state.position) throw new Error('Connect to Minecraft before starting.');
    if (resume) {
      if (!this.job || !['paused', 'blocked'].includes(this.job.status)) throw new Error('No paused starter job to resume.');
      if (this.job.context !== this.context || dimension(state.dimension) !== dimension(this.job.home.dimension)) throw new Error('Saved job belongs to another connection or dimension. Start a new job.');
    } else {
      this.job = { version: 1, id: randomUUID(), goal: 'starter', context: this.context, home: { position: { ...state.position }, dimension: state.dimension }, steps: 0, scouts: 0, clearings: 0, excluded: {}, history: [], started: new Date().toISOString() };
    }
    this.job.status = 'running'; this.job.reason = null; this.save();
    this.log('survival', `${resume ? 'Resuming' : 'Starting'} offline starter kit: stone pickaxe, furnace, then return to start.`);
    const controller = new AbortController(); this.active = controller;
    const timer = setTimeout(() => { controller.abort(new Error('Starter job time budget reached.')); this.stopActions('Starter job time budget reached.'); }, this.maxDurationMs); timer.unref?.();
    this.promise = this.loop(controller.signal).catch(error => {
      this.job.status = controller.signal.aborted ? 'paused' : 'blocked'; this.job.reason = error.message;
      this.log('survival', `Starter job ${this.job.status}: ${error.message}`);
    }).finally(() => { clearTimeout(timer); this.save(); if (this.active === controller) this.active = null; });
    return { started: true, mode: 'offline-observation-driven', goal: 'stone pickaxe and furnace, then return to start', id: this.job.id };
  }
  async loop(signal) {
    const deadline = Date.now() + this.maxDurationMs;
    const failures = new Map();
    const firstStep = this.job.steps;
    let recovery = null;
    const excludeFailures = (decision, result) => {
      if (decision.name !== 'collect' || !result?.failures) return;
      this.job.excluded ??= {};
      const old = this.job.excluded[decision.args.block] ?? [];
      const positions = result.failures.filter(f => f.position && f.code !== 'COLLECTION_PLANNING_LIMIT' && /route|reach|planning|obstruct/i.test(f.error ?? '')).map(f => f.position);
      const unique = new Map([...old, ...positions].map(p => [JSON.stringify(p), p]));
      this.job.excluded[decision.args.block] = [...unique.values()].slice(-128);
    };
    const remember = entry => { this.job.history.push({ at: new Date().toISOString(), ...entry }); this.job.history = this.job.history.slice(-32); this.save(); };
    while (this.job.steps - firstStep < this.maxSteps) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error('Starter job time budget reached. Review progress before resuming.');
      const before = this.snapshot();
      // Check lifecycle/health before any further inspection or movement.
      let decision = nextStarterStep(before, this.job, {});
      if (decision.blocked) throw new Error(decision.blocked);
      const observation = await this.observe(signal);
      signal.throwIfAborted();
      if (Array.isArray(observation.tables)) this.job.tables = observation.tables.slice(0, 8);
      decision = nextStarterStep(this.snapshot(), this.job, observation);
      if (decision.blocked) throw new Error(decision.blocked);
      if (decision.complete) { this.job.status = 'complete'; this.job.evidence = decision.evidence; this.job.reason = 'Observed a stone pickaxe and furnace in inventory, alive and back at the start.'; this.log('survival', this.job.reason); return; }
      if (recovery?.name === 'pickup') {
        // A clearance action may already collect the tracked materials. Never
        // turn its stale continuation into an unscoped trip after other litter.
        const remaining = new Set(this.job.recoverDropIds ?? []);
        recovery.args.entity_ids = (recovery.args.entity_ids ?? []).filter(id => remaining.has(id));
        if (!recovery.args.entity_ids.length) recovery = null;
      }
      if (recovery) {
        // Fresh inventory may already satisfy the next prerequisite. Do not
        // chase leftover drops instead of crafting or taking a finished kit home.
        if (recovery.name !== 'pickup' || decision.name === 'collect' || decision.scout) decision = recovery;
        recovery = null;
      }
      if (decision.name === 'pickup' && observation.pickupClearance && (this.job.clearanceDigs ?? 0) < 8) {
        this.job.clearanceDigs = (this.job.clearanceDigs ?? 0) + 1;
        decision = action('dig_at', observation.pickupClearance, 'Open safe headroom above an observed drop, then pick it up.');
        recovery = action('pickup', { radius: 16, entity_ids: [...(this.job.recoverDropIds ?? [])] }, 'Pick up the materials after opening headroom.');
      }
      if (decision.scout) {
        if (this.job.scouts >= 8) throw new Error(`Exploration budget exhausted: ${decision.scout}`);
        const directions = ['north', 'east', 'south', 'west'];
        const index = this.job.scouts++;
        const direction = directions[index % 4], travel = 12 * (1 + Math.floor(index / 2));
        const offsets = { north: [0, -travel], east: [travel, 0], south: [0, travel], west: [-travel, 0] };
        const [dx, dz] = offsets[direction];
        const target = { ...before.position, x: before.position.x + dx, z: before.position.z + dz };
        if (distance(target, this.job.home.position) > 90) throw new Error('No bounded exploration target remains inside the job area.');
        decision = action('explore', { direction, distance: travel, returnable: true }, decision.scout);
      }
      const signature = JSON.stringify([decision.name, decision.args]);
      if (decision.name === 'collect' && this.job.excluded?.[decision.args.block]?.length) decision.args.skip_positions = this.job.excluded[decision.args.block];
      if ((failures.get(signature) ?? 0) >= 2) {
        if (decision.name === 'go_to') {
          if (decision.waypointKind !== 'table') throw new Error('Cannot verify a route home after two attempts. Starter kit is not marked complete.');
          this.job.ignoredTables ??= [];
          this.job.ignoredTables.push({ x: decision.args.x, y: decision.args.y, z: decision.args.z });
          failures.delete(signature); continue;
        }
        if (decision.name === 'collect' && /_log$/.test(decision.args.block) && observation.foliage && (this.job.clearings ?? 0) < 4) {
          this.job.clearings = (this.job.clearings ?? 0) + 1;
          recovery = action('dig_at', observation.foliage, 'Clear one observed leaf obstruction in front of a needed tree.');
        } else recovery = { scout: `Repeated ${decision.name} failure. Look for a different approach.` };
        // Scout decisions are resolved on the next pass; keep a bounded retry cap
        // even when environment changes, instead of silently clearing failures.
        failures.delete(signature);
        continue;
      }
      this.job.steps++; this.save();
      try {
        const result = await this.execute(decision.name, decision.args, signal);
        signal.throwIfAborted();
        const after = this.snapshot();
        excludeFailures(decision, result);
        const initialItems = countItems(before), finalItems = countItems(after);
        const gained = Object.entries(finalItems).some(([name, count]) => count > (initialItems[name] ?? 0));
        const terrainCleared = decision.name === 'dig_at' && result.mined === 1;
        if (terrainCleared) {
          // A verified local terrain change can invalidate an earlier blocked
          // approach. Retry nearby resources while retaining distant failures.
          for (const [block, positions] of Object.entries(this.job.excluded ?? {})) {
            this.job.excluded[block] = positions.filter(p => distance(p, decision.args) > 6);
          }
          this.job.ignoredTables = (this.job.ignoredTables ?? []).filter(p => distance(p, decision.args) > 6);
        }
        const progress = gained || terrainCleared || (decision.name === 'explore' && distance(before.position, after.position) > 1) || (decision.name === 'go_to' && distance(after.position, decision.args) < distance(before.position, decision.args) - 1) || (after.food ?? 0) > (before.food ?? 0);
        remember({ action: decision.name, args: decision.args, reason: decision.reason, result, progress });
        if (progress) failures.clear();
        else failures.set(signature, (failures.get(signature) ?? 0) + 1);
        if (Array.isArray(result.remaining_drops)) this.job.recoverDropIds = result.remaining_drops.map(d => d.id).slice(0, 24);
        if (decision.name === 'collect' && result.remaining_drops?.length) recovery = action('pickup', { radius: 16, entity_ids: [...(this.job.recoverDropIds ?? [])] }, 'Recover observed dropped materials before mining more.');
      } catch (error) {
        signal.throwIfAborted(); failures.set(signature, (failures.get(signature) ?? 0) + 1);
        excludeFailures(decision, error.result);
        remember({ action: decision.name, args: decision.args, error: error.message, result: error.result });
      }
      await sleep(this.intervalMs, undefined, { signal });
    }
    const final = nextStarterStep(this.snapshot(), this.job, {});
    if (final.complete) { this.job.status = 'complete'; this.job.evidence = final.evidence; this.job.reason = 'Observed the complete starter kit back at the start on the final allowed step.'; return; }
    throw new Error('Starter job step budget reached. No completion claimed.');
  }
}

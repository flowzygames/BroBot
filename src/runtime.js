import { retainedTravelArrivals } from './survival.js';
import { assertTerrainTrusted, terrainTrustStatus } from './terrain-trust.js';
import { isFluidBearingBlock } from './navigation-guards.js';
import { craftGeometryKey } from './craft-retry-evidence.js';
import { observeOwnInjuries } from './injury-observer.js';
import { pinnedSprintCompatibility } from './protocol-compatibility.js';
import { sectionSearchDistance } from './block-search.js';
import { STARTER_MOVEMENT_RADIUS, STARTER_MIN_HEALTH } from './starter-limits.js';
import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import toolModule from 'mineflayer-tool';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import { Memory } from './memory.js';
import { ActionRunner } from './runner.js';
import { createActions, visibleBlockFace } from './actions.js';
import { createProgression, observeProgression } from './progression.js';
import { Brain } from './brain.js';
import { SurvivalJob, STARTER_LOG_RADIUS, nextStarterStep } from './survival.js';
import { findTransitPickupClearance } from './pickup-transit.js';
import { findPickupClearance, findTreeFoliage, hasPowderSnowContact, hasLavaContact } from './survival-observation.js';
import { publicConfig } from './config.js';
import { parseCommand, authorizedChat, HELP } from './commands.js';

function strictTool(name, description, properties) {
  return { type: 'function', name, description, strict: true, parameters: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false } };
}

export class Runtime {
  constructor(config) {
    this.config = config;
    this.memory = new Memory(config.dataDir);
    this.events = [];
    this.connection = 'disconnected';
    this.bot = null;
    this.actions = null;
    this.progression = null;
    this.closed = false;
    this.owner = this.memory.get('owner', config.minecraft.owner);
    this.runner = new ActionRunner({ timeoutMs: config.actionTimeoutMs, log: this.log.bind(this) });
    this.localDefinitions = [
      strictTool('remember', 'Save a short factual note for future play sessions.', { text: { type: 'string' } }),
      strictTool('save_waypoint', 'Save the current position and dimension with a short name.', { name: { type: 'string' } }),
      strictTool('go_to_waypoint', 'Go to a saved waypoint in the current dimension. Must be within 128 blocks.', { name: { type: 'string' } }),
      strictTool('say', 'Send a short friendly chat message to the player; never a slash command.', { message: { type: 'string' } }),
    ];
    this.brain = new Brain({ config: config.ai, memory: this.memory, definitions: () => this.definitions(), snapshot: () => this.snapshot(), execute: (name, args, signal) => this.execute(name, args, signal), stopActions: reason => this.runner.stop(reason), say: text => this.say(text), log: this.log.bind(this) });
    this.playSession = 0;
    this.terrainRevision = 0;
    this.survival = new SurvivalJob({
      memory: this.memory, snapshot: () => this.snapshot(), session: () => this.playSession, context: `${config.minecraft.host}:${config.minecraft.port}/${config.minecraft.username}`,
      observe: async signal => {
        const observedBot = this.bot;
        assertTerrainTrusted(observedBot);
        const seen = await this.execute('inspect', { radius: 32 }, signal);
        if (this.bot !== observedBot) throw new Error('Minecraft connection changed during starter observation');
        assertTerrainTrusted(observedBot);
        const blocks = seen.nearby_blocks ?? [];
        const p = seen.position;
        // A dense ore field can also crowd our placed table out of inspect's
        // generic result cap. Search this critical workstation independently.
        const tableId = this.bot.registry.blocksArray.find(b => b.name === 'crafting_table')?.id;
        const foundTables = tableId == null ? [] : this.bot.findBlocks({ matching: [tableId], maxDistance: 32, count: 16 });
        const tablePositions = [...foundTables, ...blocks.filter(b => b.name === 'crafting_table').map(b => b.position), ...(this.survival.job?.tables ?? [])];
        const tables = [...new Map(tablePositions.map(p => [JSON.stringify(p), p])).values()].filter(p => { const block = this.bot.blockAt(new Vec3(p.x, p.y, p.z)); return block == null || block.name === 'crafting_table'; }).slice(0, 8);
        const tableInReach = tables.some(t => {
          if (!p || this.bot.blockAt(new Vec3(t.x, t.y, t.z))?.name !== 'crafting_table' || Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) > 4) return false;
          const position = new Vec3(t.x, t.y, t.z);
          if (this.bot.world?.raycast) return visibleBlockFace(this.bot.world, this.bot.entity.position.offset(0, this.bot.entity.eyeHeight ?? 1.62, 0), position, 4.5);
          return !this.bot.canSeeBlock || this.bot.canSeeBlock(this.bot.blockAt(position));
        });
        const currentPosition = this.bot.entity.position;
        const underfoot = this.bot.blockAt(new Vec3(Math.floor(currentPosition.x), Math.floor(currentPosition.y)-1, Math.floor(currentPosition.z)));
        const canopyGrounded = this.bot.entity.onGround === true && Math.abs(currentPosition.y-Math.round(currentPosition.y)) <= .03
          && Boolean(underfoot && /_(leaves|log)$/.test(underfoot.name) && underfoot.boundingBox === 'block' && !isFluidBearingBlock(underfoot));
        const powderSnowContact = hasPowderSnowContact(this.bot);
        const lavaContact = hasLavaContact(this.bot);
        // Search logs separately: dense underground ore must not fill inspect's
        // generic resource cap before a nearby tree is considered.
        const pattern = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
        const ids = this.bot.registry.blocksArray.filter(b => pattern.test(b.name)).map(b => b.id);
        const excludedLogs = this.survival.job?.excluded ?? {};
        const logOrigin = this.bot.entity.position.floored();
        // Once carried materials determine the next action, scanning forest
        // sections again adds latency without changing that decision. Keep
        // checking workstation, drop and safety observations below.
        const nextStep = this.survival.job?.home ? nextStarterStep(seen, {...this.survival.job,tables}, {tableInReach,powderSnowContact,lavaContact}) : null;
        const needsWood = !nextStep || Boolean(nextStep.scout);
        const positions = needsWood ? this.bot.findBlocks({ matching: ids, maxDistance: sectionSearchDistance(STARTER_LOG_RADIUS), count: 128, useExtraInfo: block => block.position.distanceTo(logOrigin) <= STARTER_LOG_RADIUS && !(excludedLogs[block.name] ?? []).some(p => p.x === block.position.x && p.y === block.position.y && p.z === block.position.z) }) : [];
        // findBlocks may fill a small cap in one chunk section before examining a
        // closer tree across its boundary. Sort a larger bounded sample, then
        // keep only sixteen logs for the local foliage rays.
        const observedLogs = positions.map(p => this.bot.blockAt(p)).filter(b => b && pattern.test(b.name)).sort((a,b) => a.position.distanceTo(this.bot.entity.position) - b.position.distanceTo(this.bot.entity.position)).slice(0,16);
        const wood = observedLogs[0];
        const foliage = findTreeFoliage(this.bot, observedLogs.filter(block => block.name === wood?.name));
        return { ...(canopyGrounded ? {canopyGrounded:true} : {}), ...(nextStep?.name === 'craft' ? {craftGeometry:craftGeometryKey(this.bot)} : {}), terrainRevision:this.terrainRevision, localTerrain:seen.local_blocks ?? [], resourceEvidence:blocks.map(b=>({name:b.name,position:b.position})), powderSnowContact, lavaContact, wood: wood?.name.replace(/_log$/, ''), foliage, pickupClearance: findPickupClearance(this.bot, this.survival.job?.recoverDropIds) ?? ((this.survival.job?.clearanceDigs ?? 0) < 8 ? findTransitPickupClearance(this.bot, this.survival.job?.recoverDropIds) : null), tables, tableInReach };
      },
      execute: (name, args, signal, context={}) => this.execute(name, args, signal, { jobDeadline:context.jobDeadline,starterScope:`${this.playSession}/${this.survival.job.id}` }),
      recoverFromHostile: (request,signal) => this.recoverFromHostile(request,signal),
      stopActions: reason => this.runner.stop(reason), log: this.log.bind(this)
    });
    this.lastEat = 0;
    this.reflexTimer = setInterval(() => this.reflex(), 1000);
    this.reflexTimer.unref();
  }
  log(type, message, data) {
    const clean = value => {
      let str = typeof value === 'string' ? value : JSON.stringify(value);
      if (this.config.ai.apiKey) str = str.replaceAll(this.config.ai.apiKey, '[redacted]');
      return str.replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted]');
    };
    const event = { at: new Date().toISOString(), type, message: clean(message).slice(0, 2400) };
    if (data !== undefined) event.data = JSON.parse(clean(data));
    this.events.push(event);
    this.events = this.events.slice(-150);
    try { this.memory.journal(event); } catch (e) { console.error('Could not save event log:', e.message); }
    console.log(`[${event.at.slice(11, 19)}] ${type}: ${event.message}`);
  }
  definitions() { return [...(this.actions?.definitions || []), ...(this.progression?.definitions || []), ...this.localDefinitions]; }
  snapshot() {
    const terrainTrust = terrainTrustStatus(this.bot);
    let world = {};
    try { world = this.actions?.snapshot() || {}; } catch { /* connection is transitioning */ }
    let progression = {};
    try { progression = observeProgression(world); } catch { /* no spawned world yet */ }
    const players = this.bot ? Object.values(this.bot.players).filter(p => p.entity && p.username !== this.bot.username).map(p => p.username) : [];
    return { ...world, players, connected: this.connection === 'connected' && terrainTrust.trusted, terrainTrust, connection: terrainTrust.trusted ? this.connection : 'quarantined', owner: this.owner, action: this.runner.state(), memory: this.memory.snapshot(), progression, survival: this.survival?.state() ?? null, recentInjuries: this.injuryObserver?.recent() ?? [] };
  }
  state() { return { ...this.snapshot(), config: publicConfig(this.config), ai: this.brain.state(), events: this.events, tools: this.definitions() }; }
  connect() {
    if (this.closed || this.bot) return;
    clearTimeout(this.reconnectTimer);
    this.injuryObserver?.dispose();
    this.injuryObserver = null;
    this.connection = 'connecting';
    const { owner, ...connection } = this.config.minecraft;
    let bot;
    try {
      bot = mineflayer.createBot({ ...connection, profilesFolder: join(this.config.dataDir, 'auth'), hideErrors: true, respawn: true, checkTimeoutInterval: 30000 });
      this.bot = bot;
      bot.loadPlugin(pinnedSprintCompatibility);
      bot.loadPlugin(pathfinderModule.pathfinder);
      bot.loadPlugin(toolModule.plugin);
    } catch (error) {
      this.bot = null;
      this.connection = 'disconnected';
      this.log('error', `Connection failed: ${error.message}`);
      this.scheduleReconnect();
      return;
    }
    // Invalidate failed-search continuations when geometry or loaded terrain
    // changes, including stone omitted from inspect's generic resource list.
    const terrainChanged=()=>{if(this.bot===bot)this.terrainRevision++;};
    bot.on('blockUpdate',terrainChanged);
    bot.on('chunkColumnLoad',terrainChanged);
    bot.on('chunkColumnUnload',terrainChanged);
    bot.on('terrainUntrusted', error => {
      if (this.bot !== bot) return;
      this.connection = 'quarantined';
      this.brain.stop(error.message);
      this.survival.stop(error.message);
      this.runner.stop(error.message);
      this.actions?.stop();
      this.log('error', 'Mining confirmation failed; disconnecting before terrain can be reused. Resume explicitly after reconnecting.');
    });
    bot.on('respawn', () => {
      if (this.bot !== bot || !terrainTrustStatus(bot).trusted) return;
      // Do not admit new work against half-loaded replacement-world state.
      // The active core action owns cancellation; intentional portal entry
      // must retain its parent signal so it can verify the transition.
      this.connection = 'respawning';
    });
    bot.on('spawn', () => {
      if (!terrainTrustStatus(bot).trusted) { bot.quit('Unverified terrain requires a fresh connection'); return; }
      if (this.bot !== bot) return;
      this.playSession++;
      this.terrainRevision++;
      const movements = new pathfinderModule.Movements(bot);
      movements.canDig = false;
      movements.allow1by1towers = false;
      movements.allowParkour = false;
      movements.allowFreeMotion = false;
      movements.maxDropDown = 3;
      bot.pathfinder.setMovements(movements);
      this.actions = createActions(bot, { memory: this.memory, log: this.log.bind(this), movementBoundary: () => this.survival.active ? { center: this.survival.job.home.position, radius: STARTER_MOVEMENT_RADIUS } : null, starterProtectedPositions: () => this.survival.active ? [...(this.survival.job.observedPositions ?? []).slice(-64),...retainedTravelArrivals(this.survival.job).slice(-64).map(arrival => arrival.position)] : [] });
      this.progression = createProgression(bot, { actions: this.actions, memory: this.memory, log: this.log.bind(this) });
      this.connection = 'connected';
      this.log('connection', `${bot.username} joined Minecraft ${bot.version}.`);
    });
    bot.on('chat', (username, message) => {
      if (!authorizedChat(username, message, this.owner, bot.username)) return;
      this.command(message, username).then(result => {
        if (result?.message) this.say(result.message);
      }).catch(error => this.say(error.message));
    });
    bot.on('breath', () => { if (this.bot === bot) this.survival.checkAir(); });
    this.injuryObserver = observeOwnInjuries(bot, {
      isCurrent: () => this.bot === bot && !this.closed,
      log: this.log.bind(this), action: () => this.runner.active?.name ?? null,
      onHealth: () => this.checkHealth(),
      onHurt: source => this.checkHostileHurt(source)
    });
    bot.on('death', () => {
      this.brain.stop('Died; waiting for respawn. Resume your goal when ready.');
      this.survival.stop('Died; inspect the respawn state before resuming.');
      if (bot.entity?.position) this.memory.setWaypoint('death', bot.entity.position, bot.game.dimension);
      this.connection = 'respawning';
      this.log('death', 'Death location saved. Goals stay paused after respawn.');
    });
    bot.on('kicked', reason => this.log('error', `Kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
    bot.on('error', error => this.log('error', `Minecraft: ${error.message}`));
    bot.on('end', reason => {
      if (this.bot !== bot) return;
      this.brain.stop('Minecraft disconnected');
      this.survival.stop('Minecraft disconnected; resume explicitly after reconnecting.');
      this.runner.retire('Minecraft connection ended');
      this.connection = 'disconnected';
      this.bot = null;
      this.actions = null;
      this.progression = null;
      this.log('connection', `Disconnected: ${reason}. Goals remain paused.`);
      this.scheduleReconnect();
    });
  }
  scheduleReconnect() {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), 5000);
    this.reconnectTimer.unref();
  }
  stop(reason = 'Stopped by player') {
    this.brain.stop(reason);
    this.survival.stop(reason);
    this.actions?.stop();
    this.log('stop', reason);
    return { message: 'Stopped. Any in-flight inventory operation must finish before new work starts.' };
  }
  say(text) {
    const message = String(text).replace(/[\r\n\u0000-\u001f]/g, ' ').trim();
    this.log('chat', message);
    if (this.connection === 'connected' && message && !message.startsWith('/')) this.bot.chat(message.slice(0, 240));
    return { message };
  }
  setOwner(name) {
    if (typeof name !== 'string' || name.length > 32 || /[\r\n\u0000-\u001f]/.test(name)) throw new Error('Enter the exact player name shown on the server (up to 32 characters).');
    this.owner = name.trim();
    this.memory.set('owner', this.owner);
    this.log('config', `In-game controller: ${this.owner || 'disabled'}`);
  }
  async execute(name, args, signal, executionContext = {}) {
    assertTerrainTrusted(this.bot);
    if (this.connection !== 'connected' || !this.actions) throw new Error('BroBot is not connected to Minecraft yet. Start npm run server.');
    signal?.throwIfAborted();
    if (!this.definitions().some(tool => tool.name === name)) throw new Error(`Unknown action: ${name}`);
    if (name === 'say') {
      if (typeof args.message !== 'string' || args.message.length > 1000 || args.message.trim().startsWith('/')) throw new Error('say requires ordinary text, not a server command.');
      return this.say(args.message);
    }
    if (name === 'remember') {
      if (typeof args.text !== 'string' || args.text.length > 500) throw new Error('Notes must be text, up to 500 characters.');
      this.memory.note(args.text); return { saved: true };
    }
    if (name === 'save_waypoint') return this.memory.setWaypoint(args.name, this.bot.entity.position, this.bot.game.dimension);
    if (name === 'go_to_waypoint') {
      const waypoint = this.memory.getWaypoint(args.name);
      if (!waypoint) throw new Error('Unknown waypoint.');
      if (waypoint.dimension !== this.bot.game.dimension) throw new Error(`Waypoint is in ${waypoint.dimension}; enter that dimension first.`);
      return this.execute('go_to', { x: Math.floor(waypoint.position.x), y: Math.floor(waypoint.position.y), z: Math.floor(waypoint.position.z), radius: 2 }, signal);
    }
    const actions = this.actions;
    const progression = this.progression;
    const run = progression.definitions.some(tool => tool.name === name) ? s => progression.execute(name, args, s) : (s,limits) => actions.execute(name, args, s, {...executionContext,actionDeadline:limits?.deadline});
    return this.runner.run(name, run, () => actions.stop(), signal);
  }
  async command(input, speaker = this.owner) {
    const command = parseCommand(input, speaker);
    if (command.kind === 'stop') return this.stop();
    if (command.kind === 'help') return { message: HELP };
    if (command.kind === 'status') return { message: `${this.connection}; ${this.runner.state()?.name || 'idle'}; AI ${this.brain.active ? 'working' : 'idle'}; starter ${this.survival.active ? 'working' : (this.survival.state()?.status ?? 'idle')}`, state: this.snapshot() };
    if (command.kind === 'inventory') return { message: JSON.stringify(this.snapshot().inventory || []), inventory: this.snapshot().inventory };
    if (this.brain.active || this.survival.active) throw new Error('Stop the current AI or starter job before giving a new instruction.');
    if (command.kind === 'survival') {
      if (this.runner.active) throw new Error('Wait for the current action to finish before starting a starter job.');
      return this.survival.start({ resume: command.resume });
    }
    if (command.kind === 'goal') {
      if (this.runner.active) throw new Error('An action is running. Stop it or wait before starting an AI goal.');
      return this.brain.start(command.text, { persistent: command.persistent || false });
    }
    if (command.kind === 'waypoint') return this.execute('save_waypoint', { name: command.name });
    if (command.kind === 'waypoint_go') return this.execute('go_to_waypoint', { name: command.name });
    if (command.kind === 'coordinates') return this.execute('go_to', { x: command.x, y: command.y, z: command.z, radius: 1 });
    if (command.kind === 'action') return this.execute(command.name, command.args);
    if (!command.player) throw new Error('Set your player name in the dashboard, or use follow NAME.');
    if (command.kind === 'follow') return this.execute('follow', { player: command.player, duration: 60, distance: 2 });
    if (command.kind === 'come') {
      const target = this.bot?.players[command.player]?.entity;
      if (!target) throw new Error(`Cannot see ${command.player}. Get closer or use goto coordinates.`);
      return this.execute('go_to', { x: Math.floor(target.position.x), y: Math.floor(target.position.y), z: Math.floor(target.position.z), radius: 2 });
    }
    throw new Error('Unsupported command.');
  }
  checkHostileHurt(source) {
    const bot = this.bot, active = this.runner.active;
    if (this.connection !== 'connected' || !bot || this.closed || !this.survival.active || !active
      || active.controller.signal.aborted || active.name === 'eat' || source?.type !== 'hostile') return;
    // This responds to an explicit observed attacker, without joining separate
    // health packets or guessing a missing source. Recovery may attempt one
    // bounded melee retreat; it does not pause the world or prevent another hit.
    if (Number.isFinite(bot.health) && bot.health <= 0) return;
    if(!this.survival.requestHostileRecovery?.(source))this.stop('Hostile attack observed: starter work paused. The world keeps running; reach safety before resuming.');
  }
  async recoverFromHostile(request,signal) {
    const bot=this.bot,actions=this.actions;
    const guard=()=>{
      if(this.closed||this.bot!==bot||this.actions!==actions)throw Error('Recovery connection changed');
      this.survival.checkRecoveryState(request,request.controller);
      assertTerrainTrusted(bot);
    };
    guard();
    if(typeof actions?.retreatFromHostile!=='function')throw Error('Bounded starter retreat is unavailable');
    const args={sourceId:request.source.id,deadline:request.deadline,home:{...request.job.home.position},dimension:bot.game.dimension};
    return this.runner.run('starter_retreat',s=>actions.retreatFromHostile(args,s,{starterScope:`${request.session}/${request.jobId}`,recoveryGuard:guard}),()=>actions.stop(),signal);
  }
  checkHealth() {
    const bot = this.bot, active = this.runner.active;
    if (this.connection !== 'connected' || !bot || this.closed || !active || active.controller.signal.aborted || active.name === 'eat') return;
    // Match the starter's between-action guard during a long gather or walk.
    // Direct controls retain their existing threshold. Pausing cannot prevent
    // damage already in flight or rescue a bot from its current environment.
    // Mineflayer emits health before death; let the death handler own lethal packets.
    const threshold = this.survival.active ? STARTER_MIN_HEALTH : 6;
    if (Number.isFinite(bot.health) && bot.health > 0 && bot.health <= threshold) this.stop('Low health: work paused. The world keeps running; reach safety before resuming.');
  }
  reflex() {
    const bot = this.bot;
    if (this.connection !== 'connected' || !bot || this.closed || !terrainTrustStatus(bot).trusted) return;
    this.checkHealth();
    if (bot.food >= 18 || this.runner.active || this.survival.active || Date.now() - this.lastEat < 10000) return;
    const foods = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'carrot', 'apple', 'melon_slice', 'sweet_berries'];
    const item = bot.inventory.items().find(item => foods.includes(item.name));
    if (!item) return;
    this.lastEat = Date.now();
    this.execute('eat', { item: item.name }).catch(error => this.log('error', `Auto-eat: ${error.message}`));
  }
  async close() {
    this.closed = true;
    this.injuryObserver?.dispose();
    clearTimeout(this.reconnectTimer);
    clearInterval(this.reflexTimer);
    this.stop('Shutting down');
    this.bot?.quit('BroBot shutting down');
  }
}

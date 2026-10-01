import mineflayer from 'mineflayer';
import pathfinderModule from 'mineflayer-pathfinder';
import toolModule from 'mineflayer-tool';
import { join } from 'node:path';
import { Vec3 } from 'vec3';
import { Memory } from './memory.js';
import { ActionRunner } from './runner.js';
import { createActions } from './actions.js';
import { createProgression, observeProgression } from './progression.js';
import { Brain } from './brain.js';
import { SurvivalJob } from './survival.js';
import { findPickupClearance } from './survival-observation.js';
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
    this.survival = new SurvivalJob({
      memory: this.memory, snapshot: () => this.snapshot(), context: `${config.minecraft.host}:${config.minecraft.port}/${config.minecraft.username}`,
      observe: async signal => {
        const seen = await this.execute('inspect', { radius: 32 }, signal);
        const blocks = seen.nearby_blocks ?? [];
        // Search logs separately: dense underground ore must not fill inspect's
        // generic resource cap before a nearby tree is considered.
        const pattern = /^(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak)_log$/;
        const ids = this.bot.registry.blocksArray.filter(b => pattern.test(b.name)).map(b => b.id);
        const positions = this.bot.findBlocks({ matching: ids, maxDistance: 32, count: 16 });
        const wood = positions.map(p => this.bot.blockAt(p)).find(b => b && pattern.test(b.name));
        const p = seen.position;
        let foliage = null;
        if (wood && this.bot.world?.raycast) {
          const eye = this.bot.entity.position.offset(0, this.bot.entity.eyeHeight ?? 1.62, 0);
          const delta = wood.position.offset(0.5, 0.5, 0.5).minus(eye);
          const hit = delta.norm() > 0 ? this.bot.world.raycast(eye, delta.scaled(1 / delta.norm()), Math.min(4.2, delta.norm())) : null;
          const feet = this.bot.entity.position.floored();
          if (hit && /_leaves$/.test(hit.name) && !(hit.position.x === feet.x && hit.position.z === feet.z && hit.position.y < feet.y)) foliage = { x: hit.position.x, y: hit.position.y, z: hit.position.z, expected_block: hit.name };
        }
        const tablePositions = [...blocks.filter(b => b.name === 'crafting_table').map(b => b.position), ...(this.survival.job?.tables ?? [])];
        const tables = [...new Map(tablePositions.map(p => [JSON.stringify(p), p])).values()].filter(p => this.bot.blockAt(new Vec3(p.x, p.y, p.z))?.name === 'crafting_table').slice(0, 8);
        return { wood: wood?.name.replace(/_log$/, ''), foliage, pickupClearance: findPickupClearance(this.bot, this.survival.job?.recoverDropIds), tables, tableInReach: tables.some(t => p && Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) <= 4) };
      },
      execute: (name, args, signal) => this.execute(name, args, signal), stopActions: reason => this.runner.stop(reason), log: this.log.bind(this)
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
    let world = {};
    try { world = this.actions?.snapshot() || {}; } catch { /* connection is transitioning */ }
    let progression = {};
    try { progression = observeProgression(world); } catch { /* no spawned world yet */ }
    const players = this.bot ? Object.values(this.bot.players).filter(p => p.entity && p.username !== this.bot.username).map(p => p.username) : [];
    return { ...world, players, connected: this.connection === 'connected', connection: this.connection, owner: this.owner, action: this.runner.state(), memory: this.memory.snapshot(), progression, survival: this.survival?.state() ?? null };
  }
  state() { return { ...this.snapshot(), config: publicConfig(this.config), ai: this.brain.state(), events: this.events, tools: this.definitions() }; }
  connect() {
    if (this.closed || this.bot) return;
    clearTimeout(this.reconnectTimer);
    this.connection = 'connecting';
    const { owner, ...connection } = this.config.minecraft;
    let bot;
    try {
      bot = mineflayer.createBot({ ...connection, profilesFolder: join(this.config.dataDir, 'auth'), hideErrors: true, respawn: true, checkTimeoutInterval: 30000 });
      this.bot = bot;
      bot.loadPlugin(pathfinderModule.pathfinder);
      bot.loadPlugin(toolModule.plugin);
    } catch (error) {
      this.bot = null;
      this.connection = 'disconnected';
      this.log('error', `Connection failed: ${error.message}`);
      this.scheduleReconnect();
      return;
    }
    bot.on('spawn', () => {
      if (this.bot !== bot) return;
      const movements = new pathfinderModule.Movements(bot);
      movements.canDig = false;
      movements.allow1by1towers = false;
      movements.allowParkour = false;
      movements.allowFreeMotion = false;
      movements.maxDropDown = 3;
      bot.pathfinder.setMovements(movements);
      this.actions = createActions(bot, { memory: this.memory, log: this.log.bind(this), movementBoundary: () => this.survival.active ? { center: this.survival.job.home.position, radius: 90 } : null });
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
  async execute(name, args, signal) {
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
    const run = progression.definitions.some(tool => tool.name === name) ? s => progression.execute(name, args, s) : s => actions.execute(name, args, s);
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
  reflex() {
    const bot = this.bot;
    if (this.connection !== 'connected' || !bot || this.closed) return;
    if (bot.health <= 6 && this.runner.active && !this.runner.active.controller.signal.aborted && this.runner.active.name !== 'eat') this.stop('Low health: paused work to recover.');
    if (bot.food >= 18 || this.runner.active || this.survival.active || Date.now() - this.lastEat < 10000) return;
    const foods = ['cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_chicken', 'cooked_salmon', 'cooked_cod', 'bread', 'baked_potato', 'carrot', 'apple', 'melon_slice', 'sweet_berries'];
    const item = bot.inventory.items().find(item => foods.includes(item.name));
    if (!item) return;
    this.lastEat = Date.now();
    this.execute('eat', { item: item.name }).catch(error => this.log('error', `Auto-eat: ${error.message}`));
  }
  async close() {
    this.closed = true;
    clearTimeout(this.reconnectTimer);
    clearInterval(this.reflexTimer);
    this.stop('Shutting down');
    this.bot?.quit('BroBot shutting down');
  }
}

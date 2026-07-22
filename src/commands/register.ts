import { Vec3 } from 'vec3'
import type { AppConfig, PositionData } from '../types.js'
import type { BotRuntime } from '../bot-runtime.js'
import type { StateStore } from '../storage.js'
import type { TaskManager } from '../task-manager.js'
import type { Logger } from '../logger.js'
import { CombatService } from '../services/combat.js'
import { NavigationService } from '../services/navigation.js'
import { ResourcesService } from '../services/resources.js'
import { InventoryService } from '../services/inventory.js'
import { FARM_CROPS, FarmingService, type FarmCropFilter } from '../services/farming.js'
import { BuildingService, type BuildAxis } from '../services/building.js'
import { ALWAYS_CONSUMABLE_FOOD_SET, UNSAFE_FOOD_SET } from '../food-safety.js'
import { availableBedIds, resolveChopBlockNames } from '../version-compat.js'
import {
  CommandSyntaxError,
  assertOnlyFlags,
  boundedInteger,
  boundedNumber,
  flagBoolean,
  flagInteger,
  resourceName,
  type ParsedCommand
} from './parser.js'
import { CommandRouter, type CommandContext } from './router.js'

function argumentsBetween(command: ParsedCommand, minimum: number, maximum: number, usage: string): void {
  if (command.args.length < minimum || command.args.length > maximum) {
    throw new CommandSyntaxError(`Usage: ${usage}`)
  }
}

function noArguments(command: ParsedCommand, usage: string): void {
  argumentsBetween(command, 0, 0, usage)
}

function formatPosition(position: PositionData, precision = 1): string {
  return `${position.x.toFixed(precision)}, ${position.y.toFixed(precision)}, ${position.z.toFixed(precision)}`
}

function parseCoordinate(value: string | undefined, base: number, label: string): number {
  if (value?.startsWith('~')) {
    const offset = value.slice(1)
    const resolved = base + (offset ? boundedNumber(offset, label, -30_000_000, 30_000_000) : 0)
    return boundedNumber(String(resolved), label, -30_000_000, 30_000_000)
  }
  return boundedNumber(value, label, -30_000_000, 30_000_000)
}

function coordinates(context: CommandContext, values: string[]): PositionData {
  const current = context.runtime.position()
  if (!current) throw new Error('Bot has no position')
  return {
    x: parseCoordinate(values[0], current.x, 'x'),
    y: parseCoordinate(values[1], current.y, 'y'),
    z: parseCoordinate(values[2], current.z, 'z'),
    dimension: current.dimension
  }
}

function startTask(
  context: CommandContext,
  label: string,
  worker: Parameters<TaskManager['start']>[1],
  command?: ParsedCommand
): string {
  const replace = command ? flagBoolean(command, 'replace', false) : false
  const handle = context.tasks.start(label, worker, { replace })
  return `Started task #${handle.id}: ${label}. Use stop to cancel.`
}

function logTaskIssues(
  context: CommandContext,
  label: string,
  issues: ReadonlyArray<{ position: { x: number, y: number, z: number }, reason: string, message?: string }>
): void {
  for (const issue of issues.slice(0, 20)) {
    context.logger.warn(`${label} issue at ${issue.position.x},${issue.position.y},${issue.position.z}: ${issue.message ?? issue.reason}`)
  }
  if (issues.length > 20) context.logger.warn(`${label}: ${issues.length - 20} additional issue(s) omitted from the log`)
}

function formatStatus(context: CommandContext): string[] {
  const status = context.runtime.status()
  const task = context.tasks.snapshot()
  const lines = [
    `${status.username}: ${status.spawned ? 'online' : status.connected ? 'connecting' : 'offline'} at ${status.server}${status.version ? ` (${status.version})` : ''}`
  ]
  if (status.position) {
    lines.push(`Position ${formatPosition(status.position)} in ${status.dimension}; health ${status.health?.toFixed(1)}/20, food ${status.food}/20, XP ${status.experience}`)
  }
  lines.push(`${status.players.length} other online player(s), ${status.inventory.reduce((sum, item) => sum + item.count, 0)} carried item(s)`)
  lines.push(task ? `Task #${task.id}: ${task.label} (${Math.round(task.elapsedMs / 1000)}s)` : 'Task: idle')
  return lines
}

export function createCommandRouter(
  config: AppConfig,
  runtime: BotRuntime,
  tasks: TaskManager,
  store: StateStore,
  logger: Logger
): CommandRouter {
  const router = new CommandRouter(config, runtime, tasks, store, logger)
  const navigation = new NavigationService(runtime)
  const combat = new CombatService(runtime)
  const resources = new ResourcesService(runtime)
  const inventory = new InventoryService(runtime)
  const farming = new FarmingService(runtime)
  const building = new BuildingService(runtime)
  const defaultSearchRadius = (desired: number): number => Math.min(desired, config.safety.maxSearchDistance)

  router.register({
    name: 'help', aliases: ['commands'], category: 'core', summary: 'List commands or explain one command.',
    usage: 'help [command]',
    execute(context, command) {
      assertOnlyFlags(command, [])
      argumentsBetween(command, 0, 1, 'help [command]')
      const selected = command.args[0] ? context.router.find(command.args[0]) : undefined
      if (command.args[0] && !selected) throw new CommandSyntaxError(`Unknown command: ${command.args[0]}`)
      if (selected) {
        return [
          `${selected.name}: ${selected.summary}`,
          `Usage: ${selected.usage}${selected.aliases?.length ? ` | aliases: ${selected.aliases.join(', ')}` : ''}`,
          `${selected.requiresSpawn ? 'Requires the bot to be spawned. ' : ''}${selected.localOnly ? 'Local controls only.' : ''}`.trim()
        ].filter(Boolean)
      }
      const categories = new Map<string, string[]>()
      for (const definition of context.router.commands()) {
        const values = categories.get(definition.category) ?? []
        values.push(definition.name)
        categories.set(definition.category, values)
      }
      return [
        ...[...categories].map(([category, names]) => `${category}: ${names.join(', ')}`),
        'Use help <command> for exact syntax. Add --replace to an action to stop and replace current work.'
      ]
    }
  })

  router.register({
    name: 'capabilities', aliases: ['features'], category: 'core', summary: 'Describe the bot feature groups.',
    usage: 'capabilities',
    execute(_context, command) {
      noArguments(command, 'capabilities'); assertOnlyFlags(command, [])
      return [
        'Navigation: coordinates, following, waypoints, routes, patrols, wandering, fleeing.',
        'Work: mining, vein collection, dropped items, crafting, smelting, farming, fishing, and building.',
        'Survival: auto-eat, scored armor, sleep, mob defense, low-health aborts, and reconnect.',
        'Control: terminal, allowlisted in-game chat, local dashboard/API, cancellation, persistence, and logs.'
      ]
    }
  })

  router.register({
    name: 'status', aliases: ['stats'], category: 'core', summary: 'Show connection, vitals, position, and active task.',
    usage: 'status',
    execute(context, command) {
      noArguments(command, 'status'); assertOnlyFlags(command, [])
      return formatStatus(context)
    }
  })

  router.register({
    name: 'stop', aliases: ['cancel'], category: 'core', summary: 'Cancel the current physical task and clear controls.',
    usage: 'stop',
    async execute(context, command) {
      noArguments(command, 'stop'); assertOnlyFlags(command, [])
      const cancelled = context.tasks.cancel(`Stopped by ${context.actor}`)
      if (!cancelled) await context.runtime.stopPhysicalActions()
      return cancelled ? 'Stopping the active task.' : 'Bot was already idle; physical controls were cleared.'
    }
  })

  router.register({
    name: 'say', category: 'communication', summary: 'Send a Minecraft chat message.', usage: 'say <message>', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, [])
      argumentsBetween(command, 1, 100, 'say <message>')
      const message = command.args.join(' ').replace(/[\r\n]/gu, ' ').slice(0, 230)
      if (message.startsWith('/')) throw new CommandSyntaxError('say cannot execute Minecraft server commands')
      context.runtime.requireBot().chat(message)
      return `Sent: ${message}`
    }
  })

  router.register({
    name: 'autoeat', category: 'survival', summary: 'Enable, disable, inspect, or trigger automatic eating.',
    usage: 'autoeat <on|off|status|now> [food]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace'])
      argumentsBetween(command, 1, 2, 'autoeat <on|off|status|now> [food]')
      const bot = context.runtime.requireBot()
      const action = command.args[0]?.toLowerCase()
      if (action === 'on' || action === 'off' || action === 'status') {
        argumentsBetween(command, 1, 1, `autoeat ${action}`)
        assertOnlyFlags(command, [])
        if (action === 'on') { context.runtime.setAutoEatEnabled(true); return 'Auto-eat enabled.' }
        if (action === 'off') { context.runtime.setAutoEatEnabled(false); return 'Auto-eat disabled.' }
        return `Auto-eat preference is ${context.runtime.autoEatEnabled ? 'enabled' : 'disabled'}${bot.autoEat.isEating ? ' and eating now' : ''}; hunger ${bot.food}/20.`
      }
      if (action === 'now') {
        assertOnlyFlags(command, ['replace'])
        const food = command.args[1] ? resourceName(command.args[1]) : undefined
        if (food && !bot.registry.foodsByName[food]) throw new CommandSyntaxError(`${food} is not an edible item in Minecraft ${bot.version}`)
        if (food && UNSAFE_FOOD_SET.has(food)) throw new CommandSyntaxError(`${food} is excluded from eating for safety`)
        const foodItem = food ? bot.inventory.items().find((item) => item.name === food) : undefined
        if (food && !foodItem) throw new CommandSyntaxError(`${food} is not in the bot's inventory`)
        if (bot.food >= 20 && (!food || !ALWAYS_CONSUMABLE_FOOD_SET.has(food))) {
          throw new CommandSyntaxError('Hunger is full; only an explicit golden_apple or enchanted_golden_apple can be consumed now')
        }
        return startTask(context, `eat ${food ?? 'best food'}`, async (task) => {
          const releaseAutoEat = await context.runtime.pauseAutoEat(bot, task.signal)
          try {
            task.checkpoint()
            await bot.autoEat.eat(foodItem ? { food: foodItem } : undefined)
            task.checkpoint()
          } finally {
            releaseAutoEat()
          }
        }, command)
      }
      throw new CommandSyntaxError('Usage: autoeat <on|off|status|now> [food]')
    }
  })

  router.register({
    name: 'armor', category: 'survival', summary: 'Equip the strongest available non-binding armor.',
    usage: 'armor [--replace]', requiresSpawn: true,
    execute(context, command) {
      noArguments(command, 'armor'); assertOnlyFlags(command, ['replace'])
      return startTask(context, 'equip best armor', async (task) => {
        const bot = context.runtime.requireBot()
        const releaseAutoEat = await context.runtime.pauseAutoEat(bot, task.signal)
        try {
          task.checkpoint()
          const equipped = await context.runtime.equipBestArmor(bot)
          context.logger.info(`Armor equipped: ${equipped.map((item) => `${item.name} (${item.destination})`).join(', ') || 'no upgrades found'}`)
          task.checkpoint()
        } finally {
          releaseAutoEat()
        }
      }, command)
    }
  })

  router.register({
    name: 'sleep', category: 'survival', summary: 'Find and sleep in a nearby bed.',
    usage: 'sleep [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      noArguments(command, 'sleep'); assertOnlyFlags(command, ['radius', 'replace'])
      const radius = flagInteger(command, 'radius', defaultSearchRadius(24), 2, config.safety.maxSearchDistance)
      return startTask(context, 'sleep in nearest bed', async (task) => {
        const bot = context.runtime.requireBot()
        const bedIds = availableBedIds(bot.registry.blocksByName)
        const bed = bot.findBlock({ matching: bedIds, maxDistance: radius })
        if (!bed) throw new Error(`No bed found within ${radius} blocks`)
        await navigation.goTo(task, { x: bed.position.x, y: bed.position.y, z: bed.position.z, dimension: bot.game.dimension }, 2)
        const releaseAutoEat = await context.runtime.pauseAutoEat(bot, task.signal)
        try {
          task.checkpoint(); await bot.sleep(bed); task.checkpoint()
        } finally {
          releaseAutoEat()
        }
      }, command)
    }
  })

  router.register({
    name: 'wake', category: 'survival', summary: 'Leave the current bed.', usage: 'wake', requiresSpawn: true,
    async execute(context, command) {
      noArguments(command, 'wake'); assertOnlyFlags(command, [])
      const bot = context.runtime.requireBot()
      if (!bot.isSleeping) return 'Bot is not sleeping.'
      await bot.wake()
      return 'Bot woke up.'
    }
  })

  router.register({
    name: 'environment', aliases: ['world'], category: 'sensing', summary: 'Show dimension, time, weather, and difficulty.',
    usage: 'environment', requiresSpawn: true,
    execute(context, command) {
      noArguments(command, 'environment'); assertOnlyFlags(command, [])
      const bot = context.runtime.requireBot()
      return `${bot.game.dimension}; day ${bot.time.day}, ${bot.time.isDay ? 'daytime' : 'night'}, tick ${bot.time.timeOfDay}; ${bot.isRaining ? 'raining' : 'clear'}, ${bot.game.difficulty} difficulty.`
    }
  })

  router.register({
    name: 'recover', category: 'navigation', summary: 'Return to the last persisted death position.',
    usage: 'recover [--range N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      noArguments(command, 'recover'); assertOnlyFlags(command, ['range', 'replace'])
      const target = context.store.snapshot().lastDeath
      if (!target) throw new Error('No death position has been recorded yet')
      const range = flagInteger(command, 'range', 2, 1, 16)
      return startTask(context, `recover at ${formatPosition(target)}`, (task) => navigation.goTo(task, target, range), command)
    }
  })

  router.register({
    name: 'reconnect', category: 'core', summary: 'Disconnect and reconnect now.', usage: 'reconnect', localOnly: true,
    async execute(context, command) {
      noArguments(command, 'reconnect'); assertOnlyFlags(command, [])
      context.tasks.cancel('Reconnect requested')
      await context.runtime.reconnect()
      return 'Reconnect started.'
    }
  })

  router.register({
    name: 'goto', aliases: ['go'], category: 'navigation', summary: 'Walk to absolute or ~relative coordinates.',
    usage: 'goto <x|~offset> <y|~offset> <z|~offset> [--range N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['range', 'replace'])
      argumentsBetween(command, 3, 3, 'goto <x> <y> <z> [--range N]')
      const target = coordinates(context, command.args)
      const range = flagInteger(command, 'range', 1, 1, 16)
      return startTask(context, `go to ${formatPosition(target)}`, (task) => navigation.goTo(task, target, range), command)
    }
  })

  router.register({
    name: 'come', category: 'navigation', summary: 'Walk to a visible player.',
    usage: 'come [player] [--range N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['range', 'replace'])
      argumentsBetween(command, 0, 1, 'come [player]')
      const username = command.args[0] ?? (context.source === 'chat' ? context.actor : undefined)
      if (!username) throw new CommandSyntaxError('A player name is required from local controls')
      const entity = navigation.playerEntity(username)
      const range = flagInteger(command, 'range', config.behavior.followDistance, 1, 16)
      const target: PositionData = { x: entity.position.x, y: entity.position.y, z: entity.position.z, dimension: runtime.requireBot().game.dimension }
      return startTask(context, `come to ${username}`, (task) => navigation.goTo(task, target, range), command)
    }
  })

  router.register({
    name: 'follow', category: 'navigation', summary: 'Continuously follow a visible player.',
    usage: 'follow <player> [--distance N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['distance', 'replace'])
      argumentsBetween(command, 1, 1, 'follow <player> [--distance N]')
      const username = command.args[0] as string
      const distance = flagInteger(command, 'distance', config.behavior.followDistance, 1, 16)
      navigation.playerEntity(username)
      return startTask(context, `follow ${username}`, (task) => navigation.follow(task, username, distance), command)
    }
  })

  router.register({
    name: 'waypoint', aliases: ['wp'], category: 'navigation', summary: 'Set, visit, list, or remove persistent waypoints.',
    usage: 'waypoint <set|go|list|remove> [name] [x y z]', requiresSpawn: true,
    async execute(context, command) {
      assertOnlyFlags(command, ['range', 'replace'])
      const action = command.args[0]?.toLowerCase()
      if (action === 'list') {
        assertOnlyFlags(command, [])
        argumentsBetween(command, 1, 1, 'waypoint list')
        const entries = Object.entries(context.store.snapshot().waypoints)
        return entries.length ? entries.map(([name, point]) => `${name}: ${formatPosition(point)} (${point.dimension ?? 'unknown'})`) : 'No waypoints saved.'
      }
      const name = command.args[1]?.toLowerCase()
      if (!name || !/^[a-z0-9_-]{1,32}$/u.test(name)) throw new CommandSyntaxError('Waypoint name must use 1-32 letters, digits, _ or -')
      if (action === 'set') {
        assertOnlyFlags(command, [])
        if (![2, 5].includes(command.args.length)) throw new CommandSyntaxError('Usage: waypoint set <name> [x y z]')
        const point = command.args.length === 5 ? coordinates(context, command.args.slice(2)) : context.runtime.position()
        if (!point) throw new Error('Bot has no position')
        await context.store.setWaypoint(name, point)
        return `Saved ${name} at ${formatPosition(point)}.`
      }
      if (action === 'remove') {
        assertOnlyFlags(command, [])
        argumentsBetween(command, 2, 2, 'waypoint remove <name>')
        return await context.store.deleteWaypoint(name) ? `Removed waypoint ${name}.` : `Waypoint ${name} does not exist.`
      }
      if (action === 'go') {
        assertOnlyFlags(command, ['range', 'replace'])
        argumentsBetween(command, 2, 2, 'waypoint go <name> [--range N]')
        const target = context.store.getWaypoint(name)
        if (!target) throw new Error(`Waypoint ${name} does not exist`)
        const range = flagInteger(command, 'range', 1, 1, 16)
        return startTask(context, `go to waypoint ${name}`, (task) => navigation.goTo(task, target, range), command)
      }
      throw new CommandSyntaxError('Usage: waypoint <set|go|list|remove> [name] [x y z]')
    }
  })

  router.register({
    name: 'home', category: 'navigation', summary: 'Save or visit the special home waypoint.',
    usage: 'home <set|go> [--replace]', requiresSpawn: true,
    async execute(context, command) {
      assertOnlyFlags(command, ['replace'])
      argumentsBetween(command, 1, 1, 'home <set|go>')
      if (command.args[0] === 'set') {
        assertOnlyFlags(command, [])
        const point = context.runtime.position()
        if (!point) throw new Error('Bot has no position')
        await context.store.setWaypoint('home', point)
        return `Home saved at ${formatPosition(point)}.`
      }
      if (command.args[0] === 'go') {
        assertOnlyFlags(command, ['replace'])
        const target = context.store.getWaypoint('home')
        if (!target) throw new Error('Home is not set. Use home set.')
        return startTask(context, 'go home', (task) => navigation.goTo(task, target, 1), command)
      }
      throw new CommandSyntaxError('Usage: home <set|go>')
    }
  })

  router.register({
    name: 'route', category: 'navigation', summary: 'Save, list, and run named patrol routes made from waypoints.',
    usage: 'route <save|list|run|remove> [name] [waypoint ...] [--loops N]', requiresSpawn: true,
    async execute(context, command) {
      assertOnlyFlags(command, ['loops', 'replace'])
      const action = command.args[0]?.toLowerCase()
      if (action === 'list') {
        assertOnlyFlags(command, [])
        argumentsBetween(command, 1, 1, 'route list')
        const routes = context.store.snapshot().patrolRoutes
        return Object.keys(routes).length ? Object.entries(routes).map(([name, points]) => `${name}: ${points.length} point(s)`) : 'No routes saved.'
      }
      const name = command.args[1]?.toLowerCase()
      if (!name || !/^[a-z0-9_-]{1,32}$/u.test(name)) throw new CommandSyntaxError('Route name must use 1-32 letters, digits, _ or -')
      if (action === 'save') {
        assertOnlyFlags(command, [])
        argumentsBetween(command, 4, 34, 'route save <name> <waypoint> <waypoint> [...]')
        const points = command.args.slice(2).map((waypoint) => {
          const point = context.store.getWaypoint(waypoint)
          if (!point) throw new CommandSyntaxError(`Waypoint ${waypoint} does not exist`)
          return point
        })
        await context.store.setPatrolRoute(name, points)
        return `Saved route ${name} with ${points.length} points.`
      }
      if (action === 'remove') {
        assertOnlyFlags(command, [])
        argumentsBetween(command, 2, 2, 'route remove <name>')
        return await context.store.deletePatrolRoute(name) ? `Removed route ${name}.` : `Route ${name} does not exist.`
      }
      if (action === 'run') {
        assertOnlyFlags(command, ['loops', 'replace'])
        argumentsBetween(command, 2, 2, 'route run <name> [--loops N]')
        const points = context.store.snapshot().patrolRoutes[name]
        if (!points?.length) throw new Error(`Route ${name} does not exist or is empty`)
        const loops = flagInteger(command, 'loops', 1, 1, 100)
        return startTask(context, `patrol route ${name} ×${loops}`, (task) => navigation.patrol(task, points, loops, config.behavior.patrolPauseMs), command)
      }
      throw new CommandSyntaxError('Usage: route <save|list|run|remove> [name] [waypoint ...]')
    }
  })

  router.register({
    name: 'patrol', category: 'navigation', summary: 'Patrol two or more saved waypoints without saving a route.',
    usage: 'patrol <waypoint> <waypoint> [...] [--loops N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['loops', 'replace'])
      argumentsBetween(command, 2, 32, 'patrol <waypoint> <waypoint> [...]')
      const points = command.args.map((name) => {
        const point = context.store.getWaypoint(name)
        if (!point) throw new CommandSyntaxError(`Waypoint ${name} does not exist`)
        return point
      })
      const loops = flagInteger(command, 'loops', 1, 1, 100)
      return startTask(context, `patrol ${command.args.join(' → ')} ×${loops}`, (task) => navigation.patrol(task, points, loops, config.behavior.patrolPauseMs), command)
    }
  })

  router.register({
    name: 'wander', category: 'navigation', summary: 'Visit bounded random points around the current position.',
    usage: 'wander [--radius N] [--hops N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      noArguments(command, 'wander [--radius N] [--hops N]')
      assertOnlyFlags(command, ['radius', 'hops', 'replace'])
      const center = context.runtime.position()
      if (!center) throw new Error('Bot has no position')
      const radius = flagInteger(command, 'radius', defaultSearchRadius(16), 3, config.safety.maxSearchDistance)
      const hops = flagInteger(command, 'hops', 5, 1, 100)
      return startTask(context, `wander ${hops} hops within ${radius}`, (task) => navigation.wander(task, center, radius, hops), command)
    }
  })

  router.register({
    name: 'locate', aliases: ['find'], category: 'sensing', summary: 'Locate the nearest loaded block of a type.',
    usage: 'locate <block> [--radius N]', requiresSpawn: true,
    execute(_context, command) {
      assertOnlyFlags(command, ['radius'])
      argumentsBetween(command, 1, 1, 'locate <block> [--radius N]')
      const name = resourceName(command.args[0] as string)
      const radius = flagInteger(command, 'radius', config.safety.maxSearchDistance, 1, config.safety.maxSearchDistance)
      const result = navigation.locateBlock(name, radius)
      return `${name} at ${formatPosition(result.position, 0)}, ${result.distance.toFixed(1)} blocks away.`
    }
  })

  router.register({
    name: 'look', category: 'navigation', summary: 'Look at a player or coordinates.',
    usage: 'look <player> | look <x> <y> <z>', requiresSpawn: true,
    async execute(context, command) {
      assertOnlyFlags(command, [])
      argumentsBetween(command, 1, 3, 'look <player> | look <x> <y> <z>')
      const bot = context.runtime.requireBot()
      let target: Vec3
      if (command.args.length === 1) target = navigation.playerEntity(command.args[0] as string).position.offset(0, 1.6, 0)
      else {
        const point = coordinates(context, command.args)
        target = new Vec3(point.x, point.y, point.z)
      }
      await bot.lookAt(target, true)
      return 'Looking at target.'
    }
  })

  router.register({
    name: 'nearby', category: 'sensing', summary: 'List nearby players, mobs, hostiles, items, or all entities.',
    usage: 'nearby <players|mobs|hostiles|items|all> [--radius N]', requiresSpawn: true,
    execute(_context, command) {
      assertOnlyFlags(command, ['radius'])
      argumentsBetween(command, 1, 1, 'nearby <players|mobs|hostiles|items|all> [--radius N]')
      const kind = command.args[0] as 'players' | 'mobs' | 'hostiles' | 'items' | 'all'
      if (!['players', 'mobs', 'hostiles', 'items', 'all'].includes(kind)) throw new CommandSyntaxError(`Unknown nearby category: ${kind}`)
      const radius = flagInteger(command, 'radius', defaultSearchRadius(24), 1, config.safety.maxSearchDistance)
      const found = combat.nearby(kind, radius).slice(0, 20)
      return found.length
        ? found.map((entity) => `#${entity.id} ${entity.name} (${entity.type}) ${entity.distance.toFixed(1)}m at ${formatPosition(entity.position, 0)}`)
        : `No ${kind} within ${radius} blocks.`
    }
  })

  router.register({
    name: 'attack', category: 'combat', summary: 'Attack the nearest matching non-player mob.',
    usage: 'attack <mob|entity-id> [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 1, 1, 'attack <mob|entity-id> [--radius N]')
      const radius = flagInteger(command, 'radius', defaultSearchRadius(24), 1, config.safety.maxSearchDistance)
      const target = combat.findTarget(command.args[0] as string, radius, false)
      const anchor = context.runtime.position()
      if (!anchor) throw new Error('Bot has no position')
      return startTask(context, `attack ${command.args[0]}`, (task) => combat.attack(task, target, { leashCenter: anchor, leashRadius: radius }), command)
    }
  })

  router.register({
    name: 'pvp', category: 'combat', summary: 'Attack a visible player when PvP is explicitly enabled.',
    usage: 'pvp <player> [--radius N] [--replace]', requiresSpawn: true, localOnly: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 1, 1, 'pvp <player> [--radius N]')
      if (!config.safety.allowPvp) throw new Error('PvP is disabled. Set safety.allowPvp=true intentionally.')
      const pvpMaximum = Math.min(48, config.safety.maxSearchDistance)
      const radius = flagInteger(command, 'radius', defaultSearchRadius(24), 1, pvpMaximum)
      const target = combat.findTarget(command.args[0] as string, radius, true)
      if (target.type !== 'player') throw new Error('pvp requires an exact visible player name')
      const anchor = context.runtime.position()
      if (!anchor) throw new Error('Bot has no position')
      return startTask(context, `PvP ${command.args[0]}`, (task) => combat.attack(task, target, { leashCenter: anchor, leashRadius: radius }), command)
    }
  })

  router.register({
    name: 'hunt', category: 'combat', summary: 'Hunt a bounded number of matching mobs.',
    usage: 'hunt <mob> [count] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 1, 2, 'hunt <mob> [count] [--radius N]')
      const mob = resourceName(command.args[0] as string)
      const count = boundedInteger(command.args[1] ?? '1', 'count', 1, 32)
      const radius = flagInteger(command, 'radius', defaultSearchRadius(24), 2, config.safety.maxSearchDistance)
      return startTask(context, `hunt ${count} ${mob}`, async (task) => { await combat.hunt(task, mob, count, radius) }, command)
    }
  })

  router.register({
    name: 'guard', category: 'combat', summary: 'Defend a bounded area from an explicit hostile-mob list.',
    usage: 'guard [here|player] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 0, 1, 'guard [here|player] [--radius N]')
      const target = command.args[0]
      let anchor: PositionData | undefined
      if (!target || target === 'here') anchor = context.runtime.position()
      else {
        const entity = navigation.playerEntity(target)
        anchor = { x: entity.position.x, y: entity.position.y, z: entity.position.z, dimension: runtime.requireBot().game.dimension }
      }
      if (!anchor) throw new Error('Bot has no position')
      const guardMaximum = Math.min(64, config.safety.maxSearchDistance)
      const radius = flagInteger(command, 'radius', Math.min(config.behavior.guardRadius, guardMaximum), 2, guardMaximum)
      return startTask(context, `guard ${target ?? 'here'} within ${radius}`, (task) => combat.guard(task, anchor, radius), command)
    }
  })

  router.register({
    name: 'flee', category: 'combat', summary: 'Path away from the nearest matching entity.',
    usage: 'flee [entity-name] [--distance N] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['distance', 'radius', 'replace'])
      argumentsBetween(command, 0, 1, 'flee [entity-name] [--distance N]')
      const radius = flagInteger(command, 'radius', defaultSearchRadius(24), 2, config.safety.maxSearchDistance)
      const distance = flagInteger(command, 'distance', 16, 3, 64)
      const target = command.args[0]
        ? combat.findTarget(command.args[0], radius, true)
        : Object.values(context.runtime.requireBot().entities)
          .filter((entity) => entity !== context.runtime.requireBot().entity && entity.isValid)
          .filter((entity) => context.runtime.requireBot().entity.position.distanceTo(entity.position) <= radius)
          .sort((a, b) => context.runtime.requireBot().entity.position.distanceTo(a.position) - context.runtime.requireBot().entity.position.distanceTo(b.position))[0]
      if (!target) throw new Error(`No entity found within ${radius} blocks`)
      return startTask(context, `flee from ${target.username ?? target.name ?? target.id}`, (task) => navigation.flee(task, target.position, distance), command)
    }
  })

  router.register({
    name: 'inventory', aliases: ['inv'], category: 'inventory', summary: 'List grouped inventory contents.',
    usage: 'inventory [filter]', requiresSpawn: true,
    execute(_context, command) {
      assertOnlyFlags(command, [])
      argumentsBetween(command, 0, 1, 'inventory [filter]')
      const filter = command.args[0]?.toLowerCase()
      const summary = inventory.summary()
      const items = filter ? summary.items.filter((item) => item.name.includes(filter)) : summary.items
      return items.length
        ? [`Inventory: ${summary.totalItems} items, ${summary.emptySlots} empty slots.`, ...items.map((item) => `${item.count}× ${item.name}`)]
        : filter ? `No inventory items match ${filter}.` : 'Inventory is empty.'
    }
  })

  router.register({
    name: 'count', category: 'inventory', summary: 'Count one item in inventory.',
    usage: 'count <item>', requiresSpawn: true,
    execute(_context, command) {
      assertOnlyFlags(command, []); argumentsBetween(command, 1, 1, 'count <item>')
      const item = resourceName(command.args[0] as string)
      return `${item}: ${inventory.count(item)}`
    }
  })

  router.register({
    name: 'hold', category: 'inventory', summary: 'Equip an inventory item in the main hand.',
    usage: 'hold <item> [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 1, 1, 'hold <item>')
      const item = resourceName(command.args[0] as string)
      return startTask(context, `hold ${item}`, async (task) => {
        const result = await inventory.hold(task, item)
        context.logger.info(`Holding ${result.itemName}`)
      }, command)
    }
  })

  router.register({
    name: 'equip', category: 'inventory', summary: 'Equip an item, with slot inferred when omitted.',
    usage: 'equip <item> [hand|off-hand|head|torso|legs|feet] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 1, 2, 'equip <item> [destination]')
      const item = resourceName(command.args[0] as string)
      const destination = command.args[1]
      const valid = ['hand', 'off-hand', 'head', 'torso', 'legs', 'feet'] as const
      if (destination && !(valid as readonly string[]).includes(destination)) throw new CommandSyntaxError(`Invalid destination: ${destination}`)
      return startTask(context, `equip ${item}${destination ? ` to ${destination}` : ''}`, async (task) => {
        const result = await inventory.equip(task, item, destination as typeof valid[number] | undefined)
        context.logger.info(`Equipped ${result.itemName} to ${result.destination}`)
      }, command)
    }
  })

  router.register({
    name: 'eat', category: 'inventory', summary: 'Safely eat a named food or the best available food.',
    usage: 'eat [food] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 0, 1, 'eat [food]')
      const item = command.args[0] ? resourceName(command.args[0]) : undefined
      return startTask(context, `eat ${item ?? 'best food'}`, async (task) => {
        const result = await inventory.eat(task, item)
        context.logger.info(`Ate ${result.itemName}; hunger ${result.foodBefore} → ${result.foodAfter}`)
      }, command)
    }
  })

  router.register({
    name: 'drop', category: 'inventory', summary: 'Drop a bounded item count.',
    usage: 'drop <item> [count] [--replace]', requiresSpawn: true, localOnly: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 1, 2, 'drop <item> [count]')
      const item = resourceName(command.args[0] as string)
      const count = boundedInteger(command.args[1] ?? '1', 'count', 1, config.safety.maxGatherCount)
      return startTask(context, `drop ${count} ${item}`, async (task) => {
        const result = await inventory.drop(task, item, count)
        context.logger.info(`Dropped ${result.dropped} ${result.itemName}`)
      }, command)
    }
  })

  router.register({
    name: 'give', category: 'inventory', summary: 'Walk to a visible player and toss them items.',
    usage: 'give <player> <item> [count] [--replace]', requiresSpawn: true, localOnly: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 2, 3, 'give <player> <item> [count]')
      const player = command.args[0] as string
      const item = resourceName(command.args[1] as string)
      const count = boundedInteger(command.args[2] ?? '1', 'count', 1, config.safety.maxGatherCount)
      return startTask(context, `give ${player} ${count} ${item}`, async (task) => {
        const result = await inventory.give(task, player, item, count)
        context.logger.info(`Gave ${result.playerName} ${result.dropped} ${result.itemName}`)
      }, command)
    }
  })

  router.register({
    name: 'container', aliases: ['chest'], category: 'inventory', summary: 'Inspect or transfer items with the nearest container.',
    usage: 'container <inspect|deposit|withdraw> [item] [count] [--radius N] [--replace]', requiresSpawn: true, localOnly: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      const action = command.args[0]?.toLowerCase()
      const maxDistance = flagInteger(command, 'radius', defaultSearchRadius(16), 2, config.safety.maxSearchDistance)
      if (action === 'inspect') {
        argumentsBetween(command, 1, 1, 'container inspect [--radius N]')
        return startTask(context, 'inspect nearest container', async (task) => {
          const result = await inventory.inspectNearestContainer(task, { maxDistance })
          context.logger.info(`${result.blockName} at ${result.position.x},${result.position.y},${result.position.z}: ${result.items.map((item) => `${item.count}×${item.name}`).join(', ') || 'empty'}`)
        }, command)
      }
      if (action === 'deposit' || action === 'withdraw') {
        argumentsBetween(command, 2, 3, `container ${action} <item> [count] [--radius N]`)
        const item = resourceName(command.args[1] as string)
        const count = boundedInteger(command.args[2] ?? '1', 'count', 1, config.safety.maxGatherCount)
        return startTask(context, `${action} ${count} ${item}`, async (task) => {
          const result = action === 'deposit'
            ? await inventory.deposit(task, item, count, { maxDistance })
            : await inventory.withdraw(task, item, count, { maxDistance })
          context.logger.info(`${result.direction}: moved ${result.moved}/${result.requested} ${result.itemName}`)
        }, command)
      }
      throw new CommandSyntaxError('Usage: container <inspect|deposit|withdraw> [item] [count]')
    }
  })

  router.register({
    name: 'mine', aliases: ['gather'], category: 'resources', summary: 'Mine a bounded count of one or more block types.',
    usage: 'mine <block[,block...]> [count] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 1, 2, 'mine <block[,block...]> [count] [--radius N]')
      const blocks = (command.args[0] as string).split(',').map(resourceName)
      const count = boundedInteger(command.args[1] ?? '1', 'count', 1, config.safety.maxGatherCount)
      const maxDistance = flagInteger(command, 'radius', config.safety.maxSearchDistance, 2, config.safety.maxSearchDistance)
      return startTask(context, `mine ${count} ${blocks.join('/')}`, async (task) => {
        const result = await resources.mine(task, blocks, { count, maxDistance })
        context.logger.info(`Mining complete: ${result.mined}/${result.requested}; ${result.failures.length} failure(s)`)
        logTaskIssues(context, 'Mining', result.failures)
      }, command)
    }
  })

  router.register({
    name: 'veinmine', aliases: ['vein'], category: 'resources', summary: 'Mine a connected vein of matching blocks.',
    usage: 'veinmine <block> [count] [--radius N] [--gap 1..3] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'gap', 'replace'])
      argumentsBetween(command, 1, 2, 'veinmine <block> [count]')
      const block = resourceName(command.args[0] as string)
      const count = boundedInteger(command.args[1] ?? '32', 'count', 1, config.safety.maxGatherCount)
      const maxDistance = flagInteger(command, 'radius', config.safety.maxSearchDistance, 2, config.safety.maxSearchDistance)
      const floodRadius = flagInteger(command, 'gap', 1, 1, 3)
      return startTask(context, `vein mine ${count} ${block}`, async (task) => {
        const result = await resources.veinMine(task, block, { count, maxDistance, floodRadius })
        context.logger.info(`Vein mine complete: ${result.mined}/${result.requested}; ${result.failures.length} failure(s)`)
        logTaskIssues(context, 'Vein mining', result.failures)
      }, command)
    }
  })

  router.register({
    name: 'chop', aliases: ['woodcut'], category: 'resources', summary: 'Collect logs for one wood type or any common tree.',
    usage: 'chop [wood|any] [count] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 0, 2, 'chop [wood|any] [count]')
      const type = resourceName(command.args[0] ?? 'any')
      const bot = context.runtime.requireBot()
      const blocks = resolveChopBlockNames(bot.registry.blocksByName, type)
      if (blocks.length === 0) throw new Error(`No supported log blocks exist in Minecraft ${bot.version}`)
      const count = boundedInteger(command.args[1] ?? '16', 'count', 1, config.safety.maxGatherCount)
      const maxDistance = flagInteger(command, 'radius', config.safety.maxSearchDistance, 2, config.safety.maxSearchDistance)
      return startTask(context, `chop ${count} ${type}`, async (task) => {
        const result = await resources.mine(task, blocks, { count, maxDistance })
        context.logger.info(`Chopping complete: ${result.mined}/${result.requested}`)
      }, command)
    }
  })

  router.register({
    name: 'drops', aliases: ['pickup'], category: 'resources', summary: 'Collect nearby dropped item entities.',
    usage: 'drops [item[,item...]] [count] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace'])
      argumentsBetween(command, 0, 2, 'drops [item[,item...]] [count]')
      const soleCount = command.args.length === 1 && /^\d+$/u.test(command.args[0] ?? '')
      const itemNames = command.args[0] && !soleCount ? command.args[0].split(',').map(resourceName) : undefined
      const countArgument = soleCount ? command.args[0] : command.args[1]
      const maxEntities = boundedInteger(countArgument ?? String(config.safety.maxGatherCount), 'count', 1, config.safety.maxGatherCount)
      const maxDistance = flagInteger(command, 'radius', config.safety.maxSearchDistance, 2, config.safety.maxSearchDistance)
      return startTask(context, `collect up to ${maxEntities} dropped items`, async (task) => {
        const result = await resources.collectDrops(task, { itemNames, maxEntities, maxDistance })
        context.logger.info(`Collected ${result.collectedEntities}/${result.foundEntities} drops: ${result.items.map((item) => `${item.count}×${item.name}`).join(', ') || 'none'}`)
        logTaskIssues(context, 'Drop collection', result.failures)
      }, command)
    }
  })

  router.register({
    name: 'recipe', category: 'crafting', summary: 'Show known recipes and whether one is craftable now.',
    usage: 'recipe <item> [count]', requiresSpawn: true,
    execute(_context, command) {
      assertOnlyFlags(command, []); argumentsBetween(command, 1, 2, 'recipe <item> [count]')
      const item = resourceName(command.args[0] as string)
      const count = boundedInteger(command.args[1] ?? '1', 'count', 1, config.safety.maxGatherCount)
      const result = resources.recipeSummary(item, count)
      if (!result.hasRecipe) return `${result.itemName} has no crafting recipe in this Minecraft version.`
      return [
        `${result.displayName}: ${result.options.length} recipe(s); ${result.craftableNow ? 'craftable now' : 'missing ingredients or table'}.`,
        ...result.options.slice(0, 8).map((option, index) => `#${index + 1} ${option.outputPerCraft}/craft${option.requiresTable ? ' at table' : ''}: ${option.ingredients.map((ingredient) => `${ingredient.count}×${ingredient.name}`).join(', ')}`)
      ]
    }
  })

  router.register({
    name: 'craft', category: 'crafting', summary: 'Craft a bounded item count using inventory and a nearby table.',
    usage: 'craft <item> [count] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'replace']); argumentsBetween(command, 1, 2, 'craft <item> [count]')
      const item = resourceName(command.args[0] as string)
      const count = boundedInteger(command.args[1] ?? '1', 'count', 1, config.safety.maxGatherCount)
      const maxDistance = flagInteger(command, 'radius', defaultSearchRadius(16), 2, config.safety.maxSearchDistance)
      return startTask(context, `craft ${count} ${item}`, async (task) => {
        const result = await resources.craft(task, item, count, { maxDistance })
        context.logger.info(`Crafted ${result.crafted} ${result.itemName}${result.usedCraftingTable ? ' at a table' : ''}`)
      }, command)
    }
  })

  router.register({
    name: 'smelt', category: 'crafting', summary: 'Smelt inventory items in a nearby empty furnace.',
    usage: 'smelt <item> [count] [--fuel item] [--radius N] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['fuel', 'radius', 'replace']); argumentsBetween(command, 1, 2, 'smelt <item> [count]')
      const input = resourceName(command.args[0] as string)
      const count = boundedInteger(command.args[1] ?? '1', 'count', 1, config.safety.maxGatherCount)
      const fuelFlag = command.flags.fuel
      if (fuelFlag === true) throw new CommandSyntaxError('--fuel needs an item name')
      const fuelName = typeof fuelFlag === 'string' ? resourceName(fuelFlag) : undefined
      const maxDistance = flagInteger(command, 'radius', defaultSearchRadius(16), 2, config.safety.maxSearchDistance)
      return startTask(context, `smelt ${count} ${input}`, async (task) => {
        const result = await resources.smelt(task, input, count, { fuelName, maxDistance })
        context.logger.info(`Smelted ${result.produced}/${result.inputCount} ${result.inputName}${result.timedOut ? ' (timed out)' : ''}`)
      }, command)
    }
  })

  router.register({
    name: 'fish', category: 'resources', summary: 'Fish a bounded number of casts with an inventory fishing rod.',
    usage: 'fish [count] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 0, 1, 'fish [count]')
      const count = boundedInteger(command.args[0] ?? '1', 'count', 1, config.safety.maxGatherCount)
      return startTask(context, `fish ${count} cast(s)`, async (task) => {
        const result = await resources.fish(task, count)
        context.logger.info(`Fishing complete: ${result.caught}/${result.casts}; ${result.items.map((item) => `${item.count}×${item.name}`).join(', ') || 'no new items'}`)
      }, command)
    }
  })

  router.register({
    name: 'farm', category: 'farming', summary: 'Scan, harvest, or harvest-and-replant mature crops.',
    usage: 'farm <scan|harvest|tend> [crop|all] [--radius N] [--limit N] [--replant bool] [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['radius', 'limit', 'replant', 'replace'])
      argumentsBetween(command, 1, 2, 'farm <scan|harvest|tend> [crop|all]')
      const action = command.args[0]?.toLowerCase()
      const crop = resourceName(command.args[1] ?? 'all') as FarmCropFilter
      if (crop !== 'all' && !(FARM_CROPS as readonly string[]).includes(crop)) throw new CommandSyntaxError(`Supported crops: all, ${FARM_CROPS.join(', ')}`)
      const radius = flagInteger(command, 'radius', Math.min(config.behavior.farmRadius, config.safety.maxSearchDistance), 2, config.safety.maxSearchDistance)
      const limit = flagInteger(command, 'limit', config.safety.maxGatherCount, 1, config.safety.maxGatherCount)
      if (action === 'scan') {
        assertOnlyFlags(command, ['radius', 'limit'])
        const result = farming.scan({ crop, radius, limit })
        return [`Scanned ${result.scanned}: ${result.mature} mature, ${result.immature} growing, ${result.unknownAge} unknown.`, ...FARM_CROPS.filter((name) => result.byCrop[name].scanned > 0).map((name) => `${name}: ${result.byCrop[name].mature}/${result.byCrop[name].scanned} mature`)]
      }
      if (action === 'harvest' || action === 'tend') {
        assertOnlyFlags(command, action === 'harvest'
          ? ['radius', 'limit', 'replace']
          : ['radius', 'limit', 'replant', 'replace'])
        const replant = action === 'harvest' ? false : flagBoolean(command, 'replant', true)
        return startTask(context, `${action} ${crop} within ${radius}`, async (task) => {
          const result = await farming.tend(task, { crop, radius, limit, replant })
          context.logger.info(`Farm complete: ${result.harvested} harvested, ${result.replanted} replanted, ${result.failed} failed`)
          logTaskIssues(context, 'Farming', result.issues)
        }, command)
      }
      throw new CommandSyntaxError('Usage: farm <scan|harvest|tend> [crop|all]')
    }
  })

  router.register({
    name: 'place', category: 'building', summary: 'Place one inventory-backed block at explicit coordinates.',
    usage: 'place <block> <x> <y> <z> [--replace]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['replace']); argumentsBetween(command, 4, 4, 'place <block> <x> <y> <z>')
      const material = resourceName(command.args[0] as string)
      const position = coordinates(context, command.args.slice(1))
      return startTask(context, `place ${material} at ${formatPosition(position, 0)}`, async (task) => {
        const result = await building.placeBlock(task, { material, position })
        context.logger.info(`Placement: ${result.placed} placed, ${result.skipped} skipped, ${result.failed} failed`)
        logTaskIssues(context, 'Placement', result.issues)
      }, command)
    }
  })

  router.register({
    name: 'build', category: 'building', summary: 'Build a bounded floor, wall, or box from inventory blocks.',
    usage: 'build floor <block> x y z width depth | wall <block> x y z width height [--axis x|z] | box <block> x y z width height depth [--hollow bool]', requiresSpawn: true,
    execute(context, command) {
      assertOnlyFlags(command, ['axis', 'hollow', 'replace'])
      const shape = command.args[0]?.toLowerCase()
      const material = command.args[1] ? resourceName(command.args[1]) : undefined
      if (!material) throw new CommandSyntaxError('A block material is required')
      const origin = coordinates(context, command.args.slice(2, 5))
      if (shape === 'floor') {
        assertOnlyFlags(command, ['replace'])
        argumentsBetween(command, 7, 7, 'build floor <block> x y z <width> <depth>')
        const width = boundedInteger(command.args[5], 'width', 1, config.safety.maxBuildBlocks)
        const depth = boundedInteger(command.args[6], 'depth', 1, config.safety.maxBuildBlocks)
        const plan = building.planFloor({ origin, width, depth, material })
        return startTask(context, `build ${width}×${depth} ${material} floor`, async (task) => {
          const result = await building.executePlan(task, plan)
          context.logger.info(`Floor: ${result.placed}/${result.requested} placed; ${result.skipped} skipped, ${result.failed} failed`)
          logTaskIssues(context, 'Floor', result.issues)
        }, command)
      }
      if (shape === 'wall') {
        assertOnlyFlags(command, ['axis', 'replace'])
        argumentsBetween(command, 7, 7, 'build wall <block> x y z <width> <height> [--axis x|z]')
        const width = boundedInteger(command.args[5], 'width', 1, config.safety.maxBuildBlocks)
        const height = boundedInteger(command.args[6], 'height', 1, config.safety.maxBuildBlocks)
        const axisFlag = command.flags.axis
        if (axisFlag === true) throw new CommandSyntaxError('--axis needs x or z')
        const axis = (axisFlag ?? 'x') as BuildAxis
        if (!['x', 'z'].includes(axis)) throw new CommandSyntaxError('--axis must be x or z')
        const plan = building.planWall({ origin, width, height, material, axis })
        return startTask(context, `build ${width}×${height} ${material} wall`, async (task) => {
          const result = await building.executePlan(task, plan)
          context.logger.info(`Wall: ${result.placed}/${result.requested} placed; ${result.skipped} skipped, ${result.failed} failed`)
          logTaskIssues(context, 'Wall', result.issues)
        }, command)
      }
      if (shape === 'box') {
        assertOnlyFlags(command, ['hollow', 'replace'])
        argumentsBetween(command, 8, 8, 'build box <block> x y z <width> <height> <depth> [--hollow bool]')
        const width = boundedInteger(command.args[5], 'width', 1, config.safety.maxBuildBlocks)
        const height = boundedInteger(command.args[6], 'height', 1, config.safety.maxBuildBlocks)
        const depth = boundedInteger(command.args[7], 'depth', 1, config.safety.maxBuildBlocks)
        const hollow = flagBoolean(command, 'hollow', true)
        const plan = building.planBox({ origin, width, height, depth, material, hollow })
        return startTask(context, `build ${width}×${height}×${depth} ${material} box`, async (task) => {
          const result = await building.executePlan(task, plan)
          context.logger.info(`Box: ${result.placed}/${result.requested} placed; ${result.skipped} skipped, ${result.failed} failed`)
          logTaskIssues(context, 'Box', result.issues)
        }, command)
      }
      throw new CommandSyntaxError('Usage: build <floor|wall|box> ...')
    }
  })

  return router
}

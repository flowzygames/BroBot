import { EventEmitter } from 'node:events'
import { createConnection, type Socket } from 'node:net'
import mineflayer, { type Bot, type BotOptions } from 'mineflayer'
import type { Client } from 'minecraft-protocol'
import type { Block } from 'prismarine-block'
import { loader as autoEat } from 'mineflayer-auto-eat'
import { Movements, pathfinder } from './pathfinder.js'
import { plugin as tool } from 'mineflayer-tool'
import type { AppConfig, BotStatus, InventoryLine, PositionData } from './types.js'
import type { Logger, ScopedLogger } from './logger.js'
import type { StateStore } from './storage.js'
import { equipBestArmor, type EquippedArmor } from './armor.js'
import { UNSAFE_FOODS } from './food-safety.js'
import { isProtectedBlockName } from './block-safety.js'

export interface ChatCommandEvent {
  username: string
  message: string
  kind: 'chat' | 'whisper'
}

interface ConnectionAttempt {
  cancelled: boolean
  clients: Set<Client>
  sockets: Set<Socket>
  watchdog?: NodeJS.Timeout
  closing?: Promise<void>
}

const CONNECTION_TIMEOUT_MS = 30_000

function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  try { return JSON.stringify(reason) } catch { return String(reason) }
}

export class BotRuntime extends EventEmitter {
  private bot?: Bot
  private spawned = false
  private shuttingDown = false
  private reconnectAttempts = 0
  private reconnectTimer?: NodeJS.Timeout
  private lastError?: { message: string, at: number }
  private autoEatPreference: boolean
  private readonly autoEatPauses = new Set<symbol>()
  private readonly connectionAttempts = new WeakMap<Bot, ConnectionAttempt>()
  private readonly startedAt = Date.now()
  private readonly log: ScopedLogger

  constructor(
    readonly config: AppConfig,
    logger: Logger,
    private readonly store: StateStore
  ) {
    super()
    this.log = logger.child('minecraft')
    this.autoEatPreference = config.behavior.autoEat
  }

  get currentBot(): Bot | undefined { return this.bot }
  get isSpawned(): boolean { return this.spawned }
  get autoEatEnabled(): boolean { return this.autoEatPreference }

  setAutoEatEnabled(enabled: boolean): void {
    this.autoEatPreference = enabled
    this.syncAutoEat()
  }

  /** Temporarily stop background eating before an action owns the held item. */
  async pauseAutoEat(bot: Bot, signal?: AbortSignal): Promise<() => void> {
    if (this.bot !== bot) throw new Error('The bot connection changed before auto-eat could pause')
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Action cancelled')
    const token = Symbol('auto-eat-pause')
    this.autoEatPauses.add(token)
    this.syncAutoEat()
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.autoEatPauses.delete(token)
      this.syncAutoEat()
    }

    const deadline = Date.now() + 5_000
    try {
      while (bot.autoEat.isEating) {
        if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Action cancelled')
        if (Date.now() >= deadline) throw new Error('Auto-eat did not release the held item within 5 seconds; reconnect the bot')
        await new Promise<void>((resolveWait, rejectWait) => {
          const finish = (): void => {
            signal?.removeEventListener('abort', abort)
            resolveWait()
          }
          const timer = setTimeout(finish, 50)
          const abort = (): void => {
            clearTimeout(timer)
            rejectWait(signal?.reason instanceof Error ? signal.reason : new Error('Action cancelled'))
          }
          signal?.addEventListener('abort', abort, { once: true })
        })
      }
      return release
    } catch (error) {
      release()
      throw error
    }
  }

  private syncAutoEat(): void {
    const bot = this.bot
    if (!bot?.autoEat) return
    if (this.autoEatPreference && this.autoEatPauses.size === 0) bot.autoEat.enableAuto()
    else {
      bot.autoEat.disableAuto()
      bot.autoEat.cancelEat()
    }
  }

  requireBot(): Bot {
    if (!this.bot || !this.spawned) throw new Error('The bot is not spawned in the world')
    return this.bot
  }

  connect(): void {
    if (this.bot) return
    this.shuttingDown = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }

    const minecraft = this.config.minecraft
    const attempt: ConnectionAttempt = { cancelled: false, clients: new Set(), sockets: new Set() }
    let activeBot: Bot | undefined
    const options: BotOptions = {
      host: minecraft.host,
      port: minecraft.port,
      username: minecraft.username,
      auth: minecraft.auth,
      hideErrors: true,
      logErrors: false,
      // Track every protocol socket, including the private status client used
      // for version:auto. A direct host/port is intentional for a local-first
      // tool and avoids an uncancellable asynchronous SRV lookup.
      connect: (client) => {
        if (attempt.cancelled) {
          queueMicrotask(() => client.emit('error', new Error('Connection attempt was cancelled locally')))
          return
        }
        const socket = createConnection({ host: minecraft.host, port: minecraft.port })
        attempt.clients.add(client)
        attempt.sockets.add(socket)
        socket.once('close', () => attempt.sockets.delete(socket))
        client.setSocket(socket)
        if (activeBot && client === activeBot._client) this.armConnectionWatchdog(activeBot, attempt)
        if (attempt.cancelled) socket.destroy(new Error('Connection attempt was cancelled locally'))
      },
      ...(minecraft.version === 'auto' ? {} : { version: minecraft.version })
    }

    this.log.info(`Connecting to ${minecraft.host}:${minecraft.port} as ${minecraft.username} (${minecraft.auth})`)
    let bot: Bot
    try {
      bot = mineflayer.createBot(options)
    } catch (error) {
      attempt.cancelled = true
      for (const client of attempt.clients) client.once('error', () => undefined)
      for (const socket of attempt.sockets) socket.destroy(new Error('Connection setup failed locally'))
      this.log.error('Connection setup failed', error)
      this.scheduleReconnect()
      return
    }
    this.bot = bot
    activeBot = bot
    this.connectionAttempts.set(bot, attempt)
    if (attempt.clients.has(bot._client)) this.armConnectionWatchdog(bot, attempt)
    bot.loadPlugin(pathfinder)
    bot.loadPlugin(tool)
    bot.loadPlugin(autoEat)
    this.bindEvents(bot)
  }

  private armConnectionWatchdog(bot: Bot, attempt: ConnectionAttempt): void {
    if (attempt.cancelled || attempt.watchdog || this.spawned) return
    attempt.watchdog = setTimeout(() => {
      if (attempt.cancelled || this.bot !== bot || this.spawned) return
      this.log.warn(`Connection attempt timed out after ${CONNECTION_TIMEOUT_MS / 1_000}s`)
      try { bot.end('Connection attempt timed out') } finally {
        void this.cancelConnectionAttempt(bot, 'Connection attempt timed out')
      }
    }, CONNECTION_TIMEOUT_MS)
  }

  private bindEvents(bot: Bot): void {
    let firstSpawn = true
    bot.once('login', () => {
      if (this.bot !== bot) return
      this.log.info('Authenticated with the server')
      this.emit('connection', true)
    })

    bot.on('spawn', () => {
      if (this.bot !== bot) return
      const attempt = this.connectionAttempts.get(bot)
      if (attempt?.watchdog) {
        clearTimeout(attempt.watchdog)
        attempt.watchdog = undefined
      }
      this.spawned = true
      this.reconnectAttempts = 0
      if (firstSpawn) {
        firstSpawn = false
        this.configurePlugins(bot)
        this.log.info(`Spawned in ${bot.game.dimension} on Minecraft ${bot.version}`)
      } else {
        this.log.info(`Respawned in ${bot.game.dimension}`)
      }
      this.emit('spawn', bot)
    })

    bot.on('chat', (username, message) => {
      if (this.bot !== bot) return
      if (username !== bot.username) this.emit('chat-command', { username, message, kind: 'chat' } satisfies ChatCommandEvent)
      this.emit('chat-line', { username, message, kind: 'chat' } satisfies ChatCommandEvent)
    })

    bot.on('whisper', (username, message) => {
      if (this.bot !== bot) return
      if (username !== bot.username) this.emit('chat-command', { username, message, kind: 'whisper' } satisfies ChatCommandEvent)
      this.emit('chat-line', { username, message, kind: 'whisper' } satisfies ChatCommandEvent)
    })

    bot.on('death', () => {
      if (this.bot !== bot) return
      this.spawned = false
      const deathPosition = this.position(bot)
      if (deathPosition) void this.store.setLastDeath(deathPosition).catch((error) => this.log.warn('Could not save death position', error))
      this.log.warn('Bot died; active physical work must be restarted')
      this.emit('death', deathPosition)
    })

    bot.on('kicked', (reason) => {
      if (this.bot !== bot) return
      this.log.warn(`Kicked by server: ${stringifyReason(reason)}`)
    })
    bot.on('error', (error) => {
      if (this.bot !== bot) return
      const message = error instanceof Error ? error.message : String(error)
      const now = Date.now()
      if (this.lastError?.message === message && now - this.lastError.at < 1_000) return
      this.lastError = { message, at: now }
      this.log.error('Minecraft connection error', error)
    })
    bot.once('end', (reason) => {
      void this.cancelConnectionAttempt(bot, `Minecraft connection ended: ${stringifyReason(reason)}`)
      if (this.bot !== bot) return
      this.spawned = false
      this.bot = undefined
      this.log.warn(`Disconnected: ${stringifyReason(reason)}`)
      this.emit('connection', false)
      this.scheduleReconnect()
    })
  }

  private cancelConnectionAttempt(bot: Bot, reason: string, gracefulPrimary = false): Promise<void> {
    const attempt = this.connectionAttempts.get(bot)
    if (!attempt) return Promise.resolve()
    if (attempt.closing) return attempt.closing
    attempt.cancelled = true
    if (attempt.watchdog) {
      clearTimeout(attempt.watchdog)
      attempt.watchdog = undefined
    }
    const primary = bot._client.socket
    const sockets = [...attempt.sockets].filter((socket) => !socket.destroyed)
    const closed = sockets.map((socket) => new Promise<void>((resolveClose) => {
      socket.once('close', resolveClose)
      if (gracefulPrimary && socket === primary) {
        const forceClose = setTimeout(() => socket.destroy(new Error(reason)), 250)
        forceClose.unref()
        socket.once('close', () => clearTimeout(forceClose))
      } else {
        // An Error is deliberate: minecraft-protocol's private ping client
        // clears its otherwise-ref'ed 120s timer only on error/response.
        socket.destroy(new Error(reason))
      }
    }))
    attempt.closing = Promise.allSettled(closed).then(() => undefined)
    return attempt.closing
  }

  private configurePlugins(bot: Bot): void {
    const movements = this.createMovements(bot, false)
    bot.pathfinder.setMovements(movements)
    this.configureSurvival(bot)
  }

  createMovements(bot = this.requireBot(), allowDigging = false): Movements {
    const movements = new Movements(bot)
    movements.canDig = allowDigging && this.config.safety.allowDigging
    movements.allow1by1towers = false
    movements.allowParkour = false
    movements.maxDropDown = 3
    movements.dontCreateFlow = true
    movements.allowSprinting = true
    // Pathfinder otherwise uses dirt/cobblestone to bridge or scaffold even
    // during ordinary travel, bypassing building policy and placement caps.
    movements.scafoldingBlocks = []

    for (const block of Object.values(bot.registry.blocksByName)) {
      if (isProtectedBlockName(block.name, this.config.safety.protectedBlocks)) {
        movements.blocksCantBreak.add(block.id)
      }
    }
    for (const name of ['lava', 'flowing_lava']) {
      const liquid = bot.registry.blocksByName[name]
      if (!liquid) continue
      movements.liquids.add(liquid.id)
      movements.blocksToAvoid.add(liquid.id)
    }
    for (const name of ['water', 'flowing_water']) {
      const liquid = bot.registry.blocksByName[name]
      if (!liquid) continue
      movements.liquids.add(liquid.id)
      if (this.config.behavior.avoidWater) movements.blocksToAvoid.add(liquid.id)
    }

    return movements
  }

  isSafeToBreak(block: Block, bot = this.requireBot()): boolean {
    // pathfinder augments standard prismarine blocks internally but exposes a
    // narrower SafeBlock type; at runtime safeToBreak accepts the world block.
    return this.createMovements(bot, true).safeToBreak(
      block as unknown as Parameters<Movements['safeToBreak']>[0]
    )
  }

  private configureSurvival(bot: Bot): void {
    bot.autoEat.setOpts({
      priority: 'saturation',
      minHunger: 15,
      // The plugin cannot reliably choose an always-consumable recovery food
      // at full hunger, so background eating is hunger-driven only.
      minHealth: 0,
      // auto-eat@5 restores the old held item without awaiting the equip.
      // Leaving food selected avoids a late equip racing the next task; every
      // action that owns the hand explicitly equips what it needs.
      returnToLastItem: false,
      bannedFood: [...UNSAFE_FOODS]
    })
    this.syncAutoEat()

    if (this.config.behavior.autoArmor) {
      void (async () => {
        const releaseAutoEat = await this.pauseAutoEat(bot)
        try { await this.equipBestArmor(bot) } finally { releaseAutoEat() }
      })().catch((error) => this.log.warn('Auto-armor setup failed', error))
    }

  }

  private scheduleReconnect(): void {
    const reconnect = this.config.minecraft.reconnect
    if (this.shuttingDown || !reconnect.enabled || this.reconnectTimer) return
    if (reconnect.maxAttempts > 0 && this.reconnectAttempts >= reconnect.maxAttempts) {
      this.log.error(`Reconnect stopped after ${this.reconnectAttempts} attempts`)
      return
    }
    const delay = Math.min(
      reconnect.maxDelayMs,
      reconnect.initialDelayMs * (2 ** Math.min(this.reconnectAttempts, 10))
    )
    this.reconnectAttempts += 1
    this.log.info(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${this.reconnectAttempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  async equipBestArmor(bot = this.requireBot()): Promise<EquippedArmor[]> {
    return await equipBestArmor(bot)
  }

  async stopPhysicalActions(bot = this.bot): Promise<void> {
    if (!bot) return
    try {
      // External/core plugins may still be queued before Mineflayer's
      // inject_allowed event, so every cleanup is presence-safe.
      bot.pathfinder?.setGoal(null)
      bot.stopDigging?.()
      bot.clearControlStates?.()
      bot.deactivateItem?.()
      if (bot.currentWindow && bot.closeWindow) bot.closeWindow(bot.currentWindow)
    } catch (error) {
      this.log.warn('Synchronous physical cleanup failed', error)
    }
  }

  async disconnect(reason = 'Local operator disconnected the bot'): Promise<void> {
    this.shuttingDown = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = undefined
    }
    const bot = this.bot
    try {
      await this.stopPhysicalActions(bot)
    } finally {
      const wasCurrent = this.bot === bot
      if (wasCurrent) {
        this.bot = undefined
        this.spawned = false
        this.autoEatPauses.clear()
      }
      if (bot) {
        try {
          bot.end(reason)
        } finally {
          // Client.end() otherwise waits up to 30 seconds. The tracked attempt
          // also owns version:auto's hidden status-ping client.
          await this.cancelConnectionAttempt(bot, reason, true)
        }
        if (wasCurrent) {
          this.emit('connection', false)
          this.log.info('Disconnected by local control')
        }
      }
    }
  }

  async reconnect(): Promise<void> {
    await this.disconnect('Local operator requested reconnect')
    this.shuttingDown = false
    this.reconnectAttempts = 0
    this.connect()
  }

  position(bot = this.bot): PositionData | undefined {
    if (!bot?.entity?.position) return undefined
    const { x, y, z } = bot.entity.position
    return { x, y, z, dimension: bot.game?.dimension }
  }

  status(): BotStatus {
    const bot = this.bot
    const inventory = bot?.inventory ? this.groupInventory(bot) : []
    const players = bot?.players ? Object.keys(bot.players).filter((name) => name !== bot.username).sort() : []
    return {
      connected: Boolean(bot),
      spawned: this.spawned,
      username: bot?.username ?? this.config.minecraft.username,
      server: `${this.config.minecraft.host}:${this.config.minecraft.port}`,
      ...(bot?.version ? { version: bot.version } : {}),
      ...(this.spawned && bot ? {
        health: bot.health,
        food: bot.food,
        oxygen: bot.oxygenLevel,
        experience: bot.experience.level,
        position: this.position(bot),
        dimension: bot.game.dimension,
        gameMode: bot.game.gameMode
      } : {}),
      players,
      inventory,
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000)
    }
  }

  private groupInventory(bot: Bot): InventoryLine[] {
    const grouped = new Map<string, InventoryLine>()
    for (const item of bot.inventory.items()) {
      const existing = grouped.get(item.name)
      if (existing) {
        existing.count += item.count
        existing.slots.push(item.slot)
      } else {
        grouped.set(item.name, {
          name: item.name,
          displayName: item.displayName,
          count: item.count,
          slots: [item.slot]
        })
      }
    }
    return [...grouped.values()].sort((a, b) => a.name.localeCompare(b.name))
  }
}

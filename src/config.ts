import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import type { AppConfig, LogLevel } from './types.js'

export const DEFAULT_CONFIG: AppConfig = {
  minecraft: {
    host: '127.0.0.1',
    port: 25565,
    username: 'BroBot',
    auth: 'offline',
    version: 'auto',
    reconnect: {
      enabled: true,
      initialDelayMs: 3_000,
      maxDelayMs: 30_000,
      maxAttempts: 0
    }
  },
  commands: {
    prefix: '!',
    allowlist: [],
    publicCommands: ['help', 'status'],
    announceErrorsInChat: true
  },
  dashboard: {
    enabled: true,
    host: '127.0.0.1',
    port: 8765,
    authToken: ''
  },
  safety: {
    allowDigging: true,
    allowBuilding: true,
    allowPvp: false,
    maxTaskSeconds: 900,
    maxGatherCount: 128,
    maxBuildBlocks: 256,
    maxSearchDistance: 64,
    protectedBlocks: [
      'chest', 'trapped_chest', 'barrel', 'ender_chest', 'shulker_box',
      'furnace', 'blast_furnace', 'smoker', 'spawner', 'tnt', 'respawn_anchor',
      'fire', 'soul_fire', 'nether_portal', 'end_portal', 'end_gateway',
      'command_block', 'chain_command_block', 'repeating_command_block',
      'structure_block', 'jigsaw'
    ]
  },
  behavior: {
    followDistance: 3,
    guardRadius: 12,
    farmRadius: 24,
    patrolPauseMs: 1_500,
    autoEat: true,
    autoArmor: true,
    avoidWater: false
  },
  storage: { dataDirectory: '.brobot-data' },
  logging: { level: 'info', maxEntries: 500 }
}

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function merge<T>(base: T, override: unknown): T {
  if (!isObject(base) || !isObject(override)) return (override ?? base) as T
  const result: JsonObject = { ...base }
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key]
    result[key] = isObject(existing) && isObject(value) ? merge(existing, value) : value
  }
  return result as T
}

function numberIn(name: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be between ${min} and ${max}`)
  }
}

function integerIn(name: string, value: number, min: number, max: number): void {
  numberIn(name, value, min, max)
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be a whole number`)
}

function requireBoolean(name: string, value: unknown): void {
  if (typeof value !== 'boolean') throw new Error(`${name} must be true or false`)
}

function requireString(name: string, value: unknown): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${name} must be a string`)
}

function requireStringArray(name: string, value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${name} must be an array of strings`)
  }
}

export function validateConfig(config: AppConfig): AppConfig {
  for (const section of ['minecraft', 'commands', 'dashboard', 'safety', 'behavior', 'storage', 'logging'] as const) {
    if (!isObject(config[section])) throw new Error(`${section} must be a JSON object`)
  }
  if (!isObject(config.minecraft.reconnect)) throw new Error('minecraft.reconnect must be a JSON object')
  requireString('minecraft.host', config.minecraft.host)
  requireString('minecraft.username', config.minecraft.username)
  requireString('minecraft.auth', config.minecraft.auth)
  requireString('minecraft.version', config.minecraft.version)
  requireBoolean('minecraft.reconnect.enabled', config.minecraft.reconnect.enabled)
  requireString('commands.prefix', config.commands.prefix)
  requireStringArray('commands.allowlist', config.commands.allowlist)
  requireStringArray('commands.publicCommands', config.commands.publicCommands)
  requireBoolean('commands.announceErrorsInChat', config.commands.announceErrorsInChat)
  requireBoolean('dashboard.enabled', config.dashboard.enabled)
  requireString('dashboard.host', config.dashboard.host)
  requireString('dashboard.authToken', config.dashboard.authToken)
  requireBoolean('safety.allowDigging', config.safety.allowDigging)
  requireBoolean('safety.allowBuilding', config.safety.allowBuilding)
  requireBoolean('safety.allowPvp', config.safety.allowPvp)
  requireStringArray('safety.protectedBlocks', config.safety.protectedBlocks)
  config.safety.protectedBlocks = [...new Set(config.safety.protectedBlocks.map((name) =>
    name.trim().toLowerCase().replace(/^minecraft:/u, '')
  ))]
  if (config.safety.protectedBlocks.some((name) => !/^[a-z0-9_]+$/u.test(name))) {
    throw new Error('safety.protectedBlocks entries must be Minecraft block identifiers')
  }
  requireBoolean('behavior.autoEat', config.behavior.autoEat)
  requireBoolean('behavior.autoArmor', config.behavior.autoArmor)
  requireBoolean('behavior.avoidWater', config.behavior.avoidWater)
  requireString('storage.dataDirectory', config.storage.dataDirectory)
  requireString('logging.level', config.logging.level)
  if (!config.minecraft.host.trim()) throw new Error('minecraft.host is required')
  if (!config.minecraft.username.trim()) throw new Error('minecraft.username is required')
  if (!config.minecraft.version.trim()) throw new Error('minecraft.version is required (use "auto" for detection)')
  if (!['offline', 'microsoft'].includes(config.minecraft.auth)) {
    throw new Error('minecraft.auth must be "offline" or "microsoft"')
  }
  integerIn('minecraft.port', config.minecraft.port, 1, 65_535)
  integerIn('minecraft.reconnect.initialDelayMs', config.minecraft.reconnect.initialDelayMs, 250, 300_000)
  integerIn('minecraft.reconnect.maxDelayMs', config.minecraft.reconnect.maxDelayMs, 250, 3_600_000)
  integerIn('minecraft.reconnect.maxAttempts', config.minecraft.reconnect.maxAttempts, 0, 1_000_000)
  if (config.minecraft.reconnect.maxDelayMs < config.minecraft.reconnect.initialDelayMs) {
    throw new Error('minecraft.reconnect.maxDelayMs cannot be below initialDelayMs')
  }
  if (config.commands.prefix.length !== 1) throw new Error('commands.prefix must be exactly one character')
  if (!config.dashboard.host.trim()) throw new Error('dashboard.host is required')
  if (config.dashboard.authToken.length > 512) throw new Error('dashboard.authToken is too long')
  if (config.dashboard.authToken !== config.dashboard.authToken.trim()) {
    throw new Error('dashboard.authToken cannot start or end with whitespace')
  }
  if (/[\u0000-\u001F\u007F-\u009F]/u.test(config.dashboard.authToken)) {
    throw new Error('dashboard.authToken cannot contain control characters')
  }
  integerIn('dashboard.port', config.dashboard.port, 1, 65_535)
  numberIn('safety.maxTaskSeconds', config.safety.maxTaskSeconds, 1, 86_400)
  integerIn('safety.maxGatherCount', config.safety.maxGatherCount, 1, 10_000)
  integerIn('safety.maxBuildBlocks', config.safety.maxBuildBlocks, 1, 10_000)
  integerIn('safety.maxSearchDistance', config.safety.maxSearchDistance, 4, 512)
  integerIn('behavior.followDistance', config.behavior.followDistance, 1, 16)
  integerIn('behavior.guardRadius', config.behavior.guardRadius, 2, 64)
  integerIn('behavior.farmRadius', config.behavior.farmRadius, 2, 128)
  integerIn('behavior.patrolPauseMs', config.behavior.patrolPauseMs, 0, 60_000)
  integerIn('logging.maxEntries', config.logging.maxEntries, 10, 100_000)
  if (!(['debug', 'info', 'warn', 'error'] as LogLevel[]).includes(config.logging.level)) {
    throw new Error('logging.level must be debug, info, warn, or error')
  }
  if (!config.storage.dataDirectory.trim()) throw new Error('storage.dataDirectory is required')
  return config
}

export function resolveDataDirectory(config: AppConfig, configPath?: string): string {
  if (isAbsolute(config.storage.dataDirectory)) return config.storage.dataDirectory
  const base = configPath ? resolve(configPath, '..') : process.cwd()
  return resolve(base, config.storage.dataDirectory)
}

export async function loadConfig(configPath?: string): Promise<AppConfig> {
  let fileConfig: unknown = {}
  if (configPath) {
    const raw = await readFile(resolve(configPath), 'utf8')
    fileConfig = JSON.parse(raw) as unknown
    if (!isObject(fileConfig)) throw new Error('The config file must contain a JSON object')
  }

  const config = merge(structuredClone(DEFAULT_CONFIG), fileConfig)
  if (process.env.MC_HOST) config.minecraft.host = process.env.MC_HOST
  if (process.env.MC_PORT) config.minecraft.port = Number(process.env.MC_PORT)
  if (process.env.MC_USERNAME) config.minecraft.username = process.env.MC_USERNAME
  if (process.env.MC_AUTH === 'offline' || process.env.MC_AUTH === 'microsoft') {
    config.minecraft.auth = process.env.MC_AUTH
  }
  if (process.env.DASHBOARD_TOKEN !== undefined) config.dashboard.authToken = process.env.DASHBOARD_TOKEN
  return validateConfig(config)
}

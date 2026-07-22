export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ReconnectConfig {
  enabled: boolean
  initialDelayMs: number
  maxDelayMs: number
  /** Zero means unlimited. */
  maxAttempts: number
}

export interface MinecraftConfig {
  host: string
  port: number
  username: string
  auth: 'offline' | 'microsoft'
  /** `auto` asks Mineflayer to detect the server version. */
  version: string
  reconnect: ReconnectConfig
}

export interface CommandConfig {
  prefix: string
  allowlist: string[]
  publicCommands: string[]
  announceErrorsInChat: boolean
}

export interface DashboardConfig {
  enabled: boolean
  host: string
  port: number
  authToken: string
}

export interface SafetyConfig {
  allowDigging: boolean
  allowBuilding: boolean
  allowPvp: boolean
  maxTaskSeconds: number
  maxGatherCount: number
  maxBuildBlocks: number
  maxSearchDistance: number
  protectedBlocks: string[]
}

export interface BehaviorConfig {
  followDistance: number
  guardRadius: number
  farmRadius: number
  patrolPauseMs: number
  autoEat: boolean
  autoArmor: boolean
  avoidWater: boolean
}

export interface StorageConfig {
  dataDirectory: string
}

export interface LoggingConfig {
  level: LogLevel
  maxEntries: number
}

export interface AppConfig {
  minecraft: MinecraftConfig
  commands: CommandConfig
  dashboard: DashboardConfig
  safety: SafetyConfig
  behavior: BehaviorConfig
  storage: StorageConfig
  logging: LoggingConfig
}

export interface PositionData {
  x: number
  y: number
  z: number
  dimension?: string
}

export interface PersistedState {
  waypoints: Record<string, PositionData>
  patrolRoutes: Record<string, PositionData[]>
  lastDeath?: PositionData
  updatedAt: string
}

export interface BotStatus {
  connected: boolean
  spawned: boolean
  username: string
  server: string
  version?: string
  health?: number
  food?: number
  oxygen?: number
  experience?: number
  position?: PositionData
  dimension?: string
  gameMode?: string
  players: string[]
  currentTask?: TaskSnapshot
  inventory: InventoryLine[]
  uptimeSeconds: number
}

export interface InventoryLine {
  name: string
  displayName: string
  count: number
  slots: number[]
}

export interface TaskSnapshot {
  id: number
  label: string
  startedAt: string
  elapsedMs: number
  state: 'running' | 'cancelling'
}

export type CommandSource = 'console' | 'chat' | 'dashboard'

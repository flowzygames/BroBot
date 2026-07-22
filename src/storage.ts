import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { PersistedState, PositionData } from './types.js'

function emptyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function initialState(): PersistedState {
  return {
    waypoints: emptyRecord<PositionData>(),
    patrolRoutes: emptyRecord<PositionData[]>(),
    updatedAt: new Date(0).toISOString()
  }
}

function validPosition(value: unknown): value is PositionData {
  if (value === null || typeof value !== 'object') return false
  const position = value as Partial<PositionData>
  return [position.x, position.y, position.z].every((coordinate) => Number.isFinite(coordinate))
}

function sanitizeState(value: unknown): PersistedState {
  if (value === null || typeof value !== 'object') return initialState()
  const input = value as Partial<PersistedState>
  const waypoints = emptyRecord<PositionData>()
  const patrolRoutes = emptyRecord<PositionData[]>()

  if (input.waypoints && typeof input.waypoints === 'object') {
    for (const [name, position] of Object.entries(input.waypoints)) {
      if (validPosition(position)) waypoints[name.toLowerCase()] = position
    }
  }
  if (input.patrolRoutes && typeof input.patrolRoutes === 'object') {
    for (const [name, positions] of Object.entries(input.patrolRoutes)) {
      if (Array.isArray(positions)) patrolRoutes[name.toLowerCase()] = positions.filter(validPosition)
    }
  }

  return {
    waypoints,
    patrolRoutes,
    ...(validPosition(input.lastDeath) ? { lastDeath: input.lastDeath } : {}),
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date(0).toISOString()
  }
}

export class StateStore {
  private readonly filePath: string
  private state: PersistedState = initialState()
  private pendingWrite: Promise<void> = Promise.resolve()

  constructor(private readonly directory: string) {
    this.filePath = join(directory, 'state.json')
  }

  async load(): Promise<PersistedState> {
    await mkdir(this.directory, { recursive: true })
    try {
      this.state = sanitizeState(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') throw error
      await this.save()
    }
    return this.snapshot()
  }

  snapshot(): PersistedState {
    const waypoints = emptyRecord<PositionData>()
    const patrolRoutes = emptyRecord<PositionData[]>()
    for (const [name, position] of Object.entries(this.state.waypoints)) waypoints[name] = { ...position }
    for (const [name, points] of Object.entries(this.state.patrolRoutes)) {
      patrolRoutes[name] = points.map((point) => ({ ...point }))
    }
    return {
      waypoints,
      patrolRoutes,
      ...(this.state.lastDeath ? { lastDeath: { ...this.state.lastDeath } } : {}),
      updatedAt: this.state.updatedAt
    }
  }

  getWaypoint(name: string): PositionData | undefined {
    const value = this.state.waypoints[name.toLowerCase()]
    return value ? { ...value } : undefined
  }

  async setWaypoint(name: string, position: PositionData): Promise<void> {
    this.state.waypoints[name.toLowerCase()] = { ...position }
    await this.save()
  }

  async deleteWaypoint(name: string): Promise<boolean> {
    const key = name.toLowerCase()
    const existed = Object.hasOwn(this.state.waypoints, key)
    delete this.state.waypoints[key]
    if (existed) await this.save()
    return existed
  }

  async setPatrolRoute(name: string, points: PositionData[]): Promise<void> {
    this.state.patrolRoutes[name.toLowerCase()] = points.map((point) => ({ ...point }))
    await this.save()
  }

  async deletePatrolRoute(name: string): Promise<boolean> {
    const key = name.toLowerCase()
    const existed = Object.hasOwn(this.state.patrolRoutes, key)
    delete this.state.patrolRoutes[key]
    if (existed) await this.save()
    return existed
  }

  async setLastDeath(position: PositionData): Promise<void> {
    this.state.lastDeath = { ...position }
    await this.save()
  }

  private async save(): Promise<void> {
    this.state.updatedAt = new Date().toISOString()
    const json = `${JSON.stringify(this.state, null, 2)}\n`
    this.pendingWrite = this.pendingWrite.catch(() => undefined).then(async () => {
      await mkdir(this.directory, { recursive: true })
      const tempPath = `${this.filePath}.${process.pid}.tmp`
      await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 })
      await rename(tempPath, this.filePath)
    })
    await this.pendingWrite
  }
}

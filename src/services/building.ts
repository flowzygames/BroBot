import type { Bot } from 'mineflayer'
import { goals } from '../pathfinder.js'
import type { Block } from 'prismarine-block'
import { Vec3 } from 'vec3'
import type { BotRuntime } from '../bot-runtime.js'
import type { TaskContext } from '../task-manager.js'
import { isProtectedBlockName } from '../block-safety.js'

export interface BlockCoordinate {
  x: number
  y: number
  z: number
}

export type BuildKind = 'single' | 'floor' | 'wall' | 'box' | 'custom'
export type BuildAxis = 'x' | 'z'

export interface BuildPlan {
  kind: BuildKind
  material: string
  placements: readonly BlockCoordinate[]
}

export interface PlaceBlockRequest {
  position: BlockCoordinate
  material: string
}

export interface FloorBuildRequest {
  origin: BlockCoordinate
  width: number
  depth: number
  material: string
}

export interface WallBuildRequest {
  origin: BlockCoordinate
  width: number
  height: number
  material: string
  /** The direction in which width grows. Defaults to x. */
  axis?: BuildAxis
}

export interface BoxBuildRequest {
  origin: BlockCoordinate
  width: number
  height: number
  depth: number
  material: string
  /** A hollow box contains only its six boundary faces. Defaults to true. */
  hollow?: boolean
}

export type BuildIssueReason =
  | 'occupied'
  | 'protected'
  | 'unloaded'
  | 'unsupported'
  | 'path_failed'
  | 'material_lost'
  | 'placement_failed'
  | 'verification_failed'

export interface BuildIssue {
  position: BlockCoordinate
  reason: BuildIssueReason
  message: string
}

export interface BuildSummary {
  kind: BuildKind
  material: string
  requested: number
  placed: number
  skipped: number
  failed: number
  issues: BuildIssue[]
}

interface SupportedNeighbor {
  block: Block
  face: Vec3
}

const SUPPORT_DIRECTIONS: ReadonlyArray<readonly [Vec3, Vec3]> = [
  [new Vec3(0, -1, 0), new Vec3(0, 1, 0)],
  [new Vec3(0, 0, -1), new Vec3(0, 0, 1)],
  [new Vec3(0, 0, 1), new Vec3(0, 0, -1)],
  [new Vec3(-1, 0, 0), new Vec3(1, 0, 0)],
  [new Vec3(1, 0, 0), new Vec3(-1, 0, 0)],
  [new Vec3(0, 1, 0), new Vec3(0, -1, 0)]
]

function isAir(block: Block | null): boolean {
  return block !== null && ['air', 'cave_air', 'void_air'].includes(block.name)
}

function normalizeMaterial(material: string): string {
  const normalized = material.trim().toLowerCase().replace(/^minecraft:/u, '')
  if (!/^[a-z0-9_]+$/u.test(normalized)) throw new Error(`Invalid block material: ${material}`)
  return normalized
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Safe, inventory-backed construction with bounded reusable plans. */
export class BuildingService {
  constructor(private readonly runtime: BotRuntime) {}

  planBlock(request: PlaceBlockRequest): BuildPlan {
    return this.createPlan('single', request.material, [request.position])
  }

  planFloor(request: FloorBuildRequest): BuildPlan {
    const origin = this.validateCoordinate(request.origin, 'floor origin')
    const width = this.validateDimension(request.width, 'floor width')
    const depth = this.validateDimension(request.depth, 'floor depth')
    this.assertPlanSize(width * depth)
    const placements: BlockCoordinate[] = []
    for (let z = 0; z < depth; z += 1) {
      for (let x = 0; x < width; x += 1) {
        placements.push(this.offset(origin, x, 0, z))
      }
    }
    return this.createPlan('floor', request.material, placements)
  }

  planWall(request: WallBuildRequest): BuildPlan {
    const origin = this.validateCoordinate(request.origin, 'wall origin')
    const width = this.validateDimension(request.width, 'wall width')
    const height = this.validateDimension(request.height, 'wall height')
    const axis = request.axis ?? 'x'
    if (axis !== 'x' && axis !== 'z') throw new Error('Wall axis must be x or z')
    this.assertPlanSize(width * height)
    const placements: BlockCoordinate[] = []
    for (let y = 0; y < height; y += 1) {
      for (let offset = 0; offset < width; offset += 1) {
        placements.push(this.offset(origin, axis === 'x' ? offset : 0, y, axis === 'z' ? offset : 0))
      }
    }
    return this.createPlan('wall', request.material, placements)
  }

  planBox(request: BoxBuildRequest): BuildPlan {
    const origin = this.validateCoordinate(request.origin, 'box origin')
    const width = this.validateDimension(request.width, 'box width')
    const height = this.validateDimension(request.height, 'box height')
    const depth = this.validateDimension(request.depth, 'box depth')
    const hollow = request.hollow ?? true
    const volume = width * height * depth
    const interior = hollow
      ? Math.max(0, width - 2) * Math.max(0, height - 2) * Math.max(0, depth - 2)
      : 0
    this.assertPlanSize(volume - interior)

    const placements: BlockCoordinate[] = []
    for (let y = 0; y < height; y += 1) {
      for (let z = 0; z < depth; z += 1) {
        for (let x = 0; x < width; x += 1) {
          const boundary = x === 0 || x === width - 1
            || y === 0 || y === height - 1
            || z === 0 || z === depth - 1
          if (!hollow || boundary) placements.push(this.offset(origin, x, y, z))
        }
      }
    }
    return this.createPlan('box', request.material, placements)
  }

  async placeBlock(context: TaskContext, request: PlaceBlockRequest): Promise<BuildSummary> {
    return this.executePlan(context, this.planBlock(request))
  }

  async buildFloor(context: TaskContext, request: FloorBuildRequest): Promise<BuildSummary> {
    return this.executePlan(context, this.planFloor(request))
  }

  async buildWall(context: TaskContext, request: WallBuildRequest): Promise<BuildSummary> {
    return this.executePlan(context, this.planWall(request))
  }

  async buildBox(context: TaskContext, request: BoxBuildRequest): Promise<BuildSummary> {
    return this.executePlan(context, this.planBox(request))
  }

  async executePlan(context: TaskContext, plan: BuildPlan): Promise<BuildSummary> {
    if (!this.runtime.config.safety.allowBuilding) {
      throw new Error('Building is disabled because safety.allowBuilding is false')
    }
    const bot = this.runtime.requireBot()
    const validated = this.validatePlan(plan)
    this.validateMaterial(bot, validated.material)
    this.validateDistances(bot, validated.placements)
    const summary: BuildSummary = {
      kind: validated.kind,
      material: validated.material,
      requested: validated.placements.length,
      placed: 0,
      skipped: 0,
      failed: 0,
      issues: []
    }

    this.assertOperational(context, bot)
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    this.assertOperational(context, bot)

    const pending: BlockCoordinate[] = []
    for (const position of validated.placements) {
      this.assertOperational(context, bot)
      const block = bot.blockAt(this.vector(position))
      if (!block) {
        this.skip(summary, position, 'unloaded', 'The target block is outside the loaded world')
      } else if (!isAir(block)) {
        const protectedTarget = this.isProtected(block.name)
        this.skip(
          summary,
          position,
          protectedTarget ? 'protected' : 'occupied',
          protectedTarget ? `${block.name} is protected by config` : `Target contains ${block.name}`
        )
      } else {
        pending.push(position)
      }
      context.checkpoint()
    }

    const available = this.inventoryCount(bot, validated.material)
    if (available < pending.length) {
      throw new Error(
        `Need ${pending.length} ${validated.material}, but only ${available} are in inventory`
      )
    }

    let remaining = pending
    while (remaining.length > 0) {
      this.assertOperational(context, bot)
      const deferred: BlockCoordinate[] = []
      let supportProgress = false

      for (const position of remaining) {
        this.assertOperational(context, bot)
        const target = this.vector(position)
        const targetBlock = bot.blockAt(target)
        if (!targetBlock) {
          this.skip(summary, position, 'unloaded', 'The target chunk became unavailable')
          context.checkpoint()
          continue
        }
        if (!isAir(targetBlock)) {
          const protectedTarget = this.isProtected(targetBlock.name)
          this.skip(
            summary,
            position,
            protectedTarget ? 'protected' : 'occupied',
            protectedTarget ? `${targetBlock.name} is protected by config` : `Target became ${targetBlock.name}`
          )
          context.checkpoint()
          continue
        }

        const support = this.findSupport(bot, target)
        if (!support) {
          deferred.push(position)
          context.checkpoint()
          continue
        }

        try {
          await this.checked(context, bot, () => bot.pathfinder.goto(
            new goals.GoalNear(target.x, target.y, target.z, 4)
          ))
        } catch (error) {
          this.assertOperational(context, bot)
          this.fail(summary, position, 'path_failed', errorMessage(error))
          continue
        }

        this.assertOperational(context, bot)
        const targetAfterPath = bot.blockAt(target)
        if (!targetAfterPath) {
          this.skip(summary, position, 'unloaded', 'The target chunk became unavailable after pathing')
          context.checkpoint()
          continue
        }
        if (!isAir(targetAfterPath)) {
          const protectedTarget = this.isProtected(targetAfterPath.name)
          this.skip(
            summary,
            position,
            protectedTarget ? 'protected' : 'occupied',
            protectedTarget ? `${targetAfterPath.name} is protected by config` : `Target became ${targetAfterPath.name}`
          )
          context.checkpoint()
          continue
        }
        const currentSupport = this.findSupport(bot, target)
        if (!currentSupport) {
          deferred.push(position)
          context.checkpoint()
          continue
        }

        const item = bot.inventory.items().find((candidate) => candidate.name === validated.material)
        if (!item) {
          this.fail(summary, position, 'material_lost', `No ${validated.material} remains in inventory`)
          context.checkpoint()
          continue
        }

        try {
          const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
          try {
            await this.checked(context, bot, () => bot.equip(item, 'hand'))
            const finalTarget = bot.blockAt(target)
            const finalSupport = this.findSupport(bot, target)
            if (!isAir(finalTarget)) {
              const name = finalTarget?.name ?? 'an unloaded block'
              this.skip(summary, position, this.isProtected(name) ? 'protected' : 'occupied', `Target became ${name}`)
              context.checkpoint()
              continue
            }
            if (!finalSupport) {
              deferred.push(position)
              context.checkpoint()
              continue
            }
            await this.checked(context, bot, () => bot.placeBlock(finalSupport.block, finalSupport.face))
          } finally {
            releaseAutoEat()
          }
        } catch (error) {
          this.assertOperational(context, bot)
          this.fail(summary, position, 'placement_failed', errorMessage(error))
          continue
        }

        const placed = bot.blockAt(target)
        if (!placed || placed.name !== validated.material) {
          this.fail(
            summary,
            position,
            'verification_failed',
            `Expected ${validated.material}, found ${placed?.name ?? 'an unloaded block'}`
          )
          context.checkpoint()
          continue
        }
        summary.placed += 1
        supportProgress = true
        context.checkpoint()
      }

      if (deferred.length > 0 && !supportProgress) {
        for (const position of deferred) {
          this.skip(
            summary,
            position,
            'unsupported',
            'No adjacent unprotected solid block can support this placement'
          )
          context.checkpoint()
        }
        break
      }
      remaining = deferred
    }

    context.checkpoint()
    return summary
  }

  private createPlan(kind: BuildKind, material: string, placements: BlockCoordinate[]): BuildPlan {
    this.assertPlanSize(placements.length)
    const normalized = normalizeMaterial(material)
    return {
      kind,
      material: normalized,
      placements: placements.map((position, index) => this.validateCoordinate(position, `placement ${index + 1}`))
    }
  }

  private validatePlan(plan: BuildPlan): BuildPlan {
    if (!['single', 'floor', 'wall', 'box', 'custom'].includes(plan.kind)) {
      throw new Error(`Unknown build plan kind: ${String(plan.kind)}`)
    }
    this.assertPlanSize(plan.placements.length)
    const placements = plan.placements.map((position, index) =>
      this.validateCoordinate(position, `placement ${index + 1}`)
    )
    const seen = new Set<string>()
    for (const position of placements) {
      const key = `${position.x},${position.y},${position.z}`
      if (seen.has(key)) throw new Error(`Build plan contains duplicate coordinate ${key}`)
      seen.add(key)
    }
    return { kind: plan.kind, material: normalizeMaterial(plan.material), placements }
  }

  private validateMaterial(bot: Bot, material: string): void {
    if (this.isProtected(material)) throw new Error(`${material} is protected by config and cannot be placed`)
    if (!bot.registry.blocksByName[material]) {
      throw new Error(`Unknown block material ${material} in Minecraft ${bot.version}`)
    }
    if (!bot.registry.itemsByName[material]) {
      throw new Error(`${material} does not have a directly placeable inventory item`)
    }
  }

  private validateDistances(bot: Bot, placements: readonly BlockCoordinate[]): void {
    const maximum = this.runtime.config.safety.maxSearchDistance
    const tooFar = placements.find((position) => bot.entity.position.distanceTo(this.vector(position)) > maximum)
    if (tooFar) {
      throw new Error(
        `Build coordinate ${tooFar.x},${tooFar.y},${tooFar.z} exceeds the ${maximum}-block safety distance`
      )
    }
  }

  private validateCoordinate(position: BlockCoordinate, label: string): BlockCoordinate {
    if (![position.x, position.y, position.z].every(Number.isSafeInteger)) {
      throw new Error(`${label} must use whole, safe x/y/z coordinates`)
    }
    return { x: position.x, y: position.y, z: position.z }
  }

  private validateDimension(value: number, label: string): number {
    const maximum = this.runtime.config.safety.maxBuildBlocks
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`${label} must be a whole number between 1 and ${maximum}`)
    }
    return value
  }

  private assertPlanSize(size: number): void {
    const maximum = this.runtime.config.safety.maxBuildBlocks
    if (!Number.isSafeInteger(size) || size < 1 || size > maximum) {
      throw new Error(`Build plan needs 1 to ${maximum} blocks; requested ${size}`)
    }
  }

  private offset(origin: BlockCoordinate, x: number, y: number, z: number): BlockCoordinate {
    return this.validateCoordinate(
      { x: origin.x + x, y: origin.y + y, z: origin.z + z },
      'generated build coordinate'
    )
  }

  private vector(position: BlockCoordinate): Vec3 {
    return new Vec3(position.x, position.y, position.z)
  }

  private findSupport(bot: Bot, target: Vec3): SupportedNeighbor | undefined {
    for (const [offset, face] of SUPPORT_DIRECTIONS) {
      const block = bot.blockAt(target.plus(offset))
      if (!block || isAir(block) || block.boundingBox !== 'block' || this.isProtected(block.name)) continue
      return { block, face }
    }
    return undefined
  }

  private isProtected(name: string): boolean {
    return isProtectedBlockName(name, this.runtime.config.safety.protectedBlocks)
  }

  private inventoryCount(bot: Bot, material: string): number {
    return bot.inventory.items()
      .filter((item) => item.name === material)
      .reduce((total, item) => total + item.count, 0)
  }

  private assertOperational(context: TaskContext, bot: Bot): void {
    context.checkpoint()
    if (!this.runtime.isSpawned || this.runtime.currentBot !== bot) {
      throw new Error('The bot disconnected or reconnected during building')
    }
    if (bot.health <= 6) throw new Error(`Building stopped at ${bot.health.toFixed(1)} health (minimum safe health is 6)`)
  }

  private async checked<T>(context: TaskContext, bot: Bot, action: () => Promise<T>): Promise<T> {
    this.assertOperational(context, bot)
    const result = await action()
    this.assertOperational(context, bot)
    return result
  }

  private skip(
    summary: BuildSummary,
    position: BlockCoordinate,
    reason: BuildIssueReason,
    message: string
  ): void {
    summary.skipped += 1
    summary.issues.push({ position: { ...position }, reason, message })
  }

  private fail(
    summary: BuildSummary,
    position: BlockCoordinate,
    reason: BuildIssueReason,
    message: string
  ): void {
    summary.failed += 1
    summary.issues.push({ position: { ...position }, reason, message })
  }
}

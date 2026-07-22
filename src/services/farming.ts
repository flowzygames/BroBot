import { goals } from '../pathfinder.js'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import type { BotRuntime } from '../bot-runtime.js'
import type { TaskContext } from '../task-manager.js'
import type { PositionData } from '../types.js'
import { isProtectedBlockName } from '../block-safety.js'

export const FARM_CROPS = [
  'wheat',
  'carrots',
  'potatoes',
  'beetroots',
  'nether_wart'
] as const

export type FarmCrop = typeof FARM_CROPS[number]
export type FarmCropFilter = FarmCrop | 'all'

export interface FarmingOptions {
  /** Defaults to the configured farm radius and may not exceed the configured safety bounds. */
  radius?: number
  /** Defaults to every crop supported by the connected Minecraft version. */
  crop?: FarmCropFilter
  /** Maximum crop blocks to inspect. Defaults to safety.maxGatherCount. */
  limit?: number
}

export interface TendFarmingOptions extends FarmingOptions {
  /** Replant harvested crops when the correct seed item is available. Defaults to true. */
  replant?: boolean
}

export interface CropScanEntry {
  crop: FarmCrop
  position: PositionData
  distance: number
  age?: number
  maxAge: number
  mature: boolean
}

export interface CropCounts {
  scanned: number
  mature: number
  immature: number
  unknownAge: number
  harvested: number
  replanted: number
  skipped: number
  failed: number
}

export type CropCountMap = Record<FarmCrop, CropCounts>

export interface FarmScanSummary {
  radius: number
  crop: FarmCropFilter
  scanned: number
  mature: number
  immature: number
  unknownAge: number
  byCrop: CropCountMap
  crops: CropScanEntry[]
}

export type FarmingIssueReason =
  | 'protected'
  | 'crop_changed'
  | 'harvest_failed'
  | 'drop_pickup_failed'
  | 'no_seed'
  | 'blocked'
  | 'unsafe_soil'
  | 'path_failed'
  | 'replant_failed'
  | 'replant_mismatch'

export interface FarmingIssue {
  crop: FarmCrop
  position: PositionData
  reason: FarmingIssueReason
  message: string
}

export interface FarmTendSummary extends FarmScanSummary {
  harvested: number
  replanted: number
  skipped: number
  failed: number
  issues: FarmingIssue[]
}

interface CropDefinition {
  seed: string
  soil: string
  fallbackMaxAge: number
}

const CROP_DEFINITIONS: Record<FarmCrop, CropDefinition> = {
  wheat: { seed: 'wheat_seeds', soil: 'farmland', fallbackMaxAge: 7 },
  carrots: { seed: 'carrot', soil: 'farmland', fallbackMaxAge: 7 },
  potatoes: { seed: 'potato', soil: 'farmland', fallbackMaxAge: 7 },
  beetroots: { seed: 'beetroot_seeds', soil: 'farmland', fallbackMaxAge: 3 },
  nether_wart: { seed: 'nether_wart', soil: 'soul_sand', fallbackMaxAge: 3 }
}

function emptyCounts(): CropCounts {
  return {
    scanned: 0,
    mature: 0,
    immature: 0,
    unknownAge: 0,
    harvested: 0,
    replanted: 0,
    skipped: 0,
    failed: 0
  }
}

function emptyCountMap(): CropCountMap {
  return {
    wheat: emptyCounts(),
    carrots: emptyCounts(),
    potatoes: emptyCounts(),
    beetroots: emptyCounts(),
    nether_wart: emptyCounts()
  }
}

function isFarmCrop(value: string): value is FarmCrop {
  return (FARM_CROPS as readonly string[]).includes(value)
}

function isAir(block: Block | null): boolean {
  return block !== null && ['air', 'cave_air', 'void_air'].includes(block.name)
}

function numberProperty(value: string | number | boolean | undefined): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^\d+$/u.test(value)) return Number(value)
  return undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Version-aware crop harvesting and replanting bounded by the application's safety config. */
export class FarmingService {
  constructor(private readonly runtime: BotRuntime) {}

  scan(options: FarmingOptions = {}): FarmScanSummary {
    const bot = this.runtime.requireBot()
    const radius = this.resolveRadius(options.radius)
    const limit = this.resolveLimit(options.limit)
    const crop = this.resolveCrop(options.crop)
    const requestedCrops = crop === 'all' ? FARM_CROPS : [crop]
    const availableCrops = requestedCrops.filter((name) => Boolean(bot.registry.blocksByName[name]))
    if (availableCrops.length === 0) {
      throw new Error(`Crop ${crop} is not available in Minecraft ${bot.version}`)
    }

    const blockIds = availableCrops.map((name) => bot.registry.blocksByName[name]?.id)
      .filter((id): id is number => id !== undefined)
    const positions = bot.findBlocks({
      matching: blockIds.length === 1 ? blockIds[0]! : blockIds,
      maxDistance: radius,
      count: limit
    })
    const byCrop = emptyCountMap()
    const crops: CropScanEntry[] = []

    for (const position of positions) {
      const block = bot.blockAt(position)
      if (!block || !isFarmCrop(block.name)) continue
      const entry = this.inspectCrop(block)
      if (!entry) continue
      const counts = byCrop[entry.crop]
      counts.scanned += 1
      if (entry.age === undefined) counts.unknownAge += 1
      else if (entry.mature) counts.mature += 1
      else counts.immature += 1
      crops.push({
        ...entry,
        position: this.position(block.position),
        distance: bot.entity.position.distanceTo(block.position)
      })
    }

    crops.sort((a, b) => a.distance - b.distance)
    return {
      radius,
      crop,
      scanned: crops.length,
      mature: crops.filter((entry) => entry.mature).length,
      immature: crops.filter((entry) => entry.age !== undefined && !entry.mature).length,
      unknownAge: crops.filter((entry) => entry.age === undefined).length,
      byCrop,
      crops
    }
  }

  async tend(context: TaskContext, options: TendFarmingOptions = {}): Promise<FarmTendSummary> {
    if (!this.runtime.config.safety.allowDigging) {
      throw new Error('Farming is disabled because safety.allowDigging is false')
    }
    const bot = this.runtime.requireBot()
    const scan = this.scan(options)
    const summary: FarmTendSummary = {
      ...scan,
      harvested: 0,
      replanted: 0,
      skipped: 0,
      failed: 0,
      issues: []
    }
    const replant = options.replant ?? true
    const isProtected = (name: string): boolean => isProtectedBlockName(name, this.runtime.config.safety.protectedBlocks)

    this.assertOperational(context, bot)
    // Farming pathing never digs terrain; the explicit mature crop is broken
    // only after the bot reaches interaction range.
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    this.assertOperational(context, bot)

    for (const scannedCrop of scan.crops.filter((entry) => entry.mature)) {
      this.assertOperational(context, bot)
      const position = new Vec3(scannedCrop.position.x, scannedCrop.position.y, scannedCrop.position.z)
      const current = bot.blockAt(position)
      const currentCrop = current ? this.inspectCrop(current) : undefined

      if (!current || !currentCrop || currentCrop.crop !== scannedCrop.crop || !currentCrop.mature) {
        this.skip(summary, scannedCrop, 'crop_changed', 'The crop changed or is no longer mature')
        context.checkpoint()
        continue
      }
      if (isProtected(current.name)) {
        this.skip(summary, scannedCrop, 'protected', `${current.name} is protected by config`)
        context.checkpoint()
        continue
      }

      let pickupFailure: string | undefined
      try {
        bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
        await this.checked(context, bot, () => bot.pathfinder.goto(
          new goals.GoalLookAtBlock(current.position, bot.world)
        ))
        const harvestTarget = bot.blockAt(position)
        const harvestCrop = harvestTarget ? this.inspectCrop(harvestTarget) : undefined
        if (!harvestTarget || !harvestCrop || harvestCrop.crop !== scannedCrop.crop || !harvestCrop.mature) {
          throw new Error('The crop changed before digging began')
        }
        if (bot.inventory.emptySlotCount() < 1) {
          throw new Error('At least one empty inventory slot is required before harvesting so drops are not stranded')
        }
        if (!this.runtime.isSafeToBreak(harvestTarget, bot)) {
          throw new Error('Refusing to harvest because the crop is protected or digging it would create a world hazard')
        }
        const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
        const abortDig = (): void => bot.stopDigging()
        const drops: Entity[] = []
        const itemDrop = (entity: Entity): void => {
          if (entity.position.distanceTo(position.offset(0.5, 0.5, 0.5)) <= 2) drops.push(entity)
        }
        bot.on('itemDrop', itemDrop)
        context.signal.addEventListener('abort', abortDig, { once: true })
        try {
          await this.checked(context, bot, () => bot.dig(harvestTarget))
          await context.sleep(500)
          bot.off('itemDrop', itemDrop)
          releaseAutoEat()
          for (const entity of drops) {
            if (!entity.isValid) continue
            try {
              await this.collectDrop(context, bot, entity)
            } catch (error) {
              this.assertOperational(context, bot)
              pickupFailure = errorMessage(error)
            }
          }
        } finally {
          bot.off('itemDrop', itemDrop)
          context.signal.removeEventListener('abort', abortDig)
          releaseAutoEat()
        }
      } catch (error) {
        this.assertOperational(context, bot)
        this.fail(summary, scannedCrop, 'harvest_failed', errorMessage(error))
        continue
      }

      const afterHarvest = bot.blockAt(position)
      if (afterHarvest?.name === scannedCrop.crop) {
        this.fail(summary, scannedCrop, 'harvest_failed', 'The crop remained in place after collection')
        context.checkpoint()
        continue
      }
      summary.harvested += 1
      summary.byCrop[scannedCrop.crop].harvested += 1
      if (pickupFailure) this.fail(summary, scannedCrop, 'drop_pickup_failed', pickupFailure)

      if (!replant) {
        context.checkpoint()
        continue
      }

      const definition = CROP_DEFINITIONS[scannedCrop.crop]
      const seed = bot.inventory.items().find((item) => item.name === definition.seed)
      if (!seed) {
        this.skip(summary, scannedCrop, 'no_seed', `No ${definition.seed} is available to replant`)
        context.checkpoint()
        continue
      }

      const target = bot.blockAt(position)
      if (!isAir(target)) {
        this.skip(summary, scannedCrop, 'blocked', 'The harvested crop space is no longer air')
        context.checkpoint()
        continue
      }
      const soil = bot.blockAt(position.offset(0, -1, 0))
      if (!soil || soil.name !== definition.soil || isProtected(soil.name)) {
        this.skip(summary, scannedCrop, 'unsafe_soil', `Expected unprotected ${definition.soil} below the crop`)
        context.checkpoint()
        continue
      }

      try {
        context.checkpoint()
        bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
        context.checkpoint()
        await this.checked(context, bot, () => bot.pathfinder.goto(
          new goals.GoalNear(position.x, position.y, position.z, 4)
        ))
      } catch (error) {
        this.assertOperational(context, bot)
        this.fail(summary, scannedCrop, 'path_failed', errorMessage(error))
        continue
      }

      const targetAfterPath = bot.blockAt(position)
      const soilAfterPath = bot.blockAt(position.offset(0, -1, 0))
      if (!isAir(targetAfterPath)) {
        this.skip(summary, scannedCrop, 'blocked', 'The crop space became occupied before replanting')
        context.checkpoint()
        continue
      }
      if (!soilAfterPath || soilAfterPath.name !== definition.soil || isProtected(soilAfterPath.name)) {
        this.skip(summary, scannedCrop, 'unsafe_soil', 'The supporting soil changed before replanting')
        context.checkpoint()
        continue
      }

      const currentSeed = bot.inventory.items().find((item) => item.name === definition.seed)
      if (!currentSeed) {
        this.skip(summary, scannedCrop, 'no_seed', `No ${definition.seed} remains to replant`)
        context.checkpoint()
        continue
      }

      try {
        const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
        try {
          await this.checked(context, bot, () => bot.equip(currentSeed, 'hand'))
          if (!isAir(bot.blockAt(position))) {
            this.skip(summary, scannedCrop, 'blocked', 'The crop space became occupied before placement')
            context.checkpoint()
            continue
          }
          const finalSoil = bot.blockAt(position.offset(0, -1, 0))
          if (!finalSoil || finalSoil.name !== definition.soil || isProtected(finalSoil.name)) {
            this.skip(summary, scannedCrop, 'unsafe_soil', 'The supporting soil changed before placement')
            context.checkpoint()
            continue
          }
          await this.checked(context, bot, () => bot.placeBlock(finalSoil, new Vec3(0, 1, 0)))
        } finally {
          releaseAutoEat()
        }
      } catch (error) {
        this.assertOperational(context, bot)
        this.fail(summary, scannedCrop, 'replant_failed', errorMessage(error))
        continue
      }

      const replanted = bot.blockAt(position)
      if (!replanted || replanted.name !== scannedCrop.crop) {
        this.fail(summary, scannedCrop, 'replant_mismatch', 'The server did not confirm the expected crop block')
        context.checkpoint()
        continue
      }
      summary.replanted += 1
      summary.byCrop[scannedCrop.crop].replanted += 1
      context.checkpoint()
    }

    return summary
  }

  private resolveRadius(requested: number | undefined): number {
    const maximum = this.runtime.config.safety.maxSearchDistance
    const radius = requested ?? Math.min(this.runtime.config.behavior.farmRadius, maximum)
    if (!Number.isFinite(radius) || radius < 1 || radius > maximum) {
      throw new Error(`Farm radius must be between 1 and ${maximum}`)
    }
    return radius
  }

  private resolveLimit(requested: number | undefined): number {
    const maximum = this.runtime.config.safety.maxGatherCount
    const limit = requested ?? maximum
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
      throw new Error(`Farm limit must be a whole number between 1 and ${maximum}`)
    }
    return limit
  }

  private resolveCrop(requested: FarmCropFilter | undefined): FarmCropFilter {
    const crop = requested ?? 'all'
    if (crop !== 'all' && !isFarmCrop(crop)) {
      throw new Error(`Unknown crop ${String(crop)}; choose ${FARM_CROPS.join(', ')}, or all`)
    }
    return crop
  }

  private inspectCrop(block: Block): Omit<CropScanEntry, 'position' | 'distance'> | undefined {
    if (!isFarmCrop(block.name)) return undefined
    // Block properties are decoded by prismarine-block for the negotiated server version.
    const age = numberProperty(block.getProperties().age)
    const blockDefinition = this.runtime.requireBot().registry.blocksByName[block.name]
    const ageState = blockDefinition?.states?.find((state) => state.name === 'age')
    const stateAges = ageState?.values
      ?.map((value) => numberProperty(typeof value === 'boolean' ? value : String(value)))
      .filter((value): value is number => value !== undefined)
    const maxAge = stateAges && stateAges.length > 0
      ? Math.max(...stateAges)
      : ageState && ageState.num_values > 0
        ? ageState.num_values - 1
        : CROP_DEFINITIONS[block.name].fallbackMaxAge
    return { crop: block.name, age, maxAge, mature: age !== undefined && age >= maxAge }
  }

  private position(position: Vec3): PositionData {
    const bot = this.runtime.requireBot()
    return { x: position.x, y: position.y, z: position.z, dimension: bot.game.dimension }
  }

  private assertOperational(context: TaskContext, bot: ReturnType<BotRuntime['requireBot']>): void {
    context.checkpoint()
    if (!this.runtime.isSpawned || this.runtime.currentBot !== bot) {
      throw new Error('The bot disconnected or reconnected during farming')
    }
    if (bot.health <= 6) throw new Error(`Farming stopped at ${bot.health.toFixed(1)} health (minimum safe health is 6)`)
  }

  private async checked<T>(
    context: TaskContext,
    bot: ReturnType<BotRuntime['requireBot']>,
    action: () => Promise<T>
  ): Promise<T> {
    this.assertOperational(context, bot)
    const result = await action()
    this.assertOperational(context, bot)
    return result
  }

  private async collectDrop(
    context: TaskContext,
    bot: ReturnType<BotRuntime['requireBot']>,
    entity: Entity
  ): Promise<void> {
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    const abort = (): void => bot.pathfinder.stop()
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      if (entity.position.distanceTo(bot.entity.position) > 1.5) {
        await this.checked(context, bot, () => bot.pathfinder.goto(new goals.GoalFollow(entity, 1)))
      }
      const deadline = Date.now() + 5_000
      while (entity.isValid && Date.now() < deadline) {
        this.assertOperational(context, bot)
        if (entity.position.distanceTo(bot.entity.position) > 1.5) {
          await bot.pathfinder.goto(new goals.GoalFollow(entity, 1))
        }
        await context.sleep(50)
      }
      if (entity.isValid) throw new Error('A harvested drop was not picked up within 5 seconds')
    } finally {
      context.signal.removeEventListener('abort', abort)
    }
  }

  private skip(
    summary: FarmTendSummary,
    crop: CropScanEntry,
    reason: FarmingIssueReason,
    message: string
  ): void {
    summary.skipped += 1
    summary.byCrop[crop.crop].skipped += 1
    summary.issues.push({ crop: crop.crop, position: crop.position, reason, message })
  }

  private fail(
    summary: FarmTendSummary,
    crop: CropScanEntry,
    reason: FarmingIssueReason,
    message: string
  ): void {
    summary.failed += 1
    summary.byCrop[crop.crop].failed += 1
    summary.issues.push({ crop: crop.crop, position: crop.position, reason, message })
  }
}

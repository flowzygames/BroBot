import type { Bot, Furnace } from 'mineflayer'
import { goals } from '../pathfinder.js'
import type { Block } from 'prismarine-block'
import type { Entity } from 'prismarine-entity'
import type { Item } from 'prismarine-item'
import type { Recipe } from 'prismarine-recipe'
import type { BotRuntime } from '../bot-runtime.js'
import type { TaskContext } from '../task-manager.js'
import { isProtectedBlockName } from '../block-safety.js'

export interface ResourcePosition {
  x: number
  y: number
  z: number
}

export interface ResourceCount {
  name: string
  displayName: string
  count: number
}

export interface ResourceFailure {
  position: ResourcePosition
  reason: string
}

export interface MineOptions {
  count?: number
  maxDistance?: number
  /** Try the best reachable position when a complete path cannot be found. */
  ignoreNoPath?: boolean
}

export interface MiningSummary {
  mode: 'blocks' | 'vein'
  blockNames: string[]
  requested: number
  maxDistance: number
  found: number
  attempted: number
  mined: number
  failures: ResourceFailure[]
}

export interface VeinMineOptions extends MineOptions {
  /** Maximum gap between connected vein blocks. One means face-adjacent. */
  floodRadius?: number
}

export interface CollectDropsOptions {
  /** Item registry names. Omit to collect every nearby dropped item. */
  itemNames?: string[]
  maxEntities?: number
  maxDistance?: number
  ignoreNoPath?: boolean
}

export interface DropCollectionSummary {
  itemNames?: string[]
  maxDistance: number
  foundEntities: number
  attempted: number
  collectedEntities: number
  items: ResourceCount[]
  failures: ResourceFailure[]
}

export interface RecipeIngredientSummary extends ResourceCount {
  id: number
  metadata: number | null
}

export interface RecipeOptionSummary {
  outputPerCraft: number
  craftsRequired: number
  requiresTable: boolean
  craftableNow: boolean
  ingredients: RecipeIngredientSummary[]
}

export interface RecipeSummary {
  itemName: string
  displayName: string
  requested: number
  hasRecipe: boolean
  craftableNow: boolean
  nearbyCraftingTable: boolean
  options: RecipeOptionSummary[]
}

export interface CraftOptions {
  maxDistance?: number
}

export interface CraftSummary {
  itemName: string
  displayName: string
  requested: number
  crafted: number
  craftsPerformed: number
  outputPerCraft: number
  usedCraftingTable: boolean
}

export interface SmeltOptions {
  fuelName?: string
  maxDistance?: number
  /** Defaults to the normal furnace. Smoker/blast furnace must be requested explicitly. */
  furnaceTypes?: Array<'furnace' | 'blast_furnace' | 'smoker'>
  timeoutMs?: number
}

export interface SmeltSummary {
  inputName: string
  inputCount: number
  fuelName: string
  fuelAdded: number
  outputName?: string
  outputDisplayName?: string
  produced: number
  timedOut: boolean
  furnaceType: string
  furnacePosition: ResourcePosition
}

export interface FishingSummary {
  casts: number
  caught: number
  items: ResourceCount[]
}

export interface ResourcesServiceOptions {
  /** Stop physical work at or below this health value. Defaults to six (three hearts). */
  minimumHealth?: number
}

export interface FishCapableBot {
  fish(): Promise<void>
  /** Calling activateItem while the line is cast reels it back in. */
  activateItem(): void
}

/** Race Mineflayer's potentially unbounded fish promise against cancellation. */
export async function fishWithAbort(bot: FishCapableBot, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    bot.activateItem()
    throw signal.reason instanceof Error ? signal.reason : new Error('Fishing cancelled')
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (action: () => void): void => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', abort)
      action()
    }
    const abort = (): void => {
      try { bot.activateItem() } catch { /* The abort still rejects the task. */ }
      finish(() => reject(signal.reason instanceof Error ? signal.reason : new Error('Fishing cancelled')))
    }
    signal.addEventListener('abort', abort, { once: true })
    // Both handlers stay attached even if the abort wins, so a later rejection
    // from Mineflayer's abandoned promise can never become unhandled.
    void bot.fish().then(
      () => finish(resolve),
      (error: unknown) => finish(() => reject(error))
    )
  })
}

export class ResourceSafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResourceSafetyError'
  }
}

const KNOWN_FUELS: ReadonlyArray<readonly [name: string, smelts: number]> = [
  ['coal', 8],
  ['charcoal', 8],
  ['coal_block', 80],
  ['dried_kelp_block', 20],
  ['blaze_rod', 12],
  ['lava_bucket', 100]
]

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_')
}

function positionOf(blockOrEntity: Block | Entity): ResourcePosition {
  const { x, y, z } = blockOrEntity.position
  return { x, y, z }
}

function closeCurrentWindow(bot: Bot): void {
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
}

function positiveInteger(label: string, value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer`)
  if (value > maximum) throw new Error(`${label} cannot exceed the safety limit of ${maximum}`)
  return value
}

function boundedDistance(label: string, value: number, maximum: number): number {
  if (!Number.isFinite(value) || value < 1) throw new Error(`${label} must be at least 1 block`)
  if (value > maximum) throw new Error(`${label} cannot exceed the safety limit of ${maximum} blocks`)
  return value
}

function inventoryCounts(bot: Bot): Map<string, ResourceCount> {
  const result = new Map<string, ResourceCount>()
  for (const item of bot.inventory.items()) {
    const current = result.get(item.name)
    if (current) current.count += item.count
    else result.set(item.name, { name: item.name, displayName: item.displayName, count: item.count })
  }
  return result
}

function positiveInventoryDelta(before: Map<string, ResourceCount>, after: Map<string, ResourceCount>): ResourceCount[] {
  const result: ResourceCount[] = []
  for (const item of after.values()) {
    const gained = item.count - (before.get(item.name)?.count ?? 0)
    if (gained > 0) result.push({ ...item, count: gained })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}

/** Resource gathering, crafting, furnace, and fishing operations intended for TaskManager workers. */
export class ResourcesService {
  private readonly minimumHealth: number

  constructor(private readonly runtime: BotRuntime, options: ResourcesServiceOptions = {}) {
    const minimumHealth = options.minimumHealth ?? 6
    if (!Number.isFinite(minimumHealth) || minimumHealth < 0 || minimumHealth > 20) {
      throw new Error('minimumHealth must be between 0 and 20')
    }
    this.minimumHealth = minimumHealth
  }

  async mine(context: TaskContext, blockNames: string | string[], options: MineOptions = {}): Promise<MiningSummary> {
    const bot = this.readyBot(context)
    this.requireDiggingAllowed()
    const blocks = this.resolveBlocks(bot, blockNames, true)
    const count = positiveInteger('count', options.count ?? 1, this.runtime.config.safety.maxGatherCount)
    const maxDistance = boundedDistance(
      'maxDistance',
      options.maxDistance ?? this.runtime.config.safety.maxSearchDistance,
      this.runtime.config.safety.maxSearchDistance
    )
    const ids = blocks.map((block) => block.id)
    const positions = bot.findBlocks({ matching: ids, maxDistance, count })
    const targets = positions
      .map((position) => bot.blockAt(position))
      .filter((block): block is Block => block !== null && ids.includes(block.type) && block.diggable)

    return await this.mineTargets(context, bot, 'blocks', blocks.map((block) => block.name), count, maxDistance, targets, options.ignoreNoPath)
  }

  async veinMine(context: TaskContext, blockName: string, options: VeinMineOptions = {}): Promise<MiningSummary> {
    const bot = this.readyBot(context)
    this.requireDiggingAllowed()
    const [blockData] = this.resolveBlocks(bot, blockName, true)
    if (!blockData) throw new Error(`Unknown block: ${blockName}`)
    const count = positiveInteger('count', options.count ?? 32, this.runtime.config.safety.maxGatherCount)
    const maxDistance = boundedDistance(
      'maxDistance',
      options.maxDistance ?? this.runtime.config.safety.maxSearchDistance,
      this.runtime.config.safety.maxSearchDistance
    )
    const floodRadius = positiveInteger('floodRadius', options.floodRadius ?? 1, 3)
    const start = bot.findBlock({ matching: blockData.id, maxDistance })
    const targets = start
      ? this.findVein(bot, start, count, maxDistance, floodRadius)
        .filter((block) => block.type === blockData.id)
        .filter((block) => block.position.distanceTo(bot.entity.position) <= maxDistance)
        .slice(0, count)
      : []

    return await this.mineTargets(context, bot, 'vein', [blockData.name], count, maxDistance, targets, options.ignoreNoPath)
  }

  async collectDrops(context: TaskContext, options: CollectDropsOptions = {}): Promise<DropCollectionSummary> {
    const bot = this.readyBot(context)
    const maxEntities = positiveInteger(
      'maxEntities',
      options.maxEntities ?? this.runtime.config.safety.maxGatherCount,
      this.runtime.config.safety.maxGatherCount
    )
    const maxDistance = boundedDistance(
      'maxDistance',
      options.maxDistance ?? this.runtime.config.safety.maxSearchDistance,
      this.runtime.config.safety.maxSearchDistance
    )
    const names = options.itemNames?.map(normalizeName)
    const allowedIds = names ? new Set(this.resolveItems(bot, names).map((item) => item.id)) : undefined
    const before = inventoryCounts(bot)
    const failures: ResourceFailure[] = []
    let attempted = 0
    let collectedEntities = 0

    const targets = Object.values(bot.entities)
      .map((entity) => ({ entity, item: entity.getDroppedItem() }))
      .filter((entry): entry is { entity: Entity, item: Item } => entry.item !== null)
      .filter(({ entity }) => entity.isValid)
      .filter(({ entity, item }) => entity.position.distanceTo(bot.entity.position) <= maxDistance && (!allowedIds || allowedIds.has(item.type)))
      .sort((a, b) => a.entity.position.distanceTo(bot.entity.position) - b.entity.position.distanceTo(bot.entity.position))
      .slice(0, maxEntities)

    for (const { entity } of targets) {
      this.assertOperational(context, bot)
      attempted += 1
      try {
        await this.collectEntity(context, bot, entity, options.ignoreNoPath)
        collectedEntities += 1
      } catch (error) {
        this.assertOperational(context, bot)
        failures.push({ position: positionOf(entity), reason: errorMessage(error) })
      }
    }

    return {
      ...(names ? { itemNames: names } : {}),
      maxDistance,
      foundEntities: targets.length,
      attempted,
      collectedEntities,
      items: positiveInventoryDelta(before, inventoryCounts(bot)),
      failures
    }
  }

  recipeSummary(itemName: string, count = 1): RecipeSummary {
    const bot = this.runtime.requireBot()
    const item = this.resolveItems(bot, [itemName])[0]
    if (!item) throw new Error(`Unknown item: ${itemName}`)
    const requested = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const tableData = bot.registry.blocksByName.crafting_table
    const nearbyCraftingTable = Boolean(tableData && bot.findBlock({
      matching: tableData.id,
      maxDistance: this.runtime.config.safety.maxSearchDistance
    }))
    const recipes = bot.recipesAll(item.id, null, true)
    const options = recipes.map((recipe) => this.summarizeRecipe(bot, recipe, requested, nearbyCraftingTable))
    return {
      itemName: item.name,
      displayName: item.displayName,
      requested,
      hasRecipe: options.length > 0,
      craftableNow: options.some((option) => option.craftableNow),
      nearbyCraftingTable,
      options
    }
  }

  async craft(context: TaskContext, itemName: string, count = 1, options: CraftOptions = {}): Promise<CraftSummary> {
    const bot = this.readyBot(context)
    const item = this.resolveItems(bot, [itemName])[0]
    if (!item) throw new Error(`Unknown item: ${itemName}`)
    const requested = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const maxDistance = boundedDistance(
      'maxDistance',
      options.maxDistance ?? this.runtime.config.safety.maxSearchDistance,
      this.runtime.config.safety.maxSearchDistance
    )

    let table: Block | undefined
    let recipes = bot.recipesFor(item.id, null, requested, false)
    if (recipes.length === 0) {
      const tableData = bot.registry.blocksByName.crafting_table
      table = tableData ? bot.findBlock({ matching: tableData.id, maxDistance }) ?? undefined : undefined
      if (table) {
        await this.goNear(context, bot, table, 3)
        recipes = bot.recipesFor(item.id, null, requested, table)
      }
    }

    const recipe = recipes[0]
    if (!recipe) {
      const allRecipes = bot.recipesAll(item.id, null, true)
      if (allRecipes.length === 0) throw new Error(`${item.name} has no crafting recipe in Minecraft ${bot.version}`)
      const needsTable = allRecipes.some((candidate) => candidate.requiresTable)
      if (needsTable && !table) throw new Error(`No reachable crafting_table found within ${maxDistance} blocks`)
      throw new Error(`Not enough ingredients to craft ${requested} ${item.name}`)
    }

    const craftsRequired = Math.ceil(requested / recipe.result.count)
    const plannedOutput = craftsRequired * recipe.result.count
    if (plannedOutput > this.runtime.config.safety.maxGatherCount) {
      throw new ResourceSafetyError(
        `Recipe batches would produce ${plannedOutput} ${item.name}, above the safety limit of ${this.runtime.config.safety.maxGatherCount}`
      )
    }
    const before = bot.inventory.count(item.id, null)
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    const abort = (): void => {
      bot.pathfinder.stop()
      closeCurrentWindow(bot)
    }
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      for (let craftNumber = 0; craftNumber < craftsRequired; craftNumber += 1) {
        this.assertOperational(context, bot)
        await bot.craft(recipe, 1, recipe.requiresTable ? table : undefined)
        context.checkpoint()
      }
    } finally {
      context.signal.removeEventListener('abort', abort)
      try { closeCurrentWindow(bot) } finally { releaseAutoEat() }
    }

    return {
      itemName: item.name,
      displayName: item.displayName,
      requested,
      crafted: Math.max(0, bot.inventory.count(item.id, null) - before),
      craftsPerformed: craftsRequired,
      outputPerCraft: recipe.result.count,
      usedCraftingTable: recipe.requiresTable
    }
  }

  async smelt(context: TaskContext, inputName: string, count = 1, options: SmeltOptions = {}): Promise<SmeltSummary> {
    const bot = this.readyBot(context)
    const input = this.resolveItems(bot, [inputName])[0]
    if (!input) throw new Error(`Unknown item: ${inputName}`)
    const inputCount = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    if (bot.inventory.count(input.id, null) < inputCount) {
      throw new Error(`Need ${inputCount} ${input.name}, but only ${bot.inventory.count(input.id, null)} are in inventory`)
    }
    if (bot.inventory.emptySlotCount() < 1) throw new Error('At least one empty inventory slot is required for furnace output')

    const maxDistance = boundedDistance(
      'maxDistance',
      options.maxDistance ?? this.runtime.config.safety.maxSearchDistance,
      this.runtime.config.safety.maxSearchDistance
    )
    const furnaceTypes = options.furnaceTypes ?? ['furnace']
    if (furnaceTypes.length === 0) throw new Error('At least one furnace type is required')
    const validFurnaceTypes = new Set(['furnace', 'blast_furnace', 'smoker'])
    for (const name of furnaceTypes) {
      if (!validFurnaceTypes.has(name)) throw new Error(`Unsupported furnace type: ${name}`)
    }
    const furnaceBlocks = furnaceTypes.map((name) => bot.registry.blocksByName[name]).filter((block) => block !== undefined)
    if (furnaceBlocks.length === 0) throw new Error(`Minecraft ${bot.version} has none of the requested furnace types`)
    const furnaceBlock = bot.findBlock({ matching: furnaceBlocks.map((block) => block.id), maxDistance })
    if (!furnaceBlock) throw new Error(`No requested furnace found within ${maxDistance} blocks`)

    const [fuelName, smeltsPerFuel] = this.chooseFuel(bot, inputCount, options.fuelName)
    const fuel = this.resolveItems(bot, [fuelName])[0]
    if (!fuel) throw new Error(`Unknown fuel item: ${fuelName}`)
    const fuelNeeded = Math.ceil(inputCount / smeltsPerFuel)
    if (bot.inventory.count(fuel.id, null) < fuelNeeded) {
      throw new Error(`Need ${fuelNeeded} ${fuel.name} to smelt ${inputCount} items`)
    }

    const maximumTimeout = this.runtime.config.safety.maxTaskSeconds * 1_000
    const timeoutMs = Math.min(
      options.timeoutMs === undefined
        ? Math.max(15_000, inputCount * 12_000 + 5_000)
        : positiveInteger('timeoutMs', options.timeoutMs, maximumTimeout),
      maximumTimeout
    )

    await this.goNear(context, bot, furnaceBlock, 3)
    this.assertOperational(context, bot)
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    let furnace: Furnace | undefined
    let fuelAdded = 0
    let produced = 0
    let outputName: string | undefined
    let outputDisplayName: string | undefined
    const startedAt = Date.now()
    const abort = (): void => {
      if (furnace) furnace.close()
      else closeCurrentWindow(bot)
    }
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      closeCurrentWindow(bot)
      furnace = await bot.openFurnace(furnaceBlock)
      context.checkpoint()
      const existingInput = furnace.inputItem() as Item | null
      const existingOutput = furnace.outputItem() as Item | null
      const existingFuel = furnace.fuelItem() as Item | null
      if (existingInput) throw new Error(`Furnace already contains input (${existingInput.name}); refusing to mix jobs`)
      if (existingOutput) throw new Error(`Furnace already contains output (${existingOutput.name}); empty it first`)
      if (existingFuel && existingFuel.type !== fuel.id) {
        throw new Error(`Furnace contains ${existingFuel.name}; requested fuel is ${fuel.name}`)
      }

      await furnace.putInput(input.id, null, inputCount)
      context.checkpoint()
      const fuelAlreadyPresent = existingFuel?.count ?? 0
      fuelAdded = Math.max(0, fuelNeeded - fuelAlreadyPresent)
      if (fuelAdded > 0) await furnace.putFuel(fuel.id, null, fuelAdded)
      context.checkpoint()

      while (produced < inputCount && Date.now() - startedAt < timeoutMs) {
        this.assertOperational(context, bot)
        const output = furnace.outputItem() as Item | null
        if (output) {
          if (outputName && output.name !== outputName) throw new Error('Furnace output changed unexpectedly during the job')
          outputName = output.name
          outputDisplayName = output.displayName
          const taken = await furnace.takeOutput()
          produced += taken.count
          context.checkpoint()
          continue
        }
        await context.sleep(500)
      }

      return {
        inputName: input.name,
        inputCount,
        fuelName: fuel.name,
        fuelAdded,
        ...(outputName ? { outputName, outputDisplayName } : {}),
        produced,
        timedOut: produced < inputCount,
        furnaceType: furnaceBlock.name,
        furnacePosition: positionOf(furnaceBlock)
      }
    } finally {
      context.signal.removeEventListener('abort', abort)
      try {
        if (furnace && bot.currentWindow === furnace) furnace.close()
        else closeCurrentWindow(bot)
      } finally {
        releaseAutoEat()
      }
    }
  }

  async fish(context: TaskContext, count = 1): Promise<FishingSummary> {
    const bot = this.readyBot(context)
    const casts = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const rodData = bot.registry.itemsByName.fishing_rod
    const rod = rodData ? bot.inventory.items().find((item) => item.type === rodData.id) : undefined
    if (!rod) throw new Error('A fishing_rod is required')
    const before = inventoryCounts(bot)
    let caught = 0
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    try {
      await bot.equip(rod, 'hand')
      context.checkpoint()
      for (let cast = 0; cast < casts; cast += 1) {
        this.assertOperational(context, bot)
        await fishWithAbort(bot, context.signal)
        context.checkpoint()
        caught += 1
      }
    } finally {
      try { bot.deactivateItem() } finally { releaseAutoEat() }
    }
    return { casts, caught, items: positiveInventoryDelta(before, inventoryCounts(bot)) }
  }

  private readyBot(context: TaskContext): Bot {
    context.checkpoint()
    const bot = this.runtime.requireBot()
    this.assertOperational(context, bot)
    return bot
  }

  private assertOperational(context: TaskContext, bot: Bot): void {
    context.checkpoint()
    if (!this.runtime.isSpawned || this.runtime.currentBot !== bot) throw new Error('The bot disconnected during the task')
    if (bot.health <= this.minimumHealth) {
      throw new ResourceSafetyError(`Stopped at ${bot.health.toFixed(1)} health (minimum safe health is ${this.minimumHealth})`)
    }
  }

  private requireDiggingAllowed(): void {
    if (!this.runtime.config.safety.allowDigging) throw new ResourceSafetyError('Digging is disabled by safety.allowDigging')
  }

  private isProtected(name: string): boolean {
    return isProtectedBlockName(name, this.runtime.config.safety.protectedBlocks)
  }

  private resolveBlocks(bot: Bot, names: string | string[], rejectProtected: boolean): Array<{ id: number, name: string, displayName: string }> {
    const requested = [...new Set((Array.isArray(names) ? names : [names]).map(normalizeName).filter(Boolean))]
    if (requested.length === 0) throw new Error('At least one block name is required')
    return requested.map((name) => {
      const block = bot.registry.blocksByName[name]
      if (!block) throw new Error(`Unknown block registry name: ${name}`)
      if (rejectProtected && this.isProtected(name)) throw new ResourceSafetyError(`${name} is protected by safety.protectedBlocks`)
      if (!block.diggable) throw new ResourceSafetyError(`${name} is not diggable`)
      return block
    })
  }

  private resolveItems(bot: Bot, names: string[]): Array<{ id: number, name: string, displayName: string }> {
    return names.map(normalizeName).map((name) => {
      const item = bot.registry.itemsByName[name]
      if (!item) throw new Error(`Unknown item registry name: ${name}`)
      return item
    })
  }

  private async mineTargets(
    context: TaskContext,
    bot: Bot,
    mode: MiningSummary['mode'],
    blockNames: string[],
    requested: number,
    maxDistance: number,
    targets: Block[],
    ignoreNoPath = false
  ): Promise<MiningSummary> {
    const failures: ResourceFailure[] = []
    let attempted = 0
    let mined = 0
    const allowedNames = new Set(blockNames)
    for (const target of targets.slice(0, requested)) {
      this.assertOperational(context, bot)
      const current = bot.blockAt(target.position)
      if (!current || !allowedNames.has(current.name)) {
        failures.push({ position: positionOf(target), reason: 'Block changed before it could be mined' })
        continue
      }
      if (this.isProtected(current.name)) throw new ResourceSafetyError(`${current.name} is protected by safety.protectedBlocks`)
      attempted += 1
      try {
        await this.mineBlock(context, bot, current, ignoreNoPath)
        const after = bot.blockAt(current.position)
        if (!after || after.type !== current.type) mined += 1
        else failures.push({ position: positionOf(current), reason: 'Block could not be harvested with the available tools' })
      } catch (error) {
        this.assertOperational(context, bot)
        const after = bot.blockAt(current.position)
        if (!after || after.type !== current.type) {
          mined += 1
          failures.push({ position: positionOf(current), reason: `Block mined, but cleanup was incomplete: ${errorMessage(error)}` })
        } else {
          failures.push({ position: positionOf(current), reason: errorMessage(error) })
        }
      }
    }
    return { mode, blockNames, requested, maxDistance, found: targets.length, attempted, mined, failures }
  }

  private async mineBlock(
    context: TaskContext,
    bot: Bot,
    target: Block,
    ignoreNoPath = false
  ): Promise<void> {
    this.assertOperational(context, bot)
    let releaseAutoEat: (() => void) | undefined
    let listeningForDrops = false
    const dropped: Entity[] = []
    const itemDrop = (entity: Entity): void => {
      if (entity.position.distanceTo(target.position.offset(0.5, 0.5, 0.5)) <= 2) dropped.push(entity)
    }
    const abort = (): void => {
      bot.pathfinder.stop()
      bot.stopDigging()
    }
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
      if (!bot.canDigBlock(target)) {
        try {
          await bot.pathfinder.goto(new goals.GoalLookAtBlock(target.position, bot.world))
        } catch (error) {
          if (!ignoreNoPath || !bot.canDigBlock(target)) throw error
        }
      }
      this.assertOperational(context, bot)
      const current = bot.blockAt(target.position)
      if (!current || current.type !== target.type) throw new Error('Block changed before digging began')
      if (this.isProtected(current.name)) throw new ResourceSafetyError(`${current.name} is protected by safety.protectedBlocks`)
      if (bot.inventory.emptySlotCount() < 1) {
        throw new ResourceSafetyError('At least one empty inventory slot is required before mining so drops are not stranded')
      }
      if (!this.runtime.isSafeToBreak(current, bot)) {
        throw new ResourceSafetyError(`Refusing to mine ${current.name}: it is protected, supports a falling block/entity, or would open liquid flow`)
      }
      releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
      await bot.tool.equipForBlock(current, { requireHarvest: true, getFromChest: false })
      this.assertOperational(context, bot)
      bot.on('itemDrop', itemDrop)
      listeningForDrops = true
      try {
        await bot.dig(current)
        this.assertOperational(context, bot)
        // Give the server a bounded window to announce harvested entities.
        await context.sleep(500)
      } finally {
        bot.off('itemDrop', itemDrop)
        listeningForDrops = false
      }
      releaseAutoEat()
      releaseAutoEat = undefined
      // Collect only drops observed beside this exact block.
      for (const entity of dropped) {
        if (entity.isValid) await this.collectEntity(context, bot, entity)
      }
    } finally {
      if (listeningForDrops) bot.off('itemDrop', itemDrop)
      context.signal.removeEventListener('abort', abort)
      releaseAutoEat?.()
    }
  }

  private async collectEntity(
    context: TaskContext,
    bot: Bot,
    entity: Entity,
    ignoreNoPath = false
  ): Promise<void> {
    this.assertOperational(context, bot)
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    const abort = (): void => bot.pathfinder.stop()
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      if (!entity.isValid) return
      if (entity.position.distanceTo(bot.entity.position) > 1.5) {
        try {
          await bot.pathfinder.goto(new goals.GoalFollow(entity, 1))
        } catch (error) {
          if (!ignoreNoPath || entity.position.distanceTo(bot.entity.position) > 2) throw error
        }
      }
      const deadline = Date.now() + 5_000
      while (entity.isValid && Date.now() < deadline) {
        this.assertOperational(context, bot)
        if (entity.position.distanceTo(bot.entity.position) > 1.5) {
          await bot.pathfinder.goto(new goals.GoalFollow(entity, 1))
        }
        await context.sleep(50)
      }
      if (entity.isValid) throw new Error('Dropped item was not picked up within 5 seconds')
      this.assertOperational(context, bot)
    } finally {
      context.signal.removeEventListener('abort', abort)
    }
  }

  private findVein(
    bot: Bot,
    start: Block,
    maximum: number,
    maxDistance: number,
    floodRadius: number
  ): Block[] {
    const result: Block[] = []
    const open: Block[] = [start]
    const queued = new Set([`${start.position.x},${start.position.y},${start.position.z}`])
    while (open.length > 0 && result.length < maximum) {
      const next = open.pop()
      if (!next || next.type !== start.type) continue
      result.push(next)
      for (let x = -floodRadius; x <= floodRadius; x += 1) {
        for (let y = -floodRadius; y <= floodRadius; y += 1) {
          for (let z = -floodRadius; z <= floodRadius; z += 1) {
            if (x === 0 && y === 0 && z === 0) continue
            const position = next.position.offset(x, y, z)
            if (position.manhattanDistanceTo(start.position) > maxDistance) continue
            const key = `${position.x},${position.y},${position.z}`
            if (queued.has(key)) continue
            queued.add(key)
            const neighbor = bot.blockAt(position)
            if (neighbor?.type === start.type) open.push(neighbor)
          }
        }
      }
    }
    return result
  }

  private async goNear(context: TaskContext, bot: Bot, target: Block, range: number): Promise<void> {
    this.assertOperational(context, bot)
    if (target.position.distanceTo(bot.entity.position) <= range) return
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    const abort = (): void => bot.pathfinder.stop()
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      await bot.pathfinder.goto(new goals.GoalNear(target.position.x, target.position.y, target.position.z, range))
      this.assertOperational(context, bot)
    } finally {
      context.signal.removeEventListener('abort', abort)
    }
  }

  private summarizeRecipe(bot: Bot, recipe: Recipe, requested: number, nearbyCraftingTable: boolean): RecipeOptionSummary {
    const craftsRequired = Math.ceil(requested / recipe.result.count)
    const ingredients = recipe.delta
      .filter((entry) => entry.count < 0)
      .map((entry) => {
        const data = bot.registry.items[entry.id]
        return {
          id: entry.id,
          metadata: entry.metadata,
          name: data?.name ?? `item_${entry.id}`,
          displayName: data?.displayName ?? `Item ${entry.id}`,
          count: -entry.count * craftsRequired
        }
      })
    const hasIngredients = recipe.delta.every((entry) => (
      bot.inventory.count(entry.id, entry.metadata) + entry.count * craftsRequired >= 0
    ))
    return {
      outputPerCraft: recipe.result.count,
      craftsRequired,
      requiresTable: recipe.requiresTable,
      craftableNow: hasIngredients && (!recipe.requiresTable || nearbyCraftingTable),
      ingredients
    }
  }

  private chooseFuel(bot: Bot, inputCount: number, requestedName?: string): readonly [string, number] {
    if (requestedName) {
      const normalized = normalizeName(requestedName)
      const match = KNOWN_FUELS.find(([name]) => name === normalized)
      if (!match) throw new Error(`${normalized} is not in the conservative supported-fuel list`)
      this.resolveItems(bot, [normalized])
      return match
    }
    for (const candidate of KNOWN_FUELS) {
      const data = bot.registry.itemsByName[candidate[0]]
      if (data && bot.inventory.count(data.id, null) >= Math.ceil(inputCount / candidate[1])) return candidate
    }
    throw new Error('No supported furnace fuel is available (coal, charcoal, coal_block, dried_kelp_block, blaze_rod, or lava_bucket)')
  }
}

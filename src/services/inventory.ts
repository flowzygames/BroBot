import type { Bot, Chest, Dispenser, EquipmentDestination } from 'mineflayer'
import { goals } from '../pathfinder.js'
import type { Block } from 'prismarine-block'
import type { Item } from 'prismarine-item'
import type { BotRuntime } from '../bot-runtime.js'
import type { TaskContext } from '../task-manager.js'
import type { InventoryLine } from '../types.js'
import { ALWAYS_CONSUMABLE_FOOD_SET, UNSAFE_FOOD_SET } from '../food-safety.js'

export interface InventorySummary {
  items: InventoryLine[]
  totalItems: number
  occupiedSlots: number
  emptySlots: number
}

export interface EquipmentSummary {
  itemName: string
  displayName: string
  destination: EquipmentDestination
}

export interface EatSummary {
  itemName: string
  displayName: string
  consumed: number
  foodBefore: number
  foodAfter: number
  healthBefore: number
  healthAfter: number
}

export interface DropSummary {
  itemName: string
  displayName: string
  requested: number
  dropped: number
}

export interface GiveOptions {
  distance?: number
}

export interface GiveSummary extends DropSummary {
  playerName: string
}

export interface ContainerPosition {
  x: number
  y: number
  z: number
}

export interface ContainerOptions {
  maxDistance?: number
  /** Defaults to chests, barrels, ender chests, and all shulker-box colors. */
  containerTypes?: string[]
}

export interface ContainerSummary {
  blockName: string
  title: string
  position: ContainerPosition
  items: InventoryLine[]
  totalItems: number
  occupiedSlots: number
  emptySlots: number
}

export interface ContainerTransferSummary {
  direction: 'deposit' | 'withdraw'
  itemName: string
  displayName: string
  requested: number
  moved: number
  containerBlock: string
  containerPosition: ContainerPosition
}

export interface InventoryServiceOptions {
  /** Stop non-recovery physical work at or below this health value. Defaults to six. */
  minimumHealth?: number
}

export class InventorySafetyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InventorySafetyError'
  }
}

type ContainerWindow = Chest | Dispenser

const EQUIPMENT_DESTINATIONS = new Set<EquipmentDestination>([
  'hand', 'head', 'torso', 'legs', 'feet', 'off-hand'
])

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/^minecraft:/, '').replace(/[\s-]+/g, '_')
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

function positionOf(block: Block): ContainerPosition {
  const { x, y, z } = block.position
  return { x, y, z }
}

function closeCurrentWindow(bot: Bot): void {
  if (bot.currentWindow) bot.closeWindow(bot.currentWindow)
}

function groupItems(items: Item[]): InventoryLine[] {
  const grouped = new Map<string, InventoryLine>()
  for (const item of items) {
    const current = grouped.get(item.name)
    if (current) {
      current.count += item.count
      current.slots.push(item.slot)
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

function isContainerName(name: string): boolean {
  return name === 'chest' || name === 'trapped_chest' || name === 'barrel' || name === 'ender_chest' ||
    name === 'shulker_box' || name.endsWith('_shulker_box')
}

/** Inventory and nearby-container operations intended for direct command registration. */
export class InventoryService {
  private readonly minimumHealth: number

  constructor(private readonly runtime: BotRuntime, options: InventoryServiceOptions = {}) {
    const minimumHealth = options.minimumHealth ?? 6
    if (!Number.isFinite(minimumHealth) || minimumHealth < 0 || minimumHealth > 20) {
      throw new Error('minimumHealth must be between 0 and 20')
    }
    this.minimumHealth = minimumHealth
  }

  /** A grouped, stable-name inventory listing suitable for chat or dashboard formatting. */
  list(): InventoryLine[] {
    return groupItems(this.runtime.requireBot().inventory.items())
  }

  summary(): InventorySummary {
    const bot = this.runtime.requireBot()
    const items = this.list()
    return {
      items,
      totalItems: items.reduce((total, item) => total + item.count, 0),
      occupiedSlots: bot.inventory.items().length,
      emptySlots: bot.inventory.emptySlotCount()
    }
  }

  count(itemName: string): number {
    const bot = this.runtime.requireBot()
    const data = this.resolveItemData(bot, itemName)
    return bot.inventory.count(data.id, null)
  }

  async hold(context: TaskContext, itemName: string): Promise<EquipmentSummary> {
    return await this.equip(context, itemName, 'hand')
  }

  async equip(
    context: TaskContext,
    itemName: string,
    destination?: EquipmentDestination
  ): Promise<EquipmentSummary> {
    const bot = this.readyBot(context)
    const item = this.inventoryItem(bot, itemName)
    const resolvedDestination = destination ?? this.inferDestination(item.name)
    if (!EQUIPMENT_DESTINATIONS.has(resolvedDestination)) {
      throw new Error(`Unsupported equipment destination: ${resolvedDestination}`)
    }
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    try {
      await bot.equip(item, resolvedDestination)
      this.assertOperational(context, bot)
    } finally {
      releaseAutoEat()
    }
    return { itemName: item.name, displayName: item.displayName, destination: resolvedDestination }
  }

  async eat(context: TaskContext, itemName?: string): Promise<EatSummary> {
    // Eating is a recovery action, so it remains available below minimumHealth.
    const bot = this.readyBot(context, false)
    const item = itemName ? this.inventoryItem(bot, itemName) : this.bestFood(bot)
    const food = bot.registry.foodsByName[item.name]
    if (!food) throw new Error(`${item.name} is not edible`)
    if (UNSAFE_FOOD_SET.has(item.name)) throw new InventorySafetyError(`${item.name} is excluded from manual eating for safety`)
    if (bot.food >= 20 && !ALWAYS_CONSUMABLE_FOOD_SET.has(item.name)) throw new Error('Hunger is already full')
    const countBefore = bot.inventory.count(item.type, item.metadata)
    const foodBefore = bot.food
    const healthBefore = bot.health
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    const abort = (): void => bot.deactivateItem()
    try {
      await bot.equip(item, 'hand')
      context.checkpoint()
      context.signal.addEventListener('abort', abort, { once: true })
      await bot.consume()
      context.checkpoint()
    } finally {
      context.signal.removeEventListener('abort', abort)
      try { bot.deactivateItem() } finally { releaseAutoEat() }
    }
    return {
      itemName: item.name,
      displayName: item.displayName,
      consumed: Math.max(0, countBefore - bot.inventory.count(item.type, item.metadata)),
      foodBefore,
      foodAfter: bot.food,
      healthBefore,
      healthAfter: bot.health
    }
  }

  async drop(context: TaskContext, itemName: string, count = 1): Promise<DropSummary> {
    const bot = this.readyBot(context)
    const data = this.resolveItemData(bot, itemName)
    const requested = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const available = bot.inventory.count(data.id, null)
    if (available < requested) throw new Error(`Need ${requested} ${data.name}, but only ${available} are in inventory`)
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    try {
      await bot.toss(data.id, null, requested)
      this.assertOperational(context, bot)
    } finally {
      releaseAutoEat()
    }
    return { itemName: data.name, displayName: data.displayName, requested, dropped: requested }
  }

  async give(
    context: TaskContext,
    playerName: string,
    itemName: string,
    count = 1,
    options: GiveOptions = {}
  ): Promise<GiveSummary> {
    const bot = this.readyBot(context)
    const data = this.resolveItemData(bot, itemName)
    const requested = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const available = bot.inventory.count(data.id, null)
    if (available < requested) throw new Error(`Need ${requested} ${data.name}, but only ${available} are in inventory`)
    const player = Object.values(bot.players).find((candidate) => candidate.username.toLowerCase() === playerName.trim().toLowerCase())
    if (!player?.entity || !player.entity.isValid) throw new Error(`Player ${playerName} is not visible nearby`)
    if (player.username === bot.username) throw new Error('The bot cannot give an item to itself')
    const distance = boundedDistance('distance', options.distance ?? 2, 6)
    await this.goToPlayer(context, bot, player.entity, distance)
    this.assertOperational(context, bot)
    if (!player.entity.isValid || player.entity.position.distanceTo(bot.entity.position) > distance + 2) {
      throw new Error(`${player.username} moved out of giving range`)
    }
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    try {
      await bot.lookAt(player.entity.position.offset(0, Math.max(0.5, player.entity.height * 0.6), 0), true)
      context.checkpoint()
      await bot.toss(data.id, null, requested)
      this.assertOperational(context, bot)
    } finally {
      releaseAutoEat()
    }
    return {
      playerName: player.username,
      itemName: data.name,
      displayName: data.displayName,
      requested,
      dropped: requested
    }
  }

  async inspectNearestContainer(context: TaskContext, options: ContainerOptions = {}): Promise<ContainerSummary> {
    return await this.withNearestContainer(context, options, async (bot, container, block) => {
      this.assertOperational(context, bot)
      const items = groupItems(container.containerItems())
      const occupiedSlots = container.containerItems().length
      return {
        blockName: block.name,
        title: container.title,
        position: positionOf(block),
        items,
        totalItems: items.reduce((total, item) => total + item.count, 0),
        occupiedSlots,
        emptySlots: container.inventoryStart - occupiedSlots
      }
    })
  }

  async deposit(
    context: TaskContext,
    itemName: string,
    count = 1,
    options: ContainerOptions = {}
  ): Promise<ContainerTransferSummary> {
    const bot = this.readyBot(context)
    const data = this.resolveItemData(bot, itemName)
    const requested = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const before = bot.inventory.count(data.id, null)
    if (before < requested) throw new Error(`Need ${requested} ${data.name}, but only ${before} are in inventory`)
    return await this.withNearestContainer(context, options, async (activeBot, container, block) => {
      this.assertOperational(context, activeBot)
      await container.deposit(data.id, null, requested)
      this.assertOperational(context, activeBot)
      return {
        direction: 'deposit',
        itemName: data.name,
        displayName: data.displayName,
        requested,
        moved: Math.max(0, before - activeBot.inventory.count(data.id, null)),
        containerBlock: block.name,
        containerPosition: positionOf(block)
      }
    })
  }

  async withdraw(
    context: TaskContext,
    itemName: string,
    count = 1,
    options: ContainerOptions = {}
  ): Promise<ContainerTransferSummary> {
    const bot = this.readyBot(context)
    const data = this.resolveItemData(bot, itemName)
    const requested = positiveInteger('count', count, this.runtime.config.safety.maxGatherCount)
    const before = bot.inventory.count(data.id, null)
    return await this.withNearestContainer(context, options, async (activeBot, container, block) => {
      this.assertOperational(context, activeBot)
      const available = container.containerCount(data.id, null)
      if (available < requested) throw new Error(`Container has ${available} ${data.name}; ${requested} requested`)
      await container.withdraw(data.id, null, requested)
      this.assertOperational(context, activeBot)
      return {
        direction: 'withdraw',
        itemName: data.name,
        displayName: data.displayName,
        requested,
        moved: Math.max(0, activeBot.inventory.count(data.id, null) - before),
        containerBlock: block.name,
        containerPosition: positionOf(block)
      }
    })
  }

  private readyBot(context: TaskContext, requireSafeHealth = true): Bot {
    context.checkpoint()
    const bot = this.runtime.requireBot()
    this.assertOperational(context, bot, requireSafeHealth)
    return bot
  }

  private assertOperational(context: TaskContext, bot: Bot, requireSafeHealth = true): void {
    context.checkpoint()
    if (!this.runtime.isSpawned || this.runtime.currentBot !== bot) throw new Error('The bot disconnected during the task')
    if (requireSafeHealth && bot.health <= this.minimumHealth) {
      throw new InventorySafetyError(`Stopped at ${bot.health.toFixed(1)} health (minimum safe health is ${this.minimumHealth})`)
    }
  }

  private resolveItemData(bot: Bot, itemName: string): { id: number, name: string, displayName: string } {
    const normalized = normalizeName(itemName)
    if (!normalized) throw new Error('An item name is required')
    const data = bot.registry.itemsByName[normalized]
    if (!data) throw new Error(`Unknown item registry name: ${normalized}`)
    return data
  }

  private inventoryItem(bot: Bot, itemName: string): Item {
    const data = this.resolveItemData(bot, itemName)
    const item = bot.inventory.items().find((candidate) => candidate.type === data.id)
    if (!item) throw new Error(`${data.name} is not in inventory`)
    return item
  }

  private inferDestination(itemName: string): EquipmentDestination {
    if (itemName.endsWith('_helmet') || itemName === 'turtle_helmet' || itemName === 'carved_pumpkin') return 'head'
    if (itemName.endsWith('_chestplate') || itemName === 'elytra') return 'torso'
    if (itemName.endsWith('_leggings')) return 'legs'
    if (itemName.endsWith('_boots')) return 'feet'
    if (itemName === 'shield') return 'off-hand'
    return 'hand'
  }

  private bestFood(bot: Bot): Item {
    const food = bot.inventory.items()
      .filter((item) => bot.registry.foodsByName[item.name] !== undefined && !UNSAFE_FOOD_SET.has(item.name))
      .sort((a, b) => {
        const aFood = bot.registry.foodsByName[a.name]
        const bFood = bot.registry.foodsByName[b.name]
        return (bFood?.effectiveQuality ?? 0) - (aFood?.effectiveQuality ?? 0)
      })[0]
    if (!food) throw new Error('No safe food is available in inventory')
    return food
  }

  private containerBlockNames(bot: Bot, requested?: string[]): string[] {
    const names = requested?.map(normalizeName) ?? Object.keys(bot.registry.blocksByName).filter(isContainerName)
    const unique = [...new Set(names)]
    if (unique.length === 0) throw new Error('At least one container type is required')
    for (const name of unique) {
      if (!isContainerName(name)) throw new Error(`${name} is not a supported container block`)
      if (!bot.registry.blocksByName[name]) throw new Error(`Unknown container block registry name: ${name}`)
    }
    return unique
  }

  private async withNearestContainer<T>(
    context: TaskContext,
    options: ContainerOptions,
    worker: (bot: Bot, container: ContainerWindow, block: Block) => Promise<T>
  ): Promise<T> {
    const bot = this.readyBot(context)
    const maxDistance = boundedDistance(
      'maxDistance',
      options.maxDistance ?? this.runtime.config.safety.maxSearchDistance,
      this.runtime.config.safety.maxSearchDistance
    )
    const names = this.containerBlockNames(bot, options.containerTypes)
    const ids = names.map((name) => bot.registry.blocksByName[name]?.id).filter((id): id is number => id !== undefined)
    const block = bot.findBlock({ matching: ids, maxDistance })
    if (!block) throw new Error(`No requested container found within ${maxDistance} blocks`)
    await this.goNear(context, bot, block, 3)
    this.assertOperational(context, bot)

    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    let container: ContainerWindow | undefined
    const abort = (): void => {
      if (container) container.close()
      else closeCurrentWindow(bot)
    }
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      closeCurrentWindow(bot)
      container = await bot.openContainer(block)
      this.assertOperational(context, bot)
      const result = await worker(bot, container, block)
      context.checkpoint()
      return result
    } finally {
      context.signal.removeEventListener('abort', abort)
      try {
        if (container && bot.currentWindow === container) container.close()
        else closeCurrentWindow(bot)
      } finally {
        releaseAutoEat()
      }
    }
  }

  private async goNear(context: TaskContext, bot: Bot, block: Block, range: number): Promise<void> {
    this.assertOperational(context, bot)
    if (block.position.distanceTo(bot.entity.position) <= range) return
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    const abort = (): void => bot.pathfinder.stop()
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, range))
      this.assertOperational(context, bot)
    } finally {
      context.signal.removeEventListener('abort', abort)
    }
  }

  private async goToPlayer(context: TaskContext, bot: Bot, player: Bot['entity'], range: number): Promise<void> {
    this.assertOperational(context, bot)
    if (player.position.distanceTo(bot.entity.position) <= range) return
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    const abort = (): void => bot.pathfinder.stop()
    context.signal.addEventListener('abort', abort, { once: true })
    try {
      await bot.pathfinder.goto(new goals.GoalFollow(player, range))
      this.assertOperational(context, bot)
    } finally {
      context.signal.removeEventListener('abort', abort)
    }
  }
}

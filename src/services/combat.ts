import type { Entity } from 'prismarine-entity'
import { Vec3 } from 'vec3'
import { goals } from '../pathfinder.js'
import type { BotRuntime } from '../bot-runtime.js'
import type { PositionData } from '../types.js'
import type { TaskContext } from '../task-manager.js'
import { NavigationService } from './navigation.js'

export const HOSTILE_MOBS = new Set([
  'blaze', 'bogged', 'breeze', 'cave_spider', 'creeper', 'drowned',
  'elder_guardian', 'endermite', 'evoker', 'ghast', 'guardian', 'hoglin',
  'husk', 'magma_cube', 'phantom', 'piglin_brute', 'pillager', 'ravager',
  'shulker', 'silverfish', 'skeleton', 'slime', 'spider', 'stray', 'vex',
  'vindicator', 'warden', 'witch', 'wither', 'wither_skeleton', 'zoglin',
  'zombie', 'zombie_villager'
])

export interface EntitySummary {
  id: number
  name: string
  type: string
  distance: number
  position: PositionData
}

function entityName(entity: Entity): string {
  return (entity.username ?? entity.name ?? entity.displayName ?? 'unknown')
    .toLowerCase()
    .replaceAll(' ', '_')
}

export class CombatService {
  private readonly navigation: NavigationService

  constructor(private readonly runtime: BotRuntime) {
    this.navigation = new NavigationService(runtime)
  }

  nearby(kind: 'players' | 'mobs' | 'hostiles' | 'items' | 'all', radius: number): EntitySummary[] {
    const bot = this.runtime.requireBot()
    return Object.values(bot.entities)
      .filter((entity) => entity !== bot.entity && entity.isValid)
      .filter((entity) => {
        const distance = bot.entity.position.distanceTo(entity.position)
        if (distance > radius) return false
        if (kind === 'players') return entity.type === 'player'
        if (kind === 'mobs') return entity.type === 'mob' || entity.type === 'hostile'
        if (kind === 'hostiles') return HOSTILE_MOBS.has(entityName(entity))
        if (kind === 'items') return entity.getDroppedItem() !== null
        return true
      })
      .map((entity) => ({
        id: entity.id,
        name: entityName(entity),
        type: entity.type,
        distance: bot.entity.position.distanceTo(entity.position),
        position: {
          x: entity.position.x,
          y: entity.position.y,
          z: entity.position.z,
          dimension: bot.game.dimension
        }
      }))
      .sort((a, b) => a.distance - b.distance)
  }

  findTarget(nameOrId: string, radius: number, playersAllowed = false): Entity {
    const bot = this.runtime.requireBot()
    const numericId = /^\d+$/u.test(nameOrId) ? Number(nameOrId) : undefined
    const targetName = nameOrId.toLowerCase().replace(/^minecraft:/u, '')
    const target = Object.values(bot.entities)
      .filter((entity) => entity !== bot.entity && entity.isValid)
      .filter((entity) => numericId === entity.id || entityName(entity) === targetName)
      .filter((entity) => playersAllowed || entity.type !== 'player')
      .filter((entity) => bot.entity.position.distanceTo(entity.position) <= radius)
      .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))[0]
    if (!target) throw new Error(`No matching ${nameOrId} found within ${radius} blocks`)
    return target
  }

  async attack(
    context: TaskContext,
    target: Entity,
    options: { leashCenter?: PositionData, leashRadius?: number } = {}
  ): Promise<void> {
    const bot = this.runtime.requireBot()
    if (target.type === 'player' && !this.runtime.config.safety.allowPvp) {
      throw new Error('PvP is disabled in config')
    }
    context.checkpoint()
    const releaseAutoEat = await this.runtime.pauseAutoEat(bot, context.signal)
    try {
      await this.equipBestWeapon()
      bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
      const chaseLimit = Math.min(options.leashRadius ?? 32, 64)
      let pursuing = false
      let bestDistance = Number.POSITIVE_INFINITY
      let lastProgressAt = Date.now()
      while (target.isValid) {
        context.checkpoint()
        if (bot.health <= 6) throw new Error(`Retreating at ${bot.health.toFixed(1)} health`)
        if (options.leashCenter && options.leashRadius) {
          const center = options.leashCenter
          const distance = target.position.distanceTo(new Vec3(center.x, center.y, center.z))
          if (distance > options.leashRadius) throw new Error('Target left the guard area')
        }
        const distance = bot.entity.position.distanceTo(target.position)
        if (distance > chaseLimit) throw new Error(`Target moved beyond the ${chaseLimit}-block chase limit`)
        if (distance + 0.5 < bestDistance) {
          bestDistance = distance
          lastProgressAt = Date.now()
        } else if (distance > 3.2 && Date.now() - lastProgressAt > 15_000) {
          throw new Error('Combat stopped after 15s without pathing progress')
        }

        if (distance > 3) {
          if (!pursuing) {
            bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
            pursuing = true
          }
          await context.sleep(100)
          continue
        }

        if (pursuing) {
          bot.pathfinder.setGoal(null)
          pursuing = false
        }
        await bot.lookAt(target.position.offset(0, Math.max(0.5, target.height * 0.75), 0), true)
        context.checkpoint()
        bot.attack(target)
        await context.sleep(650)
      }
      context.checkpoint()
    } finally {
      try {
        bot.pathfinder.setGoal(null)
        bot.clearControlStates()
      } finally {
        releaseAutoEat()
      }
    }
  }

  async hunt(context: TaskContext, mobName: string, count: number, radius: number): Promise<number> {
    const bot = this.runtime.requireBot()
    const anchor = this.runtime.position(bot)
    if (!anchor) throw new Error('Bot has no position')
    let defeated = 0
    while (defeated < count) {
      context.checkpoint()
      const target = this.findTarget(mobName, radius, false)
      if (target.type === 'player') throw new Error('Use the local-only pvp command for players')
      await this.attack(context, target, { leashCenter: anchor, leashRadius: radius })
      defeated += 1
    }
    return defeated
  }

  async guard(context: TaskContext, anchor: PositionData, radius: number): Promise<void> {
    const bot = this.runtime.requireBot()
    while (true) {
      context.checkpoint()
      const target = Object.values(bot.entities)
        .filter((entity) => entity.isValid && HOSTILE_MOBS.has(entityName(entity)))
        .filter((entity) => entity.getCustomName() === null)
        .filter((entity) => {
          const dx = entity.position.x - anchor.x
          const dy = entity.position.y - anchor.y
          const dz = entity.position.z - anchor.z
          return Math.sqrt(dx * dx + dy * dy + dz * dz) <= radius
        })
        .sort((a, b) => bot.entity.position.distanceTo(a.position) - bot.entity.position.distanceTo(b.position))[0]

      if (target) {
        try {
          await this.attack(context, target, { leashCenter: anchor, leashRadius: radius })
        } catch (error) {
          context.checkpoint()
          if (bot.health <= 6) throw error
          await context.sleep(500)
        }
        continue
      }

      const dx = bot.entity.position.x - anchor.x
      const dz = bot.entity.position.z - anchor.z
      if (Math.hypot(dx, dz) > Math.max(3, radius * 0.75)) {
        await this.navigation.goTo(context, anchor, 2)
      }
      await context.sleep(500)
    }
  }

  private async equipBestWeapon(): Promise<void> {
    const bot = this.runtime.requireBot()
    const tier: Record<string, number> = { wooden: 1, golden: 2, stone: 3, iron: 4, diamond: 5, netherite: 6 }
    const candidates = bot.inventory.items()
      .map((item) => {
        const match = /^(wooden|golden|stone|iron|diamond|netherite)_(sword|axe)$/u.exec(item.name)
        if (!match) return undefined
        const material = match[1]
        const kind = match[2]
        if (!material || !kind) return undefined
        return { item, score: (tier[material] ?? 0) * 10 + (kind === 'sword' ? 2 : 1) }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .sort((a, b) => b.score - a.score)
    const best = candidates[0]
    if (best) await bot.equip(best.item, 'hand')
  }
}

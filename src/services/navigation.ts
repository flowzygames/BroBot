import { goals } from '../pathfinder.js'
import { Vec3 } from 'vec3'
import type { BotRuntime } from '../bot-runtime.js'
import type { PositionData } from '../types.js'
import type { TaskContext } from '../task-manager.js'

export interface LocateResult {
  name: string
  position: PositionData
  distance: number
}

function sameDimension(current: string | undefined, target: PositionData): void {
  if (target.dimension && current && target.dimension !== current) {
    throw new Error(`Target is in ${target.dimension}, but the bot is in ${current}`)
  }
}

export class NavigationService {
  constructor(private readonly runtime: BotRuntime) {}

  async goTo(context: TaskContext, target: PositionData, range = 1): Promise<void> {
    const bot = this.runtime.requireBot()
    sameDimension(bot.game.dimension, target)
    context.checkpoint()
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    await bot.pathfinder.goto(new goals.GoalNear(
      Math.floor(target.x),
      Math.floor(target.y),
      Math.floor(target.z),
      range
    ))
    context.checkpoint()
  }

  async follow(context: TaskContext, username: string, distance: number): Promise<void> {
    const bot = this.runtime.requireBot()
    const target = this.playerEntity(username)
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    bot.pathfinder.setGoal(new goals.GoalFollow(target, distance), true)
    try {
      while (target.isValid) {
        context.checkpoint()
        await context.sleep(500)
      }
      throw new Error(`${username} is no longer visible`)
    } finally {
      bot.pathfinder.setGoal(null)
      bot.clearControlStates()
    }
  }

  async patrol(
    context: TaskContext,
    points: PositionData[],
    loops: number,
    pauseMs: number
  ): Promise<void> {
    if (points.length < 2) throw new Error('A patrol needs at least two waypoints')
    for (let loop = 0; loop < loops; loop += 1) {
      for (const point of points) {
        context.checkpoint()
        await this.goTo(context, point, 1)
        await context.sleep(pauseMs)
      }
    }
  }

  async wander(context: TaskContext, center: PositionData, radius: number, hops: number): Promise<void> {
    for (let index = 0; index < hops; index += 1) {
      context.checkpoint()
      const angle = Math.random() * Math.PI * 2
      const distance = Math.max(3, Math.sqrt(Math.random()) * radius)
      const target: PositionData = {
        x: center.x + Math.cos(angle) * distance,
        y: center.y,
        z: center.z + Math.sin(angle) * distance,
        dimension: center.dimension
      }
      try {
        await this.goTo(context, target, 2)
      } catch (error) {
        context.checkpoint()
        // A random point can be unreachable; the next hop is still useful.
        if (index === hops - 1) throw error
      }
    }
  }

  async flee(context: TaskContext, from: Vec3, distance: number): Promise<void> {
    const bot = this.runtime.requireBot()
    context.checkpoint()
    bot.pathfinder.setMovements(this.runtime.createMovements(bot, false))
    const unsafeArea = new goals.GoalNear(Math.floor(from.x), Math.floor(from.y), Math.floor(from.z), distance)
    await bot.pathfinder.goto(new goals.GoalInvert(unsafeArea))
    context.checkpoint()
  }

  locateBlock(name: string, radius: number): LocateResult {
    const bot = this.runtime.requireBot()
    const blockType = bot.registry.blocksByName[name]
    if (!blockType) throw new Error(`Unknown block: ${name}`)
    const block = bot.findBlock({ matching: blockType.id, maxDistance: radius })
    if (!block) throw new Error(`No ${name} found within ${radius} blocks`)
    return {
      name,
      position: {
        x: block.position.x,
        y: block.position.y,
        z: block.position.z,
        dimension: bot.game.dimension
      },
      distance: bot.entity.position.distanceTo(block.position)
    }
  }

  playerEntity(username: string) {
    const bot = this.runtime.requireBot()
    const matchingName = Object.keys(bot.players).find((name) => name.toLowerCase() === username.toLowerCase())
    const entity = matchingName ? bot.players[matchingName]?.entity : undefined
    if (!entity) throw new Error(`Player ${username} is not visible`)
    return entity
  }
}

import { Vec3 } from 'vec3'
import { soilWorld } from './soil-world.js'
import { createActions } from '../../src/actions.js'
import { ActionRunner } from '../../src/runner.js'

// Real Actions/Runner/receipt observer, modeled movement and server transport.
// No Minecraft process and no claim of physical proof.
export function soilActions() {
  const world = soilWorld({ flat: true }), { bot, home, protectedPositions, overrides } = world
  bot.game.dimension = 'overworld'
  bot.entity.id = 1
  bot.entity.velocity.y = -.0784
  const tool = { name: 'wooden_pickaxe', type: bot.registry.itemsByName.wooden_pickaxe.id, count: 1 }
  bot.inventory.items = () => [tool]
  bot.heldItem = tool
  bot.equip = async item => { bot.heldItem = item }
  bot.lookAt = async () => {}
  bot.canDigBlock = () => true
  bot.digTime = () => 20
  bot.stopDigging = () => {}
  bot.deactivateItem = () => {}
  bot.quit = () => {}
  let digs = 0, controls = 0
  bot.clearControlStates = () => { controls++ }
  const original = bot.pathfinder
  bot.pathfinder = {
    get movements() { return original.movements },
    setMovements: movement => original.setMovements(movement),
    getPathFromTo: original.getPathFromTo,
    bestHarvestTool: () => tool,
    goal: null,
    setGoal(goal) {
      this.goal = goal
      bot.emit('goal_updated', goal)
      if (goal) queueMicrotask(() => {
        if (this.goal !== goal) return
        bot.entity.position = new Vec3(goal.x + .5, goal.y, goal.z + .5)
        bot.emit('goal_reached', goal)
      })
    }
  }
  bot.dig = async block => {
    digs++
    const before = bot.blockAt(block.position)
    overrides.set(block.position.toArray().join(','), 'air')
    const after = bot.blockAt(block.position)
    bot.emit('blockUpdate', before, after)
    const above = bot.blockAt(block.position.offset(0, 1, 0))
    if (above?.name === 'snow' && above.stateId === bot.registry.blocksByName.snow.defaultState) {
      overrides.set(above.position.toArray().join(','), 'air')
      const cleared = bot.blockAt(above.position)
      bot.emit('blockUpdate', above, cleared)
      bot._client.emit('packet', { location: above.position, type: cleared.stateId }, { name: 'block_change' })
    }
    bot._client.emit('packet', { location: block.position, type: after.stateId }, { name: 'block_change' })
  }
  let owned = true
  const actions = createActions(bot, { movementBoundary: () => ({ center: home, radius: 256 }), starterProtectedPositions: () => protectedPositions })
  const runner = new ActionRunner({ timeoutMs: 30000 })
  const run = () => runner.run('private soil fixture', (signal, context) => actions.excavateSoil(signal,
    { actionDeadline: context.deadline, ownershipGuard: () => owned, starterScope: 'fixture/soil' }), () => actions.stop())
  return { ...world, actions, runner, run, retire: () => { owned = false }, counters: () => ({ digs, controls }) }
}

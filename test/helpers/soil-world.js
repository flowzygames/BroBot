import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import zlib from 'node:zlib'
import { createRequire } from 'node:module'
import { Vec3 } from 'vec3'
import pathfinderPackage from 'mineflayer-pathfinder'
import WorldSync from 'prismarine-world/src/worldsync.js'
import { STARTER_AVOID_BLOCK_NAMES } from '../../src/navigation-guards.js'
const require = createRequire(import.meta.url)
const registry = require('prismarine-registry')('1.21.8')
const Block = require('prismarine-block')(registry)
export function soilWorld({ flat = false } = {}) {
  let fixture = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('../fixtures/forward-soil-saved-world.json.gz', import.meta.url))))
  if (flat) {
    const min = [-12, 48, -12], max = [12, 80, 12], states = []
    for (let y = min[1]; y <= max[1]; y++) for (let z = min[2]; z <= max[2]; z++) for (let x = min[0]; x <= max[0]; x++) {
      const name = y > 64 ? 'air' : y === 64 ? 'grass_block' : y === 63 ? 'dirt' : 'stone'
      states.push(registry.blocksByName[name].defaultState)
    }
    fixture = { schemaVersion: 1, version: '1.21.8', source: { kind: 'constructed dry five-edit arena' }, min, max, states,
      origin: [.5, 65, .5], home: [-3.5, 65, .5], protectedPositions: [[.5, 65, .5], [-3.5, 65, .5]] }
  }
  const { min, max, states } = fixture
  const overrides = new Map()
  const blockAt = position => {
    const p = position.floored(), coordinates = p.toArray()
    if (coordinates.some((v, i) => v < min[i] || v > max[i])) return null
    const index = (p.y - min[1]) * (max[2] - min[2] + 1) * (max[0] - min[0] + 1)
      + (p.z - min[2]) * (max[0] - min[0] + 1) + p.x - min[0]
    const state = overrides.has(coordinates.join(',')) ? overrides.get(coordinates.join(',')) : states[index]
    if (state == null) return null
    const block = Block.fromStateId(typeof state === 'string' ? registry.blocksByName[state].defaultState : state, 0)
    block.position = p
    return block
  }
  const bot = Object.assign(new EventEmitter(), {
    version: '1.21.8', registry, _client: new EventEmitter(), blockAt,
    world: { getBlock: blockAt, raycast: WorldSync.prototype.raycast },
    entity: { position: new Vec3(...fixture.origin), velocity: new Vec3(0, 0, 0), onGround: true, eyeHeight: 1.62, effects: {} },
    entities: {}, inventory: { items: () => [{ name: 'wooden_pickaxe', count: 1 }] },
    health: 20, food: 20, game: { minY: -64, height: 384 }, clearControlStates() {}
  })
  pathfinderPackage.pathfinder(bot)
  const movement = new pathfinderPackage.Movements(bot)
  Object.assign(movement, { canDig: false, canOpenDoors: false, allowParkour: false, allowFreeMotion: false,
    allow1by1towers: false, scafoldingBlocks: [], maxDropDown: 3 })
  for (const name of STARTER_AVOID_BLOCK_NAMES) if (registry.blocksByName[name]) movement.blocksToAvoid.add(registry.blocksByName[name].id)
  bot.pathfinder.setMovements(movement)
  return { bot, fixture, overrides, home: new Vec3(...fixture.home),
    protectedPositions: fixture.protectedPositions.map(p => new Vec3(...p)) }
}

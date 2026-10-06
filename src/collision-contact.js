import AABB from 'prismarine-physics/lib/aabb.js'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const supportedDependencies = require('prismarine-physics/package.json').version === '1.11.1' && require('mineflayer/package.json').version === '4.39.0' && require('mineflayer-pathfinder/package.json').version === '2.4.5'

// AABB's strict face comparisons can miss a collision when ordinary floating
// arithmetic or the supported half-width expansion leaves a player just inside a face. Clip only movement into
// that face, within 1e-7 block; never push or teleport a player out of overlap.
// The 3e-8 half-width margin can itself overlap a face at exact .3/.7 starts.
// A 4e-8 floor covers that margin; the existing 1e-7 hard cap is unchanged.
export function contactEpsilon (a, b) { return Math.min(1e-7, Math.max(4e-8, 8 * Number.EPSILON * Math.max(Math.abs(a), Math.abs(b)))) }
const installed = new WeakSet()
export function clipContactOffset (obstacle, body, offset, axis, original) {
  const others = ['X', 'Y', 'Z'].filter(value => value !== axis)
  if (!others.every(value => body['max' + value] > obstacle['min' + value] && body['min' + value] < obstacle['max' + value])) return original.call(obstacle, body, offset)
  const overlap = offset > 0 ? body['max' + axis] - obstacle['min' + axis] : obstacle['max' + axis] - body['min' + axis]
  if (offset !== 0 && overlap > 0 && overlap <= contactEpsilon(offset > 0 ? body['max' + axis] : body['min' + axis], offset > 0 ? obstacle['min' + axis] : obstacle['max' + axis])) return 0
  return original.call(obstacle, body, offset)
}

export function configureCollisionContact (bot) {
  if (!supportedDependencies || bot.version !== '1.21.8' || typeof bot.physics?.simulatePlayer !== 'function' || installed.has(bot.physics)) return false
  const physics = bot.physics, simulate = physics.simulatePlayer
  // Both live prediction and pathfinder lookahead call this same synchronous
  // simulator. Restore immediately, including on exceptions; no global patch
  // remains installed between simulations and no server state is touched.
  physics.simulatePlayer = function (...args) {
    const originals = []
    try {
      for (const axis of ['X', 'Y', 'Z']) {
        const method = 'computeOffset' + axis, original = AABB.prototype[method]
        AABB.prototype[method] = function (body, offset) { return clipContactOffset(this, body, offset, axis, original) }
        originals.push([method, original])
      }
      return simulate.apply(this, args)
    } finally { for (const [method, original] of originals.reverse()) AABB.prototype[method] = original }
  }
  installed.add(physics)
  return true
}

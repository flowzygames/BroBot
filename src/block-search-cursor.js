// Traversal adapted from Mineflayer 4.39.0 lib/plugins/blocks.js.
// Copyright (c) 2015 Andrew Kelley. MIT license: LICENSES/Mineflayer.txt.
import { Vec3 } from 'vec3'
import { sectionSearchDistance } from './block-search.js'
import worldPackage from 'prismarine-world'
import blockLoader from 'prismarine-block'

const { OctahedronIterator } = worldPackage.iterators

// Geometry only: no action callback, signal, safety verdict or block object is
// retained between pages. Its owner must invalidate it when the world changes.
export class BlockSearchCursor {
  constructor (bot, { matching, point, maxDistance, count = 512 }) {
    if (!Number.isSafeInteger(matching) || !point || !['x', 'y', 'z'].every(k => Number.isFinite(point[k])) || !Number.isFinite(maxDistance) || maxDistance <= 0 || maxDistance > sectionSearchDistance(64) || !Number.isSafeInteger(count) || count < 1 || count > 512) throw Error('Invalid bounded block search')
    if (typeof bot.world?.getColumn !== 'function' || !Number.isSafeInteger(bot.game?.minY) || !Number.isSafeInteger(bot.game?.height) || bot.game.height <= 0 || bot.game.height > 4096) throw Error('Unsupported block search world')
    this.bot = bot
    this.matching = matching
    this.point = new Vec3(point.x, point.y, point.z).floored()
    this.maxDistance = maxDistance
    this.count = count
    this.Block = blockLoader(bot.registry)
    this.minY = bot.game.minY
    this.height = bot.game.height
    const start = new Vec3(Math.floor(this.point.x / 16), Math.floor(this.point.y / 16), Math.floor(this.point.z / 16))
    this.iterator = new OctahedronIterator(start, Math.ceil((maxDistance + 8) / 16))
    this.section = start
    this.visited = new Set()
    this.startedLayer = 0
    this.begin = null
    this.cell = 0
    this.done = false
    this.resumable = true
  }

  finishSection (acceptedCount) {
    if (this.startedLayer !== this.iterator.apothem && acceptedCount >= this.count) {
      this.done = true
      return
    }
    this.startedLayer = this.iterator.apothem
    this.section = this.iterator.next()
    this.begin = null
    this.cell = 0
    if (!this.section) this.done = true
  }

  scan ({ accept, check = () => {}, now = () => performance.now(), budgetMs = 500, matchLimit = 65536 } = {}) {
    if (!this.resumable || this.done) throw Error('Block search cursor is not resumable')
    if (typeof accept !== 'function' || typeof check !== 'function' || !Number.isFinite(budgetMs) || budgetMs <= 0 || budgetMs > 500 || !Number.isSafeInteger(matchLimit) || matchLimit < 1 || matchLimit > 65536) throw Error('Invalid block search page')
    const deadline = now() + budgetMs
    const positions = []
    let inspected = 0, accepted = 0, limited = false
    try { while (!this.done) {
      check()
      // Unlike native findBlocks, also bound time spent on nonmatching cells.
      // The next unevaluated geometry remains available to a safe continuation.
      if (now() >= deadline) { limited = true; break }
      if (!this.begin) {
        const next = this.section
        const column = this.bot.world.getColumn(next.x, next.z)
        const sectionY = next.y + Math.abs(this.minY >> 4)
        const totalSections = this.height >> 4
        if (sectionY < 0 || sectionY >= totalSections || !column || this.visited.has(next.toString())) {
          this.finishSection(positions.length)
          continue
        }
        const section = column.sections[sectionY]
        const contains = section && (!section.palette || section.palette.some(state => this.Block.fromStateId(state, 0).type === this.matching))
        this.visited.add(next.toString())
        if (!contains) { this.finishSection(positions.length); continue }
        this.begin = new Vec3(next.x * 16, sectionY * 16 + this.minY, next.z * 16)
      }
      const point = this.begin.offset(this.cell >> 8, (this.cell >> 4) & 15, this.cell & 15)
      const block = this.bot.blockAt(point, true)
      if (block?.type === this.matching) {
        // Native's 65,537th matching callback is stopped before evaluation.
        // Leave this cell unconsumed so the next page retries that boundary.
        if (++inspected > matchLimit || now() >= deadline) { limited = true; break }
        if (accept(block)) {
          accepted++
          if (point.distanceTo(this.point) <= this.maxDistance) positions.push(point)
        }
      }
      this.cell++
      if (this.cell === 4096) this.finishSection(positions.length)
    } } catch (error) { this.resumable = false; throw error }
    this.resumable = limited && accepted === 0
    positions.sort((a, b) => a.distanceTo(this.point) - b.distanceTo(this.point))
    return { positions: positions.slice(0, this.count), limited, inspected, accepted, done: this.done, resumable: this.resumable }
  }
}

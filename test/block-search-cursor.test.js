import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { Vec3 } from 'vec3'
import minecraftData from 'minecraft-data'
import blockLoader from 'prismarine-block'
import worldPackage from 'prismarine-world'
import { BlockSearchCursor } from '../src/block-search-cursor.js'

const require = createRequire(import.meta.url)
const registry = minecraftData('1.21.8'), Block = blockLoader(registry)
const { OctahedronIterator } = worldPackage.iterators
const source = readFileSync(require.resolve('mineflayer/lib/plugins/blocks.js'), 'utf8')
const nativeSearch = source.slice(source.indexOf('  function getMatchingFunction'), source.indexOf('\n  function findBlock ('))
assert.ok(nativeSearch.includes('bot.findBlocks ='))

function fixture ({ point = new Vec3(.5, 64, .5), minY = -64, height = 384, missing = false, paletteSkips = false, globalPalette = false, dense = false } = {}) {
  const stone = registry.blocksByName.stone, air = registry.blocksByName.air
  const bot = { registry, entity: { position: point }, game: { minY, height } }
  bot.world = { getColumn: (x, z) => missing && Math.abs(x + z) % 3 === 0 ? null : { sections: Array.from({ length: height >> 4 }, (_, i) => paletteSkips && i % 7 === 0 ? undefined : globalPalette ? {} : { palette: paletteSkips && i % 3 === 0 ? [air.defaultState] : [stone.defaultState, air.defaultState] }) } }
  bot.blockAt = p => {
    p = p.floored()
    const sectionY = (p.y - minY) >> 4
    const definition = paletteSkips && sectionY % 3 === 0 ? air : dense || (p.x + p.y + p.z) % 3 === 0 ? stone : air
    return { name: definition.name, type: definition.id, position: p, stateId: definition.defaultState }
  }
  vm.runInNewContext(nativeSearch, { bot, Vec3, Block, OctahedronIterator, blockAt: p => bot.blockAt(p, true) })
  return bot
}

for (const options of [
  {},
  { point: new Vec3(-17.8, 70.2, -1.1) },
  { point: new Vec3(15.9, 2, -16.1), minY: 0, height: 128 },
  { missing: true },
  { paletteSkips: true },
  { globalPalette: true },
  { dense: true }
]) test(`cursor matches pinned native traversal and shell count: ${JSON.stringify(options)}`, () => {
  const bot = fixture(options), expectedVisits = [], actualVisits = []
  const filter = b => Math.abs(b.position.x + b.position.z) % 5 === 0
  const expected = bot.findBlocks({ matching: registry.blocksByName.stone.id, maxDistance: 20, count: 9, useExtraInfo: b => { expectedVisits.push(b.position.toString()); return filter(b) } })
  const cursor = new BlockSearchCursor(bot, { matching: registry.blocksByName.stone.id, point: bot.entity.position, maxDistance: 20, count: 9 })
  const actual = cursor.scan({ now: () => 0, accept: b => { actualVisits.push(b.position.toString()); return filter(b) } })
  assert.equal(actual.limited, false)
  assert.deepEqual(actualVisits, expectedVisits)
  assert.deepEqual(actual.positions.map(p => p.toString()), Array.from(expected, p => p.toString()))
  assert.equal(cursor.resumable, false)
})

test('empty capped pages retry the exact unevaluated boundary cell instead of the old prefix', () => {
  const bot = fixture({ dense: true })
  const cursor = new BlockSearchCursor(bot, { matching: registry.blocksByName.stone.id, point: bot.entity.position, maxDistance: 48 })
  const first = []
  const page = cursor.scan({ now: () => 0, accept: b => { first.push(b.position.toString()); return false } })
  assert.equal(page.inspected, 65537); assert.equal(first.length, 65536); assert.equal(page.resumable, true)
  const expectedNext = cursor.begin.offset(cursor.cell >> 8, (cursor.cell >> 4) & 15, cursor.cell & 15).toString()
  const second = []
  const next = cursor.scan({ now: () => 0, matchLimit: 2, accept: b => { second.push(b.position.toString()); return second.length === 1 } })
  assert.equal(second[0], expectedNext)
  assert.notEqual(second[0], first[0]); assert.equal(second.length, 2)
  assert.equal(next.accepted, 1); assert.equal(next.resumable, false)
})

test('time limits preserve an unprocessed cell and exceptions invalidate the cursor', () => {
  const bot = fixture({ dense: true }), make = () => new BlockSearchCursor(bot, { matching: registry.blocksByName.stone.id, point: bot.entity.position, maxDistance: 20 })
  const cursor = make(); let clock = 0, calls = 0
  const page = cursor.scan({ now: () => clock++, budgetMs: 2, accept: () => { calls++; return false } })
  assert.equal(page.limited, true); assert.equal(calls, 0); assert.equal(cursor.cell, 0)
  const next = cursor.scan({ now: () => 0, matchLimit: 1, accept: b => { assert.equal(b.position.toString(), '(0, 64, 0)'); return true } })
  assert.equal(next.accepted, 1)
  const failed = make()
  assert.throws(() => failed.scan({ check: () => { throw Error('Cancelled') }, accept: () => false }), /Cancelled/)
  assert.throws(() => failed.scan({ accept: () => false }), /not resumable/)
})

for (const radius of [61,62,63,64]) test(`cursor admits widened maximum collection radius ${radius}`, async () => {
  const { sectionSearchDistance } = await import('../src/block-search.js')
  assert.doesNotThrow(() => new BlockSearchCursor(fixture(), {matching:registry.blocksByName.stone.id,point:new Vec3(0,64,0),maxDistance:sectionSearchDistance(radius)}))
})

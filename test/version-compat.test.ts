import { describe, expect, it } from 'vitest'
import { isProtectedBlockName } from '../src/block-safety.js'
import { availableBedIds, resolveChopBlockNames } from '../src/version-compat.js'

function block(name: string, id: number): { name: string, id: number } {
  return { name, id }
}

describe('legacy registry compatibility', () => {
  it('finds both legacy and color-specific modern beds', () => {
    expect(availableBedIds({ bed: block('bed', 26) })).toEqual([26])
    expect(availableBedIds({ red_bed: block('red_bed', 100), blue_bed: block('blue_bed', 101) })).toEqual([100, 101])
  })

  it('resolves legacy log/log2 and modern wood names', () => {
    const legacy = { log: block('log', 17), log2: block('log2', 162) }
    expect(resolveChopBlockNames(legacy, 'any')).toEqual(['log', 'log2'])
    expect(resolveChopBlockNames(legacy, 'oak')).toEqual(['log'])
    expect(resolveChopBlockNames(legacy, 'dark_oak')).toEqual(['log2'])
    const modern = { oak_log: block('oak_log', 1), crimson_stem: block('crimson_stem', 2) }
    expect(resolveChopBlockNames(modern, 'any')).toEqual(['oak_log', 'crimson_stem'])
    expect(resolveChopBlockNames(modern, 'oak')).toEqual(['oak_log'])
  })

  it('protects legacy aliases and colored shulker boxes', () => {
    const configured = ['furnace', 'spawner', 'shulker_box']
    expect(isProtectedBlockName('lit_furnace', configured)).toBe(true)
    expect(isProtectedBlockName('mob_spawner', configured)).toBe(true)
    expect(isProtectedBlockName('blue_shulker_box', configured)).toBe(true)
    expect(isProtectedBlockName('stone', configured)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import {
  CommandSyntaxError,
  assertOnlyFlags,
  boundedInteger,
  flagBoolean,
  flagInteger,
  parseCommand,
  resourceName,
  tokenize
} from '../src/commands/parser.js'

describe('command parser', () => {
  it('tokenizes quotes, empty strings, and escapes', () => {
    expect(tokenize('say "hello world" \'\' escaped\\ space')).toEqual([
      'say', 'hello world', '', 'escaped space'
    ])
  })

  it('parses positional arguments and flags', () => {
    expect(parseCommand('mine minecraft:iron_ore 12 --radius=32 --replace')).toEqual({
      name: 'mine',
      args: ['minecraft:iron_ore', '12'],
      flags: { radius: '32', replace: true },
      raw: 'mine minecraft:iron_ore 12 --radius=32 --replace'
    })
  })

  it('supports -- to stop flag parsing', () => {
    expect(parseCommand('say -- --looks-like-a-flag').args).toEqual(['--looks-like-a-flag'])
  })

  it('rejects malformed syntax and repeated flags', () => {
    expect(() => tokenize('say "unfinished')).toThrow(CommandSyntaxError)
    expect(() => parseCommand('mine stone --radius 4 --radius 5')).toThrow(/more than once/u)
  })

  it('normalizes resource identifiers and bounds numbers', () => {
    expect(resourceName('minecraft:Oak_Log')).toBe('oak_log')
    expect(boundedInteger('8', 'count', 1, 10)).toBe(8)
    expect(() => boundedInteger('11', 'count', 1, 10)).toThrow(/1 to 10/u)
    expect(() => resourceName('../stone')).toThrow(/Invalid Minecraft identifier/u)
  })

  it('validates flags through helpers', () => {
    const parsed = parseCommand('wander --radius=12 --loop=false')
    expect(flagInteger(parsed, 'radius', 4, 1, 32)).toBe(12)
    expect(flagBoolean(parsed, 'loop', true)).toBe(false)
    expect(() => assertOnlyFlags(parsed, ['radius'])).toThrow(/--loop/u)
  })

  it('validates default flag values against the same bounds', () => {
    const parsed = parseCommand('wander')
    expect(() => flagInteger(parsed, 'radius', 16, 3, 4)).toThrow(/default --radius/u)
  })
})

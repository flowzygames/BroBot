import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, loadConfig, validateConfig } from '../src/config.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  delete process.env.MC_HOST
  delete process.env.MC_PORT
  delete process.env.MC_USERNAME
  delete process.env.MC_AUTH
  delete process.env.DASHBOARD_TOKEN
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('configuration', () => {
  it('loads defaults without a file', async () => {
    const config = await loadConfig()
    expect(config.minecraft.auth).toBe('offline')
    expect(config.minecraft.host).toBe('127.0.0.1')
    expect(config.dashboard.host).toBe('127.0.0.1')
  })

  it('deep-merges a file and applies environment overrides', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brobot-config-'))
    temporaryDirectories.push(directory)
    const file = join(directory, 'config.json')
    await writeFile(file, JSON.stringify({ minecraft: { username: 'FileBot' }, behavior: { guardRadius: 20 } }))
    process.env.MC_USERNAME = 'EnvironmentBot'
    process.env.MC_PORT = '25566'
    const config = await loadConfig(file)
    expect(config.minecraft.username).toBe('EnvironmentBot')
    expect(config.minecraft.port).toBe(25566)
    expect(config.minecraft.reconnect.enabled).toBe(true)
    expect(config.behavior.guardRadius).toBe(20)
  })

  it('rejects unsafe bounds', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.safety.maxGatherCount = 0
    expect(() => validateConfig(config)).toThrow(/maxGatherCount/u)
  })

  it('rejects malformed section and list types with clear errors', () => {
    const brokenSection = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>
    brokenSection.minecraft = null
    expect(() => validateConfig(brokenSection as never)).toThrow(/minecraft must be a JSON object/u)

    const brokenList = structuredClone(DEFAULT_CONFIG) as unknown as { commands: { allowlist: unknown } }
    brokenList.commands.allowlist = 'Owner'
    expect(() => validateConfig(brokenList as never)).toThrow(/commands.allowlist must be an array of strings/u)
  })

  it('normalizes protected block identifiers centrally', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.safety.protectedBlocks = [' Minecraft:CHEST ', 'chest', 'red_shulker_box']
    expect(validateConfig(config).safety.protectedBlocks).toEqual(['chest', 'red_shulker_box'])
  })

  it('does not let one environment override mutate later default loads', async () => {
    process.env.MC_HOST = '203.0.113.9'
    expect((await loadConfig()).minecraft.host).toBe('203.0.113.9')
    delete process.env.MC_HOST
    expect((await loadConfig()).minecraft.host).toBe('127.0.0.1')
    expect(DEFAULT_CONFIG.minecraft.host).toBe('127.0.0.1')
  })

  it('rejects ambiguous dashboard tokens', () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.dashboard.authToken = ' secret '
    expect(() => validateConfig(config)).toThrow(/cannot start or end with whitespace/u)
  })
})

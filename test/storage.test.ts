import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StateStore } from '../src/storage.js'

describe('StateStore', () => {
  it('persists waypoints atomically', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brobot-state-'))
    try {
      const first = new StateStore(directory)
      await first.load()
      await first.setWaypoint('Base', { x: 10, y: 64, z: -4, dimension: 'overworld' })
      const second = new StateStore(directory)
      await second.load()
      expect(second.getWaypoint('base')).toEqual({ x: 10, y: 64, z: -4, dimension: 'overworld' })
      expect(await second.deleteWaypoint('BASE')).toBe(true)
      expect(second.getWaypoint('base')).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('safely persists prototype-like waypoint and route names', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'brobot-state-prototype-'))
    try {
      const first = new StateStore(directory)
      await first.load()
      await first.setWaypoint('__proto__', { x: 1, y: 2, z: 3 })
      await first.setPatrolRoute('constructor', [{ x: 4, y: 5, z: 6 }])

      const second = new StateStore(directory)
      await second.load()
      expect(second.getWaypoint('__proto__')).toEqual({ x: 1, y: 2, z: 3 })
      expect(second.snapshot().patrolRoutes.constructor).toEqual([{ x: 4, y: 5, z: 6 }])
      expect(await second.deleteWaypoint('toString')).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('recovers its write queue after a transient filesystem failure', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'brobot-state-recovery-'))
    const directory = join(parent, 'state-directory')
    try {
      await writeFile(directory, 'temporarily blocking directory creation')
      const store = new StateStore(directory)
      await expect(store.setWaypoint('first', { x: 1, y: 2, z: 3 })).rejects.toThrow()
      await rm(directory)
      await mkdir(directory)
      await store.setWaypoint('second', { x: 4, y: 5, z: 6 })

      const reloaded = new StateStore(directory)
      await reloaded.load()
      expect(reloaded.getWaypoint('first')).toEqual({ x: 1, y: 2, z: 3 })
      expect(reloaded.getWaypoint('second')).toEqual({ x: 4, y: 5, z: 6 })
    } finally {
      await rm(parent, { recursive: true, force: true })
    }
  })
})

import { describe, expect, it } from 'vitest'
import { Logger } from '../src/logger.js'
import { TaskBusyError, TaskManager } from '../src/task-manager.js'

describe('TaskManager', () => {
  it('runs a task and clears its snapshot', async () => {
    const manager = new TaskManager(new Logger('error').child('test'), 1_000)
    let ran = false
    const task = manager.start('example', async (context) => {
      context.checkpoint()
      ran = true
    })
    expect(manager.snapshot()?.label).toBe('example')
    await task.done
    expect(ran).toBe(true)
    expect(manager.snapshot()).toBeUndefined()
  })

  it('rejects concurrent foreground work', async () => {
    const manager = new TaskManager(new Logger('error').child('test'), 1_000)
    const first = manager.start('first', async (context) => context.sleep(100))
    expect(() => manager.start('second', async () => undefined)).toThrow(TaskBusyError)
    manager.cancel()
    await first.done
  })

  it('cancels sleeps and performs cleanup', async () => {
    let cleaned = 0
    const manager = new TaskManager(new Logger('error').child('test'), 1_000, () => { cleaned += 1 })
    const task = manager.start('long task', async (context) => context.sleep(5_000))
    expect(manager.cancel('test stop')).toBe(true)
    await task.done
    expect(cleaned).toBe(1)
    expect(manager.snapshot()).toBeUndefined()
  })

  it('contains cleanup failures when a task times out', async () => {
    const manager = new TaskManager(new Logger('error').child('test'), 5, async () => {
      throw new Error('cleanup failed')
    })
    const task = manager.start('timeout', async (context) => context.sleep(1_000))
    await task.done
    expect(manager.snapshot()).toBeUndefined()
  })

  it('waits for old physical cleanup before a replacement starts', async () => {
    let cleanupFinished = false
    let replacementSawCleanup = false
    const manager = new TaskManager(new Logger('error').child('test'), 1_000, async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
      cleanupFinished = true
    })
    const first = manager.start('first', async (context) => context.sleep(1_000))
    const second = manager.start('second', async () => { replacementSawCleanup = cleanupFinished }, { replace: true })
    await Promise.all([first.done, second.done])
    expect(replacementSawCleanup).toBe(true)
  })

  it('waitForIdle follows a replacement task', async () => {
    const manager = new TaskManager(new Logger('error').child('test'), 1_000)
    const first = manager.start('first', async (context) => context.sleep(1_000))
    let replacementFinished = false
    const waiting = manager.waitForIdle()
    const second = manager.start('second', async (context) => {
      await context.sleep(20)
      replacementFinished = true
    }, { replace: true })
    await first.done
    expect(replacementFinished).toBe(false)
    await Promise.all([second.done, waiting])
    expect(replacementFinished).toBe(true)
  })
})

import type { Bot } from 'mineflayer'
import { describe, expect, it } from 'vitest'
import { BotRuntime } from '../src/bot-runtime.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { Logger } from '../src/logger.js'
import { StateStore } from '../src/storage.js'

describe('BotRuntime auto-eat arbitration', () => {
  it('cancels in-flight eating and preserves a manual off choice made while paused', async () => {
    let enabled = true
    let eating = true
    let enableCalls = 0
    let cancelCalls = 0
    const autoEat = {
      get enabled() { return enabled },
      get isEating() { return eating },
      enableAuto: () => { enabled = true; enableCalls += 1 },
      disableAuto: () => { enabled = false },
      cancelEat: () => { eating = false; cancelCalls += 1 }
    }
    const bot = { autoEat } as unknown as Bot
    const runtime = new BotRuntime(
      structuredClone(DEFAULT_CONFIG),
      new Logger('error'),
      new StateStore('/tmp/brobot-autoeat-test')
    )
    ;(runtime as unknown as { bot: Bot }).bot = bot

    const release = await runtime.pauseAutoEat(bot)
    expect(enabled).toBe(false)
    expect(cancelCalls).toBe(1)
    runtime.setAutoEatEnabled(false)
    release()
    expect(enabled).toBe(false)
    expect(enableCalls).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { fishWithAbort, type FishCapableBot } from '../src/services/resources.js'

describe('fishWithAbort', () => {
  it('reels in and rejects promptly even when Mineflayer fish never settles', async () => {
    let reelCalls = 0
    const bot: FishCapableBot = {
      fish: () => new Promise<void>(() => undefined),
      activateItem: () => { reelCalls += 1 }
    }
    const controller = new AbortController()
    const fishing = fishWithAbort(bot, controller.signal)
    controller.abort(new Error('test cancellation'))
    await expect(fishing).rejects.toThrow('test cancellation')
    expect(reelCalls).toBe(1)
  })

  it('passes through a normal catch', async () => {
    const bot: FishCapableBot = { fish: async () => undefined, activateItem: () => undefined }
    await expect(fishWithAbort(bot, new AbortController().signal)).resolves.toBeUndefined()
  })
})

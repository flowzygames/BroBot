import { createServer, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { BotRuntime } from '../src/bot-runtime.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { Logger } from '../src/logger.js'
import { StateStore } from '../src/storage.js'

async function waitUntil(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for lifecycle condition')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('BotRuntime connection lifecycle', () => {
  const cleanup: Array<() => Promise<void>> = []

  afterEach(async () => {
    await Promise.allSettled(cleanup.splice(0).map((worker) => worker()))
  })

  it('closes both the main and automatic-version status sockets', async () => {
    const accepted = new Set<Socket>()
    const server = createServer((socket) => {
      accepted.add(socket)
      socket.resume()
      socket.once('close', () => accepted.delete(socket))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanup.push(async () => {
      for (const socket of accepted) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Test server did not receive a TCP port')
    const config = structuredClone(DEFAULT_CONFIG)
    config.minecraft.host = '127.0.0.1'
    config.minecraft.port = address.port
    config.minecraft.version = 'auto'
    config.minecraft.reconnect.enabled = false
    const runtime = new BotRuntime(config, new Logger('error'), new StateStore('/tmp/brobot-lifecycle-test'))
    cleanup.push(async () => { await runtime.disconnect('test cleanup') })

    runtime.connect()
    await waitUntil(() => accepted.size === 2)
    await runtime.disconnect('test disconnect')
    await waitUntil(() => accepted.size === 0, 1_000)

    expect(accepted.size).toBe(0)
  })
})

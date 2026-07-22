import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../src/config.js'
import { DashboardServer } from '../src/dashboard.js'
import { Logger } from '../src/logger.js'
import type { BotStatus } from '../src/types.js'

const running: DashboardServer[] = []

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.stop()))
})

function status(): BotStatus {
  return {
    connected: false,
    spawned: false,
    username: 'TestBot',
    server: '127.0.0.1:25565',
    players: [],
    inventory: [],
    uptimeSeconds: 1
  }
}

describe('DashboardServer', () => {
  it('serves local status, static UI, commands, and security headers', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.dashboard.port = 0
    const server = new DashboardServer(config, new Logger('error'), status, (command) => ({ ok: true, command }))
    running.push(server)
    const url = await server.start()
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u)

    const ui = await fetch(`${url}/`)
    expect(ui.status).toBe(200)
    expect(ui.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(await ui.text()).toContain('BroBot')

    const response = await fetch(`${url}/api/status`)
    expect(await response.json()).toMatchObject({ username: 'TestBot', spawned: false })

    const health = await fetch(`${url}/api/health`)
    expect(await health.json()).toMatchObject({ service: 'brobot-dashboard', instanceId: expect.any(String) })

    const command = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'status' })
    })
    expect(await command.json()).toEqual({ ok: true, command: 'status' })

    const tooLong = await fetch(`${url}/api/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ command: 'x'.repeat(1_001) })
    })
    expect(tooLong.status).toBe(413)
  })

  it('requires the configured bearer token on every API route', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.dashboard.port = 0
    config.dashboard.authToken = 'test-secret'
    const server = new DashboardServer(config, new Logger('error'), status, () => undefined)
    running.push(server)
    const url = await server.start()

    expect((await fetch(`${url}/api/health`)).status).toBe(401)
    expect((await fetch(`${url}/api/health`, {
      headers: { authorization: 'Bearer test-secret' }
    })).status).toBe(200)
  })

  it('requires a strong token before binding beyond loopback', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.dashboard.host = '0.0.0.0'
    config.dashboard.port = 0
    config.dashboard.authToken = 'short'
    const server = new DashboardServer(config, new Logger('error'), status, () => undefined)
    await expect(server.start()).rejects.toThrow(/at least 32 characters/u)
  })
})

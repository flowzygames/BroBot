import { describe, expect, it } from 'vitest'
import { BotRuntime } from '../src/bot-runtime.js'
import { createCommandRouter } from '../src/commands/register.js'
import { DEFAULT_CONFIG } from '../src/config.js'
import { Logger } from '../src/logger.js'
import { StateStore } from '../src/storage.js'
import { TaskManager } from '../src/task-manager.js'

function setup() {
  const config = structuredClone(DEFAULT_CONFIG)
  config.dashboard.enabled = false
  config.commands.allowlist = ['Owner']
  const logger = new Logger('error')
  const store = new StateStore('/tmp/brobot-router-test')
  const runtime = new BotRuntime(config, logger, store)
  const tasks = new TaskManager(logger.child('tasks'), 1_000, () => runtime.stopPhysicalActions())
  return { router: createCommandRouter(config, runtime, tasks, store, logger) }
}

describe('CommandRouter authorization', () => {
  it('registers a broad command surface without duplicate names', () => {
    const { router } = setup()
    expect(router.commands().length).toBeGreaterThanOrEqual(35)
    expect(router.find('gather')?.name).toBe('mine')
    expect(router.find('wp')?.name).toBe('waypoint')
  })

  it('permits public status but rejects non-allowlisted physical work', async () => {
    const { router } = setup()
    const status = await router.execute('status', { source: 'chat', actor: 'Guest' })
    expect(status.ok).toBe(true)
    const mine = await router.execute('mine stone 1', { source: 'chat', actor: 'Guest' })
    expect(mine.code).toBe('NOT_AUTHORIZED')
  })

  it('allows an operator command but still checks connection readiness', async () => {
    const { router } = setup()
    const result = await router.execute('mine stone 1', { source: 'chat', actor: 'owner' })
    expect(result.code).toBe('NOT_READY')
  })

  it('never permits local-only PvP through offline-mode chat names', async () => {
    const { router } = setup()
    const result = await router.execute('pvp Guest', { source: 'chat', actor: 'Owner' })
    expect(result.code).toBe('NOT_AUTHORIZED')
  })

  it('can keep command errors out of public Minecraft chat', async () => {
    const config = structuredClone(DEFAULT_CONFIG)
    config.commands.announceErrorsInChat = false
    const logger = new Logger('error')
    const store = new StateStore('/tmp/brobot-router-test-silent')
    const runtime = new BotRuntime(config, logger, store)
    const tasks = new TaskManager(logger.child('tasks'), 1_000)
    const router = createCommandRouter(config, runtime, tasks, store, logger)
    const replies: string[] = []
    const result = await router.execute('not-a-command', {
      source: 'chat', actor: 'Guest', reply: (message) => { replies.push(message) }
    })
    expect(result.code).toBe('BAD_COMMAND')
    expect(replies).toEqual([])
  })
})

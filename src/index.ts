#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { createInterface } from 'node:readline'
import { resolve } from 'node:path'
import { BotRuntime, type ChatCommandEvent } from './bot-runtime.js'
import { loadConfig, resolveDataDirectory } from './config.js'
import { createCommandRouter } from './commands/register.js'
import { DashboardServer } from './dashboard.js'
import { Logger } from './logger.js'
import { StateStore } from './storage.js'
import { TaskManager } from './task-manager.js'
import { CommandSyntaxError } from './commands/parser.js'

interface CliOptions {
  configPath?: string
  noDashboard: boolean
  help: boolean
  version: boolean
}

const VERSION = '1.0.0'

function parseCli(argv: string[]): CliOptions {
  const result: CliOptions = { noDashboard: false, help: false, version: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--config' || argument === '-c') {
      const value = argv[index + 1]
      if (!value) throw new Error(`${argument} requires a path`)
      result.configPath = resolve(value)
      index += 1
    } else if (argument === '--no-dashboard') result.noDashboard = true
    else if (argument === '--help' || argument === '-h') result.help = true
    else if (argument === '--version' || argument === '-v') result.version = true
    else throw new Error(`Unknown option: ${argument}`)
  }
  return result
}

function usage(): string {
  return [
    `BroBot ${VERSION}`,
    '',
    'Usage:',
    '  npm run dev -- [--config config.json] [--no-dashboard]',
    '  npm run build && npm start -- [--config config.json] [--no-dashboard]',
    '',
    'Options:',
    '  -c, --config <path>   Read a JSON config file',
    '      --no-dashboard    Disable the local web dashboard for this run',
    '  -h, --help            Show this help',
    '  -v, --version         Show the version'
  ].join('\n')
}

function splitChatMessage(message: string, maximum = 220): string[] {
  const result: string[] = []
  let remaining = message.replace(/[\r\n]+/gu, ' ').trim()
  while (remaining.length > maximum) {
    let cut = remaining.lastIndexOf(' ', maximum)
    if (cut < maximum / 2) cut = maximum
    result.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trim()
  }
  if (remaining) result.push(remaining)
  return result
}

async function main(): Promise<void> {
  const cli = parseCli(process.argv.slice(2))
  if (cli.help) { console.log(usage()); return }
  if (cli.version) { console.log(VERSION); return }

  const defaultConfigPath = resolve('config.json')
  const configPath = cli.configPath ?? (existsSync(defaultConfigPath) ? defaultConfigPath : undefined)
  const config = await loadConfig(configPath)
  if (cli.noDashboard) config.dashboard.enabled = false

  const logger = new Logger(config.logging.level, config.logging.maxEntries)
  const log = logger.child('app')
  const store = new StateStore(resolveDataDirectory(config, configPath))
  await store.load()

  const runtime = new BotRuntime(config, logger, store)
  const tasks = new TaskManager(
    logger.child('tasks'),
    config.safety.maxTaskSeconds * 1_000,
    () => runtime.stopPhysicalActions()
  )
  const router = createCommandRouter(config, runtime, tasks, store, logger)

  let dashboard: DashboardServer
  let shuttingDown = false
  let shutdownRequested = false
  const input = createInterface({ input: process.stdin, output: process.stdout, terminal: Boolean(process.stdin.isTTY) })

  const shutdown = async (reason: string, exitCode = 0): Promise<void> => {
    if (shuttingDown) return
    shutdownRequested = true
    shuttingDown = true
    log.info(`Shutting down: ${reason}`)
    tasks.cancel(reason)
    input.close()
    await Promise.allSettled([dashboard.stop(), runtime.disconnect(reason)])
    process.exitCode = exitCode
  }

  router.register({
    name: 'connect', category: 'core', summary: 'Connect after a manual disconnect.',
    usage: 'connect', localOnly: true,
    execute(_context, command) {
      if (command.args.length > 0 || Object.keys(command.flags).length > 0) throw new CommandSyntaxError('Usage: connect')
      runtime.connect()
      return 'Connection started.'
    }
  })
  router.register({
    name: 'disconnect', category: 'core', summary: 'Disconnect without automatic reconnect.',
    usage: 'disconnect', localOnly: true,
    async execute(_context, command) {
      if (command.args.length > 0 || Object.keys(command.flags).length > 0) throw new CommandSyntaxError('Usage: disconnect')
      tasks.cancel('Manual disconnect')
      await runtime.disconnect()
      return 'Disconnected. Use connect to return.'
    }
  })
  router.register({
    name: 'safety', category: 'core', summary: 'Show the active safety policy.',
    usage: 'safety',
    execute(_context, command) {
      if (command.args.length > 0 || Object.keys(command.flags).length > 0) throw new CommandSyntaxError('Usage: safety')
      return [
        `Digging ${config.safety.allowDigging ? 'enabled' : 'disabled'}; building ${config.safety.allowBuilding ? 'enabled' : 'disabled'}; PvP ${config.safety.allowPvp ? 'enabled' : 'disabled'}.`,
        `Limits: ${config.safety.maxGatherCount} gathered, ${config.safety.maxBuildBlocks} placed, ${config.safety.maxSearchDistance} block search, ${config.safety.maxTaskSeconds}s per task.`,
        `Protected blocks: ${config.safety.protectedBlocks.join(', ')}.`
      ]
    }
  })
  router.register({
    name: 'shutdown', aliases: ['quit', 'exit'], category: 'core', summary: 'Stop the bot process cleanly.',
    usage: 'shutdown', localOnly: true,
    execute(_context, command) {
      if (command.args.length > 0 || Object.keys(command.flags).length > 0) throw new CommandSyntaxError('Usage: shutdown')
      shutdownRequested = true
      const timer = setTimeout(() => { void shutdown('Local shutdown command') }, 250)
      timer.unref()
      return 'Shutting down BroBot.'
    }
  })

  let localCommandQueue: Promise<unknown> = Promise.resolve()
  const enqueueLocalCommand = <T>(worker: () => Promise<T>): Promise<T> => {
    const operation = localCommandQueue.then(() => {
      if (shutdownRequested) throw new Error('BroBot is shutting down')
      return worker()
    })
    localCommandQueue = operation.then(() => undefined, () => undefined)
    return operation
  }
  dashboard = new DashboardServer(
    config,
    logger,
    () => ({ ...runtime.status(), currentTask: tasks.snapshot() }),
    (command) => enqueueLocalCommand(() => router.execute(
        command.startsWith(config.commands.prefix) ? command.slice(config.commands.prefix.length) : command,
        { source: 'dashboard', actor: 'local-dashboard' }
      ))
  )

  runtime.on('death', () => tasks.cancel('Bot died'))
  runtime.on('connection', (connected: boolean) => {
    if (!connected) tasks.cancel('Minecraft connection ended')
  })
  runtime.on('chat-line', (event: ChatCommandEvent) => {
    logger.child('chat').debug(`${event.kind} <${event.username}> ${event.message}`)
  })
  const chatCooldownMs = 2_000
  const maximumQueuedChatCommands = 8
  const lastChatCommandAt = new Map<string, number>()
  let queuedChatCommands = 0
  let chatCommandQueue = Promise.resolve()
  runtime.on('chat-command', (event: ChatCommandEvent) => {
    if (!event.message.startsWith(config.commands.prefix)) return
    const command = event.message.slice(config.commands.prefix.length).trim()
    if (!command) return
    const actorKey = event.username.toLowerCase()
    const now = Date.now()
    if (now - (lastChatCommandAt.get(actorKey) ?? 0) < chatCooldownMs) {
      logger.child('chat').debug(`Rate-limited command from ${event.username}`)
      return
    }
    if (queuedChatCommands >= maximumQueuedChatCommands) {
      logger.child('chat').warn(`Dropped command because the chat queue is full`, { actor: event.username })
      return
    }
    lastChatCommandAt.set(actorKey, now)
    if (lastChatCommandAt.size > 500) lastChatCommandAt.delete(lastChatCommandAt.keys().next().value ?? '')
    queuedChatCommands += 1
    chatCommandQueue = chatCommandQueue.then(async () => {
      await router.execute(command, {
        source: 'chat',
        actor: event.username,
        reply: async (message) => {
          const bot = runtime.currentBot
          if (!bot || !runtime.isSpawned) return
          const safeWhisperTarget = /^[A-Za-z0-9_]{1,16}$/u.test(event.username)
          const whisperReply = event.kind === 'whisper' && safeWhisperTarget
          const protocolLimit = bot.supportFeature('lessCharsInChat') ? 100 : 256
          const headerLength = whisperReply ? `/tell ${event.username} `.length : 0
          for (const part of splitChatMessage(message, protocolLimit - headerLength)) {
            if (whisperReply) bot.whisper(event.username, part)
            else bot.chat(part)
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
          }
        }
      })
    }).catch((error) => logger.child('chat').error('Queued chat command failed', error)).finally(() => {
      queuedChatCommands -= 1
    })
  })

  input.on('line', (line) => {
    void enqueueLocalCommand(async () => {
      const trimmed = line.trim()
      if (!trimmed) return
      const command = trimmed.startsWith(config.commands.prefix) ? trimmed.slice(config.commands.prefix.length) : trimmed
      await router.execute(command, {
        source: 'console',
        actor: 'local-console',
        reply: (message) => console.log(message)
      })
    }).catch((error) => log.error('Console command failed', error)).finally(() => {
      if (process.stdin.isTTY && !shuttingDown) input.prompt()
    })
  })

  process.once('SIGINT', () => { void shutdown('SIGINT') })
  process.once('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('unhandledRejection', (error) => log.error('Unhandled asynchronous error', error))

  try {
    const dashboardUrl = await dashboard.start()
    if (dashboardUrl) console.log(`Dashboard: ${dashboardUrl}`)
  } catch (error) {
    log.error('Dashboard could not start; Minecraft control will continue', error)
  }

  if (shutdownRequested || shuttingDown) return

  console.log(`BroBot ${VERSION}. Terminal commands do not need the ${config.commands.prefix} prefix. Type help.`)
  if (!configPath) console.log('Using built-in defaults. Copy config.example.json to config.json to customize access and safety.')
  if (process.stdin.isTTY) { input.setPrompt('brobot> '); input.prompt() }
  runtime.connect()
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
})

import type { AppConfig, CommandSource } from '../types.js'
import type { BotRuntime } from '../bot-runtime.js'
import type { Logger, ScopedLogger } from '../logger.js'
import type { StateStore } from '../storage.js'
import type { TaskManager } from '../task-manager.js'
import { CommandSyntaxError, parseCommand, type ParsedCommand } from './parser.js'

export interface CommandContext {
  source: CommandSource
  actor: string
  config: AppConfig
  runtime: BotRuntime
  tasks: TaskManager
  store: StateStore
  logger: ScopedLogger
  router: CommandRouter
}

export interface CommandDefinition {
  name: string
  aliases?: string[]
  category: string
  summary: string
  usage: string
  requiresSpawn?: boolean
  /** Commands such as shutdown and PvP cannot be issued through unverified offline-mode chat. */
  localOnly?: boolean
  execute(context: CommandContext, command: ParsedCommand): Promise<string | string[] | void> | string | string[] | void
}

export interface ExecuteOptions {
  source: CommandSource
  actor: string
  reply?: (message: string) => void | Promise<void>
}

export interface CommandResult {
  ok: boolean
  code: 'OK' | 'BAD_COMMAND' | 'NOT_AUTHORIZED' | 'NOT_READY' | 'FAILED'
  messages: string[]
}

function safeMessage(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/gu, '').trim().slice(0, 500)
}

export class CommandRouter {
  private readonly definitions = new Map<string, CommandDefinition>()
  private readonly primary: CommandDefinition[] = []
  private readonly log: ScopedLogger

  constructor(
    private readonly config: AppConfig,
    private readonly runtime: BotRuntime,
    private readonly tasks: TaskManager,
    private readonly store: StateStore,
    logger: Logger
  ) {
    this.log = logger.child('commands')
  }

  register(definition: CommandDefinition): void {
    const names = [definition.name, ...(definition.aliases ?? [])].map((name) => name.toLowerCase())
    for (const name of names) {
      if (this.definitions.has(name)) throw new Error(`Duplicate command name: ${name}`)
      this.definitions.set(name, definition)
    }
    this.primary.push(definition)
  }

  commands(): readonly CommandDefinition[] {
    return [...this.primary].sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }

  find(name: string): CommandDefinition | undefined {
    return this.definitions.get(name.toLowerCase())
  }

  async execute(input: string, options: ExecuteOptions): Promise<CommandResult> {
    const messages: string[] = []
    const reply = async (message: string): Promise<void> => {
      const safe = safeMessage(message)
      if (!safe) return
      messages.push(safe)
      await options.reply?.(safe)
    }
    const replyError = async (message: string): Promise<void> => {
      if (options.source === 'chat' && !this.config.commands.announceErrorsInChat) return
      await reply(message)
    }

    let command: ParsedCommand
    try {
      command = parseCommand(input)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.debug('Rejected malformed command', { source: options.source, actor: options.actor, message })
      await replyError(`Syntax: ${message}`)
      return { ok: false, code: 'BAD_COMMAND', messages }
    }

    const definition = this.find(command.name)
    if (!definition) {
      this.log.debug('Rejected unknown command', { command: command.name, source: options.source, actor: options.actor })
      await replyError(`Unknown command "${command.name}". Try help.`)
      return { ok: false, code: 'BAD_COMMAND', messages }
    }

    if (!this.authorized(definition, options)) {
      this.log.warn('Rejected unauthorized command', { command: definition.name, source: options.source, actor: options.actor })
      await replyError('Not authorized for that command.')
      return { ok: false, code: 'NOT_AUTHORIZED', messages }
    }
    if (definition.requiresSpawn && !this.runtime.isSpawned) {
      this.log.debug('Command requires a spawned bot', { command: definition.name, source: options.source, actor: options.actor })
      await replyError('The bot has not spawned yet. Check the server and connection status.')
      return { ok: false, code: 'NOT_READY', messages }
    }

    this.log.info('Command accepted', { command: definition.name, source: options.source, actor: options.actor })
    const context: CommandContext = {
      source: options.source,
      actor: options.actor,
      config: this.config,
      runtime: this.runtime,
      tasks: this.tasks,
      store: this.store,
      logger: this.log,
      router: this
    }

    try {
      const output = await definition.execute(context, command)
      if (typeof output === 'string') await reply(output)
      else if (Array.isArray(output)) for (const message of output) await reply(message)
      return { ok: true, code: 'OK', messages }
    } catch (error) {
      const expected = error instanceof CommandSyntaxError
        || (error instanceof Error && ['TaskBusyError', 'TaskCancelledError'].includes(error.name))
      const message = error instanceof Error ? error.message : String(error)
      if (expected) this.log.debug('Command rejected', { command: definition.name, message })
      else this.log.error(`Command failed: ${definition.name}`, error)
      await replyError(`${expected ? 'Cannot run command' : 'Command failed'}: ${message}`)
      return { ok: false, code: expected ? 'BAD_COMMAND' : 'FAILED', messages }
    }
  }

  private authorized(definition: CommandDefinition, options: ExecuteOptions): boolean {
    if (options.source !== 'chat') return true
    if (definition.localOnly) return false
    if (this.config.commands.publicCommands.map((name) => name.toLowerCase()).includes(definition.name.toLowerCase())) return true
    return this.config.commands.allowlist.some((name) => name.toLowerCase() === options.actor.toLowerCase())
  }
}

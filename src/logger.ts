import { EventEmitter } from 'node:events'
import { stripVTControlCharacters } from 'node:util'
import type { LogLevel } from './types.js'

export interface LogEntry {
  id: number
  timestamp: string
  level: LogLevel
  scope: string
  message: string
  data?: unknown
}

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
}

function terminalText(value: string, multiline = false): string {
  const stripped = stripVTControlCharacters(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu, '')
    .replaceAll('\r', '')
  return multiline ? stripped.replaceAll('\n', '\n    ') : stripped.replace(/[\n\t]+/gu, ' ')
}

function printableData(data: unknown): string {
  if (data === undefined) return ''
  if (data instanceof Error) return ` ${terminalText(data.stack ?? data.message, true)}`
  try {
    return ` ${terminalText(JSON.stringify(data))}`
  } catch {
    return ` ${terminalText(String(data))}`
  }
}

export class Logger extends EventEmitter {
  private readonly entries: LogEntry[] = []
  private nextId = 1

  constructor(
    private readonly minimumLevel: LogLevel = 'info',
    private readonly maxEntries = 500
  ) {
    super()
  }

  child(scope: string): ScopedLogger {
    return new ScopedLogger(this, scope)
  }

  write(level: LogLevel, scope: string, message: string, data?: unknown): LogEntry {
    const entry: LogEntry = {
      id: this.nextId++,
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
      ...(data === undefined ? {} : { data })
    }
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) this.entries.splice(0, this.entries.length - this.maxEntries)

    if (LEVEL_VALUE[level] >= LEVEL_VALUE[this.minimumLevel]) {
      const method = level === 'debug' ? 'debug' : level === 'info' ? 'info' : level === 'warn' ? 'warn' : 'error'
      console[method](`[${entry.timestamp}] ${level.toUpperCase()} ${terminalText(scope)}: ${terminalText(message)}${printableData(data)}`)
    }
    this.emit('entry', entry)
    return entry
  }

  recent(afterId = 0, limit = 100): LogEntry[] {
    const safeLimit = Math.max(1, Math.min(limit, this.maxEntries))
    return this.entries.filter((entry) => entry.id > afterId).slice(-safeLimit)
  }
}

export class ScopedLogger {
  constructor(private readonly root: Logger, private readonly scope: string) {}

  debug(message: string, data?: unknown): void { this.root.write('debug', this.scope, message, data) }
  info(message: string, data?: unknown): void { this.root.write('info', this.scope, message, data) }
  warn(message: string, data?: unknown): void { this.root.write('warn', this.scope, message, data) }
  error(message: string, data?: unknown): void { this.root.write('error', this.scope, message, data) }
}

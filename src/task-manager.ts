import { EventEmitter } from 'node:events'
import type { ScopedLogger } from './logger.js'
import type { TaskSnapshot } from './types.js'

export class TaskBusyError extends Error {
  constructor(label: string) {
    super(`Task "${label}" is already running. Use stop first, or add --replace.`)
    this.name = 'TaskBusyError'
  }
}

export class TaskCancelledError extends Error {
  constructor(reason = 'Task cancelled') {
    super(reason)
    this.name = 'TaskCancelledError'
  }
}

export interface TaskContext {
  readonly id: number
  readonly label: string
  readonly signal: AbortSignal
  checkpoint(): void
  sleep(milliseconds: number): Promise<void>
}

export interface TaskHandle {
  id: number
  label: string
  done: Promise<void>
}

interface RunningTask {
  id: number
  label: string
  startedAtMs: number
  controller: AbortController
  state: 'running' | 'cancelling'
  done: Promise<void>
  cleanup(): Promise<void>
}

export interface StartTaskOptions {
  replace?: boolean
  timeoutMs?: number
}

function cancellationFrom(signal: AbortSignal): TaskCancelledError {
  const reason = signal.reason
  return reason instanceof TaskCancelledError
    ? reason
    : new TaskCancelledError(reason instanceof Error ? reason.message : String(reason ?? 'Task cancelled'))
}

export class TaskManager extends EventEmitter {
  private current?: RunningTask
  private nextId = 1

  constructor(
    private readonly logger: ScopedLogger,
    private readonly defaultTimeoutMs: number,
    private readonly onCancel?: () => void | Promise<void>
  ) {
    super()
  }

  snapshot(): TaskSnapshot | undefined {
    if (!this.current) return undefined
    return {
      id: this.current.id,
      label: this.current.label,
      startedAt: new Date(this.current.startedAtMs).toISOString(),
      elapsedMs: Date.now() - this.current.startedAtMs,
      state: this.current.state
    }
  }

  start(label: string, worker: (context: TaskContext) => Promise<void>, options: StartTaskOptions = {}): TaskHandle {
    let previousTask: Promise<void> | undefined
    if (this.current) {
      if (!options.replace) throw new TaskBusyError(this.current.label)
      previousTask = this.current.done
      this.cancel(`Replaced by ${label}`)
    }

    const id = this.nextId++
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    const startedAtMs = Date.now()
    let cleanupPromise: Promise<void> | undefined
    const cleanup = (): Promise<void> => {
      cleanupPromise ??= Promise.resolve()
        .then(() => this.onCancel?.())
        .then(() => undefined)
        .catch((error) => this.logger.warn('Physical-action cleanup failed', error))
      return cleanupPromise
    }

    const context: TaskContext = {
      id,
      label,
      signal: controller.signal,
      checkpoint: () => {
        if (controller.signal.aborted) throw cancellationFrom(controller.signal)
      },
      sleep: async (milliseconds: number) => {
        if (controller.signal.aborted) throw cancellationFrom(controller.signal)
        await new Promise<void>((resolve, reject) => {
          const finish = (): void => {
            controller.signal.removeEventListener('abort', abort)
            resolve()
          }
          const timer = setTimeout(finish, milliseconds)
          const abort = (): void => {
            clearTimeout(timer)
            reject(cancellationFrom(controller.signal))
          }
          controller.signal.addEventListener('abort', abort, { once: true })
        })
      }
    }

    const timeout = setTimeout(() => {
      controller.abort(new TaskCancelledError(`Task exceeded ${Math.round(timeoutMs / 1000)}s safety timeout`))
      void cleanup()
    }, timeoutMs)

    const done = (async () => {
      try {
        if (previousTask) await previousTask
        context.checkpoint()
        await worker(context)
        context.checkpoint()
        this.logger.info(`Completed task: ${label}`)
        this.emit('completed', { id, label })
      } catch (error) {
        await cleanup()
        if (controller.signal.aborted || error instanceof TaskCancelledError) {
          this.logger.info(`Stopped task: ${label}`, { reason: (error as Error).message })
          this.emit('cancelled', { id, label, error })
        } else {
          this.logger.error(`Task failed: ${label}`, error)
          this.emit('failed', { id, label, error })
        }
      } finally {
        clearTimeout(timeout)
        if (this.current?.id === id) {
          this.current = undefined
          this.emit('changed', undefined)
        }
      }
    })()

    this.current = { id, label, startedAtMs, controller, state: 'running', done, cleanup }
    this.logger.info(`Started task: ${label}`)
    this.emit('changed', this.snapshot())
    return { id, label, done }
  }

  cancel(reason = 'Stopped by command'): boolean {
    if (!this.current) return false
    this.current.state = 'cancelling'
    this.current.controller.abort(new TaskCancelledError(reason))
    this.emit('changed', this.snapshot())
    void this.current.cleanup()
    return true
  }

  async waitForIdle(): Promise<void> {
    while (this.current) await this.current.done
  }
}

import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { isIP, type AddressInfo } from 'node:net'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Logger, ScopedLogger } from './logger.js'
import type { AppConfig, BotStatus } from './types.js'

const MAX_JSON_BODY_BYTES = 16 * 1024
const MAX_COMMAND_LENGTH = 1_000
const MAX_LOG_LIMIT = 500

const STATIC_FILES: Readonly<Record<string, { name: string; contentType: string }>> = {
  '/': { name: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/index.html': { name: 'index.html', contentType: 'text/html; charset=utf-8' },
  '/styles.css': { name: 'styles.css', contentType: 'text/css; charset=utf-8' },
  '/app.js': { name: 'app.js', contentType: 'text/javascript; charset=utf-8' }
}

export type StatusProvider = () => BotStatus | Promise<BotStatus>
export type DashboardCommandExecutor = (command: string) => unknown | Promise<unknown>

class HttpError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeHostname(value: string): string {
  const unwrapped = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const zoneIndex = unwrapped.indexOf('%')
  return (zoneIndex === -1 ? unwrapped : unwrapped.slice(0, zoneIndex)).replace(/\.$/, '')
}

/** True for hostnames and address literals that cannot route off this machine. */
export function isLoopbackHost(value: string): boolean {
  const host = normalizeHostname(value)
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  const family = isIP(host)
  if (family === 4) return host.split('.')[0] === '127'
  if (family === 6) {
    if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
    const mapped = /^::ffff:(127(?:\.\d{1,3}){3})$/.exec(host)
    return Boolean(mapped && isIP(mapped[1] ?? '') === 4)
  }
  return false
}

function requestHostname(request: IncomingMessage): string | undefined {
  const hostHeader = request.headers.host
  if (!hostHeader) return request.socket.localAddress
  try {
    return new URL(`http://${hostHeader}`).hostname
  } catch {
    return undefined
  }
}

function constantTimeTokenMatches(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual)
  const expectedBytes = Buffer.from(expected)
  if (actualBytes.length !== expectedBytes.length) return false

  // A local implementation keeps this module dependency-free while avoiding a
  // character-by-character early exit for dashboard credentials.
  let difference = 0
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= (actualBytes[index] ?? 0) ^ (expectedBytes[index] ?? 0)
  }
  return difference === 0
}

function hasValidBearerToken(request: IncomingMessage, expected: string): boolean {
  const authorization = request.headers.authorization
  if (!authorization) return false
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim())
  return Boolean(match && constantTimeTokenMatches(match[1] ?? '', expected))
}

function jsonStringify(value: unknown): string {
  const seen = new WeakSet<object>()
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (typeof nested === 'bigint') return nested.toString()
    if (nested instanceof Error) {
      return { name: nested.name, message: nested.message }
    }
    if (nested && typeof nested === 'object') {
      if (seen.has(nested)) return '[Circular]'
      seen.add(nested)
    }
    return nested
  }) ?? 'null'
}

function applySecurityHeaders(response: ServerResponse): void {
  response.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self'",
    "font-src 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self'"
  ].join('; '))
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
}

function sendJson(response: ServerResponse, statusCode: number, value: unknown): void {
  const body = jsonStringify(value)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function sendMethodNotAllowed(response: ServerResponse, allowed: string): void {
  response.setHeader('Allow', allowed)
  sendJson(response, 405, { ok: false, error: 'Method not allowed' })
}

function nonNegativeInteger(raw: string | null, fallback: number): number {
  if (raw === null || raw.trim() === '') return fallback
  if (!/^\d+$/.test(raw)) return fallback
  const value = Number(raw)
  return Number.isSafeInteger(value) ? value : fallback
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declaredLength = Number(request.headers['content-length'])
  if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
    request.resume()
    throw new HttpError(413, 'Request body is too large')
  }

  const chunks: Buffer[] = []
  let received = 0
  let exceededLimit = false
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    received += buffer.length
    if (received > MAX_JSON_BODY_BYTES) {
      exceededLimit = true
      chunks.length = 0
      continue
    }
    if (!exceededLimit) chunks.push(buffer)
  }

  if (exceededLimit) throw new HttpError(413, 'Request body is too large')
  if (received === 0) throw new HttpError(400, 'A JSON request body is required')
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON')
  }
}

function findPublicDirectory(): string {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(moduleDirectory, '../public'),
    resolve(moduleDirectory, '../../public'),
    resolve(process.cwd(), 'public')
  ]
  return candidates.find((candidate) => existsSync(resolve(candidate, 'index.html'))) ?? candidates[0]!
}

function urlHost(host: string): string {
  const normalized = normalizeHostname(host)
  return isIP(normalized) === 6 ? `[${normalized}]` : normalized
}

/**
 * Small, dependency-free dashboard server. Static files are intentionally
 * public so a browser can load the token prompt; every API route requires the
 * configured bearer token.
 */
export class DashboardServer {
  private server?: Server
  private startPromise?: Promise<string | undefined>
  private startedAt = 0
  private _addressUrl?: string
  private readonly log: ScopedLogger
  private readonly publicDirectory = findPublicDirectory()
  private readonly authFailures = new Map<string, { attempts: number, resetAt: number }>()
  private readonly instanceId = randomUUID()

  constructor(
    private readonly config: AppConfig,
    private readonly rootLogger: Logger,
    private readonly getStatus: StatusProvider,
    private readonly executeCommand: DashboardCommandExecutor
  ) {
    this.log = rootLogger.child('dashboard')
  }

  get addressUrl(): string | undefined {
    return this._addressUrl
  }

  get isRunning(): boolean {
    return Boolean(this.server?.listening)
  }

  async start(): Promise<string | undefined> {
    if (!this.config.dashboard.enabled) {
      this.log.debug('Dashboard is disabled')
      return undefined
    }
    if (this.server?.listening) return this._addressUrl
    if (this.startPromise) return this.startPromise

    const { host, port, authToken } = this.config.dashboard
    if (!isLoopbackHost(host) && authToken.length === 0) {
      throw new Error('Dashboard may only bind to a non-loopback host when dashboard.authToken is set')
    }
    if (!isLoopbackHost(host) && authToken.length < 32) {
      throw new Error('A non-loopback dashboard requires an authToken of at least 32 characters')
    }

    this.startPromise = new Promise<string>((resolveStart, rejectStart) => {
      const server = createServer((request, response) => {
        applySecurityHeaders(response)
        void this.handleRequest(request, response).catch((error: unknown) => {
          if (response.headersSent || response.writableEnded) {
            response.destroy(error instanceof Error ? error : undefined)
            return
          }
          const statusCode = error instanceof HttpError ? error.statusCode : 500
          if (statusCode >= 500) this.log.error('Dashboard request failed', error)
          sendJson(response, statusCode, {
            ok: false,
            error: statusCode >= 500 ? 'Internal dashboard error' : errorMessage(error)
          })
        })
      })

      server.requestTimeout = 15_000
      server.headersTimeout = 10_000
      server.keepAliveTimeout = 5_000
      server.maxHeadersCount = 64
      this.server = server

      const onStartupError = (error: Error): void => {
        this.server = undefined
        this._addressUrl = undefined
        rejectStart(error)
      }
      server.once('error', onStartupError)
      server.listen(port, host, () => {
        server.off('error', onStartupError)
        server.on('error', (error) => this.log.error('Dashboard server error', error))
        const address = server.address() as AddressInfo | null
        const boundPort = address?.port ?? port
        this.startedAt = Date.now()
        this._addressUrl = `http://${urlHost(host)}:${boundPort}`
        this.log.info(`Dashboard listening at ${this._addressUrl}`)
        resolveStart(this._addressUrl)
      })
    }).finally(() => {
      this.startPromise = undefined
    })

    return this.startPromise
  }

  async stop(): Promise<void> {
    if (this.startPromise) {
      try { await this.startPromise } catch { /* Startup already reported its error. */ }
    }

    const server = this.server
    if (!server) return
    this.server = undefined
    this._addressUrl = undefined

    await new Promise<void>((resolveStop, rejectStop) => {
      const forceClose = setTimeout(() => server.closeAllConnections(), 2_000)
      forceClose.unref()
      server.close((error) => {
        clearTimeout(forceClose)
        if (error) rejectStop(error)
        else resolveStop()
      })
      server.closeIdleConnections()
    })
    this.log.info('Dashboard stopped')
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET'
    let url: URL
    try {
      url = new URL(request.url ?? '/', 'http://brobot.invalid')
    } catch {
      throw new HttpError(400, 'Malformed request URL')
    }

    if (url.pathname.startsWith('/api/')) {
      const token = this.config.dashboard.authToken
      const hostname = requestHostname(request)
      if (!token && (!hostname || !isLoopbackHost(hostname))) {
        throw new HttpError(403, 'Dashboard requests without authentication must use a loopback host')
      }
      if (token && !hasValidBearerToken(request, token)) {
        const remote = request.socket.remoteAddress ?? 'unknown'
        const now = Date.now()
        const previous = this.authFailures.get(remote)
        const failure = !previous || previous.resetAt <= now
          ? { attempts: 1, resetAt: now + 60_000 }
          : { attempts: previous.attempts + 1, resetAt: previous.resetAt }
        this.authFailures.set(remote, failure)
        if (this.authFailures.size > 1_000) this.authFailures.delete(this.authFailures.keys().next().value ?? '')
        if (failure.attempts === 1 || failure.attempts === 10) {
          this.log.warn('Rejected dashboard authentication', { remote, attempts: failure.attempts })
        }
        if (failure.attempts > 10) {
          response.setHeader('Retry-After', String(Math.max(1, Math.ceil((failure.resetAt - now) / 1_000))))
          sendJson(response, 429, { ok: false, error: 'Too many authentication failures; try again later' })
          return
        }
        response.setHeader('WWW-Authenticate', 'Bearer realm="BroBot Dashboard"')
        sendJson(response, 401, { ok: false, error: 'A valid dashboard bearer token is required' })
        return
      }
      if (token) this.authFailures.delete(request.socket.remoteAddress ?? 'unknown')
    }

    if (url.pathname === '/api/health') {
      if (method !== 'GET') return sendMethodNotAllowed(response, 'GET')
      sendJson(response, 200, {
        ok: true,
        service: 'brobot-dashboard',
        instanceId: this.instanceId,
        timestamp: new Date().toISOString(),
        uptimeSeconds: this.startedAt ? Math.floor((Date.now() - this.startedAt) / 1_000) : 0
      })
      return
    }

    if (url.pathname === '/api/status') {
      if (method !== 'GET') return sendMethodNotAllowed(response, 'GET')
      sendJson(response, 200, await this.getStatus())
      return
    }

    if (url.pathname === '/api/logs') {
      if (method !== 'GET') return sendMethodNotAllowed(response, 'GET')
      const after = nonNegativeInteger(url.searchParams.get('after'), 0)
      const limit = Math.min(nonNegativeInteger(url.searchParams.get('limit'), 100), MAX_LOG_LIMIT)
      sendJson(response, 200, this.rootLogger.recent(after, Math.max(1, limit)))
      return
    }

    if (url.pathname === '/api/command') {
      if (method !== 'POST') return sendMethodNotAllowed(response, 'POST')
      const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase()
      if (contentType !== 'application/json') throw new HttpError(415, 'Content-Type must be application/json')
      const body = await readJsonBody(request)
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new HttpError(400, 'Request body must be an object with a command string')
      }
      const commandValue = (body as Record<string, unknown>).command
      if (typeof commandValue !== 'string' || !commandValue.trim()) {
        throw new HttpError(400, 'command must be a non-empty string')
      }
      const command = commandValue.trim()
      if (command.length > MAX_COMMAND_LENGTH) {
        throw new HttpError(413, `command must be at most ${MAX_COMMAND_LENGTH} characters`)
      }

      this.log.info('Dashboard command received', { command })
      try {
        const result = await this.executeCommand(command)
        sendJson(response, 200, result)
      } catch (error) {
        this.log.warn('Dashboard command failed', { command, error: errorMessage(error) })
        sendJson(response, 400, { ok: false, error: errorMessage(error) })
      }
      return
    }

    const asset = STATIC_FILES[url.pathname]
    if (asset) {
      if (method !== 'GET' && method !== 'HEAD') return sendMethodNotAllowed(response, 'GET, HEAD')
      let body: Buffer
      try {
        body = await readFile(resolve(this.publicDirectory, asset.name))
      } catch (error) {
        this.log.error(`Dashboard asset is unavailable: ${asset.name}`, error)
        throw new HttpError(500, 'Dashboard asset is unavailable')
      }
      response.statusCode = 200
      response.setHeader('Content-Type', asset.contentType)
      response.setHeader('Cache-Control', 'no-cache')
      response.setHeader('Content-Length', body.length)
      response.end(method === 'HEAD' ? undefined : body)
      return
    }

    sendJson(response, 404, { ok: false, error: 'Not found' })
  }
}

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface, type Interface as ReadLineInterface } from 'node:readline'

export const HDSRC_PROCESS_PROTOCOL = 'hdsrc-process/0.1' as const
const DEFAULT_TIMEOUT_MS = 30_000
const MAX_STDERR_CHARS = 4096

export interface HdsrcJsonlProcessClientOptions {
  executable: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  cwd?: string
  timeoutMs?: number
  protocol?: string
}

interface PendingRequest {
  method: string
  resolve(value: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

interface ProcessErrorEnvelope {
  code?: unknown
  message?: unknown
  retryable?: unknown
}

interface ProcessResponse {
  protocol?: unknown
  id?: unknown
  result?: unknown
  error?: unknown
}

export class HdsrcProcessRemoteError extends Error {
  readonly code?: string
  readonly retryable: boolean

  constructor(message: string, options: { code?: string; retryable?: boolean } = {}) {
    super(message)
    this.name = 'HdsrcProcessRemoteError'
    this.code = options.code
    this.retryable = options.retryable === true
  }
}

export class HdsrcJsonlProcessClient {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #lines: ReadLineInterface
  readonly #pending = new Map<number, PendingRequest>()
  readonly #protocol: string
  readonly #defaultTimeoutMs: number
  #nextId = 1
  #closed = false
  #stderr = ''

  constructor(options: HdsrcJsonlProcessClientOptions) {
    if (!options.executable?.trim()) throw new Error('HDSRC process executable is required')
    this.#protocol = options.protocol?.trim() || HDSRC_PROCESS_PROTOCOL
    this.#defaultTimeoutMs = positiveTimeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    this.#child = spawn(options.executable, options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.env ? { env: options.env } : {}),
    })
    this.#lines = createInterface({ input: this.#child.stdout, crlfDelay: Infinity })
    this.#lines.on('line', line => this.#onLine(line))
    this.#child.stderr.setEncoding('utf8')
    this.#child.stderr.on('data', chunk => this.#captureStderr(String(chunk)))
    this.#child.on('error', error => this.#fatal(new Error(`HDSRC process error: ${error.message}`)))
    this.#child.on('exit', (code, signal) => {
      if (this.#closed) return
      const detail = code !== null ? `code ${code}` : `signal ${signal ?? 'unknown'}`
      this.#fatal(new Error(`HDSRC process exited with ${detail}${this.#stderrSuffix()}`), false)
    })
    this.#child.stdin.on('error', error => {
      if (!this.#closed) this.#fatal(new Error(`HDSRC process stdin failed: ${error.message}${this.#stderrSuffix()}`))
    })
    this.#child.stdout.on('error', error => {
      if (!this.#closed) this.#fatal(new Error(`HDSRC process stdout failed: ${error.message}${this.#stderrSuffix()}`))
    })
  }

  get closed(): boolean {
    return this.#closed
  }

  request(method: string, params: Record<string, unknown>, timeoutMs = this.#defaultTimeoutMs): Promise<unknown> {
    if (this.#closed) return Promise.reject(new Error('HDSRC process client is closed'))
    if (!method?.trim()) return Promise.reject(new Error('HDSRC process method is required'))
    if (!params || typeof params !== 'object' || Array.isArray(params)) {
      return Promise.reject(new Error('HDSRC process params must be an object'))
    }
    const id = this.#nextId++
    const timeout = positiveTimeout(timeoutMs)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.has(id)) return
        this.#fatal(new Error(`HDSRC process request ${method} timed out after ${timeout} ms${this.#stderrSuffix()}`))
      }, timeout)
      this.#pending.set(id, { method, resolve, reject, timer })
      const message = `${JSON.stringify({ protocol: this.#protocol, id, method, params })}\n`
      try {
        this.#child.stdin.write(message, 'utf8', error => {
          if (error && this.#pending.has(id)) {
            this.#fatal(new Error(`HDSRC process write failed: ${error.message}${this.#stderrSuffix()}`))
          }
        })
      } catch (error) {
        this.#fatal(asError(error, 'HDSRC process write failed'))
      }
    })
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    const error = new Error('HDSRC process client is closed')
    this.#rejectAll(error)
    try { this.#lines.close() } catch { /* no-op */ }
    try { this.#child.stdin.end() } catch { /* no-op */ }
    try { this.#child.kill() } catch { /* no-op */ }
  }

  #onLine(line: string): void {
    if (this.#closed) return
    let message: ProcessResponse
    try {
      const parsed: unknown = JSON.parse(line)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('response must be an object')
      message = parsed as ProcessResponse
    } catch (error) {
      this.#fatal(new Error(`Malformed HDSRC process JSON: ${asError(error).message}${this.#stderrSuffix()}`))
      return
    }

    if (message.protocol !== this.#protocol) {
      this.#fatal(new Error(`HDSRC process protocol mismatch: expected ${this.#protocol}`))
      return
    }
    if (!Number.isInteger(message.id) || (message.id as number) < 1) {
      this.#fatal(new Error('Malformed HDSRC process response id'))
      return
    }
    const id = message.id as number
    const hasResult = Object.prototype.hasOwnProperty.call(message, 'result')
    const hasError = Object.prototype.hasOwnProperty.call(message, 'error')
    if (hasResult === hasError) {
      this.#fatal(new Error('Malformed HDSRC process response must contain exactly one of result or error'))
      return
    }
    const pending = this.#pending.get(id)
    if (!pending) {
      this.#fatal(new Error(`Malformed HDSRC process response references unknown request id ${id}`))
      return
    }
    this.#pending.delete(id)
    clearTimeout(pending.timer)

    if (hasError) {
      pending.reject(remoteError(message.error, pending.method))
    } else {
      pending.resolve(message.result)
    }
  }

  #captureStderr(chunk: string): void {
    this.#stderr = `${this.#stderr}${chunk}`.slice(-MAX_STDERR_CHARS)
  }

  #stderrSuffix(): string {
    const stderr = this.#stderr.trim()
    return stderr ? `; stderr: ${stderr}` : ''
  }

  #fatal(error: Error, kill = true): void {
    if (this.#closed) return
    this.#closed = true
    this.#rejectAll(error)
    try { this.#lines.close() } catch { /* no-op */ }
    try { this.#child.stdin.destroy() } catch { /* no-op */ }
    if (kill) {
      try { this.#child.kill() } catch { /* no-op */ }
    }
  }

  #rejectAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

function positiveTimeout(value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error('HDSRC process timeout must be positive')
  return Math.max(1, Math.floor(value))
}

function asError(value: unknown, prefix?: string): Error {
  const base = value instanceof Error ? value : new Error(String(value))
  return prefix ? new Error(`${prefix}: ${base.message}`) : base
}

function remoteError(value: unknown, method: string): HdsrcProcessRemoteError {
  const envelope = value && typeof value === 'object' && !Array.isArray(value)
    ? value as ProcessErrorEnvelope
    : {}
  const message = typeof envelope.message === 'string' && envelope.message.trim()
    ? envelope.message.trim()
    : `HDSRC process request ${method} failed`
  const code = typeof envelope.code === 'string' && envelope.code.trim() ? envelope.code.trim() : undefined
  return new HdsrcProcessRemoteError(message, {
    ...(code ? { code } : {}),
    retryable: envelope.retryable === true,
  })
}

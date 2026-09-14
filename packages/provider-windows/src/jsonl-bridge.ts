import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import type {
  WindowsCaptureMount,
  WindowsNativeBridge,
  WindowsNativeWindow,
  WindowsProviderCapabilities,
  WindowsUiActionResult,
  WindowsUiSemanticAction,
  WindowsUiSnapshot,
  WindowsWindowResourceDescriptor,
} from './index.js'
import type { OverlayRect } from '../../portal-overlay/src/index.js'

export const WINDOWS_NATIVE_BRIDGE_PROTOCOL = 'mrmic-windows-native-bridge/v1' as const
export const WINDOWS_CAPTURE_SNAPSHOT_SCHEMA = 'windows_capture_snapshot_v1' as const
export const WINDOWS_CAPTURE_TRANSPORT = 'png_base64_snapshot_v1' as const
export const WINDOWS_CAPTURE_MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
export const WINDOWS_CAPTURE_MAX_SNAPSHOT_PIXELS = 8_294_400

interface BridgeRequest {
  protocol: typeof WINDOWS_NATIVE_BRIDGE_PROTOCOL
  requestId: string
  method: string
  params: Record<string, unknown>
}

interface BridgeSuccess {
  protocol: typeof WINDOWS_NATIVE_BRIDGE_PROTOCOL
  requestId: string
  ok: true
  result: unknown
}

interface BridgeFailure {
  protocol: typeof WINDOWS_NATIVE_BRIDGE_PROTOCOL
  requestId: string
  ok: false
  error: { code: string; message: string }
}

type BridgeResponse = BridgeSuccess | BridgeFailure

export interface WindowsCaptureSnapshot {
  schema: typeof WINDOWS_CAPTURE_SNAPSHOT_SCHEMA
  mountId: string
  providerResourceId: string
  frameSequence: number
  capturedAt: string
  width: number
  height: number
  mimeType: 'image/png'
  encodedBytes: number
  sha256: string
  bytesBase64: string
  transport: typeof WINDOWS_CAPTURE_TRANSPORT
}

export interface WindowsJsonlNativeBridgeOptions {
  command: string
  args?: string[]
  cwd?: string
  env?: Record<string, string | undefined>
  requestTimeoutMs?: number
}

export class WindowsNativeBridgeProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'WindowsNativeBridgeProtocolError'
    this.code = code
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', `${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string, max = 4096): string {
  if (typeof value !== 'string' || !value.trim()) throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', `${label} must be a non-empty string`)
  const normalized = value.trim()
  if (normalized.length > max) throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', `${label} exceeds ${max} characters`)
  return normalized
}

function positiveInteger(value: unknown, label: string, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > max) {
    throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', `${label} must be a positive integer within bounds`)
  }
  return Number(value)
}

function parseResponse(value: unknown): BridgeResponse {
  const input = record(value, 'response')
  if (input.protocol !== WINDOWS_NATIVE_BRIDGE_PROTOCOL) throw new WindowsNativeBridgeProtocolError('PROTOCOL_MISMATCH', 'Windows native bridge protocol mismatch')
  const requestId = text(input.requestId, 'response.requestId', 256)
  if (input.ok === true) {
    return { protocol: WINDOWS_NATIVE_BRIDGE_PROTOCOL, requestId, ok: true, result: input.result }
  }
  if (input.ok === false) {
    const error = record(input.error, 'response.error')
    return {
      protocol: WINDOWS_NATIVE_BRIDGE_PROTOCOL,
      requestId,
      ok: false,
      error: { code: text(error.code, 'response.error.code', 128), message: text(error.message, 'response.error.message') },
    }
  }
  throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', 'response.ok must be boolean')
}

function parseCaptureSnapshot(value: unknown, expected: WindowsCaptureMount): WindowsCaptureSnapshot {
  const input = record(value, 'capture.snapshot')
  if (input.schema !== WINDOWS_CAPTURE_SNAPSHOT_SCHEMA) throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', 'capture.snapshot schema mismatch')
  const mountId = text(input.mountId, 'capture.snapshot.mountId', 256)
  const providerResourceId = text(input.providerResourceId, 'capture.snapshot.providerResourceId', 512)
  if (mountId !== expected.mountId || providerResourceId !== expected.providerResourceId) {
    throw new WindowsNativeBridgeProtocolError('CAPTURE_IDENTITY_MISMATCH', 'capture.snapshot does not match the requested mount identity')
  }
  const width = positiveInteger(input.width, 'capture.snapshot.width', 32768)
  const height = positiveInteger(input.height, 'capture.snapshot.height', 32768)
  if (width * height > WINDOWS_CAPTURE_MAX_SNAPSHOT_PIXELS) throw new WindowsNativeBridgeProtocolError('FRAME_BOUNDS', 'capture.snapshot pixel count exceeds the transport bound')
  const encodedBytes = positiveInteger(input.encodedBytes, 'capture.snapshot.encodedBytes', WINDOWS_CAPTURE_MAX_SNAPSHOT_BYTES)
  const bytesBase64 = text(input.bytesBase64, 'capture.snapshot.bytesBase64', Math.ceil(WINDOWS_CAPTURE_MAX_SNAPSHOT_BYTES * 4 / 3) + 16)
  const decoded = Buffer.from(bytesBase64, 'base64')
  if (decoded.length !== encodedBytes) throw new WindowsNativeBridgeProtocolError('FRAME_INTEGRITY', 'capture.snapshot encoded byte length mismatch')
  const sha256 = text(input.sha256, 'capture.snapshot.sha256', 64).toLowerCase()
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new WindowsNativeBridgeProtocolError('FRAME_INTEGRITY', 'capture.snapshot sha256 is malformed')
  const actualSha256 = createHash('sha256').update(decoded).digest('hex')
  if (actualSha256 !== sha256) throw new WindowsNativeBridgeProtocolError('FRAME_INTEGRITY', 'capture.snapshot sha256 mismatch')
  if (input.mimeType !== 'image/png' || input.transport !== WINDOWS_CAPTURE_TRANSPORT) {
    throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', 'capture.snapshot transport metadata mismatch')
  }
  return {
    schema: WINDOWS_CAPTURE_SNAPSHOT_SCHEMA,
    mountId,
    providerResourceId,
    frameSequence: positiveInteger(input.frameSequence, 'capture.snapshot.frameSequence'),
    capturedAt: text(input.capturedAt, 'capture.snapshot.capturedAt', 128),
    width,
    height,
    mimeType: 'image/png',
    encodedBytes,
    sha256,
    bytesBase64,
    transport: WINDOWS_CAPTURE_TRANSPORT,
  }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: any
}

/**
 * Out-of-process Windows bridge client. A malformed line, unexpected process
 * exit or request timeout is terminal: the process is killed and all pending
 * requests fail closed. Callers must create a new provider epoch/session after
 * such a boundary rather than guessing whether HWND identities are still live.
 */
export class WindowsJsonlNativeBridge implements WindowsNativeBridge {
  readonly #options: WindowsJsonlNativeBridgeOptions
  readonly #pending = new Map<string, PendingRequest>()
  #process: any
  #closed = false
  #sequence = 0

  constructor(options: WindowsJsonlNativeBridgeOptions) {
    if (!options.command?.trim()) throw new Error('Windows native bridge command is required')
    this.#options = { ...options, args: [...(options.args ?? [])], requestTimeoutMs: options.requestTimeoutMs ?? 5000 }
  }

  async capabilities(): Promise<WindowsProviderCapabilities> {
    return await this.#request('capabilities', {}) as WindowsProviderCapabilities
  }

  async enumerateTopLevelWindows(): Promise<WindowsNativeWindow[]> {
    const result = await this.#request('window.enumerate', {})
    if (!Array.isArray(result)) throw new WindowsNativeBridgeProtocolError('INVALID_RESPONSE', 'window.enumerate result must be an array')
    return structuredClone(result) as WindowsNativeWindow[]
  }

  async mountCapture(resource: WindowsWindowResourceDescriptor, rect: OverlayRect): Promise<WindowsCaptureMount> {
    return await this.#request('capture.mount', this.#windowParams(resource, { rect })) as WindowsCaptureMount
  }

  async updateCapture(mount: WindowsCaptureMount, rect: OverlayRect): Promise<void> {
    await this.#request('capture.update', { mountId: mount.mountId, providerResourceId: mount.providerResourceId, rect })
  }

  async snapshotCapture(mount: WindowsCaptureMount): Promise<WindowsCaptureSnapshot> {
    const result = await this.#request('capture.snapshot', { mountId: mount.mountId, providerResourceId: mount.providerResourceId })
    return parseCaptureSnapshot(result, mount)
  }

  async unmountCapture(mount: WindowsCaptureMount): Promise<void> {
    await this.#request('capture.unmount', { mountId: mount.mountId, providerResourceId: mount.providerResourceId })
  }

  async inspectUi(resource: WindowsWindowResourceDescriptor): Promise<WindowsUiSnapshot> {
    return await this.#request('uia.inspect', this.#windowParams(resource)) as WindowsUiSnapshot
  }

  async performUiAction(resource: WindowsWindowResourceDescriptor, action: WindowsUiSemanticAction): Promise<WindowsUiActionResult> {
    return await this.#request('uia.action', this.#windowParams(resource, { action })) as WindowsUiActionResult
  }

  close(): void {
    if (this.#closed) return
    this.#closed = true
    try { this.#process?.kill?.() } catch { /* best effort */ }
    this.#failAll(new WindowsNativeBridgeProtocolError('BRIDGE_CLOSED', 'Windows native bridge client is closed'))
  }

  #windowParams(resource: WindowsWindowResourceDescriptor, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      providerResourceId: resource.providerResourceId,
      providerEpoch: resource.providerEpoch,
      hwndHex: resource.hwndHex,
      processId: resource.processId,
      ...extra,
    }
  }

  #ensureProcess(): any {
    if (this.#closed) throw new WindowsNativeBridgeProtocolError('BRIDGE_CLOSED', 'Windows native bridge client is closed')
    if (this.#process) return this.#process
    const child = spawn(this.#options.command, this.#options.args ?? [], {
      cwd: this.#options.cwd,
      env: this.#options.env ? { ...process.env, ...this.#options.env } : process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    this.#process = child
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity })
    lines.on('line', (line: string) => {
      if (!line.trim()) return
      try {
        const response = parseResponse(JSON.parse(line))
        const pending = this.#pending.get(response.requestId)
        if (!pending) throw new WindowsNativeBridgeProtocolError('UNKNOWN_REQUEST', `Unknown Windows bridge request ${response.requestId}`)
        clearTimeout(pending.timer)
        this.#pending.delete(response.requestId)
        if (response.ok) pending.resolve(response.result)
        else pending.reject(new WindowsNativeBridgeProtocolError(response.error.code, response.error.message))
      } catch (error) {
        this.#terminate(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.on('error', (error: Error) => this.#terminate(error))
    child.on('exit', (code: number | null, signal: string | null) => {
      if (!this.#closed) this.#terminate(new WindowsNativeBridgeProtocolError('PROCESS_EXIT', `Windows native bridge exited (${code ?? 'null'}/${signal ?? 'none'})`))
    })
    return child
  }

  #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const child = this.#ensureProcess()
    const requestId = `windows-${++this.#sequence}`
    const request: BridgeRequest = { protocol: WINDOWS_NATIVE_BRIDGE_PROTOCOL, requestId, method, params: structuredClone(params) }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.#pending.delete(requestId)) return
        const error = new WindowsNativeBridgeProtocolError('REQUEST_TIMEOUT', `Windows native bridge request timed out: ${method}`)
        reject(error)
        this.#terminate(error)
      }, this.#options.requestTimeoutMs ?? 5000)
      this.#pending.set(requestId, { resolve, reject, timer })
      try { child.stdin.write(`${JSON.stringify(request)}\n`) }
      catch (error) {
        clearTimeout(timer)
        this.#pending.delete(requestId)
        const normalized = error instanceof Error ? error : new Error(String(error))
        reject(normalized)
        this.#terminate(normalized)
      }
    })
  }

  #terminate(error: Error): void {
    const child = this.#process
    this.#process = undefined
    try { child?.kill?.() } catch { /* best effort */ }
    this.#failAll(error)
  }

  #failAll(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.#pending.clear()
  }
}

import type {
  AnyAppliedSyncUpdate,
  PresenceState,
  StateVector,
  SyncUpdate,
} from '../../state-vector-sync/src/index.js'

export interface SecurePresenceInput {
  label?: string
  color?: string
  cursor?: { x: number; y: number }
  viewport?: { x: number; y: number; width: number; height: number; zoom: number }
  selectedObjectIds?: string[]
  task?: string
}

export interface CanvasHelloIdentity {
  verified: true
  principalId: string
  semanticAgentId?: string | null
}

export interface CanvasHelloAck {
  type: 'hello_ack'
  roomId: string
  stateVector: StateVector
  missingUpdates: AnyAppliedSyncUpdate[]
  presence: PresenceState[]
  identity: CanvasHelloIdentity
}

export type SecureCanvasServerMessage =
  | CanvasHelloAck
  | { type: 'update'; update: AnyAppliedSyncUpdate; stateVector?: StateVector }
  | { type: 'presence'; presence: PresenceState }
  | { type: 'presence_removed'; clientId: string }
  | { type: 'pong'; at: string }
  | { type: 'error'; message: string }

export type SecureCanvasClientEvent =
  | { type: 'connected'; ack: CanvasHelloAck }
  | { type: 'update'; update: AnyAppliedSyncUpdate; stateVector: StateVector }
  | { type: 'presence'; presence: PresenceState }
  | { type: 'presence_removed'; clientId: string }
  | { type: 'pong'; at: string }
  | { type: 'server_error'; message: string }
  | { type: 'disconnected'; code?: number; reason?: string }

export interface WebSocketEventLike {
  data?: unknown
  code?: number
  reason?: string
}

export interface WebSocketLike {
  readyState: number
  addEventListener(type: 'open' | 'message' | 'error' | 'close', listener: (event: WebSocketEventLike) => void): void
  send(data: string): void
  close(code?: number, reason?: string): void
}

export type WebSocketFactory = (url: string) => WebSocketLike

export interface SecureCanvasSyncClientOptions {
  url: string
  clientId: string
  authToken: string
  initialStateVector?: StateVector
  initialPresence?: SecurePresenceInput
  webSocketFactory?: WebSocketFactory
  connectTimeoutMs?: number
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function normalizeUrl(value: string): string {
  const url = new URL(required(value, 'url'))
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') throw new Error('secure Canvas client url must use ws: or wss:')
  return url.toString()
}

function cloneVector(vector: StateVector): StateVector {
  return Object.fromEntries(Object.entries(vector).map(([key, value]) => [key, Number(value)]))
}

function validateVector(vector: unknown): StateVector {
  if (!vector || typeof vector !== 'object' || Array.isArray(vector)) throw new Error('stateVector must be an object')
  const result: StateVector = {}
  for (const [key, value] of Object.entries(vector as Record<string, unknown>)) {
    if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`stateVector.${key} must be a non-negative integer`)
    result[key] = Number(value)
  }
  return result
}

function mergeVector(current: StateVector, incoming: StateVector): StateVector {
  const merged = cloneVector(current)
  for (const [clientId, counter] of Object.entries(incoming)) {
    merged[clientId] = Math.max(merged[clientId] ?? 0, counter)
  }
  return merged
}

/** Presence payload intentionally excludes actor identity. */
export function sanitizeSecurePresence(value: SecurePresenceInput | Record<string, unknown> = {}): SecurePresenceInput {
  const input = value as Record<string, unknown>
  const result: SecurePresenceInput = {}
  if (typeof input.label === 'string' && input.label.trim()) result.label = input.label.trim()
  if (typeof input.color === 'string' && input.color.trim()) result.color = input.color.trim()
  if (input.cursor && typeof input.cursor === 'object' && !Array.isArray(input.cursor)) {
    const cursor = input.cursor as Record<string, unknown>
    if (typeof cursor.x === 'number' && Number.isFinite(cursor.x) && typeof cursor.y === 'number' && Number.isFinite(cursor.y)) {
      result.cursor = { x: cursor.x, y: cursor.y }
    }
  }
  if (input.viewport && typeof input.viewport === 'object' && !Array.isArray(input.viewport)) {
    const viewport = input.viewport as Record<string, unknown>
    const values = [viewport.x, viewport.y, viewport.width, viewport.height, viewport.zoom]
    if (values.every(value => typeof value === 'number' && Number.isFinite(value))) {
      const [x, y, width, height, zoom] = values as number[]
      if (width > 0 && height > 0 && zoom > 0) result.viewport = { x, y, width, height, zoom }
    }
  }
  if (Array.isArray(input.selectedObjectIds)) result.selectedObjectIds = input.selectedObjectIds.map(String)
  if (typeof input.task === 'string' && input.task.trim()) result.task = input.task.trim()
  return result
}

async function textOf(data: unknown): Promise<string> {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(new Uint8Array(data))
  if (ArrayBuffer.isView(data)) return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
  if (typeof Blob !== 'undefined' && data instanceof Blob) return await data.text()
  throw new Error('Unsupported WebSocket message payload')
}

function defaultWebSocketFactory(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike
}

function assertHelloAck(value: unknown): CanvasHelloAck {
  const ack = value as any
  if (!ack || ack.type !== 'hello_ack') throw new Error('expected hello_ack')
  required(ack.roomId, 'hello_ack.roomId')
  const vector = validateVector(ack.stateVector)
  if (!Array.isArray(ack.missingUpdates)) throw new Error('hello_ack.missingUpdates must be an array')
  if (!Array.isArray(ack.presence)) throw new Error('hello_ack.presence must be an array')
  if (!ack.identity || ack.identity.verified !== true) throw new Error('Canvas server did not verify PMW identity')
  const principalId = required(ack.identity.principalId, 'hello_ack.identity.principalId')
  const semanticAgentId = ack.identity.semanticAgentId == null ? null : required(ack.identity.semanticAgentId, 'hello_ack.identity.semanticAgentId')
  return {
    ...structuredClone(ack),
    stateVector: vector,
    identity: { verified: true, principalId, ...(semanticAgentId !== null ? { semanticAgentId } : { semanticAgentId: null }) },
  }
}

/**
 * Secure client for MRMIC's authenticated state-vector WebSocket protocol.
 *
 * Identity can only originate from the bearer binding token. Presence methods
 * expose no actorId/actorType fields. The client keeps the last state vector so
 * reconnects request only missing updates from the Canvas room.
 */
export class SecureCanvasSyncClient {
  readonly #url: string
  readonly #clientId: string
  readonly #authToken: string
  readonly #initialPresence?: SecurePresenceInput
  readonly #factory: WebSocketFactory
  readonly #connectTimeoutMs: number
  readonly #listeners = new Set<(event: SecureCanvasClientEvent) => void>()
  #socket?: WebSocketLike
  #vector: StateVector
  #roomId?: string
  #identity?: CanvasHelloIdentity
  #connected = false
  #connecting = false

  constructor(options: SecureCanvasSyncClientOptions) {
    this.#url = normalizeUrl(options.url)
    this.#clientId = required(options.clientId, 'clientId')
    this.#authToken = required(options.authToken, 'authToken')
    this.#vector = validateVector(options.initialStateVector ?? {})
    this.#initialPresence = options.initialPresence ? sanitizeSecurePresence(options.initialPresence) : undefined
    this.#factory = options.webSocketFactory ?? defaultWebSocketFactory
    this.#connectTimeoutMs = options.connectTimeoutMs ?? 5000
    if (!Number.isFinite(this.#connectTimeoutMs) || this.#connectTimeoutMs <= 0) throw new Error('connectTimeoutMs must be positive')
  }

  get connected(): boolean { return this.#connected }
  get roomId(): string | undefined { return this.#roomId }
  get identity(): CanvasHelloIdentity | undefined { return this.#identity ? structuredClone(this.#identity) : undefined }
  stateVector(): StateVector { return cloneVector(this.#vector) }
  nextCounter(): number { return (this.#vector[this.#clientId] ?? 0) + 1 }

  subscribe(listener: (event: SecureCanvasClientEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  async connect(): Promise<CanvasHelloAck> {
    if (this.#connected || this.#connecting) throw new Error('Canvas client is already connected or connecting')
    this.#connecting = true
    const socket = this.#factory(this.#url)
    this.#socket = socket

    return await new Promise<CanvasHelloAck>((resolve, reject) => {
      let settled = false
      const timer = setTimeout(() => fail(new Error('Canvas hello timeout')), this.#connectTimeoutMs)
      const finish = (ack: CanvasHelloAck) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#connecting = false
        this.#connected = true
        this.#roomId = ack.roomId
        this.#identity = structuredClone(ack.identity)
        this.#vector = mergeVector(this.#vector, ack.stateVector)
        this.#emit({ type: 'connected', ack: structuredClone(ack) })
        resolve(structuredClone(ack))
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.#connecting = false
        this.#connected = false
        try { socket.close(1008, 'hello failed') } catch {}
        reject(error)
      }

      socket.addEventListener('open', () => {
        try {
          socket.send(JSON.stringify({
            type: 'hello',
            clientId: this.#clientId,
            stateVector: cloneVector(this.#vector),
            authToken: this.#authToken,
            ...(this.#initialPresence ? { presence: sanitizeSecurePresence(this.#initialPresence) } : {}),
          }))
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)))
        }
      })

      socket.addEventListener('message', event => {
        void textOf(event.data).then(text => {
          let value: any
          try { value = JSON.parse(text) }
          catch { throw new Error('Canvas server sent invalid JSON') }
          if (!settled) {
            if (value?.type === 'error') {
              fail(new Error(`Canvas server rejected connection: ${String(value.message ?? 'unknown error')}`))
              return
            }
            if (value?.type !== 'hello_ack') return
            try { finish(assertHelloAck(value)) }
            catch (error) { fail(error instanceof Error ? error : new Error(String(error))) }
            return
          }
          this.#handleMessage(value)
        }).catch(error => {
          if (!settled) fail(error instanceof Error ? error : new Error(String(error)))
          else this.#emit({ type: 'server_error', message: error instanceof Error ? error.message : String(error) })
        })
      })

      socket.addEventListener('error', () => fail(new Error('Canvas WebSocket error during connection')))
      socket.addEventListener('close', event => {
        const wasConnected = this.#connected
        this.#connected = false
        this.#connecting = false
        this.#socket = undefined
        if (!settled) fail(new Error('Canvas WebSocket closed before verified hello_ack'))
        else if (wasConnected) this.#emit({ type: 'disconnected', code: event.code, reason: event.reason })
      })
    })
  }

  sendPresence(presence: SecurePresenceInput | Record<string, unknown>): void {
    this.#send({ type: 'presence', presence: sanitizeSecurePresence(presence) })
  }

  sendUpdate(update: SyncUpdate): void {
    if (update.clientId !== this.#clientId) throw new Error('SyncUpdate.clientId must match secure Canvas clientId')
    this.#send({ type: 'update', update: structuredClone(update) })
  }

  ping(): void { this.#send({ type: 'ping' }) }

  disconnect(code = 1000, reason = 'client disconnect'): void {
    const socket = this.#socket
    this.#socket = undefined
    this.#connected = false
    this.#connecting = false
    if (socket) socket.close(code, reason)
  }

  #send(payload: unknown): void {
    if (!this.#connected || !this.#socket || this.#socket.readyState !== 1) throw new Error('Canvas client is not connected')
    this.#socket.send(JSON.stringify(payload))
  }

  #handleMessage(value: any): void {
    if (!value || typeof value.type !== 'string') {
      this.#emit({ type: 'server_error', message: 'Canvas server message is missing type' })
      return
    }
    if (value.type === 'update') {
      if (value.stateVector) this.#vector = mergeVector(this.#vector, validateVector(value.stateVector))
      else if (value.update?.clientId && Number.isInteger(value.update?.counter)) {
        this.#vector[value.update.clientId] = Math.max(this.#vector[value.update.clientId] ?? 0, Number(value.update.counter))
      }
      this.#emit({ type: 'update', update: structuredClone(value.update), stateVector: cloneVector(this.#vector) })
      return
    }
    if (value.type === 'presence') {
      this.#emit({ type: 'presence', presence: structuredClone(value.presence) })
      return
    }
    if (value.type === 'presence_removed') {
      this.#emit({ type: 'presence_removed', clientId: String(value.clientId ?? '') })
      return
    }
    if (value.type === 'pong') {
      this.#emit({ type: 'pong', at: String(value.at ?? '') })
      return
    }
    if (value.type === 'error') {
      this.#emit({ type: 'server_error', message: String(value.message ?? 'unknown Canvas server error') })
    }
  }

  #emit(event: SecureCanvasClientEvent): void {
    for (const listener of this.#listeners) listener(structuredClone(event))
  }
}

import type { ActorRef, CanvasObject, Transform2D } from '../../canvas-schema/src/index.js'
import { validateCanvasObject } from '../../canvas-schema/src/index.js'

export type AiBoardMessageType = 'comment' | 'suggestion' | 'extension' | 'objection' | 'correction' | 'reply' | 'diff'

export interface AiBoardIdentity {
  eigenself: string
  slice: string
  instance: string
}

export interface AiBoardMessage {
  id: string
  ts: number
  eigenself: string
  slice: string
  instance: string
  topic?: string | null
  message_type: AiBoardMessageType | string
  parent_id?: string | null
  content: string
  meta?: string | null
  paper_ref?: string | null
  paper_url?: string | null
  children?: AiBoardMessage[]
}

export interface AiBoardPostPayload {
  content: string
  identity: AiBoardIdentity
  message_type?: AiBoardMessageType
  parent_id?: string
  topic?: string
  paper_ref?: string
  meta?: Record<string, unknown>
  summary_levels?: string[]
}

export interface AiBoardPostResult {
  ok: true
  id: string
  ts: number
  identity: AiBoardIdentity
  topic?: string | null
  paper_ref?: string | null
  paper_url?: string | null
}

export interface AiBoardThreadProjection {
  provider: 'ai_board'
  providerResourceId: string
  resourceUri: string
  root: {
    id: string
    ts: number
    topic?: string | null
    messageType: string
    contentPreview: string
  }
  messageCount: number
  latestTs: number
  participants: AiBoardIdentity[]
  objectionCount: number
  correctionCount: number
}

export interface AiBoardThreadApplyResult {
  accepted: boolean
  state: AiBoardThreadProjection
  reason?: 'stale_thread'
}

export type AiBoardFetch = (input: string, init?: RequestInit) => Promise<Response>

const messageTypes = new Set<AiBoardMessageType>([
  'comment', 'suggestion', 'extension', 'objection', 'correction', 'reply', 'diff',
])

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function normalizedBaseUrl(value: string): string {
  const url = required(value, 'AI Board baseUrl').replace(/\/+$/, '')
  new URL(url)
  return url
}

function assertIdentity(identity: AiBoardIdentity): void {
  required(identity.eigenself, 'identity.eigenself')
  required(identity.slice, 'identity.slice')
  required(identity.instance, 'identity.instance')
}

function assertMessage(message: AiBoardMessage): void {
  required(message.id, 'message.id')
  if (!Number.isFinite(message.ts) || message.ts < 0) throw new Error('message.ts must be a non-negative finite number')
  required(message.eigenself, 'message.eigenself')
  required(message.slice, 'message.slice')
  required(message.instance, 'message.instance')
  required(message.content, 'message.content')
  required(message.message_type, 'message.message_type')
}

function identityOf(message: AiBoardMessage): AiBoardIdentity {
  return {
    eigenself: message.eigenself,
    slice: message.slice,
    instance: message.instance,
  }
}

function identityKey(identity: AiBoardIdentity): string {
  return `${identity.eigenself}\u0000${identity.slice}\u0000${identity.instance}`
}

function flattenThread(root: AiBoardMessage): AiBoardMessage[] {
  assertMessage(root)
  const out: AiBoardMessage[] = []
  const seen = new Set<string>()
  const stack: AiBoardMessage[] = [root]
  while (stack.length) {
    const current = stack.pop()!
    assertMessage(current)
    if (seen.has(current.id)) continue
    seen.add(current.id)
    out.push(current)
    const children = Array.isArray(current.children) ? current.children : []
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
  }
  return out
}

function boardResourceUri(threadId: string): string {
  return `aiboard://thread/${encodeURIComponent(threadId)}`
}

/**
 * Thin HTTP client over AI Board's canonical HTTP ledger API.
 * It never invents the board's 3D identity tuple: callers must supply all
 * eigenself/slice/instance fields explicitly when posting.
 */
export class AiBoardHttpClient {
  readonly #baseUrl: string
  readonly #fetch: AiBoardFetch

  constructor(baseUrl: string, fetchImpl: AiBoardFetch = fetch) {
    this.#baseUrl = normalizedBaseUrl(baseUrl)
    this.#fetch = fetchImpl
  }

  async getThread(id: string): Promise<AiBoardMessage> {
    const threadId = required(id, 'thread id')
    const response = await this.#fetch(`${this.#baseUrl}/api/thread?id=${encodeURIComponent(threadId)}`, {
      headers: { accept: 'application/json' },
    })
    const body = await response.json() as any
    if (!response.ok || body?.error) throw new Error(`AI Board getThread failed: ${body?.error ?? response.status}`)
    assertMessage(body as AiBoardMessage)
    return structuredClone(body as AiBoardMessage)
  }

  async postMessage(payload: AiBoardPostPayload): Promise<AiBoardPostResult> {
    assertIdentity(payload.identity)
    required(payload.content, 'content')
    if (payload.message_type && !messageTypes.has(payload.message_type)) throw new Error(`Unsupported AI Board message_type: ${payload.message_type}`)
    const response = await this.#fetch(`${this.#baseUrl}/api/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await response.json() as any
    if (!response.ok || body?.ok !== true) throw new Error(`AI Board postMessage failed: ${body?.error ?? response.status}`)
    return structuredClone(body as AiBoardPostResult)
  }
}

export function toAiBoardThreadProjection(root: AiBoardMessage): AiBoardThreadProjection {
  const messages = flattenThread(root)
  const participants = new Map<string, AiBoardIdentity>()
  let latestTs = root.ts
  let objectionCount = 0
  let correctionCount = 0
  for (const message of messages) {
    latestTs = Math.max(latestTs, message.ts)
    const identity = identityOf(message)
    participants.set(identityKey(identity), identity)
    if (message.message_type === 'objection') objectionCount += 1
    if (message.message_type === 'correction') correctionCount += 1
  }
  return {
    provider: 'ai_board',
    providerResourceId: root.id,
    resourceUri: boardResourceUri(root.id),
    root: {
      id: root.id,
      ts: root.ts,
      ...(root.topic != null ? { topic: root.topic } : {}),
      messageType: root.message_type,
      contentPreview: root.content.slice(0, 1000),
    },
    messageCount: messages.length,
    latestTs,
    participants: [...participants.values()].map(item => structuredClone(item)),
    objectionCount,
    correctionCount,
  }
}

/** Append-only thread projection cache; shrinking or older snapshots fail closed. */
export class AiBoardThreadProjectionRegistry {
  readonly #byThreadId = new Map<string, AiBoardThreadProjection>()

  get(threadId: string): AiBoardThreadProjection | null {
    const state = this.#byThreadId.get(threadId)
    return state ? structuredClone(state) : null
  }

  apply(root: AiBoardMessage): AiBoardThreadApplyResult {
    const next = toAiBoardThreadProjection(root)
    const current = this.#byThreadId.get(next.providerResourceId)
    if (current) {
      if (next.latestTs < current.latestTs || next.messageCount < current.messageCount) {
        return { accepted: false, state: structuredClone(current), reason: 'stale_thread' }
      }
    }
    this.#byThreadId.set(next.providerResourceId, structuredClone(next))
    return { accepted: true, state: structuredClone(next) }
  }
}

export interface CreateAiBoardThreadPortalInput {
  thread: AiBoardMessage
  portalId: string
  canvasId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  actor: ActorRef
  baseUrl?: string
  transform?: Partial<Transform2D>
  createdAt?: string
}

/** Stable Canvas projection; growing thread content stays in AI Board, not Canvas metadata. */
export function createAiBoardThreadPortal(input: CreateAiBoardThreadPortalInput): CanvasObject {
  assertMessage(input.thread)
  const portalId = required(input.portalId, 'portalId')
  const canvasId = required(input.canvasId, 'canvasId')
  const pmwWorkspaceId = required(input.pmwWorkspaceId, 'pmwWorkspaceId')
  const timestamp = input.createdAt ?? new Date().toISOString()
  const transform: Transform2D = {
    x: input.transform?.x ?? 0,
    y: input.transform?.y ?? 0,
    width: input.transform?.width ?? 480,
    height: input.transform?.height ?? 260,
    rotation: input.transform?.rotation ?? 0,
    scaleX: input.transform?.scaleX ?? 1,
    scaleY: input.transform?.scaleY ?? 1,
    zIndex: input.transform?.zIndex ?? 1,
  }
  const baseUrl = input.baseUrl ? normalizedBaseUrl(input.baseUrl) : undefined
  const object: CanvasObject = {
    id: `portal:${portalId}`,
    canvasId,
    type: 'resource_portal',
    transform,
    style: { fill: '#f8fafc', stroke: '#7c3aed', strokeWidth: 2, opacity: 1 },
    content: {
      text: input.thread.topic?.trim() || `AI Board Thread ${input.thread.id}`,
      resourceUri: boardResourceUri(input.thread.id),
      ...(baseUrl ? { previewUri: `${baseUrl}/api/thread?id=${encodeURIComponent(input.thread.id)}` } : {}),
    },
    childIds: [],
    bindings: [],
    metadata: {
      portal: {
        portalId,
        pmwWorkspaceId,
        ...(input.pmwTaskId ? { pmwTaskId: input.pmwTaskId } : {}),
        provider: 'ai_board',
        resourceKind: 'ai_board_thread',
        providerResourceId: input.thread.id,
        displayMode: 'summary',
        interactionMode: 'inspect',
      },
      providerRef: {
        resourceUri: boardResourceUri(input.thread.id),
        ...(baseUrl ? { apiBaseUrl: baseUrl } : {}),
      },
    },
    createdBy: structuredClone(input.actor),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
  validateCanvasObject(object)
  return object
}

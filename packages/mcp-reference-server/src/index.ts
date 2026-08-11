import { randomUUID } from 'node:crypto'
import type { CanvasAdapter, CanvasQuery, Viewport } from '../../canvas-adapter/src/index.js'
import { CanvasCoreError, serializeCanvasState, stateHash, type CanvasState, type CanvasStore } from '../../canvas-core/src/index.js'
import type {
  ActorRef,
  Bounds,
  CanvasObject,
  CanvasObjectType,
  CanvasTransaction,
  ObjectContent,
  ObjectStyle,
  Transform2D,
} from '../../canvas-schema/src/index.js'
import { CanvasResource, type CanvasToolResult } from '../../mcp-contract/src/index.js'
import type { SqliteEventLedger } from '../../event-ledger/src/index.js'
import type { StateVectorSyncRoom } from '../../state-vector-sync/src/index.js'
import { verifyCount, verifyInsideBounds, verifyMaxOverlap, type VerificationIssue } from '../../verifier/src/index.js'
import type { LabAction, MultimodalCanvasLab, ObservationMode } from '../../multimodal-lab/src/index.js'
import { ObservationGovernor } from '../../multimodal-agent-runtime/src/governor.js'
import { PassiveObservationScheduler } from '../../multimodal-agent-runtime/src/passive.js'

export const MCP_PROTOCOL_VERSION = '2025-11-25'
export const MCP_SERVER_NAME = 'mrmic-nvcl-canvas'
export const MCP_SERVER_VERSION = '0.11.0'

type JsonRpcId = string | number | null
interface JsonRpcRequest { jsonrpc: '2.0'; id?: JsonRpcId; method: string; params?: Record<string, unknown> }
interface JsonRpcResponse { jsonrpc: '2.0'; id: JsonRpcId; result?: unknown; error?: { code: number; message: string; data?: unknown } }

type McpRole = 'viewer' | 'agent-direct' | 'owner'
interface McpSession {
  id: string
  initialized: boolean
  role: McpRole
  actor: ActorRef
  subscriptions: Set<string>
  streams: Set<any>
  governors: Map<string, ObservationGovernor>
  passiveSchedulers: Map<string, PassiveObservationScheduler>
  createdAt: string
}

export interface McpCanvasRuntime {
  store: CanvasStore
  adapter: CanvasAdapter
  room: StateVectorSyncRoom
  roomForCanvas?: (canvasId: string) => StateVectorSyncRoom
  syncHandleForCanvas?: (canvasId: string) => string
  replaceState?: (clientId: string, input: { snapshotId: string; stateHash: string; state: ReturnType<typeof serializeCanvasState> }) => Promise<unknown>
  ledger: SqliteEventLedger
  workspaceId: string
  rootCanvasId: string
  lab?: MultimodalCanvasLab
}

export interface McpReferenceServerOptions {
  allowedOrigins?: string[]
  allowedHosts?: string[]
}

interface SnapshotRecord {
  snapshotId: string
  workspaceId: string
  canvasId: string
  revision: number
  state: CanvasState
  createdAt: string
  actor: ActorRef
}

interface ToolDefinition {
  name: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  readOnly: boolean
  highRisk?: boolean
}

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'canvas.get_state', title: 'Get canvas state', readOnly: true,
    description: 'Return workspace, canvas, viewport, synchronization and object summary state.',
    inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'canvas.get_viewport', title: 'Get canvas viewport', readOnly: true,
    description: 'Return the current viewport, visible objects and a resource link to its SVG rendering.',
    inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'canvas.query_objects', title: 'Query canvas objects', readOnly: true,
    description: 'Query objects by stable ID, type, bounds, text or metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        canvasId: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } },
        types: { type: 'array', items: { type: 'string' } }, text: { type: 'string' },
        bounds: { type: 'object' }, metadata: { type: 'object' },
      }, additionalProperties: false,
    },
  },
  {
    name: 'canvas.create_objects', title: 'Create canvas objects', readOnly: false,
    description: 'Create one or more typed canvas objects in one atomic synchronized transaction.',
    inputSchema: {
      type: 'object', required: ['objects'],
      properties: {
        canvasId: { type: 'string' }, intent: { type: 'string' }, expectedCanvasRevision: { type: 'integer' },
        idempotencyKey: { type: 'string' }, objects: { type: 'array', minItems: 1, items: { type: 'object' } },
      }, additionalProperties: false,
    },
  },
  {
    name: 'canvas.patch_objects', title: 'Patch canvas objects', readOnly: false,
    description: 'Apply explicit local field patches to stable object IDs with revision checks.',
    inputSchema: {
      type: 'object', required: ['patches'],
      properties: {
        canvasId: { type: 'string' }, intent: { type: 'string' }, expectedCanvasRevision: { type: 'integer' },
        patches: { type: 'array', minItems: 1, items: { type: 'object', required: ['objectId', 'expectedRevision', 'patch'] } },
      }, additionalProperties: false,
    },
  },
  {
    name: 'canvas.delete_objects', title: 'Delete canvas objects', readOnly: false,
    description: 'Delete objects by stable ID and expected revision in one transaction.',
    inputSchema: {
      type: 'object', required: ['objects'],
      properties: {
        canvasId: { type: 'string' }, intent: { type: 'string' }, expectedCanvasRevision: { type: 'integer' },
        objects: { type: 'array', minItems: 1, items: { type: 'object', required: ['objectId', 'expectedRevision'] } },
      }, additionalProperties: false,
    },
  },
  {
    name: 'canvas.set_viewport', title: 'Set canvas viewport', readOnly: false,
    description: 'Move or zoom the shared reference viewport used by the agent observation loop.',
    inputSchema: { type: 'object', required: ['viewport'], properties: { viewport: { type: 'object' } }, additionalProperties: false },
  },
  {
    name: 'canvas.render_viewport', title: 'Render canvas viewport', readOnly: true,
    description: 'Render the current or supplied viewport as an SVG resource.',
    inputSchema: { type: 'object', properties: { canvasId: { type: 'string' }, viewport: { type: 'object' }, includeGrid: { type: 'boolean' } }, additionalProperties: false },
  },
  {
    name: 'canvas.verify', title: 'Verify canvas constraints', readOnly: true,
    description: 'Run deterministic count, overlap and bounds checks against canvas objects.',
    inputSchema: { type: 'object', required: ['checks'], properties: { canvasId: { type: 'string' }, checks: { type: 'array', items: { type: 'object' } } }, additionalProperties: false },
  },
  {
    name: 'canvas.create_snapshot', title: 'Create canvas snapshot', readOnly: false,
    description: 'Create an in-memory recoverable snapshot of the complete canvas state.',
    inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'canvas.restore_snapshot', title: 'Restore canvas snapshot', readOnly: false, highRisk: true,
    description: 'Restore a prior snapshot. Owner role is required because this overwrites current state.',
    inputSchema: { type: 'object', required: ['snapshotId'], properties: { snapshotId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'canvas.open_subcanvas', title: 'Open or create subcanvas', readOnly: false,
    description: 'Open the child canvas linked by a subcanvas object, or create a one-level portal.',
    inputSchema: {
      type: 'object',
      properties: {
        objectId: { type: 'string' }, canvasId: { type: 'string' }, create: { type: 'object' },
      }, additionalProperties: false,
    },
  },
  {
    name: 'canvas.fold_subcanvas', title: 'Fold completed subcanvas', readOnly: false,
    description: 'Write a verified child-canvas summary and reopen handle back onto its parent portal object.',
    inputSchema: {
      type: 'object', required: ['objectId', 'summary', 'childRunId', 'status', 'issueCount'],
      properties: {
        objectId: { type: 'string' }, summary: { type: 'string' }, childRunId: { type: 'string' },
        status: { type: 'string' }, issueCount: { type: 'integer' }, previewResourceUri: { type: 'string' },
      }, additionalProperties: false,
    },
  },
  {
    name: 'canvas.get_lineage', title: 'Get recursive canvas lineage', readOnly: true,
    description: 'Return the root-to-target canvas lineage and portal objects for a recursive child canvas.',
    inputSchema: { type: 'object', properties: { canvasId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'canvas.get_events', title: 'Get canvas events', readOnly: true,
    description: 'Read append-only causal events, optionally filtered by object or transaction.',
    inputSchema: { type: 'object', properties: { objectId: { type: 'string' }, transactionId: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'lab.observe', title: 'Observe multimodal canvas lab', readOnly: true,
    description: 'Create a freshness-bound immutable visual frame. Pixel mode withholds object IDs; structured mode exposes oracle state.',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['pixel', 'hybrid', 'structured'] } }, additionalProperties: false },
  },
  {
    name: 'lab.observe_adaptive', title: 'Observe through a session-local visual governor', readOnly: true,
    description: 'Create a pixel frame, compare a compact perceptual signature with this MCP session history, and return a keyframe, full frame, ROI raster, or skip decision.',
    inputSchema: {
      type: 'object',
      properties: {
        governorId: { type: 'string' }, reset: { type: 'boolean' },
        differenceThreshold: { type: 'number' }, blockDifferenceThreshold: { type: 'number' },
        keyframeInterval: { type: 'integer' }, maxRoiFraction: { type: 'number' },
        roiPaddingPx: { type: 'integer' }, minimumRoiSize: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lab.observe_passive', title: 'Sample a passive scene timeline', readOnly: true,
    description: 'Sample or flush a session-local pixel-only scene timeline with burst coalescing, scene epochs and periodic keyframes. The result contains raster metadata and resource links, never object identifiers.',
    inputSchema: {
      type: 'object',
      properties: {
        timelineId: { type: 'string' }, reset: { type: 'boolean' }, flush: { type: 'boolean' },
        coalesceWindowMs: { type: 'number' }, maxCoalescedSamples: { type: 'integer' },
        maxCoalescedRoiFraction: { type: 'number' }, differenceThreshold: { type: 'number' },
        blockDifferenceThreshold: { type: 'number' }, keyframeInterval: { type: 'integer' },
        maxRoiFraction: { type: 'number' }, roiPaddingPx: { type: 'integer' },
        minimumRoiSize: { type: 'integer' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'lab.act', title: 'Execute guarded lab action', readOnly: false,
    description: 'Execute one action carrying a non-empty actionId, fresh frameId and expected canvas revision.',
    inputSchema: { type: 'object', required: ['action'], properties: { action: { type: 'object' }, mode: { type: 'string', enum: ['pixel', 'hybrid', 'structured'] } }, additionalProperties: false },
  },
  {
    name: 'lab.rasterize', title: 'Rasterize immutable lab frame', readOnly: true,
    description: 'Derive an immutable full-frame or cropped PNG from an exact SVG frame without exposing canvas objects.',
    inputSchema: {
      type: 'object', required: ['frameId'],
      properties: {
        frameId: { type: 'string' },
        crop: {
          type: 'object', required: ['x', 'y', 'width', 'height'],
          properties: { x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' } },
          additionalProperties: false,
        },
      }, additionalProperties: false,
    },
  },
  {
    name: 'lab.undo', title: 'Undo lab action', readOnly: false,
    description: 'Restore the state before the latest reversible lab action through synchronized state replacement.',
    inputSchema: { type: 'object', required: ['actionId', 'frameId'], properties: { actionId: { type: 'string' }, frameId: { type: 'string' }, mode: { type: 'string', enum: ['pixel', 'hybrid', 'structured'] } }, additionalProperties: false },
  },
  {
    name: 'lab.redo', title: 'Redo lab action', readOnly: false,
    description: 'Reapply the latest undone lab action through synchronized state replacement.',
    inputSchema: { type: 'object', required: ['actionId', 'frameId'], properties: { actionId: { type: 'string' }, frameId: { type: 'string' }, mode: { type: 'string', enum: ['pixel', 'hybrid', 'structured'] } }, additionalProperties: false },
  },
  {
    name: 'lab.reset_benchmark', title: 'Reset visual benchmark', readOnly: false, highRisk: true,
    description: 'Replace the current laboratory state with the deterministic drag-red-circle benchmark. The transition remains undoable.',
    inputSchema: { type: 'object', required: ['actionId'], properties: { actionId: { type: 'string' }, frameId: { type: 'string' }, mode: { type: 'string', enum: ['pixel', 'hybrid', 'structured'] } }, additionalProperties: false },
  },
  {
    name: 'lab.verify_benchmark', title: 'Verify visual benchmark', readOnly: true,
    description: 'Use the structured oracle to verify whether the red target is fully inside the blue zone.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'lab.get_trajectory', title: 'Get lab trajectory', readOnly: true,
    description: 'Return freshness, frame hashes, action IDs and transition evidence for the current lab trajectory.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function asRecord(value: unknown, label = 'value'): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}
function asString(value: unknown, label: string, fallback?: string): string {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}
function asFinite(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}
function asInteger(value: unknown, label: string, fallback?: number): number | undefined {
  if (value === undefined) return fallback
  if (!Number.isInteger(value)) throw new Error(`${label} must be an integer`)
  return Number(value)
}
function encodeText(value: unknown): string { return JSON.stringify(value, null, 2) }
function now(): string { return new Date().toISOString() }
function observationMode(value: unknown): ObservationMode { return value === 'structured' || value === 'hybrid' ? value : 'pixel' }

function jsonRpcResult(id: JsonRpcId, result: unknown): JsonRpcResponse { return { jsonrpc: '2.0', id, result } }
function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }
}

function toolEnvelope<T>(result: CanvasToolResult<T>) {
  return {
    content: [
      { type: 'text', text: encodeText(result) },
      ...result.resourceLinks.map(uri => ({ type: 'resource_link', uri, name: uri })),
    ],
    structuredContent: result,
    isError: !result.ok,
  }
}

function okResult<T>(data: T, resourceLinks: string[] = [], extras: Partial<CanvasToolResult<T>> = {}): CanvasToolResult<T> {
  return { ok: true, data, warnings: [], resourceLinks, ...extras }
}
function errorResult(code: string, message: string, details?: Record<string, unknown>): CanvasToolResult<never> {
  return { ok: false, warnings: [], resourceLinks: [], error: { code, message, ...(details ? { details } : {}) } }
}

function normalizeRole(value: unknown): McpRole {
  return value === 'owner' || value === 'agent-direct' || value === 'viewer' ? value : 'viewer'
}
function canMutate(role: McpRole): boolean { return role === 'agent-direct' || role === 'owner' }

function makeObject(
  specValue: unknown,
  canvasId: string,
  actor: ActorRef,
  index: number,
): CanvasObject {
  const spec = asRecord(specValue, `objects[${index}]`)
  const type = asString(spec.type, `objects[${index}].type`) as CanvasObjectType
  const transformInput = isRecord(spec.transform) ? spec.transform : {}
  const transform: Transform2D = {
    x: asFinite(transformInput.x, 'transform.x', 0),
    y: asFinite(transformInput.y, 'transform.y', 0),
    width: asFinite(transformInput.width, 'transform.width', type === 'text' ? 240 : 100),
    height: asFinite(transformInput.height, 'transform.height', type === 'text' ? 48 : 100),
    rotation: asFinite(transformInput.rotation, 'transform.rotation', 0),
    scaleX: asFinite(transformInput.scaleX, 'transform.scaleX', 1),
    scaleY: asFinite(transformInput.scaleY, 'transform.scaleY', 1),
    zIndex: asFinite(transformInput.zIndex, 'transform.zIndex', index + 1),
  }
  const timestamp = now()
  return {
    id: typeof spec.id === 'string' && spec.id.length ? spec.id : `obj-${randomUUID()}`,
    canvasId,
    type,
    parentId: typeof spec.parentId === 'string' ? spec.parentId : undefined,
    transform,
    style: (isRecord(spec.style) ? spec.style : {}) as ObjectStyle,
    content: (isRecord(spec.content) ? spec.content : undefined) as ObjectContent | undefined,
    childIds: Array.isArray(spec.childIds) ? spec.childIds.map(String) : [],
    bindings: [],
    metadata: isRecord(spec.metadata) ? spec.metadata : {},
    createdBy: structuredClone(actor),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
}

export class McpReferenceCanvasServer {
  readonly #runtime: McpCanvasRuntime
  readonly #sessions = new Map<string, McpSession>()
  readonly #snapshots = new Map<string, SnapshotRecord>()
  readonly #trajectories = new Map<string, unknown>()
  readonly #allowedOrigins: Set<string>
  readonly #allowedHosts: Set<string>
  readonly #unsubscribeDelta: () => void

  constructor(runtime: McpCanvasRuntime, options: McpReferenceServerOptions = {}) {
    this.#runtime = runtime
    this.#allowedOrigins = new Set(options.allowedOrigins ?? ['http://127.0.0.1', 'http://localhost'])
    this.#allowedHosts = new Set(options.allowedHosts ?? [])
    this.#unsubscribeDelta = runtime.adapter.subscribe((delta) => this.#notifyDelta(delta.canvasId, delta.affectedObjectIds))
  }

  registerTrajectory(runId: string, trajectory: unknown): string {
    this.#trajectories.set(runId, structuredClone(trajectory))
    this.#runtime.ledger.saveTrajectory(runId, this.#runtime.workspaceId, trajectory)
    return CanvasResource.trajectory(this.#runtime.workspaceId, runId)
  }

  close(): void {
    this.#unsubscribeDelta()
    for (const session of this.#sessions.values()) for (const stream of session.streams) stream.end()
    this.#sessions.clear()
  }

  async handleHttp(request: any, response: any): Promise<boolean> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
    if (url.pathname !== '/mcp') return false
    if (!this.#validateOriginAndHost(request, response)) return true

    if (request.method === 'GET') {
      const session = this.#requireSession(request, response)
      if (!session) return true
      const accept = String(request.headers.accept ?? '')
      if (!accept.includes('text/event-stream')) {
        this.#sendJson(response, 406, { error: 'GET /mcp requires Accept: text/event-stream' })
        return true
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'mcp-session-id': session.id,
      })
      response.write(': mrmic mcp stream connected\n\n')
      session.streams.add(response)
      request.on('close', () => session.streams.delete(response))
      return true
    }

    if (request.method === 'DELETE') {
      const session = this.#requireSession(request, response)
      if (!session) return true
      for (const stream of session.streams) stream.end()
      this.#sessions.delete(session.id)
      response.writeHead(204)
      response.end()
      return true
    }

    if (request.method !== 'POST') {
      response.writeHead(405, { allow: 'GET, POST, DELETE' })
      response.end()
      return true
    }

    let requestBody: unknown
    try { requestBody = await this.#readBody(request) }
    catch (error) {
      this.#sendRpc(response, 400, jsonRpcError(null, -32700, 'Parse error', String(error)))
      return true
    }
    if (!isRecord(requestBody) || requestBody.jsonrpc !== '2.0' || typeof requestBody.method !== 'string') {
      this.#sendRpc(response, 400, jsonRpcError(null, -32600, 'Invalid Request'))
      return true
    }
    const rpc = requestBody as unknown as JsonRpcRequest

    if (rpc.method === 'initialize') {
      const params = isRecord(rpc.params) ? rpc.params : {}
      const requestedVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_PROTOCOL_VERSION
      if (requestedVersion !== MCP_PROTOCOL_VERSION) {
        this.#sendRpc(response, 200, jsonRpcError(rpc.id ?? null, -32602, `Unsupported protocol version ${requestedVersion}`))
        return true
      }
      const role = normalizeRole(request.headers['x-mrmic-role'])
      const actorId = typeof request.headers['x-mrmic-actor-id'] === 'string'
        ? request.headers['x-mrmic-actor-id']
        : `mcp-${randomUUID()}`
      const session: McpSession = {
        id: randomUUID(), initialized: false, role,
        actor: { actorType: role === 'viewer' ? 'user' : 'agent', actorId, sessionId: randomUUID() },
        subscriptions: new Set(), streams: new Set(), governors: new Map(), passiveSchedulers: new Map(), createdAt: now(),
      }
      this.#sessions.set(session.id, session)
      this.#sendRpc(response, 200, jsonRpcResult(rpc.id ?? null, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: true, listChanged: false },
        },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: 'Use canvas resources for observation and canvas tools for typed, revision-safe transactions. Mutations require agent-direct or owner role.',
      }), session.id)
      return true
    }

    const session = this.#requireSession(request, response, true)
    if (!session) return true
    if (rpc.method === 'notifications/initialized') {
      session.initialized = true
      response.writeHead(202, { 'mcp-session-id': session.id })
      response.end()
      return true
    }

    if (!session.initialized) {
      this.#sendRpc(response, 400, jsonRpcError(rpc.id ?? null, -32002, 'Session is not initialized'), session.id)
      return true
    }

    if (rpc.id === undefined) {
      response.writeHead(202, { 'mcp-session-id': session.id })
      response.end()
      return true
    }

    const result = await this.#dispatch(rpc, session)
    this.#sendRpc(response, 200, result, session.id)
    return true
  }

  async dispatchForTesting(rpc: JsonRpcRequest, session: { role?: McpRole; actorId?: string } = {}): Promise<JsonRpcResponse> {
    const internal: McpSession = {
      id: `test-${randomUUID()}`, initialized: true, role: session.role ?? 'owner',
      actor: { actorType: 'agent', actorId: session.actorId ?? 'test-agent' },
      subscriptions: new Set(), streams: new Set(), governors: new Map(), passiveSchedulers: new Map(), createdAt: now(),
    }
    return this.#dispatch(rpc, internal)
  }

  #validateOriginAndHost(request: any, response: any): boolean {
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    if (origin) {
      let allowed = this.#allowedOrigins.has(origin)
      if (!allowed) {
        try {
          const parsed = new URL(origin)
          allowed = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
        } catch { allowed = false }
      }
      if (!allowed) {
        this.#sendJson(response, 403, { error: 'Origin is not allowed' })
        return false
      }
    }
    const host = typeof request.headers.host === 'string' ? request.headers.host.split(':')[0] : undefined
    if (this.#allowedHosts.size && host && !this.#allowedHosts.has(host)) {
      this.#sendJson(response, 403, { error: 'Host is not allowed' })
      return false
    }
    return true
  }

  #requireSession(request: any, response: any, rpc = false): McpSession | undefined {
    const id = request.headers['mcp-session-id']
    const session = typeof id === 'string' ? this.#sessions.get(id) : undefined
    if (!session) {
      if (rpc) this.#sendRpc(response, 404, jsonRpcError(null, -32001, 'Unknown or missing MCP session'))
      else this.#sendJson(response, 404, { error: 'Unknown or missing MCP session' })
      return undefined
    }
    return session
  }

  async #dispatch(rpc: JsonRpcRequest, session: McpSession): Promise<JsonRpcResponse> {
    try {
      const id = rpc.id ?? null
      switch (rpc.method) {
        case 'ping': return jsonRpcResult(id, {})
        case 'tools/list': return jsonRpcResult(id, { tools: TOOL_DEFINITIONS.map(tool => ({
          name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema,
          annotations: { readOnlyHint: tool.readOnly, destructiveHint: Boolean(tool.highRisk) },
        })) })
        case 'tools/call': {
          const params = asRecord(rpc.params, 'params')
          const name = asString(params.name, 'params.name')
          const args = isRecord(params.arguments) ? params.arguments : {}
          const definition = TOOL_DEFINITIONS.find(item => item.name === name)
          if (!definition) return jsonRpcError(id, -32602, `Unknown tool ${name}`)
          if (!definition.readOnly && !canMutate(session.role)) {
            return jsonRpcResult(id, toolEnvelope(errorResult('PERMISSION_DENIED', `${name} requires agent-direct or owner role`)))
          }
          if (definition.highRisk && session.role !== 'owner') {
            return jsonRpcResult(id, toolEnvelope(errorResult('PERMISSION_DENIED', `${name} requires owner role`)))
          }
          return jsonRpcResult(id, toolEnvelope(await this.#callTool(name, args, session)))
        }
        case 'resources/list': return jsonRpcResult(id, { resources: this.#listResources() })
        case 'resources/templates/list': return jsonRpcResult(id, { resourceTemplates: this.#listResourceTemplates() })
        case 'resources/read': {
          const params = asRecord(rpc.params, 'params')
          const uri = asString(params.uri, 'params.uri')
          return jsonRpcResult(id, { contents: await this.#readResource(uri) })
        }
        case 'resources/subscribe': {
          const params = asRecord(rpc.params, 'params')
          const uri = asString(params.uri, 'params.uri')
          session.subscriptions.add(uri)
          return jsonRpcResult(id, {})
        }
        case 'resources/unsubscribe': {
          const params = asRecord(rpc.params, 'params')
          const uri = asString(params.uri, 'params.uri')
          session.subscriptions.delete(uri)
          return jsonRpcResult(id, {})
        }
        default: return jsonRpcError(id, -32601, `Method not found: ${rpc.method}`)
      }
    } catch (error) {
      const data = error instanceof CanvasCoreError ? { code: error.code } : undefined
      return jsonRpcError(rpc.id ?? null, -32603, error instanceof Error ? error.message : String(error), data)
    }
  }

  #listResources() {
    const { workspaceId, rootCanvasId } = this.#runtime
    return [
      { uri: CanvasResource.workspace(workspaceId), name: 'Current workspace', mimeType: 'application/json', description: 'MRMIC workspace summary.' },
      { uri: CanvasResource.canvas(workspaceId, rootCanvasId), name: 'Root canvas', mimeType: 'application/json', description: 'Root canvas structure and object summaries.' },
      { uri: CanvasResource.viewport(workspaceId, rootCanvasId), name: 'Current viewport', mimeType: 'application/json', description: 'Current agent viewport and visible objects.' },
      { uri: CanvasResource.render(workspaceId, rootCanvasId), name: 'Current SVG rendering', mimeType: 'image/svg+xml', description: 'Rendered root canvas viewport.' },
      { uri: CanvasResource.events(workspaceId), name: 'Canvas event ledger', mimeType: 'application/json', description: 'Append-only causal canvas events.' },
    ]
  }

  #listResourceTemplates() {
    const ws = encodeURIComponent(this.#runtime.workspaceId)
    return [
      { uriTemplate: `canvas://workspace/${ws}/canvas/{canvasId}`, name: 'Canvas document', mimeType: 'application/json', description: 'Read any root or child canvas by ID.' },
      { uriTemplate: `canvas://workspace/${ws}/canvas/{canvasId}/viewport`, name: 'Canvas viewport', mimeType: 'application/json', description: 'Read visible objects for a canvas viewport.' },
      { uriTemplate: `canvas://workspace/${ws}/canvas/{canvasId}/render/current.svg`, name: 'Canvas SVG render', mimeType: 'image/svg+xml', description: 'Render any canvas through the current viewport.' },
      { uriTemplate: `canvas://workspace/${ws}/object/{objectId}`, name: 'Canvas object', mimeType: 'application/json', description: 'Read a stable canvas object by ID.' },
      { uriTemplate: `canvas://workspace/${ws}/snapshot/{snapshotId}`, name: 'Canvas snapshot', mimeType: 'application/json', description: 'Read snapshot metadata.' },
      ...(this.#runtime.lab ? [
        { uriTemplate: 'lab://frame/{frameId}', name: 'Immutable multimodal lab frame', mimeType: 'image/svg+xml', description: 'Read an exact observed SVG frame by freshness lease ID.' },
        { uriTemplate: 'lab://frame/{frameId}.png', name: 'Immutable multimodal lab PNG', mimeType: 'image/png', description: 'Read a full PNG rendition derived from an exact observed frame.' },
        { uriTemplate: 'lab://raster/{rasterId}', name: 'Immutable multimodal lab raster', mimeType: 'image/png', description: 'Read a full or cropped PNG created by lab.rasterize.' },
      ] : []),
    ]
  }

  async #readResource(uri: string) {
    const { workspaceId, rootCanvasId, store, adapter, ledger, room } = this.#runtime
    if (uri === CanvasResource.workspace(workspaceId)) {
      return [{ uri, mimeType: 'application/json', text: encodeText({ workspace: store.workspace, rootCanvasId, sync: { stateVector: room.stateVector(), updates: room.updateCount(), presence: room.presenceSnapshot() } }) }]
    }
    const canvasPrefix = `canvas://workspace/${encodeURIComponent(workspaceId)}/canvas/`
    if (uri.startsWith(canvasPrefix)) {
      const remainder = uri.slice(canvasPrefix.length)
      if (remainder.endsWith('/render/current.svg')) {
        const canvasId = decodeURIComponent(remainder.slice(0, -'/render/current.svg'.length))
        const render = await adapter.render({ canvasId, includeGrid: true })
        return [{ uri, mimeType: 'image/svg+xml', text: render.svg }]
      }
      if (remainder.endsWith('/viewport')) {
        const canvasId = decodeURIComponent(remainder.slice(0, -'/viewport'.length))
        const viewport = await adapter.getViewport()
        const objects = await adapter.listObjects(canvasId, { bounds: this.#viewportBounds(viewport) })
        return [{ uri, mimeType: 'application/json', text: encodeText({ viewport, objects, revision: store.getCanvas(canvasId).revision, renderUri: CanvasResource.render(workspaceId, canvasId) }) }]
      }
      const canvasId = decodeURIComponent(remainder)
      return [{ uri, mimeType: 'application/json', text: encodeText({ canvas: store.getCanvas(canvasId), objects: store.listObjects(canvasId) }) }]
    }
    if (uri === CanvasResource.events(workspaceId)) {
      return [{ uri, mimeType: 'application/json', text: encodeText({ events: ledger.list(workspaceId) }) }]
    }
    const objectPrefix = `canvas://workspace/${encodeURIComponent(workspaceId)}/object/`
    if (uri.startsWith(objectPrefix)) {
      const objectId = decodeURIComponent(uri.slice(objectPrefix.length))
      return [{ uri, mimeType: 'application/json', text: encodeText({ object: store.getObject(objectId) }) }]
    }
    const snapshotPrefix = `canvas://workspace/${encodeURIComponent(workspaceId)}/snapshot/`
    if (uri.startsWith(snapshotPrefix)) {
      const snapshotId = decodeURIComponent(uri.slice(snapshotPrefix.length))
      const snapshot = this.#snapshots.get(snapshotId) ?? this.#snapshotFromLedger(snapshotId)
      if (!snapshot) throw new Error(`Snapshot ${snapshotId} not found`)
      return [{ uri, mimeType: 'application/json', text: encodeText({ snapshotId, canvasId: snapshot.canvasId, revision: snapshot.revision, createdAt: snapshot.createdAt, actor: snapshot.actor }) }]
    }
    const trajectoryPrefix = `canvas://workspace/${encodeURIComponent(workspaceId)}/trajectory/`
    if (uri.startsWith(trajectoryPrefix)) {
      const runId = decodeURIComponent(uri.slice(trajectoryPrefix.length))
      const trajectory = this.#trajectories.get(runId) ?? this.#runtime.ledger.getTrajectory(runId)?.trajectory
      if (!trajectory) throw new Error(`Trajectory ${runId} not found`)
      return [{ uri, mimeType: 'application/json', text: encodeText({ runId, trajectory }) }]
    }
    if (uri.startsWith('lab://frame/') && uri.endsWith('.png')) {
      const frameId = decodeURIComponent(uri.slice('lab://frame/'.length, -4))
      if (!this.#runtime.lab) throw new Error('Multimodal lab is unavailable')
      const raster = await this.#runtime.lab.rasterize(frameId)
      return [{ uri, mimeType: 'image/png', blob: Buffer.from(raster.png).toString('base64') }]
    }
    if (uri.startsWith('lab://raster/')) {
      const rasterId = decodeURIComponent(uri.slice('lab://raster/'.length))
      const raster = this.#runtime.lab?.raster(rasterId)
      if (!raster) throw new Error(`Lab raster ${rasterId} not found`)
      return [{ uri, mimeType: 'image/png', blob: Buffer.from(raster.png).toString('base64') }]
    }
    if (uri.startsWith('lab://frame/')) {
      const frameId = decodeURIComponent(uri.slice('lab://frame/'.length))
      const frame = this.#runtime.lab?.frame(frameId)
      if (!frame) throw new Error(`Lab frame ${frameId} not found`)
      return [{ uri, mimeType: 'image/svg+xml', text: frame.svg }]
    }
    if (uri === 'lab://trajectory/current') {
      if (!this.#runtime.lab) throw new Error('Multimodal lab is unavailable')
      return [{ uri, mimeType: 'application/json', text: encodeText({ trajectory: this.#runtime.lab.trajectory, history: this.#runtime.lab.historyStatus }) }]
    }
    throw new Error(`Resource not found: ${uri}`)
  }

  async #callTool(name: string, args: Record<string, unknown>, session: McpSession): Promise<CanvasToolResult<unknown>> {
    const { workspaceId, rootCanvasId, store, adapter, ledger } = this.#runtime
    const canvasId = typeof args.canvasId === 'string' ? args.canvasId : rootCanvasId
    const room = this.#roomFor(canvasId)
    switch (name) {
      case 'lab.observe': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const observation = await lab.observe(observationMode(args.mode))
        return okResult({ observation, history: lab.historyStatus }, [`lab://frame/${encodeURIComponent(observation.frameId)}`, `lab://frame/${encodeURIComponent(observation.frameId)}.png`])
      }
      case 'lab.observe_adaptive': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const governorId = typeof args.governorId === 'string' && args.governorId.trim() ? args.governorId.trim() : 'default'
        if (governorId.length > 128) return errorResult('INVALID_ARGUMENT', 'governorId must not exceed 128 characters')
        if (args.reset === true) session.governors.delete(governorId)
        let governor = session.governors.get(governorId)
        if (!governor) {
          governor = new ObservationGovernor({
            lab,
            differenceThreshold: asFinite(args.differenceThreshold, 'differenceThreshold', 0.006),
            blockDifferenceThreshold: asFinite(args.blockDifferenceThreshold, 'blockDifferenceThreshold', 0.06),
            keyframeInterval: asInteger(args.keyframeInterval, 'keyframeInterval', 8),
            maxRoiFraction: asFinite(args.maxRoiFraction, 'maxRoiFraction', 0.55),
            roiPaddingPx: asInteger(args.roiPaddingPx, 'roiPaddingPx', 32),
            minimumRoiSize: asInteger(args.minimumRoiSize, 'minimumRoiSize', 96),
          })
          session.governors.set(governorId, governor)
        }
        const observation = await lab.observe('pixel')
        const decision = await governor.observe(observation.frameId)
        const { raster, ...governance } = decision
        const links = raster ? [`lab://raster/${encodeURIComponent(raster.observation.rasterId)}`] : []
        return okResult({ observation, governance, raster: raster?.observation, governorId }, links)
      }
      case 'lab.observe_passive': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const timelineId = typeof args.timelineId === 'string' && args.timelineId.trim() ? args.timelineId.trim() : 'default'
        if (timelineId.length > 128) return errorResult('INVALID_ARGUMENT', 'timelineId must not exceed 128 characters')
        if (args.reset === true) session.passiveSchedulers.delete(timelineId)
        let scheduler = session.passiveSchedulers.get(timelineId)
        if (!scheduler) {
          scheduler = new PassiveObservationScheduler({
            lab,
            timelineId,
            governor: new ObservationGovernor({
              lab,
              differenceThreshold: asFinite(args.differenceThreshold, 'differenceThreshold', 0.006),
              blockDifferenceThreshold: asFinite(args.blockDifferenceThreshold, 'blockDifferenceThreshold', 0.06),
              keyframeInterval: asInteger(args.keyframeInterval, 'keyframeInterval', 8),
              maxRoiFraction: asFinite(args.maxRoiFraction, 'maxRoiFraction', 0.55),
              roiPaddingPx: asInteger(args.roiPaddingPx, 'roiPaddingPx', 32),
              minimumRoiSize: asInteger(args.minimumRoiSize, 'minimumRoiSize', 96),
            }),
            coalesceWindowMs: asFinite(args.coalesceWindowMs, 'coalesceWindowMs', 250),
            maxCoalescedSamples: asInteger(args.maxCoalescedSamples, 'maxCoalescedSamples', 8),
            maxCoalescedRoiFraction: asFinite(args.maxCoalescedRoiFraction, 'maxCoalescedRoiFraction', 0.55),
          })
          session.passiveSchedulers.set(timelineId, scheduler)
        }
        if (args.flush === true) {
          const emitted = await scheduler.flush()
          const links = emitted.map(event => `lab://raster/${encodeURIComponent(event.raster.rasterId)}`)
          return okResult({ timelineId, emitted, stats: scheduler.stats }, links)
        }
        const result = await scheduler.sample()
        const links = result.emitted.map(event => `lab://raster/${encodeURIComponent(event.raster.rasterId)}`)
        return okResult({ timelineId, ...result }, links)
      }
      case 'lab.rasterize': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const crop = args.crop === undefined ? undefined : asRecord(args.crop, 'crop') as unknown as { x: number; y: number; width: number; height: number }
        const raster = await lab.rasterize(asString(args.frameId, 'frameId'), crop)
        return okResult({ observation: raster.observation }, [`lab://raster/${encodeURIComponent(raster.observation.rasterId)}`])
      }
      case 'lab.act': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const action = asRecord(args.action, 'action') as unknown as LabAction
        const result = await lab.execute({ ...action, actor: structuredClone(session.actor) }, observationMode(args.mode))
        return okResult(result, [`lab://frame/${encodeURIComponent(result.observation.frameId)}`], { transactionId: result.transaction?.transactionId, revision: result.observation.canvasRevision })
      }
      case 'lab.undo': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const result = await lab.undo(asString(args.actionId, 'actionId'), asString(args.frameId, 'frameId'), observationMode(args.mode))
        return okResult(result, [`lab://frame/${encodeURIComponent(result.observation.frameId)}`], { transactionId: result.transaction?.transactionId, revision: result.observation.canvasRevision })
      }
      case 'lab.redo': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const result = await lab.redo(asString(args.actionId, 'actionId'), asString(args.frameId, 'frameId'), observationMode(args.mode))
        return okResult(result, [`lab://frame/${encodeURIComponent(result.observation.frameId)}`], { transactionId: result.transaction?.transactionId, revision: result.observation.canvasRevision })
      }
      case 'lab.reset_benchmark': {
        const lab = this.#runtime.lab
        if (!lab) return errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
        const result = await lab.resetBenchmark(asString(args.actionId, 'actionId'), typeof args.frameId === 'string' ? args.frameId : undefined, observationMode(args.mode))
        return okResult(result, [`lab://frame/${encodeURIComponent(result.observation.frameId)}`], { transactionId: result.transaction?.transactionId, revision: result.observation.canvasRevision })
      }
      case 'lab.verify_benchmark': {
        const lab = this.#runtime.lab
        return lab ? okResult({ verification: lab.verifyBenchmark() }) : errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
      }
      case 'lab.get_trajectory': {
        const lab = this.#runtime.lab
        return lab ? okResult({ trajectory: lab.trajectory, history: lab.historyStatus }, ['lab://trajectory/current']) : errorResult('NOT_AVAILABLE', 'Multimodal lab is not configured')
      }
      case 'canvas.get_state': {
        const viewport = await adapter.getViewport()
        return okResult({
          workspace: store.workspace, canvas: store.getCanvas(canvasId), viewport,
          objects: await adapter.listObjects(canvasId),
          sync: { stateVector: room.stateVector(), updates: room.updateCount(), presence: room.presenceSnapshot(), handle: this.#syncHandle(canvasId) },
        }, [CanvasResource.canvas(workspaceId, canvasId), CanvasResource.viewport(workspaceId, canvasId)])
      }
      case 'canvas.get_viewport': {
        const viewport = await adapter.getViewport()
        const objects = await adapter.listObjects(canvasId, { bounds: this.#viewportBounds(viewport) })
        return okResult({ viewport, objects, revision: store.getCanvas(canvasId).revision }, [CanvasResource.viewport(workspaceId, canvasId), CanvasResource.render(workspaceId, canvasId)])
      }
      case 'canvas.query_objects': {
        const query: CanvasQuery = {
          ids: Array.isArray(args.ids) ? args.ids.map(String) : undefined,
          types: Array.isArray(args.types) ? args.types.map(String) as CanvasObjectType[] : undefined,
          text: typeof args.text === 'string' ? args.text : undefined,
          bounds: isRecord(args.bounds) ? args.bounds as unknown as Bounds : undefined,
          metadata: isRecord(args.metadata) ? args.metadata : undefined,
        }
        const objects = await adapter.listObjects(canvasId, query)
        return okResult({ objects, count: objects.length }, objects.map(item => CanvasResource.object(workspaceId, item.id)))
      }
      case 'canvas.create_objects': {
        const specs = Array.isArray(args.objects) ? args.objects : []
        if (!specs.length) return errorResult('INVALID_ARGUMENTS', 'objects must contain at least one item')
        const canvas = store.getCanvas(canvasId)
        const expectedRevision = asInteger(args.expectedCanvasRevision, 'expectedCanvasRevision', canvas.revision) as number
        const objects = specs.map((spec, index) => makeObject(spec, canvasId, session.actor, index))
        const tx: CanvasTransaction = {
          id: randomUUID(), canvasId, actor: session.actor,
          intent: typeof args.intent === 'string' ? args.intent : 'MCP create canvas objects',
          expectedOutcome: `Create ${objects.length} object(s)`,
          preconditions: [{ type: 'canvas_revision', targetId: canvasId, expected: expectedRevision }],
          operations: objects.map(object => ({ op: 'create_object' as const, object })),
          mode: 'direct', createdAt: now(), idempotencyKey: typeof args.idempotencyKey === 'string' ? args.idempotencyKey : undefined,
        }
        const applied = await room.apply(room.nextUpdate(`mcp:${session.id}`, tx))
        return okResult({ objects, result: applied.result }, objects.map(item => CanvasResource.object(workspaceId, item.id)), { transactionId: tx.id, revision: applied.result.revision })
      }
      case 'canvas.patch_objects': {
        const patches = Array.isArray(args.patches) ? args.patches : []
        if (!patches.length) return errorResult('INVALID_ARGUMENTS', 'patches must contain at least one item')
        const canvas = store.getCanvas(canvasId)
        const expectedRevision = asInteger(args.expectedCanvasRevision, 'expectedCanvasRevision', canvas.revision) as number
        const operations = patches.map((itemValue, index) => {
          const item = asRecord(itemValue, `patches[${index}]`)
          return {
            op: 'patch_object' as const,
            objectId: asString(item.objectId, `patches[${index}].objectId`),
            expectedRevision: asInteger(item.expectedRevision, `patches[${index}].expectedRevision`) as number,
            patch: asRecord(item.patch, `patches[${index}].patch`),
          }
        })
        const tx: CanvasTransaction = {
          id: randomUUID(), canvasId, actor: session.actor,
          intent: typeof args.intent === 'string' ? args.intent : 'MCP patch canvas objects',
          preconditions: [{ type: 'canvas_revision', targetId: canvasId, expected: expectedRevision }],
          operations, mode: 'direct', createdAt: now(),
        }
        const applied = await room.apply(room.nextUpdate(`mcp:${session.id}`, tx))
        return okResult({ result: applied.result, objects: operations.map(op => store.getObject(op.objectId)) }, operations.map(op => CanvasResource.object(workspaceId, op.objectId)), { transactionId: tx.id, revision: applied.result.revision })
      }
      case 'canvas.delete_objects': {
        const items = Array.isArray(args.objects) ? args.objects : []
        if (!items.length) return errorResult('INVALID_ARGUMENTS', 'objects must contain at least one item')
        const canvas = store.getCanvas(canvasId)
        const expectedRevision = asInteger(args.expectedCanvasRevision, 'expectedCanvasRevision', canvas.revision) as number
        const operations = items.map((itemValue, index) => {
          const item = asRecord(itemValue, `objects[${index}]`)
          return { op: 'delete_object' as const, objectId: asString(item.objectId, `objects[${index}].objectId`), expectedRevision: asInteger(item.expectedRevision, `objects[${index}].expectedRevision`) as number }
        })
        const tx: CanvasTransaction = {
          id: randomUUID(), canvasId, actor: session.actor,
          intent: typeof args.intent === 'string' ? args.intent : 'MCP delete canvas objects',
          preconditions: [{ type: 'canvas_revision', targetId: canvasId, expected: expectedRevision }],
          operations, mode: 'direct', createdAt: now(),
        }
        const applied = await room.apply(room.nextUpdate(`mcp:${session.id}`, tx))
        return okResult({ result: applied.result, deletedObjectIds: operations.map(op => op.objectId) }, [CanvasResource.canvas(workspaceId, canvasId)], { transactionId: tx.id, revision: applied.result.revision })
      }
      case 'canvas.set_viewport': {
        const viewport = asRecord(args.viewport, 'viewport')
        const current = await adapter.getViewport()
        await adapter.setViewport({
          x: asFinite(viewport.x, 'viewport.x', current.x), y: asFinite(viewport.y, 'viewport.y', current.y),
          width: asFinite(viewport.width, 'viewport.width', current.width), height: asFinite(viewport.height, 'viewport.height', current.height),
          zoom: asFinite(viewport.zoom, 'viewport.zoom', current.zoom),
        })
        this.#notifyResource(CanvasResource.viewport(workspaceId, canvasId))
        return okResult({ viewport: await adapter.getViewport() }, [CanvasResource.viewport(workspaceId, canvasId)])
      }
      case 'canvas.render_viewport': {
        const viewport = isRecord(args.viewport) ? args.viewport as unknown as Viewport : undefined
        const render = await adapter.render({ canvasId, viewport, includeGrid: args.includeGrid !== false })
        return okResult({ width: render.width, height: render.height, viewport: render.viewport, revision: render.revision, mimeType: render.mimeType }, [CanvasResource.render(workspaceId, canvasId)])
      }
      case 'canvas.verify': {
        const objects = await adapter.listObjects(canvasId)
        const checks = Array.isArray(args.checks) ? args.checks : []
        const issues: VerificationIssue[] = []
        for (const [index, checkValue] of checks.entries()) {
          const check = asRecord(checkValue, `checks[${index}]`)
          const type = asString(check.type, `checks[${index}].type`)
          if (type === 'count') {
            const expected = asInteger(check.expected, 'check.expected') as number
            const objectType = typeof check.objectType === 'string' ? check.objectType : undefined
            const role = typeof check.role === 'string' ? check.role : undefined
            issues.push(...verifyCount(objects, object => (!objectType || object.type === objectType) && (!role || object.metadata.role === role), expected, typeof check.rule === 'string' ? check.rule : 'count'))
          } else if (type === 'max_overlap') {
            const foreground = store.getObject(asString(check.foregroundId, 'check.foregroundId'))
            const background = store.getObject(asString(check.backgroundId, 'check.backgroundId'))
            issues.push(...verifyMaxOverlap(foreground, background, asFinite(check.maximum, 'check.maximum', 0.1)))
          } else if (type === 'inside_bounds') {
            const object = store.getObject(asString(check.objectId, 'check.objectId'))
            const bounds = asRecord(check.bounds, 'check.bounds')
            issues.push(...verifyInsideBounds(object, {
              x: asFinite(bounds.x, 'bounds.x', 0), y: asFinite(bounds.y, 'bounds.y', 0),
              width: asFinite(bounds.width, 'bounds.width', 1200), height: asFinite(bounds.height, 'bounds.height', 800),
            }))
          } else throw new Error(`Unknown verification check type ${type}`)
        }
        return okResult({ issues, ok: issues.every(issue => issue.severity !== 'error') })
      }
      case 'canvas.create_snapshot': {
        const snapshotId = randomUUID()
        const canvas = store.getCanvas(canvasId)
        const record = { snapshotId, workspaceId, canvasId, revision: canvas.revision, state: store.snapshot(), createdAt: now(), actor: structuredClone(session.actor) }
        this.#snapshots.set(snapshotId, record)
        ledger.saveSnapshot(record)
        return okResult({ snapshotId, canvasId, revision: canvas.revision, persistent: true }, [CanvasResource.snapshot(workspaceId, snapshotId)])
      }
      case 'canvas.restore_snapshot': {
        const snapshotId = asString(args.snapshotId, 'snapshotId')
        const snapshot = this.#snapshots.get(snapshotId) ?? this.#snapshotFromLedger(snapshotId)
        if (!snapshot) return errorResult('NOT_FOUND', `Snapshot ${snapshotId} not found`)
        const serialized = serializeCanvasState(snapshot.state)
        const hash = stateHash(snapshot.state)
        let applied: unknown
        if (this.#runtime.replaceState) applied = await this.#runtime.replaceState(`mcp:${session.id}`, { snapshotId, stateHash: hash, state: serialized })
        else applied = await room.applyStateReplacement(room.nextStateReplacement(`mcp:${session.id}`, { snapshotId, stateHash: hash, state: serialized }))
        this.#notifyDelta(snapshot.canvasId, store.listObjects(snapshot.canvasId).map(item => item.id))
        return okResult({ snapshotId, canvasId: snapshot.canvasId, revision: store.getCanvas(snapshot.canvasId).revision, synchronized: true, applied }, [CanvasResource.canvas(workspaceId, snapshot.canvasId)])
      }
      case 'canvas.open_subcanvas': {
        if (typeof args.objectId === 'string') {
          const object = store.getObject(args.objectId)
          if (object.type !== 'subcanvas' || !object.content?.childCanvasId) return errorResult('INVALID_OBJECT', `${object.id} is not a linked subcanvas object`)
          return okResult({ object, canvas: store.getCanvas(object.content.childCanvasId), syncHandle: this.#syncHandle(object.content.childCanvasId) }, [CanvasResource.object(workspaceId, object.id), CanvasResource.canvas(workspaceId, object.content.childCanvasId)])
        }
        const create = asRecord(args.create, 'create')
        const parentCanvas = store.getCanvas(canvasId)
        const objectId = typeof create.objectId === 'string' ? create.objectId : `subcanvas-${randomUUID()}`
        const childCanvasId = typeof create.childCanvasId === 'string' ? create.childCanvasId : `canvas-${randomUUID()}`
        const portal = makeObject({
          id: objectId, type: 'subcanvas', transform: isRecord(create.transform) ? create.transform : { x: 80, y: 80, width: 320, height: 160, zIndex: 20 },
          style: isRecord(create.style) ? create.style : { fill: '#faf5ff', stroke: '#7c3aed', strokeWidth: 3 },
          content: { text: typeof create.title === 'string' ? create.title : 'Subcanvas', childCanvasId },
          metadata: { role: 'subcanvas-portal' },
        }, canvasId, session.actor, 0)
        const createdAt = now()
        const tx: CanvasTransaction = {
          id: randomUUID(), canvasId, actor: session.actor,
          intent: typeof create.intent === 'string' ? create.intent : 'MCP create one-level subcanvas',
          preconditions: [{ type: 'canvas_revision', targetId: canvasId, expected: parentCanvas.revision }],
          operations: [{ op: 'create_subcanvas', object: portal, canvas: { id: childCanvasId, workspaceId, parentCanvasId: canvasId, parentObjectId: objectId, title: typeof create.title === 'string' ? create.title : 'Subcanvas', objectIds: [], revision: 0, createdAt, updatedAt: createdAt } }],
          mode: 'direct', createdAt,
        }
        const applied = await room.apply(room.nextUpdate(`mcp:${session.id}`, tx))
        return okResult({ object: portal, canvas: store.getCanvas(childCanvasId), syncHandle: this.#syncHandle(childCanvasId), result: applied.result }, [CanvasResource.object(workspaceId, objectId), CanvasResource.canvas(workspaceId, childCanvasId)], { transactionId: tx.id, revision: applied.result.revision })
      }
      case 'canvas.fold_subcanvas': {
        const objectId = asString(args.objectId, 'objectId')
        const portal = store.getObject(objectId)
        if (portal.type !== 'subcanvas' || !portal.content?.childCanvasId) return errorResult('INVALID_OBJECT', `${portal.id} is not a linked subcanvas portal`)
        const childCanvas = store.getCanvas(portal.content.childCanvasId)
        const parentCanvas = store.getCanvas(portal.canvasId)
        const summary = asString(args.summary, 'summary')
        const childRunId = asString(args.childRunId, 'childRunId')
        const status = asString(args.status, 'status')
        const issueCount = asInteger(args.issueCount, 'issueCount', 0) as number
        const previewResourceUri = typeof args.previewResourceUri === 'string'
          ? args.previewResourceUri
          : CanvasResource.render(workspaceId, childCanvas.id)
        const foldedAt = now()
        const tx: CanvasTransaction = {
          id: randomUUID(), canvasId: parentCanvas.id, actor: session.actor,
          intent: `Fold verified child canvas ${childCanvas.id} into portal ${portal.id}`,
          expectedOutcome: 'Persist child result summary while preserving a reopen handle.',
          preconditions: [
            { type: 'canvas_revision', targetId: parentCanvas.id, expected: parentCanvas.revision },
            { type: 'object_revision', targetId: portal.id, expected: portal.revision },
          ],
          operations: [{
            op: 'patch_object', objectId: portal.id, expectedRevision: portal.revision,
            patch: {
              content: { text: summary, childCanvasId: childCanvas.id },
              metadata: {
                foldState: 'folded', childRunId, childStatus: status, childIssueCount: issueCount,
                childRevision: childCanvas.revision, childObjectCount: store.listObjects(childCanvas.id).length,
                foldedAt, previewResourceUri, reopenCanvasId: childCanvas.id,
              },
            },
          }],
          mode: 'direct', createdAt: foldedAt,
        }
        const applied = await room.apply(room.nextUpdate(`mcp:${session.id}`, tx))
        return okResult({
          object: store.getObject(portal.id), childCanvas, summary, childRunId, status, issueCount,
          previewResourceUri, foldedAt, reopenCanvasId: childCanvas.id, result: applied.result,
        }, [CanvasResource.object(workspaceId, portal.id), CanvasResource.canvas(workspaceId, childCanvas.id), CanvasResource.render(workspaceId, childCanvas.id)], { transactionId: tx.id, revision: applied.result.revision })
      }
      case 'canvas.get_lineage': {
        const targetId = typeof args.canvasId === 'string' ? args.canvasId : canvasId
        const canvasIds: string[] = []
        const portalObjectIds: string[] = []
        let current = store.getCanvas(targetId)
        const seen = new Set<string>()
        while (true) {
          if (seen.has(current.id)) return errorResult('INVALID_LINEAGE', `Canvas lineage contains a cycle at ${current.id}`)
          seen.add(current.id)
          canvasIds.unshift(current.id)
          if (!current.parentCanvasId) break
          if (current.parentObjectId) portalObjectIds.unshift(current.parentObjectId)
          current = store.getCanvas(current.parentCanvasId)
        }
        return okResult({ canvasIds, portalObjectIds, depth: canvasIds.length - 1, rootCanvasId: canvasIds[0], targetCanvasId: targetId }, canvasIds.map(id => CanvasResource.canvas(workspaceId, id)))
      }
      case 'canvas.get_events': {
        let events = ledger.list(workspaceId)
        if (typeof args.objectId === 'string') events = events.filter(event => event.objectIds.includes(args.objectId as string))
        if (typeof args.transactionId === 'string') events = events.filter(event => event.transactionId === args.transactionId)
        return okResult({ events, count: events.length }, [CanvasResource.events(workspaceId)])
      }
      default: return errorResult('NOT_IMPLEMENTED', `Tool ${name} is not implemented`)
    }
  }

  #roomFor(canvasId: string): StateVectorSyncRoom {
    return this.#runtime.roomForCanvas?.(canvasId) ?? this.#runtime.room
  }

  #syncHandle(canvasId: string): string {
    return this.#runtime.syncHandleForCanvas?.(canvasId) ?? `/sync?canvasId=${encodeURIComponent(canvasId)}`
  }

  #snapshotFromLedger(snapshotId: string): SnapshotRecord | undefined {
    const persisted = this.#runtime.ledger.getSnapshot(snapshotId)
    if (!persisted) return undefined
    return { snapshotId: persisted.snapshotId, workspaceId: persisted.workspaceId, canvasId: persisted.canvasId, revision: persisted.revision, state: persisted.state, createdAt: persisted.createdAt, actor: { actorType: 'system', actorId: 'persistent-snapshot' } }
  }

  #viewportBounds(viewport: Viewport): Bounds {
    return { x: viewport.x, y: viewport.y, width: viewport.width / viewport.zoom, height: viewport.height / viewport.zoom }
  }

  #notifyDelta(canvasId: string, objectIds: string[]): void {
    const { workspaceId } = this.#runtime
    this.#notifyResource(CanvasResource.canvas(workspaceId, canvasId))
    this.#notifyResource(CanvasResource.viewport(workspaceId, canvasId))
    this.#notifyResource(CanvasResource.render(workspaceId, canvasId))
    this.#notifyResource(CanvasResource.events(workspaceId))
    for (const objectId of objectIds) this.#notifyResource(CanvasResource.object(workspaceId, objectId))
  }

  #notifyResource(uri: string): void {
    const notification = { jsonrpc: '2.0', method: 'notifications/resources/updated', params: { uri } }
    const payload = `event: message\ndata: ${JSON.stringify(notification)}\n\n`
    for (const session of this.#sessions.values()) {
      if (!session.subscriptions.has(uri)) continue
      for (const stream of session.streams) stream.write(payload)
    }
  }

  #sendJson(response: any, status: number, payload: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(payload))
  }
  #sendRpc(response: any, status: number, payload: JsonRpcResponse, sessionId?: string): void {
    response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    })
    response.end(JSON.stringify(payload))
  }
  #readBody(request: any): Promise<unknown> {
    return new Promise((resolveBody, reject) => {
      const chunks: Uint8Array[] = []
      let size = 0
      request.on('data', (chunk: Uint8Array) => {
        size += chunk.byteLength
        if (size > 2_000_000) { reject(new Error('Request body exceeds 2 MB')); request.destroy() }
        else chunks.push(chunk)
      })
      request.on('end', () => {
        try { const text = Buffer.concat(chunks).toString('utf8'); resolveBody(text ? JSON.parse(text) : {}) }
        catch (error) { reject(error) }
      })
      request.on('error', reject)
    })
  }
}

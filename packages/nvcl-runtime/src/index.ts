import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CanvasObject } from '../../canvas-schema/src/index.js'
import type { CanvasToolResult } from '../../mcp-contract/src/index.js'
import type { McpReferenceCanvasServer } from '../../mcp-reference-server/src/index.js'
import type { VerificationIssue } from '../../verifier/src/index.js'

export type NvclRunStatus =
  | 'planning'
  | 'acting'
  | 'observing'
  | 'verifying'
  | 'repairing'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface NvclVerificationCheck {
  type: 'count' | 'max_overlap' | 'inside_bounds'
  [key: string]: unknown
}

export interface NvclObservation {
  runId: string
  iteration: number
  goal: string
  canvasId: string
  revision: number
  viewport: Record<string, unknown>
  objects: CanvasObject[]
  renderUri: string
  renderSvg: string
  issues: VerificationIssue[]
  eventCount: number
}

export type NvclDecision =
  | {
      type: 'tool_call'
      tool: string
      arguments: Record<string, unknown>
      summary: string
    }
  | {
      type: 'stop'
      success: boolean
      reason: string
    }

export interface NvclAgentContext {
  runId: string
  goal: string
  iteration: number
  maxIterations: number
  observation: NvclObservation
  previousDecisions: NvclDecision[]
}

export interface NvclAgent {
  readonly name: string
  decide(context: NvclAgentContext): Promise<NvclDecision>
}

export interface NvclModelRequest {
  system: string
  input: Record<string, unknown>
}

export interface NvclModelProvider {
  readonly name: string
  generate(request: NvclModelRequest): Promise<string | Record<string, unknown>>
}

export interface McpResourceContent {
  uri: string
  mimeType?: string
  text?: string
}

export interface McpCanvasClient {
  readonly actorId: string
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<CanvasToolResult<T>>
  readResource(uri: string): Promise<McpResourceContent[]>
  close?(): Promise<void>
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function asArray<T = unknown>(value: unknown, label: string): T[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  return value as T[]
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function now(): string {
  return new Date().toISOString()
}

function toolResultFromRpc<T>(response: JsonRpcResponse): CanvasToolResult<T> {
  if (response.error) throw new Error(`MCP ${response.error.code}: ${response.error.message}`)
  const result = asRecord(response.result, 'MCP tool response')
  return asRecord(result.structuredContent, 'MCP structuredContent') as unknown as CanvasToolResult<T>
}

export class LocalMcpCanvasClient implements McpCanvasClient {
  readonly actorId: string
  readonly #server: McpReferenceCanvasServer
  readonly #role: 'viewer' | 'agent-direct' | 'owner'
  #id = 1

  constructor(
    server: McpReferenceCanvasServer,
    options: { actorId?: string; role?: 'viewer' | 'agent-direct' | 'owner' } = {},
  ) {
    this.#server = server
    this.actorId = options.actorId ?? 'nvcl-local-agent'
    this.#role = options.role ?? 'owner'
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<CanvasToolResult<T>> {
    const response = await this.#server.dispatchForTesting({
      jsonrpc: '2.0',
      id: this.#id++,
      method: 'tools/call',
      params: { name, arguments: args },
    }, { role: this.#role, actorId: this.actorId })
    return toolResultFromRpc<T>(response as JsonRpcResponse)
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    const response = await this.#server.dispatchForTesting({
      jsonrpc: '2.0',
      id: this.#id++,
      method: 'resources/read',
      params: { uri },
    }, { role: this.#role, actorId: this.actorId }) as JsonRpcResponse
    if (response.error) throw new Error(`MCP ${response.error.code}: ${response.error.message}`)
    const result = asRecord(response.result, 'MCP resource response')
    return asArray<McpResourceContent>(result.contents, 'MCP contents')
  }
}

export class HttpMcpCanvasClient implements McpCanvasClient {
  readonly actorId: string
  readonly #endpoint: string
  readonly #role: 'viewer' | 'agent-direct' | 'owner'
  #sessionId = ''
  #id = 1

  constructor(endpoint: string, options: { actorId?: string; role?: 'viewer' | 'agent-direct' | 'owner' } = {}) {
    this.#endpoint = endpoint.replace(/\/$/, '')
    this.actorId = options.actorId ?? 'nvcl-http-agent'
    this.#role = options.role ?? 'owner'
  }

  async initialize(): Promise<void> {
    const response = await this.#post({
      jsonrpc: '2.0', id: this.#id++, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'nvcl-runtime', version: '0.7.0' } },
    }, true)
    if (response.error) throw new Error(`MCP initialize failed: ${response.error.message}`)
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' })
  }

  async callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<CanvasToolResult<T>> {
    if (!this.#sessionId) await this.initialize()
    const response = await this.#post({
      jsonrpc: '2.0', id: this.#id++, method: 'tools/call', params: { name, arguments: args },
    })
    return toolResultFromRpc<T>(response)
  }

  async readResource(uri: string): Promise<McpResourceContent[]> {
    if (!this.#sessionId) await this.initialize()
    const response = await this.#post({
      jsonrpc: '2.0', id: this.#id++, method: 'resources/read', params: { uri },
    })
    if (response.error) throw new Error(`MCP resource read failed: ${response.error.message}`)
    const result = asRecord(response.result, 'MCP resource response')
    return asArray<McpResourceContent>(result.contents, 'MCP contents')
  }

  async close(): Promise<void> {
    if (!this.#sessionId) return
    await fetch(this.#endpoint, { method: 'DELETE', headers: { 'Mcp-Session-Id': this.#sessionId } })
    this.#sessionId = ''
  }

  async #post(body: Record<string, unknown>, initialization = false): Promise<JsonRpcResponse> {
    const response = await fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(this.#sessionId ? { 'Mcp-Session-Id': this.#sessionId } : {}),
        ...(initialization ? { 'X-MRMIC-Role': this.#role, 'X-MRMIC-Actor-Id': this.actorId } : {}),
      },
      body: JSON.stringify(body),
    })
    const session = response.headers.get('mcp-session-id')
    if (session) this.#sessionId = session
    const text = await response.text()
    if (!text) return { jsonrpc: '2.0', id: null, result: {} }
    return JSON.parse(text) as JsonRpcResponse
  }
}

export class JsonModelNvclAgent implements NvclAgent {
  readonly name: string
  readonly #provider: NvclModelProvider

  constructor(provider: NvclModelProvider) {
    this.#provider = provider
    this.name = `json-model:${provider.name}`
  }

  async decide(context: NvclAgentContext): Promise<NvclDecision> {
    const raw = await this.#provider.generate({
      system: [
        'You are an NVCL canvas agent.',
        'Return exactly one JSON object.',
        'Use either {"type":"tool_call","tool":"canvas.*","arguments":{},"summary":"..."}',
        'or {"type":"stop","success":true|false,"reason":"..."}.',
        'All canvas changes must use the supplied MCP tools and stable object IDs.',
      ].join(' '),
      input: {
        goal: context.goal,
        iteration: context.iteration,
        maxIterations: context.maxIterations,
        observation: {
          canvasId: context.observation.canvasId,
          revision: context.observation.revision,
          viewport: context.observation.viewport,
          objects: context.observation.objects,
          issues: context.observation.issues,
          renderUri: context.observation.renderUri,
        },
      },
    })
    const parsed = typeof raw === 'string' ? JSON.parse(raw) as unknown : raw
    return validateDecision(parsed)
  }
}

export function validateDecision(value: unknown): NvclDecision {
  const record = asRecord(value, 'NVCL decision')
  const type = asString(record.type, 'decision.type')
  if (type === 'stop') {
    if (typeof record.success !== 'boolean') throw new Error('decision.success must be boolean')
    return { type, success: record.success, reason: asString(record.reason, 'decision.reason') }
  }
  if (type === 'tool_call') {
    const tool = asString(record.tool, 'decision.tool')
    if (!tool.startsWith('canvas.')) throw new Error('NVCL tool calls must target canvas.* MCP tools')
    return {
      type,
      tool,
      arguments: asRecord(record.arguments ?? {}, 'decision.arguments'),
      summary: asString(record.summary, 'decision.summary'),
    }
  }
  throw new Error(`Unsupported NVCL decision type ${type}`)
}

export class ReferenceSceneNvclAgent implements NvclAgent {
  readonly name = 'reference-scene-agent'

  async decide(context: NvclAgentContext): Promise<NvclDecision> {
    const { observation } = context
    const canvasId = observation.canvasId
    if (observation.objects.length === 0) {
      return {
        type: 'tool_call',
        tool: 'canvas.create_objects',
        summary: 'Create the complete reference scene with an intentionally overlapping title for closed-loop repair.',
        arguments: {
          canvasId,
          intent: 'Create the NVCL reference scene',
          expectedCanvasRevision: observation.revision,
          idempotencyKey: `nvcl-reference-scene:${context.runId}`,
          objects: referenceSceneObjects(),
        },
      }
    }

    const errors = observation.issues.filter(issue => issue.severity === 'error')
    if (errors.length === 0) {
      return { type: 'stop', success: true, reason: 'All deterministic verification checks pass.' }
    }

    const overlap = errors.find(issue => issue.rule === 'max_overlap' && issue.objectIds.includes('title'))
    if (overlap) {
      const title = observation.objects.find(object => object.id === 'title')
      if (!title) return { type: 'stop', success: false, reason: 'The overlap issue references a missing title object.' }
      return {
        type: 'tool_call', tool: 'canvas.patch_objects',
        summary: 'Move only the title above the character while preserving every non-target object.',
        arguments: {
          canvasId,
          intent: 'Repair title overlap using a local patch',
          expectedCanvasRevision: observation.revision,
          patches: [{ objectId: title.id, expectedRevision: title.revision, patch: { transform: { y: 55 } } }],
        },
      }
    }

    const starCount = errors.find(issue => issue.rule === 'three_stars')
    if (starCount) {
      const existing = observation.objects.filter(object => object.metadata.role === 'star').length
      const additions = referenceSceneObjects().filter(item => isRecord(item.metadata) && item.metadata.role === 'star').slice(existing)
      return {
        type: 'tool_call', tool: 'canvas.create_objects',
        summary: 'Create only the missing stars required by the count constraint.',
        arguments: {
          canvasId,
          intent: 'Repair missing star count',
          expectedCanvasRevision: observation.revision,
          objects: additions,
        },
      }
    }

    return { type: 'stop', success: false, reason: `No safe reference repair exists for issues: ${errors.map(issue => issue.rule).join(', ')}` }
  }
}

export interface NvclTraceEvent {
  eventId: string
  runId: string
  type:
    | 'run_started'
    | 'observation'
    | 'decision'
    | 'tool_result'
    | 'best_snapshot'
    | 'snapshot_restored'
    | 'run_completed'
    | 'run_failed'
    | 'run_cancelled'
  iteration: number
  timestamp: string
  payload: Record<string, unknown>
}

export interface NvclTraceSink {
  write(event: NvclTraceEvent): Promise<void> | void
  finalize?(result: NvclRunResult): Promise<void> | void
}

export class MemoryNvclTraceSink implements NvclTraceSink {
  readonly events: NvclTraceEvent[] = []
  result?: NvclRunResult

  write(event: NvclTraceEvent): void {
    this.events.push(structuredClone(event))
  }

  finalize(result: NvclRunResult): void {
    this.result = structuredClone(result)
  }
}

export function traceDirectoryName(runId: string): string {
  const normalized = runId
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
  return normalized && normalized !== '.' && normalized !== '..' ? normalized : 'run'
}

export class DirectoryNvclTraceSink implements NvclTraceSink {
  readonly root: string

  constructor(baseDirectory: string, runId: string) {
    this.root = resolve(baseDirectory, traceDirectoryName(runId))
    for (const directory of ['observations', 'decisions', 'tool-calls', 'renders', 'verifications']) {
      mkdirSync(resolve(this.root, directory), { recursive: true })
    }
  }

  write(event: NvclTraceEvent): void {
    appendFileSync(resolve(this.root, 'trace.jsonl'), `${JSON.stringify(event)}\n`)
    const index = String(event.iteration).padStart(2, '0')
    if (event.type === 'run_started') writeFileSync(resolve(this.root, 'goal.json'), JSON.stringify(event.payload, null, 2))
    if (event.type === 'observation') {
      const payload = structuredClone(event.payload)
      const svg = typeof payload.renderSvg === 'string' ? payload.renderSvg : ''
      delete payload.renderSvg
      writeFileSync(resolve(this.root, 'observations', `${index}.json`), JSON.stringify(payload, null, 2))
      writeFileSync(resolve(this.root, 'renders', `${index}.svg`), svg)
      writeFileSync(resolve(this.root, 'verifications', `${index}.json`), JSON.stringify(payload.issues ?? [], null, 2))
    }
    if (event.type === 'decision') writeFileSync(resolve(this.root, 'decisions', `${index}.json`), JSON.stringify(event.payload, null, 2))
    if (event.type === 'tool_result') writeFileSync(resolve(this.root, 'tool-calls', `${index}.json`), JSON.stringify(event.payload, null, 2))
  }

  finalize(result: NvclRunResult): void {
    writeFileSync(resolve(this.root, 'final-result.json'), JSON.stringify(result, null, 2))
    writeFileSync(resolve(this.root, 'report.md'), renderRunReport(result))
  }
}

export interface NvclRunRequest {
  goal: string
  canvasId: string
  checks: NvclVerificationCheck[]
  maxIterations?: number
  maxConsecutiveFailures?: number
  runId?: string
  signal?: AbortSignal
}

export interface NvclRunResult {
  runId: string
  goal: string
  canvasId: string
  status: 'completed' | 'failed' | 'cancelled'
  reason: string
  iterations: number
  toolCalls: number
  finalRevision: number
  finalIssues: VerificationIssue[]
  initialSnapshotId: string
  bestSnapshotId: string
  bestScore: number
  restoredBestSnapshot: boolean
  startedAt: string
  completedAt: string
  agent: string
  actorId: string
}

export class NvclRuntime {
  readonly #client: McpCanvasClient
  readonly #agent: NvclAgent
  readonly #trace: NvclTraceSink

  constructor(options: { client: McpCanvasClient; agent: NvclAgent; trace?: NvclTraceSink }) {
    this.#client = options.client
    this.#agent = options.agent
    this.#trace = options.trace ?? new MemoryNvclTraceSink()
  }

  async run(request: NvclRunRequest): Promise<NvclRunResult> {
    const runId = request.runId ?? randomUUID()
    const startedAt = now()
    const maxIterations = request.maxIterations ?? 10
    const maxFailures = request.maxConsecutiveFailures ?? 2
    let status: NvclRunResult['status'] = 'failed'
    let reason = 'Maximum iteration budget reached.'
    let finalIssues: VerificationIssue[] = []
    let finalRevision = 0
    let toolCalls = 0
    let consecutiveFailures = 0
    let restoredBestSnapshot = false
    const decisions: NvclDecision[] = []

    await this.#write(runId, 'run_started', 0, {
      goal: request.goal,
      canvasId: request.canvasId,
      checks: request.checks,
      maxIterations,
      agent: this.#agent.name,
      actorId: this.#client.actorId,
    })

    const initialSnapshot = await this.#client.callTool<{ snapshotId: string }>('canvas.create_snapshot', { canvasId: request.canvasId })
    if (!initialSnapshot.ok || !initialSnapshot.data) throw new Error(initialSnapshot.error?.message ?? 'Unable to create initial NVCL snapshot')
    const initialSnapshotId = asString((initialSnapshot.data as Record<string, unknown>).snapshotId, 'initial snapshot ID')
    let bestSnapshotId = initialSnapshotId
    let bestScore = Number.POSITIVE_INFINITY

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      if (request.signal?.aborted) {
        status = 'cancelled'
        reason = 'NVCL run was cancelled before the next observation.'
        restoredBestSnapshot = await this.#restoreBest(runId, iteration, bestSnapshotId)
        const restored = await this.#observe(runId, iteration, request)
        finalIssues = restored.issues
        finalRevision = restored.revision
        break
      }
      const observation = await this.#observe(runId, iteration, request)
      finalIssues = observation.issues
      finalRevision = observation.revision
      const score = scoreIssues(observation.issues)
      if (score < bestScore) {
        bestScore = score
        const snapshot = await this.#client.callTool<{ snapshotId: string }>('canvas.create_snapshot', { canvasId: request.canvasId })
        if (snapshot.ok && snapshot.data) {
          bestSnapshotId = asString((snapshot.data as Record<string, unknown>).snapshotId, 'best snapshot ID')
          await this.#write(runId, 'best_snapshot', iteration, { snapshotId: bestSnapshotId, score, revision: observation.revision })
        }
      }

      const decision = validateDecision(await this.#agent.decide({
        runId,
        goal: request.goal,
        iteration,
        maxIterations,
        observation,
        previousDecisions: structuredClone(decisions),
      }))
      decisions.push(decision)
      await this.#write(runId, 'decision', iteration, { decision })

      if (decision.type === 'stop') {
        status = decision.success ? 'completed' : 'failed'
        reason = decision.reason
        if (!decision.success && bestSnapshotId) {
          restoredBestSnapshot = await this.#restoreBest(runId, iteration, bestSnapshotId)
          const restored = await this.#observe(runId, iteration + 1, request)
          finalIssues = restored.issues
          finalRevision = restored.revision
        }
        break
      }

      toolCalls += 1
      let result: CanvasToolResult<unknown>
      try {
        result = await this.#client.callTool(decision.tool, decision.arguments)
      } catch (error) {
        result = {
          ok: false,
          warnings: [],
          resourceLinks: [],
          error: { code: 'MCP_CALL_FAILED', message: error instanceof Error ? error.message : String(error) },
        }
      }
      await this.#write(runId, 'tool_result', iteration, {
        tool: decision.tool,
        summary: decision.summary,
        arguments: decision.arguments,
        result,
      })
      if (!result.ok) {
        consecutiveFailures += 1
        if (consecutiveFailures >= maxFailures) {
          status = 'failed'
          reason = `Stopped after ${consecutiveFailures} consecutive MCP tool failures: ${result.error?.message ?? 'unknown error'}`
          restoredBestSnapshot = await this.#restoreBest(runId, iteration, bestSnapshotId)
          const restored = await this.#observe(runId, iteration + 1, request)
          finalIssues = restored.issues
          finalRevision = restored.revision
          break
        }
      } else {
        consecutiveFailures = 0
      }

      if (iteration === maxIterations - 1) {
        restoredBestSnapshot = await this.#restoreBest(runId, iteration, bestSnapshotId)
        const restored = await this.#observe(runId, iteration + 1, request)
        finalIssues = restored.issues
        finalRevision = restored.revision
      }
    }

    const result: NvclRunResult = {
      runId,
      goal: request.goal,
      canvasId: request.canvasId,
      status,
      reason,
      iterations: decisions.length,
      toolCalls,
      finalRevision,
      finalIssues,
      initialSnapshotId,
      bestSnapshotId,
      bestScore,
      restoredBestSnapshot,
      startedAt,
      completedAt: now(),
      agent: this.#agent.name,
      actorId: this.#client.actorId,
    }
    await this.#write(runId, status === 'completed' ? 'run_completed' : status === 'cancelled' ? 'run_cancelled' : 'run_failed', decisions.length, { result })
    await this.#trace.finalize?.(result)
    await this.#client.close?.()
    return result
  }

  async #observe(runId: string, iteration: number, request: NvclRunRequest): Promise<NvclObservation> {
    const viewportResult = await this.#client.callTool<{ viewport: Record<string, unknown>; objects: CanvasObject[]; revision: number }>('canvas.get_viewport', { canvasId: request.canvasId })
    if (!viewportResult.ok || !viewportResult.data) throw new Error(viewportResult.error?.message ?? 'Unable to observe canvas viewport')
    const viewportData = viewportResult.data as unknown as Record<string, unknown>
    const objects = asArray<CanvasObject>(viewportData.objects, 'viewport objects')
    const revision = Number(viewportData.revision)
    const safeChecks = filterChecks(request.checks, new Set(objects.map(object => object.id)))
    const verification = await this.#client.callTool<{ issues: VerificationIssue[] }>('canvas.verify', { canvasId: request.canvasId, checks: safeChecks })
    if (!verification.ok || !verification.data) throw new Error(verification.error?.message ?? 'Unable to verify canvas')
    const verifyData = verification.data as unknown as Record<string, unknown>
    const issues = asArray<VerificationIssue>(verifyData.issues, 'verification issues')
    const render = await this.#client.callTool('canvas.render_viewport', { canvasId: request.canvasId, includeGrid: true })
    if (!render.ok || render.resourceLinks.length === 0) throw new Error(render.error?.message ?? 'Unable to render viewport')
    const renderUri = render.resourceLinks[0] as string
    const resource = await this.#client.readResource(renderUri)
    const svg = resource.find(item => item.mimeType === 'image/svg+xml')?.text ?? ''
    const events = await this.#client.callTool<{ count: number }>('canvas.get_events', {})
    const eventCount = events.ok && events.data ? Number((events.data as unknown as Record<string, unknown>).count ?? 0) : 0
    const observation: NvclObservation = {
      runId,
      iteration,
      goal: request.goal,
      canvasId: request.canvasId,
      revision,
      viewport: asRecord(viewportData.viewport, 'viewport'),
      objects,
      renderUri,
      renderSvg: svg,
      issues,
      eventCount,
    }
    await this.#write(runId, 'observation', iteration, {
      canvasId: observation.canvasId,
      revision: observation.revision,
      viewport: observation.viewport,
      objects: observation.objects,
      renderUri: observation.renderUri,
      renderSvg: observation.renderSvg,
      issues: observation.issues,
      eventCount: observation.eventCount,
    })
    return observation
  }

  async #restoreBest(runId: string, iteration: number, snapshotId: string): Promise<boolean> {
    const restored = await this.#client.callTool('canvas.restore_snapshot', { snapshotId })
    await this.#write(runId, 'snapshot_restored', iteration, { snapshotId, restored })
    return restored.ok
  }

  async #write(runId: string, type: NvclTraceEvent['type'], iteration: number, payload: Record<string, unknown>): Promise<void> {
    await this.#trace.write({ eventId: randomUUID(), runId, type, iteration, timestamp: now(), payload })
  }
}

export function filterChecks(checks: NvclVerificationCheck[], ids: Set<string>): NvclVerificationCheck[] {
  return checks.filter(check => {
    if (check.type === 'max_overlap') return typeof check.foregroundId === 'string' && typeof check.backgroundId === 'string' && ids.has(check.foregroundId) && ids.has(check.backgroundId)
    if (check.type === 'inside_bounds') return typeof check.objectId === 'string' && ids.has(check.objectId)
    return true
  })
}

export function scoreIssues(issues: VerificationIssue[]): number {
  return issues.reduce((score, issue) => score + (issue.severity === 'error' ? 100 : issue.severity === 'warning' ? 10 : 1), 0)
}

export function referenceSceneObjects(): Array<Record<string, unknown>> {
  return [
    { id: 'ground', type: 'rectangle', transform: { x: 80, y: 500, width: 950, height: 140, zIndex: 1 }, style: { fill: '#86efac', stroke: '#166534' }, metadata: { role: 'ground', cornerRadius: 28 } },
    { id: 'moon', type: 'ellipse', transform: { x: 745, y: 105, width: 190, height: 190, zIndex: 2 }, style: { fill: '#fde68a', stroke: '#d97706' }, metadata: { role: 'moon' } },
    { id: 'character', type: 'ellipse', transform: { x: 430, y: 255, width: 250, height: 330, zIndex: 5 }, style: { fill: '#f9a8d4', stroke: '#9d174d' }, metadata: { role: 'character' } },
    { id: 'character-face', type: 'ellipse', transform: { x: 480, y: 300, width: 150, height: 125, zIndex: 6 }, style: { fill: '#fce7f3', stroke: '#be185d' }, metadata: { role: 'character-face' } },
    { id: 'title', type: 'text', transform: { x: 390, y: 225, width: 360, height: 70, zIndex: 12 }, style: { fill: '#312e81', stroke: 'none', fontSize: 38 }, content: { text: 'Native Visual Canvas' }, metadata: { role: 'title', fontWeight: 800 } },
    { id: 'star-1', type: 'text', transform: { x: 180, y: 145, width: 55, height: 55, zIndex: 4 }, style: { fill: '#f59e0b', stroke: 'none', fontSize: 46 }, content: { text: '★' }, metadata: { role: 'star' } },
    { id: 'star-2', type: 'text', transform: { x: 320, y: 95, width: 55, height: 55, zIndex: 4 }, style: { fill: '#f59e0b', stroke: 'none', fontSize: 46 }, content: { text: '★' }, metadata: { role: 'star' } },
    { id: 'star-3', type: 'text', transform: { x: 995, y: 205, width: 55, height: 55, zIndex: 4 }, style: { fill: '#f59e0b', stroke: 'none', fontSize: 46 }, content: { text: '★' }, metadata: { role: 'star' } },
  ]
}

function renderRunReport(result: NvclRunResult): string {
  return `# NVCL Run Report\n\n- Run: \`${result.runId}\`\n- Status: **${result.status}**\n- Agent: \`${result.agent}\`\n- Actor: \`${result.actorId}\`\n- Iterations: ${result.iterations}\n- MCP tool calls: ${result.toolCalls}\n- Final revision: ${result.finalRevision}\n- Final issues: ${result.finalIssues.length}\n- Best score: ${result.bestScore}\n- Restored best snapshot: ${result.restoredBestSnapshot}\n\n## Goal\n\n${result.goal}\n\n## Result\n\n${result.reason}\n`
}

import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CanvasObject } from '../../canvas-schema/src/index.js'
import {
  MemoryNvclTraceSink,
  NvclRuntime,
  type McpCanvasClient,
  type NvclAgent,
  type NvclAgentContext,
  type NvclDecision,
  type NvclRunResult,
  type NvclTraceSink,
  type NvclVerificationCheck,
} from '../../nvcl-runtime/src/index.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return value
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} must be a non-empty string`)
  return value
}

function asNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be a finite number`)
  return value
}

function now(): string {
  return new Date().toISOString()
}

export interface RecursivePortalSpec {
  objectId?: string
  childCanvasId?: string
  title: string
  transform?: Record<string, unknown>
  style?: Record<string, unknown>
}

export interface RecursiveNvclRunRequest {
  runId?: string
  goal: string
  parentCanvasId: string
  portal: RecursivePortalSpec
  childGoal: string
  childChecks: NvclVerificationCheck[]
  childAgent: NvclAgent
  childMaxIterations?: number
  childMaxConsecutiveFailures?: number
  childTrace?: NvclTraceSink
  signal?: AbortSignal
}

export interface FoldedSubcanvasSummary {
  title: string
  status: 'completed' | 'failed' | 'cancelled'
  childCanvasId: string
  childRunId: string
  childRevision: number
  childObjectCount: number
  issueCount: number
  summary: string
  previewResourceUri: string
  foldedAt: string
}

export interface RecursiveNvclRunResult {
  runId: string
  goal: string
  status: 'completed' | 'failed' | 'cancelled'
  reason: string
  parentCanvasId: string
  portalObjectId?: string
  childCanvasId?: string
  initialSnapshotId: string
  restoredParentSnapshot: boolean
  childResult?: NvclRunResult
  fold?: FoldedSubcanvasSummary
  lineage: string[]
  startedAt: string
  completedAt: string
  actorId: string
  agent: string
}

export type RecursiveTraceEventType =
  | 'recursive_run_started'
  | 'parent_snapshot_created'
  | 'subcanvas_opened'
  | 'child_run_started'
  | 'child_run_completed'
  | 'subcanvas_folded'
  | 'lineage_verified'
  | 'parent_snapshot_restored'
  | 'recursive_run_completed'
  | 'recursive_run_failed'
  | 'recursive_run_cancelled'

export interface RecursiveTraceEvent {
  eventId: string
  runId: string
  type: RecursiveTraceEventType
  timestamp: string
  payload: Record<string, unknown>
}

export interface RecursiveTraceSink {
  write(event: RecursiveTraceEvent): Promise<void> | void
  finalize?(result: RecursiveNvclRunResult): Promise<void> | void
}

export class MemoryRecursiveTraceSink implements RecursiveTraceSink {
  readonly events: RecursiveTraceEvent[] = []
  result?: RecursiveNvclRunResult

  write(event: RecursiveTraceEvent): void {
    this.events.push(structuredClone(event))
  }

  finalize(result: RecursiveNvclRunResult): void {
    this.result = structuredClone(result)
  }
}

export class DirectoryRecursiveTraceSink implements RecursiveTraceSink {
  readonly root: string

  constructor(baseDirectory: string, runId: string) {
    this.root = resolve(baseDirectory, runId)
    mkdirSync(this.root, { recursive: true })
  }

  write(event: RecursiveTraceEvent): void {
    appendFileSync(resolve(this.root, 'recursive-trace.jsonl'), `${JSON.stringify(event)}\n`)
    writeFileSync(resolve(this.root, `${event.type}.json`), JSON.stringify(event.payload, null, 2))
  }

  finalize(result: RecursiveNvclRunResult): void {
    writeFileSync(resolve(this.root, 'final-result.json'), JSON.stringify(result, null, 2))
    writeFileSync(resolve(this.root, 'report.md'), renderRecursiveReport(result))
  }
}

export class ReferenceDetailNvclAgent implements NvclAgent {
  readonly name = 'reference-detail-agent'

  async decide(context: NvclAgentContext): Promise<NvclDecision> {
    const { observation } = context
    if (observation.objects.length === 0) {
      return {
        type: 'tool_call',
        tool: 'canvas.create_objects',
        summary: 'Create a character-detail study with two eyes, a mouth, and an intentionally overlapping label.',
        arguments: {
          canvasId: observation.canvasId,
          intent: 'Create child character-detail scene',
          expectedCanvasRevision: observation.revision,
          idempotencyKey: `recursive-detail:${context.runId}`,
          objects: referenceDetailObjects(),
        },
      }
    }

    const errors = observation.issues.filter(issue => issue.severity === 'error')
    if (errors.length === 0) return { type: 'stop', success: true, reason: 'The child detail canvas passes every deterministic constraint.' }

    const overlap = errors.find(issue => issue.rule === 'max_overlap' && issue.objectIds.includes('detail-label'))
    if (overlap) {
      const label = observation.objects.find(object => object.id === 'detail-label')
      if (!label) return { type: 'stop', success: false, reason: 'The detail label referenced by verification is missing.' }
      return {
        type: 'tool_call',
        tool: 'canvas.patch_objects',
        summary: 'Move only the child label above the face while preserving all visual detail objects.',
        arguments: {
          canvasId: observation.canvasId,
          intent: 'Repair child label overlap using a local patch',
          expectedCanvasRevision: observation.revision,
          patches: [{ objectId: label.id, expectedRevision: label.revision, patch: { transform: { y: 55 } } }],
        },
      }
    }

    const eyeCount = errors.find(issue => issue.rule === 'two_eyes')
    if (eyeCount) {
      const current = observation.objects.filter(object => object.metadata.role === 'eye').length
      const missing = referenceDetailObjects().filter(object => isRecord(object.metadata) && object.metadata.role === 'eye').slice(current)
      return {
        type: 'tool_call',
        tool: 'canvas.create_objects',
        summary: 'Create only the missing eye objects in the child canvas.',
        arguments: {
          canvasId: observation.canvasId,
          intent: 'Repair child eye count',
          expectedCanvasRevision: observation.revision,
          objects: missing,
        },
      }
    }

    return { type: 'stop', success: false, reason: `No safe child repair exists for: ${errors.map(issue => issue.rule).join(', ')}` }
  }
}

export class RecursiveNvclRuntime {
  readonly #client: McpCanvasClient
  readonly #trace: RecursiveTraceSink

  constructor(options: { client: McpCanvasClient; trace?: RecursiveTraceSink }) {
    this.#client = options.client
    this.#trace = options.trace ?? new MemoryRecursiveTraceSink()
  }

  async run(request: RecursiveNvclRunRequest): Promise<RecursiveNvclRunResult> {
    const runId = request.runId ?? randomUUID()
    const startedAt = now()
    let initialSnapshotId = ''
    let portalObjectId: string | undefined
    let childCanvasId: string | undefined
    let childResult: NvclRunResult | undefined
    let fold: FoldedSubcanvasSummary | undefined
    let restoredParentSnapshot = false
    let lineage: string[] = []
    let status: RecursiveNvclRunResult['status'] = 'failed'
    let reason = 'Recursive NVCL run did not complete.'

    await this.#write(runId, 'recursive_run_started', {
      goal: request.goal,
      parentCanvasId: request.parentCanvasId,
      portal: request.portal,
      childGoal: request.childGoal,
      actorId: this.#client.actorId,
      childAgent: request.childAgent.name,
    })

    const snapshot = await this.#client.callTool<{ snapshotId: string }>('canvas.create_snapshot', { canvasId: request.parentCanvasId })
    if (!snapshot.ok || !snapshot.data) throw new Error(snapshot.error?.message ?? 'Unable to create recursive parent snapshot')
    initialSnapshotId = asString(asRecord(snapshot.data, 'snapshot data').snapshotId, 'snapshotId')
    await this.#write(runId, 'parent_snapshot_created', { snapshotId: initialSnapshotId })

    try {
      if (request.signal?.aborted) throw new RecursiveCancelledError('Recursive run was cancelled before opening the child canvas.')

      const opened = await this.#client.callTool('canvas.open_subcanvas', {
        canvasId: request.parentCanvasId,
        create: {
          objectId: request.portal.objectId,
          childCanvasId: request.portal.childCanvasId,
          title: request.portal.title,
          transform: request.portal.transform,
          style: request.portal.style,
          intent: `Open child world for recursive run ${runId}`,
        },
      })
      if (!opened.ok || !opened.data) throw new Error(opened.error?.message ?? 'Unable to open recursive subcanvas')
      const openedData = asRecord(opened.data, 'open_subcanvas data')
      const portal = asRecord(openedData.object, 'portal object')
      const childCanvas = asRecord(openedData.canvas, 'child canvas')
      portalObjectId = asString(portal.id, 'portal object ID')
      childCanvasId = asString(childCanvas.id, 'child canvas ID')
      await this.#write(runId, 'subcanvas_opened', { portalObjectId, childCanvasId, parentCanvasId: request.parentCanvasId })

      if (request.signal?.aborted) throw new RecursiveCancelledError('Recursive run was cancelled before the child NVCL task.')

      const childRunId = `${runId}:child`
      await this.#write(runId, 'child_run_started', { childRunId, childCanvasId, agent: request.childAgent.name })
      const childTrace = request.childTrace ?? new MemoryNvclTraceSink()
      const childRuntime = new NvclRuntime({ client: this.#client, agent: request.childAgent, trace: childTrace })
      childResult = await childRuntime.run({
        runId: childRunId,
        goal: request.childGoal,
        canvasId: childCanvasId,
        checks: request.childChecks,
        maxIterations: request.childMaxIterations ?? 6,
        maxConsecutiveFailures: request.childMaxConsecutiveFailures ?? 2,
        signal: request.signal,
      })
      await this.#write(runId, 'child_run_completed', { childResult })

      if (childResult.status !== 'completed') {
        status = childResult.status
        reason = `Child NVCL did not complete: ${childResult.reason}`
        restoredParentSnapshot = await this.#restoreParent(runId, initialSnapshotId, childResult.status === 'cancelled')
        return await this.#finish({ runId, request, startedAt, status, reason, initialSnapshotId, restoredParentSnapshot, portalObjectId, childCanvasId, childResult, fold, lineage })
      }

      const childStateResult = await this.#client.callTool('canvas.get_state', { canvasId: childCanvasId })
      if (!childStateResult.ok || !childStateResult.data) throw new Error(childStateResult.error?.message ?? 'Unable to inspect completed child canvas')
      const childState = asRecord(childStateResult.data, 'child state')
      const workspaceRecord = asRecord(childState.workspace, 'child workspace record')
      const workspaceId = asString(workspaceRecord.id, 'workspace ID')
      const childCanvasRecord = asRecord(childState.canvas, 'child canvas record')
      const childObjects = Array.isArray(childState.objects) ? childState.objects : []
      const childRevision = asNumber(childCanvasRecord.revision, 'child revision')
      const issueCount = childResult.finalIssues.length
      const previewResourceUri = `canvas://workspace/${encodeURIComponent(workspaceId)}/canvas/${encodeURIComponent(childCanvasId)}/render/current.svg`
      const summary = `${request.portal.title} ✓ · ${childObjects.length} objects · revision ${childRevision}`

      const folded = await this.#client.callTool('canvas.fold_subcanvas', {
        objectId: portalObjectId,
        summary,
        childRunId: childResult.runId,
        status: childResult.status,
        issueCount,
        previewResourceUri,
      })
      if (!folded.ok || !folded.data) throw new Error(folded.error?.message ?? 'Unable to fold the completed child canvas')
      const foldedData = asRecord(folded.data, 'fold result')
      fold = {
        title: request.portal.title,
        status: childResult.status,
        childCanvasId,
        childRunId: childResult.runId,
        childRevision,
        childObjectCount: childObjects.length,
        issueCount,
        summary,
        previewResourceUri: typeof foldedData.previewResourceUri === 'string' ? foldedData.previewResourceUri : previewResourceUri,
        foldedAt: now(),
      }
      await this.#write(runId, 'subcanvas_folded', { portalObjectId, fold })

      const lineageResult = await this.#client.callTool('canvas.get_lineage', { canvasId: childCanvasId })
      if (!lineageResult.ok || !lineageResult.data) throw new Error(lineageResult.error?.message ?? 'Unable to verify child lineage')
      const lineageData = asRecord(lineageResult.data, 'lineage result')
      lineage = Array.isArray(lineageData.canvasIds) ? lineageData.canvasIds.map(String) : []
      if (lineage.at(0) !== request.parentCanvasId || lineage.at(-1) !== childCanvasId) {
        throw new Error(`Recursive lineage is invalid: ${lineage.join(' -> ')}`)
      }
      await this.#write(runId, 'lineage_verified', { lineage, portalObjectId })

      status = 'completed'
      reason = 'Child NVCL completed, verified, folded, and linked back into the parent canvas.'
      return await this.#finish({ runId, request, startedAt, status, reason, initialSnapshotId, restoredParentSnapshot, portalObjectId, childCanvasId, childResult, fold, lineage })
    } catch (error) {
      status = error instanceof RecursiveCancelledError ? 'cancelled' : 'failed'
      reason = error instanceof Error ? error.message : String(error)
      restoredParentSnapshot = await this.#restoreParent(runId, initialSnapshotId, status === 'cancelled')
      return await this.#finish({ runId, request, startedAt, status, reason, initialSnapshotId, restoredParentSnapshot, portalObjectId, childCanvasId, childResult, fold, lineage })
    }
  }

  async #restoreParent(runId: string, snapshotId: string, cancelled: boolean): Promise<boolean> {
    const restored = await this.#client.callTool('canvas.restore_snapshot', { snapshotId })
    const ok = restored.ok
    if (ok) await this.#write(runId, 'parent_snapshot_restored', { snapshotId, cancelled })
    return ok
  }

  async #finish(input: {
    runId: string
    request: RecursiveNvclRunRequest
    startedAt: string
    status: RecursiveNvclRunResult['status']
    reason: string
    initialSnapshotId: string
    restoredParentSnapshot: boolean
    portalObjectId?: string
    childCanvasId?: string
    childResult?: NvclRunResult
    fold?: FoldedSubcanvasSummary
    lineage: string[]
  }): Promise<RecursiveNvclRunResult> {
    const result: RecursiveNvclRunResult = {
      runId: input.runId,
      goal: input.request.goal,
      status: input.status,
      reason: input.reason,
      parentCanvasId: input.request.parentCanvasId,
      portalObjectId: input.portalObjectId,
      childCanvasId: input.childCanvasId,
      initialSnapshotId: input.initialSnapshotId,
      restoredParentSnapshot: input.restoredParentSnapshot,
      childResult: input.childResult,
      fold: input.fold,
      lineage: input.lineage,
      startedAt: input.startedAt,
      completedAt: now(),
      actorId: this.#client.actorId,
      agent: input.request.childAgent.name,
    }
    const eventType: RecursiveTraceEventType = input.status === 'completed'
      ? 'recursive_run_completed'
      : input.status === 'cancelled' ? 'recursive_run_cancelled' : 'recursive_run_failed'
    await this.#write(input.runId, eventType, { result })
    await this.#trace.finalize?.(result)
    return result
  }

  async #write(runId: string, type: RecursiveTraceEventType, payload: Record<string, unknown>): Promise<void> {
    await this.#trace.write({ eventId: randomUUID(), runId, type, timestamp: now(), payload: structuredClone(payload) })
  }
}

class RecursiveCancelledError extends Error {}

export const REFERENCE_DETAIL_CHECKS: NvclVerificationCheck[] = [
  { type: 'count', role: 'eye', expected: 2, rule: 'two_eyes' },
  { type: 'max_overlap', foregroundId: 'detail-label', backgroundId: 'detail-face', maximum: 0.10 },
  { type: 'inside_bounds', objectId: 'detail-label', bounds: { x: 0, y: 0, width: 1000, height: 700 } },
]

export function referenceDetailObjects(): Array<Record<string, unknown>> {
  return [
    { id: 'detail-face', type: 'ellipse', transform: { x: 260, y: 170, width: 480, height: 360, zIndex: 1 }, style: { fill: '#fce7f3', stroke: '#9d174d', strokeWidth: 4 }, metadata: { role: 'detail-face' } },
    { id: 'detail-eye-left', type: 'ellipse', transform: { x: 365, y: 300, width: 62, height: 48, zIndex: 3 }, style: { fill: '#312e81', stroke: '#111827', strokeWidth: 2 }, metadata: { role: 'eye' } },
    { id: 'detail-eye-right', type: 'ellipse', transform: { x: 570, y: 300, width: 62, height: 48, zIndex: 3 }, style: { fill: '#312e81', stroke: '#111827', strokeWidth: 2 }, metadata: { role: 'eye' } },
    { id: 'detail-mouth', type: 'line', transform: { x: 420, y: 420, width: 170, height: 28, zIndex: 3 }, style: { fill: 'none', stroke: '#be185d', strokeWidth: 8 }, metadata: { role: 'mouth' } },
    { id: 'detail-label', type: 'text', transform: { x: 330, y: 245, width: 340, height: 64, zIndex: 7 }, style: { fill: '#4c1d95', stroke: 'none', fontSize: 34 }, content: { text: 'Character Detail' }, metadata: { role: 'detail-label' } },
  ]
}

function renderRecursiveReport(result: RecursiveNvclRunResult): string {
  return `# Recursive NVCL Run Report\n\n- Run: \`${result.runId}\`\n- Status: **${result.status}**\n- Parent canvas: \`${result.parentCanvasId}\`\n- Portal: \`${result.portalObjectId ?? 'not created'}\`\n- Child canvas: \`${result.childCanvasId ?? 'not created'}\`\n- Child run: \`${result.childResult?.runId ?? 'not started'}\`\n- Child objects: ${result.fold?.childObjectCount ?? 0}\n- Child revision: ${result.fold?.childRevision ?? 0}\n- Lineage: ${result.lineage.join(' → ') || 'unavailable'}\n- Parent restored: ${result.restoredParentSnapshot}\n\n## Goal\n\n${result.goal}\n\n## Result\n\n${result.reason}\n`
}

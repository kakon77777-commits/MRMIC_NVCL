import { createHash, randomUUID } from 'node:crypto'
import type { CanvasAdapter, RenderResult } from '../../canvas-adapter/src/index.js'
import {
  serializeCanvasState,
  stateHash,
  type CanvasState,
  type CanvasStore,
  type SerializedCanvasState,
} from '../../canvas-core/src/index.js'
import type {
  ActorRef,
  CanvasObject,
  CanvasObjectType,
  CanvasTransaction,
  ObjectContent,
  ObjectStyle,
  TransactionResult,
  Transform2D,
} from '../../canvas-schema/src/index.js'

export type ObservationMode = 'pixel' | 'structured' | 'hybrid'

export type LabErrorCode =
  | 'INVALID_ACTION'
  | 'STALE_FRAME'
  | 'FRAME_NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'ACTION_ID_REUSED'
  | 'NOTHING_TO_UNDO'
  | 'NOTHING_TO_REDO'

export class MultimodalLabError extends Error {
  constructor(readonly code: LabErrorCode, message: string) {
    super(message)
    this.name = 'MultimodalLabError'
  }
}

export interface LabObservation {
  frameId: string
  canvasId: string
  canvasRevision: number
  stateHash: string
  renderSha256: string
  renderUri: string
  observedAt: string
  expiresAt: string
  mode: ObservationMode
  viewport: RenderResult['viewport']
  width: number
  height: number
  objectCount: number
  oracleAvailable: boolean
  objects?: CanvasObject[]
}

export interface LabFrame {
  observation: LabObservation
  svg: string
}

interface LabActionBase {
  actionId: string
  frameId: string
  canvasId: string
  expectedCanvasRevision: number
  actor?: ActorRef
}

export interface CreateLabAction extends LabActionBase {
  type: 'create'
  object: {
    objectId?: string
    type: CanvasObjectType
    transform: Partial<Transform2D> & Pick<Transform2D, 'x' | 'y' | 'width' | 'height'>
    style?: ObjectStyle
    content?: ObjectContent
    metadata?: Record<string, unknown>
  }
}

export interface MoveLabAction extends LabActionBase {
  type: 'move'
  objectId: string
  x: number
  y: number
}

export interface ResizeLabAction extends LabActionBase {
  type: 'resize'
  objectId: string
  width: number
  height: number
}

export interface DeleteLabAction extends LabActionBase {
  type: 'delete'
  objectId: string
}

export interface RestyleLabAction extends LabActionBase {
  type: 'restyle'
  objectId: string
  style: ObjectStyle
}

export interface SetTextLabAction extends LabActionBase {
  type: 'set_text'
  objectId: string
  text: string
}

export interface ViewportLabAction extends LabActionBase {
  type: 'viewport'
  viewport: Partial<RenderResult['viewport']>
}

export type LabAction =
  | CreateLabAction
  | MoveLabAction
  | ResizeLabAction
  | DeleteLabAction
  | RestyleLabAction
  | SetTextLabAction
  | ViewportLabAction

export interface ActionEvidence {
  actionId: string
  actionType: LabAction['type'] | 'undo' | 'redo' | 'benchmark_reset'
  inputFrameId: string
  beforeFrameId: string
  afterFrameId: string
  canvasId: string
  beforeRevision: number
  afterRevision: number
  beforeStateHash: string
  afterStateHash: string
  beforeRenderSha256: string
  afterRenderSha256: string
  freshnessMs: number
  freshnessVerified: boolean
  transitionGuard: 'passed' | 'failed'
  verifiedChange: boolean
  affectedObjectIds: string[]
  observedAt: string
  executedAt: string
}

export interface LabActionResult {
  ok: true
  idempotentReplay: boolean
  transaction?: TransactionResult
  evidence: ActionEvidence
  observation: LabObservation
}

export interface BenchmarkVerification {
  benchmarkId: 'drag-red-circle'
  targetObjectId: 'benchmark-red-circle'
  zoneObjectId: 'benchmark-blue-zone'
  targetInsideZone: boolean
  centerDistance: number
  passed: boolean
  checkedAt: string
  canvasRevision: number
}

interface HistoryEntry {
  actionId: string
  before: CanvasState
  after: CanvasState
  affectedObjectIds: string[]
}

interface RecordedAction {
  fingerprint: string
  result: LabActionResult
}

export interface MultimodalCanvasLabOptions {
  store: CanvasStore
  adapter: CanvasAdapter
  canvasId: string
  applyTransaction(transaction: CanvasTransaction): Promise<TransactionResult>
  replaceState(input: { snapshotId: string; stateHash: string; state: SerializedCanvasState }): Promise<unknown>
  renderUri?(frameId: string): string
  leaseTtlMs?: number
  now?: () => number
}

const defaultActor: ActorRef = {
  actorType: 'user',
  actorId: 'multimodal-lab-user',
  instanceId: 'phase7-browser',
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new MultimodalLabError('INVALID_ACTION', `${label} must be finite`)
  return value
}

function fingerprint(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function cloneState(state: CanvasState): CanvasState {
  return {
    workspace: structuredClone(state.workspace),
    canvases: new Map([...state.canvases].map(([id, value]) => [id, structuredClone(value)])),
    objects: new Map([...state.objects].map(([id, value]) => [id, structuredClone(value)])),
    appliedIdempotencyKeys: new Set(state.appliedIdempotencyKeys),
  }
}

export class MultimodalCanvasLab {
  readonly #store: CanvasStore
  readonly #adapter: CanvasAdapter
  readonly #canvasId: string
  readonly #applyTransaction: MultimodalCanvasLabOptions['applyTransaction']
  readonly #replaceState: MultimodalCanvasLabOptions['replaceState']
  readonly #renderUri: NonNullable<MultimodalCanvasLabOptions['renderUri']>
  readonly #leaseTtlMs: number
  readonly #now: () => number
  readonly #initialState: CanvasState
  readonly #frames = new Map<string, LabFrame>()
  readonly #actions = new Map<string, RecordedAction>()
  readonly #trajectory: ActionEvidence[] = []
  readonly #undo: HistoryEntry[] = []
  readonly #redo: HistoryEntry[] = []

  constructor(options: MultimodalCanvasLabOptions) {
    this.#store = options.store
    this.#adapter = options.adapter
    this.#canvasId = options.canvasId
    this.#applyTransaction = options.applyTransaction
    this.#replaceState = options.replaceState
    this.#renderUri = options.renderUri ?? (frameId => `/api/lab/frame/${encodeURIComponent(frameId)}.svg`)
    this.#leaseTtlMs = options.leaseTtlMs ?? 30_000
    this.#now = options.now ?? Date.now
    this.#initialState = this.#store.snapshot()
  }

  get trajectory(): ActionEvidence[] {
    return structuredClone(this.#trajectory)
  }

  get historyStatus(): { undo: number; redo: number } {
    return { undo: this.#undo.length, redo: this.#redo.length }
  }

  frame(frameId: string): LabFrame | undefined {
    const frame = this.#frames.get(frameId)
    return frame ? structuredClone(frame) : undefined
  }

  async observe(mode: ObservationMode = 'pixel'): Promise<LabObservation> {
    if (!['pixel', 'structured', 'hybrid'].includes(mode)) {
      throw new MultimodalLabError('INVALID_ACTION', `Unknown observation mode ${mode}`)
    }
    const observedAtMs = this.#now()
    const render = await this.#adapter.render({ canvasId: this.#canvasId, includeGrid: true })
    const objects = await this.#adapter.listObjects(this.#canvasId)
    const frameId = randomUUID()
    const observation: LabObservation = {
      frameId,
      canvasId: this.#canvasId,
      canvasRevision: this.#store.getCanvas(this.#canvasId).revision,
      stateHash: stateHash(this.#store.snapshot()),
      renderSha256: createHash('sha256').update(render.svg).digest('hex'),
      renderUri: this.#renderUri(frameId),
      observedAt: new Date(observedAtMs).toISOString(),
      expiresAt: new Date(observedAtMs + this.#leaseTtlMs).toISOString(),
      mode,
      viewport: render.viewport,
      width: render.width,
      height: render.height,
      objectCount: objects.length,
      oracleAvailable: mode !== 'pixel',
      ...(mode === 'structured' ? { objects } : {}),
    }
    this.#frames.set(frameId, { observation, svg: render.svg })
    this.#pruneFrames(observedAtMs)
    return structuredClone(observation)
  }

  async execute(action: LabAction, outputMode: ObservationMode = 'hybrid'): Promise<LabActionResult> {
    this.#assertActionBase(action)
    const actionFingerprint = fingerprint(action)
    const recorded = this.#actions.get(action.actionId)
    if (recorded) {
      if (recorded.fingerprint !== actionFingerprint) {
        throw new MultimodalLabError('ACTION_ID_REUSED', `Action ID ${action.actionId} was already used with different input`)
      }
      return { ...structuredClone(recorded.result), idempotentReplay: true }
    }

    const frame = this.#assertFreshFrame(action.frameId, action.canvasId, action.expectedCanvasRevision)
    if (action.type === 'viewport') return await this.#executeViewport(action, frame, actionFingerprint, outputMode)
    const before = this.#store.snapshot()
    const transaction = this.#transactionFor(action)
    const result = await this.#applyTransaction(transaction)
    const after = this.#store.snapshot()
    const afterObservation = await this.observe(outputMode)
    const evidence = this.#evidence({
      actionId: action.actionId,
      actionType: action.type,
      frame,
      afterObservation,
      beforeRevision: frame.observation.canvasRevision,
      beforeStateHash: result.beforeHash,
      afterStateHash: result.afterHash,
      affectedObjectIds: result.affectedObjectIds,
    })
    const response: LabActionResult = {
      ok: true,
      idempotentReplay: false,
      transaction: result,
      evidence,
      observation: afterObservation,
    }
    this.#undo.push({ actionId: action.actionId, before: cloneState(before), after: cloneState(after), affectedObjectIds: result.affectedObjectIds })
    this.#redo.length = 0
    this.#trajectory.push(evidence)
    this.#actions.set(action.actionId, { fingerprint: actionFingerprint, result: structuredClone(response) })
    return response
  }

  async undo(actionId: string, frameId: string, outputMode: ObservationMode = 'hybrid'): Promise<LabActionResult> {
    const actionFingerprint = fingerprint({ actionId, frameId, outputMode, type: 'undo' })
    const recorded = this.#actions.get(actionId)
    if (recorded) {
      if (recorded.fingerprint !== actionFingerprint) throw new MultimodalLabError('ACTION_ID_REUSED', `Action ID ${actionId} was already used with different input`)
      return { ...structuredClone(recorded.result), idempotentReplay: true }
    }
    const input = this.#assertHistoryRequest(actionId, frameId)
    const entry = this.#undo.pop()
    if (!entry) throw new MultimodalLabError('NOTHING_TO_UNDO', 'No reversible canvas action is available')
    try {
      const result = await this.#replaceWith(entry.before, `undo:${actionId}`)
      this.#redo.push(entry)
      const response = await this.#historyResult('undo', actionId, input, result, entry.affectedObjectIds, outputMode)
      this.#actions.set(actionId, { fingerprint: actionFingerprint, result: structuredClone(response) })
      return response
    } catch (error) {
      this.#undo.push(entry)
      throw error
    }
  }

  async redo(actionId: string, frameId: string, outputMode: ObservationMode = 'hybrid'): Promise<LabActionResult> {
    const actionFingerprint = fingerprint({ actionId, frameId, outputMode, type: 'redo' })
    const recorded = this.#actions.get(actionId)
    if (recorded) {
      if (recorded.fingerprint !== actionFingerprint) throw new MultimodalLabError('ACTION_ID_REUSED', `Action ID ${actionId} was already used with different input`)
      return { ...structuredClone(recorded.result), idempotentReplay: true }
    }
    const input = this.#assertHistoryRequest(actionId, frameId)
    const entry = this.#redo.pop()
    if (!entry) throw new MultimodalLabError('NOTHING_TO_REDO', 'No canvas action is available to redo')
    try {
      const result = await this.#replaceWith(entry.after, `redo:${actionId}`)
      this.#undo.push(entry)
      const response = await this.#historyResult('redo', actionId, input, result, entry.affectedObjectIds, outputMode)
      this.#actions.set(actionId, { fingerprint: actionFingerprint, result: structuredClone(response) })
      return response
    } catch (error) {
      this.#redo.push(entry)
      throw error
    }
  }

  async resetBenchmark(actionId: string, frameId?: string, outputMode: ObservationMode = 'hybrid'): Promise<LabActionResult> {
    if (!actionId.trim()) throw new MultimodalLabError('INVALID_ACTION', 'actionId is required')
    const actionFingerprint = fingerprint({ actionId, frameId, outputMode, type: 'benchmark_reset' })
    const recorded = this.#actions.get(actionId)
    if (recorded) {
      if (recorded.fingerprint !== actionFingerprint) throw new MultimodalLabError('ACTION_ID_REUSED', `Action ID ${actionId} was already used with different input`)
      return { ...structuredClone(recorded.result), idempotentReplay: true }
    }
    const input = frameId ? this.#assertFreshFrame(frameId, this.#canvasId) : await this.#frameFromObservation('hybrid')
    const before = this.#store.snapshot()
    await this.#replaceWith(this.#initialState, `benchmark-base:${actionId}`)
    const transaction = this.#benchmarkTransaction(actionId)
    const result = await this.#applyTransaction(transaction)
    const after = this.#store.snapshot()
    const afterObservation = await this.observe(outputMode)
    const evidence = this.#evidence({
      actionId,
      actionType: 'benchmark_reset',
      frame: input,
      afterObservation,
      beforeRevision: input.observation.canvasRevision,
      beforeStateHash: stateHash(before),
      afterStateHash: result.afterHash,
      affectedObjectIds: result.affectedObjectIds,
    })
    this.#undo.push({ actionId, before: cloneState(before), after: cloneState(after), affectedObjectIds: result.affectedObjectIds })
    this.#redo.length = 0
    this.#trajectory.push(evidence)
    const response: LabActionResult = { ok: true, idempotentReplay: false, transaction: result, evidence, observation: afterObservation }
    this.#actions.set(actionId, { fingerprint: actionFingerprint, result: structuredClone(response) })
    return response
  }

  verifyBenchmark(): BenchmarkVerification {
    const target = this.#store.getObject('benchmark-red-circle')
    const zone = this.#store.getObject('benchmark-blue-zone')
    const centerX = target.transform.x + target.transform.width / 2
    const centerY = target.transform.y + target.transform.height / 2
    const zoneCenterX = zone.transform.x + zone.transform.width / 2
    const zoneCenterY = zone.transform.y + zone.transform.height / 2
    const targetInsideZone =
      target.transform.x >= zone.transform.x &&
      target.transform.y >= zone.transform.y &&
      target.transform.x + target.transform.width <= zone.transform.x + zone.transform.width &&
      target.transform.y + target.transform.height <= zone.transform.y + zone.transform.height
    return {
      benchmarkId: 'drag-red-circle',
      targetObjectId: 'benchmark-red-circle',
      zoneObjectId: 'benchmark-blue-zone',
      targetInsideZone,
      centerDistance: Math.hypot(centerX - zoneCenterX, centerY - zoneCenterY),
      passed: targetInsideZone,
      checkedAt: new Date(this.#now()).toISOString(),
      canvasRevision: this.#store.getCanvas(this.#canvasId).revision,
    }
  }

  #assertActionBase(action: LabAction): void {
    if (!action.actionId?.trim()) throw new MultimodalLabError('INVALID_ACTION', 'Every physical or semantic action requires actionId')
    if (!action.frameId?.trim()) throw new MultimodalLabError('INVALID_ACTION', 'Every action requires a fresh frameId')
    if (action.canvasId !== this.#canvasId) throw new MultimodalLabError('INVALID_ACTION', `Action canvas must be ${this.#canvasId}`)
    if (!Number.isInteger(action.expectedCanvasRevision) || action.expectedCanvasRevision < 0) {
      throw new MultimodalLabError('INVALID_ACTION', 'expectedCanvasRevision must be a non-negative integer')
    }
  }

  #assertFreshFrame(frameId: string, canvasId: string, expectedRevision?: number): LabFrame {
    const frame = this.#frames.get(frameId)
    if (!frame) throw new MultimodalLabError('FRAME_NOT_FOUND', `Frame ${frameId} is unavailable`)
    const age = this.#now() - Date.parse(frame.observation.observedAt)
    if (age < 0 || age > this.#leaseTtlMs) throw new MultimodalLabError('STALE_FRAME', `Frame ${frameId} is stale (${age} ms)`)
    if (frame.observation.canvasId !== canvasId) throw new MultimodalLabError('STALE_FRAME', 'Frame belongs to a different canvas')
    const revision = this.#store.getCanvas(canvasId).revision
    if (revision !== frame.observation.canvasRevision || (expectedRevision !== undefined && revision !== expectedRevision)) {
      throw new MultimodalLabError('REVISION_CONFLICT', `Frame revision ${frame.observation.canvasRevision} does not match current revision ${revision}`)
    }
    const currentHash = stateHash(this.#store.snapshot())
    if (currentHash !== frame.observation.stateHash) throw new MultimodalLabError('STALE_FRAME', 'Frame state hash no longer matches the canvas')
    return structuredClone(frame)
  }

  #transactionFor(action: LabAction): CanvasTransaction {
    if (action.type === 'viewport') throw new MultimodalLabError('INVALID_ACTION', 'Viewport actions are not canvas transactions')
    const now = new Date(this.#now()).toISOString()
    const actor = action.actor ?? defaultActor
    const preconditions: CanvasTransaction['preconditions'] = [
      { type: 'canvas_revision', targetId: action.canvasId, expected: action.expectedCanvasRevision },
    ]
    let operations: CanvasTransaction['operations']
    let intent: string

    if (action.type === 'create') {
      const objectId = action.object.objectId?.trim() || `lab-${randomUUID()}`
      const transform: Transform2D = {
        x: finite(action.object.transform.x, 'x'),
        y: finite(action.object.transform.y, 'y'),
        width: Math.max(1, finite(action.object.transform.width, 'width')),
        height: Math.max(1, finite(action.object.transform.height, 'height')),
        rotation: finite(action.object.transform.rotation ?? 0, 'rotation'),
        scaleX: finite(action.object.transform.scaleX ?? 1, 'scaleX'),
        scaleY: finite(action.object.transform.scaleY ?? 1, 'scaleY'),
        zIndex: finite(action.object.transform.zIndex ?? this.#nextZIndex(), 'zIndex'),
      }
      const object: CanvasObject = {
        id: objectId,
        canvasId: action.canvasId,
        type: action.object.type,
        transform,
        style: { fill: '#ffffff', stroke: '#172033', strokeWidth: 2, opacity: 1, ...action.object.style },
        ...(action.object.content ? { content: structuredClone(action.object.content) } : {}),
        childIds: [],
        bindings: [],
        metadata: { labCreated: true, ...action.object.metadata },
        createdBy: structuredClone(actor),
        createdAt: now,
        updatedAt: now,
        revision: 0,
      }
      operations = [{ op: 'create_object', object }]
      intent = `Phase 7 ${actor.actorType} creates ${object.type} ${object.id}`
    } else {
      const object = this.#store.getObject(action.objectId)
      preconditions.push({ type: 'object_revision', targetId: object.id, expected: object.revision })
      if (action.type === 'move') {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { transform: { x: finite(action.x, 'x'), y: finite(action.y, 'y') } } }]
        intent = `Phase 7 moves ${object.id}`
      } else if (action.type === 'resize') {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { transform: { width: Math.max(1, finite(action.width, 'width')), height: Math.max(1, finite(action.height, 'height')) } } }]
        intent = `Phase 7 resizes ${object.id}`
      } else if (action.type === 'delete') {
        operations = [{ op: 'delete_object', objectId: object.id, expectedRevision: object.revision }]
        intent = `Phase 7 deletes ${object.id}`
      } else if (action.type === 'restyle') {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { style: structuredClone(action.style) } }]
        intent = `Phase 7 restyles ${object.id}`
      } else {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { content: { text: action.text } } }]
        intent = `Phase 7 edits text in ${object.id}`
      }
    }

    return {
      id: action.actionId,
      canvasId: action.canvasId,
      actor: structuredClone(actor),
      intent,
      expectedOutcome: 'A fresh, authorized and reversible canvas transition',
      preconditions,
      operations,
      mode: 'direct',
      createdAt: now,
      idempotencyKey: `phase7-action:${action.actionId}`,
    }
  }

  #benchmarkTransaction(actionId: string): CanvasTransaction {
    const now = new Date(this.#now()).toISOString()
    const actor: ActorRef = { actorType: 'system', actorId: 'phase7-benchmark', instanceId: 'drag-red-circle' }
    const make = (
      id: string,
      type: CanvasObjectType,
      transform: Partial<Transform2D> & Pick<Transform2D, 'x' | 'y' | 'width' | 'height'>,
      style: ObjectStyle,
      metadata: Record<string, unknown>,
      content?: ObjectContent,
    ): CanvasObject => ({
      id,
      canvasId: this.#canvasId,
      type,
      transform: { rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1, ...transform },
      style: { opacity: 1, strokeWidth: 2, ...style },
      ...(content ? { content } : {}),
      childIds: [],
      bindings: [],
      metadata,
      createdBy: actor,
      createdAt: now,
      updatedAt: now,
      revision: 0,
    })
    const objects = [
      make('benchmark-title', 'text', { x: 55, y: 55, width: 620, height: 50, zIndex: 10 }, { fill: '#172033', stroke: 'none', fontSize: 30 }, { role: 'instruction' }, { text: '將紅色圓形拖入藍色目標框' }),
      make('benchmark-red-circle', 'ellipse', { x: 90, y: 230, width: 110, height: 110, zIndex: 5 }, { fill: '#ef4444', stroke: '#991b1b', strokeWidth: 4 }, { role: 'movable-target', color: 'red' }),
      make('benchmark-blue-zone', 'frame', { x: 455, y: 185, width: 220, height: 200, zIndex: 2 }, { fill: '#dbeafe', stroke: '#2563eb', strokeWidth: 5 }, { role: 'drop-zone', color: 'blue' }),
      make('benchmark-green-distractor', 'rectangle', { x: 245, y: 470, width: 135, height: 80, zIndex: 3 }, { fill: '#86efac', stroke: '#166534', strokeWidth: 3 }, { role: 'distractor', color: 'green' }),
      make('benchmark-yellow-distractor', 'ellipse', { x: 485, y: 470, width: 85, height: 85, zIndex: 3 }, { fill: '#fde047', stroke: '#a16207', strokeWidth: 3 }, { role: 'distractor', color: 'yellow' }),
    ]
    return {
      id: `benchmark:${actionId}`,
      canvasId: this.#canvasId,
      actor,
      intent: 'Reset the Phase 7 drag-red-circle benchmark',
      expectedOutcome: 'A deterministic, reversible visual interaction task',
      preconditions: [{ type: 'canvas_revision', targetId: this.#canvasId, expected: this.#store.getCanvas(this.#canvasId).revision }],
      operations: objects.map(object => ({ op: 'create_object' as const, object })),
      mode: 'direct',
      createdAt: now,
      idempotencyKey: `phase7-benchmark:${actionId}`,
    }
  }

  #assertHistoryRequest(actionId: string, frameId: string): LabFrame {
    if (!actionId.trim()) throw new MultimodalLabError('INVALID_ACTION', 'History action requires actionId')
    return this.#assertFreshFrame(frameId, this.#canvasId)
  }

  async #replaceWith(state: CanvasState, snapshotId: string): Promise<TransactionResult> {
    const beforeHash = stateHash(this.#store.snapshot())
    const affectedObjectIds = [...new Set([
      ...this.#store.listObjects(this.#canvasId).map(item => item.id),
      ...[...state.objects.values()].filter(item => item.canvasId === this.#canvasId).map(item => item.id),
    ])]
    await this.#replaceState({ snapshotId, stateHash: stateHash(state), state: serializeCanvasState(state) })
    const canvas = this.#store.getCanvas(this.#canvasId)
    return {
      ok: true,
      transactionId: snapshotId,
      canvasId: this.#canvasId,
      revision: canvas.revision,
      affectedObjectIds,
      beforeHash,
      afterHash: stateHash(this.#store.snapshot()),
    }
  }

  async #historyResult(
    actionType: 'undo' | 'redo',
    actionId: string,
    frame: LabFrame,
    transaction: TransactionResult,
    affectedObjectIds: string[],
    outputMode: ObservationMode,
  ): Promise<LabActionResult> {
    const afterObservation = await this.observe(outputMode)
    const evidence = this.#evidence({
      actionId,
      actionType,
      frame,
      afterObservation,
      beforeRevision: frame.observation.canvasRevision,
      beforeStateHash: transaction.beforeHash,
      afterStateHash: transaction.afterHash,
      affectedObjectIds,
    })
    this.#trajectory.push(evidence)
    return { ok: true, idempotentReplay: false, transaction, evidence, observation: afterObservation }
  }

  async #executeViewport(
    action: ViewportLabAction,
    frame: LabFrame,
    actionFingerprint: string,
    outputMode: ObservationMode,
  ): Promise<LabActionResult> {
    const current = await this.#adapter.getViewport()
    const next = {
      x: finite(action.viewport.x ?? current.x, 'viewport.x'),
      y: finite(action.viewport.y ?? current.y, 'viewport.y'),
      width: Math.max(1, finite(action.viewport.width ?? current.width, 'viewport.width')),
      height: Math.max(1, finite(action.viewport.height ?? current.height, 'viewport.height')),
      zoom: Math.min(8, Math.max(0.1, finite(action.viewport.zoom ?? current.zoom, 'viewport.zoom'))),
    }
    await this.#adapter.setViewport(next)
    const afterObservation = await this.observe(outputMode)
    const currentStateHash = stateHash(this.#store.snapshot())
    const evidence = this.#evidence({
      actionId: action.actionId,
      actionType: action.type,
      frame,
      afterObservation,
      beforeRevision: frame.observation.canvasRevision,
      beforeStateHash: currentStateHash,
      afterStateHash: currentStateHash,
      affectedObjectIds: [],
    })
    const response: LabActionResult = {
      ok: true,
      idempotentReplay: false,
      evidence,
      observation: afterObservation,
    }
    this.#trajectory.push(evidence)
    this.#actions.set(action.actionId, { fingerprint: actionFingerprint, result: structuredClone(response) })
    return response
  }

  #evidence(input: {
    actionId: string
    actionType: ActionEvidence['actionType']
    frame: LabFrame
    afterObservation: LabObservation
    beforeRevision: number
    beforeStateHash: string
    afterStateHash: string
    affectedObjectIds: string[]
  }): ActionEvidence {
    const executedAtMs = this.#now()
    const freshnessMs = executedAtMs - Date.parse(input.frame.observation.observedAt)
    const verifiedChange = input.beforeStateHash !== input.afterStateHash || input.frame.observation.renderSha256 !== input.afterObservation.renderSha256
    return {
      actionId: input.actionId,
      actionType: input.actionType,
      inputFrameId: input.frame.observation.frameId,
      beforeFrameId: input.frame.observation.frameId,
      afterFrameId: input.afterObservation.frameId,
      canvasId: this.#canvasId,
      beforeRevision: input.beforeRevision,
      afterRevision: input.afterObservation.canvasRevision,
      beforeStateHash: input.beforeStateHash,
      afterStateHash: input.afterStateHash,
      beforeRenderSha256: input.frame.observation.renderSha256,
      afterRenderSha256: input.afterObservation.renderSha256,
      freshnessMs,
      freshnessVerified: freshnessMs >= 0 && freshnessMs <= this.#leaseTtlMs,
      transitionGuard: verifiedChange ? 'passed' : 'failed',
      verifiedChange,
      affectedObjectIds: [...input.affectedObjectIds],
      observedAt: input.frame.observation.observedAt,
      executedAt: new Date(executedAtMs).toISOString(),
    }
  }

  #nextZIndex(): number {
    const objects = this.#store.listObjects(this.#canvasId)
    return objects.length ? Math.max(...objects.map(item => item.transform.zIndex)) + 1 : 1
  }

  async #frameFromObservation(mode: ObservationMode): Promise<LabFrame> {
    const observation = await this.observe(mode)
    const frame = this.#frames.get(observation.frameId)
    if (!frame) throw new MultimodalLabError('FRAME_NOT_FOUND', 'Fresh observation was not retained')
    return structuredClone(frame)
  }

  #pruneFrames(nowMs: number): void {
    if (this.#frames.size <= 200) return
    const frames = [...this.#frames.entries()].sort((a, b) => Date.parse(a[1].observation.observedAt) - Date.parse(b[1].observation.observedAt))
    for (const [frameId, frame] of frames) {
      if (this.#frames.size <= 120) break
      if (nowMs - Date.parse(frame.observation.observedAt) > this.#leaseTtlMs) this.#frames.delete(frameId)
    }
  }
}

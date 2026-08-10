import { createHash, randomUUID } from 'node:crypto'
import { Resvg } from '@resvg/resvg-js'
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
  | 'NO_GESTURE_TARGET'
  | 'RASTER_NOT_FOUND'

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
  rasterUri: string
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

export interface RasterCrop {
  x: number
  y: number
  width: number
  height: number
}

export interface LabRasterObservation {
  rasterId: string
  frameId: string
  mimeType: 'image/png'
  width: number
  height: number
  byteLength: number
  sha256: string
  sourceRenderSha256: string
  uri: string
  crop?: RasterCrop
}

export interface LabRasterFrame {
  observation: LabRasterObservation
  png: Uint8Array
  perceptualSignature: RasterPerceptualSignature
}

export interface RasterPerceptualSignature {
  width: number
  height: number
  channels: 3
  samples: Uint8Array
}

interface LabActionBase {
  actionId: string
  frameId: string
  canvasId: string
  expectedCanvasRevision: number
  actor?: ActorRef
}

export type GestureCoordinateSpace = 'normalized_frame' | 'frame_pixel'

export interface GesturePoint {
  x: number
  y: number
}

export type PixelGesture =
  | { kind: 'drag'; from: GesturePoint; to: GesturePoint }
  | { kind: 'resize'; from: GesturePoint; to: GesturePoint }
  | { kind: 'delete'; at: GesturePoint }
  | { kind: 'restyle'; at: GesturePoint; style: ObjectStyle }
  | { kind: 'type_text'; at: GesturePoint; text: string }
  | { kind: 'draw_path'; points: GesturePoint[]; style?: ObjectStyle }
  | { kind: 'pan'; from: GesturePoint; to: GesturePoint }
  | { kind: 'zoom'; at: GesturePoint; factor: number }

export interface GestureLabAction extends LabActionBase {
  type: 'gesture'
  coordinateSpace: GestureCoordinateSpace
  gesture: PixelGesture
  confidence?: number
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
  | GestureLabAction

export interface GestureEvidence {
  kind: PixelGesture['kind']
  coordinateSpace: GestureCoordinateSpace
  framePoints: GesturePoint[]
  worldPoints: GesturePoint[]
  hitTestVerified: boolean
  resolvedObjectCount: number
}

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
  gesture?: GestureEvidence
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
  rasterUri?(frameId: string): string
  rasterResourceUri?(rasterId: string): string
  leaseTtlMs?: number
  now?: () => number
}

const defaultActor: ActorRef = {
  actorType: 'user',
  actorId: 'multimodal-lab-user',
  instanceId: 'phase9-browser',
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
  readonly #rasterUri: NonNullable<MultimodalCanvasLabOptions['rasterUri']>
  readonly #rasterResourceUri: NonNullable<MultimodalCanvasLabOptions['rasterResourceUri']>
  readonly #leaseTtlMs: number
  readonly #now: () => number
  readonly #initialState: CanvasState
  readonly #frames = new Map<string, LabFrame>()
  readonly #rasters = new Map<string, LabRasterFrame>()
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
    this.#rasterUri = options.rasterUri ?? (frameId => `/api/lab/frame/${encodeURIComponent(frameId)}.png`)
    this.#rasterResourceUri = options.rasterResourceUri ?? (rasterId => `/api/lab/raster/${encodeURIComponent(rasterId)}.png`)
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

  raster(rasterId: string): LabRasterFrame | undefined {
    const raster = this.#rasters.get(rasterId)
    return raster ? structuredClone(raster) : undefined
  }

  async rasterize(frameId: string, crop?: RasterCrop): Promise<LabRasterFrame> {
    const frame = this.#frames.get(frameId)
    if (!frame) throw new MultimodalLabError('FRAME_NOT_FOUND', `Frame ${frameId} is unavailable`)
    const normalizedCrop = crop ? this.#validateCrop(crop, frame.observation) : undefined
    const svg = normalizedCrop ? this.#croppedSvg(frame, normalizedCrop) : frame.svg
    let rendered: ReturnType<Resvg['render']>
    try {
      rendered = new Resvg(svg, {
        background: '#f8fafc',
        fitTo: { mode: 'original' },
        font: { loadSystemFonts: true },
      }).render()
    } catch (error) {
      throw new MultimodalLabError('INVALID_ACTION', `Unable to rasterize frame: ${error instanceof Error ? error.message : String(error)}`)
    }
    const png = new Uint8Array(rendered.asPng())
    const perceptualSignature = this.#perceptualSignature(new Uint8Array(rendered.pixels), rendered.width, rendered.height)
    const sha256 = createHash('sha256').update(png).digest('hex')
    const rasterId = createHash('sha256')
      .update(JSON.stringify({ frameId, crop: normalizedCrop ?? null, sha256 }))
      .digest('hex')
    const observation: LabRasterObservation = {
      rasterId,
      frameId,
      mimeType: 'image/png',
      width: rendered.width,
      height: rendered.height,
      byteLength: png.byteLength,
      sha256,
      sourceRenderSha256: frame.observation.renderSha256,
      uri: this.#rasterResourceUri(rasterId),
      ...(normalizedCrop ? { crop: normalizedCrop } : {}),
    }
    const raster = { observation, png, perceptualSignature }
    this.#rasters.set(rasterId, structuredClone(raster))
    return structuredClone(raster)
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
      rasterUri: this.#rasterUri(frameId),
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

    const frame = await this.#assertFreshFrame(action.frameId, action.canvasId, action.expectedCanvasRevision)
    if (action.type === 'viewport') return await this.#executeViewport(action, frame, actionFingerprint, outputMode)
    if (action.type === 'gesture') return await this.#executeGesture(action, frame, actionFingerprint, outputMode)
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
    const input = await this.#assertHistoryRequest(actionId, frameId)
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
    const input = await this.#assertHistoryRequest(actionId, frameId)
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
    const input = frameId ? await this.#assertFreshFrame(frameId, this.#canvasId) : await this.#frameFromObservation('hybrid')
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

  async #assertFreshFrame(frameId: string, canvasId: string, expectedRevision?: number): Promise<LabFrame> {
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
    const currentViewport = await this.#adapter.getViewport()
    const observedViewport = frame.observation.viewport
    if (
      currentViewport.x !== observedViewport.x
      || currentViewport.y !== observedViewport.y
      || currentViewport.width !== observedViewport.width
      || currentViewport.height !== observedViewport.height
      || currentViewport.zoom !== observedViewport.zoom
    ) {
      throw new MultimodalLabError('STALE_FRAME', 'Frame viewport no longer matches the current visual surface')
    }
    return structuredClone(frame)
  }

  #transactionFor(action: LabAction): CanvasTransaction {
    if (action.type === 'viewport' || action.type === 'gesture') throw new MultimodalLabError('INVALID_ACTION', `${action.type} actions require dedicated resolution`)
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
      intent = `Phase 9 ${actor.actorType} creates ${object.type} ${object.id}`
    } else {
      const object = this.#store.getObject(action.objectId)
      preconditions.push({ type: 'object_revision', targetId: object.id, expected: object.revision })
      if (action.type === 'move') {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { transform: { x: finite(action.x, 'x'), y: finite(action.y, 'y') } } }]
        intent = `Phase 9 moves ${object.id}`
      } else if (action.type === 'resize') {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { transform: { width: Math.max(1, finite(action.width, 'width')), height: Math.max(1, finite(action.height, 'height')) } } }]
        intent = `Phase 9 resizes ${object.id}`
      } else if (action.type === 'delete') {
        operations = [{ op: 'delete_object', objectId: object.id, expectedRevision: object.revision }]
        intent = `Phase 9 deletes ${object.id}`
      } else if (action.type === 'restyle') {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { style: structuredClone(action.style) } }]
        intent = `Phase 9 restyles ${object.id}`
      } else {
        operations = [{ op: 'patch_object', objectId: object.id, expectedRevision: object.revision, patch: { content: { text: action.text } } }]
        intent = `Phase 9 edits text in ${object.id}`
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
      idempotencyKey: `phase9-action:${action.actionId}`,
    }
  }

  #benchmarkTransaction(actionId: string): CanvasTransaction {
    const now = new Date(this.#now()).toISOString()
    const actor: ActorRef = { actorType: 'system', actorId: 'phase9-benchmark', instanceId: 'drag-red-circle' }
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
      intent: 'Reset the Phase 9 drag-red-circle benchmark',
      expectedOutcome: 'A deterministic, reversible visual interaction task',
      preconditions: [{ type: 'canvas_revision', targetId: this.#canvasId, expected: this.#store.getCanvas(this.#canvasId).revision }],
      operations: objects.map(object => ({ op: 'create_object' as const, object })),
      mode: 'direct',
      createdAt: now,
      idempotencyKey: `phase9-benchmark:${actionId}`,
    }
  }

  async #assertHistoryRequest(actionId: string, frameId: string): Promise<LabFrame> {
    if (!actionId.trim()) throw new MultimodalLabError('INVALID_ACTION', 'History action requires actionId')
    return await this.#assertFreshFrame(frameId, this.#canvasId)
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

  async #executeGesture(
    action: GestureLabAction,
    frame: LabFrame,
    actionFingerprint: string,
    outputMode: ObservationMode,
  ): Promise<LabActionResult> {
    const resolved = this.#resolveGesture(action, frame)
    if (resolved.viewport) {
      const currentStateHash = stateHash(this.#store.snapshot())
      await this.#adapter.setViewport(resolved.viewport)
      const afterObservation = await this.observe(outputMode)
      const evidence = this.#evidence({
        actionId: action.actionId,
        actionType: action.type,
        frame,
        afterObservation,
        beforeRevision: frame.observation.canvasRevision,
        beforeStateHash: currentStateHash,
        afterStateHash: currentStateHash,
        affectedObjectIds: [],
        gesture: resolved.evidence,
      })
      const response: LabActionResult = { ok: true, idempotentReplay: false, evidence, observation: afterObservation }
      this.#trajectory.push(evidence)
      this.#actions.set(action.actionId, { fingerprint: actionFingerprint, result: structuredClone(response) })
      return response
    }
    if (!resolved.transaction) throw new MultimodalLabError('INVALID_ACTION', 'Gesture did not resolve to a mutation')
    const before = this.#store.snapshot()
    const result = await this.#applyTransaction(resolved.transaction)
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
      gesture: resolved.evidence,
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

  #resolveGesture(action: GestureLabAction, frame: LabFrame): {
    transaction?: CanvasTransaction
    viewport?: RenderResult['viewport']
    evidence: GestureEvidence
  } {
    const framePoints = this.#gesturePoints(action.gesture)
    const worldPoints = framePoints.map(point => this.#resolveGesturePoint(point, action.coordinateSpace, frame).world)
    const base = {
      actionId: action.actionId,
      frameId: action.frameId,
      canvasId: action.canvasId,
      expectedCanvasRevision: action.expectedCanvasRevision,
      ...(action.actor ? { actor: structuredClone(action.actor) } : {}),
    }
    let semantic: Exclude<LabAction, GestureLabAction | ViewportLabAction> | undefined
    let viewport: RenderResult['viewport'] | undefined
    let targetIds: string[] = []
    let requiresHitTest = true

    if (action.gesture.kind === 'drag') {
      const [from, to] = worldPoints
      if (!from || !to) throw new MultimodalLabError('INVALID_ACTION', 'Drag requires from and to points')
      const target = this.#requireGestureTarget(from)
      targetIds = [target.id]
      semantic = { ...base, type: 'move', objectId: target.id, x: target.transform.x + to.x - from.x, y: target.transform.y + to.y - from.y }
    } else if (action.gesture.kind === 'resize') {
      const [from, to] = worldPoints
      if (!from || !to) throw new MultimodalLabError('INVALID_ACTION', 'Resize requires from and to points')
      const target = this.#requireGestureTarget(from)
      const tolerance = Math.max(12 / frame.observation.viewport.zoom, Math.min(target.transform.width, target.transform.height) * 0.3)
      const nearHandle = from.x >= target.transform.x + target.transform.width - tolerance
        && from.y >= target.transform.y + target.transform.height - tolerance
      if (!nearHandle) throw new MultimodalLabError('NO_GESTURE_TARGET', 'Resize must begin on the target bottom-right handle region')
      targetIds = [target.id]
      semantic = {
        ...base,
        type: 'resize',
        objectId: target.id,
        width: Math.max(1, target.transform.width + to.x - from.x),
        height: Math.max(1, target.transform.height + to.y - from.y),
      }
    } else if (action.gesture.kind === 'delete') {
      const at = worldPoints[0]
      if (!at) throw new MultimodalLabError('INVALID_ACTION', 'Delete requires a target point')
      const target = this.#requireGestureTarget(at)
      targetIds = [target.id]
      semantic = { ...base, type: 'delete', objectId: target.id }
    } else if (action.gesture.kind === 'restyle') {
      const at = worldPoints[0]
      if (!at) throw new MultimodalLabError('INVALID_ACTION', 'Restyle requires a target point')
      const target = this.#requireGestureTarget(at)
      targetIds = [target.id]
      semantic = { ...base, type: 'restyle', objectId: target.id, style: structuredClone(action.gesture.style) }
    } else if (action.gesture.kind === 'type_text') {
      const at = worldPoints[0]
      if (!at) throw new MultimodalLabError('INVALID_ACTION', 'Text gesture requires a target point')
      const target = this.#hitTest(at)
      if (target && (target.type === 'text' || target.type === 'agent_note')) {
        targetIds = [target.id]
        semantic = { ...base, type: 'set_text', objectId: target.id, text: action.gesture.text }
      } else {
        requiresHitTest = false
        semantic = {
          ...base,
          type: 'create',
          object: {
            type: 'text',
            transform: { x: at.x, y: at.y, width: 280, height: 64 },
            style: { fill: '#172033', stroke: 'none', fontSize: 28 },
            content: { text: action.gesture.text },
            metadata: { createdFromGesture: true },
          },
        }
      }
    } else if (action.gesture.kind === 'draw_path') {
      if (worldPoints.length < 2) throw new MultimodalLabError('INVALID_ACTION', 'Draw path requires at least two points')
      requiresHitTest = false
      const xs = worldPoints.map(point => point.x)
      const ys = worldPoints.map(point => point.y)
      const minX = Math.min(...xs)
      const minY = Math.min(...ys)
      const maxX = Math.max(...xs)
      const maxY = Math.max(...ys)
      const pathData = worldPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
      semantic = {
        ...base,
        type: 'create',
        object: {
          type: 'freehand',
          transform: { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) },
          style: { fill: 'none', stroke: '#172033', strokeWidth: 4, ...action.gesture.style },
          content: { pathData },
          metadata: { createdFromGesture: true },
        },
      }
    } else if (action.gesture.kind === 'pan') {
      requiresHitTest = false
      const [from, to] = worldPoints
      if (!from || !to) throw new MultimodalLabError('INVALID_ACTION', 'Pan requires from and to points')
      const current = frame.observation.viewport
      viewport = { ...current, x: current.x - (to.x - from.x), y: current.y - (to.y - from.y) }
      if (viewport.x === current.x && viewport.y === current.y) throw new MultimodalLabError('INVALID_ACTION', 'Pan gesture must move the viewport')
    } else {
      requiresHitTest = false
      const at = worldPoints[0]
      if (!at) throw new MultimodalLabError('INVALID_ACTION', 'Zoom requires an anchor point')
      const factor = finite(action.gesture.factor, 'gesture.factor')
      if (factor <= 0 || factor === 1) throw new MultimodalLabError('INVALID_ACTION', 'Zoom factor must be positive and different from 1')
      const current = frame.observation.viewport
      const nextZoom = Math.min(8, Math.max(0.1, current.zoom * factor))
      const framePoint = this.#resolveGesturePoint(action.gesture.at, action.coordinateSpace, frame).frame
      viewport = {
        ...current,
        zoom: nextZoom,
        x: at.x - framePoint.x / nextZoom,
        y: at.y - framePoint.y / nextZoom,
      }
      if (nextZoom === current.zoom) throw new MultimodalLabError('INVALID_ACTION', 'Zoom gesture is clamped to the current zoom')
    }

    return {
      ...(semantic ? { transaction: this.#transactionFor(semantic) } : {}),
      ...(viewport ? { viewport } : {}),
      evidence: {
        kind: action.gesture.kind,
        coordinateSpace: action.coordinateSpace,
        framePoints: structuredClone(framePoints),
        worldPoints,
        hitTestVerified: !requiresHitTest || targetIds.length > 0,
        resolvedObjectCount: targetIds.length,
      },
    }
  }

  #gesturePoints(gesture: PixelGesture): GesturePoint[] {
    if (gesture.kind === 'drag' || gesture.kind === 'resize' || gesture.kind === 'pan') return [gesture.from, gesture.to]
    if (gesture.kind === 'draw_path') return gesture.points
    return [gesture.at]
  }

  #resolveGesturePoint(point: GesturePoint, space: GestureCoordinateSpace, frame: LabFrame): { frame: GesturePoint; world: GesturePoint } {
    const x = finite(point.x, 'gesture.x')
    const y = finite(point.y, 'gesture.y')
    const framePoint = space === 'normalized_frame'
      ? { x: x * frame.observation.width, y: y * frame.observation.height }
      : { x, y }
    if (space === 'normalized_frame' && (x < 0 || x > 1 || y < 0 || y > 1)) {
      throw new MultimodalLabError('INVALID_ACTION', 'Normalized gesture coordinates must stay within [0, 1]')
    }
    if (framePoint.x < 0 || framePoint.x > frame.observation.width || framePoint.y < 0 || framePoint.y > frame.observation.height) {
      throw new MultimodalLabError('INVALID_ACTION', 'Gesture coordinates must stay inside the observed frame')
    }
    const viewport = frame.observation.viewport
    return {
      frame: framePoint,
      world: { x: viewport.x + framePoint.x / viewport.zoom, y: viewport.y + framePoint.y / viewport.zoom },
    }
  }

  #requireGestureTarget(point: GesturePoint): CanvasObject {
    const target = this.#hitTest(point)
    if (!target) throw new MultimodalLabError('NO_GESTURE_TARGET', `No visible object exists at (${point.x}, ${point.y})`)
    return target
  }

  #hitTest(point: GesturePoint): CanvasObject | undefined {
    const objects = this.#store.listObjects(this.#canvasId)
      .filter(object => (object.style.opacity ?? 1) > 0)
      .sort((a, b) => b.transform.zIndex - a.transform.zIndex || b.id.localeCompare(a.id))
    return objects.find(object => {
      const { x, y, width, height } = object.transform
      if (point.x < x || point.x > x + width || point.y < y || point.y > y + height) return false
      if (object.type !== 'ellipse') return true
      if (width <= 0 || height <= 0) return false
      const normalizedX = (point.x - (x + width / 2)) / (width / 2)
      const normalizedY = (point.y - (y + height / 2)) / (height / 2)
      return normalizedX * normalizedX + normalizedY * normalizedY <= 1
    })
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
    if (next.x === current.x && next.y === current.y && next.width === current.width && next.height === current.height && next.zoom === current.zoom) {
      throw new MultimodalLabError('INVALID_ACTION', 'Viewport action must change the current visual surface')
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
    gesture?: GestureEvidence
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
      ...(input.gesture ? { gesture: structuredClone(input.gesture) } : {}),
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

  #validateCrop(crop: RasterCrop, observation: LabObservation): RasterCrop {
    const normalized = {
      x: Math.round(finite(crop.x, 'crop.x')),
      y: Math.round(finite(crop.y, 'crop.y')),
      width: Math.round(finite(crop.width, 'crop.width')),
      height: Math.round(finite(crop.height, 'crop.height')),
    }
    if (normalized.x < 0 || normalized.y < 0 || normalized.width <= 0 || normalized.height <= 0) {
      throw new MultimodalLabError('INVALID_ACTION', 'Raster crop must have a non-negative origin and positive size')
    }
    if (normalized.x + normalized.width > observation.width || normalized.y + normalized.height > observation.height) {
      throw new MultimodalLabError('INVALID_ACTION', 'Raster crop must stay inside the immutable source frame')
    }
    return normalized
  }

  #croppedSvg(frame: LabFrame, crop: RasterCrop): string {
    const viewport = frame.observation.viewport
    const worldX = viewport.x + crop.x / viewport.zoom
    const worldY = viewport.y + crop.y / viewport.zoom
    const worldWidth = crop.width / viewport.zoom
    const worldHeight = crop.height / viewport.zoom
    return frame.svg.replace(
      /<svg\b[^>]*>/,
      `<svg xmlns="http://www.w3.org/2000/svg" width="${crop.width}" height="${crop.height}" viewBox="${worldX} ${worldY} ${worldWidth} ${worldHeight}">`,
    )
  }

  #perceptualSignature(pixels: Uint8Array, width: number, height: number): RasterPerceptualSignature {
    const gridWidth = Math.min(32, width)
    const gridHeight = Math.min(32, height)
    const samples = new Uint8Array(gridWidth * gridHeight * 3)
    for (let gridY = 0; gridY < gridHeight; gridY += 1) {
      const sourceY = Math.min(height - 1, Math.floor((gridY + 0.5) * height / gridHeight))
      for (let gridX = 0; gridX < gridWidth; gridX += 1) {
        const sourceX = Math.min(width - 1, Math.floor((gridX + 0.5) * width / gridWidth))
        const source = (sourceY * width + sourceX) * 4
        const target = (gridY * gridWidth + gridX) * 3
        samples[target] = pixels[source] ?? 0
        samples[target + 1] = pixels[source + 1] ?? 0
        samples[target + 2] = pixels[source + 2] ?? 0
      }
    }
    return { width: gridWidth, height: gridHeight, channels: 3, samples }
  }

  #pruneFrames(nowMs: number): void {
    if (this.#frames.size > 200) {
      const frames = [...this.#frames.entries()].sort((a, b) => Date.parse(a[1].observation.observedAt) - Date.parse(b[1].observation.observedAt))
      for (const [frameId, frame] of frames) {
        if (this.#frames.size <= 120) break
        if (nowMs - Date.parse(frame.observation.observedAt) > this.#leaseTtlMs) this.#frames.delete(frameId)
      }
      for (const [frameId] of frames) {
        if (this.#frames.size <= 160) break
        this.#frames.delete(frameId)
      }
    }
    if (this.#rasters.size > 240) {
      const retainedFrameIds = new Set(this.#frames.keys())
      for (const [rasterId, raster] of this.#rasters) {
        if (this.#rasters.size <= 160) break
        if (!retainedFrameIds.has(raster.observation.frameId)) this.#rasters.delete(rasterId)
      }
      for (const rasterId of this.#rasters.keys()) {
        if (this.#rasters.size <= 160) break
        this.#rasters.delete(rasterId)
      }
    }
  }
}

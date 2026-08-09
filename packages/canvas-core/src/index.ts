import { createHash, randomUUID } from 'node:crypto'
import {
  type CanvasDocument,
  type CanvasEvent,
  type CanvasObject,
  type CanvasOperation,
  type CanvasTransaction,
  type TransactionPrecondition,
  type TransactionResult,
  type Workspace,
  validateCanvasObject,
  validateCanvasTransaction,
} from '../../canvas-schema/src/index.js'

export class CanvasCoreError extends Error {
  constructor(
    readonly code: 'NOT_FOUND' | 'ALREADY_EXISTS' | 'REVISION_CONFLICT' | 'PRECONDITION_FAILED' | 'INVALID_OPERATION',
    message: string,
  ) {
    super(message)
    this.name = 'CanvasCoreError'
  }
}

export interface EventSink {
  append(event: CanvasEvent): void
}

export interface CanvasState {
  workspace: Workspace
  canvases: Map<string, CanvasDocument>
  objects: Map<string, CanvasObject>
  appliedIdempotencyKeys: Set<string>
}

export interface SerializedCanvasState {
  workspace: Workspace
  canvases: CanvasDocument[]
  objects: CanvasObject[]
  appliedIdempotencyKeys: string[]
}

export function serializeCanvasState(state: CanvasState): SerializedCanvasState {
  return {
    workspace: structuredClone(state.workspace),
    canvases: [...state.canvases.values()].sort((a, b) => a.id.localeCompare(b.id)).map(item => structuredClone(item)),
    objects: [...state.objects.values()].sort((a, b) => a.id.localeCompare(b.id)).map(item => structuredClone(item)),
    appliedIdempotencyKeys: [...state.appliedIdempotencyKeys].sort(),
  }
}

export function deserializeCanvasState(value: SerializedCanvasState): CanvasState {
  if (!value || typeof value !== 'object') throw new CanvasCoreError('INVALID_OPERATION', 'Serialized canvas state is invalid')
  if (!Array.isArray(value.canvases) || !Array.isArray(value.objects) || !Array.isArray(value.appliedIdempotencyKeys)) {
    throw new CanvasCoreError('INVALID_OPERATION', 'Serialized canvas state collections are invalid')
  }
  const canvases = new Map(value.canvases.map(item => [item.id, structuredClone(item)]))
  const objects = new Map(value.objects.map(item => [item.id, structuredClone(item)]))
  if (!canvases.has(value.workspace.rootCanvasId)) throw new CanvasCoreError('INVALID_OPERATION', 'Serialized state is missing its root canvas')
  for (const object of objects.values()) validateCanvasObject(object)
  return { workspace: structuredClone(value.workspace), canvases, objects, appliedIdempotencyKeys: new Set(value.appliedIdempotencyKeys) }
}

export interface CanvasStoreOptions {
  eventSink?: EventSink
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function stateHash(state: CanvasState): string {
  const payload = {
    workspace: state.workspace,
    canvases: [...state.canvases.values()].sort((a, b) => a.id.localeCompare(b.id)),
    objects: [...state.objects.values()].sort((a, b) => a.id.localeCompare(b.id)),
  }
  return createHash('sha256').update(JSON.stringify(canonicalize(payload))).digest('hex')
}

function cloneState(state: CanvasState): CanvasState {
  return {
    workspace: structuredClone(state.workspace),
    canvases: new Map([...state.canvases].map(([id, value]) => [id, structuredClone(value)])),
    objects: new Map([...state.objects].map(([id, value]) => [id, structuredClone(value)])),
    appliedIdempotencyKeys: new Set(state.appliedIdempotencyKeys),
  }
}

function collectObjectIds(operations: CanvasOperation[]): string[] {
  const ids = operations.flatMap((operation) => {
    if (operation.op === 'create_object' || operation.op === 'create_subcanvas') return [operation.object.id]
    return [operation.objectId]
  })
  return [...new Set(ids)]
}

export class CanvasStore {
  #state: CanvasState
  readonly #eventSink?: EventSink

  constructor(workspace: Workspace, rootCanvas: CanvasDocument, options: CanvasStoreOptions = {}, initialState?: CanvasState) {
    if (workspace.rootCanvasId !== rootCanvas.id) {
      throw new CanvasCoreError('INVALID_OPERATION', 'workspace.rootCanvasId must match root canvas')
    }
    this.#state = initialState ? cloneState(initialState) : {
      workspace: structuredClone(workspace),
      canvases: new Map([[rootCanvas.id, structuredClone(rootCanvas)]]),
      objects: new Map(),
      appliedIdempotencyKeys: new Set(),
    }
    this.#eventSink = options.eventSink
  }

  get workspace(): Workspace {
    return structuredClone(this.#state.workspace)
  }

  getCanvas(canvasId: string): CanvasDocument {
    const canvas = this.#state.canvases.get(canvasId)
    if (!canvas) throw new CanvasCoreError('NOT_FOUND', `Canvas ${canvasId} not found`)
    return structuredClone(canvas)
  }

  getObject(objectId: string): CanvasObject {
    const object = this.#state.objects.get(objectId)
    if (!object) throw new CanvasCoreError('NOT_FOUND', `Object ${objectId} not found`)
    return structuredClone(object)
  }

  listObjects(canvasId: string): CanvasObject[] {
    this.getCanvas(canvasId)
    return [...this.#state.objects.values()]
      .filter((object) => object.canvasId === canvasId)
      .sort((a, b) => a.transform.zIndex - b.transform.zIndex || a.id.localeCompare(b.id))
      .map((object) => structuredClone(object))
  }

  snapshot(): CanvasState {
    return cloneState(this.#state)
  }

  serialize(): SerializedCanvasState {
    return serializeCanvasState(this.#state)
  }

  restore(snapshot: CanvasState): void {
    if (snapshot.workspace.rootCanvasId !== this.#state.workspace.rootCanvasId) {
      throw new CanvasCoreError('INVALID_OPERATION', 'Snapshot belongs to another workspace')
    }
    if (!snapshot.canvases.has(snapshot.workspace.rootCanvasId)) {
      throw new CanvasCoreError('INVALID_OPERATION', 'Snapshot is missing its root canvas')
    }
    this.#state = cloneState(snapshot)
  }

  applyTransaction(transaction: CanvasTransaction): TransactionResult {
    validateCanvasTransaction(transaction)
    const currentCanvas = this.#state.canvases.get(transaction.canvasId)
    if (!currentCanvas) throw new CanvasCoreError('NOT_FOUND', `Canvas ${transaction.canvasId} not found`)

    if (transaction.idempotencyKey && this.#state.appliedIdempotencyKeys.has(transaction.idempotencyKey)) {
      return {
        ok: true,
        transactionId: transaction.id,
        canvasId: transaction.canvasId,
        revision: currentCanvas.revision,
        affectedObjectIds: collectObjectIds(transaction.operations),
        beforeHash: stateHash(this.#state),
        afterHash: stateHash(this.#state),
      }
    }

    this.#assertPreconditions(transaction.preconditions)
    const draft = cloneState(this.#state)
    const beforeHash = stateHash(this.#state)
    const affectedObjectIds = collectObjectIds(transaction.operations)

    for (const operation of transaction.operations) this.#applyOperation(draft, operation, transaction.canvasId)

    const draftCanvas = draft.canvases.get(transaction.canvasId)
    if (!draftCanvas) throw new CanvasCoreError('NOT_FOUND', 'Draft canvas disappeared unexpectedly')
    draftCanvas.revision += 1
    draftCanvas.updatedAt = new Date().toISOString()
    draft.workspace.updatedAt = draftCanvas.updatedAt
    if (transaction.idempotencyKey) draft.appliedIdempotencyKeys.add(transaction.idempotencyKey)

    const afterHash = stateHash(draft)
    const event: CanvasEvent = {
      eventId: randomUUID(),
      workspaceId: draft.workspace.id,
      canvasId: transaction.canvasId,
      transactionId: transaction.id,
      actor: structuredClone(transaction.actor),
      eventType: 'transaction_committed',
      objectIds: affectedObjectIds,
      intent: transaction.intent,
      payload: {
        operationCount: transaction.operations.length,
        mode: transaction.mode,
        expectedOutcome: transaction.expectedOutcome ?? null,
      },
      beforeHash,
      afterHash,
      createdAt: new Date().toISOString(),
    }

    this.#eventSink?.append(event)
    this.#state = draft

    return {
      ok: true,
      transactionId: transaction.id,
      canvasId: transaction.canvasId,
      revision: draftCanvas.revision,
      affectedObjectIds,
      beforeHash,
      afterHash,
    }
  }

  #assertPreconditions(preconditions: TransactionPrecondition[]): void {
    for (const precondition of preconditions) {
      if (precondition.type === 'canvas_revision') {
        const canvas = this.#state.canvases.get(precondition.targetId)
        if (!canvas || canvas.revision !== precondition.expected) {
          throw new CanvasCoreError('PRECONDITION_FAILED', `Canvas revision precondition failed for ${precondition.targetId}`)
        }
      } else if (precondition.type === 'object_exists') {
        const exists = this.#state.objects.has(precondition.targetId)
        if (exists !== precondition.expected) {
          throw new CanvasCoreError('PRECONDITION_FAILED', `Object existence precondition failed for ${precondition.targetId}`)
        }
      } else if (precondition.type === 'object_revision') {
        const object = this.#state.objects.get(precondition.targetId)
        if (!object || object.revision !== precondition.expected) {
          throw new CanvasCoreError('PRECONDITION_FAILED', `Object revision precondition failed for ${precondition.targetId}`)
        }
      }
    }
  }

  #applyOperation(draft: CanvasState, operation: CanvasOperation, transactionCanvasId: string): void {
    if (operation.op === 'create_object') {
      validateCanvasObject(operation.object)
      if (operation.object.canvasId !== transactionCanvasId) {
        throw new CanvasCoreError('INVALID_OPERATION', 'Created object canvasId must match transaction canvas')
      }
      if (draft.objects.has(operation.object.id)) {
        throw new CanvasCoreError('ALREADY_EXISTS', `Object ${operation.object.id} already exists`)
      }
      const canvas = draft.canvases.get(transactionCanvasId)
      if (!canvas) throw new CanvasCoreError('NOT_FOUND', `Canvas ${transactionCanvasId} not found`)
      draft.objects.set(operation.object.id, structuredClone(operation.object))
      canvas.objectIds.push(operation.object.id)
      return
    }

    if (operation.op === 'create_subcanvas') {
      validateCanvasObject(operation.object)
      if (operation.object.type !== 'subcanvas') {
        throw new CanvasCoreError('INVALID_OPERATION', 'create_subcanvas requires a subcanvas object')
      }
      if (draft.objects.has(operation.object.id) || draft.canvases.has(operation.canvas.id)) {
        throw new CanvasCoreError('ALREADY_EXISTS', 'Subcanvas object or canvas already exists')
      }
      if (operation.canvas.parentCanvasId !== transactionCanvasId || operation.canvas.parentObjectId !== operation.object.id) {
        throw new CanvasCoreError('INVALID_OPERATION', 'Subcanvas parent linkage is invalid')
      }
      const parent = draft.canvases.get(transactionCanvasId)
      if (!parent) throw new CanvasCoreError('NOT_FOUND', `Canvas ${transactionCanvasId} not found`)
      draft.objects.set(operation.object.id, structuredClone(operation.object))
      draft.canvases.set(operation.canvas.id, structuredClone(operation.canvas))
      parent.objectIds.push(operation.object.id)
      return
    }

    const object = draft.objects.get(operation.objectId)
    if (!object) throw new CanvasCoreError('NOT_FOUND', `Object ${operation.objectId} not found`)
    if (object.canvasId !== transactionCanvasId) {
      throw new CanvasCoreError('INVALID_OPERATION', 'Operation target belongs to another canvas')
    }
    if (object.revision !== operation.expectedRevision) {
      throw new CanvasCoreError(
        'REVISION_CONFLICT',
        `Object ${object.id} revision ${object.revision} does not match expected ${operation.expectedRevision}`,
      )
    }

    if (operation.op === 'delete_object') {
      draft.objects.delete(object.id)
      const canvas = draft.canvases.get(transactionCanvasId)
      if (canvas) canvas.objectIds = canvas.objectIds.filter((id) => id !== object.id)
      return
    }

    if (operation.op === 'reorder_object') {
      object.transform.zIndex = operation.zIndex
      object.revision += 1
      object.updatedAt = new Date().toISOString()
      return
    }

    object.transform = { ...object.transform, ...operation.patch.transform }
    object.style = { ...object.style, ...operation.patch.style }
    object.content = { ...object.content, ...operation.patch.content }
    object.metadata = { ...object.metadata, ...operation.patch.metadata }
    object.revision += 1
    object.updatedAt = new Date().toISOString()
    validateCanvasObject(object)
  }
}

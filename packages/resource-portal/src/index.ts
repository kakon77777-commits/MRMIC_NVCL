import {
  resourcePortalDescriptor,
  validateCanvasObject,
  type ActorRef,
  type CanvasObject,
  type ResourceKind,
  type ResourcePortalDescriptor,
  type ResourcePortalDisplayMode,
  type ResourcePortalInteractionMode,
  type ResourceProvider,
  type Transform2D,
} from '../../canvas-schema/src/index.js'

export interface CompatFrameV0 {
  schema: 'compat_frame_v0'
  canvasObjectId: string
  canvasId: string
  portalId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  provider: ResourceProvider
  resourceKind: ResourceKind
  providerResourceId: string
  displayMode?: ResourcePortalDisplayMode
  interactionMode?: ResourcePortalInteractionMode
  ownerSemanticAgentId?: string
  title?: string
  previewUri?: string
  transform: Transform2D
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

export function migrateCompatFrameV0(value: unknown, actor: ActorRef, createdAt: string): CanvasObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('compat frame must be an object')
  const input = value as Record<string, unknown>
  if (input.schema !== 'compat_frame_v0') throw new Error('schema must be compat_frame_v0')
  for (const key of ['principalId', 'semanticAgentId', 'actorId', 'authToken']) {
    if (input[key] !== undefined) throw new Error('identity fields are not allowed in compat migration')
  }
  const descriptor: ResourcePortalDescriptor = {
    portalId: required(input.portalId, 'portalId'),
    pmwWorkspaceId: required(input.pmwWorkspaceId, 'pmwWorkspaceId'),
    ...(typeof input.pmwTaskId === 'string' && input.pmwTaskId.trim() ? { pmwTaskId: input.pmwTaskId.trim() } : {}),
    provider: required(input.provider, 'provider') as ResourceProvider,
    resourceKind: required(input.resourceKind, 'resourceKind') as ResourceKind,
    providerResourceId: required(input.providerResourceId, 'providerResourceId'),
    displayMode: (typeof input.displayMode === 'string' ? input.displayMode : 'snapshot') as ResourcePortalDisplayMode,
    interactionMode: (typeof input.interactionMode === 'string' ? input.interactionMode : 'inspect') as ResourcePortalInteractionMode,
    ...(typeof input.ownerSemanticAgentId === 'string' && input.ownerSemanticAgentId.trim()
      ? { ownerSemanticAgentId: input.ownerSemanticAgentId.trim() }
      : {}),
  }
  const object: CanvasObject = {
    id: required(input.canvasObjectId, 'canvasObjectId'),
    canvasId: required(input.canvasId, 'canvasId'),
    type: 'resource_portal',
    transform: structuredClone(input.transform) as Transform2D,
    style: {},
    content: {
      ...(typeof input.title === 'string' && input.title.trim() ? { text: input.title.trim() } : {}),
      ...(typeof input.previewUri === 'string' && input.previewUri.trim() ? { previewUri: input.previewUri.trim() } : {}),
    },
    childIds: [],
    bindings: [],
    metadata: { portalSchema: 'native_resource_portal_v1', portal: descriptor },
    createdBy: structuredClone(actor),
    createdAt: required(createdAt, 'createdAt'),
    updatedAt: required(createdAt, 'createdAt'),
    revision: 0,
  }
  validateCanvasObject(object)
  return object
}

export type ResourcePortalLifecycle = 'bound' | 'projected_snapshot' | 'projected_live' | 'suspended' | 'closed'

export interface ResourcePortalProjection {
  canvasObjectId: string
  descriptor: ResourcePortalDescriptor
  lifecycle: ResourcePortalLifecycle
  previewUri?: string
  liveHandle?: string
  updatedAt: string
}

function cloneProjection(value: ResourcePortalProjection): ResourcePortalProjection {
  return structuredClone(value)
}

export class ResourcePortalProjectionRegistry {
  readonly #byObjectId = new Map<string, ResourcePortalProjection>()

  upsertFromCanvasObject(object: CanvasObject, lifecycle: ResourcePortalLifecycle = 'projected_snapshot'): ResourcePortalProjection {
    const descriptor = resourcePortalDescriptor(object)
    const current = this.#byObjectId.get(object.id)
    const projection: ResourcePortalProjection = {
      canvasObjectId: object.id,
      descriptor,
      lifecycle,
      ...(object.content?.previewUri ? { previewUri: object.content.previewUri } : current?.previewUri ? { previewUri: current.previewUri } : {}),
      ...(current?.liveHandle ? { liveHandle: current.liveHandle } : {}),
      updatedAt: new Date().toISOString(),
    }
    this.#byObjectId.set(object.id, projection)
    return cloneProjection(projection)
  }

  get(canvasObjectId: string): ResourcePortalProjection | null {
    const value = this.#byObjectId.get(canvasObjectId)
    return value ? cloneProjection(value) : null
  }

  list(): ResourcePortalProjection[] {
    return [...this.#byObjectId.values()].map(cloneProjection)
  }

  setLifecycle(canvasObjectId: string, lifecycle: ResourcePortalLifecycle, options: { previewUri?: string; liveHandle?: string | null } = {}): ResourcePortalProjection {
    const current = this.#byObjectId.get(canvasObjectId)
    if (!current) throw new Error(`Resource portal projection ${canvasObjectId} not found`)
    const next: ResourcePortalProjection = {
      ...current,
      lifecycle,
      ...(options.previewUri !== undefined ? { previewUri: options.previewUri } : {}),
      ...(options.liveHandle === null ? { liveHandle: undefined } : options.liveHandle !== undefined ? { liveHandle: options.liveHandle } : {}),
      updatedAt: new Date().toISOString(),
    }
    this.#byObjectId.set(canvasObjectId, next)
    return cloneProjection(next)
  }

  remove(canvasObjectId: string): boolean {
    return this.#byObjectId.delete(canvasObjectId)
  }
}

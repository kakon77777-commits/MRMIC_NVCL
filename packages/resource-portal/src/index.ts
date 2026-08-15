import { resourcePortalDescriptor, type CanvasObject, type ResourcePortalDescriptor } from '../../canvas-schema/src/index.js'

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

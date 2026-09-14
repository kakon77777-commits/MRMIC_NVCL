import { resourcePortalDescriptor, type CanvasObject } from '../../canvas-schema/src/index.js'
import {
  livePortalVisualFrameDataUri,
  type LivePortalHandle,
  type LivePortalVisualFrame,
} from './index.js'
import { LivePortalHostRegistry } from './runtime.js'

/**
 * Pull a provider-owned visual frame through the existing LivePortalHost
 * registry. The Canvas object supplies identity only; no frame bytes are ever
 * written back to canonical Canvas state here.
 */
export async function snapshotPortalVisualFrame(
  object: CanvasObject,
  hosts: LivePortalHostRegistry,
): Promise<LivePortalVisualFrame | null> {
  if (object.type !== 'resource_portal') throw new Error('visual projection requires a resource_portal object')
  const descriptor = resourcePortalDescriptor(object)
  const host = hosts.get(descriptor.provider)
  if (!host) throw new Error(`No live portal host registered for provider ${descriptor.provider}`)
  if (!host.snapshot) return null
  const handle: LivePortalHandle = {
    portalObjectId: object.id,
    provider: descriptor.provider,
    providerResourceId: descriptor.providerResourceId,
  }
  const frame = await host.snapshot(handle)
  if (!frame) return null
  if (
    frame.portalObjectId !== object.id
    || frame.provider !== descriptor.provider
    || frame.providerResourceId !== descriptor.providerResourceId
  ) throw new Error('live portal visual frame identity mismatch')
  livePortalVisualFrameDataUri(frame)
  return structuredClone(frame)
}

/**
 * Produce an ephemeral render copy of a resource portal. The canonical object
 * is never mutated; only the returned copy receives the data URI preview.
 */
export function projectPortalVisualFrame(
  object: CanvasObject,
  frame: LivePortalVisualFrame,
): CanvasObject {
  if (object.type !== 'resource_portal') throw new Error('visual projection requires a resource_portal object')
  const descriptor = resourcePortalDescriptor(object)
  if (
    frame.portalObjectId !== object.id
    || frame.provider !== descriptor.provider
    || frame.providerResourceId !== descriptor.providerResourceId
  ) throw new Error('live portal visual frame identity mismatch')
  const projected = structuredClone(object)
  projected.content = {
    ...(projected.content ?? {}),
    previewUri: livePortalVisualFrameDataUri(frame),
  }
  return projected
}

export function stripPortalVisualPreview(object: CanvasObject): CanvasObject {
  const projected = structuredClone(object)
  if (projected.type !== 'resource_portal' || !projected.content) return projected
  const { previewUri: _previewUri, ...content } = projected.content
  projected.content = content
  return projected
}

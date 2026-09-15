import type { CanvasObject } from '../../canvas-schema/src/index.js'
import { resourcePortalDescriptor } from '../../canvas-schema/src/index.js'
import type { LivePortalHostRegistry } from '../../portal-overlay/src/runtime.js'
import {
  projectPortalVisualFrame,
  snapshotPortalVisualFrame,
  stripPortalVisualPreview,
} from '../../portal-overlay/src/visual.js'
import type { ObserverSnapshot } from './index.js'
import {
  observerAllowsPortalVisual,
  type ObserverPortalVisualTarget,
} from './projection.js'

export interface ObserverPortalVisualProjectionResult {
  allowed: boolean
  portalId: string
  object: CanvasObject
  frameSequence?: number
  capturedAt?: string
}

/**
 * Reference observer-gated visual projection path.
 *
 * Authorization is checked before provider snapshot I/O. A denied observer gets
 * an explicit no-pixels render copy and the LivePortalHost is never asked for a
 * frame. An allowed observer receives only an ephemeral render clone.
 */
export async function projectPortalForObserver(
  object: CanvasObject,
  hosts: LivePortalHostRegistry,
  observerSnapshot: ObserverSnapshot,
  target: ObserverPortalVisualTarget,
): Promise<ObserverPortalVisualProjectionResult> {
  if (object.type !== 'resource_portal') throw new Error('observer visual projection requires a resource_portal object')
  const descriptor = resourcePortalDescriptor(object)
  const portalId = descriptor.portalId
  if (!observerAllowsPortalVisual(observerSnapshot, target, portalId)) {
    return {
      allowed: false,
      portalId,
      object: stripPortalVisualPreview(object),
    }
  }

  const frame = await snapshotPortalVisualFrame(object, hosts)
  if (!frame) {
    return {
      allowed: true,
      portalId,
      object: stripPortalVisualPreview(object),
    }
  }
  return {
    allowed: true,
    portalId,
    object: projectPortalVisualFrame(object, frame),
    frameSequence: frame.frameSequence,
    capturedAt: frame.capturedAt,
  }
}

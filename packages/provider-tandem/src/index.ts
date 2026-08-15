import type {
  ActorRef,
  CanvasObject,
  ResourcePortalDisplayMode,
  ResourcePortalInteractionMode,
  Transform2D,
} from '../../canvas-schema/src/index.js'
import { validateCanvasObject } from '../../canvas-schema/src/index.js'

export interface TandemBrowserResourceDescriptor {
  provider: 'tandem'
  resourceKind: 'browser_tab'
  providerResourceId: string
  resourceUri: string
  title: string
  url: string
  workspaceId: string | null
  webContentsId: number
  partition: string
  source: string
  state: {
    mounted: boolean
    loading: boolean
    focused: boolean
    visible: boolean
    legacyFocusVisibilityCoupled: boolean
  }
  projection: {
    preferredDisplayMode: 'snapshot' | 'live'
    previewUri: string
    liveMountUri: string
    liveMountKind: 'electron-webview'
  }
  capabilities: string[]
}

export interface TandemPortalProjectionInput {
  resource: TandemBrowserResourceDescriptor
  portalId: string
  canvasObjectId?: string
  canvasId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  ownerSemanticAgentId?: string
  actor: ActorRef
  transform?: Partial<Transform2D>
  displayMode?: ResourcePortalDisplayMode
  interactionMode?: ResourcePortalInteractionMode
  createdAt?: string
}

function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function assertTandemResource(resource: TandemBrowserResourceDescriptor): void {
  if (resource.provider !== 'tandem') throw new Error('Tandem portal resource provider must be tandem')
  if (resource.resourceKind !== 'browser_tab') throw new Error('Tandem portal resourceKind must be browser_tab')
  const id = required(resource.providerResourceId, 'providerResourceId')
  const expectedUri = `tandem://browser/tab/${encodeURIComponent(id)}`
  if (resource.resourceUri !== expectedUri) throw new Error(`resourceUri must equal ${expectedUri}`)
  if (resource.projection.previewUri !== `${expectedUri}/preview.png`) throw new Error('previewUri does not match provider resource identity')
  if (resource.projection.liveMountUri !== `${expectedUri}/live`) throw new Error('liveMountUri does not match provider resource identity')
  if (resource.projection.liveMountKind !== 'electron-webview') throw new Error('unsupported Tandem live mount kind')
  if (!Number.isInteger(resource.webContentsId) || resource.webContentsId <= 0) throw new Error('webContentsId must be a positive integer')
}

/**
 * Convert a Tandem browser resource descriptor into an MRMIC-native
 * resource_portal projection. The Canvas stores geometry and stable provider
 * references only; dynamic browser state (URL, loading state, DOM, session)
 * remains canonical in Tandem and is intentionally not copied into metadata.
 */
export function createTandemBrowserPortal(input: TandemPortalProjectionInput): CanvasObject {
  assertTandemResource(input.resource)
  const portalId = required(input.portalId, 'portalId')
  const canvasId = required(input.canvasId, 'canvasId')
  const pmwWorkspaceId = required(input.pmwWorkspaceId, 'pmwWorkspaceId')
  const timestamp = input.createdAt ?? new Date().toISOString()
  const resource = input.resource
  const transform: Transform2D = {
    x: input.transform?.x ?? 0,
    y: input.transform?.y ?? 0,
    width: input.transform?.width ?? 960,
    height: input.transform?.height ?? 640,
    rotation: input.transform?.rotation ?? 0,
    scaleX: input.transform?.scaleX ?? 1,
    scaleY: input.transform?.scaleY ?? 1,
    zIndex: input.transform?.zIndex ?? 1,
  }

  const object: CanvasObject = {
    id: input.canvasObjectId?.trim() || `portal:${portalId}`,
    canvasId,
    type: 'resource_portal',
    transform,
    style: { fill: '#f8fafc', stroke: '#475569', strokeWidth: 2, opacity: 1 },
    content: {
      text: resource.title || `Tandem ${resource.providerResourceId}`,
      resourceUri: resource.resourceUri,
      previewUri: resource.projection.previewUri,
    },
    childIds: [],
    bindings: [],
    metadata: {
      portal: {
        portalId,
        pmwWorkspaceId,
        ...(input.pmwTaskId ? { pmwTaskId: input.pmwTaskId } : {}),
        provider: 'tandem',
        resourceKind: 'browser_tab',
        providerResourceId: resource.providerResourceId,
        displayMode: input.displayMode ?? resource.projection.preferredDisplayMode,
        interactionMode: input.interactionMode ?? 'inspect',
        ...(input.ownerSemanticAgentId ? { ownerSemanticAgentId: input.ownerSemanticAgentId } : {}),
      },
      providerRef: {
        resourceUri: resource.resourceUri,
        workspaceId: resource.workspaceId,
        webContentsId: resource.webContentsId,
        partition: resource.partition,
        liveMountUri: resource.projection.liveMountUri,
        liveMountKind: resource.projection.liveMountKind,
        legacyFocusVisibilityCoupled: resource.state.legacyFocusVisibilityCoupled,
      },
    },
    createdBy: structuredClone(input.actor),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
  validateCanvasObject(object)
  return object
}

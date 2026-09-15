import type {
  ActorRef,
  CanvasObject,
  ResourcePortalDisplayMode,
  ResourcePortalInteractionMode,
  Transform2D,
} from '../../canvas-schema/src/index.js'
import { validateCanvasObject } from '../../canvas-schema/src/index.js'
import type { LivePortalHandle, LivePortalHost, OverlayRect } from '../../portal-overlay/src/index.js'

export const WINDOWS_PROVIDER_ID = 'windows' as const
export const WINDOWS_WINDOW_RESOURCE_SCHEMA = 'windows_window_resource_v1' as const
export const WINDOWS_PROVIDER_CAPABILITIES_SCHEMA = 'windows_provider_capabilities_v1' as const

export type WindowsCaptureApi = 'windows_graphics_capture'
export type WindowsAutomationApi = 'uia'
export type WindowsWindowCloakState = 'none' | 'app' | 'shell' | 'inherited' | 'unknown'

export interface WindowsProviderCapabilities {
  schema: typeof WINDOWS_PROVIDER_CAPABILITIES_SCHEMA
  provider: typeof WINDOWS_PROVIDER_ID
  providerEpoch: string
  platform: 'win32'
  capture: {
    api: WindowsCaptureApi
    supported: boolean
    minimumBuild: 18362
    target: 'hwnd'
  }
  automation: {
    api: WindowsAutomationApi
    supported: boolean
    semanticPatternsPreferred: true
    inputInjectionFallback: boolean
    interactiveDesktopRequiredForInjection: true
  }
}

export interface WindowsNativeWindow {
  hwndHex: string
  processId: number
  threadId: number
  title: string
  className?: string
  visible: boolean
  minimized: boolean
  cloakState: WindowsWindowCloakState
}

export interface WindowsWindowResourceDescriptor {
  schema: typeof WINDOWS_WINDOW_RESOURCE_SCHEMA
  provider: typeof WINDOWS_PROVIDER_ID
  resourceKind: 'desktop_window'
  providerResourceId: string
  resourceUri: string
  providerEpoch: string
  hwndHex: string
  processId: number
  threadId: number
  title: string
  className?: string
  state: {
    visible: boolean
    minimized: boolean
    cloakState: WindowsWindowCloakState
  }
  projection: {
    preferredDisplayMode: 'live' | 'snapshot'
    previewUri: string
    liveMountUri: string
    liveMountKind: 'windows-graphics-capture'
  }
  automation: {
    api: WindowsAutomationApi
    available: boolean
    inputInjectionFallback: boolean
  }
  updatedAt: string
}

export interface WindowsUiElementRef {
  runtimeId: string
  name?: string
  automationId?: string
  controlType?: string
  enabled?: boolean
  offscreen?: boolean
  patterns: string[]
}

export interface WindowsUiSnapshot {
  schema: 'windows_uia_snapshot_v1'
  providerResourceId: string
  capturedAt: string
  root: WindowsUiElementRef
  elements: WindowsUiElementRef[]
}

export type WindowsUiSemanticAction =
  | { kind: 'invoke'; runtimeId: string }
  | { kind: 'toggle'; runtimeId: string }
  | { kind: 'select'; runtimeId: string }
  | { kind: 'set_value'; runtimeId: string; value: string }

export interface WindowsUiActionResult {
  ok: boolean
  providerResourceId: string
  action: WindowsUiSemanticAction
  completedAt: string
  error?: string
}

export interface WindowsCaptureMount {
  mountId: string
  providerResourceId: string
  previewUri?: string
}

/**
 * Native boundary implemented by a Windows-only helper in a later slice.
 * MRMIC owns projection/auth semantics; the helper owns HWND discovery,
 * Windows.Graphics.Capture and UI Automation calls.
 */
export interface WindowsNativeBridge {
  capabilities(): Promise<WindowsProviderCapabilities> | WindowsProviderCapabilities
  enumerateTopLevelWindows(): Promise<WindowsNativeWindow[]>
  mountCapture(resource: WindowsWindowResourceDescriptor, rect: OverlayRect): Promise<WindowsCaptureMount>
  updateCapture(mount: WindowsCaptureMount, rect: OverlayRect): Promise<void>
  unmountCapture(mount: WindowsCaptureMount): Promise<void>
  inspectUi(resource: WindowsWindowResourceDescriptor): Promise<WindowsUiSnapshot>
  performUiAction(resource: WindowsWindowResourceDescriptor, action: WindowsUiSemanticAction): Promise<WindowsUiActionResult>
}

/** Higher-layer authority adapter. The Windows provider never invents control ownership. */
export interface WindowsAccessAuthority {
  canInspect(input: { portalObjectId: string; providerResourceId: string; principalId: string }): boolean
  canControl(input: { portalObjectId: string; providerResourceId: string; principalId: string }): boolean
}

function required(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return normalized
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) <= 0) throw new Error(`${label} must be a positive integer`)
  return Number(value)
}

export function normalizeHwndHex(value: string): string {
  const normalized = required(value, 'hwndHex', 32).toLowerCase()
  if (!/^0x[0-9a-f]+$/.test(normalized)) throw new Error('hwndHex must be a hexadecimal HWND string')
  return normalized
}

/**
 * HWND values are process-local/ephemeral and may be reused. The provider epoch
 * makes the resource identity explicitly non-durable across provider restarts.
 */
export function windowsProviderResourceId(
  providerEpoch: string,
  window: Pick<WindowsNativeWindow, 'hwndHex' | 'processId'>,
): string {
  const epoch = required(providerEpoch, 'providerEpoch', 128)
  const hwndHex = normalizeHwndHex(window.hwndHex)
  const processId = positiveInteger(window.processId, 'processId')
  return `window:${epoch}:${processId}:${hwndHex}`
}

export function windowsWindowResourceUri(providerResourceId: string): string {
  return `windows://window/${encodeURIComponent(required(providerResourceId, 'providerResourceId'))}`
}

function normalizeCloakState(value: WindowsWindowCloakState): WindowsWindowCloakState {
  return ['none', 'app', 'shell', 'inherited', 'unknown'].includes(value) ? value : 'unknown'
}

export function toWindowsWindowResource(
  providerEpoch: string,
  window: WindowsNativeWindow,
  capabilities: WindowsProviderCapabilities,
  now = new Date().toISOString(),
): WindowsWindowResourceDescriptor {
  if (capabilities.provider !== WINDOWS_PROVIDER_ID || capabilities.providerEpoch !== providerEpoch) {
    throw new Error('Windows provider capability epoch mismatch')
  }
  const providerResourceId = windowsProviderResourceId(providerEpoch, window)
  const resourceUri = windowsWindowResourceUri(providerResourceId)
  return {
    schema: WINDOWS_WINDOW_RESOURCE_SCHEMA,
    provider: WINDOWS_PROVIDER_ID,
    resourceKind: 'desktop_window',
    providerResourceId,
    resourceUri,
    providerEpoch,
    hwndHex: normalizeHwndHex(window.hwndHex),
    processId: positiveInteger(window.processId, 'processId'),
    threadId: positiveInteger(window.threadId, 'threadId'),
    title: required(window.title, 'title', 2048),
    ...(window.className?.trim() ? { className: window.className.trim() } : {}),
    state: {
      visible: Boolean(window.visible),
      minimized: Boolean(window.minimized),
      cloakState: normalizeCloakState(window.cloakState),
    },
    projection: {
      preferredDisplayMode: capabilities.capture.supported ? 'live' : 'snapshot',
      previewUri: `${resourceUri}/preview.png`,
      liveMountUri: `${resourceUri}/live`,
      liveMountKind: 'windows-graphics-capture',
    },
    automation: {
      api: 'uia',
      available: capabilities.automation.supported,
      inputInjectionFallback: capabilities.automation.inputInjectionFallback,
    },
    updatedAt: required(now, 'updatedAt', 128),
  }
}

/** Default discovery surface: visible, titled, uncloaked top-level windows only. */
export function discoverableWindows(windows: WindowsNativeWindow[]): WindowsNativeWindow[] {
  return windows.filter(window =>
    window.visible
    && window.cloakState === 'none'
    && window.title.trim().length > 0
    && Number.isInteger(window.processId) && window.processId > 0
    && /^0x[0-9a-f]+$/i.test(window.hwndHex.trim()),
  )
}

export class WindowsProviderCatalog {
  readonly #bridge: WindowsNativeBridge
  #resources = new Map<string, WindowsWindowResourceDescriptor>()
  #capabilities?: WindowsProviderCapabilities

  constructor(bridge: WindowsNativeBridge) {
    this.#bridge = bridge
  }

  async refresh(): Promise<WindowsWindowResourceDescriptor[]> {
    const capabilities = await this.#bridge.capabilities()
    if (capabilities.schema !== WINDOWS_PROVIDER_CAPABILITIES_SCHEMA || capabilities.provider !== WINDOWS_PROVIDER_ID) {
      throw new Error('invalid Windows provider capabilities')
    }
    const windows = discoverableWindows(await this.#bridge.enumerateTopLevelWindows())
    const next = new Map<string, WindowsWindowResourceDescriptor>()
    for (const window of windows) {
      const resource = toWindowsWindowResource(capabilities.providerEpoch, window, capabilities)
      next.set(resource.providerResourceId, resource)
    }
    this.#capabilities = structuredClone(capabilities)
    this.#resources = next
    return this.list()
  }

  capabilities(): WindowsProviderCapabilities | null {
    return this.#capabilities ? structuredClone(this.#capabilities) : null
  }

  get(providerResourceId: string): WindowsWindowResourceDescriptor | null {
    const value = this.#resources.get(providerResourceId)
    return value ? structuredClone(value) : null
  }

  list(): WindowsWindowResourceDescriptor[] {
    return [...this.#resources.values()].map(resource => structuredClone(resource))
  }
}

export interface WindowsPortalProjectionInput {
  resource: WindowsWindowResourceDescriptor
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

/**
 * Project a provider-owned Windows window into Canvas. Dynamic Win32/UIA state
 * remains provider-owned; Canvas stores geometry plus bounded provider identity.
 */
export function createWindowsWindowPortal(input: WindowsPortalProjectionInput): CanvasObject {
  const resource = input.resource
  if (resource.provider !== WINDOWS_PROVIDER_ID || resource.resourceKind !== 'desktop_window') {
    throw new Error('Windows window portal requires a windows/desktop_window resource')
  }
  if (resource.resourceUri !== windowsWindowResourceUri(resource.providerResourceId)) {
    throw new Error('Windows resourceUri identity mismatch')
  }
  const portalId = required(input.portalId, 'portalId')
  const canvasId = required(input.canvasId, 'canvasId')
  const pmwWorkspaceId = required(input.pmwWorkspaceId, 'pmwWorkspaceId')
  const timestamp = input.createdAt ?? new Date().toISOString()
  const transform: Transform2D = {
    x: input.transform?.x ?? 0,
    y: input.transform?.y ?? 0,
    width: input.transform?.width ?? 960,
    height: input.transform?.height ?? 600,
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
    style: {},
    content: {
      text: resource.title,
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
        provider: WINDOWS_PROVIDER_ID,
        resourceKind: 'desktop_window',
        providerResourceId: resource.providerResourceId,
        displayMode: input.displayMode ?? resource.projection.preferredDisplayMode,
        interactionMode: input.interactionMode ?? 'inspect',
        ...(input.ownerSemanticAgentId ? { ownerSemanticAgentId: input.ownerSemanticAgentId } : {}),
      },
      providerRef: {
        schema: WINDOWS_WINDOW_RESOURCE_SCHEMA,
        resourceUri: resource.resourceUri,
        providerEpoch: resource.providerEpoch,
        liveMountUri: resource.projection.liveMountUri,
        liveMountKind: resource.projection.liveMountKind,
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

interface MountedWindowCapture {
  resource: WindowsWindowResourceDescriptor
  mount: WindowsCaptureMount
}

/** Adapter that plugs directly into Phase 13 CanvasLivePortalCoordinator. */
export class WindowsLivePortalHost implements LivePortalHost {
  readonly #bridge: WindowsNativeBridge
  readonly #catalog: WindowsProviderCatalog
  readonly #mounted = new Map<string, MountedWindowCapture>()

  constructor(bridge: WindowsNativeBridge, catalog: WindowsProviderCatalog) {
    this.#bridge = bridge
    this.#catalog = catalog
  }

  async mount(handle: LivePortalHandle, rect: OverlayRect): Promise<void> {
    this.#assertHandle(handle)
    if (!rect.visible) throw new Error('Windows live capture cannot mount an invisible rect')
    const resource = this.#catalog.get(handle.providerResourceId)
    if (!resource) throw new Error(`Windows resource ${handle.providerResourceId} is not present in the current provider epoch`)
    if (this.#mounted.has(handle.portalObjectId)) throw new Error(`Windows portal ${handle.portalObjectId} is already mounted`)
    const mount = await this.#bridge.mountCapture(resource, rect)
    if (mount.providerResourceId !== resource.providerResourceId) {
      throw new Error('Windows capture mount resource identity mismatch')
    }
    this.#mounted.set(handle.portalObjectId, { resource, mount: structuredClone(mount) })
  }

  async update(handle: LivePortalHandle, rect: OverlayRect): Promise<void> {
    this.#assertHandle(handle)
    const mounted = this.#mounted.get(handle.portalObjectId)
    if (!mounted) throw new Error(`Windows portal ${handle.portalObjectId} is not mounted`)
    if (mounted.resource.providerResourceId !== handle.providerResourceId) {
      throw new Error('Windows live handle resource identity changed')
    }
    await this.#bridge.updateCapture(mounted.mount, rect)
  }

  async unmount(handle: LivePortalHandle): Promise<void> {
    this.#assertHandle(handle)
    const mounted = this.#mounted.get(handle.portalObjectId)
    if (!mounted) return
    if (mounted.resource.providerResourceId !== handle.providerResourceId) {
      throw new Error('Windows live handle resource identity changed')
    }
    await this.#bridge.unmountCapture(mounted.mount)
    this.#mounted.delete(handle.portalObjectId)
  }

  isMounted(portalObjectId: string): boolean {
    return this.#mounted.has(portalObjectId)
  }

  #assertHandle(handle: LivePortalHandle): void {
    if (handle.provider !== WINDOWS_PROVIDER_ID) throw new Error('Windows live portal host only accepts provider=windows')
    required(handle.portalObjectId, 'portalObjectId')
    required(handle.providerResourceId, 'providerResourceId')
  }
}

/**
 * Legacy structured UI inspection surface. Phase 15.14 keeps inspection for
 * compatibility, but direct semantic action dispatch is fail-closed. Authorized
 * actions must go through WindowsUiaControlledAccess so live controlOwner,
 * generation, freshness and policy are enforced together.
 */
export class WindowsProviderAccess {
  readonly #bridge: WindowsNativeBridge
  readonly #catalog: WindowsProviderCatalog
  readonly #authority: WindowsAccessAuthority

  constructor(bridge: WindowsNativeBridge, catalog: WindowsProviderCatalog, authority: WindowsAccessAuthority) {
    this.#bridge = bridge
    this.#catalog = catalog
    this.#authority = authority
  }

  async inspectUi(
    portalObjectId: string,
    providerResourceId: string,
    principalId: string,
  ): Promise<WindowsUiSnapshot> {
    const input = this.#accessInput(portalObjectId, providerResourceId, principalId)
    if (!this.#authority.canInspect(input)) throw new Error('principal is not authorized to inspect Windows resource')
    const resource = this.#requireResource(providerResourceId)
    if (!resource.automation.available) throw new Error('UI Automation is unavailable for this Windows resource')
    return this.#bridge.inspectUi(resource)
  }

  async performUiAction(
    portalObjectId: string,
    providerResourceId: string,
    principalId: string,
    action: WindowsUiSemanticAction,
  ): Promise<WindowsUiActionResult> {
    this.#accessInput(portalObjectId, providerResourceId, principalId)
    structuredClone(action)
    throw new Error('direct WindowsProviderAccess UIA action is disabled; use WindowsUiaControlledAccess')
  }

  #accessInput(portalObjectId: string, providerResourceId: string, principalId: string) {
    return {
      portalObjectId: required(portalObjectId, 'portalObjectId'),
      providerResourceId: required(providerResourceId, 'providerResourceId'),
      principalId: required(principalId, 'principalId'),
    }
  }

  #requireResource(providerResourceId: string): WindowsWindowResourceDescriptor {
    const resource = this.#catalog.get(providerResourceId)
    if (!resource) throw new Error(`Windows resource ${providerResourceId} is not present in the current provider epoch`)
    return resource
  }
}

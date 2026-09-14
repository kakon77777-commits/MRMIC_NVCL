import type {
  LivePortalHandle,
  LivePortalHost,
  LivePortalVisualFrame,
  OverlayRect,
} from '../../portal-overlay/src/index.js'
import type {
  WindowsCaptureMount,
  WindowsNativeBridge,
  WindowsWindowResourceDescriptor,
} from './index.js'
import type { WindowsCaptureSnapshot } from './jsonl-bridge.js'
import { WindowsProviderCatalog, WINDOWS_PROVIDER_ID } from './index.js'

export interface WindowsSnapshotNativeBridge extends WindowsNativeBridge {
  snapshotCapture(mount: WindowsCaptureMount): Promise<WindowsCaptureSnapshot>
}

interface MountedWindowCapture {
  resource: WindowsWindowResourceDescriptor
  mount: WindowsCaptureMount
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

/**
 * Phase 15.8 reference host. It keeps the Phase 15.4 mount/update/unmount
 * semantics, while exposing the Phase 15.7 bounded snapshot as an optional
 * provider-neutral LivePortal visual frame.
 */
export class WindowsSnapshotLivePortalHost implements LivePortalHost {
  readonly #bridge: WindowsSnapshotNativeBridge
  readonly #catalog: WindowsProviderCatalog
  readonly #mounted = new Map<string, MountedWindowCapture>()

  constructor(bridge: WindowsSnapshotNativeBridge, catalog: WindowsProviderCatalog) {
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
    if (mount.providerResourceId !== resource.providerResourceId) throw new Error('Windows capture mount resource identity mismatch')
    this.#mounted.set(handle.portalObjectId, { resource, mount: structuredClone(mount) })
  }

  async update(handle: LivePortalHandle, rect: OverlayRect): Promise<void> {
    this.#assertHandle(handle)
    const mounted = this.#requireMounted(handle)
    await this.#bridge.updateCapture(mounted.mount, rect)
  }

  async snapshot(handle: LivePortalHandle): Promise<LivePortalVisualFrame | null> {
    this.#assertHandle(handle)
    const mounted = this.#requireMounted(handle)
    const snapshot = await this.#bridge.snapshotCapture(mounted.mount)
    if (snapshot.providerResourceId !== handle.providerResourceId || snapshot.mountId !== mounted.mount.mountId) {
      throw new Error('Windows capture snapshot identity mismatch')
    }
    return {
      schema: 'live_portal_visual_frame_v1',
      portalObjectId: handle.portalObjectId,
      provider: WINDOWS_PROVIDER_ID,
      providerResourceId: handle.providerResourceId,
      frameSequence: snapshot.frameSequence,
      capturedAt: snapshot.capturedAt,
      width: snapshot.width,
      height: snapshot.height,
      mimeType: snapshot.mimeType,
      sha256: snapshot.sha256,
      bytesBase64: snapshot.bytesBase64,
      transport: snapshot.transport,
    }
  }

  async unmount(handle: LivePortalHandle): Promise<void> {
    this.#assertHandle(handle)
    const mounted = this.#mounted.get(handle.portalObjectId)
    if (!mounted) return
    if (mounted.resource.providerResourceId !== handle.providerResourceId) throw new Error('Windows live handle resource identity changed')
    await this.#bridge.unmountCapture(mounted.mount)
    this.#mounted.delete(handle.portalObjectId)
  }

  isMounted(portalObjectId: string): boolean {
    return this.#mounted.has(portalObjectId)
  }

  #requireMounted(handle: LivePortalHandle): MountedWindowCapture {
    const mounted = this.#mounted.get(handle.portalObjectId)
    if (!mounted) throw new Error(`Windows portal ${handle.portalObjectId} is not mounted`)
    if (mounted.resource.providerResourceId !== handle.providerResourceId) throw new Error('Windows live handle resource identity changed')
    return mounted
  }

  #assertHandle(handle: LivePortalHandle): void {
    if (handle.provider !== WINDOWS_PROVIDER_ID) throw new Error('Windows snapshot live portal host only accepts provider=windows')
    required(handle.portalObjectId, 'portalObjectId')
    required(handle.providerResourceId, 'providerResourceId')
  }
}

import type { CanvasObject } from '../../canvas-schema/src/index.js'
import { resourcePortalDescriptor } from '../../canvas-schema/src/index.js'
import type { Viewport } from '../../canvas-adapter/src/index.js'
import {
  LiveSurfaceBudget,
  worldTransformToOverlayRect,
  type ClientRectLike,
  type LivePortalHandle,
  type LivePortalHost,
  type OverlayRect,
} from './index.js'

export interface PortalActivationResult {
  portalObjectId: string
  provider: string
  providerResourceId: string
  mounted: boolean
  rect: OverlayRect
  evicted: string[]
  reason?: 'offscreen'
}

export interface LivePortalState {
  portalObjectId: string
  mounted: boolean
  visible: boolean
  focused: boolean
  controlOwner: string | null
}

interface MountedPortal {
  handle: LivePortalHandle
  host: LivePortalHost
}

/** Provider -> live portal host routing without coupling MRMIC to a provider package. */
export class LivePortalHostRegistry {
  readonly #hosts = new Map<string, LivePortalHost>()

  register(provider: string, host: LivePortalHost): void {
    if (!provider.trim()) throw new Error('provider is required')
    this.#hosts.set(provider.trim(), host)
  }

  unregister(provider: string): boolean {
    return this.#hosts.delete(provider)
  }

  get(provider: string): LivePortalHost | undefined {
    return this.#hosts.get(provider)
  }
}

/**
 * Coordinates Canvas-native resource_portal geometry with provider-owned live
 * surfaces. Activation is explicit and LRU-budgeted; viewport/object movement
 * only updates already-active surfaces and never silently creates new provider
 * runtime resources.
 */
export class CanvasLivePortalCoordinator {
  readonly #hosts: LivePortalHostRegistry
  readonly #budget: LiveSurfaceBudget
  readonly #mounted = new Map<string, MountedPortal>()
  readonly #states = new Map<string, LivePortalState>()

  constructor(hosts: LivePortalHostRegistry, budget: LiveSurfaceBudget = new LiveSurfaceBudget(2)) {
    this.#hosts = hosts
    this.#budget = budget
  }

  activePortalObjectIds(): string[] {
    return this.#budget.active()
  }

  isMounted(portalObjectId: string): boolean {
    return this.#mounted.has(portalObjectId)
  }

  state(portalObjectId: string): LivePortalState | null {
    const state = this.#states.get(portalObjectId)
    return state ? { ...state } : null
  }

  setFocused(portalObjectId: string, focused: boolean): LivePortalState {
    const state = this.#requireState(portalObjectId)
    if (focused && (!state.mounted || !state.visible)) {
      throw new Error(`Portal ${portalObjectId} must be mounted and visible before it can receive focus`)
    }
    return this.#writeState({ ...state, focused })
  }

  acquireControl(portalObjectId: string, principalId: string): LivePortalState {
    const principal = principalId.trim()
    if (!principal) throw new Error('principalId is required')
    const state = this.#requireState(portalObjectId)
    if (!state.mounted || !state.visible) {
      throw new Error(`Portal ${portalObjectId} must be mounted and visible before control can be acquired`)
    }
    if (state.controlOwner && state.controlOwner !== principal) {
      throw new Error(`Portal ${portalObjectId} is already controlled by ${state.controlOwner}`)
    }
    return this.#writeState({ ...state, controlOwner: principal })
  }

  releaseControl(portalObjectId: string, principalId: string): LivePortalState {
    const principal = principalId.trim()
    if (!principal) throw new Error('principalId is required')
    const state = this.#requireState(portalObjectId)
    if (state.controlOwner !== principal) {
      throw new Error(`Principal ${principal} cannot release control owned by ${state.controlOwner ?? 'no principal'}`)
    }
    return this.#writeState({ ...state, controlOwner: null })
  }

  revokeControl(portalObjectId: string): LivePortalState {
    const state = this.#requireState(portalObjectId)
    return this.#writeState({ ...state, controlOwner: null })
  }

  async activate(
    object: CanvasObject,
    viewport: Viewport,
    canvasClientRect: ClientRectLike,
  ): Promise<PortalActivationResult> {
    const descriptor = resourcePortalDescriptor(object)
    if (descriptor.displayMode !== 'live') throw new Error(`Portal ${object.id} is not in live display mode`)
    const host = this.#hosts.get(descriptor.provider)
    if (!host) throw new Error(`No live portal host registered for provider ${descriptor.provider}`)

    const handle: LivePortalHandle = {
      portalObjectId: object.id,
      provider: descriptor.provider,
      providerResourceId: descriptor.providerResourceId,
    }
    const rect = worldTransformToOverlayRect(object.transform, viewport, canvasClientRect)
    if (!rect.visible) {
      const current = this.#mounted.get(object.id)
      if (current) await current.host.update(current.handle, rect)
      this.#budget.deactivate(object.id)
      this.#writeState({
        portalObjectId: object.id,
        mounted: Boolean(current),
        visible: false,
        focused: false,
        controlOwner: null,
      })
      return {
        portalObjectId: object.id,
        provider: descriptor.provider,
        providerResourceId: descriptor.providerResourceId,
        mounted: Boolean(current),
        rect,
        evicted: [],
        reason: 'offscreen',
      }
    }

    const activation = this.#budget.activate(object.id)
    for (const evictedId of activation.evicted) await this.#unmount(evictedId)

    const existing = this.#mounted.get(object.id)
    let preserveInteractionState = true
    if (existing) {
      if (existing.handle.provider !== handle.provider || existing.handle.providerResourceId !== handle.providerResourceId) {
        await existing.host.unmount(existing.handle)
        this.#mounted.delete(object.id)
        preserveInteractionState = false
        await host.mount(handle, rect)
        this.#mounted.set(object.id, { handle, host })
      } else {
        await host.update(handle, rect)
      }
    } else {
      await host.mount(handle, rect)
      this.#mounted.set(object.id, { handle, host })
    }

    const previous = preserveInteractionState ? this.#states.get(object.id) : undefined
    this.#writeState({
      portalObjectId: object.id,
      mounted: true,
      visible: true,
      focused: previous?.focused ?? false,
      controlOwner: previous?.controlOwner ?? null,
    })

    return {
      portalObjectId: object.id,
      provider: descriptor.provider,
      providerResourceId: descriptor.providerResourceId,
      mounted: true,
      rect,
      evicted: activation.evicted,
    }
  }

  /** Update geometry/lifecycle for surfaces that were explicitly activated. */
  async syncGeometry(
    objects: CanvasObject[],
    viewport: Viewport,
    canvasClientRect: ClientRectLike,
  ): Promise<void> {
    const byId = new Map(objects.map(object => [object.id, object]))
    for (const portalObjectId of [...this.#mounted.keys()]) {
      const object = byId.get(portalObjectId)
      if (!object || object.type !== 'resource_portal') {
        await this.deactivate(portalObjectId)
        continue
      }

      let descriptor
      try { descriptor = resourcePortalDescriptor(object) }
      catch {
        await this.deactivate(portalObjectId)
        continue
      }
      if (descriptor.displayMode !== 'live') {
        await this.deactivate(portalObjectId)
        continue
      }

      const mounted = this.#mounted.get(portalObjectId)
      if (!mounted) continue
      if (mounted.handle.provider !== descriptor.provider || mounted.handle.providerResourceId !== descriptor.providerResourceId) {
        await this.deactivate(portalObjectId)
        continue
      }
      const rect = worldTransformToOverlayRect(object.transform, viewport, canvasClientRect)
      await mounted.host.update(mounted.handle, rect)
      if (!rect.visible) {
        this.#budget.deactivate(portalObjectId)
        this.#writeState({
          portalObjectId,
          mounted: true,
          visible: false,
          focused: false,
          controlOwner: null,
        })
        continue
      }

      if (!this.#budget.active().includes(portalObjectId)) {
        const activation = this.#budget.activate(portalObjectId)
        for (const evictedId of activation.evicted) await this.#unmount(evictedId)
      }
      const previous = this.#states.get(portalObjectId)
      this.#writeState({
        portalObjectId,
        mounted: true,
        visible: true,
        focused: previous?.focused ?? false,
        controlOwner: previous?.controlOwner ?? null,
      })
    }
  }

  async deactivate(portalObjectId: string): Promise<boolean> {
    const mounted = this.#mounted.has(portalObjectId)
    this.#budget.deactivate(portalObjectId)
    if (mounted) await this.#unmount(portalObjectId)
    return mounted
  }

  async deactivateAll(): Promise<void> {
    for (const portalObjectId of [...this.#mounted.keys()]) await this.deactivate(portalObjectId)
  }

  async #unmount(portalObjectId: string): Promise<void> {
    const mounted = this.#mounted.get(portalObjectId)
    if (mounted) {
      await mounted.host.unmount(mounted.handle)
      this.#mounted.delete(portalObjectId)
    }
    this.#writeState({
      portalObjectId,
      mounted: false,
      visible: false,
      focused: false,
      controlOwner: null,
    })
  }

  #requireState(portalObjectId: string): LivePortalState {
    const state = this.#states.get(portalObjectId)
    if (!state) throw new Error(`Portal ${portalObjectId} has no live host state`)
    return state
  }

  #writeState(state: LivePortalState): LivePortalState {
    const stored = { ...state }
    this.#states.set(state.portalObjectId, stored)
    return { ...stored }
  }
}

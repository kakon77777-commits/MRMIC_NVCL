import { resourcePortalDescriptor, type CanvasObject } from '../../canvas-schema/src/index.js'
import type { LivePortalHostRegistry } from '../../portal-overlay/src/runtime.js'
import { stripPortalVisualPreview } from '../../portal-overlay/src/visual.js'
import { resolveObserverCanvasContexts, type ObserverSnapshot } from './index.js'
import { observerAllowsPortalVisual, type ObserverPortalVisualTarget } from './projection.js'
import { projectPortalForObserver } from './visual-projection.js'

export const OBSERVER_PORTAL_LIVE_REFRESH_MS = 250
export const OBSERVER_PORTAL_WARM_REFRESH_MS = 2_000
export const OBSERVER_PORTAL_SHARED_REFRESH_MS = 500
export const OBSERVER_PORTAL_POLICY_POLL_MS = 1_000
export const OBSERVER_PORTAL_MAX_CACHED_FRAMES = 4

export type ObserverPortalRefreshMode =
  | 'live'
  | 'warm'
  | 'frozen'
  | 'sleeping'
  | 'shared'
  | 'denied'

export interface ObserverPortalRefreshPlan {
  allowed: boolean
  mode: ObserverPortalRefreshMode
  refreshIntervalMs: number | null
  retainLastFrame: boolean
}

export interface ObserverPortalCompositorResult {
  portalId: string
  object: CanvasObject
  allowed: boolean
  mode: ObserverPortalRefreshMode
  refreshed: boolean
  providerRead: boolean
  fromCache: boolean
  frameSequence?: number
  capturedAt?: string
  nextRefreshAtMs?: number
  error?: string
}

interface CachedPortalFrame {
  object: CanvasObject
  frameSequence: number
  capturedAt?: string
  refreshedAtMs: number
  lastAccess: number
}

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function targetCacheKey(target: ObserverPortalVisualTarget, portalObjectId: string): string {
  return target.kind === 'private_view'
    ? `private:${required(target.viewId, 'viewId')}:${portalObjectId}`
    : `rendezvous:${required(target.rendezvousId, 'rendezvousId')}:${portalObjectId}`
}

/**
 * Resolve refresh cadence without touching the provider. Private view cadence is
 * lifecycle-aware; rendezvous cadence requires explicit selective convergence.
 */
export function observerPortalRefreshPlan(
  snapshot: ObserverSnapshot,
  target: ObserverPortalVisualTarget,
  portalId: string,
): ObserverPortalRefreshPlan {
  const semanticPortalId = required(portalId, 'portalId')
  if (target.kind === 'private_view') {
    const viewId = required(target.viewId, 'viewId')
    const view = snapshot.views.find(candidate => candidate.viewId === viewId)
    if (!view) return { allowed: false, mode: 'denied', refreshIntervalMs: null, retainLastFrame: false }
    if (view.lifecycle === 'sleeping') {
      return { allowed: false, mode: 'sleeping', refreshIntervalMs: null, retainLastFrame: false }
    }
    const active = resolveObserverCanvasContexts(view).find(context => context.active)
    const visible = Boolean(active?.effectiveVisible && active.foregroundPortalIds.includes(semanticPortalId))
    if (!visible) return { allowed: false, mode: 'denied', refreshIntervalMs: null, retainLastFrame: false }
    if (view.lifecycle === 'frozen') {
      return { allowed: true, mode: 'frozen', refreshIntervalMs: null, retainLastFrame: true }
    }
    if (view.lifecycle === 'warm') {
      return { allowed: true, mode: 'warm', refreshIntervalMs: OBSERVER_PORTAL_WARM_REFRESH_MS, retainLastFrame: true }
    }
    return { allowed: true, mode: 'live', refreshIntervalMs: OBSERVER_PORTAL_LIVE_REFRESH_MS, retainLastFrame: true }
  }

  const allowed = observerAllowsPortalVisual(snapshot, target, semanticPortalId)
  return allowed
    ? { allowed: true, mode: 'shared', refreshIntervalMs: OBSERVER_PORTAL_SHARED_REFRESH_MS, retainLastFrame: true }
    : { allowed: false, mode: 'denied', refreshIntervalMs: null, retainLastFrame: false }
}

/**
 * Observer-scoped latest-frame compositor. It retains at most four ephemeral
 * render copies and never writes frame bytes back to canonical Canvas state.
 */
export class ObserverPortalCompositor {
  readonly #hosts: LivePortalHostRegistry
  readonly #maxCachedFrames: number
  readonly #cache = new Map<string, CachedPortalFrame>()
  #clock = 0

  constructor(hosts: LivePortalHostRegistry, maxCachedFrames = OBSERVER_PORTAL_MAX_CACHED_FRAMES) {
    if (!Number.isInteger(maxCachedFrames) || maxCachedFrames < 1 || maxCachedFrames > 64) {
      throw new Error('observer portal compositor cache bound must be an integer between 1 and 64')
    }
    this.#hosts = hosts
    this.#maxCachedFrames = maxCachedFrames
  }

  cachedPortalCount(): number {
    return this.#cache.size
  }

  clear(): void {
    this.#cache.clear()
  }

  clearTarget(target: ObserverPortalVisualTarget): void {
    const prefix = target.kind === 'private_view'
      ? `private:${required(target.viewId, 'viewId')}:`
      : `rendezvous:${required(target.rendezvousId, 'rendezvousId')}:`
    for (const key of [...this.#cache.keys()]) if (key.startsWith(prefix)) this.#cache.delete(key)
  }

  async compose(
    object: CanvasObject,
    observerSnapshot: ObserverSnapshot,
    target: ObserverPortalVisualTarget,
    nowMs = Date.now(),
  ): Promise<ObserverPortalCompositorResult> {
    if (!Number.isFinite(nowMs)) throw new Error('nowMs must be finite')
    if (object.type !== 'resource_portal') throw new Error('observer portal compositor requires a resource_portal object')
    const descriptor = resourcePortalDescriptor(object)
    const portalId = descriptor.portalId
    const key = targetCacheKey(target, object.id)
    const plan = observerPortalRefreshPlan(observerSnapshot, target, portalId)
    const cached = this.#cache.get(key)

    if (!plan.allowed) {
      this.#cache.delete(key)
      return {
        portalId,
        object: stripPortalVisualPreview(object),
        allowed: false,
        mode: plan.mode,
        refreshed: false,
        providerRead: false,
        fromCache: false,
      }
    }

    if (plan.mode === 'frozen') {
      if (!cached) {
        return {
          portalId,
          object: stripPortalVisualPreview(object),
          allowed: true,
          mode: 'frozen',
          refreshed: false,
          providerRead: false,
          fromCache: false,
        }
      }
      this.#touch(key, cached)
      return {
        portalId,
        object: structuredClone(cached.object),
        allowed: true,
        mode: 'frozen',
        refreshed: false,
        providerRead: false,
        fromCache: true,
        frameSequence: cached.frameSequence,
        ...(cached.capturedAt ? { capturedAt: cached.capturedAt } : {}),
      }
    }

    const interval = plan.refreshIntervalMs
    if (cached && interval !== null && nowMs < cached.refreshedAtMs + interval) {
      this.#touch(key, cached)
      return {
        portalId,
        object: structuredClone(cached.object),
        allowed: true,
        mode: plan.mode,
        refreshed: false,
        providerRead: false,
        fromCache: true,
        frameSequence: cached.frameSequence,
        ...(cached.capturedAt ? { capturedAt: cached.capturedAt } : {}),
        nextRefreshAtMs: cached.refreshedAtMs + interval,
      }
    }

    try {
      const projected = await projectPortalForObserver(object, this.#hosts, observerSnapshot, target)
      if (!projected.allowed) {
        this.#cache.delete(key)
        return {
          portalId,
          object: projected.object,
          allowed: false,
          mode: 'denied',
          refreshed: false,
          providerRead: false,
          fromCache: false,
        }
      }
      if (projected.frameSequence === undefined) {
        if (cached) {
          this.#touch(key, cached)
          return {
            portalId,
            object: structuredClone(cached.object),
            allowed: true,
            mode: plan.mode,
            refreshed: false,
            providerRead: true,
            fromCache: true,
            frameSequence: cached.frameSequence,
            ...(cached.capturedAt ? { capturedAt: cached.capturedAt } : {}),
            ...(interval !== null ? { nextRefreshAtMs: nowMs + interval } : {}),
          }
        }
        return {
          portalId,
          object: projected.object,
          allowed: true,
          mode: plan.mode,
          refreshed: false,
          providerRead: true,
          fromCache: false,
          ...(interval !== null ? { nextRefreshAtMs: nowMs + interval } : {}),
        }
      }
      if (cached && projected.frameSequence < cached.frameSequence) {
        this.#cache.delete(key)
        return {
          portalId,
          object: stripPortalVisualPreview(object),
          allowed: true,
          mode: plan.mode,
          refreshed: false,
          providerRead: true,
          fromCache: false,
          error: 'provider frame sequence regressed',
          ...(interval !== null ? { nextRefreshAtMs: nowMs + interval } : {}),
        }
      }

      const frameSequence = projected.frameSequence
      const next: CachedPortalFrame = {
        object: structuredClone(projected.object),
        frameSequence,
        ...(projected.capturedAt ? { capturedAt: projected.capturedAt } : {}),
        refreshedAtMs: nowMs,
        lastAccess: ++this.#clock,
      }
      this.#cache.set(key, next)
      this.#evictOverflow()
      return {
        portalId,
        object: structuredClone(next.object),
        allowed: true,
        mode: plan.mode,
        refreshed: !cached || frameSequence > cached.frameSequence,
        providerRead: true,
        fromCache: false,
        frameSequence,
        ...(next.capturedAt ? { capturedAt: next.capturedAt } : {}),
        ...(interval !== null ? { nextRefreshAtMs: nowMs + interval } : {}),
      }
    } catch (error) {
      this.#cache.delete(key)
      return {
        portalId,
        object: stripPortalVisualPreview(object),
        allowed: true,
        mode: plan.mode,
        refreshed: false,
        providerRead: true,
        fromCache: false,
        error: error instanceof Error ? error.message : String(error),
        ...(interval !== null ? { nextRefreshAtMs: nowMs + interval } : {}),
      }
    }
  }

  #touch(key: string, cached: CachedPortalFrame): void {
    cached.lastAccess = ++this.#clock
    this.#cache.set(key, cached)
  }

  #evictOverflow(): void {
    while (this.#cache.size > this.#maxCachedFrames) {
      const oldest = [...this.#cache.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0]
      if (!oldest) return
      this.#cache.delete(oldest[0])
    }
  }
}

export interface ObserverPortalRefreshLoopOptions {
  compositor: ObserverPortalCompositor
  object: () => CanvasObject
  observerSnapshot: () => ObserverSnapshot
  target: ObserverPortalVisualTarget
  onProjection: (result: ObserverPortalCompositorResult) => void | Promise<void>
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
  policyPollMs?: number
}

/**
 * Non-overlapping bounded refresh loop. A new tick is scheduled only after the
 * previous observer gate/provider read/projection callback finishes.
 */
export class ObserverPortalRefreshLoop {
  readonly #options: ObserverPortalRefreshLoopOptions
  #timer: unknown
  #running = false
  #inFlight = false

  constructor(options: ObserverPortalRefreshLoopOptions) {
    const policyPollMs = options.policyPollMs ?? OBSERVER_PORTAL_POLICY_POLL_MS
    if (!Number.isInteger(policyPollMs) || policyPollMs < 50 || policyPollMs > 60_000) {
      throw new Error('policyPollMs must be an integer between 50 and 60000')
    }
    this.#options = { ...options, policyPollMs }
  }

  start(): void {
    if (this.#running) return
    this.#running = true
    this.#schedule(0)
  }

  stop(): void {
    this.#running = false
    if (this.#timer !== undefined) this.#cancel()(this.#timer)
    this.#timer = undefined
  }

  isRunning(): boolean {
    return this.#running
  }

  async refreshOnce(nowMs = this.#now()): Promise<ObserverPortalCompositorResult> {
    return this.#options.compositor.compose(
      this.#options.object(),
      this.#options.observerSnapshot(),
      this.#options.target,
      nowMs,
    )
  }

  #schedule(delayMs: number): void {
    if (!this.#running) return
    this.#timer = this.#scheduler()(() => { void this.#tick() }, Math.max(0, delayMs))
  }

  async #tick(): Promise<void> {
    if (!this.#running || this.#inFlight) return
    this.#inFlight = true
    let result: ObserverPortalCompositorResult | undefined
    try {
      result = await this.refreshOnce()
      await this.#options.onProjection(result)
    } finally {
      this.#inFlight = false
      if (!this.#running) return
      const delay = result?.nextRefreshAtMs !== undefined
        ? Math.max(0, result.nextRefreshAtMs - this.#now())
        : this.#options.policyPollMs ?? OBSERVER_PORTAL_POLICY_POLL_MS
      this.#schedule(delay)
    }
  }

  #now(): number {
    const value = (this.#options.now ?? Date.now)()
    if (!Number.isFinite(value)) throw new Error('refresh loop clock must be finite')
    return value
  }

  #scheduler(): (callback: () => void, delayMs: number) => unknown {
    return this.#options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  }

  #cancel(): (handle: unknown) => void {
    return this.#options.cancel ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }
}

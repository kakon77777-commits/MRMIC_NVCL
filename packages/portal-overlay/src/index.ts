import type { Transform2D } from '../../canvas-schema/src/index.js'
import type { Viewport } from '../../canvas-adapter/src/index.js'

export interface ClientRectLike {
  left: number
  top: number
  width: number
  height: number
}

export interface OverlayRect {
  left: number
  top: number
  width: number
  height: number
  visible: boolean
}

export interface LivePortalHandle {
  portalObjectId: string
  provider: string
  providerResourceId: string
}

export interface LivePortalHost {
  mount(handle: LivePortalHandle, rect: OverlayRect): void | Promise<void>
  update(handle: LivePortalHandle, rect: OverlayRect): void | Promise<void>
  unmount(handle: LivePortalHandle): void | Promise<void>
}

export function worldTransformToOverlayRect(
  transform: Transform2D,
  viewport: Viewport,
  canvasClientRect: ClientRectLike,
): OverlayRect {
  if (![transform.x, transform.y, transform.width, transform.height, viewport.x, viewport.y, viewport.zoom,
    canvasClientRect.left, canvasClientRect.top, canvasClientRect.width, canvasClientRect.height].every(Number.isFinite)) {
    throw new Error('overlay geometry values must be finite')
  }
  if (viewport.zoom <= 0 || canvasClientRect.width < 0 || canvasClientRect.height < 0) {
    throw new Error('viewport zoom must be positive and client bounds cannot be negative')
  }
  const left = canvasClientRect.left + (transform.x - viewport.x) * viewport.zoom
  const top = canvasClientRect.top + (transform.y - viewport.y) * viewport.zoom
  const width = transform.width * transform.scaleX * viewport.zoom
  const height = transform.height * transform.scaleY * viewport.zoom
  const right = left + width
  const bottom = top + height
  const canvasRight = canvasClientRect.left + canvasClientRect.width
  const canvasBottom = canvasClientRect.top + canvasClientRect.height
  return {
    left,
    top,
    width,
    height,
    visible: width > 0 && height > 0
      && right > canvasClientRect.left && bottom > canvasClientRect.top
      && left < canvasRight && top < canvasBottom,
  }
}

export class LiveSurfaceBudget {
  readonly #limit: number
  readonly #active = new Map<string, number>()
  #clock = 0

  constructor(limit = 2) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('live surface limit must be a positive integer')
    this.#limit = limit
  }

  activate(portalObjectId: string): { active: string[]; evicted: string[] } {
    if (!portalObjectId) throw new Error('portalObjectId is required')
    this.#clock += 1
    this.#active.set(portalObjectId, this.#clock)
    const evicted: string[] = []
    while (this.#active.size > this.#limit) {
      const oldest = [...this.#active.entries()].sort((a, b) => a[1] - b[1])[0]
      if (!oldest) break
      this.#active.delete(oldest[0])
      evicted.push(oldest[0])
    }
    return { active: this.active(), evicted }
  }

  touch(portalObjectId: string): boolean {
    if (!this.#active.has(portalObjectId)) return false
    this.#clock += 1
    this.#active.set(portalObjectId, this.#clock)
    return true
  }

  deactivate(portalObjectId: string): boolean {
    return this.#active.delete(portalObjectId)
  }

  active(): string[] {
    return [...this.#active.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }
}

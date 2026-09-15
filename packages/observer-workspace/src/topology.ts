export interface ObserverSubcanvasLinkInput {
  parentCanvasId: string
  childCanvasId: string
  portalObjectId: string
}

export interface ObserverSubcanvasLink {
  parentCanvasId: string
  childCanvasId: string
  portalObjectId: string
}

export interface ObserverCanvasTopologyResolver {
  resolveSubcanvasLink(input: ObserverSubcanvasLinkInput): ObserverSubcanvasLink | null
}

export interface CanvasTopologySource {
  getCanvas(canvasId: string): {
    id: string
    parentCanvasId?: string
    parentObjectId?: string
  }
  getObject(objectId: string): {
    id: string
    canvasId: string
    type: string
    content?: { childCanvasId?: string }
  }
}

function normalized(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

/**
 * Adapter over the existing Canvas authority. It does not create topology and
 * never trusts observer-supplied lineage: the child Canvas and parent subcanvas
 * object must already agree in canonical Canvas state.
 */
export class CanvasAuthorityTopologyResolver implements ObserverCanvasTopologyResolver {
  readonly #source: CanvasTopologySource

  constructor(source: CanvasTopologySource) {
    this.#source = source
  }

  resolveSubcanvasLink(input: ObserverSubcanvasLinkInput): ObserverSubcanvasLink | null {
    const parentCanvasId = normalized(input.parentCanvasId, 'parentCanvasId')
    const childCanvasId = normalized(input.childCanvasId, 'childCanvasId')
    const portalObjectId = normalized(input.portalObjectId, 'portalObjectId')
    try {
      const child = this.#source.getCanvas(childCanvasId)
      const portal = this.#source.getObject(portalObjectId)
      if (child.parentCanvasId !== parentCanvasId) return null
      if (child.parentObjectId !== portalObjectId) return null
      if (portal.canvasId !== parentCanvasId) return null
      if (portal.type !== 'subcanvas') return null
      if (portal.content?.childCanvasId !== childCanvasId) return null
      return { parentCanvasId, childCanvasId, portalObjectId }
    } catch {
      return null
    }
  }
}

export class StaticObserverCanvasTopologyResolver implements ObserverCanvasTopologyResolver {
  readonly #links = new Map<string, ObserverSubcanvasLink>()

  constructor(links: ObserverSubcanvasLink[]) {
    for (const link of links) {
      const normalizedLink = {
        parentCanvasId: normalized(link.parentCanvasId, 'parentCanvasId'),
        childCanvasId: normalized(link.childCanvasId, 'childCanvasId'),
        portalObjectId: normalized(link.portalObjectId, 'portalObjectId'),
      }
      this.#links.set(this.#key(normalizedLink), normalizedLink)
    }
  }

  resolveSubcanvasLink(input: ObserverSubcanvasLinkInput): ObserverSubcanvasLink | null {
    const key = this.#key({
      parentCanvasId: normalized(input.parentCanvasId, 'parentCanvasId'),
      childCanvasId: normalized(input.childCanvasId, 'childCanvasId'),
      portalObjectId: normalized(input.portalObjectId, 'portalObjectId'),
    })
    const link = this.#links.get(key)
    return link ? structuredClone(link) : null
  }

  #key(link: ObserverSubcanvasLink): string {
    return `${link.parentCanvasId}\u0000${link.childCanvasId}\u0000${link.portalObjectId}`
  }
}

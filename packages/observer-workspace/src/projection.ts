import {
  resolveObserverCanvasContexts,
  type ObserverSnapshot,
} from './index.js'

export type ObserverPortalVisualTarget =
  | { kind: 'private_view'; viewId: string }
  | { kind: 'rendezvous'; rendezvousId: string }

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

/**
 * Decide whether a principal-filtered observer snapshot authorizes visual bytes
 * for one semantic portal id. This function never grants ownership or control.
 *
 * Private view: only the active, effectively-visible context foreground stack.
 * Rendezvous: only explicitly projected portals in an active room.
 */
export function observerAllowsPortalVisual(
  snapshot: ObserverSnapshot,
  target: ObserverPortalVisualTarget,
  portalId: string,
): boolean {
  const semanticPortalId = required(portalId, 'portalId')
  if (target.kind === 'private_view') {
    const viewId = required(target.viewId, 'viewId')
    const view = snapshot.views.find(candidate => candidate.viewId === viewId)
    if (!view || view.lifecycle === 'sleeping') return false
    const active = resolveObserverCanvasContexts(view).find(context => context.active)
    return Boolean(active?.effectiveVisible && active.foregroundPortalIds.includes(semanticPortalId))
  }

  const rendezvousId = required(target.rendezvousId, 'rendezvousId')
  const room = snapshot.rendezvous.find(candidate => candidate.rendezvousId === rendezvousId)
  if (!room || room.state !== 'active') return false
  return room.projections.some(projection => projection.portalId === semanticPortalId)
}

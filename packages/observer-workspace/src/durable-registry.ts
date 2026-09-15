import type { AuthenticatedPrincipal } from '../../identity-auth/src/index.js'
import {
  ObserverWorkspaceRegistry,
  type CreateObserverViewInput,
  type EnterObserverSubcanvasInput,
  type ObserverNestedVisibility,
  type ObserverResolvedCanvasContext,
  type ObserverSnapshot,
  type ObserverView,
  type ObserverViewLifecycle,
  type OpenRendezvousInput,
  type RendezvousRoom,
  type SharedProjectionInteraction,
} from './index.js'
import type { ObserverCanvasTopologyResolver } from './topology.js'
import {
  canonicalJson,
  clone,
  principalFromRef,
  principalRef,
  required,
  validateDurableObserverEvent,
  type DurableObserverCommand,
  type DurableObserverEntityKind,
  type DurableObserverEventType,
  type DurableObserverWorkspaceEvent,
  type DurableObserverWorkspaceEventStore,
} from './durable-contract.js'

class ReplayClock {
  #queue: string[] = []
  #replaying = false
  readonly #fallback: () => string

  constructor(fallback: () => string) {
    this.#fallback = fallback
  }

  use(values: string[]): void {
    if (this.#replaying || this.#queue.length) throw new Error('replay clock was not fully consumed')
    this.#replaying = true
    this.#queue = [...values]
  }

  now = (): string => {
    const value = this.#queue.shift()
    if (value) return value
    if (this.#replaying) throw new Error('durable observer replay requested an unexpected timestamp')
    return this.#fallback()
  }

  assertDrained(): void {
    if (this.#queue.length) throw new Error('durable observer replay did not consume all timestamps')
    this.#replaying = false
  }
}

function stateEquals(left: ObserverView | RendezvousRoom, right: ObserverView | RendezvousRoom): boolean {
  return canonicalJson(left) === canonicalJson(right)
}

function replayTimes(event: DurableObserverWorkspaceEvent): string[] {
  if (event.eventType === 'view_created' || event.eventType === 'rendezvous_opened') {
    const state = event.state as ObserverView | RendezvousRoom
    return [required(state.createdAt, 'state.createdAt', 128)]
  }
  if (event.eventType === 'rendezvous_joined') {
    const room = event.state as RendezvousRoom
    const member = room.members.find(item => item.principalId === event.principal.principalId)
    if (!member) throw new Error('joined principal is missing from durable rendezvous state')
    return [required(member.joinedAt, 'member.joinedAt', 128), required(room.updatedAt, 'state.updatedAt', 128)]
  }
  if (event.eventType === 'projection_added') {
    const room = event.state as RendezvousRoom
    const command = event.command
    if (command.kind !== 'project_portal') throw new Error('projection event command mismatch')
    const projection = room.projections.find(item => item.projectionId === command.input.projectionId)
    if (!projection) throw new Error('durable projection is missing from rendezvous state')
    return [required(projection.createdAt, 'projection.createdAt', 128), required(room.updatedAt, 'state.updatedAt', 128)]
  }
  return [event.createdAt]
}

function applyEvent(
  registry: ObserverWorkspaceRegistry,
  event: DurableObserverWorkspaceEvent,
  clock: ReplayClock,
): ObserverView | RendezvousRoom {
  const principal = principalFromRef(event.principal)
  clock.use(replayTimes(event))
  let result: ObserverView | RendezvousRoom
  const command = event.command
  switch (command.kind) {
    case 'create_view':
      result = registry.createPrivateView(command.input, principal)
      break
    case 'set_foreground':
      result = registry.setForegroundStack(command.viewId, command.portalIds, principal)
      break
    case 'set_lifecycle':
      result = registry.setViewLifecycle(command.viewId, command.lifecycle, principal)
      break
    case 'enter_subcanvas':
      result = registry.enterSubcanvas(command.viewId, command.input, principal)
      break
    case 'leave_subcanvas':
      result = registry.leaveSubcanvas(command.viewId, principal)
      break
    case 'set_nested_visibility':
      result = registry.setNestedVisibility(command.viewId, command.canvasId, command.visibility, principal)
      break
    case 'set_nested_foreground':
      result = registry.setNestedForegroundStack(command.viewId, command.canvasId, command.portalIds, principal)
      break
    case 'open_rendezvous':
      result = registry.openRendezvous(command.input, principal)
      break
    case 'invite':
      result = registry.invite(command.rendezvousId, command.invitedPrincipalId, principal)
      break
    case 'join':
      result = registry.join(command.rendezvousId, principal)
      break
    case 'project_portal':
      result = registry.projectPortal(command.rendezvousId, command.input, principal)
      break
    case 'remove_projection':
      result = registry.removeProjection(command.rendezvousId, command.projectionId, principal)
      break
    case 'close_rendezvous':
      result = registry.closeRendezvous(command.rendezvousId, principal)
      break
    default:
      throw new Error('unsupported durable observer command')
  }
  clock.assertDrained()
  if (!stateEquals(result, event.state)) throw new Error(`durable observer replay diverged at ${event.eventId}`)
  return result
}

export class DurableObserverWorkspaceRegistry {
  readonly #store: DurableObserverWorkspaceEventStore
  readonly #now: () => string
  readonly #topology?: ObserverCanvasTopologyResolver
  #registry: ObserverWorkspaceRegistry

  constructor(
    store: DurableObserverWorkspaceEventStore,
    now: () => string = () => new Date().toISOString(),
    topology?: ObserverCanvasTopologyResolver,
  ) {
    this.#store = store
    this.#now = now
    this.#topology = topology
    this.#registry = this.#recover()
  }

  createPrivateView(input: CreateObserverViewInput, principal: AuthenticatedPrincipal): ObserverView {
    const result = this.#registry.createPrivateView(input, principal)
    return this.#persist(
      'view_created',
      'observer_view',
      result,
      principal,
      { kind: 'create_view', input: {
        viewId: result.viewId,
        worldId: result.worldId,
        canvasId: result.canvasId,
        ...(result.label ? { label: result.label } : {}),
      } },
    ) as ObserverView
  }

  getPrivateView(viewId: string, principal: AuthenticatedPrincipal): ObserverView {
    return this.#registry.getPrivateView(viewId, principal)
  }

  getResolvedCanvasContexts(viewId: string, principal: AuthenticatedPrincipal): ObserverResolvedCanvasContext[] {
    return this.#registry.getResolvedCanvasContexts(viewId, principal)
  }

  setForegroundStack(viewId: string, portalIds: string[], principal: AuthenticatedPrincipal): ObserverView {
    const result = this.#registry.setForegroundStack(viewId, portalIds, principal)
    return this.#persist(
      'view_foreground_set',
      'observer_view',
      result,
      principal,
      { kind: 'set_foreground', viewId: result.viewId, portalIds: [...result.foregroundPortalIds] },
    ) as ObserverView
  }

  setViewLifecycle(viewId: string, lifecycle: ObserverViewLifecycle, principal: AuthenticatedPrincipal): ObserverView {
    const result = this.#registry.setViewLifecycle(viewId, lifecycle, principal)
    return this.#persist(
      'view_lifecycle_set',
      'observer_view',
      result,
      principal,
      { kind: 'set_lifecycle', viewId: result.viewId, lifecycle: result.lifecycle },
    ) as ObserverView
  }

  enterSubcanvas(viewId: string, input: EnterObserverSubcanvasInput, principal: AuthenticatedPrincipal): ObserverView {
    const result = this.#registry.enterSubcanvas(viewId, input, principal)
    const context = result.nestedCanvasContexts?.at(-1)
    if (!context) throw new Error('entered subcanvas is missing from observer view state')
    return this.#persist(
      'view_subcanvas_entered',
      'observer_view',
      result,
      principal,
      {
        kind: 'enter_subcanvas',
        viewId: result.viewId,
        input: {
          parentCanvasId: context.parentCanvasId,
          childCanvasId: context.canvasId,
          portalObjectId: context.portalObjectId,
          visibility: context.visibility,
        },
      },
    ) as ObserverView
  }

  leaveSubcanvas(viewId: string, principal: AuthenticatedPrincipal): ObserverView {
    const result = this.#registry.leaveSubcanvas(viewId, principal)
    return this.#persist(
      'view_subcanvas_left',
      'observer_view',
      result,
      principal,
      { kind: 'leave_subcanvas', viewId: result.viewId },
    ) as ObserverView
  }

  setNestedVisibility(
    viewId: string,
    canvasId: string,
    visibility: ObserverNestedVisibility,
    principal: AuthenticatedPrincipal,
  ): ObserverView {
    const result = this.#registry.setNestedVisibility(viewId, canvasId, visibility, principal)
    return this.#persist(
      'view_nested_visibility_set',
      'observer_view',
      result,
      principal,
      { kind: 'set_nested_visibility', viewId: result.viewId, canvasId: canvasId.trim(), visibility },
    ) as ObserverView
  }

  setNestedForegroundStack(
    viewId: string,
    canvasId: string,
    portalIds: string[],
    principal: AuthenticatedPrincipal,
  ): ObserverView {
    const result = this.#registry.setNestedForegroundStack(viewId, canvasId, portalIds, principal)
    const context = result.nestedCanvasContexts?.find(item => item.canvasId === canvasId.trim())
    if (!context) throw new Error('nested foreground target is missing from observer view state')
    return this.#persist(
      'view_nested_foreground_set',
      'observer_view',
      result,
      principal,
      {
        kind: 'set_nested_foreground',
        viewId: result.viewId,
        canvasId: context.canvasId,
        portalIds: [...context.foregroundPortalIds],
      },
    ) as ObserverView
  }

  openRendezvous(input: OpenRendezvousInput, principal: AuthenticatedPrincipal): RendezvousRoom {
    const result = this.#registry.openRendezvous(input, principal)
    return this.#persist(
      'rendezvous_opened',
      'rendezvous',
      result,
      principal,
      { kind: 'open_rendezvous', input: {
        rendezvousId: result.rendezvousId,
        worldId: result.worldId,
        canvasId: result.canvasId,
        ...(result.label ? { label: result.label } : {}),
      } },
    ) as RendezvousRoom
  }

  invite(rendezvousId: string, invitedPrincipalId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    const before = this.#registry.getRendezvous(rendezvousId, principal)
    const result = this.#registry.invite(rendezvousId, invitedPrincipalId, principal)
    if (result.revision === before.revision) return result
    return this.#persist(
      'rendezvous_invited',
      'rendezvous',
      result,
      principal,
      { kind: 'invite', rendezvousId: result.rendezvousId, invitedPrincipalId: invitedPrincipalId.trim() },
    ) as RendezvousRoom
  }

  join(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    let previousRevision: number | undefined
    try {
      previousRevision = this.#registry.getRendezvous(rendezvousId, principal).revision
    } catch {
      previousRevision = undefined
    }
    const result = this.#registry.join(rendezvousId, principal)
    if (previousRevision !== undefined && result.revision === previousRevision) return result
    return this.#persist(
      'rendezvous_joined',
      'rendezvous',
      result,
      principal,
      { kind: 'join', rendezvousId: result.rendezvousId },
    ) as RendezvousRoom
  }

  projectPortal(
    rendezvousId: string,
    input: { projectionId: string; sourceViewId: string; portalId: string; interaction?: SharedProjectionInteraction },
    principal: AuthenticatedPrincipal,
  ): RendezvousRoom {
    const result = this.#registry.projectPortal(rendezvousId, input, principal)
    const projection = result.projections.find(item => item.projectionId === input.projectionId.trim())
    if (!projection) throw new Error('projected portal is missing from resulting rendezvous state')
    return this.#persist(
      'projection_added',
      'rendezvous',
      result,
      principal,
      { kind: 'project_portal', rendezvousId: result.rendezvousId, input: {
        projectionId: projection.projectionId,
        sourceViewId: projection.sourceViewId,
        portalId: projection.portalId,
        interaction: projection.interaction,
      } },
    ) as RendezvousRoom
  }

  removeProjection(rendezvousId: string, projectionId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    const result = this.#registry.removeProjection(rendezvousId, projectionId, principal)
    return this.#persist(
      'projection_removed',
      'rendezvous',
      result,
      principal,
      { kind: 'remove_projection', rendezvousId: result.rendezvousId, projectionId: projectionId.trim() },
    ) as RendezvousRoom
  }

  closeRendezvous(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    const before = this.#registry.getRendezvous(rendezvousId, principal)
    const result = this.#registry.closeRendezvous(rendezvousId, principal)
    if (result.revision === before.revision) return result
    return this.#persist(
      'rendezvous_closed',
      'rendezvous',
      result,
      principal,
      { kind: 'close_rendezvous', rendezvousId: result.rendezvousId },
    ) as RendezvousRoom
  }

  getRendezvous(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    return this.#registry.getRendezvous(rendezvousId, principal)
  }

  snapshotFor(principal: AuthenticatedPrincipal): ObserverSnapshot {
    return this.#registry.snapshotFor(principal)
  }

  #persist(
    eventType: DurableObserverEventType,
    entityKind: DurableObserverEntityKind,
    state: ObserverView | RendezvousRoom,
    principal: AuthenticatedPrincipal,
    command: DurableObserverCommand,
  ): ObserverView | RendezvousRoom {
    const entityId = entityKind === 'observer_view'
      ? (state as ObserverView).viewId
      : (state as RendezvousRoom).rendezvousId
    const event = validateDurableObserverEvent({
      schema: 'observer_workspace_event_v1',
      eventId: `${entityKind}:${entityId}:r${state.revision}:${eventType}`,
      eventType,
      entityKind,
      entityId,
      worldId: state.worldId,
      canvasId: state.canvasId,
      principal: principalRef(principal),
      revision: state.revision,
      command,
      state,
      createdAt: state.updatedAt,
    })
    try {
      this.#store.appendObserverWorkspaceEvent(event)
    } catch (error) {
      this.#registry = this.#recover()
      throw error
    }
    return clone(state)
  }

  #recover(): ObserverWorkspaceRegistry {
    const clock = new ReplayClock(this.#now)
    const registry = new ObserverWorkspaceRegistry(clock.now, this.#topology)
    const events = this.#store.listObserverWorkspaceEvents().map(validateDurableObserverEvent)
    const lastRevision = new Map<string, number>()
    const seenEventIds = new Set<string>()
    for (const event of events) {
      if (seenEventIds.has(event.eventId)) throw new Error(`duplicate durable observer event ${event.eventId}`)
      seenEventIds.add(event.eventId)
      const key = `${event.entityKind}\u0000${event.entityId}`
      const previous = lastRevision.get(key)
      if (previous === undefined) {
        if (event.revision !== 0) throw new Error(`durable observer entity ${event.entityId} must start at revision 0`)
      } else if (event.revision !== previous + 1) {
        throw new Error(`durable observer entity ${event.entityId} has a revision gap`)
      }
      applyEvent(registry, event, clock)
      lastRevision.set(key, event.revision)
    }
    return registry
  }
}

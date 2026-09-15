import type { AuthenticatedPrincipal } from '../../identity-auth/src/index.js'
import type { ObserverCanvasTopologyResolver } from './topology.js'

export type ObserverViewLifecycle = 'live' | 'warm' | 'frozen' | 'sleeping'
export type RendezvousState = 'active' | 'closed'
export type SharedProjectionInteraction = 'inspect' | 'interact'
export type ObserverNestedVisibility = 'inherit' | 'hidden'

export interface CreateObserverViewInput {
  viewId: string
  worldId: string
  canvasId: string
  label?: string
}

export interface ObserverNestedCanvasContext {
  schema: 'observer_nested_canvas_v1'
  parentCanvasId: string
  canvasId: string
  portalObjectId: string
  visibility: ObserverNestedVisibility
  foregroundPortalIds: string[]
  enteredAt: string
}

export interface ObserverResolvedCanvasContext {
  canvasId: string
  parentCanvasId?: string
  portalObjectId?: string
  depth: number
  visibility: 'root' | ObserverNestedVisibility
  effectiveVisible: boolean
  active: boolean
  foregroundPortalIds: string[]
}

export interface EnterObserverSubcanvasInput {
  parentCanvasId: string
  childCanvasId: string
  portalObjectId: string
  visibility?: ObserverNestedVisibility
}

export interface ObserverView {
  schema: 'observer_view_v1'
  viewId: string
  worldId: string
  canvasId: string
  label?: string
  observerPrincipalId: string
  observerSemanticAgentId?: string
  lifecycle: ObserverViewLifecycle
  foregroundPortalIds: string[]
  nestedCanvasContexts?: ObserverNestedCanvasContext[]
  revision: number
  createdAt: string
  updatedAt: string
}

export interface OpenRendezvousInput {
  rendezvousId: string
  worldId: string
  canvasId: string
  label?: string
}

export interface RendezvousMember {
  principalId: string
  semanticAgentId?: string
  joinedAt: string
}

export interface SharedResourceProjection {
  schema: 'shared_resource_projection_v1'
  projectionId: string
  sourceViewId: string
  sourcePrincipalId: string
  portalId: string
  interaction: SharedProjectionInteraction
  createdAt: string
}

export interface RendezvousRoom {
  schema: 'shared_rendezvous_v1'
  rendezvousId: string
  worldId: string
  canvasId: string
  label?: string
  hostPrincipalId: string
  invitedPrincipalIds: string[]
  members: RendezvousMember[]
  projections: SharedResourceProjection[]
  state: RendezvousState
  revision: number
  createdAt: string
  updatedAt: string
}

export interface ObserverSnapshot {
  views: ObserverView[]
  rendezvous: RendezvousRoom[]
}

function required(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return normalized
}

function optional(value: unknown, label: string, max = 256): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return required(value, label, max)
}

function uniqueRequiredStrings(values: string[], label: string, limit = 128): string[] {
  if (!Array.isArray(values)) throw new Error(`${label} must be an array`)
  if (values.length > limit) throw new Error(`${label} exceeds ${limit} entries`)
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    const normalized = required(value, `${label}[]`)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

function requireMutationPrincipal(principal: AuthenticatedPrincipal): void {
  if (principal.role === 'viewer') throw new Error('viewer principal cannot mutate observer workspace state')
}

function principalMember(principal: AuthenticatedPrincipal, joinedAt: string): RendezvousMember {
  return {
    principalId: required(principal.principalId, 'principal.principalId'),
    ...(principal.semanticAgentId ? { semanticAgentId: required(principal.semanticAgentId, 'principal.semanticAgentId') } : {}),
    joinedAt,
  }
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function nestedContexts(view: ObserverView): ObserverNestedCanvasContext[] {
  return view.nestedCanvasContexts ? clone(view.nestedCanvasContexts) : []
}

export function activeObserverCanvasId(view: ObserverView): string {
  const contexts = view.nestedCanvasContexts ?? []
  return contexts.at(-1)?.canvasId ?? view.canvasId
}

export function resolveObserverCanvasContexts(view: ObserverView): ObserverResolvedCanvasContext[] {
  const nested = view.nestedCanvasContexts ?? []
  const result: ObserverResolvedCanvasContext[] = [{
    canvasId: view.canvasId,
    depth: 0,
    visibility: 'root',
    effectiveVisible: true,
    active: nested.length === 0,
    foregroundPortalIds: [...view.foregroundPortalIds],
  }]
  let parentVisible = true
  for (const [index, context] of nested.entries()) {
    const effectiveVisible: boolean = parentVisible && context.visibility !== 'hidden'
    result.push({
      canvasId: context.canvasId,
      parentCanvasId: context.parentCanvasId,
      portalObjectId: context.portalObjectId,
      depth: index + 1,
      visibility: context.visibility,
      effectiveVisible,
      active: index === nested.length - 1,
      foregroundPortalIds: [...context.foregroundPortalIds],
    })
    parentVisible = effectiveVisible
  }
  return result
}

export class ObserverWorkspaceRegistry {
  readonly #views = new Map<string, ObserverView>()
  readonly #rendezvous = new Map<string, RendezvousRoom>()
  readonly #now: () => string
  readonly #topology?: ObserverCanvasTopologyResolver

  constructor(
    now: () => string = () => new Date().toISOString(),
    topology?: ObserverCanvasTopologyResolver,
  ) {
    this.#now = now
    this.#topology = topology
  }

  createPrivateView(input: CreateObserverViewInput, principal: AuthenticatedPrincipal): ObserverView {
    requireMutationPrincipal(principal)
    const viewId = required(input.viewId, 'viewId')
    if (this.#views.has(viewId)) throw new Error(`observer view ${viewId} already exists`)
    const timestamp = this.#now()
    const view: ObserverView = {
      schema: 'observer_view_v1',
      viewId,
      worldId: required(input.worldId, 'worldId'),
      canvasId: required(input.canvasId, 'canvasId'),
      ...(optional(input.label, 'label', 512) ? { label: optional(input.label, 'label', 512) } : {}),
      observerPrincipalId: required(principal.principalId, 'principal.principalId'),
      ...(principal.semanticAgentId ? { observerSemanticAgentId: required(principal.semanticAgentId, 'principal.semanticAgentId') } : {}),
      lifecycle: 'live',
      foregroundPortalIds: [],
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.#views.set(viewId, clone(view))
    return clone(view)
  }

  getPrivateView(viewId: string, principal: AuthenticatedPrincipal): ObserverView {
    const view = this.#requireOwnedView(viewId, principal)
    return clone(view)
  }

  getResolvedCanvasContexts(viewId: string, principal: AuthenticatedPrincipal): ObserverResolvedCanvasContext[] {
    return resolveObserverCanvasContexts(this.#requireOwnedView(viewId, principal))
  }

  setForegroundStack(viewId: string, portalIds: string[], principal: AuthenticatedPrincipal): ObserverView {
    requireMutationPrincipal(principal)
    const view = this.#requireOwnedView(viewId, principal)
    const next = this.#touchView(view, {
      foregroundPortalIds: uniqueRequiredStrings(portalIds, 'portalIds'),
    })
    this.#views.set(next.viewId, clone(next))
    return clone(next)
  }

  setViewLifecycle(viewId: string, lifecycle: ObserverViewLifecycle, principal: AuthenticatedPrincipal): ObserverView {
    requireMutationPrincipal(principal)
    if (!['live', 'warm', 'frozen', 'sleeping'].includes(lifecycle)) throw new Error('invalid observer view lifecycle')
    const view = this.#requireOwnedView(viewId, principal)
    const next = this.#touchView(view, { lifecycle })
    this.#views.set(next.viewId, clone(next))
    return clone(next)
  }

  enterSubcanvas(viewId: string, input: EnterObserverSubcanvasInput, principal: AuthenticatedPrincipal): ObserverView {
    requireMutationPrincipal(principal)
    const view = this.#requireOwnedView(viewId, principal)
    if (!this.#topology) throw new Error('observer subcanvas topology authority is not configured')
    const parentCanvasId = required(input.parentCanvasId, 'parentCanvasId')
    const childCanvasId = required(input.childCanvasId, 'childCanvasId')
    const portalObjectId = required(input.portalObjectId, 'portalObjectId')
    const expectedParent = activeObserverCanvasId(view)
    if (parentCanvasId !== expectedParent) {
      throw new Error(`observer subcanvas parent must be active canvas ${expectedParent}`)
    }
    const contexts = nestedContexts(view)
    if (contexts.length >= 64) throw new Error('observer nested canvas depth exceeds 64')
    const visited = new Set([view.canvasId, ...contexts.map(context => context.canvasId)])
    if (visited.has(childCanvasId)) throw new Error('observer subcanvas lineage cannot contain a cycle')
    const resolved = this.#topology.resolveSubcanvasLink({ parentCanvasId, childCanvasId, portalObjectId })
    if (!resolved) throw new Error('observer subcanvas link is not authorized by Canvas topology')
    if (
      resolved.parentCanvasId !== parentCanvasId
      || resolved.childCanvasId !== childCanvasId
      || resolved.portalObjectId !== portalObjectId
    ) throw new Error('Canvas topology resolver returned a mismatched subcanvas link')
    const visibility = input.visibility ?? 'inherit'
    if (visibility !== 'inherit' && visibility !== 'hidden') throw new Error('invalid observer nested visibility')
    const timestamp = this.#now()
    contexts.push({
      schema: 'observer_nested_canvas_v1',
      parentCanvasId,
      canvasId: childCanvasId,
      portalObjectId,
      visibility,
      foregroundPortalIds: [],
      enteredAt: timestamp,
    })
    const next = this.#touchViewAt(view, { nestedCanvasContexts: contexts }, timestamp)
    this.#views.set(next.viewId, clone(next))
    return clone(next)
  }

  leaveSubcanvas(viewId: string, principal: AuthenticatedPrincipal): ObserverView {
    requireMutationPrincipal(principal)
    const view = this.#requireOwnedView(viewId, principal)
    const contexts = nestedContexts(view)
    if (!contexts.length) throw new Error('observer view is already at its root canvas')
    contexts.pop()
    const next = this.#touchView(view, { nestedCanvasContexts: contexts })
    this.#views.set(next.viewId, clone(next))
    return clone(next)
  }

  setNestedVisibility(
    viewId: string,
    canvasId: string,
    visibility: ObserverNestedVisibility,
    principal: AuthenticatedPrincipal,
  ): ObserverView {
    requireMutationPrincipal(principal)
    if (visibility !== 'inherit' && visibility !== 'hidden') throw new Error('invalid observer nested visibility')
    const view = this.#requireOwnedView(viewId, principal)
    const target = required(canvasId, 'canvasId')
    const contexts = nestedContexts(view)
    const index = contexts.findIndex(context => context.canvasId === target)
    if (index < 0) throw new Error(`observer nested canvas ${target} not found`)
    const current = contexts[index]
    if (!current) throw new Error(`observer nested canvas ${target} not found`)
    contexts[index] = { ...current, visibility }
    const next = this.#touchView(view, { nestedCanvasContexts: contexts })
    this.#views.set(next.viewId, clone(next))
    return clone(next)
  }

  setNestedForegroundStack(
    viewId: string,
    canvasId: string,
    portalIds: string[],
    principal: AuthenticatedPrincipal,
  ): ObserverView {
    requireMutationPrincipal(principal)
    const view = this.#requireOwnedView(viewId, principal)
    const target = required(canvasId, 'canvasId')
    const contexts = nestedContexts(view)
    const index = contexts.findIndex(context => context.canvasId === target)
    if (index < 0) throw new Error(`observer nested canvas ${target} not found`)
    const current = contexts[index]
    if (!current) throw new Error(`observer nested canvas ${target} not found`)
    contexts[index] = {
      ...current,
      foregroundPortalIds: uniqueRequiredStrings(portalIds, 'portalIds'),
    }
    const next = this.#touchView(view, { nestedCanvasContexts: contexts })
    this.#views.set(next.viewId, clone(next))
    return clone(next)
  }

  openRendezvous(input: OpenRendezvousInput, principal: AuthenticatedPrincipal): RendezvousRoom {
    requireMutationPrincipal(principal)
    const rendezvousId = required(input.rendezvousId, 'rendezvousId')
    if (this.#rendezvous.has(rendezvousId)) throw new Error(`rendezvous ${rendezvousId} already exists`)
    const timestamp = this.#now()
    const room: RendezvousRoom = {
      schema: 'shared_rendezvous_v1',
      rendezvousId,
      worldId: required(input.worldId, 'worldId'),
      canvasId: required(input.canvasId, 'canvasId'),
      ...(optional(input.label, 'label', 512) ? { label: optional(input.label, 'label', 512) } : {}),
      hostPrincipalId: required(principal.principalId, 'principal.principalId'),
      invitedPrincipalIds: [],
      members: [principalMember(principal, timestamp)],
      projections: [],
      state: 'active',
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.#rendezvous.set(rendezvousId, clone(room))
    return clone(room)
  }

  invite(rendezvousId: string, invitedPrincipalId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    requireMutationPrincipal(principal)
    const room = this.#requireHostRoom(rendezvousId, principal)
    this.#requireActiveRoom(room)
    const target = required(invitedPrincipalId, 'invitedPrincipalId')
    if (room.members.some(member => member.principalId === target)) return clone(room)
    const invitedPrincipalIds = uniqueRequiredStrings([...room.invitedPrincipalIds, target], 'invitedPrincipalIds')
    return this.#saveRoom(this.#touchRoom(room, { invitedPrincipalIds }))
  }

  join(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    const room = this.#requireRoom(rendezvousId)
    this.#requireActiveRoom(room)
    if (room.members.some(member => member.principalId === principal.principalId)) return clone(room)
    if (!room.invitedPrincipalIds.includes(principal.principalId)) throw new Error('principal is not invited to rendezvous')
    const members = [...room.members, principalMember(principal, this.#now())]
    const invitedPrincipalIds = room.invitedPrincipalIds.filter(id => id !== principal.principalId)
    return this.#saveRoom(this.#touchRoom(room, { members, invitedPrincipalIds }))
  }

  projectPortal(
    rendezvousId: string,
    input: { projectionId: string; sourceViewId: string; portalId: string; interaction?: SharedProjectionInteraction },
    principal: AuthenticatedPrincipal,
  ): RendezvousRoom {
    requireMutationPrincipal(principal)
    const room = this.#requireVisibleRoom(rendezvousId, principal)
    this.#requireActiveRoom(room)
    const sourceView = this.#requireOwnedView(input.sourceViewId, principal)
    if (sourceView.worldId !== room.worldId) throw new Error('source view and rendezvous must belong to the same world')
    const projectionId = required(input.projectionId, 'projectionId')
    if (room.projections.some(projection => projection.projectionId === projectionId)) {
      throw new Error(`shared projection ${projectionId} already exists`)
    }
    const interaction = input.interaction ?? 'inspect'
    if (interaction !== 'inspect' && interaction !== 'interact') throw new Error('invalid shared projection interaction')
    const projection: SharedResourceProjection = {
      schema: 'shared_resource_projection_v1',
      projectionId,
      sourceViewId: sourceView.viewId,
      sourcePrincipalId: sourceView.observerPrincipalId,
      portalId: required(input.portalId, 'portalId'),
      interaction,
      createdAt: this.#now(),
    }
    return this.#saveRoom(this.#touchRoom(room, { projections: [...room.projections, projection] }))
  }

  removeProjection(rendezvousId: string, projectionId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    requireMutationPrincipal(principal)
    const room = this.#requireVisibleRoom(rendezvousId, principal)
    this.#requireActiveRoom(room)
    const normalizedProjectionId = required(projectionId, 'projectionId')
    const projection = room.projections.find(item => item.projectionId === normalizedProjectionId)
    if (!projection) throw new Error(`shared projection ${normalizedProjectionId} not found`)
    if (room.hostPrincipalId !== principal.principalId && projection.sourcePrincipalId !== principal.principalId) {
      throw new Error('only rendezvous host or projection source owner can remove projection')
    }
    return this.#saveRoom(this.#touchRoom(room, {
      projections: room.projections.filter(item => item.projectionId !== normalizedProjectionId),
    }))
  }

  closeRendezvous(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    requireMutationPrincipal(principal)
    const room = this.#requireHostRoom(rendezvousId, principal)
    if (room.state === 'closed') return clone(room)
    return this.#saveRoom(this.#touchRoom(room, { state: 'closed' }))
  }

  getRendezvous(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    return clone(this.#requireVisibleRoom(rendezvousId, principal))
  }

  snapshotFor(principal: AuthenticatedPrincipal): ObserverSnapshot {
    const views = [...this.#views.values()]
      .filter(view => view.observerPrincipalId === principal.principalId)
      .map(clone)
    const rendezvous = [...this.#rendezvous.values()]
      .filter(room => room.members.some(member => member.principalId === principal.principalId))
      .map(clone)
    return { views, rendezvous }
  }

  #requireOwnedView(viewId: string, principal: AuthenticatedPrincipal): ObserverView {
    const normalized = required(viewId, 'viewId')
    const view = this.#views.get(normalized)
    if (!view) throw new Error(`observer view ${normalized} not found`)
    if (view.observerPrincipalId !== principal.principalId) throw new Error('observer view is private to another principal')
    return view
  }

  #requireRoom(rendezvousId: string): RendezvousRoom {
    const normalized = required(rendezvousId, 'rendezvousId')
    const room = this.#rendezvous.get(normalized)
    if (!room) throw new Error(`rendezvous ${normalized} not found`)
    return room
  }

  #requireVisibleRoom(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    const room = this.#requireRoom(rendezvousId)
    if (!room.members.some(member => member.principalId === principal.principalId)) {
      throw new Error('principal is not a rendezvous member')
    }
    return room
  }

  #requireHostRoom(rendezvousId: string, principal: AuthenticatedPrincipal): RendezvousRoom {
    const room = this.#requireRoom(rendezvousId)
    if (room.hostPrincipalId !== principal.principalId) throw new Error('only rendezvous host can perform this operation')
    return room
  }

  #requireActiveRoom(room: RendezvousRoom): void {
    if (room.state !== 'active') throw new Error('rendezvous is closed')
  }

  #touchView(
    view: ObserverView,
    changes: Partial<Pick<ObserverView, 'foregroundPortalIds' | 'lifecycle' | 'nestedCanvasContexts'>>,
  ): ObserverView {
    return this.#touchViewAt(view, changes, this.#now())
  }

  #touchViewAt(
    view: ObserverView,
    changes: Partial<Pick<ObserverView, 'foregroundPortalIds' | 'lifecycle' | 'nestedCanvasContexts'>>,
    timestamp: string,
  ): ObserverView {
    return {
      ...clone(view),
      ...clone(changes),
      revision: view.revision + 1,
      updatedAt: timestamp,
    }
  }

  #touchRoom(
    room: RendezvousRoom,
    changes: Partial<Pick<RendezvousRoom, 'invitedPrincipalIds' | 'members' | 'projections' | 'state'>>,
  ): RendezvousRoom {
    return {
      ...clone(room),
      ...clone(changes),
      revision: room.revision + 1,
      updatedAt: this.#now(),
    }
  }

  #saveRoom(room: RendezvousRoom): RendezvousRoom {
    this.#rendezvous.set(room.rendezvousId, clone(room))
    return clone(room)
  }
}

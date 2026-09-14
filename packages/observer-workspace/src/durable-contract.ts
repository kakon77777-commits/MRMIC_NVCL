import { createHash } from 'node:crypto'
import type { AuthenticatedPrincipal, PrincipalRole } from '../../identity-auth/src/index.js'
import type {
  CreateObserverViewInput,
  EnterObserverSubcanvasInput,
  ObserverNestedVisibility,
  ObserverView,
  ObserverViewLifecycle,
  OpenRendezvousInput,
  RendezvousRoom,
  SharedProjectionInteraction,
} from './index.js'

export type DurableObserverEventType =
  | 'view_created'
  | 'view_foreground_set'
  | 'view_lifecycle_set'
  | 'view_subcanvas_entered'
  | 'view_subcanvas_left'
  | 'view_nested_visibility_set'
  | 'view_nested_foreground_set'
  | 'rendezvous_opened'
  | 'rendezvous_invited'
  | 'rendezvous_joined'
  | 'projection_added'
  | 'projection_removed'
  | 'rendezvous_closed'

export type DurableObserverEntityKind = 'observer_view' | 'rendezvous'

export interface DurablePrincipalRef {
  principalId: string
  role: PrincipalRole
  actor: {
    actorType: 'user' | 'agent' | 'system'
    actorId: string
  }
  semanticAgentId?: string
}

export type DurableObserverCommand =
  | { kind: 'create_view'; input: CreateObserverViewInput }
  | { kind: 'set_foreground'; viewId: string; portalIds: string[] }
  | { kind: 'set_lifecycle'; viewId: string; lifecycle: ObserverViewLifecycle }
  | { kind: 'enter_subcanvas'; viewId: string; input: EnterObserverSubcanvasInput }
  | { kind: 'leave_subcanvas'; viewId: string }
  | { kind: 'set_nested_visibility'; viewId: string; canvasId: string; visibility: ObserverNestedVisibility }
  | { kind: 'set_nested_foreground'; viewId: string; canvasId: string; portalIds: string[] }
  | { kind: 'open_rendezvous'; input: OpenRendezvousInput }
  | { kind: 'invite'; rendezvousId: string; invitedPrincipalId: string }
  | { kind: 'join'; rendezvousId: string }
  | {
      kind: 'project_portal'
      rendezvousId: string
      input: {
        projectionId: string
        sourceViewId: string
        portalId: string
        interaction: SharedProjectionInteraction
      }
    }
  | { kind: 'remove_projection'; rendezvousId: string; projectionId: string }
  | { kind: 'close_rendezvous'; rendezvousId: string }

export interface DurableObserverWorkspaceEvent {
  schema: 'observer_workspace_event_v1'
  eventId: string
  eventType: DurableObserverEventType
  entityKind: DurableObserverEntityKind
  entityId: string
  worldId: string
  canvasId: string
  principal: DurablePrincipalRef
  revision: number
  command: DurableObserverCommand
  state: ObserverView | RendezvousRoom
  createdAt: string
}

export interface DurableObserverWorkspaceEventStore {
  appendObserverWorkspaceEvent(event: DurableObserverWorkspaceEvent): void
  listObserverWorkspaceEvents(): DurableObserverWorkspaceEvent[]
}

export function clone<T>(value: T): T {
  return structuredClone(value)
}

export function required(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return normalized
}

function integer(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`)
  return Number(value)
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    )
  }
  return value
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function principalRef(principal: AuthenticatedPrincipal): DurablePrincipalRef {
  if (principal.role !== 'viewer' && principal.role !== 'agent-direct' && principal.role !== 'owner') {
    throw new Error('invalid principal role')
  }
  if (principal.actor.actorType !== 'user' && principal.actor.actorType !== 'agent' && principal.actor.actorType !== 'system') {
    throw new Error('invalid principal actor type')
  }
  return {
    principalId: required(principal.principalId, 'principal.principalId', 256),
    role: principal.role,
    actor: {
      actorType: principal.actor.actorType,
      actorId: required(principal.actor.actorId, 'principal.actor.actorId', 256),
    },
    ...(principal.semanticAgentId
      ? { semanticAgentId: required(principal.semanticAgentId, 'principal.semanticAgentId', 256) }
      : {}),
  }
}

export function principalFromRef(value: DurablePrincipalRef): AuthenticatedPrincipal {
  return clone(value)
}

function eventStateIdentity(event: DurableObserverWorkspaceEvent): {
  entityId: string
  worldId: string
  canvasId: string
  revision: number
  updatedAt: string
} {
  if (event.entityKind === 'observer_view') {
    const state = event.state as ObserverView
    if (state.schema !== 'observer_view_v1') throw new Error('durable observer event has invalid view state')
    return {
      entityId: required(state.viewId, 'state.viewId', 256),
      worldId: required(state.worldId, 'state.worldId', 256),
      canvasId: required(state.canvasId, 'state.canvasId', 256),
      revision: integer(state.revision, 'state.revision'),
      updatedAt: required(state.updatedAt, 'state.updatedAt', 128),
    }
  }
  const state = event.state as RendezvousRoom
  if (state.schema !== 'shared_rendezvous_v1') throw new Error('durable observer event has invalid rendezvous state')
  return {
    entityId: required(state.rendezvousId, 'state.rendezvousId', 256),
    worldId: required(state.worldId, 'state.worldId', 256),
    canvasId: required(state.canvasId, 'state.canvasId', 256),
    revision: integer(state.revision, 'state.revision'),
    updatedAt: required(state.updatedAt, 'state.updatedAt', 128),
  }
}

export function validateDurableObserverEvent(value: unknown): DurableObserverWorkspaceEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('durable observer event must be an object')
  const input = value as Record<string, unknown>
  if (input.schema !== 'observer_workspace_event_v1') throw new Error('durable observer event schema mismatch')
  if (input.entityKind !== 'observer_view' && input.entityKind !== 'rendezvous') throw new Error('invalid durable observer entity kind')
  const eventType = required(input.eventType, 'eventType', 64) as DurableObserverEventType
  const allowed: DurableObserverEventType[] = [
    'view_created',
    'view_foreground_set',
    'view_lifecycle_set',
    'view_subcanvas_entered',
    'view_subcanvas_left',
    'view_nested_visibility_set',
    'view_nested_foreground_set',
    'rendezvous_opened',
    'rendezvous_invited',
    'rendezvous_joined',
    'projection_added',
    'projection_removed',
    'rendezvous_closed',
  ]
  if (!allowed.includes(eventType)) throw new Error('invalid durable observer event type')
  const state = clone(input.state) as ObserverView | RendezvousRoom
  const principal = principalRef(input.principal as AuthenticatedPrincipal)
  const command = clone(input.command) as DurableObserverCommand
  if (!command || typeof command !== 'object' || typeof command.kind !== 'string') throw new Error('durable observer command is required')
  const expectedCommandKind: Record<DurableObserverEventType, DurableObserverCommand['kind']> = {
    view_created: 'create_view',
    view_foreground_set: 'set_foreground',
    view_lifecycle_set: 'set_lifecycle',
    view_subcanvas_entered: 'enter_subcanvas',
    view_subcanvas_left: 'leave_subcanvas',
    view_nested_visibility_set: 'set_nested_visibility',
    view_nested_foreground_set: 'set_nested_foreground',
    rendezvous_opened: 'open_rendezvous',
    rendezvous_invited: 'invite',
    rendezvous_joined: 'join',
    projection_added: 'project_portal',
    projection_removed: 'remove_projection',
    rendezvous_closed: 'close_rendezvous',
  }
  if (command.kind !== expectedCommandKind[eventType]) throw new Error('durable observer event type does not match command')
  const viewEvent = [
    'view_created',
    'view_foreground_set',
    'view_lifecycle_set',
    'view_subcanvas_entered',
    'view_subcanvas_left',
    'view_nested_visibility_set',
    'view_nested_foreground_set',
  ].includes(eventType)
  if ((input.entityKind === 'observer_view') !== viewEvent) throw new Error('durable observer entity kind does not match event type')
  const event: DurableObserverWorkspaceEvent = {
    schema: 'observer_workspace_event_v1',
    eventId: required(input.eventId, 'eventId'),
    eventType,
    entityKind: input.entityKind,
    entityId: required(input.entityId, 'entityId', 256),
    worldId: required(input.worldId, 'worldId', 256),
    canvasId: required(input.canvasId, 'canvasId', 256),
    principal,
    revision: integer(input.revision, 'revision'),
    command,
    state,
    createdAt: required(input.createdAt, 'createdAt', 128),
  }
  const identity = eventStateIdentity(event)
  if (identity.entityId !== event.entityId || identity.worldId !== event.worldId || identity.canvasId !== event.canvasId) {
    throw new Error('durable observer event identity does not match resulting state')
  }
  if (identity.revision !== event.revision) throw new Error('durable observer event revision does not match resulting state')
  if (identity.updatedAt !== event.createdAt) throw new Error('durable observer event timestamp does not match resulting state')
  return event
}

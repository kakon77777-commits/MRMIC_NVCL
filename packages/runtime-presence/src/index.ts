import type { AuthenticatedPrincipal } from '../../identity-auth/src/index.js'

export interface RuntimePresenceCoordinates {
  workspaceId?: string
  tabId?: string
  paneId?: string
}

export interface RuntimePresenceInput {
  provider: string
  providerResourceId: string
  runtimeEpochId: string
  status: string
  revision: number
  sequence: number
  kind?: string
  focused?: boolean
  interactiveReady?: boolean
  launchPending?: boolean
  coordinates?: RuntimePresenceCoordinates
}

export interface RuntimePresenceState extends RuntimePresenceInput {
  clientId: string
  principalId: string
  semanticAgentId?: string
  identityStatus: 'verified'
  updatedAt: string
}

export interface RuntimePresenceApplyResult {
  accepted: boolean
  state: RuntimePresenceState
  reason?: 'stale_revision' | 'stale_sequence'
}

function boundedString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return text
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || Number(value) < 0) throw new Error(`${label} must be a non-negative integer`)
  return Number(value)
}

function optionalBoundedString(value: unknown, label: string, max: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  return boundedString(value, label, max)
}

/**
 * Runtime presence is intentionally small and non-canonical. Only provider
 * runtime coordinates/status required by the shared visual world are allowed.
 * Caller-supplied principal/semantic identity fields are ignored by design.
 */
export function sanitizeRuntimePresenceInput(value: RuntimePresenceInput | Record<string, unknown>): RuntimePresenceInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('runtime presence must be an object')
  const input = value as Record<string, unknown>
  const provider = boundedString(input.provider, 'provider', 64)
  const providerResourceId = boundedString(input.providerResourceId, 'providerResourceId', 256)
  const runtimeEpochId = boundedString(input.runtimeEpochId, 'runtimeEpochId', 256)
  const status = boundedString(input.status, 'status', 64)
  const revision = nonNegativeInteger(input.revision, 'revision')
  const sequence = nonNegativeInteger(input.sequence, 'sequence')
  const kind = optionalBoundedString(input.kind, 'kind', 64)
  const coordinatesInput = input.coordinates && typeof input.coordinates === 'object' && !Array.isArray(input.coordinates)
    ? input.coordinates as Record<string, unknown>
    : undefined
  const coordinates: RuntimePresenceCoordinates | undefined = coordinatesInput ? {
    ...(optionalBoundedString(coordinatesInput.workspaceId, 'coordinates.workspaceId', 256) ? { workspaceId: optionalBoundedString(coordinatesInput.workspaceId, 'coordinates.workspaceId', 256) } : {}),
    ...(optionalBoundedString(coordinatesInput.tabId, 'coordinates.tabId', 256) ? { tabId: optionalBoundedString(coordinatesInput.tabId, 'coordinates.tabId', 256) } : {}),
    ...(optionalBoundedString(coordinatesInput.paneId, 'coordinates.paneId', 256) ? { paneId: optionalBoundedString(coordinatesInput.paneId, 'coordinates.paneId', 256) } : {}),
  } : undefined

  return {
    provider,
    providerResourceId,
    runtimeEpochId,
    status,
    revision,
    sequence,
    ...(kind ? { kind } : {}),
    ...(typeof input.focused === 'boolean' ? { focused: input.focused } : {}),
    ...(typeof input.interactiveReady === 'boolean' ? { interactiveReady: input.interactiveReady } : {}),
    ...(typeof input.launchPending === 'boolean' ? { launchPending: input.launchPending } : {}),
    ...(coordinates && Object.keys(coordinates).length ? { coordinates } : {}),
  }
}

function resourceKey(principalId: string, input: RuntimePresenceInput): string {
  return `${principalId}\u0000${input.provider}\u0000${input.providerResourceId}`
}

/**
 * Ephemeral authenticated runtime-state registry.
 *
 * The registry has no persistence API. A process restart intentionally drops
 * all entries. Within one runtime epoch, revision/sequence are monotonic; a new
 * epoch can restart counters after provider restart or live handoff.
 */
export class RuntimePresenceRegistry {
  readonly #byResource = new Map<string, RuntimePresenceState>()

  snapshot(): RuntimePresenceState[] {
    return [...this.#byResource.values()].map(value => structuredClone(value))
  }

  apply(
    value: RuntimePresenceInput | Record<string, unknown>,
    principal: AuthenticatedPrincipal,
    clientId: string,
  ): RuntimePresenceApplyResult {
    if (!clientId.trim()) throw new Error('runtime presence clientId is required')
    if (principal.role === 'viewer') throw new Error('viewer principal cannot publish runtime presence')
    const input = sanitizeRuntimePresenceInput(value)
    const key = resourceKey(principal.principalId, input)
    const current = this.#byResource.get(key)
    if (current && current.runtimeEpochId === input.runtimeEpochId) {
      if (input.revision < current.revision) {
        return { accepted: false, state: structuredClone(current), reason: 'stale_revision' }
      }
      if (input.revision === current.revision && input.sequence < current.sequence) {
        return { accepted: false, state: structuredClone(current), reason: 'stale_sequence' }
      }
    }
    const state: RuntimePresenceState = {
      ...structuredClone(input),
      clientId: clientId.trim(),
      principalId: principal.principalId,
      ...(principal.semanticAgentId ? { semanticAgentId: principal.semanticAgentId } : {}),
      identityStatus: 'verified',
      updatedAt: new Date().toISOString(),
    }
    this.#byResource.set(key, structuredClone(state))
    return { accepted: true, state: structuredClone(state) }
  }

  removeClient(clientId: string): RuntimePresenceState[] {
    const removed: RuntimePresenceState[] = []
    for (const [key, value] of this.#byResource) {
      if (value.clientId !== clientId) continue
      removed.push(structuredClone(value))
      this.#byResource.delete(key)
    }
    return removed
  }

  removeResource(principalId: string, provider: string, providerResourceId: string): RuntimePresenceState | null {
    const key = `${principalId}\u0000${provider}\u0000${providerResourceId}`
    const value = this.#byResource.get(key)
    if (!value) return null
    this.#byResource.delete(key)
    return structuredClone(value)
  }
}

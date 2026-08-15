import { createHash } from 'node:crypto'
import type { ActorRef, ActorType } from '../../canvas-schema/src/index.js'

export type PrincipalRole = 'viewer' | 'agent-direct' | 'owner'

export interface AuthenticatedPrincipal {
  principalId: string
  role: PrincipalRole
  actor: ActorRef
  semanticAgentId?: string
}

export interface PrincipalBindingInput {
  token: string
  principalId: string
  role: PrincipalRole
  actorType: ActorType
  actorId: string
  semanticAgentId?: string
}

export interface IdentityResolver {
  resolveToken(token: string): AuthenticatedPrincipal | null
}

interface HashedBinding {
  digest: string
  principal: AuthenticatedPrincipal
}

const MIN_TOKEN_LENGTH = 16

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${label} is required`)
  return value.trim()
}

function normalizeRole(value: unknown): PrincipalRole {
  if (value === 'viewer' || value === 'agent-direct' || value === 'owner') return value
  throw new Error('role must be viewer, agent-direct or owner')
}

function normalizeActorType(value: unknown): ActorType {
  if (value === 'user' || value === 'agent' || value === 'system') return value
  throw new Error('actorType must be user, agent or system')
}

function digestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false
  let mismatch = 0
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return mismatch === 0
}

function clonePrincipal(principal: AuthenticatedPrincipal): AuthenticatedPrincipal {
  return {
    principalId: principal.principalId,
    role: principal.role,
    actor: structuredClone(principal.actor),
    ...(principal.semanticAgentId ? { semanticAgentId: principal.semanticAgentId } : {}),
  }
}

export class StaticBearerIdentityResolver implements IdentityResolver {
  readonly #bindings: HashedBinding[]

  constructor(bindings: PrincipalBindingInput[]) {
    if (!Array.isArray(bindings) || bindings.length === 0) throw new Error('at least one principal binding is required')
    const principalIds = new Set<string>()
    this.#bindings = bindings.map((binding, index) => {
      const token = nonEmpty(binding.token, `bindings[${index}].token`)
      if (token.length < MIN_TOKEN_LENGTH) throw new Error(`bindings[${index}].token must be at least ${MIN_TOKEN_LENGTH} characters`)
      const principalId = nonEmpty(binding.principalId, `bindings[${index}].principalId`)
      if (principalIds.has(principalId)) throw new Error(`duplicate principalId: ${principalId}`)
      principalIds.add(principalId)
      const actorId = nonEmpty(binding.actorId, `bindings[${index}].actorId`)
      const semanticAgentId = typeof binding.semanticAgentId === 'string' && binding.semanticAgentId.trim()
        ? binding.semanticAgentId.trim()
        : undefined
      return {
        digest: digestToken(token),
        principal: {
          principalId,
          role: normalizeRole(binding.role),
          actor: { actorType: normalizeActorType(binding.actorType), actorId },
          ...(semanticAgentId ? { semanticAgentId } : {}),
        },
      }
    })
  }

  resolveToken(token: string): AuthenticatedPrincipal | null {
    if (typeof token !== 'string' || token.length < MIN_TOKEN_LENGTH) return null
    const digest = digestToken(token)
    for (const binding of this.#bindings) {
      if (sameDigest(binding.digest, digest)) return clonePrincipal(binding.principal)
    }
    return null
  }
}

export function bearerTokenFromAuthorization(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < 8 || trimmed.slice(0, 7).toLowerCase() !== 'bearer ') return null
  const token = trimmed.slice(7).trim()
  return token.length ? token : null
}

export function parsePrincipalBindings(value: string): PrincipalBindingInput[] {
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('MRMIC_PMW_BINDINGS_JSON must be a non-empty JSON array')
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`bindings[${index}] must be an object`)
    const item = entry as Record<string, unknown>
    return {
      token: nonEmpty(item.token, `bindings[${index}].token`),
      principalId: nonEmpty(item.principalId, `bindings[${index}].principalId`),
      role: normalizeRole(item.role),
      actorType: normalizeActorType(item.actorType),
      actorId: nonEmpty(item.actorId, `bindings[${index}].actorId`),
      ...(typeof item.semanticAgentId === 'string' && item.semanticAgentId.trim()
        ? { semanticAgentId: item.semanticAgentId.trim() }
        : {}),
    }
  })
}

export function createIdentityResolverFromEnv(env: Record<string, string | undefined> = process.env): IdentityResolver | undefined {
  const source = env.MRMIC_PMW_BINDINGS_JSON
  if (!source || !source.trim()) return undefined
  return new StaticBearerIdentityResolver(parsePrincipalBindings(source))
}

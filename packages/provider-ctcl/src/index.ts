import type { ActorRef, CanvasObject, Transform2D } from '../../canvas-schema/src/index.js'
import { validateCanvasObject } from '../../canvas-schema/src/index.js'

export interface CtclInstantRecord {
  id: string
  unix_ns: string
  reference_timescale: string
  registered_at: string
  label?: string | null
  meta?: unknown
  from_wall_clock?: boolean
  signature?: unknown
  retrieve?: string
  share?: string
  encodings?: Record<string, string>
  timescales?: Record<string, string>
}

export interface CtclOkEnvelope<T> {
  ok: true
  data: T
  meta?: Record<string, unknown>
}

export interface RegisterCtclInstantInput {
  value?: string | number
  encoding?: string
  timescale?: string
  label?: string
  meta?: Record<string, unknown>
}

export interface CtclTemporalReference {
  provider: 'ctcl'
  instantId: string
  resourceUri: string
  unixNs: string
  referenceTimescale: string
  registeredAt: string
  signature?: unknown
  retrieve?: string
  share?: string
  context: {
    eventId: string
    pmwWorkspaceId: string
    pmwTaskId?: string
    actorSemanticId?: string
    provider?: string
    providerResourceId?: string
    operation?: string
  }
}

export type CtclFetch = (input: string, init?: RequestInit) => Promise<Response>

function required(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function normalizedBaseUrl(value: string): string {
  const url = required(value, 'CTCL baseUrl').replace(/\/+$/, '')
  new URL(url)
  return url
}

function assertInstant(record: CtclInstantRecord): void {
  const id = required(record.id, 'CTCL instant id')
  if (!id.startsWith('ctcl:instant:')) throw new Error('CTCL instant id must start with ctcl:instant:')
  const unixNs = required(record.unix_ns, 'CTCL unix_ns')
  if (!/^-?\d+$/.test(unixNs)) throw new Error('CTCL unix_ns must be an integer string')
  required(record.reference_timescale, 'CTCL reference_timescale')
  const registeredAt = required(record.registered_at, 'CTCL registered_at')
  if (Number.isNaN(Date.parse(registeredAt))) throw new Error('CTCL registered_at must be a valid date-time')
}

function ctclResourceUri(id: string): string {
  return `ctcl://instant/${encodeURIComponent(id)}`
}

function parseEnvelope(value: unknown): CtclOkEnvelope<CtclInstantRecord> {
  const envelope = value as any
  if (!envelope || envelope.ok !== true || !envelope.data) {
    throw new Error(`CTCL request failed: ${envelope?.error?.code ?? envelope?.error?.message ?? 'invalid response'}`)
  }
  assertInstant(envelope.data as CtclInstantRecord)
  return envelope as CtclOkEnvelope<CtclInstantRecord>
}

/** Minimal client for CTCL's registered-instant temporal alignment API. */
export class CtclClient {
  readonly #baseUrl: string
  readonly #fetch: CtclFetch

  constructor(baseUrl: string, fetchImpl: CtclFetch = fetch) {
    this.#baseUrl = normalizedBaseUrl(baseUrl)
    this.#fetch = fetchImpl
  }

  async registerInstant(input: RegisterCtclInstantInput = {}): Promise<CtclInstantRecord> {
    const response = await this.#fetch(`${this.#baseUrl}/v1/instants`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', accept: 'application/json' },
      body: JSON.stringify(input),
    })
    const body = await response.json()
    if (!response.ok) throw new Error(`CTCL registerInstant HTTP ${response.status}`)
    return structuredClone(parseEnvelope(body).data)
  }

  async getInstant(id: string): Promise<CtclInstantRecord> {
    const instantId = required(id, 'instant id')
    const response = await this.#fetch(`${this.#baseUrl}/v1/instant/${encodeURIComponent(instantId)}`, {
      headers: { accept: 'application/json' },
    })
    const body = await response.json()
    if (!response.ok) throw new Error(`CTCL getInstant HTTP ${response.status}`)
    return structuredClone(parseEnvelope(body).data)
  }
}

export interface CtclProvenanceContext {
  eventId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  actorSemanticId?: string
  provider?: string
  providerResourceId?: string
  operation?: string
}

/**
 * Link a PMW event to a CTCL registered instant. CTCL is the temporal
 * coordinate/proof reference; it is not used as the event ledger itself.
 */
export function createCtclTemporalReference(
  record: CtclInstantRecord,
  context: CtclProvenanceContext,
): CtclTemporalReference {
  assertInstant(record)
  const eventId = required(context.eventId, 'eventId')
  const pmwWorkspaceId = required(context.pmwWorkspaceId, 'pmwWorkspaceId')
  return {
    provider: 'ctcl',
    instantId: record.id,
    resourceUri: ctclResourceUri(record.id),
    unixNs: record.unix_ns,
    referenceTimescale: record.reference_timescale,
    registeredAt: record.registered_at,
    ...(record.signature !== undefined ? { signature: structuredClone(record.signature) } : {}),
    ...(record.retrieve ? { retrieve: record.retrieve } : {}),
    ...(record.share ? { share: record.share } : {}),
    context: {
      eventId,
      pmwWorkspaceId,
      ...(context.pmwTaskId ? { pmwTaskId: context.pmwTaskId } : {}),
      ...(context.actorSemanticId ? { actorSemanticId: context.actorSemanticId } : {}),
      ...(context.provider ? { provider: context.provider } : {}),
      ...(context.providerResourceId ? { providerResourceId: context.providerResourceId } : {}),
      ...(context.operation ? { operation: context.operation } : {}),
    },
  }
}

export interface CreateCtclInstantPortalInput {
  record: CtclInstantRecord
  portalId: string
  canvasId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  actor: ActorRef
  transform?: Partial<Transform2D>
  createdAt?: string
}

/**
 * Optional visual projection of a CTCL shared instant.
 *
 * CTCL is primarily a temporal/provenance provider, not a general visual
 * resource family, so the canonical Canvas kind remains `external_generic`.
 * The provider-specific subtype is retained in providerRef.kind.
 */
export function createCtclInstantPortal(input: CreateCtclInstantPortalInput): CanvasObject {
  assertInstant(input.record)
  const portalId = required(input.portalId, 'portalId')
  const canvasId = required(input.canvasId, 'canvasId')
  const pmwWorkspaceId = required(input.pmwWorkspaceId, 'pmwWorkspaceId')
  const timestamp = input.createdAt ?? new Date().toISOString()
  const transform: Transform2D = {
    x: input.transform?.x ?? 0,
    y: input.transform?.y ?? 0,
    width: input.transform?.width ?? 420,
    height: input.transform?.height ?? 160,
    rotation: input.transform?.rotation ?? 0,
    scaleX: input.transform?.scaleX ?? 1,
    scaleY: input.transform?.scaleY ?? 1,
    zIndex: input.transform?.zIndex ?? 1,
  }
  const text = input.record.label?.trim()
    || input.record.encodings?.rfc3339
    || input.record.registered_at
  const object: CanvasObject = {
    id: `portal:${portalId}`,
    canvasId,
    type: 'resource_portal',
    transform,
    style: { fill: '#f8fafc', stroke: '#0f766e', strokeWidth: 2, opacity: 1 },
    content: {
      text,
      resourceUri: ctclResourceUri(input.record.id),
      ...(input.record.share ? { previewUri: input.record.share } : {}),
    },
    childIds: [],
    bindings: [],
    metadata: {
      portal: {
        portalId,
        pmwWorkspaceId,
        ...(input.pmwTaskId ? { pmwTaskId: input.pmwTaskId } : {}),
        provider: 'ctcl',
        resourceKind: 'external_generic',
        providerResourceId: input.record.id,
        displayMode: 'summary',
        interactionMode: 'inspect',
      },
      providerRef: {
        kind: 'ctcl_instant',
        resourceUri: ctclResourceUri(input.record.id),
        unixNs: input.record.unix_ns,
        referenceTimescale: input.record.reference_timescale,
        registeredAt: input.record.registered_at,
        ...(input.record.retrieve ? { retrieve: input.record.retrieve } : {}),
        ...(input.record.share ? { share: input.record.share } : {}),
        ...(input.record.signature !== undefined ? { signature: structuredClone(input.record.signature) } : {}),
      },
    },
    createdBy: structuredClone(input.actor),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
  validateCanvasObject(object)
  return object
}

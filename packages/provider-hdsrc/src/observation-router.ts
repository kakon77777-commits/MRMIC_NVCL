import {
  HdsrcProviderError,
  type HdsrcAccessContext,
  type HdsrcMaterializationDecisionV1,
  type HdsrcMaterializationRequestV1,
  type HdsrcMaterializationV1,
  type HdsrcObservationMode,
  type HdsrcResourcePayload,
} from './index.js'
import type {
  HdsrcPartialRelationBlockRow,
  ResolvedHdsrcMaterialization,
} from './local-process.js'
import type { HdsrcRuntimeManagerStatus } from './runtime-manager.js'

export interface HdsrcObservationIntentV1 {
  schema: 'hdsrc-observation-intent/v1'
  stateRef: string
  goalClass: string
  observationMode: HdsrcObservationMode
  queryDirection?: 'outgoing' | 'incoming' | 'block' | 'mixed'
  expectedSpan?: number
  expectedReuse?: number
  latencyClass?: 'interactive' | 'batch'
  partialRelationBlockRow?: number
}

interface HdsrcObservationRuntime {
  status(): HdsrcRuntimeManagerStatus
  materializeResolved(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<ResolvedHdsrcMaterialization>
  readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload>
  readPartialRelationBlockRow(
    ref: string,
    blockRow: number,
    context: HdsrcAccessContext,
  ): Promise<HdsrcPartialRelationBlockRow>
}

interface RoutingEvidence {
  runtimeEpoch: number
  decision: HdsrcMaterializationDecisionV1
  oracleUsed: boolean
}

export type HdsrcRoutedObservation =
  | (RoutingEvidence & {
      mode: 'human_preview'
      resource: HdsrcResourcePayload
    })
  | (RoutingEvidence & {
      mode: 'structured_manifest'
      materialization: HdsrcMaterializationV1
    })
  | (RoutingEvidence & {
      mode: 'machine_carrier'
      resource: HdsrcResourcePayload
    })
  | (RoutingEvidence & {
      mode: 'partial_relation_block_row'
      partial: HdsrcPartialRelationBlockRow
    })

const INTENT_KEYS = new Set([
  'schema',
  'stateRef',
  'goalClass',
  'observationMode',
  'queryDirection',
  'expectedSpan',
  'expectedReuse',
  'latencyClass',
  'partialRelationBlockRow',
])

const MODES = new Set<HdsrcObservationMode>([
  'human_preview',
  'machine_carrier',
  'structured_manifest',
])
const DIRECTIONS = new Set(['outgoing', 'incoming', 'block', 'mixed'])
const LATENCY = new Set(['interactive', 'batch'])

export function assertHdsrcObservationIntent(value: unknown): HdsrcObservationIntentV1 {
  const input = record(value, 'HDSRC observation intent')
  for (const key of Object.keys(input)) {
    if (!INTENT_KEYS.has(key)) invalid(`unsupported HDSRC observation intent field ${key}`)
  }
  if (input.schema !== 'hdsrc-observation-intent/v1') invalid('HDSRC observation intent schema is invalid')

  const stateRef = text(input.stateRef, 'stateRef')
  if (!/^hdsrc:\/\/state\/.+/.test(stateRef)) invalid('stateRef must be an hdsrc://state/... URI')

  const observationMode = text(input.observationMode, 'observationMode') as HdsrcObservationMode
  if (!MODES.has(observationMode)) invalid(`unsupported HDSRC observation mode ${observationMode}`)

  const queryDirection = input.queryDirection === undefined
    ? undefined
    : enumText(input.queryDirection, 'queryDirection', DIRECTIONS) as HdsrcObservationIntentV1['queryDirection']
  const latencyClass = input.latencyClass === undefined
    ? undefined
    : enumText(input.latencyClass, 'latencyClass', LATENCY) as HdsrcObservationIntentV1['latencyClass']
  const expectedSpan = input.expectedSpan === undefined
    ? undefined
    : positiveInteger(input.expectedSpan, 'expectedSpan')
  const expectedReuse = input.expectedReuse === undefined
    ? undefined
    : positiveInteger(input.expectedReuse, 'expectedReuse')
  const partialRelationBlockRow = input.partialRelationBlockRow === undefined
    ? undefined
    : nonnegativeInteger(input.partialRelationBlockRow, 'partialRelationBlockRow')

  if (partialRelationBlockRow !== undefined
    && (observationMode !== 'machine_carrier' || queryDirection !== 'block')) {
    invalid('partialRelationBlockRow requires machine_carrier observation with block queryDirection')
  }

  return {
    schema: 'hdsrc-observation-intent/v1',
    stateRef,
    goalClass: text(input.goalClass, 'goalClass'),
    observationMode,
    ...(queryDirection ? { queryDirection } : {}),
    ...(expectedSpan !== undefined ? { expectedSpan } : {}),
    ...(expectedReuse !== undefined ? { expectedReuse } : {}),
    ...(latencyClass ? { latencyClass } : {}),
    ...(partialRelationBlockRow !== undefined ? { partialRelationBlockRow } : {}),
  }
}

export function intentToMaterializationRequest(
  intent: HdsrcObservationIntentV1,
): HdsrcMaterializationRequestV1 {
  const checked = assertHdsrcObservationIntent(intent)
  return {
    schema: 'hdsrc-materialization-request/v1',
    stateRef: checked.stateRef,
    workload: {
      schema: 'hdsrc-workload-hint/v1',
      goalClass: checked.goalClass,
      observationMode: checked.observationMode,
      ...(checked.queryDirection ? { queryDirection: checked.queryDirection } : {}),
      ...(checked.expectedSpan !== undefined ? { expectedSpan: checked.expectedSpan } : {}),
      ...(checked.expectedReuse !== undefined ? { expectedReuse: checked.expectedReuse } : {}),
      ...(checked.latencyClass ? { latencyClass: checked.latencyClass } : {}),
    },
  }
}

export async function routeHdsrcObservation(
  intentValue: unknown,
  context: HdsrcAccessContext,
  manager: HdsrcObservationRuntime,
): Promise<HdsrcRoutedObservation> {
  const intent = assertHdsrcObservationIntent(intentValue)
  preauthorizeObservation(intent.observationMode, context)
  const request = intentToMaterializationRequest(intent)
  const resolved = await manager.materializeResolved(request, context)
  const status = manager.status()
  const runtimeEpoch = positiveRuntimeEpoch(status.runtimeEpoch)
  const evidence: RoutingEvidence = {
    runtimeEpoch,
    decision: structuredClone(resolved.decision),
    oracleUsed: resolved.oracleUsed,
  }

  if ((resolved.decision.decision === 'oracle_fallback') !== resolved.oracleUsed) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC routing oracle evidence is inconsistent')
  }

  if (intent.observationMode === 'human_preview') {
    const resource = await manager.readResource(resolved.materialization.previewResourceUri, context)
    if (resource.uri !== resolved.materialization.previewResourceUri) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'human preview resource URI mismatch')
    }
    if (!resource.mimeType.startsWith('image/')) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'human preview resource must be an image')
    }
    return { mode: 'human_preview', resource: cloneResource(resource), ...evidence }
  }

  if (intent.observationMode === 'structured_manifest') {
    return {
      mode: 'structured_manifest',
      materialization: structuredClone(resolved.materialization),
      ...evidence,
    }
  }

  if (intent.partialRelationBlockRow !== undefined) {
    const partial = await manager.readPartialRelationBlockRow(
      resolved.materializationRef,
      intent.partialRelationBlockRow,
      context,
    )
    return {
      mode: 'partial_relation_block_row',
      partial: structuredClone(partial),
      ...evidence,
    }
  }

  const resource = await manager.readResource(resolved.materialization.machineResourceUri, context)
  if (resource.uri !== resolved.materialization.machineResourceUri) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'machine carrier resource URI mismatch')
  }
  if (resource.uri === resolved.materialization.previewResourceUri) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'machine carrier must not alias human preview')
  }
  return { mode: 'machine_carrier', resource: cloneResource(resource), ...evidence }
}

function preauthorizeObservation(mode: HdsrcObservationMode, context: HdsrcAccessContext): void {
  if (!context || typeof context !== 'object') {
    throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC access context is required')
  }
  if (typeof context.principalId !== 'string' || !context.principalId.trim()) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC principalId is required')
  }
  if (context.allowHdsrcRead !== true) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC read access denied')
  }
  if (mode === 'structured_manifest' && context.trustedStructured !== true) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'trusted structured HDSRC observation is not authorized')
  }
  if (mode === 'machine_carrier' && context.trustedMachine !== true) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'trusted machine-carrier HDSRC observation is not authorized')
  }
}

function cloneResource(resource: HdsrcResourcePayload): HdsrcResourcePayload {
  return {
    uri: resource.uri,
    mimeType: resource.mimeType,
    bytes: new Uint8Array(resource.bytes),
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(`${label} must be a non-empty string`)
  return value.trim()
}

function enumText(value: unknown, label: string, allowed: Set<string>): string {
  const result = text(value, label)
  if (!allowed.has(result)) invalid(`unsupported ${label} ${result}`)
  return result
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) invalid(`${label} must be a positive integer`)
  return value as number
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) invalid(`${label} must be a non-negative integer`)
  return value as number
}

function positiveRuntimeEpoch(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'runtimeEpoch must identify a started HDSRC runtime')
  }
  return value as number
}

function invalid(message: string): never {
  throw new HdsrcProviderError('INVALID_REQUEST', message)
}

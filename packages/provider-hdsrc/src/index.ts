export type HdsrcCarrierProfile =
  | 'HIC1'
  | 'SNIC1'
  | 'SFPIC1'
  | 'HDT1'
  | 'HST1'
  | 'HCT1'
  | 'HBT1'
  | 'HMBT1'

export type HdsrcObservationMode = 'human_preview' | 'machine_carrier' | 'structured_manifest'

export interface HdsrcProviderCapabilitiesV1 {
  schema: 'hdsrc-provider-capabilities/v1'
  providerVersion: string
  stateProfiles: string[]
  carrierProfiles: HdsrcCarrierProfile[]
  planningProfiles: string[]
  observationModes: HdsrcObservationMode[]
  partialRead: boolean
  oracleFallback: boolean
  canonicalMutation: false
}

export interface HdsrcStateRefV1 {
  schema: 'hdsrc-state-ref/v1'
  stateId: string
  stateRevision: number
  stateDigest: string
  dimension: number
  authority: 'hdsrc'
}

export interface HdsrcWorkloadHintV1 {
  schema: 'hdsrc-workload-hint/v1'
  goalClass: string
  observationMode: HdsrcObservationMode
  queryDirection?: 'outgoing' | 'incoming' | 'block' | 'mixed'
  expectedSpan?: number
  expectedReuse?: number
  latencyClass?: 'interactive' | 'batch'
}

export interface HdsrcMaterializationRequestV1 {
  schema: 'hdsrc-materialization-request/v1'
  stateRef: string
  workload: HdsrcWorkloadHintV1
}

export interface HdsrcMaterializationDecisionV1 {
  schema: 'hdsrc-materialization-decision/v1'
  decision: 'fast_path' | 'oracle_fallback'
  selectedCarrier?: HdsrcCarrierProfile
  logicalScale?: number
  confidence: {
    mode: 'empirical'
    requiresOracle: boolean
    reason?: string
  }
}

export interface HdsrcMaterializationV1 {
  schema: 'hdsrc-materialization/v1'
  materializationId: string
  stateId: string
  stateRevision: number
  stateDigest: string
  materializationDigest: string
  carrierProfile: HdsrcCarrierProfile
  spatializationId: string
  logicalScale: number
  workloadDigest: string
  machineResourceUri: string
  previewResourceUri: string
}

export interface HdsrcAccessContext {
  principalId: string
  allowHdsrcRead: boolean
  trustedStructured?: boolean
  trustedMachine?: boolean
}

export interface HdsrcResourcePayload {
  uri: string
  mimeType: string
  bytes: Uint8Array
}

export interface HdsrcProviderClient {
  capabilities(): Promise<HdsrcProviderCapabilitiesV1>
  state(ref: string, context: HdsrcAccessContext): Promise<HdsrcStateRefV1>
  materialize(request: HdsrcMaterializationRequestV1, context: HdsrcAccessContext): Promise<HdsrcMaterializationDecisionV1>
  materialization(ref: string, context: HdsrcAccessContext): Promise<HdsrcMaterializationV1>
  readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload>
}

export type HdsrcProviderErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHORIZED'
  | 'RESOURCE_NOT_FOUND'
  | 'UNSUPPORTED_PROFILE'
  | 'STALE_STATE'
  | 'INTEGRITY_FAILURE'
  | 'MATERIALIZATION_FAILED'
  | 'ORACLE_REQUIRED'
  | 'ORACLE_FAILED'
  | 'PROVIDER_UNAVAILABLE'

export class HdsrcProviderError extends Error {
  readonly code: HdsrcProviderErrorCode
  readonly retryable: boolean

  constructor(code: HdsrcProviderErrorCode, message: string, retryable = false) {
    super(message)
    this.name = 'HdsrcProviderError'
    this.code = code
    this.retryable = retryable
  }
}

const CARRIERS = new Set<HdsrcCarrierProfile>(['HIC1', 'SNIC1', 'SFPIC1', 'HDT1', 'HST1', 'HCT1', 'HBT1', 'HMBT1'])
const OBSERVATION_MODES = new Set<HdsrcObservationMode>(['human_preview', 'machine_carrier', 'structured_manifest'])
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/i

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value.trim()
}

function nonnegativeInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) throw new Error(`${label} must be a non-negative integer`)
  return value as number
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive integer`)
  return value as number
}

function digest(value: unknown, label: string): string {
  const result = text(value, label)
  if (!DIGEST_RE.test(result)) throw new Error(`${label} must be a sha256 digest`)
  return result
}

function hdsrcUri(value: unknown, label: string): string {
  const result = text(value, label)
  if (!result.startsWith('hdsrc://')) throw new Error(`${label} must be an hdsrc:// URI`)
  return result
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${label} must be a non-empty array`)
  const result = value.map((item, index) => text(item, `${label}[${index}]`))
  if (new Set(result).size !== result.length) throw new Error(`${label} must contain unique values`)
  return result
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
  return value
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

export function assertHdsrcCapabilities(value: unknown): HdsrcProviderCapabilitiesV1 {
  const input = record(value, 'HDSRC capabilities')
  if (input.schema !== 'hdsrc-provider-capabilities/v1') throw new Error('HDSRC capabilities schema is invalid')
  if (input.canonicalMutation !== false) throw new Error('canonicalMutation must be false for integration v0.1')
  const carrierProfiles = stringArray(input.carrierProfiles, 'carrierProfiles')
  for (const profile of carrierProfiles) if (!CARRIERS.has(profile as HdsrcCarrierProfile)) throw new Error(`unsupported carrier profile ${profile}`)
  const observationModes = stringArray(input.observationModes, 'observationModes')
  for (const mode of observationModes) if (!OBSERVATION_MODES.has(mode as HdsrcObservationMode)) throw new Error(`unsupported observation mode ${mode}`)
  const result: HdsrcProviderCapabilitiesV1 = {
    schema: 'hdsrc-provider-capabilities/v1',
    providerVersion: text(input.providerVersion, 'providerVersion'),
    stateProfiles: stringArray(input.stateProfiles, 'stateProfiles'),
    carrierProfiles: carrierProfiles as HdsrcCarrierProfile[],
    planningProfiles: Array.isArray(input.planningProfiles) ? input.planningProfiles.map((item, index) => text(item, `planningProfiles[${index}]`)) : [],
    observationModes: observationModes as HdsrcObservationMode[],
    partialRead: boolean(input.partialRead, 'partialRead'),
    oracleFallback: boolean(input.oracleFallback, 'oracleFallback'),
    canonicalMutation: false,
  }
  return result
}

export function assertHdsrcStateRef(value: unknown): HdsrcStateRefV1 {
  const input = record(value, 'HDSRC state reference')
  if (input.schema !== 'hdsrc-state-ref/v1') throw new Error('HDSRC state reference schema is invalid')
  if (input.authority !== 'hdsrc') throw new Error('authority must be hdsrc')
  return {
    schema: 'hdsrc-state-ref/v1',
    stateId: text(input.stateId, 'stateId'),
    stateRevision: nonnegativeInteger(input.stateRevision, 'stateRevision'),
    stateDigest: digest(input.stateDigest, 'stateDigest'),
    dimension: positiveInteger(input.dimension, 'dimension'),
    authority: 'hdsrc',
  }
}

export function assertHdsrcMaterialization(value: unknown): HdsrcMaterializationV1 {
  const input = record(value, 'HDSRC materialization')
  if (input.schema !== 'hdsrc-materialization/v1') throw new Error('HDSRC materialization schema is invalid')
  const carrierProfile = text(input.carrierProfile, 'carrierProfile') as HdsrcCarrierProfile
  if (!CARRIERS.has(carrierProfile)) throw new Error(`unsupported carrier profile ${carrierProfile}`)
  const machineResourceUri = hdsrcUri(input.machineResourceUri, 'machineResourceUri')
  const previewResourceUri = hdsrcUri(input.previewResourceUri, 'previewResourceUri')
  if (machineResourceUri === previewResourceUri) throw new Error('machineResourceUri and previewResourceUri must be distinct')
  return {
    schema: 'hdsrc-materialization/v1',
    materializationId: text(input.materializationId, 'materializationId'),
    stateId: text(input.stateId, 'stateId'),
    stateRevision: nonnegativeInteger(input.stateRevision, 'stateRevision'),
    stateDigest: digest(input.stateDigest, 'stateDigest'),
    materializationDigest: digest(input.materializationDigest, 'materializationDigest'),
    carrierProfile,
    spatializationId: text(input.spatializationId, 'spatializationId'),
    logicalScale: positiveInteger(input.logicalScale, 'logicalScale'),
    workloadDigest: digest(input.workloadDigest, 'workloadDigest'),
    machineResourceUri,
    previewResourceUri,
  }
}

export function assertMaterializationFresh(state: HdsrcStateRefV1, materialization: HdsrcMaterializationV1): void {
  if (state.stateId !== materialization.stateId) throw new HdsrcProviderError('STALE_STATE', 'state identity mismatch', true)
  if (state.stateRevision !== materialization.stateRevision) throw new HdsrcProviderError('STALE_STATE', 'state revision mismatch', true)
  if (state.stateDigest !== materialization.stateDigest) throw new HdsrcProviderError('INTEGRITY_FAILURE', 'state digest mismatch')
}

function authorize(context: HdsrcAccessContext): void {
  text(context?.principalId, 'principalId')
  if (context.allowHdsrcRead !== true) throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC read access denied')
}

const DEMO_STATE: HdsrcStateRefV1 = Object.freeze({
  schema: 'hdsrc-state-ref/v1',
  stateId: 'state:demo-4096',
  stateRevision: 12,
  stateDigest: `sha256:${'a'.repeat(64)}`,
  dimension: 4096,
  authority: 'hdsrc',
})

const DEMO_MATERIALIZATION: HdsrcMaterializationV1 = Object.freeze({
  schema: 'hdsrc-materialization/v1',
  materializationId: 'mat:demo-4096-hmbt1-32',
  stateId: 'state:demo-4096',
  stateRevision: 12,
  stateDigest: `sha256:${'a'.repeat(64)}`,
  materializationDigest: `sha256:${'b'.repeat(64)}`,
  carrierProfile: 'HMBT1',
  spatializationId: 'RCM_PP',
  logicalScale: 32,
  workloadDigest: `sha256:${'c'.repeat(64)}`,
  machineResourceUri: 'hdsrc://state/state:demo-4096/materializations/mat:demo-4096-hmbt1-32/machine',
  previewResourceUri: 'hdsrc://state/state:demo-4096/materializations/mat:demo-4096-hmbt1-32/preview',
})

const DEMO_CAPABILITIES: HdsrcProviderCapabilitiesV1 = Object.freeze({
  schema: 'hdsrc-provider-capabilities/v1',
  providerVersion: '0.10',
  stateProfiles: ['HDSRC-SymbolicState'],
  carrierProfiles: ['HIC1', 'SNIC1', 'SFPIC1', 'HDT1', 'HST1', 'HCT1', 'HBT1', 'HMBT1'],
  planningProfiles: ['HRT1', 'HMSP1', 'HMR1', 'HPCM1', 'HPCM2'],
  observationModes: ['human_preview', 'machine_carrier', 'structured_manifest'],
  partialRead: true,
  oracleFallback: true,
  canonicalMutation: false,
}) as HdsrcProviderCapabilitiesV1

export class DeterministicFakeHdsrcProvider implements HdsrcProviderClient {
  async capabilities(): Promise<HdsrcProviderCapabilitiesV1> {
    return clone(DEMO_CAPABILITIES)
  }

  async state(ref: string, context: HdsrcAccessContext): Promise<HdsrcStateRefV1> {
    authorize(context)
    if (ref !== 'hdsrc://state/state:demo-4096') throw new HdsrcProviderError('RESOURCE_NOT_FOUND', `HDSRC state ${ref} not found`)
    return clone(DEMO_STATE)
  }

  async materialize(request: HdsrcMaterializationRequestV1, context: HdsrcAccessContext): Promise<HdsrcMaterializationDecisionV1> {
    authorize(context)
    if (!request || request.schema !== 'hdsrc-materialization-request/v1') throw new HdsrcProviderError('INVALID_REQUEST', 'materialization request schema is invalid')
    await this.state(request.stateRef, context)
    if (!request.workload || request.workload.schema !== 'hdsrc-workload-hint/v1') throw new HdsrcProviderError('INVALID_REQUEST', 'workload schema is invalid')
    if (request.workload.goalClass === 'uncertain_probe') {
      return {
        schema: 'hdsrc-materialization-decision/v1',
        decision: 'oracle_fallback',
        confidence: { mode: 'empirical', requiresOracle: true, reason: 'outside_current_trust_region' },
      }
    }
    return {
      schema: 'hdsrc-materialization-decision/v1',
      decision: 'fast_path',
      selectedCarrier: 'HMBT1',
      logicalScale: 32,
      confidence: { mode: 'empirical', requiresOracle: false },
    }
  }

  async materialization(ref: string, context: HdsrcAccessContext): Promise<HdsrcMaterializationV1> {
    authorize(context)
    const expected = 'hdsrc://state/state:demo-4096/materializations/mat:demo-4096-hmbt1-32'
    if (ref !== expected) throw new HdsrcProviderError('RESOURCE_NOT_FOUND', `HDSRC materialization ${ref} not found`)
    return clone(DEMO_MATERIALIZATION)
  }

  async readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload> {
    authorize(context)
    if (uri === DEMO_MATERIALIZATION.previewResourceUri) {
      return { uri, mimeType: 'image/png', bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) }
    }
    if (uri === DEMO_MATERIALIZATION.machineResourceUri) {
      return { uri, mimeType: 'application/x-hdsrc-hmbt1', bytes: new TextEncoder().encode('HMBT1_DEMO_4096') }
    }
    throw new HdsrcProviderError('RESOURCE_NOT_FOUND', `HDSRC resource ${uri} not found`)
  }
}

import {
  assertHdsrcCapabilities,
  assertHdsrcMaterialization,
  assertHdsrcStateRef,
  HdsrcProviderError,
  type HdsrcAccessContext,
  type HdsrcMaterializationDecisionV1,
  type HdsrcMaterializationRequestV1,
  type HdsrcMaterializationV1,
  type HdsrcProviderCapabilitiesV1,
  type HdsrcProviderClient,
  type HdsrcProviderErrorCode,
  type HdsrcResourcePayload,
  type HdsrcStateRefV1,
} from './index.js'
import {
  HdsrcJsonlProcessClient,
  HdsrcProcessRemoteError,
  HDSRC_PROCESS_PROTOCOL,
  type HdsrcJsonlProcessClientOptions,
} from './process-client.js'

const KNOWN_ERROR_CODES = new Set<HdsrcProviderErrorCode>([
  'INVALID_REQUEST',
  'UNAUTHORIZED',
  'RESOURCE_NOT_FOUND',
  'UNSUPPORTED_PROFILE',
  'STALE_STATE',
  'INTEGRITY_FAILURE',
  'MATERIALIZATION_FAILED',
  'ORACLE_REQUIRED',
  'ORACLE_FAILED',
  'PROVIDER_UNAVAILABLE',
])

export interface LocalProcessHdsrcProviderOptions {
  executable: string
  hostScript: string
  registry: string
  profileRoot: string
  materializationRoot: string
  env?: Record<string, string | undefined>
  cwd?: string
  timeoutMs?: number
  maxResourceBytes?: number
}

export interface ResolvedHdsrcMaterialization {
  decision: HdsrcMaterializationDecisionV1
  materializationRef: string
  materialization: HdsrcMaterializationV1
  oracleUsed: boolean
}

export class LocalProcessHdsrcProvider implements HdsrcProviderClient {
  readonly #client: HdsrcJsonlProcessClient
  #ready?: Promise<void>

  constructor(options: LocalProcessHdsrcProviderOptions) {
    const args = [
      options.hostScript,
      '--registry', options.registry,
      '--profile-root', options.profileRoot,
      '--materialization-root', options.materializationRoot,
    ]
    if (options.maxResourceBytes !== undefined) {
      if (!Number.isInteger(options.maxResourceBytes) || options.maxResourceBytes <= 0) {
        throw new Error('maxResourceBytes must be a positive integer')
      }
      args.push('--max-resource-bytes', String(options.maxResourceBytes))
    }
    const clientOptions: HdsrcJsonlProcessClientOptions = {
      executable: options.executable,
      args,
      ...(options.env ? { env: options.env } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    }
    this.#client = new HdsrcJsonlProcessClient(clientOptions)
  }

  close(): void {
    this.#client.close()
  }

  async capabilities(): Promise<HdsrcProviderCapabilitiesV1> {
    return assertHdsrcCapabilities(await this.#request('capabilities', {}))
  }

  async state(ref: string, context: HdsrcAccessContext): Promise<HdsrcStateRefV1> {
    preauthorize(context)
    return assertHdsrcStateRef(await this.#request('state', {
      ref,
      principalId: context.principalId,
    }))
  }

  async materialize(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<HdsrcMaterializationDecisionV1> {
    preauthorize(context)
    return assertDecision(await this.#request('plan_materialization', {
      request: structuredClone(request),
      principalId: context.principalId,
    }))
  }

  async materializeResolved(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<ResolvedHdsrcMaterialization> {
    preauthorize(context)
    const payload = record(await this.#request('materialize', {
      request: structuredClone(request),
      principalId: context.principalId,
    }), 'resolved HDSRC materialization')
    const decision = assertDecision(payload.decision)
    const materializationRef = nonemptyText(payload.materializationRef, 'materializationRef')
    if (!materializationRef.startsWith('hdsrc://')) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'materializationRef must be an hdsrc:// URI')
    }
    const materialization = assertHdsrcMaterialization(payload.materialization)
    if (typeof payload.oracleUsed !== 'boolean') {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'oracleUsed must be a boolean')
    }
    if ((decision.decision === 'oracle_fallback') !== payload.oracleUsed) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'oracleUsed does not match HDSRC decision mode')
    }
    return { decision, materializationRef, materialization, oracleUsed: payload.oracleUsed }
  }

  async materialization(ref: string, context: HdsrcAccessContext): Promise<HdsrcMaterializationV1> {
    preauthorize(context)
    return assertHdsrcMaterialization(await this.#request('materialization', {
      ref,
      principalId: context.principalId,
    }))
  }

  async readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload> {
    preauthorize(context)
    const payload = record(await this.#request('read_resource', {
      uri,
      principalId: context.principalId,
    }), 'HDSRC resource')
    const returnedUri = nonemptyText(payload.uri, 'resource.uri')
    const mimeType = nonemptyText(payload.mimeType, 'resource.mimeType')
    const encoded = nonemptyText(payload.base64, 'resource.base64')
    if (returnedUri !== uri) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC resource URI mismatch')
    }
    return { uri: returnedUri, mimeType, bytes: decodeBase64(encoded) }
  }

  async #request(method: string, params: Record<string, unknown>): Promise<unknown> {
    try {
      await this.#ensureReady()
      return await this.#client.request(method, params)
    } catch (error) {
      throw mapProcessError(error)
    }
  }

  #ensureReady(): Promise<void> {
    if (!this.#ready) {
      this.#ready = this.#client.request('initialize', {
        client: 'mrmic-nvcl',
        version: '0.14.0',
      }).then(value => {
        const payload = record(value, 'HDSRC process initialize')
        if (payload.protocol !== HDSRC_PROCESS_PROTOCOL || payload.readOnly !== true) {
          throw new Error('HDSRC process did not initialize as the required read-only protocol')
        }
        const methods = Array.isArray(payload.methods) ? payload.methods : []
        for (const required of ['capabilities', 'state', 'plan_materialization', 'materialize', 'materialization', 'read_resource']) {
          if (!methods.includes(required)) throw new Error(`HDSRC process is missing required method ${required}`)
        }
        if (methods.some(method => typeof method === 'string' && /(write|patch|mutat|register|replace|commit)/i.test(method))) {
          throw new Error('HDSRC process exposes a forbidden canonical mutation method')
        }
      })
    }
    return this.#ready
  }
}

function preauthorize(context: HdsrcAccessContext): void {
  if (!context || typeof context !== 'object') throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC access context is required')
  nonemptyText(context.principalId, 'principalId')
  if (context.allowHdsrcRead !== true) throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC read access denied')
}

function assertDecision(value: unknown): HdsrcMaterializationDecisionV1 {
  const payload = record(value, 'HDSRC materialization decision')
  if (payload.schema !== 'hdsrc-materialization-decision/v1') {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC materialization decision schema is invalid')
  }
  const confidence = record(payload.confidence, 'decision.confidence')
  if (confidence.mode !== 'empirical' || typeof confidence.requiresOracle !== 'boolean') {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC decision confidence is invalid')
  }
  if (payload.decision === 'fast_path') {
    if (payload.selectedCarrier !== 'HMBT1' || confidence.requiresOracle !== false) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC fast-path decision is invalid')
    }
    if (!Number.isInteger(payload.logicalScale) || ![8, 16, 32, 64].includes(payload.logicalScale as number)) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC fast-path logicalScale is invalid')
    }
    return {
      schema: 'hdsrc-materialization-decision/v1',
      decision: 'fast_path',
      selectedCarrier: 'HMBT1',
      logicalScale: payload.logicalScale as number,
      confidence: { mode: 'empirical', requiresOracle: false },
    }
  }
  if (payload.decision === 'oracle_fallback') {
    if (confidence.requiresOracle !== true) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC oracle-fallback decision is invalid')
    }
    return {
      schema: 'hdsrc-materialization-decision/v1',
      decision: 'oracle_fallback',
      confidence: {
        mode: 'empirical',
        requiresOracle: true,
        ...(typeof confidence.reason === 'string' && confidence.reason.trim()
          ? { reason: confidence.reason.trim() }
          : {}),
      },
    }
  }
  throw new HdsrcProviderError('INTEGRITY_FAILURE', 'unsupported HDSRC materialization decision')
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonemptyText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', `${label} must be a non-empty string`)
  }
  return value.trim()
}

function decodeBase64(value: string): Uint8Array {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return bytes
  } catch {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC resource base64 is invalid')
  }
}

function mapProcessError(error: unknown): HdsrcProviderError {
  if (error instanceof HdsrcProviderError) return error
  if (error instanceof HdsrcProcessRemoteError) {
    const code = error.code && KNOWN_ERROR_CODES.has(error.code as HdsrcProviderErrorCode)
      ? error.code as HdsrcProviderErrorCode
      : 'PROVIDER_UNAVAILABLE'
    return new HdsrcProviderError(code, error.message, error.retryable)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new HdsrcProviderError('PROVIDER_UNAVAILABLE', message, true)
}

import {
  HdsrcProviderError,
  type HdsrcAccessContext,
  type HdsrcMaterializationDecisionV1,
  type HdsrcMaterializationRequestV1,
  type HdsrcMaterializationV1,
  type HdsrcProviderCapabilitiesV1,
  type HdsrcResourcePayload,
  type HdsrcStateRefV1,
} from './index.js'
import {
  HdsrcLocalProcessProviderError,
  LocalProcessHdsrcProvider,
  type HdsrcPartialRelationBlockRow,
  type ResolvedHdsrcMaterialization,
} from './local-process.js'
import {
  discoverHdsrcRuntime,
  type HdsrcRuntimeDescriptor,
  type HdsrcRuntimeDiscoveryOptions,
} from './runtime-discovery.js'
import { productionHdsrcProcessEnv } from './runtime-environment.js'

export type HdsrcRuntimeManagerState =
  | 'undiscovered'
  | 'discovered'
  | 'starting'
  | 'ready'
  | 'degraded'
  | 'stopped'

export interface HdsrcRuntimeManagerStatus {
  state: HdsrcRuntimeManagerState
  runtimeEpoch: number
  runtimeId?: string
  source?: HdsrcRuntimeDescriptor['source']
}

interface ManagedHdsrcProvider {
  close(): void
  capabilities(): Promise<HdsrcProviderCapabilitiesV1>
  state(ref: string, context: HdsrcAccessContext): Promise<HdsrcStateRefV1>
  materialize(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<HdsrcMaterializationDecisionV1>
  materializeResolved(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<ResolvedHdsrcMaterialization>
  materialization(ref: string, context: HdsrcAccessContext): Promise<HdsrcMaterializationV1>
  readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload>
  readPartialRelationBlockRow(
    ref: string,
    blockRow: number,
    context: HdsrcAccessContext,
  ): Promise<HdsrcPartialRelationBlockRow>
}

export interface HdsrcRuntimeManagerOptions {
  discovery: HdsrcRuntimeDiscoveryOptions
  providerFactory?: (descriptor: HdsrcRuntimeDescriptor) => ManagedHdsrcProvider
}

export class HdsrcRuntimeManager {
  readonly #discoveryOptions: HdsrcRuntimeDiscoveryOptions
  readonly #providerFactory: (descriptor: HdsrcRuntimeDescriptor) => ManagedHdsrcProvider
  #state: HdsrcRuntimeManagerState = 'undiscovered'
  #descriptor?: HdsrcRuntimeDescriptor
  #provider?: ManagedHdsrcProvider
  #discoveryPromise?: Promise<HdsrcRuntimeDescriptor>
  #startPromise?: Promise<ManagedHdsrcProvider>
  #runtimeEpoch = 0

  constructor(options: HdsrcRuntimeManagerOptions) {
    this.#discoveryOptions = { ...options.discovery }
    this.#providerFactory = options.providerFactory ?? defaultProviderFactory
  }

  status(): HdsrcRuntimeManagerStatus {
    return {
      state: this.#state,
      runtimeEpoch: this.#runtimeEpoch,
      ...(this.#descriptor
        ? { runtimeId: this.#descriptor.runtimeId, source: this.#descriptor.source }
        : {}),
    }
  }

  async discover(): Promise<HdsrcRuntimeDescriptor> {
    this.#assertNotStopped()
    if (this.#descriptor) return this.#descriptor
    if (!this.#discoveryPromise) {
      this.#discoveryPromise = discoverHdsrcRuntime(this.#discoveryOptions)
        .then(descriptor => {
          if (this.#state === 'stopped') {
            throw new HdsrcProviderError('PROVIDER_UNAVAILABLE', 'HDSRC runtime manager is stopped')
          }
          this.#descriptor = descriptor
          this.#state = 'discovered'
          return descriptor
        })
        .finally(() => {
          this.#discoveryPromise = undefined
        })
    }
    return this.#discoveryPromise
  }

  async capabilities(): Promise<HdsrcProviderCapabilitiesV1> {
    return this.#runSafe(provider => provider.capabilities())
  }

  async state(ref: string, context: HdsrcAccessContext): Promise<HdsrcStateRefV1> {
    preauthorize(context)
    return this.#runSafe(provider => provider.state(ref, context))
  }

  async planMaterialization(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<HdsrcMaterializationDecisionV1> {
    preauthorize(context)
    return this.#runSafe(provider => provider.materialize(request, context))
  }

  async materializeResolved(
    request: HdsrcMaterializationRequestV1,
    context: HdsrcAccessContext,
  ): Promise<ResolvedHdsrcMaterialization> {
    preauthorize(context)
    return this.#runUnsafe(provider => provider.materializeResolved(request, context))
  }

  async materialization(ref: string, context: HdsrcAccessContext): Promise<HdsrcMaterializationV1> {
    preauthorize(context)
    return this.#runSafe(provider => provider.materialization(ref, context))
  }

  async readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload> {
    preauthorize(context)
    return this.#runSafe(provider => provider.readResource(uri, context))
  }

  async readPartialRelationBlockRow(
    ref: string,
    blockRow: number,
    context: HdsrcAccessContext,
  ): Promise<HdsrcPartialRelationBlockRow> {
    preauthorize(context)
    return this.#runSafe(provider => provider.readPartialRelationBlockRow(ref, blockRow, context))
  }

  stop(): void {
    if (this.#state === 'stopped') return
    this.#state = 'stopped'
    const provider = this.#provider
    this.#provider = undefined
    if (provider) provider.close()
  }

  close(): void {
    this.stop()
  }

  async #providerForOperation(): Promise<ManagedHdsrcProvider> {
    this.#assertNotStopped()
    if (this.#provider && this.#state === 'ready') return this.#provider
    return this.#start()
  }

  async #start(): Promise<ManagedHdsrcProvider> {
    this.#assertNotStopped()
    if (this.#provider && this.#state === 'ready') return this.#provider
    if (this.#startPromise) return this.#startPromise

    this.#startPromise = (async () => {
      const descriptor = await this.discover()
      this.#assertNotStopped()
      this.#state = 'starting'
      const provider = this.#providerFactory(descriptor)
      try {
        await provider.capabilities()
        if (this.status().state === 'stopped') {
          provider.close()
          throw new HdsrcProviderError('PROVIDER_UNAVAILABLE', 'HDSRC runtime manager stopped during start')
        }
        this.#provider = provider
        this.#runtimeEpoch += 1
        this.#state = 'ready'
        return provider
      } catch (error) {
        provider.close()
        if (this.status().state !== 'stopped') this.#state = 'degraded'
        throw error
      }
    })()

    try {
      return await this.#startPromise
    } finally {
      this.#startPromise = undefined
    }
  }

  async #runSafe<T>(invoke: (provider: ManagedHdsrcProvider) => Promise<T>): Promise<T> {
    try {
      const provider = await this.#providerForOperation()
      return await invoke(provider)
    } catch (error) {
      const origin = failureOrigin(error)
      if (origin === 'remote_domain') throw error
      this.#degradeAndClose()
      if (origin !== 'transport') throw error

      let replacement: ManagedHdsrcProvider
      try {
        replacement = await this.#start()
      } catch (restartError) {
        if (failureOrigin(restartError) !== 'remote_domain') this.#degradeAndClose()
        throw restartError
      }

      try {
        return await invoke(replacement)
      } catch (retryError) {
        if (failureOrigin(retryError) !== 'remote_domain') this.#degradeAndClose()
        throw retryError
      }
    }
  }

  async #runUnsafe<T>(invoke: (provider: ManagedHdsrcProvider) => Promise<T>): Promise<T> {
    try {
      const provider = await this.#providerForOperation()
      return await invoke(provider)
    } catch (error) {
      if (failureOrigin(error) !== 'remote_domain') this.#degradeAndClose()
      throw error
    }
  }

  #degradeAndClose(): void {
    if (this.#state === 'stopped') return
    const provider = this.#provider
    this.#provider = undefined
    if (provider) provider.close()
    this.#state = 'degraded'
  }

  #assertNotStopped(): void {
    if (this.#state === 'stopped') {
      throw new HdsrcProviderError('PROVIDER_UNAVAILABLE', 'HDSRC runtime manager is stopped')
    }
  }
}

function defaultProviderFactory(descriptor: HdsrcRuntimeDescriptor): ManagedHdsrcProvider {
  return new LocalProcessHdsrcProvider({
    executable: descriptor.executable,
    hostScript: descriptor.hostScript,
    registry: descriptor.registry,
    profileRoot: descriptor.profileRoot,
    materializationRoot: descriptor.materializationRoot,
    env: productionHdsrcProcessEnv(),
    ...(descriptor.cwd ? { cwd: descriptor.cwd } : {}),
    ...(descriptor.timeoutMs !== undefined ? { timeoutMs: descriptor.timeoutMs } : {}),
    ...(descriptor.maxResourceBytes !== undefined
      ? { maxResourceBytes: descriptor.maxResourceBytes }
      : {}),
  })
}

function preauthorize(context: HdsrcAccessContext): void {
  if (!context || typeof context !== 'object') {
    throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC access context is required')
  }
  if (typeof context.principalId !== 'string' || !context.principalId.trim()) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC principalId is required')
  }
  if (context.allowHdsrcRead !== true) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'HDSRC read access denied')
  }
}

function failureOrigin(error: unknown): 'transport' | 'contract' | 'remote_domain' {
  if (error instanceof HdsrcLocalProcessProviderError) return error.origin
  return 'contract'
}

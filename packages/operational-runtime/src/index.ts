import { createHash } from 'node:crypto'

export const MRMIC_OPERATIONAL_COMMAND_SCHEMA = 'mrmic_operational_command_v1' as const
export const MRMIC_EFFECT_RECEIPT_SCHEMA = 'mrmic_effect_receipt_v1' as const
export const OPERATIONAL_RECEIPT_CACHE_LIMIT = 256

export type OperationalJson = null | boolean | number | string | OperationalJson[] | { [key: string]: OperationalJson }

export interface OperationalCommandEnvelope<
  TResourceRef extends Record<string, OperationalJson> = Record<string, OperationalJson>,
  TPayload extends Record<string, OperationalJson> = Record<string, OperationalJson>,
> {
  schema: typeof MRMIC_OPERATIONAL_COMMAND_SCHEMA
  commandId: string
  idempotencyKey: string
  provider: string
  effectKind: string
  principalId: string
  resourceRef: TResourceRef
  payload: TPayload
}

export interface OperationalEffectReceiptEnvelope<
  TResourceRef extends Record<string, OperationalJson> = Record<string, OperationalJson>,
  TEffect extends Record<string, OperationalJson> = Record<string, OperationalJson>,
> {
  schema: typeof MRMIC_EFFECT_RECEIPT_SCHEMA
  status: 'completed'
  provider: string
  effectKind: string
  commandId: string
  idempotencyKey: string
  commandDigest: string
  principalId: string
  resourceRef: TResourceRef
  effect: TEffect
  completedAt: string
  deduplicated: boolean
  worldStateVerified: false
  perceptionRequiredForPlanning: true
}

export interface OperationalCommandIdentity {
  idempotencyKey: string
}

export interface OperationalReceiptIdentity {
  deduplicated: boolean
}

export interface ProviderOperationalAdapter<
  TCommand extends OperationalCommandIdentity,
  TReceipt extends OperationalReceiptIdentity,
> {
  normalize(input: TCommand): TCommand
  digestValue(command: TCommand): unknown
  execute(command: TCommand, commandDigest: string): Promise<TReceipt>
  markDeduplicated(receipt: TReceipt): TReceipt
}

interface CachedReceipt<TReceipt> {
  commandDigest: string
  receipt: TReceipt
}

interface PendingReceipt<TReceipt> {
  commandDigest: string
  promise: Promise<TReceipt>
}

function requiredIdempotencyKey(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('operational idempotencyKey is required')
  const key = value.trim()
  if (key.length > 256) throw new Error('operational idempotencyKey exceeds 256 characters')
  return key
}

export function canonicalOperationalValue(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('operational canonical value contains a non-finite number')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(item => canonicalOperationalValue(item)).join(',')}]`
  if (!value || typeof value !== 'object') throw new Error('operational canonical value contains unsupported data')

  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => {
    const item = record[key]
    if (item === undefined) throw new Error(`operational canonical value contains undefined at ${key}`)
    return `${JSON.stringify(key)}:${canonicalOperationalValue(item)}`
  }).join(',')}}`
}

export function operationalCommandDigest(value: unknown): string {
  return createHash('sha256').update(canonicalOperationalValue(value)).digest('hex')
}

/**
 * Provider-neutral AI-native operational runtime.
 *
 * The adapter owns provider-specific normalization, authority/effect execution,
 * and receipt shape. This class owns only live-runtime idempotency mechanics:
 * canonical command digesting, completed-receipt caching, concurrent in-flight
 * coalescing, conflict rejection and bounded LRU eviction.
 *
 * This is intentionally not a verifier. It imports no perception/render layer
 * and makes no claim that an external world state was synchronously certified.
 * Idempotency is scoped to this live runtime instance unless a provider adapter
 * supplies stronger transactional semantics itself.
 */
export class ProviderOperationalRuntime<
  TCommand extends OperationalCommandIdentity,
  TReceipt extends OperationalReceiptIdentity,
> {
  readonly #adapter: ProviderOperationalAdapter<TCommand, TReceipt>
  readonly #maxCachedReceipts: number
  readonly #receipts = new Map<string, CachedReceipt<TReceipt>>()
  readonly #pending = new Map<string, PendingReceipt<TReceipt>>()

  constructor(
    adapter: ProviderOperationalAdapter<TCommand, TReceipt>,
    maxCachedReceipts = OPERATIONAL_RECEIPT_CACHE_LIMIT,
  ) {
    if (!Number.isInteger(maxCachedReceipts) || maxCachedReceipts < 1 || maxCachedReceipts > 4096) {
      throw new Error('operational receipt cache bound must be an integer between 1 and 4096')
    }
    this.#adapter = adapter
    this.#maxCachedReceipts = maxCachedReceipts
  }

  cachedReceiptCount(): number {
    return this.#receipts.size
  }

  clearRuntimeReceipts(): void {
    this.#receipts.clear()
  }

  async execute(input: TCommand): Promise<TReceipt> {
    const command = this.#adapter.normalize(input)
    const key = requiredIdempotencyKey(command.idempotencyKey)
    const commandDigest = operationalCommandDigest(this.#adapter.digestValue(command))

    const prior = this.#receipts.get(key)
    if (prior) {
      if (prior.commandDigest !== commandDigest) throw new Error('operational idempotency conflict')
      this.#touch(key, prior)
      return structuredClone(this.#adapter.markDeduplicated(prior.receipt))
    }

    const inFlight = this.#pending.get(key)
    if (inFlight) {
      if (inFlight.commandDigest !== commandDigest) throw new Error('operational idempotency conflict')
      return structuredClone(this.#adapter.markDeduplicated(await inFlight.promise))
    }

    const promise = this.#adapter.execute(command, commandDigest)
    this.#pending.set(key, { commandDigest, promise })
    try {
      const receipt = await promise
      this.#receipts.set(key, { commandDigest, receipt: structuredClone(receipt) })
      this.#evictIfNeeded()
      return structuredClone(receipt)
    } finally {
      this.#pending.delete(key)
    }
  }

  #touch(key: string, value: CachedReceipt<TReceipt>): void {
    this.#receipts.delete(key)
    this.#receipts.set(key, value)
  }

  #evictIfNeeded(): void {
    while (this.#receipts.size > this.#maxCachedReceipts) {
      const oldest = this.#receipts.keys().next().value
      if (typeof oldest !== 'string') break
      this.#receipts.delete(oldest)
    }
  }
}

import { createHash } from 'node:crypto'
import type { WindowsUiSemanticAction } from './index.js'
import type { WindowsUiaControlledActionResult } from './uia-action.js'

export const WINDOWS_OPERATIONAL_COMMAND_SCHEMA = 'windows_operational_command_v1' as const
export const WINDOWS_EFFECT_RECEIPT_SCHEMA = 'windows_effect_receipt_v1' as const
export const WINDOWS_OPERATIONAL_RECEIPT_CACHE_LIMIT = 256

export interface WindowsSemanticActionExecutor {
  perform(
    portalObjectId: string,
    providerResourceId: string,
    principalId: string,
    action: WindowsUiSemanticAction,
  ): Promise<WindowsUiaControlledActionResult>
}

export interface WindowsOperationalCommand {
  schema: typeof WINDOWS_OPERATIONAL_COMMAND_SCHEMA
  commandId: string
  idempotencyKey: string
  portalObjectId: string
  providerResourceId: string
  principalId: string
  action: WindowsUiSemanticAction
}

export interface WindowsEffectReceipt {
  schema: typeof WINDOWS_EFFECT_RECEIPT_SCHEMA
  status: 'completed'
  effectKind: 'uia_semantic_action'
  provider: 'windows'
  commandId: string
  idempotencyKey: string
  commandDigest: string
  portalObjectId: string
  providerResourceId: string
  principalId: string
  controlGeneration: number
  action: { kind: WindowsUiSemanticAction['kind']; runtimeId: string }
  completedAt: string
  deduplicated: boolean
  worldStateVerified: false
  perceptionRequiredForPlanning: true
}

interface CachedReceipt {
  commandDigest: string
  receipt: WindowsEffectReceipt
}

interface PendingReceipt {
  commandDigest: string
  promise: Promise<WindowsEffectReceipt>
}

function requiredText(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return text
}

function normalizeAction(action: WindowsUiSemanticAction): WindowsUiSemanticAction {
  const runtimeId = requiredText(action.runtimeId, 'action.runtimeId', 512)
  if (!['invoke', 'toggle', 'select', 'set_value'].includes(action.kind)) throw new Error('unsupported Windows operational action')
  if (action.kind === 'set_value') {
    if (typeof action.value !== 'string') throw new Error('set_value requires a string value')
    if (action.value.length > 2_048) throw new Error('set_value exceeds 2048 characters')
    if (action.value.includes('\0')) throw new Error('set_value contains an invalid null character')
    return { kind: 'set_value', runtimeId, value: action.value }
  }
  return { kind: action.kind, runtimeId }
}

function normalizeCommand(input: WindowsOperationalCommand): WindowsOperationalCommand {
  if (!input || input.schema !== WINDOWS_OPERATIONAL_COMMAND_SCHEMA) throw new Error('Windows operational command schema mismatch')
  return {
    schema: WINDOWS_OPERATIONAL_COMMAND_SCHEMA,
    commandId: requiredText(input.commandId, 'commandId', 256),
    idempotencyKey: requiredText(input.idempotencyKey, 'idempotencyKey', 256),
    portalObjectId: requiredText(input.portalObjectId, 'portalObjectId'),
    providerResourceId: requiredText(input.providerResourceId, 'providerResourceId'),
    principalId: requiredText(input.principalId, 'principalId'),
    action: normalizeAction(input.action),
  }
}

function canonical(value: unknown): string {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(item => canonical(item)).join(',')}]`
  if (!value || typeof value !== 'object') throw new Error('operational command contains an unsupported canonical value')
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`
}

function digestCommand(command: WindowsOperationalCommand): string {
  return createHash('sha256').update(canonical(command)).digest('hex')
}

function deduplicated(receipt: WindowsEffectReceipt): WindowsEffectReceipt {
  return { ...structuredClone(receipt), deduplicated: true }
}

/**
 * Phase 15.15 AI-native command/effect boundary.
 *
 * This runtime does not perform post-action UIA/WGC verification. The controlled
 * executor owns authority, lease and element binding; a successful provider
 * completion is converted into an effect receipt. UIA/WGC remain independent
 * perception channels used by the agent's next planning cycle.
 *
 * Idempotency is bounded to this runtime instance. It prevents duplicate side
 * effects from concurrent/repeated calls handled by the same live process, but
 * does not claim exactly-once semantics across a crash boundary for external
 * Windows UI effects.
 */
export class WindowsOperationalRuntime {
  readonly #executor: WindowsSemanticActionExecutor
  readonly #maxCachedReceipts: number
  readonly #receipts = new Map<string, CachedReceipt>()
  readonly #pending = new Map<string, PendingReceipt>()

  constructor(executor: WindowsSemanticActionExecutor, maxCachedReceipts = WINDOWS_OPERATIONAL_RECEIPT_CACHE_LIMIT) {
    if (!Number.isInteger(maxCachedReceipts) || maxCachedReceipts < 1 || maxCachedReceipts > 4096) {
      throw new Error('Windows operational receipt cache bound must be an integer between 1 and 4096')
    }
    this.#executor = executor
    this.#maxCachedReceipts = maxCachedReceipts
  }

  cachedReceiptCount(): number {
    return this.#receipts.size
  }

  clearRuntimeReceipts(): void {
    this.#receipts.clear()
  }

  async execute(input: WindowsOperationalCommand): Promise<WindowsEffectReceipt> {
    const command = normalizeCommand(input)
    const commandDigest = digestCommand(command)

    const prior = this.#receipts.get(command.idempotencyKey)
    if (prior) {
      if (prior.commandDigest !== commandDigest) throw new Error('Windows operational idempotency conflict')
      this.#touch(command.idempotencyKey, prior)
      return deduplicated(prior.receipt)
    }

    const inFlight = this.#pending.get(command.idempotencyKey)
    if (inFlight) {
      if (inFlight.commandDigest !== commandDigest) throw new Error('Windows operational idempotency conflict')
      return deduplicated(await inFlight.promise)
    }

    const promise = this.#executeOnce(command, commandDigest)
    this.#pending.set(command.idempotencyKey, { commandDigest, promise })
    try {
      const receipt = await promise
      this.#receipts.set(command.idempotencyKey, { commandDigest, receipt: structuredClone(receipt) })
      this.#evictIfNeeded()
      return structuredClone(receipt)
    } finally {
      this.#pending.delete(command.idempotencyKey)
    }
  }

  async #executeOnce(command: WindowsOperationalCommand, commandDigest: string): Promise<WindowsEffectReceipt> {
    const result = await this.#executor.perform(
      command.portalObjectId,
      command.providerResourceId,
      command.principalId,
      structuredClone(command.action),
    )
    if (!result || result.ok !== true) throw new Error('Windows operational executor did not complete the semantic effect')
    if (result.portalObjectId !== command.portalObjectId
      || result.providerResourceId !== command.providerResourceId
      || result.principalId !== command.principalId) {
      throw new Error('Windows operational executor result identity mismatch')
    }
    if (result.action.kind !== command.action.kind || result.action.runtimeId !== command.action.runtimeId) {
      throw new Error('Windows operational executor result action mismatch')
    }
    if (!Number.isSafeInteger(result.controlGeneration) || result.controlGeneration < 1) {
      throw new Error('Windows operational executor result control generation is invalid')
    }
    if (typeof result.completedAt !== 'string' || !Number.isFinite(Date.parse(result.completedAt))) {
      throw new Error('Windows operational executor completion timestamp is invalid')
    }

    return {
      schema: WINDOWS_EFFECT_RECEIPT_SCHEMA,
      status: 'completed',
      effectKind: 'uia_semantic_action',
      provider: 'windows',
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      commandDigest,
      portalObjectId: command.portalObjectId,
      providerResourceId: command.providerResourceId,
      principalId: command.principalId,
      controlGeneration: result.controlGeneration,
      action: { kind: command.action.kind, runtimeId: command.action.runtimeId },
      completedAt: result.completedAt,
      deduplicated: false,
      worldStateVerified: false,
      perceptionRequiredForPlanning: true,
    }
  }

  #touch(key: string, value: CachedReceipt): void {
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

import {
  OPERATIONAL_RECEIPT_CACHE_LIMIT,
  ProviderOperationalRuntime,
  type ProviderOperationalAdapter,
} from '../../operational-runtime/src/index.js'
import type { WindowsUiSemanticAction } from './index.js'
import type { WindowsUiaControlledActionResult } from './uia-action.js'

export const WINDOWS_OPERATIONAL_COMMAND_SCHEMA = 'windows_operational_command_v1' as const
export const WINDOWS_EFFECT_RECEIPT_SCHEMA = 'windows_effect_receipt_v1' as const
export const WINDOWS_OPERATIONAL_RECEIPT_CACHE_LIMIT = OPERATIONAL_RECEIPT_CACHE_LIMIT

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

function validateNativeResult(
  result: WindowsUiaControlledActionResult,
  command: WindowsOperationalCommand,
): void {
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
}

class WindowsOperationalAdapter implements ProviderOperationalAdapter<WindowsOperationalCommand, WindowsEffectReceipt> {
  readonly #executor: WindowsSemanticActionExecutor

  constructor(executor: WindowsSemanticActionExecutor) {
    this.#executor = executor
  }

  normalize(input: WindowsOperationalCommand): WindowsOperationalCommand {
    return normalizeCommand(input)
  }

  digestValue(command: WindowsOperationalCommand): unknown {
    return command
  }

  async execute(command: WindowsOperationalCommand, commandDigest: string): Promise<WindowsEffectReceipt> {
    const result = await this.#executor.perform(
      command.portalObjectId,
      command.providerResourceId,
      command.principalId,
      structuredClone(command.action),
    )
    validateNativeResult(result, command)

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

  markDeduplicated(receipt: WindowsEffectReceipt): WindowsEffectReceipt {
    return { ...structuredClone(receipt), deduplicated: true }
  }
}

/**
 * Windows adapter over the Phase 15.16 provider-neutral operational runtime.
 *
 * Windows owns semantic action normalization and effect-receipt fields. Shared
 * runtime-local idempotency, concurrent coalescing, command digesting and bounded
 * receipt caching live in packages/operational-runtime and are not duplicated
 * here. UIA/WGC remain perception/provider concerns rather than verifier gates.
 */
export class WindowsOperationalRuntime {
  readonly #runtime: ProviderOperationalRuntime<WindowsOperationalCommand, WindowsEffectReceipt>

  constructor(executor: WindowsSemanticActionExecutor, maxCachedReceipts = WINDOWS_OPERATIONAL_RECEIPT_CACHE_LIMIT) {
    this.#runtime = new ProviderOperationalRuntime(new WindowsOperationalAdapter(executor), maxCachedReceipts)
  }

  cachedReceiptCount(): number {
    return this.#runtime.cachedReceiptCount()
  }

  clearRuntimeReceipts(): void {
    this.#runtime.clearRuntimeReceipts()
  }

  execute(input: WindowsOperationalCommand): Promise<WindowsEffectReceipt> {
    return this.#runtime.execute(input)
  }
}

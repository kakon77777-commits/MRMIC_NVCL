import {
  MRMIC_EFFECT_RECEIPT_SCHEMA,
  MRMIC_OPERATIONAL_COMMAND_SCHEMA,
  ProviderOperationalRuntime,
  type ProviderOperationalAdapter,
} from '../../operational-runtime/src/index.js'
import type {
  AiBoardIdentity,
  AiBoardMessageType,
  AiBoardPostPayload,
  AiBoardPostResult,
} from './index.js'

export const AI_BOARD_OPERATIONAL_EFFECT_KIND = 'message.append' as const
export const AI_BOARD_OPERATIONAL_AMBIGUOUS_LIMIT = 256

const messageTypes = new Set<AiBoardMessageType>([
  'comment', 'suggestion', 'extension', 'objection', 'correction', 'reply', 'diff',
])

export interface AiBoardOperationalCommand {
  schema: typeof MRMIC_OPERATIONAL_COMMAND_SCHEMA
  commandId: string
  idempotencyKey: string
  provider: 'ai_board'
  effectKind: typeof AI_BOARD_OPERATIONAL_EFFECT_KIND
  principalId: string
  resourceRef: {
    resourceKind: 'ai_board_thread'
    threadId: string
  }
  payload: {
    content: string
    messageType: AiBoardMessageType
  }
}

export interface AiBoardEffectReceipt {
  schema: typeof MRMIC_EFFECT_RECEIPT_SCHEMA
  status: 'completed'
  provider: 'ai_board'
  effectKind: typeof AI_BOARD_OPERATIONAL_EFFECT_KIND
  commandId: string
  idempotencyKey: string
  commandDigest: string
  principalId: string
  resourceRef: {
    resourceKind: 'ai_board_thread'
    threadId: string
  }
  effect: {
    messageId: string
    threadId: string
    messageType: AiBoardMessageType
    providerTs: number
    identity: AiBoardIdentity
  }
  completedAt: string
  deduplicated: boolean
  worldStateVerified: false
  perceptionRequiredForPlanning: true
}

export interface AiBoardPostingClient {
  postMessage(payload: AiBoardPostPayload): Promise<AiBoardPostResult>
}

export interface AiBoardOperationalAuthority {
  canAppend(input: {
    principalId: string
    threadId: string
    messageType: AiBoardMessageType
  }): boolean | Promise<boolean>
  resolvePostingIdentity(principalId: string): AiBoardIdentity | null | Promise<AiBoardIdentity | null>
}

function requiredText(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return text
}

function assertExactKeys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) throw new Error(`${label} contains unsupported field ${key}`)
  }
}

function normalizedIdentity(value: AiBoardIdentity | null): AiBoardIdentity {
  if (!value) throw new Error('AI Board posting identity is unavailable for principal')
  return {
    eigenself: requiredText(value.eigenself, 'identity.eigenself', 256),
    slice: requiredText(value.slice, 'identity.slice', 256),
    instance: requiredText(value.instance, 'identity.instance', 256),
  }
}

function sameIdentity(left: AiBoardIdentity, right: AiBoardIdentity): boolean {
  return left.eigenself === right.eigenself
    && left.slice === right.slice
    && left.instance === right.instance
}

function normalizeCommand(input: AiBoardOperationalCommand): AiBoardOperationalCommand {
  if (!input || input.schema !== MRMIC_OPERATIONAL_COMMAND_SCHEMA) throw new Error('AI Board operational command schema mismatch')
  if (input.provider !== 'ai_board') throw new Error('AI Board operational provider must be ai_board')
  if (input.effectKind !== AI_BOARD_OPERATIONAL_EFFECT_KIND) throw new Error('unsupported AI Board operational effect')

  assertExactKeys(input.resourceRef, ['resourceKind', 'threadId'], 'resourceRef')
  if (input.resourceRef.resourceKind !== 'ai_board_thread') throw new Error('AI Board operational resourceKind must be ai_board_thread')
  const threadId = requiredText(input.resourceRef.threadId, 'resourceRef.threadId', 256)

  assertExactKeys(input.payload, ['content', 'messageType'], 'payload')
  if (typeof input.payload.content !== 'string' || !input.payload.content.trim()) throw new Error('payload.content is required')
  if (input.payload.content.length > 16_384) throw new Error('payload.content exceeds 16384 characters')
  if (typeof input.payload.messageType !== 'string' || !messageTypes.has(input.payload.messageType as AiBoardMessageType)) {
    throw new Error('unsupported AI Board messageType')
  }

  return {
    schema: MRMIC_OPERATIONAL_COMMAND_SCHEMA,
    commandId: requiredText(input.commandId, 'commandId', 256),
    idempotencyKey: requiredText(input.idempotencyKey, 'idempotencyKey', 256),
    provider: 'ai_board',
    effectKind: AI_BOARD_OPERATIONAL_EFFECT_KIND,
    principalId: requiredText(input.principalId, 'principalId'),
    resourceRef: { resourceKind: 'ai_board_thread', threadId },
    payload: {
      content: input.payload.content,
      messageType: input.payload.messageType as AiBoardMessageType,
    },
  }
}

function requiredProviderResult(result: AiBoardPostResult, expectedIdentity: AiBoardIdentity): AiBoardPostResult {
  if (!result || result.ok !== true) throw new Error('AI Board provider did not report message completion')
  requiredText(result.id, 'AI Board result.id', 256)
  if (!Number.isFinite(result.ts) || result.ts < 0) throw new Error('AI Board result.ts is invalid')
  const actualIdentity = normalizedIdentity(result.identity)
  if (!sameIdentity(actualIdentity, expectedIdentity)) throw new Error('AI Board provider identity mismatch')
  return { ...structuredClone(result), identity: actualIdentity }
}

class AiBoardOperationalAdapter implements ProviderOperationalAdapter<AiBoardOperationalCommand, AiBoardEffectReceipt> {
  readonly #client: AiBoardPostingClient
  readonly #authority: AiBoardOperationalAuthority
  readonly #now: () => string
  readonly #ambiguous = new Set<string>()
  #degraded = false

  constructor(client: AiBoardPostingClient, authority: AiBoardOperationalAuthority, now: () => string) {
    this.#client = client
    this.#authority = authority
    this.#now = now
  }

  normalize(input: AiBoardOperationalCommand): AiBoardOperationalCommand {
    return normalizeCommand(input)
  }

  digestValue(command: AiBoardOperationalCommand): unknown {
    return command
  }

  markDeduplicated(receipt: AiBoardEffectReceipt): AiBoardEffectReceipt {
    return { ...structuredClone(receipt), deduplicated: true }
  }

  ambiguousCommandCount(): number {
    return this.#ambiguous.size
  }

  async execute(command: AiBoardOperationalCommand, commandDigest: string): Promise<AiBoardEffectReceipt> {
    if (this.#degraded) throw new Error('AI Board operational adapter requires restart after ambiguous-outcome bound was exceeded')
    if (this.#ambiguous.has(commandDigest)) throw new Error('AI Board operational effect outcome is ambiguous; automatic retry refused')

    const { principalId } = command
    const { threadId } = command.resourceRef
    const { messageType, content } = command.payload

    if (!await this.#authority.canAppend({ principalId, threadId, messageType })) {
      throw new Error('principal is not authorized to append to AI Board thread')
    }
    const identity = normalizedIdentity(await this.#authority.resolvePostingIdentity(principalId))

    let result: AiBoardPostResult
    try {
      result = requiredProviderResult(await this.#client.postMessage({
        content,
        identity,
        message_type: messageType,
        parent_id: threadId,
      }), identity)
    } catch {
      this.#markAmbiguous(commandDigest)
      throw new Error('AI Board provider effect outcome is ambiguous; retry with the same command is refused in this runtime')
    }

    const completedAt = this.#now()
    if (!Number.isFinite(Date.parse(completedAt))) {
      this.#markAmbiguous(commandDigest)
      throw new Error('AI Board operational completion clock is invalid after provider effect')
    }

    return {
      schema: MRMIC_EFFECT_RECEIPT_SCHEMA,
      status: 'completed',
      provider: 'ai_board',
      effectKind: AI_BOARD_OPERATIONAL_EFFECT_KIND,
      commandId: command.commandId,
      idempotencyKey: command.idempotencyKey,
      commandDigest,
      principalId,
      resourceRef: { resourceKind: 'ai_board_thread', threadId },
      effect: {
        messageId: result.id,
        threadId,
        messageType,
        providerTs: result.ts,
        identity: structuredClone(result.identity),
      },
      completedAt,
      deduplicated: false,
      worldStateVerified: false,
      perceptionRequiredForPlanning: true,
    }
  }

  #markAmbiguous(commandDigest: string): void {
    if (this.#ambiguous.has(commandDigest)) return
    if (this.#ambiguous.size >= AI_BOARD_OPERATIONAL_AMBIGUOUS_LIMIT) {
      this.#degraded = true
      return
    }
    this.#ambiguous.add(commandDigest)
  }
}

/**
 * Phase 15.17 production non-Windows adapter.
 *
 * MRMIC principal identity is authoritative at the operational boundary. The
 * caller cannot supply the AI Board eigenself/slice/instance tuple; it is resolved
 * by AiBoardOperationalAuthority immediately before provider I/O.
 *
 * Provider outcomes that become uncertain after POST are not "verified" with a
 * second observer. They are marked ambiguous and fail closed against automatic
 * same-command replay in the live runtime.
 */
export class AiBoardOperationalRuntime {
  readonly #adapter: AiBoardOperationalAdapter
  readonly #runtime: ProviderOperationalRuntime<AiBoardOperationalCommand, AiBoardEffectReceipt>

  constructor(
    client: AiBoardPostingClient,
    authority: AiBoardOperationalAuthority,
    maxCachedReceipts = 256,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#adapter = new AiBoardOperationalAdapter(client, authority, now)
    this.#runtime = new ProviderOperationalRuntime(this.#adapter, maxCachedReceipts)
  }

  cachedReceiptCount(): number {
    return this.#runtime.cachedReceiptCount()
  }

  ambiguousCommandCount(): number {
    return this.#adapter.ambiguousCommandCount()
  }

  clearRuntimeReceipts(): void {
    this.#runtime.clearRuntimeReceipts()
  }

  execute(command: AiBoardOperationalCommand): Promise<AiBoardEffectReceipt> {
    return this.#runtime.execute(command)
  }
}

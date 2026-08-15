import { randomUUID } from 'node:crypto'
import type { SerializedCanvasState } from '../../canvas-core/src/index.js'
import type { CanvasTransaction, TransactionResult } from '../../canvas-schema/src/index.js'

export type StateVector = Record<string, number>
export type PresenceIdentityStatus = 'legacy' | 'local_ui' | 'verified'

export interface PresenceState {
  clientId: string
  actorType: 'user' | 'agent' | 'system'
  actorId: string
  label: string
  color?: string
  cursor?: { x: number; y: number }
  viewport?: { x: number; y: number; width: number; height: number; zoom: number }
  selectedObjectIds?: string[]
  task?: string
  identityStatus?: PresenceIdentityStatus
  principalId?: string
  semanticAgentId?: string
  updatedAt: string
}

export interface SyncUpdate {
  updateId: string
  roomId: string
  clientId: string
  counter: number
  transaction: CanvasTransaction
  createdAt: string
}

export interface AppliedSyncUpdate extends SyncUpdate {
  kind?: 'transaction'
  result: TransactionResult
}

export interface StateReplacementUpdate {
  kind: 'state_replace'
  updateId: string
  roomId: string
  clientId: string
  counter: number
  snapshotId: string
  stateHash: string
  state: SerializedCanvasState
  createdAt: string
}

export interface AppliedStateReplacementUpdate extends StateReplacementUpdate {
  result: TransactionResult
}

export type AnyAppliedSyncUpdate = AppliedSyncUpdate | AppliedStateReplacementUpdate

export interface SyncUpdatePersistence {
  append(update: AnyAppliedSyncUpdate): void
  list(roomId: string): AnyAppliedSyncUpdate[]
}

export interface SyncRoomOptions {
  roomId: string
  applyTransaction(transaction: CanvasTransaction): Promise<TransactionResult> | TransactionResult
  applyStateReplacement?: (update: StateReplacementUpdate) => Promise<TransactionResult> | TransactionResult
  persistence?: SyncUpdatePersistence
}

export interface RoomEvent {
  type: 'update' | 'presence' | 'presence_removed'
  update?: AnyAppliedSyncUpdate
  presence?: PresenceState
  clientId?: string
}

export class StateVectorSyncRoom {
  readonly roomId: string
  readonly #applyTransaction: SyncRoomOptions['applyTransaction']
  readonly #persistence?: SyncUpdatePersistence
  readonly #applyStateReplacement?: SyncRoomOptions['applyStateReplacement']
  readonly #updates: AnyAppliedSyncUpdate[] = []
  readonly #byId = new Map<string, AnyAppliedSyncUpdate>()
  readonly #vector: StateVector = {}
  readonly #presence = new Map<string, PresenceState>()
  readonly #listeners = new Set<(event: RoomEvent) => void>()

  constructor(options: SyncRoomOptions) {
    this.roomId = options.roomId
    this.#applyTransaction = options.applyTransaction
    this.#persistence = options.persistence
    this.#applyStateReplacement = options.applyStateReplacement
    for (const update of options.persistence?.list(options.roomId) ?? []) this.#remember(update, false)
  }

  stateVector(): StateVector { return { ...this.#vector } }
  presenceSnapshot(): PresenceState[] { return [...this.#presence.values()].map(item => structuredClone(item)) }
  updateCount(): number { return this.#updates.length }

  subscribe(listener: (event: RoomEvent) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  diff(remote: StateVector): AnyAppliedSyncUpdate[] {
    return this.#updates
      .filter(update => update.counter > (remote[update.clientId] ?? 0))
      .map(update => structuredClone(update))
  }

  nextUpdate(clientId: string, transaction: CanvasTransaction): SyncUpdate {
    return {
      updateId: randomUUID(), roomId: this.roomId, clientId,
      counter: (this.#vector[clientId] ?? 0) + 1,
      transaction: structuredClone(transaction), createdAt: new Date().toISOString(),
    }
  }

  async apply(update: SyncUpdate): Promise<AppliedSyncUpdate> {
    if (update.roomId !== this.roomId) throw new Error(`Room mismatch: ${update.roomId}`)
    const existing = this.#byId.get(update.updateId)
    if (existing) {
      if (existing.kind === 'state_replace') throw new Error(`Update ${update.updateId} kind mismatch`)
      return structuredClone(existing)
    }
    const expected = (this.#vector[update.clientId] ?? 0) + 1
    if (update.counter < expected) {
      const duplicate = this.#updates.find(item => item.clientId === update.clientId && item.counter === update.counter)
      if (duplicate && duplicate.kind !== 'state_replace') return structuredClone(duplicate)
      throw new Error(`Out-of-order counter ${update.counter}; expected ${expected}`)
    }
    if (update.counter > expected) throw new Error(`Counter gap ${update.counter}; expected ${expected}`)
    const result = await this.#applyTransaction(structuredClone(update.transaction))
    const applied: AppliedSyncUpdate = { ...structuredClone(update), result: structuredClone(result) }
    this.#remember(applied, true)
    return structuredClone(applied)
  }

  nextStateReplacement(clientId: string, input: { snapshotId: string; stateHash: string; state: SerializedCanvasState }): StateReplacementUpdate {
    return {
      kind: 'state_replace', updateId: randomUUID(), roomId: this.roomId, clientId,
      counter: (this.#vector[clientId] ?? 0) + 1, snapshotId: input.snapshotId, stateHash: input.stateHash,
      state: structuredClone(input.state), createdAt: new Date().toISOString(),
    }
  }

  async applyStateReplacement(update: StateReplacementUpdate): Promise<AppliedStateReplacementUpdate> {
    if (update.roomId !== this.roomId) throw new Error(`Room mismatch: ${update.roomId}`)
    const existing = this.#byId.get(update.updateId)
    if (existing) {
      if (existing.kind !== 'state_replace') throw new Error(`Update ${update.updateId} kind mismatch`)
      return structuredClone(existing)
    }
    const expected = (this.#vector[update.clientId] ?? 0) + 1
    if (update.counter < expected) {
      const duplicate = this.#updates.find(item => item.clientId === update.clientId && item.counter === update.counter)
      if (duplicate?.kind === 'state_replace') return structuredClone(duplicate)
      throw new Error(`Out-of-order counter ${update.counter}; expected ${expected}`)
    }
    if (update.counter > expected) throw new Error(`Counter gap ${update.counter}; expected ${expected}`)
    if (!this.#applyStateReplacement) throw new Error('State replacement is not configured for this sync room')
    const result = await this.#applyStateReplacement(structuredClone(update))
    const applied: AppliedStateReplacementUpdate = { ...structuredClone(update), result: structuredClone(result) }
    this.#remember(applied, true)
    return structuredClone(applied)
  }

  setPresence(state: PresenceState): void {
    if (typeof state.clientId !== 'string' || state.clientId.length === 0) throw new Error('presence clientId is required')
    if (!['user', 'agent', 'system'].includes(state.actorType)) throw new Error('presence actorType is invalid')
    if (typeof state.actorId !== 'string' || state.actorId.length === 0) throw new Error('presence actorId is required')
    if (typeof state.label !== 'string' || state.label.length === 0) throw new Error('presence label is required')
    const normalized = { ...structuredClone(state), updatedAt: new Date().toISOString() }
    this.#presence.set(state.clientId, normalized)
    this.#emit({ type: 'presence', presence: normalized })
  }

  removePresence(clientId: string): void {
    if (!this.#presence.delete(clientId)) return
    this.#emit({ type: 'presence_removed', clientId })
  }

  #remember(update: AnyAppliedSyncUpdate, persist: boolean): void {
    this.#updates.push(structuredClone(update))
    this.#byId.set(update.updateId, structuredClone(update))
    this.#vector[update.clientId] = Math.max(this.#vector[update.clientId] ?? 0, update.counter)
    if (persist) this.#persistence?.append(update)
    if (persist) this.#emit({ type: 'update', update })
  }

  #emit(event: RoomEvent): void { for (const listener of this.#listeners) listener(structuredClone(event)) }
}

export function mergeStateVectors(...vectors: StateVector[]): StateVector {
  const merged: StateVector = {}
  for (const vector of vectors) for (const [clientId, counter] of Object.entries(vector)) merged[clientId] = Math.max(merged[clientId] ?? 0, counter)
  return merged
}

import { deserializeCanvasState, serializeCanvasState, stateHash, type CanvasStore } from '../../canvas-core/src/index.js'
import type { CanvasAdapter } from '../../canvas-adapter/src/index.js'
import type { SqliteSyncUpdateLog } from '../../sync-ledger/src/index.js'
import { StateVectorSyncRoom, type StateReplacementUpdate } from '../../state-vector-sync/src/index.js'
import { CanvasWebSocketHub } from '../../websocket-sync/src/index.js'

export class CanvasSyncRegistry {
  readonly #workspaceId: string
  readonly #store: CanvasStore
  readonly #adapter: CanvasAdapter
  readonly #persistence: SqliteSyncUpdateLog
  readonly #rooms = new Map<string, StateVectorSyncRoom>()
  readonly #hubs = new Map<string, CanvasWebSocketHub>()

  constructor(input: { workspaceId: string; store: CanvasStore; adapter: CanvasAdapter; persistence: SqliteSyncUpdateLog }) {
    this.#workspaceId = input.workspaceId
    this.#store = input.store
    this.#adapter = input.adapter
    this.#persistence = input.persistence
  }

  roomFor(canvasId: string): StateVectorSyncRoom {
    const existing = this.#rooms.get(canvasId)
    if (existing) return existing
    this.#store.getCanvas(canvasId)
    const room = new StateVectorSyncRoom({
      roomId: `${this.#workspaceId}:${canvasId}`,
      applyTransaction: tx => this.#adapter.applyTransaction(tx),
      applyStateReplacement: update => this.#applyReplacement(update, canvasId),
      persistence: this.#persistence,
    })
    this.#rooms.set(canvasId, room)
    return room
  }

  hubFor(canvasId: string): CanvasWebSocketHub {
    const existing = this.#hubs.get(canvasId)
    if (existing) return existing
    const hub = new CanvasWebSocketHub(this.roomFor(canvasId))
    this.#hubs.set(canvasId, hub)
    return hub
  }

  syncHandle(canvasId: string): string {
    this.roomFor(canvasId)
    return `/sync?canvasId=${encodeURIComponent(canvasId)}`
  }

  rooms(): Array<{ canvasId: string; room: StateVectorSyncRoom; hub?: CanvasWebSocketHub }> {
    return [...this.#rooms].map(([canvasId, room]) => ({ canvasId, room, hub: this.#hubs.get(canvasId) }))
  }

  async replaceAll(clientId: string, input: { snapshotId: string; stateHash: string; state: ReturnType<typeof serializeCanvasState> }) {
    const canvasIds = input.state.canvases.map(canvas => canvas.id)
    for (const canvasId of canvasIds) this.roomFor(canvasId)
    const applied = []
    for (const { room } of this.rooms()) {
      const update = room.nextStateReplacement(clientId, input)
      applied.push(await room.applyStateReplacement(update))
    }
    return applied
  }

  #applyReplacement(update: StateReplacementUpdate, canvasId: string) {
    const before = stateHash(this.#store.snapshot())
    this.#store.restore(deserializeCanvasState(update.state))
    const after = stateHash(this.#store.snapshot())
    let resultCanvasId = canvasId
    try { this.#store.getCanvas(resultCanvasId) } catch { resultCanvasId = this.#store.workspace.rootCanvasId }
    const canvas = this.#store.getCanvas(resultCanvasId)
    return {
      ok: true as const,
      transactionId: `restore:${update.snapshotId}`,
      canvasId: resultCanvasId,
      revision: canvas.revision,
      affectedObjectIds: this.#store.listObjects(resultCanvasId).map(item => item.id),
      beforeHash: before,
      afterHash: after,
    }
  }
}

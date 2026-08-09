import { DatabaseSync } from 'node:sqlite'
import type { AnyAppliedSyncUpdate, SyncUpdatePersistence } from '../../state-vector-sync/src/index.js'

export class SqliteSyncUpdateLog implements SyncUpdatePersistence {
  readonly #db: DatabaseSync
  constructor(path = ':memory:') {
    this.#db = new DatabaseSync(path)
    this.#db.exec(`CREATE TABLE IF NOT EXISTS sync_updates (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT,
      update_id TEXT NOT NULL UNIQUE,
      room_id TEXT NOT NULL,
      client_id TEXT NOT NULL,
      counter INTEGER NOT NULL,
      update_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(room_id, client_id, counter)
    ); CREATE INDEX IF NOT EXISTS idx_sync_room_sequence ON sync_updates(room_id, sequence);`)
  }
  append(update: AnyAppliedSyncUpdate): void {
    this.#db.prepare(`INSERT OR IGNORE INTO sync_updates(update_id, room_id, client_id, counter, update_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(update.updateId, update.roomId, update.clientId, update.counter, JSON.stringify(update), update.createdAt)
  }
  list(roomId: string): AnyAppliedSyncUpdate[] {
    return this.#db.prepare('SELECT update_json FROM sync_updates WHERE room_id = ? ORDER BY sequence').all(roomId)
      .map(row => JSON.parse(String((row as { update_json: unknown }).update_json)) as AnyAppliedSyncUpdate)
  }
  count(roomId: string): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS count FROM sync_updates WHERE room_id = ?').get(roomId) as { count: number | bigint }
    return Number(row.count)
  }
  close(): void { this.#db.close() }
}

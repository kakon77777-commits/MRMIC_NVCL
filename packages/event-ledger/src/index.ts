import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { CanvasEvent } from '../../canvas-schema/src/index.js'
import { deserializeCanvasState, serializeCanvasState, stateHash, type CanvasState, type EventSink, type SerializedCanvasState } from '../../canvas-core/src/index.js'

export const PHASE0_MIGRATION = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  event_type TEXT NOT NULL,
  object_ids_json TEXT NOT NULL,
  intent TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  before_hash TEXT NOT NULL,
  after_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_workspace_sequence
ON events(workspace_id, sequence);

CREATE INDEX IF NOT EXISTS idx_events_transaction
ON events(transaction_id);

CREATE TABLE IF NOT EXISTS snapshots (
  snapshot_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_snapshots_workspace_created
ON snapshots(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS trajectories (
  run_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  trajectory_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_trajectories_workspace_updated
ON trajectories(workspace_id, updated_at);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (1, CURRENT_TIMESTAMP);
`


export interface PersistedSnapshot {
  snapshotId: string
  workspaceId: string
  canvasId: string
  revision: number
  stateHash: string
  state: CanvasState
  createdAt: string
}

export interface PersistedTrajectory {
  runId: string
  workspaceId: string
  trajectory: unknown
  createdAt: string
  updatedAt: string
}

export class SqliteEventLedger implements EventSink {
  readonly #db: DatabaseSync

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.#db = new DatabaseSync(databasePath)
    this.#db.exec(PHASE0_MIGRATION)
  }

  append(event: CanvasEvent): void {
    const statement = this.#db.prepare(`
      INSERT INTO events (
        event_id, workspace_id, canvas_id, transaction_id,
        actor_type, actor_id, actor_json, event_type,
        object_ids_json, intent, payload_json,
        before_hash, after_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    statement.run(
      event.eventId,
      event.workspaceId,
      event.canvasId,
      event.transactionId,
      event.actor.actorType,
      event.actor.actorId,
      JSON.stringify(event.actor),
      event.eventType,
      JSON.stringify(event.objectIds),
      event.intent,
      JSON.stringify(event.payload),
      event.beforeHash,
      event.afterHash,
      event.createdAt,
    )
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }
    return Number(row.count)
  }

  list(workspaceId?: string): CanvasEvent[] {
    const rows = workspaceId
      ? this.#db.prepare('SELECT * FROM events WHERE workspace_id = ? ORDER BY sequence').all(workspaceId)
      : this.#db.prepare('SELECT * FROM events ORDER BY sequence').all()

    return (rows as Record<string, unknown>[]).map((row) => ({
      eventId: String(row.event_id),
      workspaceId: String(row.workspace_id),
      canvasId: String(row.canvas_id),
      transactionId: String(row.transaction_id),
      actor: JSON.parse(String(row.actor_json)),
      eventType: String(row.event_type) as CanvasEvent['eventType'],
      objectIds: JSON.parse(String(row.object_ids_json)),
      intent: String(row.intent),
      payload: JSON.parse(String(row.payload_json)),
      beforeHash: String(row.before_hash),
      afterHash: String(row.after_hash),
      createdAt: String(row.created_at),
    }))
  }


  saveSnapshot(input: { snapshotId: string; workspaceId: string; canvasId: string; revision: number; state: CanvasState; createdAt?: string }): PersistedSnapshot {
    const createdAt = input.createdAt ?? new Date().toISOString()
    const hash = stateHash(input.state)
    const serialized = serializeCanvasState(input.state)
    this.#db.prepare(`INSERT OR REPLACE INTO snapshots(snapshot_id, workspace_id, canvas_id, revision, state_hash, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(input.snapshotId, input.workspaceId, input.canvasId, input.revision, hash, JSON.stringify(serialized), createdAt)
    return { snapshotId: input.snapshotId, workspaceId: input.workspaceId, canvasId: input.canvasId, revision: input.revision, stateHash: hash, state: deserializeCanvasState(serialized), createdAt }
  }

  getSnapshot(snapshotId: string): PersistedSnapshot | undefined {
    const row = this.#db.prepare('SELECT * FROM snapshots WHERE snapshot_id = ?').get(snapshotId) as Record<string, unknown> | undefined
    return row ? this.#snapshotRow(row) : undefined
  }

  latestSnapshot(workspaceId: string): PersistedSnapshot | undefined {
    const row = this.#db.prepare('SELECT * FROM snapshots WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(workspaceId) as Record<string, unknown> | undefined
    return row ? this.#snapshotRow(row) : undefined
  }

  snapshotCount(workspaceId?: string): number {
    const row = workspaceId
      ? this.#db.prepare('SELECT COUNT(*) AS count FROM snapshots WHERE workspace_id = ?').get(workspaceId)
      : this.#db.prepare('SELECT COUNT(*) AS count FROM snapshots').get()
    return Number((row as { count: number | bigint }).count)
  }

  saveTrajectory(runId: string, workspaceId: string, trajectory: unknown): PersistedTrajectory {
    const now = new Date().toISOString()
    this.#db.prepare(`INSERT INTO trajectories(run_id, workspace_id, trajectory_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(run_id) DO UPDATE SET trajectory_json = excluded.trajectory_json, updated_at = excluded.updated_at`)
      .run(runId, workspaceId, JSON.stringify(trajectory), now, now)
    return this.getTrajectory(runId) as PersistedTrajectory
  }

  getTrajectory(runId: string): PersistedTrajectory | undefined {
    const row = this.#db.prepare('SELECT * FROM trajectories WHERE run_id = ?').get(runId) as Record<string, unknown> | undefined
    if (!row) return undefined
    return { runId: String(row.run_id), workspaceId: String(row.workspace_id), trajectory: JSON.parse(String(row.trajectory_json)), createdAt: String(row.created_at), updatedAt: String(row.updated_at) }
  }

  listTrajectories(workspaceId: string): PersistedTrajectory[] {
    return (this.#db.prepare('SELECT * FROM trajectories WHERE workspace_id = ? ORDER BY updated_at').all(workspaceId) as Record<string, unknown>[]).map(row => ({
      runId: String(row.run_id), workspaceId: String(row.workspace_id), trajectory: JSON.parse(String(row.trajectory_json)), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    }))
  }

  #snapshotRow(row: Record<string, unknown>): PersistedSnapshot {
    const serialized = JSON.parse(String(row.state_json)) as SerializedCanvasState
    return {
      snapshotId: String(row.snapshot_id), workspaceId: String(row.workspace_id), canvasId: String(row.canvas_id), revision: Number(row.revision),
      stateHash: String(row.state_hash), state: deserializeCanvasState(serialized), createdAt: String(row.created_at),
    }
  }

  close(): void {
    this.#db.close()
  }
}

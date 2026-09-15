import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  canonicalJson,
  sha256,
  validateDurableObserverEvent,
  type DurableObserverWorkspaceEvent,
  type DurableObserverWorkspaceEventStore,
} from './durable-contract.js'

export const PHASE15_OBSERVER_WORKSPACE_MIGRATION = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS observer_workspace_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('observer_view', 'rendezvous')),
  entity_id TEXT NOT NULL,
  world_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  principal_json TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  command_json TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  state_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(entity_kind, entity_id, revision)
);

CREATE INDEX IF NOT EXISTS idx_observer_workspace_world_sequence
ON observer_workspace_events(world_id, sequence);

INSERT OR IGNORE INTO schema_migrations(version, applied_at)
VALUES (15, CURRENT_TIMESTAMP);
`

export class SqliteObserverWorkspaceEventStore implements DurableObserverWorkspaceEventStore {
  readonly #db: DatabaseSync

  constructor(databasePath: string) {
    if (databasePath !== ':memory:') mkdirSync(dirname(databasePath), { recursive: true })
    this.#db = new DatabaseSync(databasePath)
    this.#db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.#db.exec(PHASE15_OBSERVER_WORKSPACE_MIGRATION)
  }

  appendObserverWorkspaceEvent(event: DurableObserverWorkspaceEvent): void {
    const validated = validateDurableObserverEvent(event)
    const principalJson = canonicalJson(validated.principal)
    const commandJson = canonicalJson(validated.command)
    const stateJson = canonicalJson(validated.state)
    const eventHash = sha256(canonicalJson({ principal: validated.principal, command: validated.command, state: validated.state }))
    this.#db.prepare(`
      INSERT INTO observer_workspace_events (
        event_id, event_type, entity_kind, entity_id, world_id, canvas_id,
        principal_json, revision, command_json, event_hash, state_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      validated.eventId,
      validated.eventType,
      validated.entityKind,
      validated.entityId,
      validated.worldId,
      validated.canvasId,
      principalJson,
      validated.revision,
      commandJson,
      eventHash,
      stateJson,
      validated.createdAt,
    )
  }

  listObserverWorkspaceEvents(): DurableObserverWorkspaceEvent[] {
    const rows = this.#db.prepare('SELECT * FROM observer_workspace_events ORDER BY sequence').all() as Record<string, unknown>[]
    return rows.map(row => {
      const principal = JSON.parse(String(row.principal_json))
      const command = JSON.parse(String(row.command_json))
      const state = JSON.parse(String(row.state_json))
      const eventHash = sha256(canonicalJson({ principal, command, state }))
      if (eventHash !== String(row.event_hash)) {
        throw new Error(`observer workspace event ${String(row.event_id)} payload hash mismatch`)
      }
      return validateDurableObserverEvent({
        schema: 'observer_workspace_event_v1',
        eventId: String(row.event_id),
        eventType: String(row.event_type),
        entityKind: String(row.entity_kind),
        entityId: String(row.entity_id),
        worldId: String(row.world_id),
        canvasId: String(row.canvas_id),
        principal,
        revision: Number(row.revision),
        command,
        state,
        createdAt: String(row.created_at),
      })
    })
  }

  count(): number {
    const row = this.#db.prepare('SELECT COUNT(*) AS count FROM observer_workspace_events').get() as { count: number | bigint }
    return Number(row.count)
  }

  close(): void {
    this.#db.close()
  }
}

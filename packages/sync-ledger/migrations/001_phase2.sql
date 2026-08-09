CREATE TABLE IF NOT EXISTS sync_updates (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  update_id TEXT NOT NULL UNIQUE,
  room_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  counter INTEGER NOT NULL,
  update_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(room_id, client_id, counter)
);
CREATE INDEX IF NOT EXISTS idx_sync_room_sequence ON sync_updates(room_id, sequence);

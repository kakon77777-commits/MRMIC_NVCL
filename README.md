# MRMIC／NVCL MVP Phase 6 v0.7

Phase 6 hardens the complete Phase 0–5 vertical slice into a restart-recoverable evidence release.

The executable path is now:

```text
MCP observe / typed action
        ↓
CanvasTransaction
        ↓
per-canvas state-vector sync room
        ↓
SVG infinite canvas + recursive child canvas
        ↓
NVCL verify / local repair / fold
        ↓
persistent SQLite checkpoints, trajectories and causal events
        ↓
synchronized state-replacement restore
```

## Phase 6 proof points

- Complete workspace state is serialized and checkpointed in SQLite.
- A restarted server hydrates the root canvas, child canvases, objects and idempotency keys.
- NVCL and recursive trajectories remain readable after restart.
- Snapshot restore is emitted as a `state_replace` synchronization update, not only an MCP notification.
- Each child canvas has an independent room ID, state vector, presence state and WebSocket handle.
- Phase 0–5 behavior remains covered by the combined automated suite.

## Run

Requirements:

- Node.js 22.5 or newer
- npm 10 or newer

```bash
npm run check
npm test
npm run phase6:demo
npm run web
```

The web application defaults to `http://127.0.0.1:4173`.

Persistent development run:

```bash
MRMIC_DB=./data/local.db \
MRMIC_SYNC_DB=./data/sync.db \
npm run web
```

## Important URLs

```text
GET  /api/state?canvasId=canvas-root
GET  /api/sync/status?canvasId=canvas-root
GET  /api/render.svg?canvasId=canvas-root
POST /api/nvcl/reference
POST /api/nvcl/recursive
POST /mcp
GET  /mcp
WS   /sync?canvasId=<canvasId>
```

## Packages added or hardened in Phase 6

- `@mrmic/canvas-core`: state serialization and hydration.
- `@mrmic/event-ledger`: persistent snapshots and trajectories.
- `@mrmic/state-vector-sync`: synchronized state-replacement updates.
- `@mrmic/sync-registry`: independent room and WebSocket handle per canvas.
- `@mrmic/mcp-reference-server`: persistent snapshot lookup and restart-safe trajectory resources.
- `@mrmic/phase6-demo`: repeatable persistence and recovery evidence.

## Evidence

- `docs/PHASE6_COMPLETION_REPORT.md`
- `docs/MVP_ACCEPTANCE_MATRIX.md`
- `artifacts/phase6-demo-report.json`
- `artifacts/phase6-test-output.txt`
- `artifacts/phase6-root-after-restart.svg`
- `artifacts/phase6-child-after-restart.svg`

## Honest compatibility boundary

This remains a reference MVP, not a production collaboration platform.

- The MCP server implements a documented `2025-11-25` compatible subset without the official SDK.
- The state-vector engine is not wire-compatible with Yjs.
- State replacement sends a complete serialized workspace and is not suitable for large production canvases.
- Per-canvas rooms share one in-process `CanvasStore`; they are not independent Yjs subdocuments.
- Checkpoint retention and compaction are not implemented.
- The minimal WebSocket transport still requires production authentication, rate limiting and origin policy hardening.
- Node.js 22 `node:sqlite` may emit an experimental warning.

## License

See `LICENSE` and `NOTICE.md`. The SVG reference adapter has no tldraw runtime dependency. A future tldraw adapter must follow tldraw licensing requirements.

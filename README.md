# MRMIC／NVCL Phase 7 v0.8

Phase 7 turns the persistent MCP-native canvas runtime into an interactive multimodal laboratory.

The executable loop is now:

```text
pixel / structured / hybrid observation
        ↓
fresh immutable frame lease
        ↓
action_id + frame_id + expected revision
        ↓
interactive SVG canvas or MCP lab.act
        ↓
state hash + render hash transition guard
        ↓
undo / redo / deterministic oracle verification
        ↓
trajectory evidence for later NVCL learning experiments
```

## What Phase 7 adds

- A real browser drawing surface: select, move, resize, rectangle, ellipse, text, freehand, delete, recolor, pan and zoom.
- Three observation lanes:
  - `pixel`: immutable SVG frame without object IDs;
  - `structured`: frame plus complete object oracle;
  - `hybrid`: frame for the actor, structured state reserved for verification.
- Every lab mutation requires a non-empty `actionId`, a fresh `frameId`, and the expected canvas revision.
- Frame leases bind the render SHA-256, state SHA-256, viewport, revision and expiry time.
- Guarded reversible history with synchronized Undo and Redo.
- A deterministic visual benchmark: move the red circle completely inside the blue target frame.
- Seven MCP lab tools and immutable `lab://frame/{frameId}` Resources.
- A portable Windows trace-path fix that keeps logical run IDs unchanged while sanitizing filesystem path segments.

Phase 0–6 persistence, recursive subcanvas, WebSocket synchronization and NVCL behavior remain available.

## Run

Requirements:

- Node.js 22.5 or newer
- npm 10 or newer

```bash
npm install
npm run check
npm test
npm run lab
```

Open `http://127.0.0.1:4173`.

For persistent local state:

```bash
MRMIC_DB=./data/local.db \
MRMIC_SYNC_DB=./data/sync.db \
npm run lab
```

## Important endpoints

```text
GET  /api/lab/observe?mode=pixel|hybrid|structured
GET  /api/lab/frame/{frameId}.svg
POST /api/lab/action
POST /api/lab/undo
POST /api/lab/redo
POST /api/lab/benchmark/reset
GET  /api/lab/benchmark/verify
GET  /api/lab/trajectory
POST /mcp
GET  /mcp
WS   /sync?canvasId=<canvasId>
```

## MCP lab tools

```text
lab.observe
lab.act
lab.undo
lab.redo
lab.reset_benchmark
lab.verify_benchmark
lab.get_trajectory
```

The MCP server exposes 22 tools in total: the original 15 `canvas.*` tools plus these seven `lab.*` tools.

## Validation

- TypeScript strict check passes.
- 43 automated tests pass.
- Real browser validation passed for benchmark reset, physical drag, deterministic verification, Undo, Redo, rectangle, text, freehand, resize, recolor and delete.
- The browser console produced no warnings or errors during the acceptance run.

See:

- `docs/MULTIMODAL_LAB_CONTRACT.md`
- `docs/ADR-007_INTERACTIVE_MULTIMODAL_CANVAS_LAB.md`
- `docs/PHASE7_COMPLETION_REPORT.md`
- `docs/MCP_COMPATIBILITY.md`
- `docs/theory/canonical/README.md`

## Honest boundary

This is an experimental local reference runtime, not a production collaboration service.

- Pixel observations are immutable SVG frames; server-side PNG rasterization is not included yet.
- The deterministic verifier is an oracle, not a trained visual model.
- No real multimodal provider is bundled in Phase 7.
- The state-vector protocol is still not Yjs wire-compatible.
- Production authentication, rate limits, origin policy and multi-tenant isolation remain future work.
- Recorded feedback trajectories are evidence; they are not automatically policy learning.

## License

See `LICENSE` and `NOTICE.md`. Phase 7 retains the dependency-light SVG reference adapter and does not add an Excalidraw or tldraw runtime dependency.

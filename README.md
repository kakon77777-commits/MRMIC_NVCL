# MRMIC／NVCL Phase 8 v0.9

Phase 8 turns the guarded canvas laboratory into a real pixel-native multimodal agent loop.

```text
immutable PNG observation
  → provider-neutral pixel request (no object IDs)
  → normalized or pixel Gesture IR
  → fresh-frame coordinate projection and runtime hit-test
  → guarded transaction
  → before/after render evidence
  → structured oracle verification
  → Token, latency, correction and stale-frame metrics
```

## Phase 8 additions

- Deterministic server-side SVG → PNG rasterization through `@resvg/resvg-js`.
- Full-frame and cropped immutable raster Resources with SHA-256 lineage.
- Pixel-native drag, resize, delete, restyle, text, path, pan and zoom gestures.
- Crop-to-full-frame coordinate projection before any action executes.
- Provider requests and outputs reject `objectId` / `objectIds` fields recursively.
- Provider-neutral episode runner with Token, latency, correction and freshness telemetry.
- Experimental Codex Account Provider using the versioned local Codex CLI App Server and `localImage`.
- Real acceptance: one PNG observation → one model-planned drag → guarded transition → oracle PASS.

Phases 0–7 remain available: typed canvas state, SQLite recovery, synchronization, MCP Resources/Tools, flat and recursive NVCL, browser drawing, freshness guards, Undo/Redo and deterministic visual verification.

## Run

Requirements: Node.js 22.5+ and npm 10+.

```bash
npm install
npm run check
npm test
npm run phase8:demo
npm run lab
```

Open `http://127.0.0.1:4173` for the interactive laboratory.

The real account-backed acceptance is opt-in because it consumes account capacity:

```bash
npm run phase8:codex
```

The Provider uses an ephemeral read-only Codex thread, enables no dynamic tools, writes one bounded temporary PNG, and removes it in `finally`.

## Phase 8 endpoints

```text
GET  /api/lab/observe?mode=pixel|hybrid|structured
GET  /api/lab/frame/{frameId}.svg
GET  /api/lab/frame/{frameId}.png
GET  /api/lab/frame/{frameId}.png?x=40&y=140&width=700&height=300
GET  /api/lab/raster/{rasterId}.png
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

The MCP reference server exposes 23 tools: 15 `canvas.*` tools and eight `lab.*` tools, including `lab.rasterize`.

## Validation

- TypeScript strict build: PASS.
- Automated tests: 53/53 PASS.
- Real browser: Phase 8 UI and immutable PNG render PASS; console 0 warnings and 0 errors.
- Real Codex Account Provider: one-call pixel loop PASS with no structured-object or object-ID input.
- Full high-detail run: 19,283 total tokens, 14.571 s.
- Cropped auto-detail run: 17,269 total tokens, 15.981 s, a 10.4% token reduction in this sample.

See `docs/PHASE8_COMPLETION_REPORT.md`, `docs/PIXEL_GESTURE_IR.md`, `docs/CODEX_ACCOUNT_PROVIDER.md`, and `docs/ADR-008_PIXEL_NATIVE_MULTIMODAL_AGENT.md`.

## Honest boundary

- The benchmark is a controlled synthetic drag task, not a broad game or desktop benchmark.
- The structured oracle verifies results but is never sent to the pixel Provider.
- Codex Account/App Server carries substantial fixed context overhead; crop alone does not solve continuous-video cost.
- Raster output can vary across machines when system fonts differ.
- The MCP server remains a handwritten `2025-11-25` stateful subset. It has not migrated to the finalized stateless `2026-07-28` core and does not claim formal conformance.
- Recorded trajectories are evidence, not policy learning.

## License

See `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.

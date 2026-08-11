# MRMIC／NVCL Phase 9 v0.10

Phase 9 turns the pixel-native loop into an adaptive sustained-observation Runtime.

```text
fresh immutable pixel frame
  → keyframe / full frame / ROI / skip governor
  → provider-neutral pixel request when pixels are needed (no object IDs)
  → normalized or pixel Gesture IR
  → viewport-bound coordinate projection and runtime hit-test
  → guarded transaction
  → stale rejection and fresh keyframe regeneration
  → before/after render evidence
  → structured oracle verification
  → Token budget, latency, correction and observation-policy metrics
```

## Phase 9 additions

- Trusted 32×32 RGB perceptual signatures without exposing object structure.
- Observation Governor with static-frame skip, localized ROI, full-frame fallback and periodic keyframes.
- Session-local adaptive observation through the read-only MCP tool `lab.observe_adaptive`.
- Token-budget stop before a subsequent Provider call.
- Stale decisions are recorded, rejected and regenerated from a fresh forced keyframe; old coordinates are never replayed.
- Freshness now binds lease, canvas, revision, state hash and the complete viewport tuple.
- Seeded sustained-observation benchmark with release-safe aggregate evidence.

Phases 0–8 remain available: typed canvas state, SQLite recovery, synchronization, MCP Resources/Tools, flat and recursive NVCL, browser drawing, freshness guards, Undo/Redo, immutable PNG rasterization, pixel Gesture IR and the real Codex Account one-action loop.

## Run

Requirements: Node.js 22.5+ and npm 10+.

```bash
npm install
npm run check
npm test
npm run phase9:demo
npm run lab
```

Open `http://127.0.0.1:4173` for the interactive laboratory.

The inherited Phase 8 real account-backed acceptance remains opt-in because it consumes account capacity:

```bash
npm run phase8:codex
```

The Provider uses an ephemeral read-only Codex thread, enables no dynamic tools, writes one bounded temporary PNG, and removes it in `finally`.

## Phase 9 endpoints

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

The MCP reference server exposes 24 tools: 15 `canvas.*` tools and nine `lab.*` tools, including `lab.rasterize` and session-local `lab.observe_adaptive`.

## Validation

- TypeScript strict build: PASS.
- Automated tests: 61/61 PASS.
- Three seeded sustained runs: 27 observations, 12 Provider calls avoided.
- Governed PNG payload: 529,716 bytes versus 1,505,658 always-full bytes, a 64.8183% reduction in this synthetic sequence.
- Real Phase 9 browser reset and viewport transition: Freshness/Transition Guard PASS; console 0 warnings and 0 errors.
- Phase 8 real Codex Account one-action evidence remains inherited PASS evidence.

See `docs/PHASE9_COMPLETION_REPORT.md`, `docs/OBSERVATION_GOVERNOR.md`, `docs/ADR-009_ADAPTIVE_OBSERVATION_GOVERNOR.md`, and `artifacts/phase9-governor-benchmark.json`.

## Honest boundary

- The benchmark is a controlled synthetic sequence, not arbitrary video, a game or a desktop benchmark.
- The structured oracle verifies results but is never sent to the pixel Provider.
- PNG payload reduction is not a measured Token reduction; no real multi-call Provider A/B was run in Phase 9.
- The 32×32 nearest-sampled signature may miss tiny or transient changes; periodic keyframes only bound this risk.
- Raster output can vary across machines when system fonts differ.
- The MCP server remains a handwritten `2025-11-25` stateful subset. It has not migrated to the finalized stateless `2026-07-28` core and does not claim formal conformance.
- Recorded trajectories are evidence, not policy learning.

## License

See `LICENSE`, `NOTICE.md`, and `THIRD_PARTY_NOTICES.md`.

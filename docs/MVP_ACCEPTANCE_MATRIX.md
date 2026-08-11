# MRMIC／NVCL Acceptance Matrix

| Capability | Phase | Evidence | Status |
|---|---:|---|---|
| Typed objects, atomic transactions and rollback | 0 | `tests/core.test.mjs` | Pass |
| Append-only causal event ledger | 0 | `tests/ledger.test.mjs` | Pass |
| Executable SVG adapter | 1 | `tests/adapter.test.mjs` | Pass |
| State-vector and WebSocket synchronization | 2 | sync tests | Pass |
| MCP Resources and typed Canvas Tools | 3 | `tests/mcp.test.mjs` | Pass |
| Autonomous flat NVCL and recovery | 4 | NVCL tests | Pass |
| Recursive subcanvas, fold and lineage | 5 | recursive tests | Pass |
| Persistent restart recovery and per-canvas rooms | 6 | Phase 6 tests | Pass |
| Pixel observation without object leakage | 7 | `tests/multimodal-lab.test.mjs` | Pass |
| Fresh frame, Action ID and transition evidence | 7 | `tests/multimodal-lab.test.mjs` | Pass |
| Undo/Redo and deterministic visual oracle | 7 | automated + browser evidence | Pass |
| Full and cropped immutable PNG rasterization | 8 | multimodal lab tests + browser | Pass |
| Pixel Gesture IR and runtime hit-test | 8 | lab + agent runtime tests | Pass |
| Crop-to-full-frame coordinate projection | 8 | agent runtime tests | Pass |
| Recursive zero-object-ID Provider boundary | 8 | agent runtime tests | Pass |
| Token, latency, correction and freshness telemetry | 8 | runtime tests + real acceptance | Pass |
| Real Codex Account PNG → gesture → guard → oracle loop | 8 | `artifacts/phase8-codex-acceptance.json` | Pass |

```text
Automated tests: 53 / 53 passed
Browser console warnings: 0
Browser console errors: 0
Real Provider actions: 1 / 1 verified
```

Not claimed: broad visual-agent generalization, policy learning, deterministic cross-machine font rasterization, production security, official MCP conformance, MCP `2026-07-28` support, or transfer to uncontrolled games/desktops.

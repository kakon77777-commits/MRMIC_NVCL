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
| Keyframe, threshold skip, ROI and periodic full resync | 9 | Governor + runtime tests | Pass |
| Stale decision rejection and fresh-keyframe regeneration | 9 | agent runtime tests | Pass |
| Viewport-bound pixel freshness | 9 | multimodal lab tests | Pass |
| Measured Token budget before subsequent Provider call | 9 | agent runtime tests | Pass |
| Session-local adaptive MCP observation | 9 | MCP tests | Pass |
| Seeded sustained-observation payload benchmark | 9 | `artifacts/phase9-governor-benchmark.json` | Pass |
| Passive scheduler, flush, abort and reset lifecycle | 10 | `tests/passive-observation.test.mjs` | Pass |
| Scene epochs separated from periodic resynchronization | 10 | passive observation tests | Pass |
| Bounded burst coalescing and ROI union fallback | 10 | passive observation tests | Pass |
| Session-local pixel-only passive MCP timeline | 10 | MCP tests | Pass |
| Fixed and held-out guarded multi-action timelines | 10 | `artifacts/phase10-passive-timeline-benchmark.json` | Pass |
| Strict freehand SVG rasterization | 10 | adapter + generated benchmark tests | Pass |
| Four policies replay an identical full-PNG source trace | 11 | `tests/observation-policy-ab.test.mjs` | Pass |
| Tiny-motion and transient-event retention metrics | 11 | policy A/B test + benchmark artifact | Pass |
| Cost, coverage and exact post-state metrics | 11 | `artifacts/phase11-observation-policy-ab.json` | Pass |
| Read-only transparent MCP policy ranking | 11 | `tests/mcp.test.mjs` | Pass |
| Transient-preserving A→B→A boundary | 12 | passive + MCP tests | Pass |
| Five-policy identical source trace | 12 | `artifacts/phase12-hybrid-benchmark.json` | Pass |
| Dual opt-in real Provider budget gate | 12 | `tests/provider-ab.test.mjs` | Pass |
| Real Provider A/B source and semantic verification | 12 | `artifacts/phase12-real-provider-ab.json` | Pass |
| Atomic partial evidence on real-run interruption | 12 | CLI checkpoint + attempt artifact | Pass |

```text
Automated tests: 75 / 75 passed
Seeded Phase 9 observations: 27 / 27 classified
Phase 9 Provider calls avoided: 12
Phase 9 browser warnings/errors: 0 / 0
Phase 10 generated runs: 5 / 5 passed
Phase 10 actions with Freshness and Transition Guard: 40 / 40
Phase 10 samples / emitted events: 55 / 20
Phase 10 Provider deliveries avoided: 35
Phase 11 controlled runs: 8 / 8 completed
Phase 11 action Freshness and Transition Guard: 22 / 22 per policy
Phase 11 Governor ROI perceptual / exact retention: 21 / 21 and 21 / 21
Phase 11 Passive Timeline exact retention: 6 / 21; transient not retained
Phase 12 controlled runs: 10 / 10 completed
Phase 12 Hybrid exact retention: 6 / 21; tested transient retained
Phase 12 Hybrid deliveries / avoided: 8 / 20
Phase 12 real Provider calls: 8 / 8 completed
Phase 12 real semantic classifications: 8 / 8 correct
Phase 12 real Freshness / Transition Guard: 4 / 4 and 4 / 4
Phase 12 real total Tokens: always-full 104313; Governor ROI 58010
Inherited real Provider actions: 1 / 1 verified
```

Not claimed: broad visual-agent generalization, arbitrary video/audio understanding, semantic narration, policy learning, deterministic cross-machine font rasterization, production security, official MCP conformance, MCP `2026-07-28` support, or transfer to uncontrolled games/desktops.

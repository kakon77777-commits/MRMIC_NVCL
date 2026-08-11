# Phase 9 Completion Report

## Status

Completed: adaptive sustained-observation control plane

Version: `0.10.0`

Date: `2026-08-10`

## Proven loop

```text
fresh immutable pixel frame
→ local perceptual signature
→ keyframe / full frame / ROI / skip
→ bounded Provider invocation
→ coordinate-only Gesture IR
→ viewport + lease + revision + hash freshness
→ guarded action
→ stale rejection or verified transition
→ forced fresh keyframe after stale rejection
```

## Implemented

- 32×32 RGB compact perceptual signature derived from rendered pixels.
- Stateful Observation Governor with threshold skip, ROI selection, full-frame fallback and periodic keyframes.
- Provider-call avoidance on static frames.
- Measured cumulative Token budget checked before each subsequent Provider call.
- Stale action evidence plus fresh-frame regeneration; old coordinates are never replayed.
- Viewport tuple added to the freshness invariant.
- Session-local `lab.observe_adaptive` MCP Tool.
- Seeded sustained-observation benchmark and release-safe aggregate artifact.

## Deterministic benchmark

Three fixed seeds produced the same observation classes:

| Metric | Result |
|---|---:|
| observations | 27 |
| keyframes | 6 |
| full frames | 3 |
| ROI frames | 6 |
| skipped frames | 12 |
| Provider calls avoided | 12 |
| always-full PNG bytes | 1,505,658 |
| governed PNG bytes | 529,716 |
| bytes avoided | 975,942 |
| payload reduction | 64.8183% |

Evidence: `artifacts/phase9-governor-benchmark.json`.

## Safety verification

- Object identifiers remain recursively forbidden in Provider requests and responses.
- Signature and changed-block data stay inside the trusted Runtime.
- A changed viewport invalidates old pixel coordinates before hit-testing or mutation.
- Stale Provider decisions are retained as rejected evidence with `actionRejectedCode`.
- Recovery obtains a new frame and forces a keyframe before asking the Provider again.
- Token budget exhaustion stops before another Provider call.
- MCP Governor history is isolated by session and `governorId`.

## Validation

```text
TypeScript strict check         PASS
Automated tests                61 / 61 PASS
Seeded governor runs            3 / 3 PASS
Benchmark observations         27 / 27 classified
Real browser benchmark reset    PASS
Browser Freshness/Guard         PASS / PASS
Browser warnings/errors         0 / 0
Provider requests with IDs      0
Stale-coordinate replay         0
```

The Phase 9 browser run also exposed and corrected no-op viewport commits that produced failed transition evidence; identical viewport commits are now skipped in the UI and rejected by the Lab. Phase 8 real Codex Account one-action evidence remains valid inherited evidence. Phase 9 did not spend another real-account run on the same one-step drag, because a single Provider call cannot measure sustained-observation savings.

Release-safe validation summaries: `artifacts/phase9-test-summary.txt` and `artifacts/phase9-browser-acceptance.json`.

## Honest boundary

Phase 9 proves adaptive observation mechanics in a generated canvas sequence. It does not yet prove Token reduction in a real multi-call Provider A/B, arbitrary video understanding, passive narration, audio synchronization, semantic event detection, production security, policy learning, or transfer to games/desktops. The compact signature can miss tiny or transient changes; periodic full keyframes bound but do not eliminate that risk.

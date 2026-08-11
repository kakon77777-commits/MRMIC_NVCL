# Hybrid Transient-Preserving Policy

Status: Accepted for Phase 12
Version: `0.13.0`

## Problem

Passive burst coalescing lowers delivery count by emitting the latest state in a nearby group. For an A→B→A pulse, that can erase B before any downstream visual observer receives it.

## Bounded policy

`PassiveObservationScheduler` keeps its Phase 10 behavior by default. Callers must opt into:

```text
boundaryMode = transient_preserving
```

In this mode the scheduler derives a local full-raster perceptual signature for each sample and compares three consecutive signatures:

```text
penultimate = A
previous    = B
current     = A'

pulse   = difference(B, A)
return  = difference(A', A)
trigger = pulse >= pulseThreshold
       && return <= returnThreshold
       && return <= pulse * reversalRatio
```

Defaults:

| Parameter | Default |
|---|---:|
| `transientPulseDifferenceThreshold` | `0.00005` |
| `transientReturnDifferenceThreshold` | `0.0005` |
| `transientReversalRatio` | `0.2` |

When the trigger fires, the scheduler flushes the pending burst before adding the current return sample. The emitted event therefore points to B, carries `boundaryReason: return_to_recent_visual_state`, and increments `transientInterruptions`.

## Authority boundary

- The detector reads immutable pixels and cannot issue or authorize actions.
- Signatures remain local and contain no object identifiers.
- MCP output contains frame/raster lineage and resource links, not object IDs.
- `coalesce_only` remains the default, preserving prior callers.
- Reset clears both signature history and interruption counts.

## Controlled evidence

Across seeds 42 and 9001, all five policies replayed identical action-plan and full-PNG source traces. `hybrid_transient` produced:

| Metric | Result |
|---|---:|
| samples | 28 |
| deliveries | 8 |
| deliveries avoided | 20 |
| delivered PNG bytes | 301,745 |
| byte reduction vs always-full | 79.73897594% |
| reversal boundaries | 2 |
| tested transient retained | yes |
| exact post-states retained | 6 / 21 |

The ordinary Passive Timeline also emitted 8 deliveries but used 378,922 bytes and did not retain the tested transient. Hybrid changed which exact intermediate state survived; it did not increase the total exact post-state count. `governor_roi` remains the controlled-fixture recommendation because it retained 21/21 exact post-states.

Canonical evidence: `artifacts/phase12-hybrid-benchmark.json`.

## Non-claims

This three-frame heuristic is not semantic event understanding, optical flow, or a proof that every transient will be captured. It adds local full-raster signature work even when Provider delivery is skipped. Reported byte savings therefore describe the delivery lane, not complete CPU/GPU cost.

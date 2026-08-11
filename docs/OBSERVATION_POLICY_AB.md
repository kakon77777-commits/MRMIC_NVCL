# Controlled Observation Policy A/B

Version: `0.12.0`

## Purpose

Phase 11 answers a bounded engineering question: given the same visual source sequence, what does each observation policy save, retain, and lose?

The benchmark does not ask a Provider to interpret the scene. It isolates transport and retention behavior before spending real Provider capacity.

## Compared policies

| Policy | Delivery rule | Expected tradeoff |
|---|---|---|
| `always_full` | Deliver every full PNG sample | Maximum retention, maximum bytes and calls |
| `static_crop` | Deliver one fixed crop every sample | Low bytes, predictable spatial blind spots |
| `governor_roi` | Keyframe/full/ROI/skip from perceptual change | Adaptive bytes with per-change delivery |
| `passive_timeline` | Governor plus bounded burst coalescing | Minimum delivery count, possible loss of intermediate states |

## Identical-source proof

Each policy runs in a fresh isolated Lab. A seeded plan supplies the same coordinates, timestamps and action kinds. Every action records Action ID, Freshness and Transition Guard evidence.

An independent audit lane rasterizes every sample as a full PNG. For each seed the benchmark requires:

1. identical action-plan SHA-256 across all policies;
2. identical ordered full-PNG SHA-256 trace across all policies;
3. no serialized object identifier in Provider-facing policy results.

SVG render hashes are intentionally not compared across isolated worlds because generated object IDs may differ while pixels remain identical.

## Metrics

- `providerDeliveries`: policy outputs that would reach a Provider.
- `deliveredBytes`: encoded PNG bytes selected by the policy.
- `perceptualActions`: actions whose full-PNG signature differs from the preceding state.
- `perceptuallyDeliveredActions`: perceptual actions covered by at least one delivery.
- `fullyCoveredPerceptualActions`: perceptual action range fully covered by delivered pixels.
- `exactPostStatesRetained`: perceptual action post-states present exactly in a delivery.
- `transientStateRetained`: whether the temporary state before restore remains independently available.
- `tinyMotionDetected`: whether the dedicated small-motion fixture changes the audit signature.

## Transparent ranking

The current score is intentionally simple and versioned in source:

```text
0.25 byte efficiency
+ 0.25 perceptual delivery coverage
+ 0.25 exact post-state retention
+ 0.10 transient retention
+ 0.15 Transition Guard reliability
```

The ranker also emits a Pareto flag. A recommendation is a fixture-local decision aid, not proof that the policy is universally optimal. Ranking cannot authorize observation, Provider use or input.

## Aggregate result

Two fixtures (`seed=42`, held-out `seed=9001`) produced 22 actions and 28 samples per policy.

| Policy | Deliveries | PNG bytes | Saved vs full | Perceptual coverage | Exact post-state | Transient |
|---|---:|---:|---:|---:|---:|---|
| `always_full` | 28 | 1,489,288 | 0% | 21/21 | 21/21 | retained |
| `static_crop` | 28 | 376,942 | 74.6898% | 16/21 | 16/21 | retained |
| `governor_roi` | 25 | 491,840 | 66.9748% | 21/21 | 21/21 | retained |
| `passive_timeline` | 8 | 378,922 | 74.5568% | 21/21 | 6/21 | not retained |

Under the declared score, `governor_roi` is recommended. Passive Timeline remains useful for coarse scene narration or low-call monitoring, but Phase 11 demonstrates that it is not a lossless replacement for per-transition delivery.

Canonical evidence: `artifacts/phase11-observation-policy-ab.json`.

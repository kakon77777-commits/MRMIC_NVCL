# ADR-011: Controlled Observation Policy A/B

Status: Accepted for Phase 11

Version: `0.12.0`

## Context

Phase 9 showed adaptive ROI selection and Phase 10 showed passive burst coalescing. Their reported savings came from different workloads, so comparing those release summaries would confound policy, scene and timing.

## Decision

Run every observation policy in a fresh isolated world with the same seeded coordinate-only action plan and injectable clock. Maintain an independent full-PNG audit lane for source-trace identity. Score transport cost and visual retention separately.

The MCP ranker accepts only caller-supplied summaries and is pure/read-only. It must not observe the Lab, mutate canvas state, call a Provider or authorize physical/virtual input.

## Consequences

- Policy comparisons are reproducible and source-equivalent at the pixel level.
- Object UUID differences cannot create false trace mismatches.
- Tiny-motion and transient fixtures expose losses hidden by aggregate byte savings.
- Passive coalescing is documented as lossy for intermediate states.
- The current weighted recommendation is explicit, reviewable and replaceable.
- PNG byte savings remain a proxy; real Provider Token and semantic usefulness require a separate opt-in experiment.

## Rejected alternatives

- Comparing Phase 9 and Phase 10 benchmark totals: workloads are not identical.
- Reusing one mutable world for all policies: order effects contaminate evidence.
- Comparing SVG hashes: generated IDs differ despite equal pixels.
- Letting the recommendation select or authorize actions: violates governance separation.

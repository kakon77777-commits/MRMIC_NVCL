# ADR-008: Pixel-native multimodal agent boundary

Status: Accepted  
Version: 0.9.0

## Decision

The external visual Provider receives an immutable PNG frame, dimensions, hashes, goal and bounded prior feedback. It does not receive canvas objects, object IDs, structured hit-test results or oracle state.

The Provider returns a gesture in normalized-frame or frame-pixel coordinates. The trusted runtime binds that gesture to the same fresh frame, projects crop coordinates back to the full frame, performs hit-testing, generates the authoritative transaction and verifies the result using a structured oracle that stays outside the Provider boundary.

```text
untrusted visual planner
  PNG + goal → coordinate gesture
             ↓
trusted runtime
  schema validation → no-ID invariant → freshness → crop projection
  → hit-test → transaction → transition guard → oracle
```

## Invariants

- Every mutation has a non-empty `actionId`.
- Every gesture references one immutable `frameId` and expected canvas revision.
- Provider request and response reject keys matching object identifier forms recursively.
- Cropped coordinates are projected using the crop recorded in the immutable raster.
- Runtime hit-testing occurs only after freshness validation.
- A failed schema, freshness, hit-test or transition check produces no authorized follow-up action.
- Oracle objects and affected IDs may appear in backend evidence, never in the next visual request.

## Consequences

This separates visual competence from privileged scene knowledge and makes failures auditable. It also means the planner can miss targets and requires controlled correction logic. A broad benchmark suite and stale-frame recovery remain Phase 9 work.

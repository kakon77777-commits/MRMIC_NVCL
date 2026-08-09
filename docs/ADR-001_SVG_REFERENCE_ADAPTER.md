# ADR-001: Use a vendor-neutral SVG reference adapter before tldraw

**Status:** Accepted  
**Date:** 2026-07-30

## Context

The white paper proposed tldraw as the first rapid canvas adapter. During Phase 1 implementation, the project also had to preserve three architectural requirements:

1. the ZIP must run without downloading runtime dependencies;
2. the core must not inherit a third-party canvas record format;
3. the reference implementation must remain usable without a production license key.

## Decision

Phase 1 implements `SvgCanvasAdapter` and a browser-native SVG infinite canvas as the reference adapter.

tldraw is deferred as an optional adapter:

```text
CanvasAdapter
├── SvgCanvasAdapter        ← reference implementation
├── TldrawCanvasAdapter     ← optional future adapter
└── OtherCanvasAdapter      ← future
```

## Consequences

### Positive

- reproducible offline build;
- no vendor runtime dependency;
- no production license requirement for the reference canvas;
- direct visibility into all object-to-shape mappings;
- simpler adapter contract tests.

### Negative

- fewer editing tools than tldraw;
- no production-grade selection handles or rich shape editing yet;
- PNG export remains an artifact-generation step rather than a browser API.

## Revisit condition

Add `TldrawCanvasAdapter` when its advanced editing or multiplayer features provide enough value to justify the dependency and licensing path. The core schema must remain unchanged.

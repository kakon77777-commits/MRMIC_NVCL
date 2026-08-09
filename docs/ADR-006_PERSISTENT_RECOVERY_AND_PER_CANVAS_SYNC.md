# ADR-006: Persistent recovery, synchronized restore, and per-canvas sync rooms

## Status

Accepted for MVP Phase 6.

## Decision

1. Serialize the complete `CanvasState` into a stable JSON representation.
2. Store automatic checkpoints, explicit snapshots, and NVCL trajectories in SQLite.
3. Hydrate the `CanvasStore` from the latest checkpoint during server construction.
4. Represent snapshot restoration as a state-vector `state_replace` update.
5. Allocate a distinct synchronization room and WebSocket handle for each canvas.
6. Keep all rooms connected to one in-process `CanvasStore` during the MVP.

## Rationale

Phase 5 proved recursion but still lost active state after process restart, restored snapshots outside the normal sync stream, and routed root and child canvas operations through one room. Phase 6 addresses these three evidence gaps without introducing a production-scale distributed database.

## Consequences

Positive:

- restart recovery is testable;
- snapshot restore reaches connected peers through the sync protocol;
- root and child histories no longer share one state vector;
- trajectory MCP Resources survive restart.

Negative:

- state replacement contains the complete serialized workspace;
- checkpoint growth is unbounded until compaction is added;
- orphan room objects may remain in memory after a restored snapshot removes a child canvas;
- the design is not a substitute for Yjs subdocuments or production durable streams.

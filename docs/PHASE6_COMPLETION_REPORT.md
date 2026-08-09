# Phase 6 Completion Report

## Status

**Completed — MVP Hardening and Evidence Release**

Version: `0.7.0`

## Goal

Close the four hardening gaps left after Phase 5:

1. complete state should survive server restart;
2. trajectories and explicit snapshots should be persistent;
3. snapshot restore should be visible as a synchronization update;
4. root and child canvases should have independent synchronization handles.

## Implemented

### Persistent canvas state

`CanvasState` now has deterministic serialization and hydration functions. SQLite stores explicit snapshots, automatic transaction checkpoints, shutdown checkpoints, and trajectory JSON.

At startup:

```text
create workspace identity
→ open SQLite ledger
→ load latest workspace checkpoint
→ hydrate CanvasStore
→ restore per-canvas state vectors from the sync log
```

### Synchronized restore

`canvas.restore_snapshot` now produces a `state_replace` update containing:

- snapshot ID;
- state hash;
- serialized workspace state;
- room/client counter;
- normal synchronization result metadata.

Known canvas rooms receive the update and advance their own vectors. Connected peers can observe the replacement rather than relying only on an MCP Resource notification.

### Independent recursive sync handles

`CanvasSyncRegistry` creates one room and optional WebSocket hub per canvas:

```text
workspace-demo:canvas-root
workspace-demo:<childCanvasId>
```

MCP `canvas.open_subcanvas` returns:

```text
/sync?canvasId=<childCanvasId>
```

Child NVCL mutations are recorded in the child room rather than the root room.

### Persistent trajectory Resources

`registerTrajectory` now writes to SQLite. MCP trajectory Resource reads fall back to the persistent repository after restart.

## Verification

Automated suite:

```text
37 tests
37 passed
0 failed
```

New Phase 6 tests prove:

- root and child objects survive a complete server close/reopen cycle;
- trajectory Resources remain readable after restart;
- restore emits a `state_replace` room update;
- the restored object state matches the snapshot;
- root and child room IDs, vectors, update counts, and handles are independent.

The repeatable Phase 6 demo confirms all six assertions in `artifacts/phase6-demo-report.json`.

## Evidence result

```text
synchronizedRestoreObserved = true
restoredXMatchesSnapshot    = true
restartRecovered            = true
childWorldRecovered         = true
trajectoryRecovered         = true
independentRooms            = true
```

## Remaining limitations

1. Checkpoint persistence is snapshot-based; event replay is not yet the canonical recovery mechanism.
2. State replacement transmits the complete serialized workspace and will not scale to large canvases.
3. All rooms share one process and one `CanvasStore`; this is not distributed subdocument isolation.
4. Room compaction, snapshot retention, garbage collection, schema migration tests, and blob integrity repair remain future work.
5. The reference state-vector protocol is not Yjs-compatible.
6. MCP conformance, OAuth, official SDK integration, production WebSocket security and rate limits remain incomplete.
7. `node:sqlite` is experimental on the minimum supported Node 22 line.

## MVP conclusion

Phase 0–6 now prove the intended minimum:

```text
AI observes a persistent canvas through MCP
→ performs typed local actions
→ changes synchronize to the correct canvas room
→ NVCL renders, verifies, repairs, and folds recursive work
→ state, snapshots, events, and trajectories survive restart
→ restore propagates through the synchronization layer
```

This is sufficient to close the original MVP cycle. Further work should be treated as post-MVP productization or experimental extension rather than unfinished Phase 6 work.

# Phase 1 Architecture

```text
                                ┌────────────────────────┐
                                │ Browser Infinite Canvas│
                                │ SVG + Pan + Zoom       │
                                └───────────┬────────────┘
                                            │ HTTP / SSE
                                            ▼
┌──────────────┐     transaction     ┌─────────────────────┐
│ Canvas Schema│ ───────────────────► │ SVG CanvasAdapter   │
└──────┬───────┘                      └──────────┬──────────┘
       │                                         │
       ▼                                         ▼
┌─────────────────┐                      ┌─────────────────┐
│ Canvas Core     │ ───────────────────► │ SVG Renderer    │
│ atomic truth    │                      │ visual projection│
└──────┬──────────┘                      └─────────────────┘
       │ committed event
       ▼
┌─────────────────┐
│ SQLite Ledger   │
│ causal history  │
└─────────────────┘
```

## Authoritative state

`CanvasStore` remains authoritative in Phase 1. The browser receives a projection through `/api/state` and never directly mutates the authoritative object graph.

## Adapter invariant

Every visual engine must implement:

```ts
interface CanvasAdapter {
  getViewport(): Promise<Viewport>
  setViewport(viewport: Viewport): Promise<void>
  listObjects(canvasId: string, query?: CanvasQuery): Promise<CanvasObject[]>
  applyTransaction(transaction: CanvasTransaction): Promise<TransactionResult>
  render(request: RenderRequest): Promise<RenderResult>
  subscribe(listener: CanvasDeltaListener): () => void
}
```

## Rendering path

$$
\text{CanvasObject[]}
\rightarrow
\text{z-index sort}
\rightarrow
\text{SVG primitives}
\rightarrow
\text{viewport viewBox}
\rightarrow
\text{browser projection}
$$

## Real-time boundary

Phase 1 uses SSE for low-frequency committed transaction notifications. It does not yet synchronize fine-grained concurrent state. Phase 2 replaces this boundary with Yjs updates and Awareness while retaining the same adapter contract.

## Phase 2 synchronization layer

```text
Browser / Agent Client
  ├─ WebSocket hello(stateVector, presence)
  ├─ SyncUpdate(clientId, counter, transaction)
  └─ Presence(cursor, viewport, selection, task)
            │
            ▼
CanvasWebSocketHub
            │
            ▼
StateVectorSyncRoom
  ├─ idempotency
  ├─ counter validation
  ├─ reconnect diff
  ├─ ephemeral presence
  └─ SQLite sync update log
            │
            ▼
CanvasAdapter → CanvasStore → Event Ledger
```

The Phase 2 reference engine is provider-neutral and is not wire-compatible with Yjs. A future Yjs adapter may replace `StateVectorSyncRoom` without changing `CanvasTransaction` or the canvas data model.

## Phase 3 MCP control plane

Phase 3 adds a provider-neutral MCP boundary above the existing CanvasAdapter and StateVectorSyncRoom.

```text
MCP Client
  -> /mcp session + JSON-RPC
  -> MCP Tool Registry
  -> CanvasTransaction
  -> StateVectorSyncRoom
  -> SvgCanvasAdapter / CanvasStore
  -> WebSocket peers + Resource notifications + Event ledger
```

The MCP layer never edits `CanvasStore` directly for ordinary mutations. Create, patch, delete, and subcanvas operations are converted to normal transactions and submitted through the same synchronization room used by browser clients.

Resources expose workspace, canvas, viewport, SVG render, object, event, and snapshot views. The reference server implements only the compatibility matrix documented in `MCP_COMPATIBILITY.md`.

## Phase 4：NVCL Agent Runtime

Phase 4 新增一個不直接依賴 CanvasStore 的 Agent Runtime：

```text
NvclAgent / NvclModelProvider
        ↓
McpCanvasClient
        ↓
MCP Tools + Resources
        ↓
CanvasTransaction / Render / Verify / Snapshot
        ↓
Sync Room + Event Ledger
```

Agent 只產生 `canvas.*` Tool Call 或 Stop 決策。Runtime 負責觀察組合、決策驗證、預算、最佳快照、恢復與軌跡保存。

## Phase 5：Recursive Subcanvas Runtime

Phase 5 adds a recursive orchestration layer above the existing flat NVCL runtime:

```text
RecursiveNvclRuntime
  ├─ parent snapshot
  ├─ MCP open_subcanvas
  ├─ child NvclRuntime
  ├─ child verify / repair / stop
  ├─ MCP fold_subcanvas
  ├─ MCP get_lineage
  └─ parent restore on failure
```

The child canvas remains a first-class `CanvasDocument`. The parent portal stores a reopen handle and folded metadata:

```text
childCanvasId
childRunId
childStatus
childRevision
childObjectCount
childIssueCount
previewResourceUri
foldedAt
```

A successful recursive path commits four causal transactions in the reference demo:

1. create parent portal and child canvas;
2. create child objects;
3. locally repair the child label;
4. fold the verified summary into the parent portal.

A failed child path restores the complete pre-delegation parent snapshot, removing both portal and child world.

## Phase 6: Durable recovery and per-canvas synchronization

Phase 6 introduces a persistence and synchronization hardening layer:

```text
CanvasStore
  ├─ serialize / hydrate complete workspace state
  ├─ automatic SQLite checkpoints
  └─ shutdown recovery checkpoint

CanvasSyncRegistry
  ├─ roomFor(rootCanvas)
  ├─ roomFor(childCanvas)
  ├─ hubFor(canvasId)
  └─ /sync?canvasId=<id>

Snapshot restore
  └─ state_replace update → all known canvas rooms → peers reload authoritative state
```

The root and each child now have independent vectors and presence state, while remaining backed by one in-process store in the MVP.

## Phase 7: Interactive multimodal canvas laboratory

Phase 7 adds a guarded experimental layer without changing the authoritative canvas model:

```text
Browser or MCP client
        ↓
lab.observe(pixel | structured | hybrid)
        ↓
immutable frame lease
  ├─ frame_id
  ├─ canvas revision
  ├─ state SHA-256
  ├─ render SHA-256
  └─ expiry
        ↓
lab.act(action_id, frame_id, expected_revision)
        ↓
CanvasTransaction or viewport transition
        ↓
StateVectorSyncRoom → SVG Adapter → Event Ledger
        ↓
after frame + Transition Guard + oracle verification
```

Undo and Redo reuse Phase 6 synchronized state replacement. Pixel mode withholds object IDs; hybrid mode reserves structured state for post-action verification.

## Phase 8: Pixel-native multimodal agent loop

Phase 8 adds a Provider boundary above the guarded laboratory:

```text
MultimodalCanvasLab
  → immutable SVG frame
  → Resvg full/cropped PNG + raster hash lineage
  → PixelProviderRequest (PNG, dimensions, goal, safe feedback)
  → MultimodalProvider
  → coordinate-only Gesture IR
  → crop projection + runtime hit-test
  → fresh guarded action
  → structured oracle + episode metrics
```

The Provider-neutral runtime recursively rejects object-identifier fields. Object identities may appear in trusted transaction and audit evidence after hit-testing, but never in pixel-mode Provider input or feedback.

The first experimental Provider uses a versioned local Codex CLI App Server with an ephemeral read-only thread and no dynamic tools. It is replaceable through the same `MultimodalProvider` interface.

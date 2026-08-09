# MCP 相容性矩陣

基線：MCP `2025-11-25`。

| 能力 | Phase 3 | 備註 |
|---|---:|---|
| initialize | 支援 | 僅接受 `2025-11-25` |
| Session ID | 支援 | 記憶體 session |
| initialized notification | 支援 | POST 回覆 202 |
| ping | 支援 | 空結果 |
| tools/list | 支援 | 15 個 Canvas Tools |
| tools/call | 支援 | typed transaction bridge |
| resource_link content | 支援 | Tool output 附 URI |
| resources/list | 支援 | 5 個固定資源 |
| resources/templates/list | 支援 | Canvas、Viewport、Render、Object、Snapshot |
| resources/read | 支援 | JSON 與 SVG text |
| resources/subscribe | 支援 | exact URI subscription |
| resources/unsubscribe | 支援 | exact URI |
| resources updated notification | 支援 | SSE `notifications/resources/updated` |
| Streamable HTTP POST | 相容子集 | 單一 JSON-RPC request |
| GET SSE | 相容子集 | server notifications |
| DELETE session | 支援 | 關閉 streams 與 session |
| JSON-RPC batch | 不支援 | 後續 SDK Adapter |
| resumability | 不支援 | 無 Last-Event-ID |
| OAuth | 不支援 | MVP header role only |
| Prompts | 不支援 | 非 Phase 3 範圍 |
| Sampling | 不支援 | 非 Phase 3 範圍 |
| Elicitation | 不支援 | 非 Phase 3 範圍 |
| Logging | 不支援 | 使用本地事件帳本 |
| Tasks | 不支援 | Phase 4 可加入 NVCL run |
| stdio | 不支援 | HTTP 優先驗證 |
| official SDK | 未使用 | 執行環境無法取得套件 |
| conformance suite | 未執行 | 不宣稱完整合規 |

## Phase 4 extension

Phase 4 adds an application-defined trajectory resource:

```text
canvas://workspace/{workspaceId}/trajectory/{runId}
```

It is readable through standard `resources/read`, but its registration and persistence are MRMIC application behavior rather than a new MCP protocol primitive. In v0.5 the trajectory registry is in-memory and is not included in `resources/list` unless the client already knows the URI.


## Phase 5 extension

Phase 5 adds two application-domain Canvas Tools:

```text
canvas.fold_subcanvas
canvas.get_lineage
```

`fold_subcanvas` is a normal synchronized parent-canvas transaction. `get_lineage` is read-only and follows `CanvasDocument.parentCanvasId` plus `parentObjectId`. Neither tool changes the MCP protocol itself.

## Phase 6 extension

Phase 6 changes two application semantics without expanding the MCP protocol surface:

- `canvas.create_snapshot` persists the snapshot in SQLite.
- `canvas.restore_snapshot` emits synchronized `state_replace` updates and reports `synchronized: true`.
- `canvas.open_subcanvas` returns a per-canvas WebSocket `syncHandle`.
- trajectory Resources fall back to the persistent SQLite repository after restart.

The `state_replace` record belongs to the MRMIC synchronization protocol, not to MCP itself. MCP remains the control and resource interface.

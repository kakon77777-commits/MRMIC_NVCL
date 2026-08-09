# ADR-004：NVCL Agent Runtime 必須經 MCP 操作畫布

## 狀態

Accepted — Phase 4 v0.5

## 決策

NVCL Agent 不取得 `CanvasStore` 或 `CanvasAdapter` 的直接寫入能力。所有觀察與行動均經由 `McpCanvasClient`：

- 觀察：`canvas.get_viewport`、`canvas.render_viewport`、Resource Read、`canvas.get_events`；
- 驗證：`canvas.verify`；
- 行動：`canvas.create_objects`、`canvas.patch_objects` 等；
- 恢復：`canvas.create_snapshot`、`canvas.restore_snapshot`。

Runtime 同時提供：

1. `LocalMcpCanvasClient`：經 MCP Server dispatch 執行，供單元與內嵌 Runtime；
2. `HttpMcpCanvasClient`：經真實 initialize/session/POST `/mcp` 執行，供端到端 Demo。

## 理由

若 Agent 可以直接修改核心 Map，便無法驗證：

- MCP 是否真的能作為行動基底；
- 權限與 schema 是否生效；
- 交易、同步、事件與 Resource Notification 是否一致；
- 未來模型供應商是否能替換。

## 後果

優點：

- 所有 Agent 行為可追蹤；
- 與人類、瀏覽器及遠端 Agent 共用相同交易入口；
- Runtime 不依賴特定 MCP Transport；
- 可測試權限與故障恢復。

代價：

- 觀察需要多次 MCP 呼叫；
- Snapshot 等 Runtime housekeeping 也會產生額外控制呼叫；
- 目前參考 Server 的完整協定相容性仍有限。

# ADR-003：Phase 3 採用 MCP 相容子集參考 Server

## 狀態

Accepted for MVP Phase 3；正式 SDK Adapter 尚未完成。

## 背景

MVP 技術白皮書選定 MCP `2025-11-25` 與 TypeScript SDK v1.x 作穩定基線。但交付環境無法取得新的 npm runtime dependency，而 Phase 3 的必要證明是：

$$
\text{MCP Tool}
\rightarrow
\text{Canvas Transaction}
\rightarrow
\text{Sync Update}
\rightarrow
\text{Canvas Peer}
$$

若因套件不可取得而只留下 interface，便無法驗證垂直閉環。

## 決策

Phase 3 實作零第三方依賴的 MCP `2025-11-25` 相容子集參考 Server，支援初始化、Session、Tools、Resources、Resource Subscription、Streamable HTTP 式 POST、SSE GET 與 DELETE Session。

核心 Tool、Resource URI 與 CanvasTransaction 不依賴參考 Transport 類別。後續正式 SDK 只替換 Protocol Adapter。

## 不宣稱事項

- 不宣稱官方 SDK 實作；
- 不宣稱通過完整 MCP conformance suite；
- 不宣稱支援 OAuth、Prompts、Sampling、Tasks 等未實作能力；
- 不把相容子集稱為完整 MCP Server。

## 結果

優點：

- 可在交付環境完整測試 MCP 垂直閉環；
- 無假依賴；
- Tool／Resource 契約可立即供 Agent Runtime 使用；
- 正式 SDK 升級邊界清晰。

代價：

- 必須維護相容性測試；
- 部分 Transport 邊界可能與官方 SDK 有差異；
- 上線前仍必須換入官方 SDK 或通過正式 conformance 驗證。

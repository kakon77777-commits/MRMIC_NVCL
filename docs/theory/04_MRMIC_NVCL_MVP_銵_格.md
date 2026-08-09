# MRMIC／NVCL MVP 技術白皮書

## MCP 原生遞歸多模態無限畫布與原生視覺建構迴路的最小可行工程規格

**英文題名：** MRMIC/NVCL MVP Technical White Paper: Minimal Engineering Specification for an MCP-Native Recursive Multimodal Infinite Canvas  
**作者：** Neo.K  
**日期：** 2026-07-30  
**文件類型：** Markdown 技術白皮書  
**版本：** v0.1  
**實作階段：** MVP-0  
**狀態：** 可進入工程實作

---

## 摘要

本白皮書將前三篇理論文件轉換為可直接實作的最小工程契約。前三篇文件分別回答：原生模型是否可能具有可辨識的符號視覺表達、原生繪圖能力如何透過感知—動作—修正循環成長，以及該循環需要何種持續存在的多模態世界。本文不再延伸基礎理論，而固定第一版的系統邊界、資料模型、MCP Tools、MCP Resources、即時狀態同步、事件帳本、畫布適配器、NVCL Agent 迴路、測試方法及交付條件。

第一版採用「MCP 控制平面、畫布核心狀態、增量同步平面、事件帳本、Agent Runtime」五層架構。MCP 不被用作每一筆游標移動或圖形採樣的高頻同步通道，而是所有 AI 可讀資源與可執行能力的標準控制介面；細粒度狀態差異由 CRDT 或相容的增量同步層負責；完整因果歷史另存於 append-only 事件帳本。前端初期使用 tldraw 作為可替換的畫布引擎適配器，以加速 Agent 視覺操作驗證，但核心物件模型、事件格式與 MCP schema 不依賴 tldraw 私有資料結構。

MVP 僅驗證一個核心閉環：AI 能透過 MCP 取得局部畫布狀態及渲染畫面，使用穩定物件 ID 執行局部修改，接收即時同步後的新狀態，觀看結果、驗證任務並在必要時繼續修補。MVP 不包含完整影片、音訊、3D、無限深遞歸、多 AI 自治治理或模型訓練。若此閉環成立，後續版本才依序加入子畫布、多 Agent 分支、超圖、時間軸、多模態物件與軌跡訓練。

---

# 第一章　文件目的與工程原則

## 1.1 文件目的

本文的目的不是再次證明 MRMIC 或 NVCL 的理論合理性，而是回答：

1. 第一版究竟要做什麼；
2. 哪些功能明確不做；
3. 系統資料如何表示；
4. AI 如何透過 MCP 看見與改變畫布；
5. 即時同步與因果記錄如何分工；
6. 如何判斷 MVP 是否成功；
7. 如何避免第一版被單一畫布 SDK、模型供應商或協定版本鎖死。

## 1.2 核心工程公式

第一版系統定義為：

$$
\mathrm{MRMIC\text{-}MVP}
=
\mathrm{CanvasCore}
+
\mathrm{CanvasAdapter}
+
\mathrm{MCPControl}
+
\mathrm{DeltaSync}
+
\mathrm{EventLedger}
+
\mathrm{NVCLRuntime}.
$$

各層責任為：

$$
\mathrm{CanvasCore}
=
\text{標準物件、畫布、視口與交易狀態}
$$

$$
\mathrm{CanvasAdapter}
=
\text{把標準狀態映射到實際畫布引擎}
$$

$$
\mathrm{MCPControl}
=
\text{AI 可讀資源與可執行工具}
$$

$$
\mathrm{DeltaSync}
=
\text{多端增量同步與最終一致}
$$

$$
\mathrm{EventLedger}
=
\text{完整操作來源、前後狀態與回放}
$$

$$
\mathrm{NVCLRuntime}
=
\text{觀察、規劃、行動、驗證與修補循環}
$$

## 1.3 工程原則

### 原則一：核心狀態不等於畫布 SDK 狀態

任何外部畫布引擎都只是適配器。核心資料不得直接以 tldraw shape record、Figma node 或其他產品私有格式作唯一真值。

### 原則二：MCP 是 Agent 系統呼叫層

所有 AI 可使用的畫布能力必須具有 MCP Tool；所有 AI 可讀取的持久狀態必須具有 MCP Resource 或 Resource Link。

### 原則三：MCP 不承擔高頻資料流

MCP 傳送任務級操作及結構化結果；自由筆跡、拖曳中間值、游標 presence 等高頻更新由同步層處理。

### 原則四：所有物件都具有穩定身分

局部修改必須引用永久物件 ID，而不是依賴「左邊第二個圓形」之類不穩定描述。

### 原則五：所有 Agent 寫入都是交易

多物件修改必須以單一交易提交、驗證、回滾及記錄。

### 原則六：局部觀察優先

AI 不讀取完整無限畫布，而依任務、視口、語義及權限取得局部投影。

### 原則七：失敗軌跡也是資料

執行失敗、驗證不通過、回滾和人工修正都必須保留於事件帳本。

---

# 第二章　MVP 範圍

## 2.1 MVP 必須完成的能力

第一版必須完成：

1. 一張可平移與縮放的無限畫布；
2. 文字、矩形、橢圓、線段、自由路徑、圖片及群組；
3. 每個物件具有穩定 ID；
4. AI 可透過 MCP 查詢畫布與視口；
5. AI 可建立、更新、移動、縮放、重排及刪除物件；
6. AI 可取得目前視口 PNG 或等價渲染結果；
7. AI 可同時取得視口內的結構化物件資料；
8. 修改後狀態可即時同步到前端；
9. AI 可重新觀看並進行第二輪局部修補；
10. 所有操作可由事件帳本回放；
11. 至少支援快照與回復；
12. 至少支援一層嵌套子畫布；
13. 單一 Agent 可完整跑完 NVCL 閉環；
14. 系統具備基本權限、輸入驗證及交易回滾。

## 2.2 MVP 明確不做

第一版不做：

- 完整 Photoshop 級像素編輯；
- 音訊編輯；
- 影片剪輯；
- 3D 場景；
- 多層時間軸；
- 無限深遞歸；
- 多 Agent 自動競標與治理；
- 完整語義超圖資料庫；
- 自動模型微調；
- 自我強化學習；
- 對外商業生產部署；
- 大規模多人協作；
- 跨專案全域搜尋；
- 完整 OCIF 匯入與匯出；
- 專用圖像模型呼叫。

## 2.3 第一個示範任務

MVP 的標準驗收任務為：

> 在空白畫布中建立一張包含標題、角色、月亮、地面與三個星星的簡單向量插畫；完成後檢查星星數量、角色與月亮的相對位置、標題是否遮擋主體，並只對錯誤區域進行局部修正。

此任務同時測試：

- 多物件建立；
- 物件計數；
- 空間關係；
- 圖層順序；
- 文字；
- 截圖回看；
- 結構驗證；
- 局部 patch；
- 多輪收斂。

---

# 第三章　技術選型

## 3.1 語言與儲存庫

MVP 使用全 TypeScript 架構：

- Node.js；
- TypeScript strict mode；
- pnpm workspace；
- ESM；
- Zod 或相容 Standard Schema；
- Vitest；
- Playwright。

採用單一語言的理由是降低 MCP Server、前端畫布、Schema、Agent Runtime 與測試之間的型別轉換成本。

## 3.2 建議 Monorepo

```text
mrmic-nvcl/
├── apps/
│   ├── web/
│   ├── mcp-server/
│   ├── sync-server/
│   └── agent-runner/
├── packages/
│   ├── canvas-schema/
│   ├── canvas-core/
│   ├── canvas-adapter/
│   ├── adapter-tldraw/
│   ├── mcp-contract/
│   ├── event-ledger/
│   ├── nvcl-runtime/
│   ├── verifier/
│   └── test-fixtures/
├── data/
│   ├── blobs/
│   ├── snapshots/
│   └── local.db
├── docs/
│   ├── architecture/
│   ├── api/
│   └── experiments/
└── scripts/
```

## 3.3 MCP 版本基線

MVP 以 MCP `2025-11-25` 穩定規格為基線。

原因：

- Resources、Tools、Resource Templates、Resource Subscription 與 Streamable HTTP 已足以實作 MVP；
- TypeScript SDK v1.x 為目前較適合穩定實作的版本；
- `2026-07-28` 架構變更與 SDK v2 不直接滲入核心業務邏輯。

定義協定適配介面：

```ts
export interface McpProtocolAdapter {
  protocolVersion(): string
  registerCanvasTools(registry: ToolRegistry): Promise<void>
  registerCanvasResources(registry: ResourceRegistry): Promise<void>
  createTransport(config: TransportConfig): Promise<McpTransport>
}
```

核心畫布及 Agent Runtime 不得直接依賴 SDK 的特定生命週期類別。

## 3.4 畫布引擎

### MVP 選擇

使用 tldraw 作為第一個 `CanvasAdapter`。

理由：

- 可快速建立無限畫布；
- 支援結構化 shape；
- 支援自訂 shape 與 tool；
- 已有 Agent Starter Kit；
- 可取得截圖及視口內結構；
- 適合驗證 AI 建立、修改、刪除及移動物件的閉環。

### 授權限制

tldraw SDK 在開發環境可直接使用，但生產部署需要 trial、commercial 或 hobby license。MRMIC 是商業公司專案，因此公開或商業部署前必須：

1. 取得適當授權；或
2. 更換為自研／其他畫布適配器。

因此核心層必須維持：

$$
\mathrm{CanvasCore}
\neq
\mathrm{TldrawStore}.
$$

### CanvasAdapter 介面

```ts
export interface CanvasAdapter {
  getViewport(): Promise<Viewport>
  setViewport(viewport: Viewport): Promise<void>
  listObjects(query: CanvasQuery): Promise<CanvasObject[]>
  applyTransaction(tx: CanvasTransaction): Promise<TransactionResult>
  render(request: RenderRequest): Promise<RenderResult>
  snapshot(): Promise<CanvasSnapshot>
  restore(snapshotId: string): Promise<void>
  subscribe(listener: CanvasDeltaListener): () => void
}
```

## 3.5 即時同步

MVP 使用 Yjs 作增量同步核心。

Yjs 提供：

- transaction；
- update event；
- binary update；
- state vector；
- 可交換、可結合且冪等的更新；
- awareness；
- subdocument。

第一版可使用 WebSocket Provider；資料持久化由 sync-server 寫入 SQLite 或檔案更新日誌。

注意：

- Yjs Subdocument 由 provider 負責同步；
- 第一版僅驗證一層子畫布；
- 不假設所有 provider 自動支援 Subdocument。

## 3.6 事件帳本與資料庫

MVP 使用 SQLite：

- WAL mode；
- append-only events table；
- transactions table；
- snapshots table；
- object metadata table；
- task runs table。

大型圖片或二進位資源放入 `data/blobs/`，SQLite 只保存內容位址、MIME、雜湊及 metadata。

## 3.7 Agent Runtime

Agent Runtime 供應商中立，使用以下抽象：

```ts
export interface MultimodalAgent {
  run(input: AgentInput): AsyncIterable<AgentDecision>
}

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelResponse>
}
```

第一版不在核心中寫死 OpenAI、Anthropic 或 Google。模型連接器放在獨立 provider package。

---

# 第四章　核心資料模型

## 4.1 Workspace

```ts
export interface Workspace {
  id: string
  title: string
  rootCanvasId: string
  createdAt: string
  updatedAt: string
  schemaVersion: string
}
```

## 4.2 Canvas

```ts
export interface CanvasDocument {
  id: string
  workspaceId: string
  parentCanvasId?: string
  parentObjectId?: string
  title: string
  bounds?: Bounds
  objectIds: string[]
  revision: number
  createdAt: string
  updatedAt: string
}
```

## 4.3 CanvasObject

```ts
export type CanvasObjectType =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'freehand'
  | 'text'
  | 'image'
  | 'group'
  | 'frame'
  | 'subcanvas'
  | 'agent_note'

export interface CanvasObject {
  id: string
  canvasId: string
  type: CanvasObjectType
  parentId?: string
  transform: Transform2D
  geometry: Geometry
  style: ObjectStyle
  content?: ObjectContent
  childIds: string[]
  bindings: Binding[]
  metadata: Record<string, unknown>
  createdBy: ActorRef
  createdAt: string
  updatedAt: string
  revision: number
}
```

## 4.4 Transform

```ts
export interface Transform2D {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
  zIndex: number
}
```

## 4.5 Binding

```ts
export interface Binding {
  id: string
  type:
    | 'attached_to'
    | 'inside'
    | 'points_to'
    | 'aligned_with'
    | 'subcanvas_of'
  fromId: string
  toId: string
  metadata?: Record<string, unknown>
}
```

## 4.6 ActorRef

```ts
export interface ActorRef {
  actorType: 'user' | 'agent' | 'system'
  actorId: string
  instanceId?: string
  sessionId?: string
}
```

## 4.7 CanvasTransaction

```ts
export interface CanvasTransaction {
  id: string
  canvasId: string
  actor: ActorRef
  intent: string
  expectedOutcome?: string
  preconditions: TransactionPrecondition[]
  operations: CanvasOperation[]
  mode: 'direct' | 'proposal' | 'branch'
  createdAt: string
}
```

## 4.8 CanvasOperation

```ts
export type CanvasOperation =
  | CreateObjectOperation
  | PatchObjectOperation
  | DeleteObjectOperation
  | ReorderObjectOperation
  | GroupObjectsOperation
  | SetViewportOperation
  | CreateSubcanvasOperation
```

所有 patch 必須是明確欄位更新，不接受任意 JavaScript：

```ts
export interface PatchObjectOperation {
  op: 'patch_object'
  objectId: string
  expectedRevision: number
  patch: {
    transform?: Partial<Transform2D>
    style?: Partial<ObjectStyle>
    content?: Partial<ObjectContent>
    metadata?: Record<string, unknown>
  }
}
```

## 4.9 RenderObservation

```ts
export interface RenderObservation {
  canvasId: string
  viewport: Viewport
  imageResourceUri: string
  visibleObjects: CanvasObjectSummary[]
  offscreenClusters: OffscreenCluster[]
  selectedObjectIds: string[]
  recentEvents: EventSummary[]
  verificationIssues: VerificationIssue[]
  revision: number
}
```

---

# 第五章　MCP Resource 規格

## 5.1 URI 命名

```text
canvas://workspace/{workspaceId}
canvas://workspace/{workspaceId}/canvas/{canvasId}
canvas://workspace/{workspaceId}/canvas/{canvasId}/viewport
canvas://workspace/{workspaceId}/canvas/{canvasId}/objects
canvas://workspace/{workspaceId}/object/{objectId}
canvas://workspace/{workspaceId}/render/{renderId}
canvas://workspace/{workspaceId}/events
canvas://workspace/{workspaceId}/snapshot/{snapshotId}
canvas://workspace/{workspaceId}/branch/{branchId}
canvas://workspace/{workspaceId}/trajectory/{runId}
```

## 5.2 Resource 分級

### Level 0：Workspace 摘要

只包含專案名稱、畫布列表、最近事件及當前任務。

### Level 1：Canvas 摘要

包含畫布 bounds、物件數量、視口、主要群集及子畫布入口。

### Level 2：Viewport

包含目前可見物件與 PNG。

### Level 3：Object

包含單一物件完整結構、來源、版本及關係。

### Level 4：Trajectory

包含某次 NVCL 執行的動作、觀察、回饋及結果。

## 5.3 Resource Subscription

MVP 支援訂閱：

```text
canvas://workspace/{workspaceId}/canvas/{canvasId}/viewport
canvas://workspace/{workspaceId}/events
canvas://workspace/{workspaceId}/trajectory/{runId}
```

但 Resource notification 只表達「有更新」及新 revision，不直接承載全部高頻 delta。

---

# 第六章　MCP Tool 規格

## 6.1 必要 Tools

### `canvas.get_state`

取得畫布摘要。

輸入：

```json
{
  "workspaceId": "ws-1",
  "canvasId": "canvas-root",
  "include": ["viewport", "summary", "recent_events"]
}
```

### `canvas.get_viewport`

取得視口資訊、物件摘要及渲染資源。

### `canvas.query_objects`

依 ID、型別、bounds、文字、metadata 或關係查詢物件。

### `canvas.create_objects`

以單一交易建立一組物件。

### `canvas.patch_objects`

局部修改現有物件。

### `canvas.delete_objects`

刪除指定物件；預設移至可恢復狀態。

### `canvas.set_viewport`

移動 AI 的觀察視口。

### `canvas.render_viewport`

產生目前視口或指定 bounds 的圖片。

### `canvas.verify`

檢查數量、空間、遮蔽、重疊、可見性及文字規則。

### `canvas.create_snapshot`

建立可回復快照。

### `canvas.restore_snapshot`

回復快照；屬高風險工具。

### `canvas.open_subcanvas`

取得或建立物件對應的一層子畫布。

### `canvas.get_events`

取得指定 transaction、object 或時間範圍事件。

## 6.2 Tool 結果統一格式

```ts
export interface CanvasToolResult<T> {
  ok: boolean
  transactionId?: string
  revision?: number
  data?: T
  warnings: CanvasWarning[]
  resourceLinks: string[]
  error?: CanvasError
}
```

## 6.3 Tool 安全規則

1. 所有輸入使用 JSON Schema 驗證；
2. 禁止任意程式碼；
3. 每個 object patch 檢查 expected revision；
4. 刪除、回復及主分支合併需明確批准；
5. 每筆 Tool call 必須寫入事件帳本；
6. Tool description 不能被視為可信安全政策；
7. Server 驗證 Workspace、Canvas、Object 與 Actor 權限；
8. HTTP 部署時驗證 Origin、Host 與身分。

---

# 第七章　同步層與事件帳本

## 7.1 雙層狀態模型

$$
\mathrm{CurrentState}
=
\operatorname{Reduce}
(
\mathrm{CRDTUpdates}
)
$$

$$
\mathrm{CausalHistory}
=
\mathrm{AppendOnlyEvents}
$$

CRDT 回答：

> 現在各端如何得到相同狀態？

事件帳本回答：

> 為什麼會變成此狀態？

## 7.2 Yjs 結構建議

```text
Y.Doc
├── workspace: Y.Map
├── canvases: Y.Map<Y.Map>
├── objects: Y.Map<Y.Map>
├── bindings: Y.Map<Y.Map>
├── presence: Awareness
└── subcanvases: Y.Map<Y.Doc>
```

不把大型圖片 base64 存入 Y.Doc，只保存 blob URI。

## 7.3 事件資料表

```sql
CREATE TABLE events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  workspace_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  transaction_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  object_ids_json TEXT NOT NULL,
  intent TEXT,
  payload_json TEXT NOT NULL,
  before_hash TEXT,
  after_hash TEXT,
  created_at TEXT NOT NULL
);
```

## 7.4 Transaction 資料表

```sql
CREATE TABLE transactions (
  transaction_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  canvas_id TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  intent TEXT NOT NULL,
  expected_outcome TEXT,
  status TEXT NOT NULL,
  validation_json TEXT,
  started_at TEXT NOT NULL,
  committed_at TEXT,
  rolled_back_at TEXT
);
```

## 7.5 快照

快照內容包括：

- Yjs state update；
- CanvasCore JSON；
- revision；
- 物件索引；
- blob references；
- state hash。

快照策略：

- 手動快照；
- Agent 任務開始前；
- 高風險交易前；
- 每固定事件數；
- 任務成功收斂時。

---

# 第八章　NVCL Runtime

## 8.1 單輪閉環

$$
O_t
\rightarrow
P_t
\rightarrow
A_t
\rightarrow
T_t
\rightarrow
O_{t+1}
\rightarrow
V_{t+1}.
$$

其中：

- $$O_t$$：觀察；
- $$P_t$$：計畫；
- $$A_t$$：MCP 動作；
- $$T_t$$：畫布交易；
- $$O_{t+1}$$：新觀察；
- $$V_{t+1}$$：驗證。

## 8.2 Runtime 狀態

```ts
export interface NvclRunState {
  runId: string
  goal: string
  workspaceId: string
  canvasId: string
  status:
    | 'planning'
    | 'acting'
    | 'observing'
    | 'verifying'
    | 'repairing'
    | 'completed'
    | 'failed'
    | 'cancelled'
  iteration: number
  maxIterations: number
  currentViewport: Viewport
  knownObjectIds: string[]
  openIssues: VerificationIssue[]
  bestSnapshotId?: string
}
```

## 8.3 Agent 輸入

每輪只提供：

1. 使用者目標；
2. 當前視口圖片；
3. 視口內物件摘要；
4. 視口外群集摘要；
5. 近期事件；
6. 驗證問題；
7. 可用 MCP Tool schema；
8. 剩餘迭代與 Token 預算。

## 8.4 Agent 輸出

Agent 不直接輸出 SVG 或任意程式，而輸出：

```ts
export interface AgentDecision {
  rationaleSummary: string
  action:
    | { type: 'tool_call'; name: string; arguments: unknown }
    | { type: 'move_viewport'; viewport: Viewport }
    | { type: 'verify'; rules: VerificationRule[] }
    | { type: 'stop'; reason: string }
}
```

`rationaleSummary` 只保存可公開、可操作的決策摘要，不要求或保存隱藏推理鏈。

## 8.5 停止條件

$$
\operatorname{Stop}
\iff
E_s<\tau_s
\land
E_g<\tau_g
\land
E_o<\tau_o
\land
N_{\mathrm{open}}=0
$$

或：

$$
\operatorname{Stop}
\iff
i\geq i_{\max}.
$$

達到最大迭代時回復最佳快照，不一定保留最後狀態。

---

# 第九章　驗證器

## 9.1 第一版規則驗證

### 數量

```ts
count(type = 'star') === 3
```

### 空間

```ts
isAbove('moon', 'character') === true
```

### 包含

```ts
isInside('title', 'frame') === true
```

### 遮擋

```ts
overlapRatio('title', 'character') < 0.10
```

### 可見性

```ts
visibleArea('character') > 0.85
```

### 邊界

```ts
isWithinCanvasBounds(objectId) === true
```

### 關聯

```ts
isAttached('arm-left', 'body') === true
```

## 9.2 視覺驗證

第一版使用：

- 截圖回看；
- OCR 僅在必要時使用；
- 簡單 CV 幾何分析；
- 多模態模型評論；
- 結構規則作最終硬驗證。

多模態模型評分不得單獨批准高風險交易。

## 9.3 驗證輸出

```ts
export interface VerificationIssue {
  id: string
  severity: 'info' | 'warning' | 'error'
  rule: string
  objectIds: string[]
  message: string
  suggestedOperation?: CanvasOperation
}
```

---

# 第十章　子畫布 MVP

## 10.1 一層嵌套

MVP 只支援：

$$
\mathrm{RootCanvas}
\rightarrow
\mathrm{Subcanvas}.
$$

暫不支援：

$$
\mathrm{Subcanvas}
\rightarrow
\mathrm{SubSubcanvas}.
$$

## 10.2 Subcanvas Object

```ts
export interface SubcanvasObject extends CanvasObject {
  type: 'subcanvas'
  content: {
    childCanvasId: string
    previewResourceUri?: string
    loadState: 'unloaded' | 'loading' | 'loaded' | 'error'
  }
}
```

## 10.3 延遲載入

子畫布預設不載入完整內容。AI 開啟時：

1. MCP `canvas.open_subcanvas`；
2. 載入對應 Y.Doc；
3. 訂閱子畫布；
4. 取得摘要或視口；
5. 關閉時保留 handle。

---

# 第十一章　API 與資料一致性規則

## 11.1 Revision

每個 Canvas 與 Object 具有 revision。

Patch 必須攜帶：

```json
{
  "objectId": "obj-123",
  "expectedRevision": 7
}
```

若實際 revision 不符，返回：

```json
{
  "code": "REVISION_CONFLICT",
  "currentRevision": 8
}
```

Agent 必須重新讀取，不得盲目覆寫。

## 11.2 Idempotency

建立與交易工具接受 `idempotencyKey`。相同 key 重送時不得重複建立物件。

## 11.3 Transaction Origin

每筆同步更新保存：

```ts
{
  actorId,
  agentInstanceId,
  transactionId,
  mcpRequestId,
  runId
}
```

## 11.4 Blob 一致性

圖片採內容尋址：

$$
uri
=
\texttt{blob://sha256/<hash>}
$$

同內容只儲存一次。

---

# 第十二章　安全與治理

## 12.1 MVP 權限角色

- `owner`：完整操作；
- `editor`：可修改；
- `agent-direct`：可直接執行低風險交易；
- `agent-proposal`：只能提交提案；
- `viewer`：只讀。

## 12.2 低風險操作

- 建立一般物件；
- 移動；
- 改色；
- 改文字；
- 調整大小；
- 建立快照；
- 移動自己的視口。

## 12.3 高風險操作

- 批量刪除；
- 回復舊快照；
- 覆寫主分支；
- 匯出外部；
- 執行程式；
- 修改權限；
- 存取私人 blob。

MVP 中高風險操作一律需要使用者批准。

## 12.4 資料最小揭露

AI 只取得完成任務所需的畫布區域及 metadata。其他子畫布與私人資源不自動加入上下文。

---

# 第十三章　觀測與紀錄

## 13.1 必要 Metrics

- MCP tool call 成功率；
- MCP schema 驗證失敗率；
- transaction commit rate；
- rollback rate；
- object ID 引用正確率；
- revision conflict rate；
- CRDT update bytes；
- 同步延遲；
- render latency；
- Agent 平均迭代數；
- 局部 patch 成功率；
- 非必要重畫率；
- 任務完成率；
- 事件回放一致率。

## 13.2 Trace

每次 NVCL 執行產生：

```text
runs/{runId}/
├── goal.json
├── observations/
├── decisions/
├── tool-calls/
├── renders/
├── verifications/
├── transactions/
├── final-result.json
└── report.md
```

## 13.3 隱私

不保存模型隱藏思維鏈。只保存：

- 工具輸入輸出；
- 可公開的行動摘要；
- 畫布前後狀態；
- 驗證結果；
- 錯誤與回滾。

---

# 第十四章　測試策略

## 14.1 單元測試

- Schema 驗證；
- Transform；
- Bounds；
- Geometry；
- Patch；
- Revision；
- Permission；
- Transaction；
- Event hash；
- Snapshot。

## 14.2 整合測試

- MCP Tool 到 CanvasCore；
- CanvasCore 到 tldraw adapter；
- Transaction 到 Yjs update；
- Yjs update 到第二客戶端；
- Event ledger 寫入；
- Snapshot restore；
- Subcanvas load。

## 14.3 E2E 測試

以 Playwright 執行：

1. 開啟空白畫布；
2. Agent 建立物件；
3. 前端即時顯示；
4. 取得截圖；
5. 驗證器回報問題；
6. Agent patch；
7. 任務完成；
8. 重啟服務；
9. 狀態仍可恢復；
10. 事件可完整回放。

## 14.4 故障測試

- MCP 重複請求；
- WebSocket 中斷；
- 過期 revision；
- 不合法 object ID；
- Agent 中途取消；
- 交易只完成一半；
- Blob 遺失；
- 子畫布未載入；
- 資料庫鎖；
- 模型回傳錯誤 schema。

---

# 第十五章　成功判準

## 15.1 必須達成

MVP 判定成功需滿足：

1. 至少 95% 合法 MCP Tool call 可被正確執行；
2. 100% 非法 schema 被拒絕；
3. 物件 ID 引用正確率至少 98%；
4. 所有成功交易均可在另一客戶端同步；
5. 所有已提交交易均存在事件記錄；
6. 所有高風險失敗交易可回滾；
7. 標準任務能在十輪內完成；
8. 第二輪修正只改動錯誤區域；
9. 重啟後畫布與事件帳本可恢復；
10. 一層子畫布可建立、開啟、修改與重新載入。

## 15.2 理想但非必要

- 平均同步延遲低於 300 ms；
- 視口渲染低於 1 秒；
- 標準任務平均五輪內完成；
- 局部 patch 造成的非目標物件變更為零；
- Agent 能在沒有人工介入下完成標準任務。

---

# 第十六章　實作階段

## Phase 0：工程骨架

交付：

- pnpm monorepo；
- TypeScript strict；
- lint、test、CI；
- Canvas schema；
- SQLite migration；
- README。

## Phase 1：CanvasCore 與 tldraw Adapter

交付：

- 基本物件；
- 穩定 ID；
- Create、Patch、Delete；
- Viewport；
- Render；
- Snapshot。

## Phase 2：同步與事件帳本

交付：

- Yjs；
- WebSocket sync；
- origin；
- SQLite event ledger；
- reload；
- replay。

## Phase 3：MCP Server

交付：

- Resources；
- Tools；
- Streamable HTTP；
- stdio development transport；
- schema；
- resource links；
- permission middleware。

## Phase 4：NVCL Runtime

交付：

- Observe；
- Plan；
- Act；
- Render；
- Verify；
- Repair；
- Stop；
- Run trace。

## Phase 5：Subcanvas

交付：

- Subcanvas object；
- 一層 Y.Doc；
- lazy load；
- MCP open；
- preview。

## Phase 6：MVP 驗收

交付：

- 標準任務；
- E2E；
- 測試報告；
- 失敗記錄；
- MVP ZIP；
- 後續版本規格。

---

# 第十七章　不變核心與可替換元件

## 17.1 不變核心

以下視為產品核心：

- CanvasObject schema；
- CanvasTransaction；
- Event Ledger；
- MCP Tool contract；
- MCP Resource URI；
- NVCL run trace；
- VerificationIssue；
- CanvasAdapter interface。

## 17.2 可替換元件

以下可替換：

- tldraw；
- Yjs provider；
- SQLite；
- WebSocket server；
- 模型供應商；
- Render backend；
- Blob storage；
- MCP SDK 版本。

此區分保證 MVP 可以快速使用成熟工具，又不把長期產品鎖死。

---

# 第十八章　MCP 2026 適配策略

MVP 先使用 `2025-11-25`。

後續若 `2026-07-28` 與 TypeScript SDK v2 完成穩定驗證，新增：

```text
packages/
└── mcp-adapters/
    ├── adapter-2025-11-25/
    └── adapter-2026-07-28/
```

新版可利用：

- 無狀態協定；
- Extensions；
- 新版 Tasks；
- MCP Apps；
- 更適合網路路由及快取的部署方式。

但核心 Tools、Resources 與 CanvasTransaction 不因協定版號重寫。

---

# 第十九章　後續版本

## v0.2

- 多 Agent presence；
- proposal mode；
- branch；
- merge；
- region lease。

## v0.3

- 語義關係圖；
- 場景圖驗證；
- 物件依賴；
- 外擴查詢。

## v0.4

- 多層子畫布；
- folding；
- 多解析度摘要；
- 跨畫布引用。

## v0.5

- 音訊、影片及時間軸；
- 多模態 Resource；
- Agent 主動感知。

## v1.0

- 穩定 MCP Adapter；
- 多 Agent 治理；
- 完整可追溯發布；
- 軌跡資料集；
- NVCL 訓練介面；
- 原生視覺簽名評測。

---

# 第二十章　最終工程定義

MRMIC／NVCL MVP 不是：

- 另一個聊天白板；
- 把生圖模型放進畫布；
- 用 AI 自動操作既有 UI；
- 重新製作 Photoshop；
- 一次性 SVG 產生器。

它的工程定義是：

$$
\boxed{
\text{一個以 MCP 為 Agent 系統呼叫層，
以可替換無限畫布為視覺世界，
以增量同步保存共享狀態，
以事件帳本保存因果經驗，
並讓 NVCL 能持續觀察、行動、修補與收斂的
原生多模態視覺智能基底。}
}
$$

MVP 的唯一核心證明目標是：

$$
\boxed{
\text{AI 能在持久畫布中，透過 MCP 完成可追溯的局部視覺閉環。}
}
$$

只要這一點被工程證明，後續超圖、遞歸、多 Agent、多模態與原生繪圖訓練才具有可靠基底。

---

# 參考依據

1. Model Context Protocol Specification `2025-11-25`：Base Protocol、Resources、Tools、Streamable HTTP 與實驗性 Tasks。
2. Model Context Protocol 官方 TypeScript SDK：MVP 使用 v1.x 穩定線，保留 v2 適配邊界。
3. Yjs 官方文件：Transactions、Document Updates、State Vectors、Awareness 與 Subdocuments。
4. tldraw 官方 Agent Starter Kit 與 AI Integration 文件：截圖、結構化 shapes、視口、串流 action 與 Agent 操作模式。
5. tldraw SDK 授權文件：開發環境可使用，生產環境需適當授權。
6. 前置理論文件：
   - 《原生符號繪圖假說》
   - 《原生視覺建構迴路》
   - 《MCP 原生遞歸多模態無限畫布》

---

# 文件狀態

- 本白皮書完成後，下一階段直接進入 MVP Phase 0。
- 後續實作中的實際限制優先於本文假設。
- 所有 schema 變更必須記錄版本與 migration。
- MVP 成功後再補系列技術論文與實驗報告，不在開工前繼續擴張理論範圍。

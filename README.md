# MRMIC／NVCL Phase 12 v0.13

Phase 12 完成兩個彼此分離的觀察實驗：一個能在普通 burst coalescing 中保住 A→B→A 瞬態的 hybrid policy，以及一個只有雙重 opt-in 才能消耗 Codex Account 容量的真實 Provider A/B runner。

```text
immutable pixel samples
  ├─ transient-preserving hybrid
  │    local A→B→A reversal detector
  │      → flush B before return sample enters burst
  │      → no object ID / no action authority
  └─ opt-in real Provider A/B
       identical five-frame source trace
       ├─ always_full: 5 calls
       └─ governor_roi: 3 calls
            → semantic accuracy + Token + latency evidence
```

## Phase 12 新增

- `hybrid_transient` policy：在 Governor 與 Passive Scene Timeline 之間加入本地 A→B→A 邊界偵測；不把 hidden state 或物件 ID 傳給 Provider。
- 五策略 identical-sequence benchmark：`always_full`、`static_crop`、`governor_roi`、`passive_timeline`、`hybrid_transient`。
- `lab.observe_passive` 可選 `boundaryMode: "transient_preserving"`，並回報 `return_to_recent_visual_state` 與 interruption 統計。
- `RealProviderABRunner`：在兩個隔離 Lab 重播相同五影格來源，量測語義正確率、每次呼叫 Token 與延遲。
- `CodexAccountMultimodalProvider.observeVisual`：只做 schema-bound 視覺分類，不產生動作，也不能授權 SCL/action。
- 三層 fail-closed：明確環境 acknowledgement、命令列確認、固定 8-call 上限與正整數 Token 上限。
- capability probe 與離線 Provider-shaped fixture；未授權時是 0 次 inference。

Phase 0–11 仍完整保留，包括 typed canvas、同步、MCP、NVCL、Undo/Redo、immutable PNG、pixel Gesture IR、Observation Governor、Passive Scene Timeline 與四策略受控 A/B。

## 正式工作區與文件入口

正式本機 checkout 是 `D:\Ai\work together\MRMIC_NVCL`；GitHub `main` 是程式碼與工程文件的同步權威。外部研究母本與 Phase ZIP 不會鏡像進儲存庫。

- [文件總索引](docs/INDEX.md)
- [Canonical 理論入口](docs/theory/README.md)
- [理論來源與 SHA-256](docs/provenance/THEORY_SOURCE_MAP.md)

`docs/theory/canonical/` 保存唯一正式理論全文。未合併的 Phase 13 遠端分支是候選資料，不代表目前 `main` 或已驗收能力。

## 一般執行

需求：Node.js 22.5+、npm 10+。

```bash
npm install
npm run check
npm test
npm run phase12:demo
npm run lab
```

互動畫布預設位於 `http://127.0.0.1:4173`。

## 真實 Provider A/B（明確 opt-in）

只檢查本機 Codex App Server 與可用影像模型，不做推理：

```powershell
npm run phase12:probe
```

實際 A/B 必須同時提供精確 acknowledgement、確認旗標、固定 8-call budget 與自行選定的 Token budget：

```powershell
$env:MRMIC_REAL_PROVIDER_AB='I_UNDERSTAND_THIS_USES_CODEX_ACCOUNT_CAPACITY'
npm run phase12:codex-ab -- --confirm-real-provider-ab --max-provider-calls=8 --max-total-tokens=200000
Remove-Item Env:MRMIC_REAL_PROVIDER_AB
```

一般 `npm test`、Demo、MCP 與未確認的 CLI 呼叫都不會執行真實 Provider 推理。真實 A/B 也只做合成畫布的唯讀語義觀察；兩次 reversible restyle 由 trusted runner 執行並經 Freshness／Transition Guard 驗證，Provider 回覆不能觸發動作。

## MCP

Reference server 維持 26 個工具：15 個 `canvas.*` 與 11 個 `lab.*`。Phase 12 沒有增加可消耗帳戶容量的 MCP tool；真實 A/B 刻意只留在雙重 opt-in CLI。

`lab.observe_passive` 的 Phase 12 參數：

```json
{
  "timelineId": "viewer-timeline",
  "operation": "sample",
  "boundaryMode": "transient_preserving",
  "transientReturnDifferenceThreshold": 0.0005,
  "transientPulseDifferenceThreshold": 0.00005,
  "transientReversalRatio": 0.2
}
```

## 目前驗收摘要

- 自動測試：76/76；Phase 12 demo 已通過。
- 2 seeds × 5 policies = 10 個隔離 runs；每個策略 22/22 Freshness、22/22 Transition Guard，plan 與 full-PNG trace 在同一 seed 內完全一致。
- `hybrid_transient`：8 次投遞、301,745 bytes、避免 20 次投遞、79.7390% byte reduction、2 個 reversal boundaries，成功保留測試瞬態。
- `passive_timeline`：同為 8 次投遞但 378,922 bytes，未保留測試瞬態。
- Hybrid 的 exact post-state retention 仍為 6/21；它替換了被保留的中間狀態，沒有增加總數。
- 透明 ranking 仍推薦 `governor_roi`，因其在此 fixture 保留 21/21 exact post-state；這不是普遍最優定理。
- 真實 Provider A/B 已完成：相同來源 trace、相同 action plan、8/8 schema-valid 且語義正確；Governor 由 5 calls／104,313 total Tokens／62.978 秒降至 3 calls／58,010 total Tokens／29.568 秒，少 46,303 Tokens（44.3885%）與 33.410 秒（53.0503%）。

## 誠實邊界

- Hybrid 是像素 signature 的局部三影格 reversal heuristic，不是語義事件理解，也不保證捕捉所有短暫事件。
- `hybrid_transient` 會多做本地 full-raster signature 計算；byte 指標只計 Provider delivery，不代表總 CPU/GPU 成本。
- 真實 A/B 只比較五個受控合成影格；不證明任意影音、遊戲或桌面泛化。
- `max-total-tokens` 是下一次呼叫前的 continuation threshold，不是不可預知單次成本的嚴格最終封頂；本次 150,000 threshold 在第八次呼叫後累積為 162,323，之後不會再發出呼叫。
- MCP endpoint 仍是手寫 stateful `2025-11-25` subset；不宣稱 finalized stateless `2026-07-28` conformance。

詳見 `docs/HYBRID_TRANSIENT_POLICY.md`、`docs/REAL_PROVIDER_AB.md`、`docs/ADR-012_TRANSIENT_HYBRID_AND_PROVIDER_AB.md`、`docs/PHASE12_STATUS_REPORT.md`、`artifacts/phase12-hybrid-benchmark.json` 與 `artifacts/phase12-real-provider-ab.json`。

## License

見 `LICENSE`、`NOTICE.md` 與 `THIRD_PARTY_NOTICES.md`。

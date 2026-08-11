# MRMIC／NVCL Phase 10 v0.11

Phase 10 把 Phase 9 的單次自適應觀察擴展成可持續運行的「被動場景時間線」（Passive Scene Timeline）。Runtime 可以在使用者沒有逐次提問時持續取樣畫布，將短時間內的視覺變化合併為 bounded event，維護 scene epoch，並以週期性完整 keyframe 限制漂移。

```text
fresh immutable pixel frame
  → session-local Observation Governor
  → keyframe / full frame / ROI / skip
  → scene epoch + burst coalescing
  → pixel-only Passive Scene Event
  → Provider delivery only when an event is emitted
  → guarded coordinate action
  → freshness + before/after render hash + Transition Guard
```

## Phase 10 新增

- `PassiveObservationScheduler`：可注入 clock/sleep、可中止的持續取樣、手動 flush 與完整 reset。
- Scene Epoch：只有達到治理門檻的初始畫面或可見變化才推進；純週期重新同步不偽造場景變化。
- Burst Coalescing：短時間 ROI／full-frame 變化合併為一個事件，超出 ROI 面積預算時 fail-safe 回退到完整影格。
- Pixel-only Event：Provider-safe 結果只含 frame/raster metadata、統計與資源 URI，不含 canvas object ID 或影像 base64。
- `lab.observe_passive`：每個 MCP session／timeline 各自維護 scheduler；支援 sample、flush、reset。
- 固定與 held-out 生成序列：drag、restyle、resize、type text、draw path、delete、pan、zoom。
- Benchmark 每次動作都保存 action ID、freshness、Transition Guard 與前後 render SHA-256。
- 修正 freehand SVG 重複 `fill` 屬性，使嚴格 PNG rasterizer 可穩定處理手繪路徑。

Phase 0–9 仍完整保留：typed canvas、SQLite recovery、同步、MCP Resources/Tools、flat/recursive NVCL、互動畫布、Undo/Redo、immutable PNG、pixel Gesture IR、Codex Account Provider、stale recovery、Observation Governor 與 Token budget。

## 執行

需求：Node.js 22.5+、npm 10+。

```bash
npm install
npm run check
npm test
npm run phase10:demo
npm run lab
```

互動畫布預設位於 `http://127.0.0.1:4173`。

Phase 8 的真實 Codex Account 單動作驗收仍為 opt-in，因為會消耗帳戶容量：

```bash
npm run phase8:codex
```

## MCP 與 HTTP

目前 reference server 提供 25 個工具：15 個 `canvas.*` 與 10 個 `lab.*`。Phase 10 新工具：

```text
lab.observe_passive
  sample: 建立 pixel observation 並回傳本次 emitted events
  flush: 只送出尚未結束的 burst
  reset: 清除指定 session-local timeline 與 governor history
```

既有 Lab API：

```text
GET  /api/lab/observe?mode=pixel|hybrid|structured
GET  /api/lab/frame/{frameId}.svg
GET  /api/lab/frame/{frameId}.png
GET  /api/lab/raster/{rasterId}.png
POST /api/lab/action
POST /api/lab/undo
POST /api/lab/redo
POST /api/lab/benchmark/reset
GET  /api/lab/benchmark/verify
GET  /api/lab/trajectory
POST /mcp
GET  /mcp
WS   /sync?canvasId=<canvasId>
```

## Phase 10 驗收摘要

- 固定 seeds：`7, 42, 2026`；held-out seeds：`9001, 65537`。
- 5/5 runs PASS；40/40 freshness、40/40 Transition Guard。
- 55 次取樣產生 20 個事件，合併 27 個樣本，避免 35 次 Provider 投遞。
- PNG delivery：929,788 bytes；always-full baseline：2,914,396 bytes；減少 68.0967%。
- 自動測試與真實瀏覽器驗收結果見 Phase 10 completion report 與 `artifacts/`。

## 誠實邊界

- 這是受控的合成畫布，不是任意影片、遊戲或桌面環境。
- `skip` 表示低於目前 32×32 perceptual signature 的門檻，不表示世界絕對沒有變化；週期 keyframe 只能限制而不能消除漏失。
- Draw-path 在部分 seeds 會被 perceptual governor 視為低於門檻，但其 action Transition Guard 仍可通過；這個差異被保留為證據，不包裝成全知偵測。
- PNG byte reduction 不等於實測 Token reduction；Phase 10 沒有宣稱完成真實 multi-call Provider A/B。
- 被動時間線目前沒有音訊、旁白、語義事件分類或策略學習。
- MCP endpoint 仍是手寫的 stateful `2025-11-25` subset；尚未實作 finalized stateless `2026-07-28` core，也不宣稱正式 conformance。
- 字型造成的 raster 差異仍可能跨機器變動。

詳見 `docs/PASSIVE_SCENE_TIMELINE.md`、`docs/PHASE10_COMPLETION_REPORT.md`、`docs/ADR-010_PASSIVE_SCENE_TIMELINE.md` 與 `artifacts/phase10-passive-timeline-benchmark.json`。

## License

見 `LICENSE`、`NOTICE.md` 與 `THIRD_PARTY_NOTICES.md`。

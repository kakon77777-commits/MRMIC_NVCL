# ADR-009：持續多模態採用可信任的 Observation Governor

Status: Accepted

Version: `0.10.0`

Date: `2026-08-10`

## Context

Phase 8 證明單張 PNG 可以經 Provider 產生座標手勢並安全完成畫布動作，但「每個週期都傳完整影格」不適合持續觀察。靜態畫面會浪費 Provider 呼叫；局部變化不需要重送整個畫面；長時間只看局部差異又可能累積語境漂移。

Governor 必須留在可信任 Runtime。Provider 仍只看像素、目標與安全的觀察策略 metadata，不得取得畫布物件 ID 或結構化 oracle。

## Decision

在 Provider 前加入具狀態的 `ObservationGovernor`：

```text
fresh immutable frame
  → full local raster
  → compact 32×32 RGB perceptual signature
  → difference score + changed-block bounds
  → keyframe | full_frame | roi | skip
  → Provider only when pixels are delivered
```

決策規則：

1. 第一張、surface geometry 改變、stale recovery 或明確要求時送 keyframe。
2. 達到固定間隔時強制完整 keyframe，避免局部觀察累積漂移。
3. 低於感知差異門檻時回傳 `skip`，不呼叫 Provider。
4. 局部變化以 padding 與最小尺寸擴張成 ROI。
5. ROI 面積超過完整畫面的設定比例時回退 `full_frame`。

Governor 只保存上一張約 3 KiB 的 signature，不保存完整 RGBA 歷史。完整 PNG 仍在本地產生，以取得可驗證的 SHA-256 lineage；節省的是 Provider payload 與呼叫，不宣稱消除本地 raster 成本。Lab 對 frame 與 raster cache 設硬上限；快速觀察造成舊 frame 被逐出時，任何引用它的動作會以 `FRAME_NOT_FOUND` fail closed。

## Freshness and recovery

影格 freshness 現在同時綁定 lease、canvas、revision、state hash 與完整 viewport tuple（`x/y/width/height/zoom`）。任何一項改變都使舊座標失效。

若 Provider 回傳座標後發生 `STALE_FRAME`、`FRAME_NOT_FOUND` 或 `REVISION_CONFLICT`：

- 記錄遭拒絕的嘗試與錯誤碼；
- 不執行、也不重播舊座標；
- 取得新 pixel frame；
- 強制下一次為 keyframe；
- 由 Provider 對新影格重新產生決策。

## Token budget

Runtime 可設定 `maxTotalTokens`。它根據 Provider 已回報的實際累積用量，在下一次 Provider 呼叫前停止。第一個呼叫仍可能超過預算，因為在收到 Provider telemetry 前無法知道實際消耗。

## MCP boundary

`lab.observe_adaptive` 是 read-only 畫布操作；它會在 MCP session 內保存 Governor 歷史。相同 `governorId` 不會跨 session 共用，session 結束即釋放。設定只在建立 Governor 或 `reset: true` 時套用。

## Consequences

正面結果：

- 靜態週期可完全避開 Provider 呼叫；
- 局部變化只傳 ROI；
- 週期 keyframe 與 stale recovery 提供可稽核的重同步；
- 既有 object-ID 隔離、Action ID 與 Transition Guard 維持不變。

限制：

- 32×32 nearest-sampled signature 可能漏掉小於採樣格或短暫的變化；
- 門檻與 ROI 策略尚未依內容自動校準；
- PNG bytes 節省不等於 Token、延遲或成本同比例節省；
- 尚未加入音訊、時間語義、遮擋推理或任意影片的真實 A/B。

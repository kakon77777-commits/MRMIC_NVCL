# ADR-010: Passive Scene Timeline

Status: Accepted for Phase 10

Version: `0.11.0`

## Context

Phase 9 能對單次觀察選擇 keyframe、full frame、ROI 或 skip，但沒有 wall-clock scheduler，也無法把同一個互動 burst 合併成一個可消費事件。若每次畫面取樣都直接呼叫 Provider，持續性多模態會把靜止畫面與細碎中間狀態重複送出。

## Decision

在 Multimodal Lab 與 Provider 之間加入 session-local `PassiveObservationScheduler`：

1. 永遠從 pixel mode 取樣。
2. 以既有 Observation Governor 決定是否需要視覺 delivery。
3. 以 scene epoch 表示達到治理門檻的可見場景變更。
4. 在有限時間與有限 sample 數內合併 burst。
5. 週期性完整 keyframe 強制重新同步，但不把靜止重同步視為新 scene。
6. 透過 MCP read-only tool 暴露 sample/flush/reset；工具不獲得 mutation authority。

## Consequences

Provider delivery 數量和圖像 bytes 可顯著降低，且事件仍保留最新 frame/raster hash。代價是微小變化可能被 threshold 跳過，burst 會犧牲部分中間畫面，session state 也使 legacy MCP endpoint 仍然 stateful。

## Rejected alternatives

- 每次 sample 都送完整 frame：最簡單，但不適合持續觀察成本實驗。
- 只使用固定 crop：無法處理 pan/zoom 或變更區域漂移。
- 直接從 object delta 建 event：會破壞 pixel-native 實驗邊界並洩漏 oracle。
- 將 scheduler 與 action executor 合併：會讓「看見變化」隱含授權「做出操作」。

## Validation

Phase 10 使用三個 fixed 與兩個 held-out seeds，涵蓋八種 gesture。每個 action 都獨立通過 freshness 與 Transition Guard；timeline 結果另外檢查無 object ID、session/reset 隔離、periodic keyframe 與 burst union fallback。

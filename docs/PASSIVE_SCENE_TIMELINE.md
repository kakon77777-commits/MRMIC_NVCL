# Passive Scene Timeline Contract

Version: `0.11.0`

## Purpose

Passive Scene Timeline 讓 Runtime 在沒有逐次使用者提示的情況下，持續觀察受控畫布表面，並只在需要同步或出現足夠大的視覺變化時產生 Provider-safe event。它是觀察排程器，不是自主操作授權器；任何畫布修改仍必須走既有 Action ID、Freshness Gate 與 Transition Guard。

## Input boundary

Scheduler 只呼叫：

```text
MultimodalCanvasLab.observe('pixel')
ObservationGovernor.observe(frameId)
MultimodalCanvasLab.rasterize(frameId, optionalCrop)
```

它不讀取 `objects`、object ID、structured oracle 或內部 Canvas Store。Clock 與 sleep 可注入，以便 deterministic 測試。

## Scene epoch

初始 keyframe 建立 epoch 1。後續只有符合以下條件的 sample 才推進 epoch：

```text
disposition != skip
AND (differenceScore > 0 OR changedFraction > 0)
```

純靜止畫面的 periodic keyframe 是 resynchronization，不建立虛假的 scene change。低於 perceptual threshold 的真實 action 也可能不推進 epoch；action evidence 與 observation evidence 必須分開保存。

## Burst coalescing

局部變化先進入 pending burst，遇到下列任一條件便 flush：

- pending 起點已超過 `coalesceWindowMs`；
- pending sample 數到達 `maxCoalescedSamples`；
- 出現 keyframe；
- caller 明確呼叫 `flush()`；
- `run()` 結束或中止。

若所有 pending samples 都有 ROI，Runtime 取 bounding union；union 面積超過 `maxCoalescedRoiFraction` 時回退到最新完整 frame。任何 pending sample 為 full-frame 或 keyframe 時，事件使用最新完整 frame。

## Provider-safe event

每個事件包含：timeline/event index、sample range、scene epoch range、時間、disposition/reasons、最大差異分數、resynchronization、最新 frame/raster hash 與 raster metadata。事件不包含：

- object ID／affected object ID；
- structured object payload；
- raw PNG 或 base64；
- 點擊或 mutation authority。

PNG 透過 `lab://raster/{rasterId}` 資源按需讀取。

## Lifecycle

`sample()` 完成一次 pixel observation；`run()` 依固定 interval 反覆 sample，尊重 AbortSignal；`flush()` 只送出 pending burst；`reset()` 同時清除 timeline、stats、pending burst、scene epoch 與 Governor history。

MCP 的 `lab.observe_passive` 以 `(session, timelineId)` 隔離 scheduler。Session 關閉即丟棄；`reset: true` 重新建立 timeline，因此新的第一次 sample 必為 initial keyframe。

## Safety invariants

```text
PassiveEvent ⇒ pixel-only
PassiveEvent ⇒ no objectId
PhysicalOrCanvasMutation ⇒ separate authorized action
SceneEpochAdvance ⇒ governed visible change
PeriodicKeyframe ∧ no change ⇒ epoch unchanged
CoalescedRasterTooLarge ⇒ full-frame fallback
Reset ⇒ governor history and timeline history both empty
```

## Known limits

32×32 nearest-sampled signature 可能忽略小型或瞬時變化。時間戳目前來自 Runtime clock，而非影音同步時鐘。Timeline 只存在記憶體中，沒有持久化、音訊軌、語義分類或 retention policy。

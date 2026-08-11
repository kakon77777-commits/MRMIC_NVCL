# Observation Governor Contract

Version: `0.10.0`

## Purpose

`ObservationGovernor` 決定一個 fresh pixel frame 是否需要送往多模態 Provider，以及應送完整影格或局部 ROI。它不做語義辨識，也不授權動作。

## Default policy

| Setting | Default | Meaning |
|---|---:|---|
| `differenceThreshold` | `0.006` | 全域平均 RGB 差異低於此值可跳過 |
| `blockDifferenceThreshold` | `0.06` | 單一 signature block 視為改變的門檻 |
| `keyframeInterval` | `8` | 距上次 keyframe 的最大觀察序列 |
| `maxRoiFraction` | `0.55` | ROI 超過完整畫面比例時改送全畫面 |
| `roiPaddingPx` | `32` | changed bounds 的額外邊界 |
| `minimumRoiSize` | `96` | ROI 單邊最小像素 |

輸出 disposition：

```text
keyframe   完整影格，並重設 keyframe 間隔
full_frame 完整影格，但原因是變化區域過大
roi        局部 PNG，附完整影格座標 crop
skip       不附 raster，不應呼叫 Provider
```

每個結果都包含 sequence、reason、difference score、changed fraction、來源完整 PNG hash 與來源 byte length。ROI 另含 crop 與其 immutable raster metadata。

## Runtime integration

```ts
const governor = new ObservationGovernor({ lab })
const runtime = new MultimodalAgentRuntime({ lab, provider, governor })

const result = await runtime.run({
  goal: 'Move the red circle into the blue frame',
  adaptiveObservation: true,
  maxTotalTokens: 20_000,
})
```

指定固定 `crop` 時，Runtime 不啟用 Governor；`adaptiveObservation: false` 也可明確退回既有 always-full 行為。

Provider request 只會收到安全 metadata：

```json
{
  "observationPolicy": {
    "disposition": "roi",
    "sequence": 4,
    "reason": "localized_perceptual_change",
    "differenceScore": 0.0077,
    "changedFraction": 0.0146
  }
}
```

Provider 不會收到 signature、changed-block map、畫布物件 ID 或 structured oracle。

## MCP integration

`lab.observe_adaptive` parameters：

```json
{
  "governorId": "passive-observer",
  "reset": false,
  "differenceThreshold": 0.006,
  "blockDifferenceThreshold": 0.06,
  "keyframeInterval": 8,
  "maxRoiFraction": 0.55,
  "roiPaddingPx": 32,
  "minimumRoiSize": 96
}
```

第一次呼叫回 keyframe；同一 session 與 `governorId` 的靜態下一張可回 `skip`。不同 session 即使使用相同 ID，也會從獨立 keyframe 開始。

## Benchmark

執行：

```bash
npm run phase9:demo
```

固定 seeds `7, 42, 2026` 會重現靜態、兩次局部拖曳、全域平移與週期重同步。摘要在 `artifacts/phase9-governor-benchmark.json`。

此 benchmark 衡量交付 PNG bytes 與可避免的 Provider 呼叫，不把本地 raster 成本或 PNG bytes 誤寫成模型 Token。

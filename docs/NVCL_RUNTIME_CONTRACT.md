# NVCL Runtime Contract v0.5

## Runtime Input

```ts
interface NvclRunRequest {
  goal: string
  canvasId: string
  checks: NvclVerificationCheck[]
  maxIterations?: number
  maxConsecutiveFailures?: number
  runId?: string
  signal?: AbortSignal
}
```

## Observation

每輪觀察由五個來源組成：

1. `canvas.get_viewport`：視口、穩定物件 ID、revision；
2. `canvas.verify`：可重現的規則錯誤；
3. `canvas.render_viewport`：顯影 Resource Link；
4. `resources/read`：SVG 內容；
5. `canvas.get_events`：因果事件數量。

驗證規則若引用尚不存在的物件，Runtime 在物件建立前不呼叫該規則；count 類規則仍可在空畫布執行。

## Decisions

```ts
type NvclDecision =
  | {
      type: 'tool_call'
      tool: `canvas.${string}`
      arguments: Record<string, unknown>
      summary: string
    }
  | {
      type: 'stop'
      success: boolean
      reason: string
    }
```

Runtime 拒絕非 `canvas.*` 工具。

## Best-state policy

驗證分數：

```text
error   = 100
warning = 10
info    = 1
```

低分優先。每次分數嚴格改善時建立新最佳快照。

## Failure policy

以下情況回復最佳快照：

- Agent 明確 `stop(success=false)`；
- MCP Tool 達到連續失敗上限；
- 迭代耗盡；
- AbortSignal 已取消。

## Trace

每次 run 保存：

- `run_started`；
- `observation`；
- `decision`；
- `tool_result`；
- `best_snapshot`；
- `snapshot_restored`；
- `run_completed`／`run_failed`／`run_cancelled`。

不要求或保存模型隱藏推理鏈；只保存可操作摘要、MCP 輸入輸出與畫布證據。

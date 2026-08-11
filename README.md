# MRMIC／NVCL Phase 11 v0.12

Phase 11 把持續觀察從單一策略，提升成可重現的四策略 A/B 實驗。每個策略都在隔離畫布中重播相同 seed、相同座標動作與相同時間軸；獨立 audit lane 以完整 PNG SHA-256 證明來源畫面序列一致，再比較傳輸成本、可感知動作覆蓋、精確動作後狀態與瞬態事件保留。

```text
deterministic guarded action plan
  → isolated world per policy
  → independent full-PNG audit trace
  ├─ always_full
  ├─ static_crop
  ├─ governor_roi
  └─ passive_timeline
       ↓
cost + coverage + exact retention + transient retention
       ↓
transparent read-only ranking (never action authorization)
```

## Phase 11 新增

- `ObservationPolicyBenchmarkRunner`：以相同的 11 動作序列比較四種觀察策略。
- Audit lane：每次 sample 都保存完整 PNG hash，策略輸出無法改寫來源一致性證據。
- Tiny motion 與 transient-on/transient-restore fixture：直接量測微小變化和短暫狀態是否被保留。
- 明確成本／保留指標：delivery 次數、PNG bytes、perceptual coverage、exact post-state retention 與 transient retention。
- `rankObservationPolicies`：公開固定權重和 Pareto 標記；只排名使用者提供的摘要，不讀畫布、不呼叫 Provider、不授權動作。
- MCP `lab.rank_observation_policies`：viewer 可呼叫的唯讀純函式工具。
- 兩個 seed、八個隔離 world 的可重播 Demo 與 JSON evidence。

Phase 0–10 仍完整保留，包括 typed canvas、同步、MCP、NVCL、Undo/Redo、immutable PNG、pixel Gesture IR、Codex Account Provider、Observation Governor 與 Passive Scene Timeline。

## 執行

需求：Node.js 22.5+、npm 10+。

```bash
npm install
npm run check
npm test
npm run phase11:demo
npm run lab
```

互動畫布預設位於 `http://127.0.0.1:4173`。Phase 8 真實 Codex Account 單動作驗收仍為會消耗帳戶容量的 opt-in：

```bash
npm run phase8:codex
```

## MCP

Reference server 現有 26 個工具：15 個 `canvas.*` 與 11 個 `lab.*`。Phase 11 新工具：

```text
lab.rank_observation_policies
  input: 1–4 個已量測的 policy summary
  output: 固定權重分數、Pareto 標記與 recommendation
  side effects: 無畫布觀察、無狀態修改、無 Provider 呼叫、無動作授權
```

## Phase 11 驗收摘要

- 自動測試：69/69。
- 2 個 seeds × 4 policies = 8 個隔離 runs；每個策略 22/22 Freshness、22/22 Transition Guard。
- 所有策略的 action-plan SHA 與 full-PNG source-trace SHA 在各 seed 內一致。
- `governor_roi`：25 次投遞、491,840 bytes、21/21 可感知動作、21/21 精確動作後狀態、瞬態保留；相較 always-full 省 66.9748%。
- `passive_timeline`：8 次投遞、378,922 bytes、避免 20 次投遞；但只保留 6/21 精確動作後狀態，且瞬態狀態未保留。
- 固定透明評分推薦 `governor_roi`；這是受控 fixture 的工程決策，不是普遍最優定理。

## 誠實邊界

- 比較的是合成畫布與 PNG bytes，不是真實 Provider Token、快取計費或任意影音語義理解。
- 所有策略雖共享同一 deterministic plan，但因物件 UUID 不同，跨 run 一致性使用完整 PNG SHA，而不是含 ID 的 SVG hash。
- `static_crop` 的低 bytes 伴隨空間漏失；`passive_timeline` 的低投遞次數伴隨瞬態與精確中間狀態漏失。
- 排名工具只評估已提供的數據，不能成為 SCL、Freshness Gate 或 action authorization 的輸入捷徑。
- 目前仍沒有真實 multi-call Provider A/B、音訊、旁白、策略學習或非受控遊戲／桌面遷移證據。
- MCP endpoint 仍是手寫 stateful `2025-11-25` subset；不宣稱 finalized stateless `2026-07-28` conformance。

詳見 `docs/OBSERVATION_POLICY_AB.md`、`docs/PHASE11_COMPLETION_REPORT.md`、`docs/ADR-011_CONTROLLED_POLICY_AB.md` 與 `artifacts/phase11-observation-policy-ab.json`。

## License

見 `LICENSE`、`NOTICE.md` 與 `THIRD_PARTY_NOTICES.md`。

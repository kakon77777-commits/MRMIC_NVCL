# MRMIC／NVCL Phase 13 v0.14

Phase 13 把 MRMIC 收斂成 PMW 可機械協商、安全接入的 Canvas-first Visual World：Canvas 擁有幾何與投影，provider 保留原生資源權威，所有 secure-mode mutation 都由已驗 principal 綁定。

```text
PMW logical workspace
  → capability negotiation
  → authenticated Canvas session
  → native resource_portal_v1
       ├─ durable: geometry / projection
       ├─ ephemeral: runtime presence
       └─ provider-owned: browser / terminal / thread resource
```

## Phase 13 新增

- `GET /api/capabilities` 與 MCP resource `mrmic://capabilities` 回傳同一份 `mrmic-capabilities/v1`，明示版本、Canvas schema、MCP profile、projection/auth modes、portal 與 runtime-presence 支援。
- `native_resource_portal_v1` 固定 portal、PMW workspace/task、provider resource、display/interaction mode 與 optional owner semantic agent 欄位；Canvas 不冒充 provider resource owner。
- `compat_frame_v0` → `native_resource_portal_v1` 確定性 migration fixture 與 fail-closed parser。
- HTTP transaction、HTTP sync、WebSocket 與 MCP mutation 共用 bearer principal resolver；payload 中的 actor/semantic identity 只算 claimed，server 覆寫或拒絕。
- provider-neutral secure hello/ack、presence、runtime presence 與 error JSON schemas/examples；token 不進 broadcast、Canvas object、ledger 或公開 evidence。
- ephemeral runtime presence 以 authenticated channel 提供 identity，並對 stale epoch/revision/sequence fail closed。
- live portal host 明確分離 `mounted`、`visible`、`focused`、`controlOwner`；控制權可取得、釋放、撤銷，offscreen 不等於 provider resource destroyed。

Phase 0–12 均保留，包括 typed Canvas、同步、MCP、NVCL、Undo/Redo、immutable PNG、pixel Gesture IR、Observation Governor、Passive Scene Timeline、hybrid transient 與雙重 opt-in Provider A/B。

## 正式工作區與文件入口

正式本機 checkout 是 `D:\Ai\work together\MRMIC_NVCL`；GitHub `main` 是程式碼與工程文件的同步權威。外部研究母本與 Phase ZIP 不鏡像進儲存庫。

- [文件總索引](docs/INDEX.md)
- [Phase 13 PMW coverage matrix](docs/PHASE13_PMW_COVERAGE_MATRIX.md)
- [Phase 13 status report](docs/PHASE13_STATUS_REPORT.md)
- [Canonical 理論入口](docs/theory/README.md)
- [理論來源與 SHA-256](docs/provenance/THEORY_SOURCE_MAP.md)

`docs/theory/canonical/` 保存唯一正式理論全文；歷史 stacked branches 只是移植來源，不是 current-main authority。

## 一般執行

需求：Node.js 22.5+、npm 10+。

```bash
npm install
npm run check
npm test
npm run phase12:demo
npm run lab
```

互動畫布預設位於 `http://127.0.0.1:4173`。一般 test、demo、web 與 MCP 不會呼叫付費 Provider。

## Capability 與 secure mode

啟動 server 後，PMW 應先讀取：

```text
GET /api/capabilities
MCP resources/read mrmic://capabilities
```

設定 `MRMIC_PMW_BINDINGS_JSON` 後進入 `bearer_principal_v1` secure mode。未設定時保留單機 `legacy_local` compatibility；這個模式會由 capability document 明示，不能被誤認為已驗身份。

穩定 JSON schema 與 examples 位於 [`contracts/phase13/`](contracts/phase13/)。真實 bearer token 不得提交、broadcast 或寫入 durable Canvas evidence。

## MCP 邊界

Reference server 維持 26 個工具：15 個 `canvas.*` 與 11 個 `lab.*`。Capability 是 resource，不是新增 tool。當 secure mode 啟用，MCP session 綁定建立它的 principal，跨 principal 重用會 fail closed。

目前仍是手寫 stateful `2025-11-25` subset；不宣稱 finalized stateless `2026-07-28` conformance。真實 Provider A/B 不是 MCP tool，仍只存在雙重 opt-in CLI。

## Phase 12 真實 Provider A/B（歷史、明確 opt-in）

只檢查本機能力、不做推理：

```powershell
npm run phase12:probe
```

實際 A/B 需要 exact acknowledgement、確認旗標、call cap 與 Token continuation threshold。Phase 13 收斂沒有重跑這個付費實驗；既有證據保留於 `artifacts/phase12-real-provider-ab.json`。

## 驗收摘要

- 自動測試：175/175；TypeScript check 與 Phase 12 離線 demo 通過。
- Phase 13 negative controls 覆蓋 invalid portal、forged identity、unauthenticated agent/system presence、cross-principal MCP session、stale runtime revision/sequence 與 duplicate idempotency。
- capability HTTP/MCP document、migration fixture、secure client JSON、ephemeral runtime presence 與 live host control contract 均有離線測試。
- Phase 12 既有 Provider 證據仍是 8/8 schema-valid/semantic-correct；本輪沒有外部 Provider、Electron/WebView 或 PMW Python adapter E2E，因此不把契約測試宣稱為跨程序整合完成。

## 誠實邊界

- `resource_portal` 是 provider resource 的投影，不是資源所有權轉移。
- runtime presence 是 process-local ephemeral truth，不是 durable Canvas truth。
- live portal host 已驗契約與 negative controls，尚未證明特定 Electron/WebView host 的 production integration。
- provider-neutral JSON examples 已固定，但尚未在外部 Python PMW adapter 做跨 repo E2E。
- 不宣稱任意影音、遊戲、桌面泛化、production security review 或 MCP `2026-07-28` conformance。

## License

見 `LICENSE`、`NOTICE.md` 與 `THIRD_PARTY_NOTICES.md`。

# MRMIC／NVCL Phase 13 Current-Main Convergence Design

日期：2026-08-24
狀態：Neo.K 已批准 current-main、單一 branch、單一 PR 收斂方案

## 目標

從 `main@da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9` 建立唯一 canonical Phase 13 實作，port `6606b54..07da884` 的有效程式與測試，同時保留 current-main 的 canonical theory、文件索引、provenance、Unicode-safe audit 與 workspace-layout test。

## 不採用的整合方式

- 不直接 merge 或 rebase PR #7–#13。
- 不逐一 merge stacked PR。
- 不帶回舊 README、Phase 12 manifest、SHA sums 或四個亂碼 theory aliases。
- 不把 PMW 與 MRMIC 合併成一個 repository。
- 不執行真實 Provider A/B。

## Source provenance

- Phase 13 source baseline：`6606b54532c0f327206e7c021120370044b6e0ff`
- Phase 13 source final：`07da8848314d5e0ca50e3e956c6b7af1883d0d83`
- Current main baseline：`da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9`
- Phase 13 source commits：30
- Current-main commits since common base：7

Port 採 path-level final-state import，並在 `docs/PHASE13_CONVERGENCE_PROVENANCE.md` 保存原 stack commit 範圍與排除項目。

## Versioned capability contract

Phase 13 版本為 `0.14.0`。新增 `mrmic-capabilities/v1`，由 HTTP `GET /api/capabilities` 與 MCP resource `mrmic://capabilities` 回傳同一 JSON：

- `mrmicVersion`
- `canvasSchemaVersion`
- `mcpProtocolProfile`
- `projectionModes`
- `authModes`
- `resourcePortal`
- `runtimePresence`
- `livePortalHost`

Capability payload 不含 token、principal binding、runtime presence 或私密路徑。

## Native resource portal v1

保留既有 descriptor：`portalId`、`pmwWorkspaceId`、`pmwTaskId?`、`provider`、`resourceKind`、`providerResourceId`、`displayMode`、`interactionMode`、`ownerSemanticAgentId?`。

新增：

- `contracts/phase13/native-resource-portal-v1.schema.json`
- `compat_frame_v0` input fixture
- `native_resource_portal_v1` output fixture
- `migrateCompatFrameV0()` deterministic migration
- migration note

Canvas 只保存 geometry、projection descriptor 與 preview reference；provider resource ownership 和 volatile runtime state 不進 canonical Canvas metadata。

## Authenticated mutation plane

所有 secure-mode mutation 共用 `IdentityResolver`：

- WebSocket update／state replacement
- HTTP `/api/transaction`
- HTTP `/api/sync/update`
- MCP mutation methods

角色矩陣：

- `viewer`：只讀，所有 mutation 拒絕。
- `agent-direct`：可提交一般 transaction／sync update／MCP mutation。
- `owner`：具 agent-direct 權限，另可 state replacement 與管理型操作。

caller payload 的 `actorId`／`semanticAgentId` 永遠是 claimed。server 以 authenticated principal 覆寫 actor；無 principal 時，secure mode fail closed。未設定 identity resolver 時保留 Phase 12 local compatibility，並由 capability contract 誠實回報。

## PMW secure client contract

保留既有 bearer hello、verified `hello_ack`、state-vector reconnect、identity-free presence/runtime input。新增 provider-neutral JSON schemas/examples，涵蓋 hello、ack、update、presence、runtime presence、stale rejection、removal、error。

Token 只存在 authentication transport；不得進 broadcast、Canvas object、event ledger、runtime presence state、fixture evidence 或公開報告。

## Ephemeral runtime presence

保留既有 required fields、verified-channel identity、epoch/revision/sequence monotonicity、disconnect removal、no persistence API 與 Herdr identity stripping。新增 JSON schema/example parity tests。

## Live portal host

Live host state 明確分離：

- `mounted`
- `visible`
- `focused`
- `controlOwner`

Activation 顯式；focus 與 control acquisition/release/revoke 也是顯式操作。Live-surface budget 可 unmount projection，但不刪 Canvas object 或 provider resource。任何 provider webview／WebContents 只存在 host adapter，不進 SVG canonical state。

## Acceptance

- current-main 76 tests 不退步。
- port 舊 stack 的 160 tests，保留 workspace-layout test。
- 新增 capability、migration、HTTP/MCP auth、JSON parity、focus/control-owner negatives。
- `npm run check`
- full tests
- Phase 12 offline demo
- secret scan
- Phase 13 manifest／SHA sums
- fixed-head GitHub CI

實際 test count 與 manifest file count只在完整執行後寫入，不預先猜測。

## Canonical PR

唯一 implementation branch：`agent/phase13-current-main-convergence`。唯一 main-target implementation PR。舊 #7–#13 在新 PR 合併前保持原狀；合併後才可標記 superseded，且該動作需要獨立權限確認。

## Not proven

- production multi-tenant security
- 任意桌面／遊戲／影音泛化
- audio runtime
- 真實 Provider 成本
- universal identity merge 或 hidden-context exchange
- Electron/WebContents production host implementation

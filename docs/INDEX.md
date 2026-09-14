# MRMIC／NVCL 文件索引

## 理論權威

- [Canonical theory sources](theory/README.md)
- [Theory source map](provenance/THEORY_SOURCE_MAP.md)

## 架構與契約

- [Architecture](ARCHITECTURE.md)
- [Multimodal Lab contract](MULTIMODAL_LAB_CONTRACT.md)
- [NVCL Runtime contract](NVCL_RUNTIME_CONTRACT.md)
- [Recursive Runtime contract](RECURSIVE_RUNTIME_CONTRACT.md)
- [MCP compatibility](MCP_COMPATIBILITY.md)
- [Phase 15 Observer-Relative Workspace](PHASE15_OBSERVER_RELATIVE_WORKSPACE.md)
- [ADR-013 Durable Observer Workspace Event Stream](ADR-013_OBSERVER_WORKSPACE_EVENT_DURABILITY.md)
- [ADR-014 Authenticated Observer Re-entry Protocol](ADR-014_OBSERVER_PROTOCOL_GATEWAY.md)
- [HDSRC × MRMIC/NVCL Integration Architecture v0.1](HDSRC_MRMIC_NVCL_INTEGRATION_ARCHITECTURE_v0.1.md)
- [HDSRC × MRMIC/NVCL Authority Matrix v0.1](HDSRC_MRMIC_NVCL_AUTHORITY_MATRIX_v0.1.md)
- [HDSRC × MRMIC/NVCL Integration Status v0.1](HDSRC_MRMIC_NVCL_INTEGRATION_STATUS_v0.1.md)
- [HDSRC Local Process Bridge Status v0.2](HDSRC_LOCAL_PROCESS_BRIDGE_STATUS_v0.2.md)
- [HDSRC Local Process Bridge Validation v0.2](HDSRC_LOCAL_PROCESS_BRIDGE_VALIDATION_v0.2.md)
- [HDSRC Local Process Bridge Rebinding Validation v0.2](HDSRC_LOCAL_PROCESS_BRIDGE_REBINDING_VALIDATION_v0.2.md)
- [HDSRC Runtime Manager Status v0.3](HDSRC_RUNTIME_MANAGER_STATUS_v0.3.md)
- [HDSRC Runtime Manager Validation v0.3](HDSRC_RUNTIME_MANAGER_VALIDATION_v0.3.md)
- [HDSRC Runtime Manager Pre-Merge Review Closure v0.3](HDSRC_RUNTIME_MANAGER_REVIEW_CLOSURE_v0.3.md)

## Phase 15 目前狀態

- [Observer-relative workspace, durability and protocol status](PHASE15_OBSERVER_RELATIVE_WORKSPACE.md)
- `contracts/phase15/` contains observer view, rendezvous, durable observer event and external observer command schemas.
- Reference re-entry server: `npm run observer` (default `127.0.0.1:4180`).

## Phase 13 目前狀態

- [Phase 13 PMW coverage matrix](PHASE13_PMW_COVERAGE_MATRIX.md)
- [Phase 13 status report](PHASE13_STATUS_REPORT.md)
- [Canvas-first PMW architecture](PHASE13_CANVAS_FIRST_PMW.md)
- [Portal migration](PHASE13_PORTAL_MIGRATION.md)
- [Historical stack provenance](PHASE13_CONVERGENCE_PROVENANCE.md)

## Phase 12 目前狀態

- [Phase 12 status report](PHASE12_STATUS_REPORT.md)
- [Hybrid transient policy](HYBRID_TRANSIENT_POLICY.md)
- [Real Provider A/B](REAL_PROVIDER_AB.md)
- [Next phase boundary](NEXT_PHASE.md)

## 設計決策

ADR-001 至 ADR-014 位於本目錄。ADR-013 固定 observer-relative workspace 的 durable event stream 與 durable/ephemeral 分界；ADR-014 固定 authenticated re-entry、principal-pinned MCP session、private snapshot 與 raw-event non-exposure 邊界。Phase 13 是 Canvas-first 安全收斂與跨專案契約層；Phase 15 在其上加入多觀察者私有視圖、持久化與選擇性會合。

## 驗收與證據

- [MVP acceptance matrix](MVP_ACCEPTANCE_MATRIX.md)
- [HDSRC v0.2 real-runtime evidence](../artifacts/hdsrc-local-process-v0.2/real-v010-validation.json)
- [HDSRC v0.2 real rebinding evidence](../artifacts/hdsrc-local-process-v0.2/real-v010-rebinding-validation.json)
- [HDSRC v0.3 real runtime-manager evidence](../artifacts/hdsrc-runtime-manager-v0.3/real-v010-validation.json)
- [HDSRC v0.3 routed-restart epoch evidence](../artifacts/hdsrc-runtime-manager-v0.3/real-v010-routed-restart-epoch.json)
- 發布 manifest：[`../MANIFEST.json`](../MANIFEST.json)
- 發布雜湊：[`../SHA256SUMS.txt`](../SHA256SUMS.txt)
- 有界實驗證據位於 [`../artifacts/`](../artifacts/)

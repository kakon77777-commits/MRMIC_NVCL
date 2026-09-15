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
- [Phase 15.7 WGC Bounded Frame Transport](PHASE15_7_WGC_BOUNDED_FRAME_TRANSPORT.md)
- [Phase 15.8 Windows Observer-Gated Portal Projection](PHASE15_8_WINDOWS_OBSERVER_PORTAL_PROJECTION.md)
- [Phase 15.9 Observer-Gated Bounded Refresh Loop](PHASE15_9_OBSERVER_BOUNDED_REFRESH_LOOP.md)
- [Phase 15.10 Interactive Windows User-Session E2E](PHASE15_10_INTERACTIVE_WINDOWS_E2E.md)
- [ADR-013 Durable Observer Workspace Event Stream](ADR-013_OBSERVER_WORKSPACE_EVENT_DURABILITY.md)
- [ADR-014 Authenticated Observer Re-entry Protocol](ADR-014_OBSERVER_PROTOCOL_GATEWAY.md)
- [ADR-015 Observer Nested Canvas Topology](ADR-015_OBSERVER_NESTED_CANVAS_TOPOLOGY.md)
- [ADR-016 Windows Desktop Window Provider](ADR-016_WINDOWS_DESKTOP_WINDOW_PROVIDER.md)
- [ADR-017 Windows Native Discovery Bridge](ADR-017_WINDOWS_NATIVE_DISCOVERY_BRIDGE.md)
- [ADR-018 Windows WGC Session Lifecycle](ADR-018_WINDOWS_WGC_SESSION_LIFECYCLE.md)
- [ADR-019 Windows Bounded Frame Transport](ADR-019_WINDOWS_BOUNDED_FRAME_TRANSPORT.md)
- [ADR-020 Observer-Gated Windows Portal Projection](ADR-020_OBSERVER_GATED_WINDOWS_PORTAL_PROJECTION.md)
- [ADR-021 Observer Lifecycle Bounded Refresh](ADR-021_OBSERVER_LIFECYCLE_BOUNDED_REFRESH.md)
- [ADR-022 Interactive Windows E2E Evidence](ADR-022_INTERACTIVE_WINDOWS_E2E_EVIDENCE.md)
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

- [Observer-relative workspace, durability, authenticated re-entry, nested topology and Windows provider status](PHASE15_OBSERVER_RELATIVE_WORKSPACE.md)
- [Current Windows validation slice: Phase 15.10](PHASE15_10_INTERACTIVE_WINDOWS_E2E.md)
- `contracts/phase15/` contains observer view/nested Canvas, rendezvous, durable observer event, external observer command, Windows provider/window/native bridge contracts, `windows_capture_snapshot_v1`, `live_portal_visual_frame_v1`, `observer_portal_refresh_policy_v1`, and `interactive_windows_e2e_v1`.
- Reference re-entry server: `npm run observer` (default `127.0.0.1:4180`). Nested entry requires an injected canonical Canvas topology authority.
- `@mrmic/provider-windows` remains the Windows provider adapter boundary.
- `native/windows-bridge-csharp/` covers Win32 discovery, HWND-bound WGC session lifecycle and bounded `png_base64_snapshot_v1` transport.
- Phase 15.8 projects snapshots only into observer-authorized ephemeral render copies; Phase 15.9 adds lifecycle-aware bounded refresh; Phase 15.10 adds a caller-executed interactive Windows validation harness that records hashes/facts but no screenshot payload.
- Hosted CI validates contracts, native build/smoke and PowerShell syntax, but is explicitly not authoritative user-desktop evidence.
- UI Automation and higher-throughput/zero-copy compositor transport remain later slices.

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

ADR-001 至 ADR-022 位於本目錄。ADR-013 至 ADR-015 固定 observer durability、authenticated re-entry 與 single-topology nested visibility；ADR-016 至 ADR-019 固定 Windows provider identity、native discovery、WGC session lifecycle 與有界 frame transport；ADR-020 固定 observer gate 必須先於 provider snapshot I/O、semantic `portalId` 與 canonical `portalObjectId` 分離，以及 Windows pixels 只能存在於 ephemeral render copy；ADR-021 固定 lifecycle-aware cadence、frozen/sleeping frame retention semantics、四項 LRU cache bound 與 non-overlapping refresh loop；ADR-022 固定 user-session E2E 必須由 caller 明確執行，證據只保存 hash/identity/lifecycle facts，不保存 screenshot payload，且 hosted CI 不得冒充 user-desktop evidence。Phase 13 是 Canvas-first 安全收斂與跨專案契約層；Phase 15 在其上加入多觀察者私有視圖、持久化、選擇性會合、遞歸 Canvas 導航與 Windows provider/native visual runtime。

## 驗收與證據

- [MVP acceptance matrix](MVP_ACCEPTANCE_MATRIX.md)
- [HDSRC v0.2 real-runtime evidence](../artifacts/hdsrc-local-process-v0.2/real-v010-validation.json)
- [HDSRC v0.2 real rebinding evidence](../artifacts/hdsrc-local-process-v0.2/real-v010-rebinding-validation.json)
- [HDSRC v0.3 real runtime-manager evidence](../artifacts/hdsrc-runtime-manager-v0.3/real-v010-validation.json)
- [HDSRC v0.3 routed-restart epoch evidence](../artifacts/hdsrc-runtime-manager-v0.3/real-v010-routed-restart-epoch.json)
- 發布 manifest：[`../MANIFEST.json`](../MANIFEST.json)
- 發布雜湊：[`../SHA256SUMS.txt`](../SHA256SUMS.txt)
- 有界實驗證據位於 [`../artifacts/`](../artifacts/)

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
- [Phase 15.11 Read-Only Windows UIA Inspection](PHASE15_11_WINDOWS_READ_ONLY_UIA.md)
- [Phase 15.12 Windows Controlled UIA Semantic Actions](PHASE15_12_WINDOWS_CONTROLLED_UIA_ACTIONS.md)
- [Phase 15.13 Interactive Controlled-Action E2E](PHASE15_13_INTERACTIVE_CONTROLLED_ACTION_E2E.md)
- [Phase 15.14 Multi-Observer Control Handoff](PHASE15_14_MULTI_OBSERVER_CONTROL_HANDOFF.md)
- [Phase 15.15 AI-Native Operational Runtime](PHASE15_15_AI_NATIVE_OPERATIONAL_RUNTIME.md)
- [Phase 15.16 Provider-Neutral Operational Runtime](PHASE15_16_PROVIDER_NEUTRAL_OPERATIONAL_RUNTIME.md)
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
- [ADR-023 Bounded Read-Only Windows UIA Inspection](ADR-023_WINDOWS_READ_ONLY_UIA_INSPECTION.md)
- [ADR-024 Windows Semantic UIA Actions Behind controlOwner](ADR-024_WINDOWS_CONTROL_OWNER_UIA_ACTIONS.md)
- [ADR-025 Interactive Controlled-Action E2E](ADR-025_INTERACTIVE_CONTROLLED_ACTION_E2E.md)
- [ADR-026 Multi-Observer Control Handoff](ADR-026_MULTI_OBSERVER_CONTROL_HANDOFF.md)
- [ADR-027 AI-Native Operational Runtime](ADR-027_AI_NATIVE_OPERATIONAL_RUNTIME.md)
- [ADR-028 Provider-Neutral Operational Runtime](ADR-028_PROVIDER_NEUTRAL_OPERATIONAL_RUNTIME.md)
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
- [Current operational slice: Phase 15.16](PHASE15_16_PROVIDER_NEUTRAL_OPERATIONAL_RUNTIME.md)
- `contracts/phase15/` now includes provider-neutral `mrmic_operational_command_v1` / `mrmic_effect_receipt_v1` in addition to the stricter Windows operational schemas.
- `packages/operational-runtime/src/index.ts` owns provider-neutral command digesting, runtime-instance idempotency, concurrent duplicate coalescing, conflict rejection and bounded LRU completed-receipt caching.
- `packages/provider-windows/src/operational-runtime.ts` is now a Windows adapter over the shared runtime; Windows no longer owns a second idempotency engine.
- The portable suite includes a synthetic `terminal` provider to prove the shared runtime does not depend on Windows/UIA/WGC.
- Reference re-entry server: `npm run observer` (default `127.0.0.1:4180`). Nested entry requires an injected canonical Canvas topology authority.
- `@mrmic/provider-windows` remains the Windows provider adapter boundary.
- `native/windows-bridge-csharp/` covers Win32 discovery, HWND-bound WGC session lifecycle, bounded `png_base64_snapshot_v1` transport, bounded UIA inspection, and the four semantic UIA pattern actions.
- `native/windows-controlled-action-target/` is the repository-owned safe WPF application used only for conformance/development validation; it is not production runtime authority.
- Phase 15.8 projects snapshots only into observer-authorized ephemeral render copies; Phase 15.9 adds lifecycle-aware bounded refresh; Phase 15.10 adds caller-executed visual validation; Phase 15.11 adds read-only semantic UIA perception; Phase 15.12 adds controlled semantic UIA actions; Phase 15.13 adds a conformance-only dual UIA+WGC safe-target harness; Phase 15.14 makes control a generation-bound handoff-safe live lease; Phase 15.15 adds AI-native Windows command/effect semantics; Phase 15.16 extracts common operational mechanics into a provider-neutral runtime.
- UIA inspection remains bounded to depth 8 / 512 descendants / 32 pattern names and still does not export `ValuePattern`/`TextPattern` value text.
- UIA action remains limited to `invoke`, `toggle`, `select`, and `set_value`; `set_value` is bounded to 2048 characters and denied for password elements.
- `WindowsUiaControlledAccess` remains the authority/lease/element-binding execution boundary for Windows semantic actions.
- Effect receipts explicitly do not claim world-state verification; perception continues independently for the agent's next planning cycle.
- MRMIC does not insert a generic human approval/login gate into ordinary AI-native operations; external systems may still impose their own authentication/consent policy.
- Raw keyboard/pointer injection remains unimplemented and disabled.

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

ADR-001 至 ADR-028 位於本目錄。ADR-013 至 ADR-015 固定 observer durability、authenticated re-entry 與 single-topology nested visibility；ADR-016 至 ADR-019 固定 Windows provider identity、native discovery、WGC session lifecycle 與有界 frame transport；ADR-020 固定 observer gate 必須先於 provider snapshot I/O、semantic `portalId` 與 canonical `portalObjectId` 分離，以及 Windows pixels 只能存在於 ephemeral render copy；ADR-021 固定 lifecycle-aware cadence、frozen/sleeping frame retention semantics、四項 LRU cache bound 與 non-overlapping refresh loop；ADR-022 固定 user-session E2E 必須由 caller 明確執行且 hosted CI 不得冒充 user-desktop evidence；ADR-023 固定 UI Automation inspection 與 control 分離、8/512/32 有界 tree contract、value/text payload 最小化；ADR-024 固定 UIA semantic action 必須受 `controlOwner`、control policy、fresh inspection、pattern/element identity binding 與 provider identity revalidation共同約束，且不得退化成 raw input fallback；ADR-025 固定 interactive semantic-action E2E 只能使用 repository-owned safe target；ADR-026 固定 live control lease generation、atomic handoff、ABA 防護與 native action 前 generation/policy 重驗證；ADR-027 固定 production runtime 使用 command/effect receipt + continuous perception，而不是同步 post-action verifier/human approval pipeline；ADR-028 固定共通 operational runtime 只擁有 provider-neutral idempotency mechanics，provider authority/effect semantics 留在 adapter。

## 驗收與證據

- [MVP acceptance matrix](MVP_ACCEPTANCE_MATRIX.md)
- [HDSRC v0.2 real-runtime evidence](../artifacts/hdsrc-local-process-v0.2/real-v010-validation.json)
- [HDSRC v0.2 real rebinding evidence](../artifacts/hdsrc-local-process-v0.2/real-v010-rebinding-validation.json)
- [HDSRC v0.3 real runtime-manager evidence](../artifacts/hdsrc-runtime-manager-v0.3/real-v010-validation.json)
- [HDSRC v0.3 routed-restart epoch evidence](../artifacts/hdsrc-runtime-manager-v0.3/real-v010-routed-restart-epoch.json)
- 發布 manifest：[`../MANIFEST.json`](../MANIFEST.json)
- 發布雜湊：[`../SHA256SUMS.txt`](../SHA256SUMS.txt)
- 有界實驗證據位於 [`../artifacts/`](../artifacts/)

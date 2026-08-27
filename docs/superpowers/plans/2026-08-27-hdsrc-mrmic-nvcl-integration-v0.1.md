# HDSRC × MRMIC/NVCL Integration v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. This integration is intentionally single-topology; do not dispatch subagents.

**Goal:** Implement Slices 0–3 of the approved read-only HDSRC integration: versioned contracts, deterministic fake provider, native resource portal projection, and explicit NVCL read-only human/structured/machine observation surfaces.

**Architecture:** HDSRC remains external canonical authority. A new `packages/provider-hdsrc` validates provider contracts and exposes a transport-neutral client plus deterministic fixture. MRMIC stores only portal geometry/provider references, while the read-only observation helper returns separate human preview, structured manifest, or machine-resource handles without widening the existing pixel Provider contract.

**Tech Stack:** Node.js 22.5+, npm 10+, TypeScript strict mode, Node test runner, JSON Schema draft 2020-12, existing `native_resource_portal_v1`.

**Spec:** `docs/HDSRC_MRMIC_NVCL_INTEGRATION_ARCHITECTURE_v0.1.md` and `docs/HDSRC_MRMIC_NVCL_AUTHORITY_MATRIX_v0.1.md`

## Global Constraints

- Base: `main@791efb9d98270d4db9c25f257aac805196ba62e8`.
- Branch: `integration/hdsrc-mrmic-nvcl-v0.1`.
- HDSRC access is read-only in v0.1.
- Do not add `provider='hdsrc'` or new `ResourceKind` enum values yet; use `external/artifact` compatibility binding.
- Do not import HDSRC Python source into TypeScript packages.
- Do not reimplement HMSP1/HPCM1/HPCM2 in MRMIC.
- Canvas revision, HDSRC state revision, and materialization identity remain distinct.
- Pixel Provider input must not receive hidden HDSRC structured fields or machine-carrier bytes.
- No real cross-process HDSRC bridge in Slices 0–3.
- Existing Phase 13 security and negative-control tests must remain green.

---

### Task 1: Slice 0 — Versioned HDSRC integration contracts

- [x] Write contract tests first.
- [x] Verify expected RED at commit `93abcbef869ca613f2ab5c0d4baac383644f04a6` / Actions `33053374380`.
- [x] Add seven versioned schemas plus positive/negative fixtures.
- [x] Verify GREEN at commit `d7eae337ea550be268302850a4e1f2952665b69b` / Actions `33053639823`.

### Task 2: Slice 1 — `provider-hdsrc` validation and deterministic fake provider

- [x] Add validator/provider tests before implementation.
- [x] Verify expected RED at commit `3465a836acb0240df0ee6d851bf05b28ea283666` / Actions `33053743622`.
- [x] Implement `packages/provider-hdsrc`, fail-closed validation, freshness, authorization, fast/defer decisions, and deterministic fake state/materialization/resources.
- [x] Verify GREEN at commit `84a8f3d52987f3fbcbe7dadd2b09750ec005635e` / Actions `33053972887`.

### Task 3: Slice 2 — MRMIC native portal projection

- [x] Add portal/authority tests before projection implementation.
- [x] Verify expected RED at commit `4708088eb3cbe1eb3b861514a4cb657de314cdb1` / Actions `33054133335`.
- [x] Implement `createHdsrcMaterializationPortal(...)` with existing `external/artifact` compatibility profile.
- [x] Prove Canvas geometry mutation does not change HDSRC revision/digest.
- [x] Implement fail-closed lifecycle mapping.
- [x] Verify GREEN at commit `a0c3e1043efbdcdc350fd720b88eef3eebd2ca7b` / Actions `33054290249`.

### Task 4: Slice 3 — explicit read-only NVCL observation bridge

Implementation note: the trusted observation client remains an explicit `provider-hdsrc/observation` submodule rather than being re-exported into the core provider barrel. This keeps the trusted observation surface visibly separate from the general provider client and avoids widening the existing pixel Provider boundary.

- [x] Add human/structured/machine observation tests before bridge implementation.
- [x] Verify expected RED at commit `ba0cf8f5318ce09d9ce6d36895c78e8d8eace6ac` / Actions `33054428657`.
- [x] Implement `HdsrcObservationBridge` as a separate read-only trusted surface.
- [x] Prove human preview contains no hidden HDSRC structured metadata.
- [x] Require `trustedStructured` for structured manifests.
- [x] Require `trustedMachine` for machine-carrier access.
- [x] Prove the bridge exposes no canonical mutation methods.
- [x] Verify GREEN at commit `d62f0d067dc1afe65aa627bd175fc05e8f4f5ba9` / Actions `33054660597` with 192 tests, 191 pass, 0 fail, 1 skip.

### Task 5: Slice 0–3 acceptance and documentation closure

The architecture document is retained as the immutable approved design contract. Implementation state is recorded separately in `docs/HDSRC_MRMIC_NVCL_INTEGRATION_STATUS_v0.1.md` rather than rewriting the design after implementation.

- [x] Verify TypeScript check and full test suite through CI on the implemented runtime head.
- [x] Verify existing Phase 13 tests remain green in the same run.
- [x] Audit `main...integration/hdsrc-mrmic-nvcl-v0.1`: no HDSRC canonical mutation implementation and no public Canvas enum expansion.
- [x] Record implemented/not-proven boundaries in the dedicated status document.
- [ ] Verify the documentation-closure branch head remains green.
- [ ] Open one PR to `main` only after that final branch-head CI is green.

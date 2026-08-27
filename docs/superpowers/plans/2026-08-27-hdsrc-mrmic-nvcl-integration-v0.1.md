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

**Files:**
- Create `contracts/hdsrc-integration/hdsrc-provider-capabilities-v1.schema.json`
- Create `contracts/hdsrc-integration/hdsrc-state-ref-v1.schema.json`
- Create `contracts/hdsrc-integration/hdsrc-workload-hint-v1.schema.json`
- Create `contracts/hdsrc-integration/hdsrc-materialization-request-v1.schema.json`
- Create `contracts/hdsrc-integration/hdsrc-materialization-decision-v1.schema.json`
- Create `contracts/hdsrc-integration/hdsrc-materialization-v1.schema.json`
- Create `contracts/hdsrc-integration/hdsrc-provider-error-v1.schema.json`
- Create positive and negative JSON examples under `contracts/hdsrc-integration/examples/`
- Test `tests/hdsrc-integration.test.mjs`

**Interfaces:** Contract schema names must exactly match the architecture document: `hdsrc-provider-capabilities/v1`, `hdsrc-state-ref/v1`, `hdsrc-workload-hint/v1`, `hdsrc-materialization-decision/v1`, and `hdsrc-materialization/v1`.

- [ ] Write the failing test that loads all seven schema files and positive/negative examples, asserts stable `$id` values, `canonicalMutation: false`, no credential-like fields, and separate preview/machine URIs.
- [ ] Push the test alone and verify CI RED because contracts and `provider-hdsrc` do not exist.
- [ ] Add the seven schemas and fixtures with no secrets and no mutation fields.
- [ ] Run CI and verify contract tests GREEN before moving to Task 2.

### Task 2: Slice 1 — `provider-hdsrc` validation and deterministic fake provider

**Files:**
- Create `packages/provider-hdsrc/package.json`
- Create `packages/provider-hdsrc/src/index.ts`
- Extend `tests/hdsrc-integration.test.mjs`

**Interfaces:**
- `HdsrcProviderClient`
- `HdsrcProviderCapabilitiesV1`
- `HdsrcStateRefV1`
- `HdsrcMaterializationDecisionV1`
- `HdsrcMaterializationV1`
- `HdsrcProviderError`
- `DeterministicFakeHdsrcProvider`
- `assertHdsrcCapabilities(value)`
- `assertHdsrcStateRef(value)`
- `assertHdsrcMaterialization(value)`
- `assertMaterializationFresh(state, materialization)`

- [ ] Add failing tests for valid parse, malformed manifest rejection, stale revision rejection, digest mismatch rejection, provider authorization denial, `fast_path`, and `oracle_fallback` as a valid defer state.
- [ ] Verify CI RED because package APIs are missing.
- [ ] Implement focused runtime validators with fail-closed behavior; no general JSON Schema engine dependency.
- [ ] Implement deterministic fake state `state:demo-4096` and deterministic materialization/resource responses.
- [ ] Verify the fake provider never exposes canonical mutation and returns distinct human preview and machine resource identities.
- [ ] Run CI GREEN.

### Task 3: Slice 2 — MRMIC native portal projection

**Files:**
- Extend `packages/provider-hdsrc/src/index.ts`
- Extend `tests/hdsrc-integration.test.mjs`

**Interfaces:**
- `createHdsrcMaterializationPortal(input): CanvasObject`
- `HdsrcPortalProjectionInput`
- `hdsrcPortalLifecycle(errorOrState): ResourcePortalLifecycle`

- [ ] Add failing tests proving a valid HDSRC materialization becomes a `resource_portal` with `provider='external'`, `resourceKind='artifact'`, `displayMode='snapshot'`, and read-only/inspect interaction.
- [ ] Add a test using `CanvasStore` proving moving/resizing the portal increments Canvas revision but leaves the fake provider state digest unchanged.
- [ ] Add stale/provider-unavailable tests mapping to `suspended`, while verified materialization maps to `projected_snapshot`.
- [ ] Implement the projection builder storing only stable provider references, state/materialization digests, and preview URI; do not copy machine bytes or credentials into Canvas metadata.
- [ ] Run CI GREEN.

### Task 4: Slice 3 — Explicit read-only NVCL observation bridge

**Files:**
- Create `packages/provider-hdsrc/src/observation.ts`
- Extend `packages/provider-hdsrc/src/index.ts` exports
- Extend `tests/hdsrc-integration.test.mjs`

**Interfaces:**
- `HdsrcObservationMode = 'human_preview' | 'structured_manifest' | 'machine_carrier'`
- `HdsrcObservationBridge`
- `observe(portal, mode, context)` returns one of three discriminated read-only payloads.

- [ ] Add failing tests for three observation modes.
- [ ] Prove `human_preview` returns only approved preview identity/mime data and never state digest, spatialization details, machine bytes, credentials, or canonical state.
- [ ] Prove `structured_manifest` requires trusted access and returns the validated materialization manifest.
- [ ] Prove `machine_carrier` requires trusted machine access and returns an authorized resource handle/payload distinct from the preview.
- [ ] Prove no observation API exposes a canonical mutation operation.
- [ ] Implement bridge as a separate trusted client surface; do not change `MultimodalProvider` or existing pixel observation schema.
- [ ] Run focused and full CI GREEN.

### Task 5: Slice 0–3 acceptance and documentation closure

**Files:**
- Create `docs/HDSRC_MRMIC_NVCL_INTEGRATION_STATUS_v0.1.md`
- Update `docs/INDEX.md`
- Update architecture status from draft to implemented Slices 0–3 only after tests are green.

- [ ] Run `npm run check` and `npm test` through CI on the final branch head.
- [ ] Verify existing Phase 13 tests remain green.
- [ ] Verify branch diff contains no HDSRC canonical mutation implementation and no public Canvas enum expansion.
- [ ] Record exact implemented/not-proven boundaries: fake provider only; no real Python process E2E; no HDSRC writeback; no production security claim.
- [ ] Open one PR to `main` only after the final branch head has green CI.

# HDSRC × MRMIC/NVCL Integration Status v0.1

**Date:** 2026-08-27  
**Branch:** `integration/hdsrc-mrmic-nvcl-v0.1`  
**MRMIC baseline:** `main@791efb9d98270d4db9c25f257aac805196ba62e8`  
**Scope:** Architecture-approved Slices 0–3, read-only HDSRC integration

## 1. Status

Slices 0–3 are implemented on the integration branch and have completed independent RED/GREEN CI cycles.

The implemented relation remains:

$$
\boxed{
\text{HDSRC Provider}
\leftrightarrow
\text{MRMIC Resource Portal}
\leftrightarrow
\text{Read-only NVCL Observation}
}
$$

No HDSRC canonical mutation path is implemented.

## 2. Implemented slices

### Slice 0 — versioned contracts

Implemented seven draft-2020-12 JSON contracts under `contracts/hdsrc-integration/` plus provider-neutral positive and negative examples.

The compatibility profile remains:

```text
provider = external
resourceKind = artifact
providerResourceId = hdsrc://...
```

No public Canvas provider/resource enum was expanded.

### Slice 1 — deterministic read-only provider fixture

Implemented `packages/provider-hdsrc` with:

- transport-neutral provider interfaces;
- fail-closed capability/state/materialization validators;
- independent state revision/digest freshness checks;
- `fast_path` and `oracle_fallback` decision handling;
- explicit HDSRC authorization context;
- deterministic `state:demo-4096` fixture;
- distinct preview and machine-resource identities.

The fake provider advertises:

```text
canonicalMutation = false
```

and exposes no canonical write operation.

### Slice 2 — native MRMIC resource portal projection

Implemented `createHdsrcMaterializationPortal(...)` using the existing Phase 13 `native_resource_portal_v1` contract.

MRMIC owns portal geometry and projection state. HDSRC owns state/materialization identity.

The integration test executes real `CanvasStore` transactions and verifies:

$$
revision_{Canvas}\uparrow
$$

while:

$$
revision_{HDSRC}=\text{constant}
$$

and:

$$
digest_{HDSRC}=\text{constant}.
$$

Provider unavailability, stale state, or unverifiable state maps fail-closed to `suspended` rather than silently reusing current truth.

### Slice 3 — explicit read-only observation lanes

Implemented `packages/provider-hdsrc/src/observation.ts` as a separate trusted observation submodule.

The three lanes are:

```text
human_preview
structured_manifest
machine_carrier
```

Security boundary:

- `human_preview` requires ordinary HDSRC read authorization and returns only approved raster resource data;
- `structured_manifest` additionally requires `trustedStructured=true`;
- `machine_carrier` additionally requires `trustedMachine=true`;
- the existing pixel Provider contract was not modified;
- no observation API exposes HDSRC mutation methods.

The trusted observation surface intentionally remains an explicit provider submodule rather than being merged into the general pixel-provider API.

## 3. TDD evidence

### Slice 0

RED:

- commit `93abcbef869ca613f2ab5c0d4baac383644f04a6`;
- Actions run `33053374380`;
- `npm run check` passed;
- new tests failed only because `contracts/hdsrc-integration/` did not yet exist.

GREEN:

- commit `d7eae337ea550be268302850a4e1f2952665b69b`;
- Actions run `33053639823`;
- CI completed successfully.

### Slice 1

RED:

- commit `3465a836acb0240df0ee6d851bf05b28ea283666`;
- Actions run `33053743622`;
- contract tests remained green;
- provider tests failed only because `provider-hdsrc` did not yet exist.

GREEN:

- commit `84a8f3d52987f3fbcbe7dadd2b09750ec005635e`;
- Actions run `33053972887`;
- TypeScript check and full tests completed successfully.

### Slice 2

RED:

- commit `4708088eb3cbe1eb3b861514a4cb657de314cdb1`;
- Actions run `33054133335`;
- 184 tests passed, three new portal tests failed only because portal projection functions were absent, and one existing capability probe remained skipped.

GREEN:

- commit `a0c3e1043efbdcdc350fd720b88eef3eebd2ca7b`;
- Actions run `33054290249`;
- TypeScript check and full tests completed successfully.

### Slice 3

RED:

- commit `ba0cf8f5318ce09d9ce6d36895c78e8d8eace6ac`;
- Actions run `33054428657`;
- 187 tests passed, four new observation tests failed only because `HdsrcObservationBridge` did not yet exist, and one existing capability probe remained skipped.

GREEN:

- commit `d62f0d067dc1afe65aa627bd175fc05e8f4f5ba9`;
- Actions run `33054660597`;
- `npm run check`: PASS;
- `npm test`: 192 tests, 191 pass, 0 fail, 1 skip.

## 4. Authority audit

The branch diff against `main` does not modify:

- `packages/canvas-schema`;
- `packages/mcp-contract`;
- `packages/multimodal-agent-runtime`;
- existing Phase 13 security packages.

Program changes are isolated to the new `packages/provider-hdsrc` package.

Therefore the implementation preserves:

$$
S_{HDSRC}\neq S_{Canvas}
$$

$$
Auth_{MRMIC}\not\Rightarrow Auth_{HDSRC}
$$

and:

$$
\mathrm{NVCLObserve}(M)\not\Rightarrow\mathrm{HDSRCMutation}(S).
$$

## 5. Explicitly not proven or implemented

This status does **not** claim:

- a real Python HDSRC process bridge;
- cross-process HDSRC v0.10/HPCM2 E2E;
- HDSRC canonical writeback;
- Canvas pixel edit to HDSRC symbolic mutation;
- production security review;
- deployment-grade multi-tenant authorization;
- direct machine-carrier support inside the existing pixel-only Provider contract;
- new public `provider='hdsrc'` or HDSRC-specific Canvas resource kinds.

These remain later slices.

## 6. Next gate

The branch receives one documentation-closure CI run after this status file is committed. A pull request to `main` may be opened only if that branch-head CI remains green.

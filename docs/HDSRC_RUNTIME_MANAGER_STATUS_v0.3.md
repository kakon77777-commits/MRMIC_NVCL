# HDSRC Runtime Discovery, Lifecycle, and NVCL Routing Status v0.3

**Date:** 2026-08-28  
**Branch:** `integration/hdsrc-runtime-manager-v0.3`  
**Base:** `main@8a51073b14dffaf6e88d46be89efa0086b2f5191`

## Status

Phase 14 v0.3 implementation is functionally complete for the approved HDSRC-scoped runtime discovery, bounded lifecycle management, and NVCL observation routing scope.

The implemented path is:

$$
\boxed{
\text{NVCL Observation Intent}
\rightarrow
\text{HDSRC Observation Router}
\rightarrow
\text{HDSRC Runtime Manager}
\rightarrow
\text{Discovered Local Runtime}
\rightarrow
\text{HPCM2/HMR1/HMBT1}
}
$$

No HDSRC canonical mutation method is introduced.

## Implemented components

### Runtime binding and discovery

Files:

```text
contracts/hdsrc-integration/hdsrc-runtime-binding-v1.schema.json
packages/provider-hdsrc/src/runtime-discovery.ts
```

Implemented behavior:

- explicit binding precedence;
- environment binding precedence through `HDSRC_RUNTIME_BINDING`;
- deterministic user-local fallback location;
- selected-source fail-closed semantics;
- relative deployment paths resolved once against the binding directory;
- immutable runtime descriptor;
- no disk scan, PATH probing, Git search, network installation, or credential lookup.

### Production profile-root authority

Files:

```text
scripts/hdsrc_profile_bootstrap.py
packages/provider-hdsrc/src/runtime-environment.ts
```

Production startup now binds configured `<profileRoot>/src` as the HDSRC Python module root and verifies loaded HDSRC code against that configured authority.

Discovered production launches strip ambient:

```text
HDSRC_TEST_STUB_RUNTIME
PYTHONPATH
```

### Failure-origin preservation

Files:

```text
packages/provider-hdsrc/src/process-client.ts
packages/provider-hdsrc/src/local-process.ts
```

Origins are preserved as:

```text
transport
contract
remote_domain
```

Only transport failures are eligible for automatic lifecycle restart.

### Runtime manager

File:

```text
packages/provider-hdsrc/src/runtime-manager.ts
```

Implemented:

- side-effect-free discovery;
- lazy process start;
- concurrent single-flight start;
- monotonic manager-local runtime epoch;
- one-shot automatic restart for safe read operations after transport failure;
- no automatic restart for contract failure;
- remote HDSRC domain errors leave a healthy manager ready;
- no automatic replay of `materializeResolved` after fatal transport failure;
- terminal stop lifecycle.

### Observation intent router

Files:

```text
contracts/hdsrc-integration/hdsrc-observation-intent-v1.schema.json
packages/provider-hdsrc/src/observation-router.ts
```

Implemented:

- exact intent validation;
- authorization and trusted-lane gates before runtime access;
- deterministic intent-to-existing-workload mapping;
- human preview route;
- structured manifest route;
- full machine-carrier route;
- canonical partial relation block-row route;
- HPCM2 fast-path and oracle-fallback evidence preservation;
- no TypeScript carrier-scale/spatialization/oracle-policy selection.

## TDD / CI evidence

### Task 1 — runtime discovery

RED:

```text
33172019574
```

GREEN:

```text
33172342769
```

### Task 2 — configured profile-root authority

RED:

```text
33172549219
```

Final clean GREEN:

```text
33173012053
```

Result:

```text
229 tests
228 PASS
0 FAIL
1 existing SKIP
```

### Task 3 — failure origin

RED:

```text
33173139671
```

Final clean GREEN:

```text
33173395676
```

Result:

```text
233 tests
232 PASS
0 FAIL
1 existing SKIP
```

### Task 4 — runtime manager

RED:

```text
33173596307
```

Final clean GREEN:

```text
33174081729
```

Result:

```text
242 tests
241 PASS
0 FAIL
1 existing SKIP
```

### Task 5 — observation router

RED:

```text
33174205525
```

Core GREEN:

```text
33174461081
```

Final clean closure after nine-schema inventory update:

```text
33175052024
```

Result:

```text
252 tests
251 PASS
0 FAIL
1 existing SKIP
```

## Real HDSRC v0.10 validation

See:

```text
docs/HDSRC_RUNTIME_MANAGER_VALIDATION_v0.3.md
artifacts/hdsrc-runtime-manager-v0.3/real-v010-validation.json
```

Canonical real evidence SHA-256:

```text
7f810af72aee6d165eb702a863542b871bca2883791e11e0ffd88105e5e990d7
```

Observed real behavior:

- explicit and environment discovery resolve the configured runtime;
- discovery does not start a process;
- first real provider use creates runtime epoch 1;
- calibration-domain real HPCM2 fast path selects HMBT1 b8 / `RCM_PP`;
- canonical 4096D state goes through real HPCM2 oracle fallback and HMR1 selects HMBT1 b32 / `RCM_PP`;
- 4096D carrier = 286,313 bytes;
- partial relation read = 1,272 compressed bytes ≈ 0.4443% of carrier bytes;
- actual production child fault injection causes one bounded restart to epoch 2;
- HDSRC state identity/revision/digest survive process restart unchanged;
- valid changed state returns `STALE_STATE` without manager degradation;
- malformed HDS1 returns `INTEGRITY_FAILURE` without manager restart;
- v0.2 full metadata/digest rebinding remains structurally fail-closed;
- `canonicalMutation = false`;
- `testStubRuntimeUsed = false`.

The real-runtime evidence and v0.3 documentation/index/plan execution record are now closed. The branch is entering source-frozen pre-merge verification; no further feature work belongs in this phase.

## Preserved authority boundaries

$$
S_{HDSRC}\neq S_{Canvas}
$$

$$
Auth_{MRMIC}\not\Rightarrow Auth_{HDSRC}
$$

$$
DeploymentBinding\neq CanonicalState
$$

$$
RuntimeEpoch\neq HDSRC\ StateRevision
$$

$$
ProcessRestart\neq StateRevision
$$

$$
\mathrm{Materialize}(S,W)\not\Rightarrow\mathrm{CanonicalMutation}(S)
$$

## Explicit non-goals

v0.3 does not implement:

- generic provider runtime discovery;
- remote HDSRC HTTP/WebSocket transport;
- background daemon supervision;
- unbounded restart/backoff loops;
- canonical HDSRC writeback;
- Canvas pixel edits as HDSRC symbolic mutation;
- automatic HPCM2 online-policy writeback from MRMIC;
- multi-tenant production security certification;
- new public Canvas provider/resource enums;
- widening of the existing pixel-only multimodal Provider contract.

## Remaining closure

Before merge:

1. run a final source-frozen branch CI;
2. audit the final diff against authority boundaries;
3. review PR comments/threads and mergeability;
4. squash merge using the verified expected head SHA;
5. verify the merged `main` commit with its own full CI run.

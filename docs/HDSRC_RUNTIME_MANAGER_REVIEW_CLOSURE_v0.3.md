# HDSRC Runtime Manager — Pre-Merge Review Closure v0.3

**Date:** 2026-08-28  
**Scope:** Phase 14 v0.3  
**Primary validation:** `docs/HDSRC_RUNTIME_MANAGER_VALIDATION_v0.3.md`

This supplement preserves three issues found during final PR source review after the initial v0.3 implementation had already passed CI and real-runtime validation.

## A. Discovery failure lifecycle

The design requires discovery failure before provider start to leave the manager `undiscovered`, epoch 0, with no child.

RED `bae2a1d0...`, CI `33180764028`:

```text
254 tests / 251 PASS / 2 FAIL / 1 existing SKIP
```

GREEN `84d0c671...`, CI `33180952504`:

```text
254 tests / 253 PASS / 0 FAIL / 1 existing SKIP
```

Final invariant:

$$
DiscoveryFailure_{pre-start}\Rightarrow(undiscovered,\ epoch=0,\ child=0)
$$

## B. Blank environment binding

`HDSRC_RUNTIME_BINDING` is source-selecting. If it is defined but blank, it is malformed configuration and must not fall through to user-local discovery.

RED `4fcfdc92...`, CI `33181486705`:

```text
255 tests / 253 PASS / 1 FAIL / 1 existing SKIP
```

GREEN `dc53ee0d...`, CI `33181609796`:

```text
255 tests / 254 PASS / 0 FAIL / 1 existing SKIP
```

Final invariant:

$$
HDSRC\_RUNTIME\_BINDING=blank\Rightarrow INTEGRITY\_FAILURE
$$

## C. Final observation runtime epoch

A materialization can complete on epoch 1 and a following safe resource/partial read can trigger the one bounded restart. The returned observation must report the epoch on which the observation actually completed.

RED `11b3b2d9...`, CI `33181751433`:

```text
257 tests / 254 PASS / 2 FAIL / 1 existing SKIP
```

GREEN `e528550f...`, CI `33181944578`:

```text
257 tests / 256 PASS / 0 FAIL / 1 existing SKIP
```

Final invariant:

$$
Observation.runtimeEpoch=RuntimeEpoch_{successful\ completion}
$$

## Real HDSRC v0.10 replay after all fixes

The exact reviewed production source was rebuilt with GitHub Actions and run against a clean extract of the canonical HDSRC v0.10 release.

Lineage:

```text
release ZIP SHA-256:
583659487a25cd76a7a3a32a35fda373074e630c3f7f60e47c618358bbb1c217

canonical 4096D HDS1 SHA-256:
ea48a90eddc727b1684cf72204ddeaa720c6b67fe036561e05537622b0c12f85
```

The full v0.3 validator was rerun twice and remained byte-for-byte identical to the earlier canonical evidence:

```text
7f810af72aee6d165eb702a863542b871bca2883791e11e0ffd88105e5e990d7
```

So the late fixes did not change the measured fast path, 4096D oracle fallback, 286,313-byte carrier, 1,272-byte partial read, stale/integrity behavior, restart identity preservation, or rebinding fail-closed semantics.

## Dedicated routed-restart real validation

A new validator materializes the real 4096D state on epoch 1, SIGKILLs the production child before machine-resource read, then lets the safe read perform its one bounded restart.

Two runs were byte-for-byte identical:

```text
SHA-256: 585e538546aa75224c72fad485d3538db513dc2a8799ad50eb007aecb6658548
```

Observed:

```text
decision = oracle_fallback
oracleUsed = true
materializationEpoch = 1
finalRuntimeEpoch = 2
managerRuntimeEpoch = 2
childRestarted = true
machineBytes = 286313
canonicalMutation = false
testStubRuntimeUsed = false
```

Raw evidence:

`artifacts/hdsrc-runtime-manager-v0.3/real-v010-routed-restart-epoch.json`

## Closure

The final review now preserves three distinctions explicitly:

$$
DiscoveryFailure\neq RuntimeDegradation
$$

$$
SelectedMalformedBinding\neq AbsentBinding
$$

$$
MaterializationEpoch\neq FinalObservationEpoch
$$

No HDSRC canonical write surface, Canvas authority change, remote transport, generic provider-runtime framework, or background restart loop was introduced by these fixes.

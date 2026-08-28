# HDSRC Local Process Bridge Status v0.2

**Date:** 2026-08-28  
**Branch:** `integration/hdsrc-local-process-bridge-v0.2`  
**Base:** `main@6549d7cb5b191cbf463d4f525e696a180c2a8569`  
**Protocol:** `hdsrc-process/0.1`

## Status

Implementation is complete for the read-only local process bridge scope defined by `docs/superpowers/specs/2026-08-28-hdsrc-local-process-bridge-design.md`.

The implemented path is:

$$
\boxed{
\text{LocalProcessHdsrcProvider}
\rightarrow
\text{JSONL stdio}
\rightarrow
\text{production Python host}
\rightarrow
\text{HDSRC v0.10}
}
$$

HDSRC canonical state remains external authority and no canonical mutation method is introduced.

## Implemented components

### JSONL process client

`packages/provider-hdsrc/src/process-client.ts`

- persistent child process;
- numeric request correlation;
- concurrent out-of-order response support;
- exact `hdsrc-process/0.1` protocol check;
- bounded stderr diagnostics;
- timeout, malformed stdout, protocol mismatch and unexpected process exit fail closed;
- fatal transport error closes the client and rejects all pending requests.

### Production local-process provider

`packages/provider-hdsrc/src/local-process.ts`

- implements the existing read-only `HdsrcProviderClient` contract;
- independently preauthorizes MRMIC-side HDSRC read access;
- performs lazy read-only process handshake;
- rejects a host exposing mutation-like methods;
- preserves `fast_path` versus `oracle_fallback` decisions;
- exposes resolved selected HMBT1 materialization;
- exposes trusted partial relation block-row reads;
- maps provider/transport failures into explicit HDSRC provider errors.

### Production Python process host

`scripts/hdsrc_process_host.py`

Methods:

```text
initialize
capabilities
state
plan_materialization
materialize
materialization
read_resource
partial_relation_block_row
shutdown
```

There is no state register, replace, patch, write or canonical commit method.

### Runtime adapter

`scripts/hdsrc_runtime_adapter.py`

Production imports the canonical HDSRC v0.10 Python modules and profile bundle.

The CI-only deterministic backend can be enabled only through:

```text
HDSRC_TEST_STUB_RUNTIME=1
```

The production path does not silently fall back to that fixture.

### Derived materialization service

`scripts/hdsrc_materialization_service.py`

- deterministic workload digest;
- deterministic materialization identity;
- selected HMBT1 persistence only;
- SHA-256 binding of machine-carrier bytes;
- preview and machine-resource identity separation;
- restart persistence;
- source-state freshness validation;
- carrier tamper rejection;
- verified partial-read integrity cache.

## TDD / CI evidence

### Task 3 provider integration

RED:

```text
33155211440
```

The old suite remained green and the only new blocker was the missing local-process provider module.

GREEN:

```text
33155662113
```

Result:

```text
208 tests
207 PASS
0 FAIL
1 existing SKIP
```

### Task 4 hardening / partial read

RED:

```text
33155882898
```

The restart, stale-state, tamper, child-exit and SHA tests already passed. The only new failure was the missing `readPartialRelationBlockRow` method.

GREEN:

```text
33156360504
```

Result:

```text
214 tests
213 PASS
0 FAIL
1 existing SKIP
```

## Real HDSRC v0.10 evidence

See:

```text
docs/HDSRC_LOCAL_PROCESS_BRIDGE_VALIDATION_v0.2.md
artifacts/hdsrc-local-process-v0.2/real-v010-validation.json
```

Raw validation evidence SHA-256:

```text
716a050d6a799143df2771ce792c077cb64b58c9d7a792e6e86a49be67fb16f6
```

The external real-runtime validation used the production process host with `HDSRC_TEST_STUB_RUNTIME` absent and HDSRC v0.10 release/source lineage anchored by SHA-256.

Observed real behavior includes:

- calibration-domain HPCM2 fast path;
- 4096D HPCM2 oracle fallback;
- HMR1-selected HMBT1 materialization;
- exact carrier SHA binding;
- process restart persistence;
- real compressed partial relation read;
- valid changed state mapped to `STALE_STATE`;
- malformed HDS1 mapped to `INTEGRITY_FAILURE`;
- tampered HMBT1 mapped to `INTEGRITY_FAILURE`.

## Authority invariants preserved

$$
S_{HDSRC}\neq S_{Canvas}
$$

$$
Auth_{MRMIC}\not\Rightarrow Auth_{HDSRC}
$$

$$
\mathrm{Materialize}(S,W)\not\Rightarrow\mathrm{CanonicalMutation}(S)
$$

The local process registry is a deployment binding, not a canonical HDSRC state store. It contains state identity/revision, a path reference and independent read principals only.

## Explicit non-goals

This version does not implement:

- canonical HDSRC writeback;
- Canvas pixel edit to HDSRC symbolic mutation;
- remote HTTP/WebSocket HDSRC transport;
- multi-tenant production security certification;
- automatic online HPCM2 policy writeback from MRMIC;
- widening of the existing pixel-only multimodal Provider contract;
- new public Canvas provider/resource enum values.

## Closure gate

Before merge, the integration branch must satisfy all of the following:

1. normal `.github/workflows/ci.yml` restored without validation-only artifact plumbing;
2. full `npm run check` and `npm test` green on final branch head;
3. no changes to Canvas public provider/resource enum semantics;
4. no change to the existing pixel-only multimodal Provider input contract;
5. no HDSRC canonical state mutation method;
6. raw real-runtime evidence and validation report present;
7. pull request reviewed against the authority matrix before merge.

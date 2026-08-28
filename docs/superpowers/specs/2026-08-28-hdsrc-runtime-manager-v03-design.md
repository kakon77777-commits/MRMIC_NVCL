# HDSRC Runtime Discovery, Lifecycle, and NVCL Routing — Design v0.3

**Date:** 2026-08-28  
**Repository:** `kakon77777-commits/MRMIC_NVCL`  
**Branch:** `integration/hdsrc-runtime-manager-v0.3`  
**Base:** `main@8a51073b14dffaf6e88d46be89efa0086b2f5191`  
**Scope:** Phase 14 v0.3

## 1. Purpose

Phase 14 v0.2 proved that MRMIC/NVCL can safely use the real HDSRC v0.10 runtime through a read-only local JSONL process bridge. The remaining deployment gap is that callers must still provide every local runtime path explicitly when constructing `LocalProcessHdsrcProvider`.

Phase 14 v0.3 closes that gap without expanding HDSRC canonical authority into MRMIC.

The target path is:

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

The intended user-visible capability is:

> A local MRMIC/NVCL runtime can discover a configured HDSRC installation, start and supervise its read-only process bridge, translate an NVCL observation intent into an HDSRC workload hint, and obtain a verified materialization or partial observation without callers manually assembling process paths.

## 2. Non-negotiable authority invariants

The v0.3 implementation must preserve all v0.1/v0.2 authority boundaries.

$$
S_{HDSRC}\neq S_{Canvas}
$$

$$
Auth_{MRMIC}\not\Rightarrow Auth_{HDSRC}
$$

$$
\mathrm{Materialize}(S,W)\not\Rightarrow\mathrm{CanonicalMutation}(S)
$$

In addition:

$$
DeploymentBinding\neq CanonicalState
$$

$$
RuntimeEpoch\neq HDSRC\ StateRevision
$$

$$
ProcessRestart\neq StateRevision
$$

A deployment binding may say where a runtime is installed and where its registry/materialization directory lives. It must not contain HDSRC symbolic state, machine-carrier bytes, or authority to mutate canonical state.

## 3. Scope

Phase 14 v0.3 adds exactly three integration responsibilities:

1. deterministic HDSRC runtime discovery;
2. bounded local-process lifecycle management;
3. NVCL observation intent to HDSRC workload routing.

The version does not create a generic provider runtime framework for every MRMIC provider. It remains HDSRC-scoped so that the existing Phase 14 authority seam can be validated before broader abstraction.

## 4. Runtime binding contract

### 4.1 Contract identity

Add a local deployment schema:

```text
hdsrc-runtime-binding/v1
```

A binding contains deployment metadata only.

Recommended shape:

```json
{
  "schema": "hdsrc-runtime-binding/v1",
  "runtimeId": "hdsrc:local:v0.10",
  "protocol": "hdsrc-process/0.1",
  "executable": "/path/to/python",
  "hostScript": "/path/to/MRMIC_NVCL/scripts/hdsrc_process_host.py",
  "registry": "/path/to/hdsrc-local-registry.json",
  "profileRoot": "/path/to/HDSRC-v0.10",
  "materializationRoot": "/path/to/materializations",
  "cwd": "/optional/working/directory",
  "timeoutMs": 5000,
  "maxResourceBytes": 67108864
}
```

`cwd`, `timeoutMs`, and `maxResourceBytes` are optional. All path-bearing fields must be non-empty strings. `timeoutMs` and `maxResourceBytes`, when present, must be positive integers.

The binding has no principal list. HDSRC read principals remain in the independent v0.2 local HDSRC state registry and are enforced by the Python process host.

### 4.2 Discovery precedence

Discovery order is deterministic:

```text
explicit binding path
    ↓
HDSRC_RUNTIME_BINDING environment variable
    ↓
known user-local binding location
    ↓
PROVIDER_UNAVAILABLE
```

An earlier source that exists but is malformed fails closed. Discovery must not silently continue to a lower-precedence source after parsing or integrity failure.

The known user-local location is platform-aware but deterministic:

- Windows: `%LOCALAPPDATA%/EveMissLab/hdsrc/runtime-binding.json`
- POSIX with `XDG_CONFIG_HOME`: `$XDG_CONFIG_HOME/evemisslab/hdsrc/runtime-binding.json`
- other POSIX: `$HOME/.config/evemisslab/hdsrc/runtime-binding.json`

If the required environment base for the platform is unavailable, the known-user-local candidate is considered absent rather than guessed.

### 4.3 Explicitly forbidden discovery behavior

The implementation must not:

- recursively scan disks;
- search arbitrary Git checkouts;
- infer a runtime from a similarly named Python package;
- accept the first `python` found on PATH as proof of HDSRC identity;
- fetch or install HDSRC from the network;
- read credentials to discover a runtime;
- mutate the binding file as part of discovery.

Discovery answers only: "Which configured local runtime should MRMIC attempt to use?"

## 5. Runtime descriptor

Successful parsing produces an immutable in-memory descriptor, conceptually:

```ts
interface HdsrcRuntimeDescriptor {
  schema: 'hdsrc-runtime-descriptor/v1'
  runtimeId: string
  source: 'explicit' | 'environment' | 'user_local'
  bindingPath: string
  protocol: 'hdsrc-process/0.1'
  executable: string
  hostScript: string
  registry: string
  profileRoot: string
  materializationRoot: string
  cwd?: string
  timeoutMs?: number
  maxResourceBytes?: number
}
```

The descriptor is MRMIC deployment state only. It is not persisted into Canvas state and is not exposed as HDSRC canonical metadata.

## 6. Runtime manager

### 6.1 Responsibility

The runtime manager wraps `LocalProcessHdsrcProvider`; it does not replace the v0.2 provider or duplicate HDSRC planning policy.

Proposed state machine:

```text
undiscovered
→ discovered
→ starting
→ ready
→ degraded
→ stopped
```

`stopped` is terminal for one manager instance.

### 6.2 Lazy start

Discovery may happen before process creation. The HDSRC child starts only when a provider operation is first required.

Concurrent first callers must share one in-flight start operation and one healthy provider instance.

The manager must not start multiple HDSRC children merely because multiple observation requests arrive concurrently.

### 6.3 Runtime epoch

Each successful process start receives a new monotonic manager-local runtime epoch:

```text
runtimeEpoch = 1, 2, 3, ...
```

The epoch is ephemeral integration state. It is not an HDSRC state revision and is not written into HDSRC manifests.

### 6.4 Health and failure

A provider is `ready` only after the existing v0.2 read-only initialization handshake succeeds and the host advertises the required methods without mutation-like methods.

Fatal transport failures move the manager to `degraded`.

Examples:

- malformed stdout;
- unexpected child exit;
- request timeout;
- protocol mismatch;
- failed read-only handshake.

Ordinary HDSRC domain errors such as `STALE_STATE`, `INTEGRITY_FAILURE`, or `UNAUTHORIZED` do not by themselves mark the process unhealthy.

### 6.5 Bounded restart

The first v0.3 policy is deliberately conservative:

- one automatic restart attempt is allowed after a fatal process failure;
- the restart must create a fresh provider and increment `runtimeEpoch`;
- the original operation may be retried only if it is classified as safe to retry;
- if restart or retry fails, surface `PROVIDER_UNAVAILABLE` or the new provider/domain error;
- no unbounded retry loop;
- no exponential backoff scheduler in v0.3.

Safe automatic retry is limited to read-only operations whose caller request is unchanged:

- capabilities;
- state read;
- materialization manifest read;
- resource read;
- partial relation block-row read;
- materialization planning.

Resolved materialization creation is not automatically replayed across a fatal boundary in v0.3. The caller receives the error and may explicitly retry, because even though materialization is derived and deterministic, automatic replay would expand lifecycle semantics beyond what is needed for the first manager version.

### 6.6 Stop

`close()` / `stop()` closes the active provider and permanently transitions the manager instance to `stopped`.

Further operations fail closed instead of silently creating a replacement process.

## 7. Observation intent contract

### 7.1 Purpose

NVCL should express what it needs to observe, not which HDSRC carrier or spatialization algorithm to use.

Add an integration-local intent type:

```ts
interface HdsrcObservationIntentV1 {
  schema: 'hdsrc-observation-intent/v1'
  stateRef: string
  goalClass: string
  observationMode: 'human_preview' | 'machine_carrier' | 'structured_manifest'
  queryDirection?: 'outgoing' | 'incoming' | 'block' | 'mixed'
  expectedSpan?: number
  expectedReuse?: number
  latencyClass?: 'interactive' | 'batch'
  partialRelationBlockRow?: number
}
```

`stateRef` must be an `hdsrc://state/...` URI. Optional numeric fields must be non-negative/positive according to the existing workload contract.

### 7.2 Deterministic workload mapping

The router maps intent to the already-existing HDSRC workload contract without inventing carrier policy:

```text
intent.goalClass       → workload.goalClass
intent.observationMode → workload.observationMode
intent.queryDirection  → workload.queryDirection
intent.expectedSpan    → workload.expectedSpan
intent.expectedReuse   → workload.expectedReuse
intent.latencyClass    → workload.latencyClass
```

The resulting request remains:

```text
hdsrc-materialization-request/v1
```

No TypeScript code chooses `b8`, `b16`, `b32`, `b64`, `RCM`, `RCM_PP`, HPCM2 confidence policy, HMR1 oracle policy, or carrier encoding parameters.

Those remain canonical HDSRC decisions.

## 8. Observation router

### 8.1 Inputs

The router takes:

- `HdsrcObservationIntentV1`;
- `HdsrcAccessContext`;
- an `HdsrcRuntimeManager`.

It must apply MRMIC-side authorization before causing discovery/start/provider access.

### 8.2 Output modes

The router has three bounded result modes matching the existing observation separation.

#### Human preview

Flow:

```text
intent
→ workload request
→ resolved materialization
→ previewResourceUri
→ readResource
```

Returned data must contain only the approved preview payload and bounded routing evidence. It must not expose machine bytes, HDSRC principal identity, local filesystem paths, or process descriptor details.

#### Structured manifest

Requires `trustedStructured=true` before runtime access.

Flow:

```text
intent
→ resolved materialization
→ verified materialization manifest
```

It returns the existing `HdsrcMaterializationV1`; it does not return machine carrier bytes.

#### Machine carrier / partial relation observation

Requires `trustedMachine=true` before runtime access.

If `partialRelationBlockRow` is absent:

```text
intent
→ resolved materialization
→ machineResourceUri
→ verified machine resource
```

If `partialRelationBlockRow` is present:

```text
intent
→ resolved materialization
→ partial_relation_block_row
```

The partial path must use the v0.2 canonical HMBT1 partial reader and must not fetch the full carrier into Node first.

## 9. Stale and retry behavior

### 9.1 Stale materialization

`STALE_STATE` is not resolved by reusing an old materialization.

The router may perform a fresh planning/materialization request only when the caller explicitly invokes the router again. One routing invocation does not silently substitute stale data.

### 9.2 Integrity failure

`INTEGRITY_FAILURE` is never converted into oracle fallback, restart success, or stale recovery.

It propagates as a non-retryable HDSRC provider error.

### 9.3 Oracle fallback

`oracle_fallback` remains an HDSRC planning decision, not a process failure.

The manager remains `ready` while HMR1 resolves the materialization.

## 10. Security boundaries

The v0.3 implementation must preserve these ordering constraints:

$$
Authorize_{MRMIC}\rightarrow Discover\rightarrow Start\rightarrow Authorize_{HDSRC}\rightarrow Read
$$

Protected structured/machine observations must fail before:

- binding file read when possible after caller input validation;
- child-process start;
- HDSRC registry/state read;
- materialization read;
- resource read.

The runtime binding must never contain credentials. Environment variables may select a binding path but must not carry bearer tokens or HDSRC principals as part of this contract.

## 11. Proposed code boundaries

Keep new responsibilities small and isolated.

### `packages/provider-hdsrc/src/runtime-discovery.ts`

Owns:

- runtime binding parsing;
- discovery precedence;
- platform-aware known binding location;
- immutable descriptor creation.

Does not spawn a process.

### `packages/provider-hdsrc/src/runtime-manager.ts`

Owns:

- manager state machine;
- lazy provider construction;
- runtime epoch;
- single-flight start;
- bounded restart;
- stop lifecycle.

Delegates all HDSRC operations to `LocalProcessHdsrcProvider`.

### `packages/provider-hdsrc/src/observation-router.ts`

Owns:

- intent validation;
- deterministic intent→workload mapping;
- trusted lane preauthorization;
- routing to preview / manifest / full machine / partial relation result.

Does not implement HPCM2/HMR1/HMBT1 policy.

### Contracts

Add:

```text
contracts/hdsrc-integration/hdsrc-runtime-binding-v1.schema.json
contracts/hdsrc-integration/hdsrc-observation-intent-v1.schema.json
```

No Canvas schema changes are required.

## 12. Testing strategy

All implementation follows RED → GREEN TDD.

### 12.1 Discovery tests

Must cover:

- explicit binding path success;
- environment binding success;
- user-local binding success;
- precedence ordering;
- explicit malformed binding fails without fallback;
- environment malformed binding fails without user-local fallback;
- absent binding produces `PROVIDER_UNAVAILABLE`;
- unknown protocol fails closed;
- mutation capability is still rejected at runtime handshake;
- no disk scan / PATH probing behavior.

### 12.2 Lifecycle tests

Must cover:

- discovery without process start;
- lazy first start;
- concurrent first requests share one process;
- healthy requests reuse one process and one epoch;
- fatal child failure → `degraded`;
- bounded one-shot restart for safe read operation;
- successful restart increments runtime epoch;
- restart does not change HDSRC state identity/revision;
- second fatal failure surfaces error without restart loop;
- explicit stop is terminal;
- ordinary HDSRC domain errors do not degrade the manager.

### 12.3 Router tests

Must cover:

- exact intent→workload mapping;
- authorization before discovery/process access;
- trusted structured gate before runtime access;
- trusted machine gate before runtime access;
- human preview payload separation;
- structured manifest separation;
- full machine carrier route;
- partial relation route without full resource fetch;
- HPCM2 fast path preserved;
- HPCM2 oracle fallback preserved;
- stale state propagated rather than silently reused;
- integrity failure propagated non-retryably.

### 12.4 Real HDSRC validation

The final branch must again run the production host against the exact HDSRC v0.10 source/profile lineage with `HDSRC_TEST_STUB_RUNTIME` absent.

At minimum validate:

- discovered binding starts the real process;
- calibration-domain fast path;
- 4096D oracle fallback;
- partial relation observation remains partial;
- process restart creates a new runtime epoch while preserving HDSRC state identity;
- stale-state distinction remains correct;
- rebinding structural fail-closed remains intact;
- no canonical mutation method appears.

Real-runtime evidence must be stored separately from CI fixture evidence and must state clearly which layer each proves.

## 13. Acceptance criteria

Phase 14 v0.3 is complete only when all of the following hold:

1. deterministic runtime discovery exists with the documented precedence;
2. no arbitrary disk/PATH/network discovery occurs;
3. malformed higher-precedence binding fails closed;
4. local process starts lazily;
5. concurrent first callers share one start;
6. healthy process reuse is observable and deterministic;
7. fatal process failure transitions to degraded;
8. safe read-only operation has at most one automatic restart;
9. runtime epoch increments on successful restart;
10. runtime epoch never becomes HDSRC state revision;
11. intent→workload mapping is exact and policy-free;
12. protected lanes authorize before discovery/process/provider access;
13. human/structured/machine observations remain distinct;
14. partial relation route does not fetch the full carrier into Node first;
15. HPCM2 fast and oracle decisions remain canonical HDSRC outcomes;
16. stale and integrity failures remain distinct;
17. no HDSRC canonical mutation method is introduced;
18. no Canvas provider/resource enum change is introduced;
19. existing pixel-only multimodal Provider contract is unchanged;
20. full repository TypeScript check and test suite pass on branch head;
21. real HDSRC v0.10 validation passes with deterministic evidence;
22. PR diff contains no validation-only workflow plumbing at merge time;
23. merge uses an expected head SHA;
24. `main` post-merge CI passes independently.

## 14. Explicit non-goals

Phase 14 v0.3 does not implement:

- generic runtime discovery for all MRMIC providers;
- remote HDSRC HTTP/WebSocket transport;
- daemon/service installation;
- automatic HDSRC download/update;
- canonical HDSRC state writeback;
- Canvas edit → HDSRC symbolic mutation;
- online HPCM2 policy writeback from MRMIC;
- multi-tenant production security certification;
- persistent restart schedulers;
- automatic materialization replay after a fatal process boundary;
- new public `provider='hdsrc'` or Canvas resource enum values;
- widening the existing pixel-only multimodal Provider contract.

## 15. Resulting architecture

If v0.3 succeeds, the integration boundary becomes:

$$
\boxed{
\begin{aligned}
&\text{NVCL decides what observation it needs}\\
&\downarrow\\
&\text{MRMIC discovers and supervises the local HDSRC runtime}\\
&\downarrow\\
&\text{HDSRC decides how the state should be materialized}\\
&\downarrow\\
&\text{MRMIC/NVCL consumes only the authorized derived observation}
\end{aligned}
}
$$

This is the intended v0.3 closure: autonomous local use of HDSRC without transferring canonical state ownership, planning policy, or mutation authority into MRMIC.

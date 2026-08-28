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

`cwd`, `timeoutMs`, and `maxResourceBytes` are optional. `timeoutMs` and `maxResourceBytes`, when present, must be positive integers.

All path-bearing values must be non-empty. Absolute paths remain absolute. Relative paths are resolved exactly once against the directory containing the selected binding file; they are never resolved through `PATH`, arbitrary working-directory search, or Git discovery.

`profileRoot` has a stronger meaning than an artifact directory. For the v0.3 source-runtime profile it must resolve to the HDSRC v0.10 root containing both:

```text
src/hdsrc_exp/
artifacts_image_v010/
```

or equivalent profile files already supported by the v0.2 runtime adapter.

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

Precedence is source-selecting, not best-effort searching:

- if an explicit binding path is supplied, that source is authoritative for the call; missing, unreadable, or malformed content fails closed and does not fall through;
- otherwise, if `HDSRC_RUNTIME_BINDING` is set, that source is authoritative; missing, unreadable, or malformed content fails closed and does not fall through;
- otherwise, the deterministic user-local path is checked;
- if the user-local file is absent, discovery reports `PROVIDER_UNAVAILABLE`;
- if the user-local file exists but is unreadable or malformed, discovery fails closed.

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
- accept the first `python` found on `PATH` as proof of HDSRC identity;
- fetch or install HDSRC from the network;
- read credentials to discover a runtime;
- mutate the binding file as part of discovery.

Discovery answers only: "Which configured local runtime should MRMIC attempt to use?"

### 4.4 Profile-root module binding

Phase 14 v0.2 real validation explicitly supplied `PYTHONPATH` to the validator process. A production discovery layer must not depend on that external setup.

Therefore v0.3 makes the configured `profileRoot` the HDSRC Python module authority for the local host.

Before the production host imports canonical `hdsrc_exp` modules, it must bind:

```text
<profileRoot>/src
```

as the highest-priority HDSRC module root for that child process. The host must then verify that the loaded `hdsrc_exp` package resolves underneath that configured root.

Required failure behavior:

- missing `<profileRoot>/src/hdsrc_exp` → `PROVIDER_UNAVAILABLE`;
- loaded `hdsrc_exp` resolving outside the configured profile root → non-retryable `INTEGRITY_FAILURE`;
- no silent fallback to an installed same-name package;
- production discovery must remove/ignore `HDSRC_TEST_STUB_RUNTIME`; the CI fixture backend remains test-only.

This requires a small v0.3 bootstrap refactor in the Python host because the v0.2 host imports `hdsrc_exp.codec` before command-line configuration is available. The refactor changes import/bootstrap order only; it does not redefine HDSRC codec or planning semantics.

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

Every path in the descriptor is normalized to the resolved deployment path chosen from the binding.

The descriptor is MRMIC deployment state only. It is not persisted into Canvas state and is not exposed as HDSRC canonical metadata or NVCL observation content.

## 6. Runtime manager

### 6.1 Responsibility

The runtime manager wraps `LocalProcessHdsrcProvider`; it does not replace the v0.2 provider or duplicate HDSRC planning policy.

Allowed state transitions are:

```text
undiscovered → discovered
discovered   → starting
starting     → ready | degraded
ready        → degraded
degraded     → starting        (one eligible restart attempt)
undiscovered | discovered | starting | ready | degraded → stopped
```

`stopped` is terminal for one manager instance.

A failed discovery has no child-process side effect and leaves the manager undiscovered.

### 6.2 Manager operation surface

The manager exposes the existing read-only provider operations through lifecycle-aware wrappers rather than handing the router a raw child/provider instance:

```text
discover
capabilities
state
planMaterialization
materializeResolved
materialization
readResource
readPartialRelationBlockRow
status
stop
```

`materializeResolved` remains a derived-materialization operation, not canonical mutation.

### 6.3 Lazy start

Discovery may happen before process creation. The HDSRC child starts only when a provider operation is first required.

Concurrent first callers must share one in-flight start operation and one healthy provider instance.

The manager must not start multiple HDSRC children merely because multiple observation requests arrive concurrently.

### 6.4 Runtime epoch

Each successful process start receives a new monotonic manager-local runtime epoch:

```text
runtimeEpoch = 1, 2, 3, ...
```

The epoch is ephemeral integration state. It is not an HDSRC state revision and is not written into HDSRC manifests.

### 6.5 Failure classification

The v0.2 provider maps both process-origin failures and remote HDSRC errors into the provider-facing error surface. v0.3 must preserve enough internal origin information for the manager to decide whether restarting a child is meaningful.

The public `HdsrcProviderClient` contract does not change. Internally, local-process failures must preserve one of these origins:

```text
transport
contract
remote_domain
```

`transport` includes liveness failures such as:

- spawn/stdio failure;
- unexpected child exit;
- request timeout;
- write failure.

`contract` includes deterministic peer/protocol/security violations such as:

- malformed JSON response;
- protocol mismatch;
- malformed or unknown response id;
- malformed response envelope;
- read-only handshake missing required methods;
- handshake advertising mutation-like methods;
- configured HDSRC module root mismatch.

`remote_domain` means the process remained protocol-valid and returned an HDSRC error envelope, including `STALE_STATE`, `INTEGRITY_FAILURE`, `UNAUTHORIZED`, or even a provider-level availability error generated by HDSRC itself.

Manager behavior:

- `transport` → manager enters `degraded` and may use the bounded restart policy;
- `contract` → manager enters `degraded`, but no automatic restart is attempted because restarting the same misconfigured or contract-invalid peer is not a recovery strategy;
- `remote_domain` → manager remains `ready`; the HDSRC domain error is returned to the caller.

A minimal internal error subtype or equivalent tagged cause may be introduced to preserve this classification, but ordinary consumers must still receive the existing `HdsrcProviderError` semantics.

### 6.6 Bounded restart

The first v0.3 policy is deliberately conservative:

- one automatic restart attempt is allowed for an eligible `transport` failure during one manager operation;
- the failed provider is closed before a fresh provider is created;
- a successful fresh process increments `runtimeEpoch`;
- the original operation may be retried only if it is classified as safe to retry;
- no operation performs more than one automatic restart/retry cycle;
- a later independent transport failure on a later operation may receive its own one-shot restart attempt;
- if restart or retry fails, the manager remains degraded and surfaces the new error;
- no exponential-backoff scheduler or background restart loop exists in v0.3.

Safe automatic retry is limited to read-only operations whose caller request is unchanged:

- capabilities;
- state read;
- materialization manifest read;
- resource read;
- partial relation block-row read;
- materialization planning.

Resolved materialization creation is not automatically replayed across a fatal boundary in v0.3. The caller receives the error and may explicitly retry, because even though materialization is derived and deterministic, automatic replay would expand lifecycle semantics beyond what is needed for the first manager version.

### 6.7 Stop

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

Validation rules are exact:

- `stateRef` must be an `hdsrc://state/...` URI;
- `goalClass` must be non-empty;
- `expectedSpan`, when present, must be a positive integer;
- `expectedReuse`, when present, must be a positive integer;
- `partialRelationBlockRow`, when present, must be a non-negative integer;
- `partialRelationBlockRow` is legal only when `observationMode = machine_carrier` and `queryDirection = block`.

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

For every observation mode, `allowHdsrcRead=true` and a non-empty principal are required before discovery. Protected lanes add their trust gate before discovery as well.

### 8.2 Output modes

The router has three bounded result modes matching the existing observation separation. Each result may include the manager-local `runtimeEpoch` and HDSRC materialization decision as bounded routing evidence, but it must not expose runtime descriptor paths or HDSRC registry contents.

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

Requires `trustedStructured=true` before discovery or runtime access.

Flow:

```text
intent
→ resolved materialization
→ verified materialization manifest
```

It returns the existing `HdsrcMaterializationV1`; it does not return machine carrier bytes.

#### Machine carrier / partial relation observation

Requires `trustedMachine=true` before discovery or runtime access.

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

The v0.3 implementation must preserve this ordering:

$$
Authorize_{MRMIC}\rightarrow Discover\rightarrow Start\rightarrow Authorize_{HDSRC}\rightarrow Read
$$

For every lane, MRMIC read authorization must fail before the runtime binding file is read. For structured and machine lanes, the corresponding trusted-lane gate must also fail before the binding file is read.

Therefore unauthorized or untrusted requests must cause:

- zero runtime binding reads;
- zero child-process starts;
- zero HDSRC registry/state reads;
- zero materialization reads;
- zero resource reads.

The runtime binding must never contain credentials. Environment variables may select a binding path but must not carry bearer tokens or HDSRC principals as part of this contract.

## 11. Proposed code boundaries

Keep new responsibilities small and isolated.

### `packages/provider-hdsrc/src/runtime-discovery.ts`

Owns:

- runtime binding parsing;
- discovery precedence;
- platform-aware known binding location;
- binding-relative path resolution;
- immutable descriptor creation.

Does not spawn a process.

### `packages/provider-hdsrc/src/runtime-manager.ts`

Owns:

- manager state machine;
- lazy provider construction;
- runtime epoch;
- single-flight start;
- local failure-origin handling;
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

### Python host bootstrap

`scripts/hdsrc_process_host.py` receives a narrow bootstrap refactor so configured `profileRoot` is able to bind the canonical HDSRC module root before `hdsrc_exp` is imported. `scripts/hdsrc_runtime_adapter.py` remains the planning/materialization adapter and is not duplicated in TypeScript.

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
- explicit missing/malformed binding fails without fallback;
- environment missing/malformed binding fails without user-local fallback;
- absent user-local binding produces `PROVIDER_UNAVAILABLE`;
- binding-relative path resolution;
- unknown protocol fails closed;
- configured profile root binds the actual `hdsrc_exp` source root;
- same-name HDSRC package outside configured root cannot be silently used;
- production manager cannot activate `HDSRC_TEST_STUB_RUNTIME`;
- mutation capability is still rejected at runtime handshake;
- no disk scan / PATH probing behavior.

### 12.2 Lifecycle tests

Must cover:

- discovery without process start;
- lazy first start;
- concurrent first requests share one process;
- healthy requests reuse one process and one epoch;
- transport failure → `degraded`;
- contract failure → `degraded` without automatic restart;
- remote domain error leaves manager `ready`;
- bounded one-shot restart for safe read operation;
- successful restart increments runtime epoch;
- restart does not change HDSRC state identity/revision;
- one operation never performs a second automatic restart loop;
- resolved materialization is not automatically replayed after fatal transport failure;
- explicit stop is terminal.

### 12.3 Router tests

Must cover:

- exact intent→workload mapping;
- illegal partial-relation intent combinations fail before discovery;
- authorization before binding read/discovery/process access;
- trusted structured gate before binding read/discovery/process access;
- trusted machine gate before binding read/discovery/process access;
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

- a discovered binding starts the real process without external `PYTHONPATH` setup;
- loaded `hdsrc_exp` is bound to the configured HDSRC v0.10 profile root;
- calibration-domain fast path;
- 4096D oracle fallback;
- partial relation observation remains partial;
- a simulated transport death followed by an eligible read creates a new runtime epoch while preserving HDSRC state identity;
- stale-state distinction remains correct;
- rebinding structural fail-closed remains intact;
- no canonical mutation method appears.

Real-runtime evidence must be stored separately from CI fixture evidence and must state clearly which layer each proves.

## 13. Acceptance criteria

Phase 14 v0.3 is complete only when all of the following hold:

1. deterministic runtime discovery exists with the documented precedence;
2. no arbitrary disk/PATH/network discovery occurs;
3. explicit/environment-selected missing or malformed binding fails without lower-precedence fallback;
4. binding-relative path resolution is deterministic;
5. configured `profileRoot` is the actual loaded HDSRC module authority;
6. production cannot silently activate the CI stub runtime;
7. local process starts lazily;
8. concurrent first callers share one start;
9. healthy process reuse is observable and deterministic;
10. transport failures and contract failures are distinguishable from remote HDSRC domain errors;
11. only eligible transport failure can trigger an automatic restart;
12. one manager operation performs at most one automatic restart;
13. runtime epoch increments on successful restart;
14. runtime epoch never becomes HDSRC state revision;
15. resolved materialization is not automatically replayed after a fatal boundary;
16. intent→workload mapping is exact and policy-free;
17. illegal partial intent combinations fail before discovery;
18. all lanes authorize before binding read/discovery/process/provider access;
19. human/structured/machine observations remain distinct;
20. partial relation route does not fetch the full carrier into Node first;
21. HPCM2 fast and oracle decisions remain canonical HDSRC outcomes;
22. stale and integrity failures remain distinct;
23. no HDSRC canonical mutation method is introduced;
24. no Canvas provider/resource enum change is introduced;
25. existing pixel-only multimodal Provider contract is unchanged;
26. full repository TypeScript check and test suite pass on branch head;
27. real HDSRC v0.10 validation passes with deterministic evidence;
28. PR diff contains no validation-only workflow plumbing at merge time;
29. merge uses an expected head SHA;
30. `main` post-merge CI passes independently.

## 14. Explicit non-goals

Phase 14 v0.3 does not implement:

- generic runtime discovery for all MRMIC providers;
- arbitrary installed-Python-package discovery for HDSRC;
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
&\text{MRMIC discovers and supervises the configured local HDSRC runtime}\\
&\downarrow\\
&\text{HDSRC decides how the state should be materialized}\\
&\downarrow\\
&\text{MRMIC/NVCL consumes only the authorized derived observation}
\end{aligned}
}
$$

This is the intended v0.3 closure: autonomous local use of the explicitly configured HDSRC runtime without transferring canonical state ownership, planning policy, or mutation authority into MRMIC.

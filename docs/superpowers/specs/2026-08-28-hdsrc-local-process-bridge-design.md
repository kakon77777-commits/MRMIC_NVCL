# HDSRC Local Process Bridge Design

**Date:** 2026-08-28  
**Status:** Approved implementation design  
**MRMIC baseline:** `main@6549d7cb5b191cbf463d4f525e696a180c2a8569`  
**HDSRC runtime baseline:** `HDSRC ... HPCM2 ... Prototype v0.10` ZIP SHA-256 `583659487a25cd76a7a3a32a35fda373074e630c3f7f60e47c618358bbb1c217`

## 1. Goal

Replace the deterministic fake-only HDSRC integration path with a real local cross-process bridge while preserving the Phase 14 v0.1 authority boundary.

The executable relation is:

```text
MRMIC / provider-hdsrc (TypeScript)
        |
        | versioned JSONL over stdio
        v
HDSRC local Python host
        |
        +-- HDS1 canonical state decode
        +-- HMSP1 spatialization
        +-- HPCM1 predictive cost model
        +-- HPCM2 uncertainty/confidence gate
        +-- HMR1 oracle fallback when required
        +-- HMBT1 selected carrier materialization
```

The bridge is read-only with respect to canonical HDSRC state.

## 2. Source inspection findings

The v0.10 prototype already exposes the runtime pieces needed for a thin process host:

- `hdsrc_exp.codec.decode_hds1(...)` decodes exact canonical `SymbolicState` values from HDS1 bytes.
- `compile_multiscale_spatialization(...)` produces deterministic HMSP1 candidate spatializations.
- `extract_candidate_features(...)` derives non-materializing candidate features.
- `predict_workload_view_uncertain(...)` / `select_uncertainty_aware_view(...)` performs HPCM2 selection and returns `fast_path` / `requires_oracle`.
- `materialize_multiscale_view_bank(...)` and `evaluate_workload_on_materialized_bank(...)` provide HMR1 measurement/oracle behavior.
- `encode_hmbt1_from_state(...)` produces the exact selected HMBT1 carrier.
- `read_hmbt1_relation_block_row(...)` supports partial relation materialization.

Therefore MRMIC must not reimplement HMSP1/HPCM1/HPCM2/HMR1 in TypeScript.

## 3. Chosen transport

Use a persistent child process with newline-delimited JSON request/response messages over stdio.

Protocol id:

```text
hdsrc-process/0.1
```

Each request has:

```json
{
  "protocol": "hdsrc-process/0.1",
  "id": 1,
  "method": "state",
  "params": {}
}
```

Each response has exactly one of:

```json
{
  "protocol": "hdsrc-process/0.1",
  "id": 1,
  "result": {}
}
```

or:

```json
{
  "protocol": "hdsrc-process/0.1",
  "id": 1,
  "error": {
    "code": "STALE_STATE",
    "message": "...",
    "retryable": true
  }
}
```

Malformed protocol output is fatal to the process client: reject pending work and fail closed.

## 4. Process lifecycle

A new `LocalProcessHdsrcProvider` owns one persistent Python child process.

Startup configuration contains only local execution/configuration data:

- Python executable;
- host script path;
- HDSRC module root or installed package environment;
- state registry path;
- HPCM2 profile bundle path;
- materialization cache root;
- timeout and maximum resource-byte limits.

The child process must use `shell: false`, bounded stdio, and no inherited credential-bearing arguments.

Timeout behavior:

1. reject the timed-out request;
2. terminate the child process;
3. reject all pending requests as `PROVIDER_UNAVAILABLE`;
4. require an explicit new provider instance or restart before more work.

Unexpected child exit or malformed JSON behaves the same way.

## 5. Static HDSRC state registry

The Python host starts from a read-only JSON registry. Example:

```json
{
  "schema": "hdsrc-local-registry/v1",
  "states": [
    {
      "stateId": "state:demo",
      "stateRevision": 7,
      "hds1Path": "/absolute/path/state.hds1",
      "readPrincipals": ["principal:demo"]
    }
  ]
}
```

The host computes canonical state digest as:

```text
sha256(HDS1 bytes)
```

State revision is registry-owned metadata and remains independent from Canvas revision.

No process method registers, patches, replaces, or mutates HDSRC canonical state.

## 6. Independent HDSRC authorization

MRMIC authentication does not imply HDSRC authorization.

The TypeScript client passes only transient principal identity. The Python host independently checks `principalId` against the registry entry's `readPrincipals`.

Thus both conditions are required:

```text
MRMIC-side HdsrcAccessContext allows read
AND
HDSRC registry authorizes principal for the state
```

Credentials are never placed in Canvas metadata, materialization URIs, process protocol results, or test fixtures.

## 7. HPCM2 profile bundle

The host loads the existing v0.10 artifacts:

- predictive cost model (`PredictiveCostModel.from_json`);
- empirical uncertainty calibrator (`EmpiricalUncertaintyCalibrator.from_json`);
- confidence policy (`MarginConfidencePolicy.from_json_dict`).

The host does not train or modify these models in this slice.

Online calibration remains outside the bridge lifecycle for v0.2 because it is a provider-policy mutation and requires a separate persistence/authority contract.

## 8. Planning vs materialization

Preserve the existing v0.1 TypeScript interface where `materialize(...)` returns a decision only.

Two process methods are therefore distinct:

### `plan_materialization`

Pure provider decision path:

```text
HDS1 state
 -> HMSP1
 -> candidate features
 -> HPCM2
 -> fast_path OR oracle_fallback
```

No TIFF candidate is materialized on an HPCM2 fast path.

### `materialize`

Higher-level executable path used by the local-process provider extension.

If HPCM2 returns fast path:

1. select the HPCM2 block size/algorithm;
2. materialize only that HMBT1 carrier.

If HPCM2 returns `requires_oracle=true`:

1. invoke HMR1 measurement/oracle behavior in a temporary candidate bank;
2. choose the measured optimal block size;
3. persist only the selected HMBT1 carrier into the deterministic materialization cache;
4. report that oracle fallback was used.

Oracle fallback is a valid provider decision, not an integrity failure.

## 9. Materialization identity and persistence

Workload digest is SHA-256 over canonical JSON of the workload request.

Materialization identity is deterministic from:

```text
stateDigest
+ stateRevision
+ workloadDigest
+ selected block size
+ selected spatialization algorithm
```

Machine resource:

```text
hdsrc://state/{stateId}/materializations/{materializationId}/machine
```

Human preview resource:

```text
hdsrc://state/{stateId}/materializations/{materializationId}/preview
```

Selected HMBT1 bytes are persisted under the configured materialization root. A canonical JSON manifest is persisted beside them.

`materializationDigest` is the SHA-256 of the selected HMBT1 carrier bytes.

On every manifest/resource read after process restart, the host rechecks:

- current HDS1 digest;
- registered state revision;
- persisted materialization state digest/revision;
- persisted HMBT1 SHA-256 against `materializationDigest`.

Mismatch fails closed as `STALE_STATE` or `INTEGRITY_FAILURE`.

## 10. Human preview

The machine carrier and human preview remain separate resources.

The first real host emits a deterministic lightweight SVG preview derived from materialization metadata (state id, dimension, selected block size, spatialization id, decision mode). It is explicitly a human inspection surface and is not the machine carrier.

Mime type:

```text
image/svg+xml
```

## 11. Partial read

Because the selected carrier is HMBT1, the host supports a read-only relation-block-row resource backed by `read_hmbt1_relation_block_row(...)`.

The partial resource is structured JSON and includes:

- requested block row;
- exact decoded relation tuples;
- compressed tile indices / byte accounting where available.

This keeps `partialRead=true` truthful for the real local process provider.

## 12. TypeScript package changes

Keep all changes inside `packages/provider-hdsrc` plus new process-contract/test/host files.

Add:

- `src/process-client.ts` — generic fail-closed JSONL request client;
- `src/local-process.ts` — `LocalProcessHdsrcProvider` implementing existing read-only provider behavior and exposing `materializeResolved(...)` / partial-read helpers;
- process protocol types and validation;
- no re-export into the existing pixel-only multimodal Provider package.

Do not modify public Canvas provider/resource enums.

## 13. Python host

Add a thin executable adapter script under `scripts/`.

The script may import HDSRC Python modules only in the Python process. TypeScript must never import or embed Python HDSRC source.

The host methods are:

- `initialize`;
- `capabilities`;
- `state`;
- `plan_materialization`;
- `materialize`;
- `materialization`;
- `read_resource`;
- `read_partial_relation_block_row`;
- `shutdown`.

There is no canonical mutation method.

## 14. Test strategy

### CI transport/conformance tests

Node tests spawn the real Python host script against a tiny fixture `hdsrc_exp` package placed on `PYTHONPATH`. The fixture implements only the same callable surface; it is not claimed as HDSRC semantic evidence.

These tests prove:

- protocol handshake;
- request id correlation;
- independent HDSRC authorization;
- fast-path response;
- oracle-fallback response;
- machine/preview identity separation;
- persisted manifest lookup after host restart;
- stale state rejection;
- carrier digest corruption rejection;
- timeout kill;
- process crash failure propagation;
- malformed JSON fail-closed behavior;
- no canonical mutation method.

### Real HDSRC v0.10 validation

A separate local validation runner executes the same Python host against the actual v0.10 package identified by ZIP SHA-256 `583659...c217` and its real HPCM2 artifacts.

The validation must record:

- exact HDS1 source digest;
- HPCM2 decision;
- whether HMR1 fallback was used;
- selected HMBT1 profile/block size/spatialization;
- HMBT1 SHA-256;
- process restart + manifest read;
- machine resource digest verification;
- one real partial relation-block-row read.

This report is committed as evidence but is not mislabeled as CI reproducibility of the external HDSRC package.

## 15. Acceptance criteria

Slice 4 is complete only when:

1. existing Phase 14 v0.1 read-only tests remain green;
2. a real child-process client exists and fails closed;
3. HDSRC authorization remains independent from MRMIC authorization;
4. HPCM2 fast path does not materialize all candidate carriers;
5. HPCM2 fallback invokes HMR1 and persists only the selected final carrier;
6. selected HMBT1 carrier round-trip/integrity remains HDSRC-owned;
7. state/materialization freshness survives process restart;
8. corrupted carrier bytes fail integrity verification;
9. timeout/crash/malformed protocol output fail closed;
10. partial relation read is backed by the selected HMBT1 carrier;
11. no HDSRC canonical write API is introduced;
12. full MRMIC TypeScript check and test suite pass;
13. an independent local run against the actual v0.10 prototype succeeds and is recorded honestly.

## 16. Explicit non-goals

This slice does not add:

- HDSRC canonical writeback;
- online HPCM2 model/calibrator persistence;
- network/remote HDSRC transport;
- production multi-tenant auth;
- public `provider='hdsrc'` Canvas enum values;
- machine-carrier bytes to the pixel-only Provider contract;
- background daemon management;
- automatic HDSRC package installation.

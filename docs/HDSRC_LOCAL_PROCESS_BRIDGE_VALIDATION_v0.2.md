# HDSRC Local Process Bridge Validation v0.2

**Date:** 2026-08-28  
**MRMIC branch:** `integration/hdsrc-local-process-bridge-v0.2`  
**Base main:** `6549d7cb5b191cbf463d4f525e696a180c2a8569`  
**Protocol:** `hdsrc-process/0.1`  
**Scope:** real read-only local HDSRC v0.10 process bridge

## 1. Result

**PASS**, with one research/testing correction discovered during real-runtime validation.

The bridge now demonstrates the following composition without moving HDSRC policy into TypeScript:

$$
\boxed{
\text{MRMIC TypeScript provider}
\rightarrow
\text{JSONL stdio process}
\rightarrow
\text{HDSRC v0.10 runtime}
\rightarrow
\text{HPCM2/HMR1}
\rightarrow
\text{selected HMBT1}
}
$$

No canonical HDSRC mutation method is exposed.

## 2. Evidence layers

The validation deliberately separates two evidence layers.

### 2.1 GitHub CI — Node/TypeScript to production-host contract

GitHub Actions runs the real TypeScript `LocalProcessHdsrcProvider`, real JSONL process client and production `scripts/hdsrc_process_host.py` against an explicit deterministic test-only HDSRC backend.

The stub backend is enabled only when:

```text
HDSRC_TEST_STUB_RUNTIME=1
```

Normal production startup does not select it.

Task 4 GREEN run:

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

This layer proves transport, lifecycle, authorization, persistence, stale/integrity error mapping and TypeScript contract behavior.

### 2.2 External real-runtime validation — production host to HDSRC v0.10

The production Python bridge source was exported directly from GitHub Actions and executed against:

```text
/mnt/data/hdsrc_v010_src
```

No `HDSRC_TEST_STUB_RUNTIME` environment variable was present.

The validator used the canonical HDSRC v0.10 Python modules for HDS1 decode, HMSP1 spatialization, HPCM2 prediction/trust gating, HMR1 oracle measurement and HMBT1 materialization/partial reads.

Raw evidence:

```text
artifacts/hdsrc-local-process-v0.2/real-v010-validation.json
```

Raw evidence SHA-256:

```text
716a050d6a799143df2771ce792c077cb64b58c9d7a792e6e86a49be67fb16f6
```

A second independent run produced the same JSON byte-for-byte and the same SHA-256.

## 3. HDSRC lineage anchors

HDSRC v0.10 release ZIP SHA-256 was revalidated locally as:

```text
583659487a25cd76a7a3a32a35fda373074e630c3f7f60e47c618358bbb1c217
```

The existing canonical 4096D HDS1 used by the bridge has SHA-256:

```text
ea48a90eddc727b1684cf72204ddeaa720c6b67fe036561e05537622b0c12f85
```

It decodes to:

```text
dimension = 4096
nodes     = 72
k         = 8
relations = 576
```

## 4. Real HPCM2 fast path

A deterministic calibration-domain state was created with canonical HDSRC code:

```text
nodes     = 64
dimension = 64
k         = 4
seed      = 31001
```

For workload:

```text
query span    = 4
expected reuse = 16
```

real HPCM2 returned:

```text
decision        = fast_path
requiresOracle  = false
selectedCarrier = HMBT1
logicalScale    = 8
```

Resolved materialization:

```text
oracleUsed       = false
spatializationId = RCM_PP
materializationDigest = sha256:4251d168cb7c121e855c39ab8e45f8c4992aa786b1a08d6e6ab5dad1f3b52780
```

This demonstrates that the process bridge does not force every request through HMR1.

## 5. Real 4096D uncertainty fallback

For the canonical 72-node, 4096D state and workload:

```text
query span     = 8
expected reuse = 16
```

real HPCM2 returned:

```text
decision       = oracle_fallback
requiresOracle = true
reason          = outside_current_trust_region
```

The bridge preserved that defer state rather than translating it into an error.

HMR1 then selected:

```text
carrier           = HMBT1
logicalScale      = 32
spatializationId  = RCM_PP
oracleUsed        = true
carrier bytes     = 286313
materializationDigest = sha256:4127f98f00cca7d85d2975e13186a2373814dbe0b53d611cf74215695e9e6c5b
```

The digest was independently recomputed over the returned machine-carrier bytes and matched exactly.

## 6. Real partial machine-image I/O

The same 4096D carrier was queried through the process method:

```text
partial_relation_block_row
```

Block row 0 returned:

```text
canonical relations    = 256
compressed bytes read  = 1272
full carrier bytes     = 286313
```

Therefore:

$$
\frac{1272}{286313}
\approx
0.004443.
$$

Only about **0.444%** of the complete carrier byte count was charged to the compressed relation-block-row read.

The TypeScript bridge returns canonical relation records:

```text
(src, dst, kind, qsim)
```

and does not require the whole carrier to be transferred to Node before the partial query is answered.

## 7. Restart persistence

After the first production host exited, a fresh host process was started against the same read-only registry and materialization directory.

The following remained identical:

- materialization reference;
- materialization manifest;
- materialization digest;
- machine-resource URI;
- machine carrier bytes.

Result:

```text
restartPersistence = true
```

The materialization cache is therefore derived/persistent evidence, while canonical HDSRC state remains external authority.

## 8. Freshness and integrity negative controls

### 8.1 Valid changed canonical state

A second valid 72-node × 4096D HDS1 was produced with the canonical compiler and substituted under the same registry revision.

The old materialization then failed with:

```text
STALE_STATE
retryable = true
```

This demonstrates:

$$
\boxed{
\text{valid new canonical state}
\Rightarrow
\text{old materialization is stale}
}
$$

### 8.2 Malformed canonical bytes

Appending invalid bytes to the HDS1 caused the real canonical HDS1 decoder to fail before freshness comparison.

The provider correctly returned:

```text
INTEGRITY_FAILURE
retryable = false
```

This exposed and corrected an earlier test assumption from the deterministic stub.

The important distinction is:

$$
\boxed{
\text{Malformed HDS1}
\Rightarrow
\text{INTEGRITY_FAILURE}
}
$$

while:

$$
\boxed{
\text{Valid but changed HDS1}
\Rightarrow
\text{STALE_STATE}
}
$$

### 8.3 Tampered HMBT1

The persisted machine carrier was modified after materialization.

A subsequent machine-resource read returned:

```text
INTEGRITY_FAILURE
retryable = false
```

No tampered bytes were returned as current machine-image truth.

## 9. Authority result

The production process handshake reports:

```text
readOnly = true
canonicalMutation = false
```

The required method set contains only read/planning/materialization operations and no canonical state registration, replacement, patch, commit or mutation method.

Therefore the Phase 14 authority invariant remains:

$$
\boxed{
\mathrm{MRMIC/NVCL\ observation/materialization}
\not\Rightarrow
\mathrm{HDSRC\ canonical\ mutation}
}
$$

## 10. What this validation does and does not prove

The combined evidence proves:

1. the TypeScript provider and JSONL client correctly control the production host contract under CI;
2. the production host can execute the actual HDSRC v0.10 planner/materializer locally;
3. real HPCM2 fast and defer decisions survive the process boundary;
4. HMR1 fallback produces a selected real HMBT1 carrier;
5. HMBT1 carrier SHA, restart persistence, stale-state checks and tamper rejection are enforced;
6. real partial relation reads preserve compressed-segment locality;
7. canonical HDSRC write authority is not introduced.

It does **not** claim:

- remote/network transport;
- multi-tenant production security certification;
- canonical HDSRC state mutation;
- Canvas pixel edits as HDSRC symbolic writes;
- formal guarantees for HPCM2 confidence;
- that every high-dimensional state will use the same block size or spatialization.

## 11. Conclusion

Phase 14 Slice 4 crosses the boundary from a deterministic fixture integration to an actual HDSRC runtime integration:

$$
\boxed{
(S,W)
\rightarrow
\text{real HPCM2 trust decision}
\rightarrow
\begin{cases}
\text{selected fast HMBT1}\\
\text{HMR1 oracle}\rightarrow\text{selected HMBT1}
\end{cases}
\rightarrow
\text{MRMIC/NVCL read-only machine-image resource}
}
$$

The next engineering question is no longer whether MRMIC/NVCL can consume real HDSRC materializations. It can. Future work can focus on higher-level workload routing, deployment packaging and, separately, a deliberately designed canonical mutation contract if such a write path is ever authorized.

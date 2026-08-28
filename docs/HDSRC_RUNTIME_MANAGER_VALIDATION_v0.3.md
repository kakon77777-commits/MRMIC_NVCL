# HDSRC Runtime Manager — Real v0.10 Validation v0.3

**Date:** 2026-08-28  
**Scope:** Phase 14 v0.3  
**Integration source head used for exact build export:** `85797f524ecb79546280065fa4b7f0f44e426ccf`

## 1. Validation boundary

This validation separates two evidence layers.

GitHub CI validates the TypeScript/runtime contracts, deterministic fixtures, process transport, discovery precedence, failure-origin classification, runtime-manager lifecycle, and observation router.

External real-runtime validation executes the exact built integration source against the real HDSRC v0.10 source/profile lineage with `HDSRC_TEST_STUB_RUNTIME` absent.

Neither evidence layer is substituted for the other.

## 2. Exact-source export

A validation-only branch exported a build produced by the exact integration commit:

```text
85797f524ecb79546280065fa4b7f0f44e426ccf
```

GitHub Actions export run:

```text
33175331352
```

Artifact:

```text
hdsrc-runtime-manager-v03-exact-source
```

Artifact ZIP SHA-256:

```text
e821659a5b4cf39a73a841d9d537078c4c80122f1b678dd6561b7fc26e0c521c
```

The export workflow checked out the exact integration SHA, ran `npm install`, ran `npm run build`, and uploaded the resulting `dist/` tree together with the production HDSRC bridge scripts and validator.

## 3. HDSRC lineage

HDSRC v0.10 release ZIP SHA-256:

```text
583659487a25cd76a7a3a32a35fda373074e630c3f7f60e47c618358bbb1c217
```

Canonical 72-node × 4096D HDS1 SHA-256:

```text
ea48a90eddc727b1684cf72204ddeaa720c6b67fe036561e05537622b0c12f85
```

The real validator used the exact extracted HDSRC v0.10 source/profile tree and the production process host.

## 4. Deterministic evidence

The real-runtime validator was executed twice independently.

Both output files were byte-for-byte identical.

Canonical v0.3 evidence SHA-256:

```text
7f810af72aee6d165eb702a863542b871bca2883791e11e0ffd88105e5e990d7
```

Raw evidence:

```text
artifacts/hdsrc-runtime-manager-v0.3/real-v010-validation.json
```

## 5. Runtime discovery

Both configured discovery paths were exercised:

```text
explicit binding       -> source = explicit
environment binding    -> source = environment
```

Both resolved to the same configured runtime binding.

Most importantly, discovery remained side-effect free:

```text
discoveryStartedProcess = false
runtimeEpoch before first provider operation = 0
```

Therefore:

$$
\boxed{
Discovery \neq ProcessStart
}
$$

## 6. Production module authority

The discovered runtime launched through the production environment sanitizer.

Observed child environment:

```text
HDSRC_TEST_STUB_RUNTIME = absent
PYTHONPATH = absent
```

The production host bound the configured `<profileRoot>/src` as HDSRC module authority.

This demonstrates that real runtime startup no longer depends on an ambient `PYTHONPATH` prepared by the validator.

## 7. Real HPCM2 fast path

The deterministic calibration-domain state was:

```text
nodes = 64
dimension = 64
k = 4
relations = 256
```

Real HPCM2 result:

```text
decision = fast_path
oracleUsed = false
logicalScale = 8
spatializationId = RCM_PP
```

No TypeScript routing code selected the block scale or spatialization algorithm.

## 8. Real 4096D oracle fallback

Canonical state:

```text
nodes = 72
dimension = 4096
k = 8
stateRevision = 10
```

Real HPCM2 result:

```text
decision = oracle_fallback
reason = outside_current_trust_region
oracleUsed = true
```

HMR1 resolved the materialization to:

```text
carrier = HMBT1
logicalScale = 32
spatializationId = RCM_PP
```

The machine carrier size was:

```text
286313 bytes
```

## 9. Partial relation observation

The same 4096D state was routed through a `machine_carrier + block` observation intent with `partialRelationBlockRow = 0`.

Observed compressed partial I/O:

```text
compressedBytesRead = 1272
carrierBytes = 286313
```

Therefore:

$$
\frac{1272}{286313}
\approx
0.00444269
$$

or approximately:

$$
\boxed{0.4443\%}
$$

The router used the canonical HMBT1 partial relation reader and did not fetch the full machine resource into Node before the partial result.

## 10. Real process fault injection and bounded restart

The validator launched the production host through a validation-only executable wrapper that records its PID and then `exec`s the configured Python executable. The running PID therefore becomes the production HDSRC host; no production kill/debug API was added.

The first successful start established:

```text
runtimeEpoch = 1
```

The validator then sent `SIGKILL` to the actual production child.

The next safe state read triggered exactly one manager restart and succeeded with:

```text
runtimeEpoch = 2
```

The restarted PID differed from the original PID.

The HDSRC state remained identical across the process restart:

```text
stateId       unchanged
stateRevision unchanged
stateDigest   unchanged
dimension     unchanged
```

Thus:

$$
\boxed{
ProcessRestart \neq HDSRC\ StateRevision
}
$$

and:

$$
\boxed{
RuntimeEpoch \neq HDSRC\ StateRevision
}
$$

## 11. Remote-domain failures do not become lifecycle failures

After restart, a different but valid canonical 4096D HDS1 was placed under the same bound registry revision.

Existing materialization access returned:

```text
STALE_STATE
retryable = true
```

The manager remained `ready` at runtime epoch 2.

Malformed HDS1 bytes then returned:

```text
INTEGRITY_FAILURE
retryable = false
```

The manager again remained `ready` at runtime epoch 2.

This confirms that protocol-valid HDSRC domain errors are not misclassified as transport failures and do not cause process restart.

## 12. Structural rebinding fail-closed regression

The v0.2 full-rebinding validator was run from the same exact-source export against the real HDSRC v0.10 runtime.

Observed:

```text
metadataRebindingAccepted = true
structuralFailClosed = true
structuralCarrierRead.code = INTEGRITY_FAILURE
structuralCarrierRead.retryable = false
testStubRuntimeUsed = false
```

Therefore the v0.3 runtime manager and routing layer did not weaken the existing HMBT1 structural validation boundary.

## 13. Authority result

The complete real validation reported:

```text
canonicalMutation = false
testStubRuntimeUsed = false
```

The final runtime path is:

$$
\boxed{
\text{NVCL Observation Intent}
\rightarrow
\text{HDSRC Observation Router}
\rightarrow
\text{HDSRC Runtime Manager}
\rightarrow
\text{Discovered Production Host}
\rightarrow
\text{HPCM2/HMR1/HMBT1}
}
$$

while preserving:

$$
S_{HDSRC}\neq S_{Canvas}
$$

$$
Auth_{MRMIC}\not\Rightarrow Auth_{HDSRC}
$$

$$
\mathrm{Materialize}(S,W)\not\Rightarrow\mathrm{CanonicalMutation}(S)
$$

## 14. Claim boundary

This evidence supports a deterministic local HDSRC-scoped runtime discovery/lifecycle/routing implementation.

It does not establish or claim:

- generic discovery for every MRMIC provider;
- remote HDSRC transport;
- production multi-tenant security certification;
- HDSRC canonical writeback;
- Canvas edits as HDSRC symbolic mutation;
- background process supervision or unbounded restart;
- automatic replay of `materializeResolved` after a fatal transport boundary;
- automatic HPCM2 online-policy writeback from MRMIC;
- a new public Canvas provider/resource enum;
- any widening of the existing pixel-only multimodal Provider contract.

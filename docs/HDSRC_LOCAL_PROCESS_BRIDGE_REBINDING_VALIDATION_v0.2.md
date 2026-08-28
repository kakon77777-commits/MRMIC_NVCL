# HDSRC Local Process Bridge — Rebinding Validation Supplement v0.2

**Date:** 2026-08-28  
**Applies to:** Phase 14 local-process bridge v0.2  
**Primary validation:** `HDSRC_LOCAL_PROCESS_BRIDGE_VALIDATION_v0.2.md`

## 1. Why this supplement exists

PR-level self-review found that a persisted materialization manifest originally validated source freshness and carrier SHA-256, but did not fully bind the manifest identity back to the persisted folder/reference.

That left an important adversarial question:

> If an attacker changes the machine carrier and also rewrites its SHA-256 and manifest identity consistently, can the modified carrier authorize itself?

For HDSRC the required answer is **No**.

A digest is evidence, not authority:

$$
\boxed{
\text{Digest rebinding}
\not\Rightarrow
\text{valid machine-image semantics}
}
$$

## 2. TDD security finding

A new negative control was added before the fix.

RED GitHub Actions run:

```text
33157766424
```

At RED:

```text
215 tests
213 PASS
1 FAIL
1 existing SKIP
```

The only failure was the new rebound-evidence test. A rewritten persisted `materializationId` was still accepted.

The test was then split into two independent attacks:

1. carrier bytes changed and manifest `materializationDigest` rebound;
2. persisted materialization identity / resource URI rewritten.

## 3. Final binding model

The bridge now derives materialization identity from:

$$
\boxed{
materializationId
=
H(
stateDigest,
stateRevision,
workloadDigest,
logicalScale,
spatializationId,
materializationDigest
)
}
$$

A persisted manifest must satisfy all of the following:

- schema is exactly `hdsrc-materialization/v1`;
- `stateId` matches the authorized registry binding;
- `stateRevision` matches the registry revision;
- `stateDigest`, `workloadDigest`, and `materializationDigest` are valid SHA-256 values;
- `carrierProfile = HMBT1`;
- logical scale is one of `8,16,32,64`;
- deterministic materialization identity recomputes to the folder/reference identity;
- `materializationId` equals that deterministic identity;
- machine and preview URIs are derived exactly from the same resource root;
- the current canonical HDS1 still has the manifest source digest.

## 4. Structural HMBT1 validation

SHA-256 agreement alone is not enough.

On a cache miss, machine-carrier verification also performs the canonical HMBT1 decode and requires:

$$
Decode_{HMBT1}(carrier).state
=
S_{canonical}
$$

and:

$$
blockSize_{carrier}=blockSize_{manifest}
$$

$$
spatialization_{carrier}=spatialization_{manifest}.
$$

Therefore a fully rebound carrier still has to be a structurally valid HMBT1 representation of the current canonical HDSRC state.

## 5. CI GREEN after hardening

GREEN GitHub Actions run:

```text
33158105852
```

Result:

```text
216 tests
215 PASS
0 FAIL
1 existing SKIP
```

Both new negative controls passed:

- digest rebinding cannot authorize structurally tampered HMBT1 bytes;
- rewritten persisted materialization identity / resource URI fails closed.

## 6. Real HDSRC v0.10 full replay

After the hardening, the production bridge source was exported from an exact commit derived from the PR head and run against the real local HDSRC v0.10 source tree with `HDSRC_TEST_STUB_RUNTIME` absent.

The original complete real-runtime validator was run twice.

Both outputs were byte-for-byte identical with SHA-256:

```text
716a050d6a799143df2771ce792c077cb64b58c9d7a792e6e86a49be67fb16f6
```

This is the **same evidence hash as before the security hardening**, confirming that:

- real HPCM2 fast-path behavior remained unchanged;
- 4096D HPCM2 oracle fallback remained unchanged;
- selected HMBT1 carrier bytes remained unchanged;
- 4096D partial I/O remained 1272 / 286313 bytes (about 0.444%);
- restart, stale-state, malformed-HDS1, and ordinary tamper behavior remained unchanged.

## 7. Real full metadata-rebinding attack

A second real-runtime validator performs a stronger attack than the CI fixture:

1. materialize a real HMBT1 using real HDSRC v0.10;
2. modify the carrier bytes;
3. recompute the modified carrier SHA-256;
4. recompute a new deterministic `materializationId` using the new SHA;
5. create a matching new folder;
6. rewrite machine/preview URIs to that new identity;
7. persist a self-consistent rebound manifest;
8. verify that the rebound manifest passes metadata identity/freshness validation;
9. request the machine carrier.

The final machine read fails with:

```text
INTEGRITY_FAILURE
retryable = false
```

because structural HMBT1 validation rejects the modified bytes.

Raw evidence:

```text
artifacts/hdsrc-local-process-v0.2/real-v010-rebinding-validation.json
```

The real rebinding validator was run twice and both outputs were byte-for-byte identical.

Evidence SHA-256:

```text
bc8a327177937cfdffaadc6c55beb0333e06477e0a2492aa037a7be28f5a695b
```

Observed values:

```text
metadataRebindingAccepted = true
structuralFailClosed      = true
structuralCarrierRead     = INTEGRITY_FAILURE
retryable                 = false
testStubRuntimeUsed       = false
canonicalMutation         = false
```

The original real carrier SHA-256 was:

```text
4251d168cb7c121e855c39ab8e45f8c4992aa786b1a08d6e6ab5dad1f3b52780
```

The structurally modified/rebound carrier SHA-256 was:

```text
e04cb3af0c747c12c8d774408238c3c707164324f246db4e0b0d515f1eb2bed4
```

## 8. Result

The final v0.2 integrity relation is therefore:

$$
\boxed{
\text{Fresh source}
+
\text{deterministic identity binding}
+
\text{carrier SHA}
+
\text{HMBT1 structural decode}
\Rightarrow
\text{accepted machine-image resource}
}
$$

and not merely:

$$
\text{manifest says SHA matches}
\Rightarrow
\text{accepted}.
$$

This restores the same structural fail-closed principle used throughout the HDSRC carrier research line: even a validly rebound digest does not override canonical structural invariants.

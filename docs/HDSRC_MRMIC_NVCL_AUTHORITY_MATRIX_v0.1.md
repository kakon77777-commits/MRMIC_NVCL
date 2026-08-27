# HDSRC × MRMIC/NVCL Authority Matrix v0.1

**Status:** Draft contract companion for review  
**Date:** 2026-08-27  
**Architecture:** `HDSRC_MRMIC_NVCL_INTEGRATION_ARCHITECTURE_v0.1.md`

---

## 1. Purpose

This matrix turns the integration authority rules into explicit reviewable constraints.

The governing relation is:

$$
\boxed{
\text{Authority}
\neq
\text{Projection}
\neq
\text{Observation}
}
$$

HDSRC owns canonical symbolic state and materialization semantics. MRMIC owns Canvas and portal state. NVCL owns only its runtime decisions and traces; it mutates external state only through explicitly authorized tools.

---

## 2. Primary authority matrix

| Resource / State | Canonical authority | MRMIC may store | NVCL may observe | NVCL may mutate in v0.1 | Notes |
| --- | --- | --- | --- | --- | --- |
| HDSRC canonical symbolic state | HDSRC | reference only | authorized projection/descriptor only | No | Must not be copied into CanvasStore as sole truth |
| HDSRC state revision / digest | HDSRC | yes, as provider reference/evidence | Yes | No | Used for freshness checks |
| HDSRC spatialization plan | HDSRC | reference/evidence only | Trusted mode only | No | MRMIC must not reimplement HMSP1 policy |
| HDSRC carrier selection | HDSRC | selected profile metadata | Yes | No | HRT1/HPCM1/HPCM2 remain provider logic |
| HDSRC materialized carrier | HDSRC-derived resource | URI/cache reference | Authorized clients only | No | Derived, disposable, integrity-checked |
| HDSRC human preview | HDSRC-derived resource | preview URI/cache | Yes | No | May be lossy; must be marked as preview |
| HDSRC materialization manifest | HDSRC | URI/reference and selected fields | Trusted mode | No | Provider truth, not Canvas truth |
| HDSRC credentials | Credential authority / provider | No | No | No | Never durable Canvas evidence |
| MRMIC workspace | MRMIC | Yes | Yes | Via existing authorized Canvas tools | Independent from HDSRC state |
| MRMIC CanvasDocument | MRMIC | Yes | Yes | Via existing authorized Canvas tools | Canvas authority only |
| MRMIC resource portal object | MRMIC | Yes | Yes | Via existing authorized Canvas tools | Portal object is not provider resource |
| Portal transform / z-order | MRMIC | Yes | Yes | Yes under Canvas authority | Must not alter HDSRC digest |
| Portal display / interaction mode | MRMIC | Yes | Yes | Yes under Canvas authority | Does not grant HDSRC write authority |
| Portal projection lifecycle | MRMIC projection registry | process-local / projection state | Yes | Indirectly through valid lifecycle operations | Provider availability maps into lifecycle |
| MRMIC event ledger | MRMIC | Yes | Authorized inspection | No direct mutation | May record provider refs/digests, not secrets |
| NVCL runtime trace | NVCL/MRMIC runtime evidence | yes according to existing runtime contract | Yes | Runtime appends through existing logic | No hidden chain-of-thought requirement |
| NVCL pixel observation | Observation pipeline | immutable frame evidence | Yes | No | Must not leak hidden HDSRC structured state |
| NVCL structured HDSRC observation | HDSRC-derived + trusted bridge | reference/evidence only | Trusted mode | No | Explicit authorization required |
| NVCL machine-carrier observation | HDSRC-derived + trusted bridge | resource handle only | Trusted machine client | No | Separate from pixel Provider contract |

---

## 3. Operation authority matrix

| Operation | HDSRC effect | MRMIC effect | Allowed in v0.1 |
| --- | --- | --- | --- |
| Move portal | none | portal transform changes | Yes |
| Resize portal | none | portal transform changes | Yes |
| Reorder portal | none | z-order changes | Yes |
| Hide/show portal | none | display state changes | Yes |
| Close portal | none | portal projection closes | Yes |
| Refresh portal preview | new/confirmed derived projection only | preview reference may change | Yes |
| Request machine carrier | may materialize derived resource | no canonical Canvas mutation required | Yes, authorized read path |
| Request partial carrier region | may materialize/read derived region | no canonical Canvas mutation required | Yes, authorized read path |
| HPCM2 fast-path decision | derived materialization decision | projection may update after result | Yes |
| HPCM2 oracle fallback | provider performs measurement/calibration | portal may remain pending/suspended | Yes |
| Patch Canvas portal metadata | none unless explicit provider call exists | portal metadata changes | Yes under schema/authority |
| Edit preview pixels | none | optional local preview artifact only | Not canonical HDSRC mutation |
| Patch HDSRC canonical state from Canvas | canonical HDSRC mutation | may follow only after future contract | No |
| Treat portal geometry as HDSRC coordinates | implicit canonical mutation risk | projection coupling | No |
| Treat Canvas revision as HDSRC revision | revision collapse | invalid freshness semantics | No |
| Reuse stale unverified carrier as current | integrity/freshness violation | false projection truth | No |

---

## 4. Revision and identity matrix

The integration keeps independent revision domains:

$$
revision_{Canvas}
\neq
revision_{HDSRC}
\neq
revision_{Materialization}.
$$

Recommended identity tuple:

$$
I_{HDSRC}
=
(stateId,stateRevision,stateDigest).
$$

Recommended materialization tuple:

$$
I_M
=
(materializationId,materializationDigest,workloadDigest).
$$

Recommended Canvas portal identity:

$$
I_C
=
(canvasId,canvasObjectId,revision_{Canvas}).
$$

No implementation may replace these three domains with one shared revision counter.

---

## 5. Authentication and authorization matrix

| Question | Authority |
| --- | --- |
| Is this MRMIC principal authenticated? | MRMIC identity/auth layer |
| May the principal mutate this Canvas? | MRMIC Canvas/security contract |
| May the principal see this HDSRC state? | HDSRC provider authorization |
| May the principal request this carrier? | HDSRC provider authorization |
| May the principal receive machine-carrier bytes? | HDSRC provider + bridge observation policy |
| May the principal mutate HDSRC state? | Future HDSRC mutation contract; always No in v0.1 |

Therefore:

$$
\boxed{
Auth_{MRMIC}
\not\Rightarrow
Auth_{HDSRC}
}
$$

and:

$$
\boxed{
Read_{HDSRC}
\not\Rightarrow
Write_{HDSRC}
}
$$

---

## 6. Failure ownership matrix

| Failure | Owning layer | Required bridge behavior |
| --- | --- | --- |
| malformed HDSRC manifest | provider-hdsrc adapter validation | fail closed |
| unsupported carrier profile | HDSRC provider / adapter contract | explicit unsupported error |
| state revision mismatch | HDSRC freshness check | stale/suspended projection |
| materialization digest mismatch | HDSRC integrity layer | reject bytes; no silent retry as current |
| HPCM2 requires oracle | HDSRC planning layer | defer; not an integrity failure |
| HMR1 oracle fails | HDSRC provider | explicit failure; retain last verified snapshot only if marked stale |
| HDSRC provider unavailable | transport/provider | suspend or show explicit stale snapshot |
| MRMIC principal invalid | MRMIC identity/auth | reject before protected access |
| HDSRC authorization denied | HDSRC provider | return unauthorized; do not translate to not-found unless policy explicitly requires it |
| Canvas portal transaction fails | MRMIC Canvas transaction layer | normal Canvas rollback/recovery |
| NVCL pixel frame stale | existing multimodal lab freshness gate | reject/regenerate; never reuse stale coordinates |

---

## 7. Review gate for implementation

Slices 0–3 may proceed only if implementation preserves all of the following:

1. HDSRC canonical state remains external authority.
2. `native_resource_portal_v1` remains a projection object.
3. v0.1 HDSRC access remains read-only.
4. Pixel-only Provider boundaries are not widened by machine-carrier support.
5. MRMIC and HDSRC authorization remain independent.
6. Canvas and HDSRC revision domains remain independent.
7. HPCM2 oracle fallback remains a valid defer state.
8. Stale or corrupt resources fail closed.
9. Credentials never enter durable Canvas state.
10. Existing Phase 13 security and negative controls remain mandatory regression coverage.

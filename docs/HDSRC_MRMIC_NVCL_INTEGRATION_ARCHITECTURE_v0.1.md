# HDSRC × MRMIC/NVCL Integration Architecture v0.1

**Status:** Draft architecture contract for review  
**Date:** 2026-08-27  
**MRMIC baseline:** `main@791efb9d98270d4db9c25f257aac805196ba62e8`  
**MRMIC version:** `0.14.0` / Phase 13 Canvas-first PMW Visual World  
**HDSRC baseline:** Image Carrier research prototype through v0.10 / HPCM2  
**Scope:** provider/adapter integration, read-only projection, dual-view observation, authority and fallback contracts

---

## 1. Purpose

This document defines the first integration boundary between HDSRC and MRMIC/NVCL.

The integration does **not** merge the two runtimes and does **not** move HDSRC canonical state into the MRMIC CanvasStore. Instead, HDSRC remains the authority for high-dimensional symbolic state and adaptive materialization, while MRMIC remains the authority for Canvas geometry, portal projection state, interaction state, synchronization, event history and Visual World presentation.

NVCL consumes projected observations through the existing guarded observation/action architecture. In v0.1, NVCL does not obtain authority to mutate HDSRC canonical state.

The core relation is:

$$
\boxed{
\text{HDSRC Provider}
\leftrightarrow
\text{MRMIC Resource Portal}
\leftrightarrow
\text{NVCL Observation Loop}
}
$$

The first implementation goal is therefore not a new image editor. It is a provider-neutral bridge that allows a high-dimensional symbolic state to appear inside the persistent MRMIC Visual World as a derived, addressable, partially materializable machine-image resource.

---

## 2. Source authorities

### 2.1 HDSRC authority

HDSRC owns:

- canonical high-dimensional symbolic state;
- state identity and state digest;
- symbolic basis and relation semantics;
- spatialization plans;
- carrier selection;
- scale selection;
- materialization policy;
- partial materialization semantics;
- predictive materialization cost estimates;
- uncertainty state and oracle fallback decisions;
- carrier integrity and decode invariants.

A materialized image is derived from HDSRC state:

$$
M
=
\mathcal{P}(S,W,\Pi,B,C),
$$

where $S$ is canonical HDSRC state, $W$ is workload, $\Pi$ is spatialization, $B$ is logical scale and $C$ is carrier topology.

Therefore:

$$
\boxed{M\neq S}
$$

and destruction of a materialization must not imply destruction of the canonical HDSRC state.

### 2.2 MRMIC authority

MRMIC owns:

- workspace and Canvas identity;
- Canvas object identity;
- portal geometry;
- portal display mode;
- portal interaction mode;
- z-order and viewport projection;
- Canvas transaction history;
- synchronization state;
- snapshots and restore;
- authenticated runtime presence;
- live-host mounted/visible/focused/control state.

The MRMIC resource portal is a projection of an external resource:

$$
\boxed{\pi_C(r)\neq r}
$$

A Canvas transaction that moves, resizes, hides or reorders a portal does not mutate the provider resource.

### 2.3 NVCL authority

NVCL owns no canonical HDSRC or Canvas state. It operates through existing observation, guarded action, verification and recovery contracts.

For this integration, NVCL may:

- request a human-readable preview;
- request a trusted structured HDSRC observation descriptor;
- request an already-authorized machine-image resource;
- compare observations across revisions;
- use Canvas tools against MRMIC projection objects under existing authority rules.

In v0.1 NVCL may not directly mutate HDSRC state.

---

## 3. Non-negotiable invariants

### Invariant A — canonical-state separation

$$
\boxed{
S_{\mathrm{HDSRC}}
\neq
S_{\mathrm{Canvas}}
}
$$

No HDSRC state object is serialized into CanvasStore as the sole authoritative copy.

### Invariant B — portal non-ownership

$$
\boxed{
\mathrm{Portal}(r_{\mathrm{HDSRC}})
\neq
r_{\mathrm{HDSRC}}
}
$$

The portal may carry provider identity and preview handles, but it never becomes the owner of HDSRC native state.

### Invariant C — observation is not mutation

$$
\boxed{
\mathrm{NVCLObserve}(M)
\not\Rightarrow
\mathrm{HDSRCMutation}(S)
}
$$

Pixel observation, structured observation and machine-image access do not grant write authority.

### Invariant D — machine image is derived evidence

A machine image may be exact and round-trip capable while still remaining derived from canonical state:

$$
\mathrm{Decode}(M)=S
$$

does not imply:

$$
M\equiv S
$$

as an authority statement.

### Invariant E — fail closed on stale or unverifiable projection

If state digest, provider revision, materialization digest or authorization cannot be verified, the bridge must not silently reuse the projection as current truth.

### Invariant F — credentials never enter durable Canvas evidence

Provider bearer tokens, API keys and private credentials must never be stored in:

- Canvas objects;
- portal metadata;
- event-ledger payloads;
- public preview URIs;
- HDSRC materialization metadata intended for display.

This extends the existing Phase 13 secure-principal rule.

---

## 4. Integration model

The v0.1 architecture is:

```text
HDSRC Canonical State
        │
        ├─ state digest / revision
        ├─ HMSP1 spatialization candidates
        ├─ HPCM1 cost prediction
        ├─ HPCM2 uncertainty / trust decision
        │       ├─ fast path
        │       └─ HMR1 oracle fallback
        ▼
HDSRC Materialization Provider
        │
        ├─ machine carrier resource
        ├─ human preview resource
        ├─ projection manifest
        └─ partial-read capability
        │
        ▼
MRMIC provider-hdsrc adapter
        │
        ▼
native_resource_portal_v1
        │
        ├─ Canvas geometry / display / interaction
        └─ providerResourceId → HDSRC resource
        │
        ▼
MRMIC / NVCL observation
        ├─ human pixel view
        ├─ structured descriptor
        └─ trusted machine-image view
```

The bridge must be transport-neutral. A first implementation may use a local process boundary, HTTP, stdio or another explicitly versioned local contract. The architecture must not require importing HDSRC Python implementation code directly into MRMIC TypeScript packages.

---

## 5. Initial compatibility profile

The first implementation should avoid changing the public Phase 13 portal enums until the integration is demonstrated.

MRMIC v0.14 already supports:

```ts
provider: 'external'
resourceKind: 'artifact'
```

Therefore the v0.1 compatibility binding is:

```text
provider = external
resourceKind = artifact
providerResourceId = hdsrc://...
```

This allows HDSRC to be integrated without prematurely changing `native_resource_portal_v1`.

After successful read-only integration, a later contract revision may add explicit values such as:

```text
provider = hdsrc
resourceKind = symbolic_state | machine_image | materialized_view
```

Such an enum change is **not** part of v0.1.

---

## 6. HDSRC resource namespace

The integration defines a provider-owned URI namespace. These URIs are resource identities, not filesystem paths.

Recommended forms:

```text
hdsrc://state/{stateId}
hdsrc://state/{stateId}/manifest
hdsrc://state/{stateId}/materializations/{materializationId}
hdsrc://state/{stateId}/materializations/{materializationId}/manifest
hdsrc://state/{stateId}/materializations/{materializationId}/machine
hdsrc://state/{stateId}/materializations/{materializationId}/preview
hdsrc://state/{stateId}/materializations/{materializationId}/partial/{regionId}
hdsrc://capabilities
```

The URI must not contain credentials.

### 6.1 State resource

A state resource identifies the canonical HDSRC state authority.

Minimum provider metadata:

```json
{
  "schema": "hdsrc-state-ref/v1",
  "stateId": "state:example",
  "stateRevision": 12,
  "stateDigest": "sha256:...",
  "dimension": 4096,
  "authority": "hdsrc"
}
```

### 6.2 Materialization resource

A materialization resource identifies one derived representation.

Minimum metadata:

```json
{
  "schema": "hdsrc-materialization/v1",
  "materializationId": "mat:example",
  "stateId": "state:example",
  "stateRevision": 12,
  "stateDigest": "sha256:...",
  "materializationDigest": "sha256:...",
  "carrierProfile": "HMBT1",
  "spatializationId": "RCM_PP",
  "logicalScale": 32,
  "workloadDigest": "sha256:...",
  "machineResourceUri": "hdsrc://state/state:example/materializations/mat:example/machine",
  "previewResourceUri": "hdsrc://state/state:example/materializations/mat:example/preview"
}
```

The materialization manifest is derived provider truth. MRMIC may reference it but must not redefine it.

---

## 7. HDSRC capability document

HDSRC should expose a transport-neutral capability document before MRMIC requests a materialization.

Recommended schema:

```json
{
  "schema": "hdsrc-provider-capabilities/v1",
  "providerVersion": "0.1",
  "stateProfiles": ["HDSRC-SymbolicState"],
  "carrierProfiles": [
    "HIC1",
    "SNIC1",
    "SFPIC1",
    "HDT1",
    "HST1",
    "HCT1",
    "HBT1",
    "HMBT1"
  ],
  "planningProfiles": ["HRT1", "HMSP1", "HPCM1", "HPCM2"],
  "observationModes": ["human_preview", "machine_carrier", "structured_manifest"],
  "partialRead": true,
  "oracleFallback": true,
  "canonicalMutation": false
}
```

The existing MRMIC `mrmic://capabilities` remains authoritative for MRMIC. HDSRC capability negotiation is provider capability negotiation, not a replacement for MRMIC capability negotiation.

The two documents may later be aggregated by a higher PMW capability layer, but v0.1 keeps them independent.

---

## 8. Portal binding contract

The first portal uses existing `native_resource_portal_v1` fields.

Recommended binding:

```json
{
  "portalId": "portal:hdsrc:example",
  "pmwWorkspaceId": "workspace:example",
  "provider": "external",
  "resourceKind": "artifact",
  "providerResourceId": "hdsrc://state/state:example/materializations/mat:example",
  "displayMode": "snapshot",
  "interactionMode": "inspect"
}
```

### 8.1 Portal content

`content.previewUri` may point to a human-readable preview of the selected HDSRC materialization.

The actual machine-image carrier URI must remain provider-owned and discoverable through the HDSRC materialization manifest. MRMIC should not overload `previewUri` to mean both human preview and canonical machine carrier.

### 8.2 Projection lifecycle

MRMIC retains its current lifecycle:

```text
bound
projected_snapshot
projected_live
suspended
closed
```

The HDSRC adapter maps provider state onto this lifecycle but does not change provider authority.

Recommended mapping:

```text
provider state available + manifest verified → projected_snapshot
live provider stream established           → projected_live
provider unavailable / stale / uncertain   → suspended
portal explicitly closed                    → closed
```

A suspended portal remains a Canvas object. Suspension does not delete the HDSRC state.

---

## 9. Human and machine dual-view model

This integration explicitly separates human projection from machine projection.

Define:

$$
O_t
=
(
I_t^{human},
I_t^{machine},
D_t^{structured}
).
$$

Where:

- $I_t^{human}$ is a displayable PNG/SVG or equivalent preview;
- $I_t^{machine}$ is an HDSRC carrier or partial carrier resource;
- $D_t^{structured}$ is a trusted manifest or structured observation descriptor.

These representations may describe the same underlying state but are not interchangeable.

### 9.1 Human preview

Purpose:

- Canvas presentation;
- human inspection;
- NVCL pixel-mode observation when explicitly requested;
- visual debugging.

The preview may be lossy or simplified as long as it is marked as a preview.

### 9.2 Machine carrier

Purpose:

- AI-native symbolic observation;
- exact or profile-defined decode;
- partial materialization;
- carrier-level experiments;
- trusted runtime consumers.

The machine carrier must preserve its own integrity and profile metadata.

### 9.3 Structured descriptor

Purpose:

- state/materialization identity;
- revision and digest checks;
- workload and carrier metadata;
- confidence / fallback evidence;
- region or tile addressing.

A structured descriptor does not automatically reveal the full canonical HDSRC state.

---

## 10. NVCL observation path

The v0.1 NVCL integration is read-only with respect to HDSRC.

Recommended flow:

```text
NVCL goal
  → current Canvas / portal observation
  → identify HDSRC portal
  → request provider manifest
  → verify state/materialization freshness
  → choose observation mode
       ├─ human preview
       ├─ structured descriptor
       └─ machine carrier / partial carrier
  → NVCL decision
```

### 10.1 Pixel mode

Existing pixel-native Provider boundaries must remain intact.

If NVCL requests pixel mode, the Provider receives only the approved raster projection and safe metadata. HDSRC object identities, hidden structured fields, authority tokens and canonical internal state must not leak through the pixel boundary.

### 10.2 Structured trusted mode

A trusted local NVCL runtime may receive `hdsrc-materialization/v1` metadata when explicitly authorized.

### 10.3 Machine-native mode

A future trusted AI runtime may consume the HDSRC machine carrier directly. This is distinct from the existing pixel-only Provider request contract and must not silently widen that contract.

Therefore:

$$
\boxed{
\text{NVCL Pixel Provider}
\neq
\text{HDSRC Machine-Carrier Consumer}
}
$$

The two are separate observation clients even if they participate in the same higher-level NVCL loop.

---

## 11. Workload and adaptive materialization

MRMIC/NVCL may provide a workload hint, but HDSRC retains authority over final materialization policy.

A workload request may include:

```json
{
  "schema": "hdsrc-workload-hint/v1",
  "goalClass": "relation_inspection",
  "observationMode": "machine_carrier",
  "queryDirection": "outgoing",
  "expectedSpan": 16,
  "expectedReuse": 32,
  "latencyClass": "interactive"
}
```

HDSRC may map this through:

$$
(S,W)
\rightarrow
HMSP1
\rightarrow
HPCM1
\rightarrow
HPCM2
\rightarrow
\begin{cases}
\text{FastMaterialization}\\
\text{OracleFallback}
\end{cases}
$$

MRMIC must treat the returned materialization decision as provider output, not reproduce HDSRC planning logic inside TypeScript.

This prevents duplicate policy implementations from diverging.

---

## 12. Uncertainty and fallback semantics

HPCM2 introduced a trust/defer decision. The integration must preserve that distinction.

Recommended provider response:

```json
{
  "schema": "hdsrc-materialization-decision/v1",
  "decision": "fast_path",
  "selectedCarrier": "HMBT1",
  "logicalScale": 32,
  "confidence": {
    "mode": "empirical",
    "requiresOracle": false
  }
}
```

or:

```json
{
  "schema": "hdsrc-materialization-decision/v1",
  "decision": "oracle_fallback",
  "confidence": {
    "mode": "empirical",
    "requiresOracle": true,
    "reason": "outside_current_trust_region"
  }
}
```

MRMIC must not reinterpret `oracle_fallback` as a failed state. It is a valid provider decision.

If the oracle itself fails, the portal should become suspended or remain on the last verified snapshot with an explicit stale marker. It must not silently present stale bytes as a current projection.

---

## 13. Freshness contract

A projection is current only if its source identity remains current.

At minimum the bridge compares:

$$
F
=
(
stateId,
stateRevision,
stateDigest,
materializationDigest
).
$$

A cached materialization may be reused only when the provider confirms that this tuple remains valid for the requested observation.

MRMIC Canvas revision is separate:

$$
revision_{Canvas}
\neq
revision_{HDSRC}.
$$

Moving a portal increments Canvas state without changing HDSRC state. Updating HDSRC state may invalidate the materialization without changing portal geometry.

The bridge must never collapse these revisions into one counter.

---

## 14. Identity and authorization propagation

Phase 13 already resolves verified principals at MRMIC mutation ingress. HDSRC integration must preserve this security model.

The adapter may receive a verified principal context such as:

```json
{
  "principalId": "principal:example",
  "role": "viewer",
  "semanticAgentId": "agent:example"
}
```

This identity may be passed to HDSRC provider authorization as transient call context.

It must not be copied into provider resource IDs or public preview URIs.

The HDSRC provider remains responsible for deciding whether that principal may access a state or materialization.

MRMIC authentication does not automatically imply HDSRC authorization:

$$
\boxed{
Auth_{MRMIC}
\not\Rightarrow
Auth_{HDSRC}
}
$$

---

## 15. Mutation authority boundary

### 15.1 v0.1 rule

All HDSRC portals are read-only with respect to canonical HDSRC state.

Recommended portal interaction modes:

```text
inspect
read_only
```

MRMIC may still mutate the Canvas portal object itself under normal Canvas authority.

### 15.2 Explicitly excluded from v0.1

The following are not implemented in the first integration:

- HDSRC canonical state patching from Canvas operations;
- image-pixel edit → canonical symbolic mutation;
- NVCL direct HDSRC write tools;
- HDSRC mutation through `canvas.patch_object`;
- automatic provider-side writeback from portal geometry;
- hidden cross-provider authority inheritance.

A future write path must define a separate HDSRC mutation contract with its own preconditions, authorization, provenance, verification and rollback semantics.

---

## 16. Proposed MRMIC package boundary

The first implementation should add one focused package:

```text
packages/provider-hdsrc/
```

Suggested responsibilities:

```text
provider-hdsrc
  ├─ parse/validate HDSRC capability documents
  ├─ parse/validate state/materialization manifests
  ├─ create provider-neutral portal binding descriptors
  ├─ resolve human preview resources
  ├─ resolve trusted machine/structured resources
  ├─ perform freshness checks
  ├─ map provider availability to portal lifecycle
  └─ never own or mutate HDSRC canonical state
```

The package should not:

- implement HPCM1/HPCM2;
- decode every HDSRC carrier profile;
- import the HDSRC Python source tree;
- become a second HDSRC state store;
- bypass `resource_portal` ownership rules.

A minimal transport interface can be:

```ts
export interface HdsrcProviderClient {
  capabilities(): Promise<HdsrcProviderCapabilitiesV1>
  state(ref: string, context: HdsrcAccessContext): Promise<HdsrcStateRefV1>
  materialize(request: HdsrcMaterializationRequestV1, context: HdsrcAccessContext): Promise<HdsrcMaterializationDecisionV1>
  materialization(ref: string, context: HdsrcAccessContext): Promise<HdsrcMaterializationV1>
  readResource(uri: string, context: HdsrcAccessContext): Promise<HdsrcResourcePayload>
}
```

The concrete transport remains replaceable.

---

## 17. Contract files proposed for implementation phase

The implementation phase should introduce versioned JSON contracts under:

```text
contracts/hdsrc-integration/
```

Recommended first schemas:

```text
hdsrc-provider-capabilities-v1.schema.json
hdsrc-state-ref-v1.schema.json
hdsrc-workload-hint-v1.schema.json
hdsrc-materialization-request-v1.schema.json
hdsrc-materialization-decision-v1.schema.json
hdsrc-materialization-v1.schema.json
hdsrc-provider-error-v1.schema.json
```

Provider-neutral examples should be stored beside the schemas.

No secret or account-backed credential may appear in examples.

---

## 18. Error model

Recommended fail-closed provider error envelope:

```json
{
  "schema": "hdsrc-provider-error/v1",
  "code": "STALE_STATE",
  "message": "materialization source revision no longer matches provider state",
  "retryable": true
}
```

Initial error codes:

```text
INVALID_REQUEST
UNAUTHORIZED
RESOURCE_NOT_FOUND
UNSUPPORTED_PROFILE
STALE_STATE
INTEGRITY_FAILURE
MATERIALIZATION_FAILED
ORACLE_REQUIRED
ORACLE_FAILED
PROVIDER_UNAVAILABLE
```

`ORACLE_REQUIRED` is not an integrity error. It is a defer decision.

`INTEGRITY_FAILURE` must never be silently retried using the same unverified bytes as current truth.

---

## 19. Caching and persistence

MRMIC may cache derived preview bytes for display efficiency, but caches are disposable.

A cache key must include immutable provider identity such as:

$$
K
=
H(
stateDigest,
materializationDigest,
resourceUri
).
$$

MRMIC must not treat cached HDSRC carrier bytes as a replacement canonical state store.

Event ledger entries may record:

- provider resource URI;
- state revision;
- state digest;
- materialization digest;
- portal projection action;
- observation mode.

The ledger must not copy secret provider credentials or large private canonical state by default.

---

## 20. First implementation slices

### Slice 0 — architecture and contract freeze

Deliver:

- this architecture document;
- versioned JSON schema drafts;
- negative examples;
- authority matrix;
- no runtime behavior change.

### Slice 1 — read-only provider adapter

Deliver:

- `packages/provider-hdsrc`;
- fake deterministic HDSRC provider fixture;
- capability parsing;
- manifest parsing;
- state/materialization freshness validation;
- no real Python process integration yet.

### Slice 2 — MRMIC portal projection

Deliver:

- create `native_resource_portal_v1` using existing `external/artifact` compatibility profile;
- human preview projection;
- lifecycle mapping;
- stale/suspended behavior;
- portal geometry remains MRMIC-owned.

### Slice 3 — NVCL read-only observation

Deliver:

- human preview observation;
- trusted structured manifest observation;
- explicit machine-resource handle for trusted runtime clients;
- no widening of pixel-only Provider input.

### Slice 4 — real local HDSRC process bridge

Deliver:

- explicitly versioned transport;
- real v0.10 HPCM2 materialization decision;
- fast-path and oracle-fallback evidence;
- cross-process freshness and integrity negative controls.

### Slice 5 — mutation design only

Deliver a separate proposal for canonical HDSRC mutation. No mutation implementation is implied by successful completion of Slices 0–4.

---

## 21. Acceptance criteria for the first executable integration

The first executable integration is accepted only when all of the following are demonstrated offline:

1. MRMIC obtains HDSRC provider capabilities without importing HDSRC runtime source.
2. A known HDSRC state is represented by a valid existing `resource_portal`.
3. The portal uses `provider=external` and `resourceKind=artifact` in the compatibility phase.
4. Portal geometry changes do not alter the HDSRC state digest.
5. Updating the HDSRC state invalidates or refreshes the old materialization without corrupting Canvas geometry.
6. Human preview and machine carrier have distinct resource identities.
7. NVCL pixel observation can consume the approved preview without receiving hidden HDSRC state metadata.
8. A trusted structured client can inspect the materialization manifest.
9. A trusted machine client can obtain an authorized carrier or partial carrier resource.
10. HPCM2 `requiresOracle=true` is preserved as a defer/fallback decision.
11. Provider unavailability maps to a suspended or explicitly stale portal, not silent reuse as current truth.
12. Invalid digests, invalid revisions and malformed manifests fail closed.
13. Secure principal context is not persisted as a credential in Canvas state.
14. Existing Phase 13 Canvas/MCP/security tests remain green.
15. No Canvas operation directly mutates HDSRC canonical state.

---

## 22. Explicit non-goals

This architecture does not claim:

- HDSRC is the new CanvasStore;
- MRMIC is the new HDSRC canonical runtime;
- machine-image projection replaces human rendering;
- every NVCL Provider can directly parse HDSRC carriers;
- HPCM2 confidence is a formal statistical guarantee;
- all HDSRC carrier profiles must be displayed by MRMIC;
- a portal owns external resources;
- provider authorization is inherited automatically from MRMIC authentication;
- image editing can already mutate HDSRC symbolic state;
- the integration is production-security certified.

---

## 23. Architectural consequence

MRMIC/NVCL originally provides the persistent world and visual construction loop:

$$
\mathcal{W}_t
\xrightarrow{observe}
O_t
\xrightarrow{decide}
A_t
\xrightarrow{verify}
\mathcal{W}_{t+1}.
$$

HDSRC adds an adaptive state-materialization layer before observation:

$$
(S_t,W_t)
\xrightarrow{predict}
(\pi_t^*,b_t^*,C_t^*)
\xrightarrow{materialize}
M_t
\xrightarrow{project}
O_t.
$$

The combined read-only architecture is therefore:

$$
\boxed{
(S_t,W_t)
\rightarrow
\text{Adaptive HDSRC Materialization}
\rightarrow
\text{MRMIC Persistent Visual World}
\rightarrow
\text{NVCL Observation / Verification Loop}
}
$$

This is the intended boundary for v0.1.

The next step after architecture approval is to write the implementation plan for Slices 0–3, beginning with versioned JSON contracts and a deterministic fake HDSRC provider. Real cross-process HDSRC v0.10 integration should occur only after those contracts pass review and negative-control tests.

# Phase 13 — Canvas-First PMW Visual World

Date: 2026-08-15  
Status: current-main convergence release candidate

Baseline: `main@da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9`

Historical port source: `07da8848314d5e0ca50e3e956c6b7af1883d0d83`

## Goal

Promote MRMIC from a multimodal canvas laboratory into the first native Visual World provider for the EveMissLab PMW Fabric.

The Phase 13 architectural relation is:

$$
\boxed{
\text{PMW Logical Workspace}
\rightarrow
\text{MRMIC Visual World}
\rightarrow
\text{Resource Portals}
}
$$

A portal is a visual projection of an external resource. It is not the external resource itself:

$$
\pi_C(r) \neq r.
$$

Canvas owns portal geometry and visual projection state. Tandem, Herdr, AI Board, GitHub and other providers retain authority over their native state.

## Delivered in the first Phase 13 slice

### 1. Native `resource_portal`

`packages/canvas-schema` now includes:

- `resource_portal` as a first-class `CanvasObjectType`;
- provider-neutral resource kinds;
- display and interaction modes;
- a validated `ResourcePortalDescriptor` stored under `metadata.portal`;
- `resourcePortalDescriptor()` for fail-closed extraction.

A portal must identify at minimum:

- `portalId`;
- `pmwWorkspaceId`;
- `provider`;
- `resourceKind`;
- `providerResourceId`;
- `displayMode`;
- `interactionMode`.

### 2. Multimodal-visible portal rendering

`packages/adapter-svg` renders resource portals as explicit provider/resource cards. The SVG includes `data-resource-provider` and `data-resource-kind`, so a portal remains visible in both human UI projections and immutable multimodal frame rendering.

Optional `content.previewUri` can provide a snapshot image while the provider resource remains canonical elsewhere.

### 3. Projection view model

`packages/resource-portal` adds an in-memory projection registry with lifecycle:

```text
bound
projected_snapshot
projected_live
suspended
closed
```

The registry deliberately does not copy or own browser/runtime/semantic provider state.

### 4. Authenticated multi-agent presence substrate

`packages/identity-auth` adds opaque bearer-token-to-principal bindings.

Tokens are hashed in memory; broadcast presence never contains the token.

A verified principal can carry:

- provider principal ID;
- role (`viewer`, `agent-direct`, `owner`);
- provider actor identity;
- PMW `semanticAgentId`.

The environment hook is `MRMIC_PMW_BINDINGS_JSON`.

Example shape:

```json
[
  {
    "token": "replace-with-a-long-random-binding-token",
    "principalId": "principal:claude-local",
    "role": "agent-direct",
    "actorType": "agent",
    "actorId": "mrmic:claude-binding",
    "semanticAgentId": "agent:claude-main"
  }
]
```

Do not commit real tokens.

### 5. WebSocket identity binding

When PMW bindings are configured, synchronized WebSocket mutation requires an authenticated principal. The transaction actor is overwritten from the verified principal rather than trusted from client payload.

Presence behaves similarly:

$$
\text{binding token}
\rightarrow
\text{verified principal}
\rightarrow
\text{semantic agent presence}.
$$

An unverified browser UI may still use local human presence for compatibility, but it is normalized to `ui:<clientId>` and marked `identityStatus: local_ui`.

An unauthenticated peer may not claim `actorType: agent` or `actorType: system`.

State replacement in secure mode requires `owner` role.

## Current-main convergence additions

The convergence pass adds:

1. one versioned capability document through HTTP and MCP;
2. `compat_frame_v0` to `native_resource_portal_v1` migration;
3. the same `IdentityResolver` across HTTP transaction/sync, WebSocket and MCP mutation;
4. provider-neutral secure Canvas and runtime-presence JSON schemas/examples;
5. stale revision/sequence rejection for ephemeral runtime truth;
6. explicit mounted/visible/focused/controlOwner live-host state and revocable control.

In secure mode, every application mutation ingress currently exposed by the server is principal-bound. In `legacy_local` compatibility mode no such identity claim is made; capability negotiation advertises both modes explicitly.

This remains an application security boundary, not an OAuth implementation or independent production security certification.

## Acceptance checks

Phase 13 tests cover:

1. valid native portal creation;
2. invalid portal metadata rejection;
3. portal identity surviving SVG rendering;
4. verified bearer principal resolution;
5. forged actor payload overridden by verified principal;
6. unauthenticated agent/system presence rejection;
7. local UI identity sanitization;
8. portal projection lifecycle;
9. semantic identity persistence inside ephemeral presence state;
10. removal of presence without durable-state mutation;
11. capability parity over HTTP and MCP;
12. HTTP and MCP bearer enforcement plus cross-principal session rejection;
13. stale runtime revision/sequence fail-closed behavior;
14. compat portal migration and malformed-input rejection;
15. live host focus/control acquisition, release, revocation, offscreen and LRU eviction.

## Next slice

After the single current-main PR passes CI:

1. implement the external Python PMW adapter against the public JSON schemas;
2. connect a concrete HTML/Electron host without placing WebView state in canonical SVG;
3. add OAuth/rate-limit/multi-tenant layers if deployment expands beyond trusted local use;
4. run an explicitly authorized cross-process PMW shared-Canvas E2E;
5. keep real Provider A/B as a separate opt-in experiment rather than a release prerequisite.

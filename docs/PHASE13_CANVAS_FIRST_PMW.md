# Phase 13 — Canvas-First PMW Visual World

Date: 2026-08-15  
Status: implementation branch  
Baseline: `main@6606b54532c0f327206e7c021120370044b6e0ff`

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

## Explicit boundary

This slice secures the state-vector WebSocket identity boundary and establishes the provider-neutral identity package. The legacy Phase 12 HTTP/MCP mutation surfaces still require a follow-on binding pass before the entire application can claim provider-wide authenticated mutation identity.

Therefore this branch does **not** claim:

$$
\text{all MRMIC mutation paths are authenticated}.
$$

It claims the narrower result:

$$
\text{native portal schema + authenticated shared visual presence + secure sync actor binding}.
$$

The HTTP/MCP identity pass should reuse `packages/identity-auth` rather than inventing another identity vocabulary.

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
10. removal of presence without durable-state mutation.

## Next slice

After this slice passes repository CI:

1. bind HTTP/MCP mutations through the same identity resolver;
2. add a stable provider portal listing API;
3. add the HTML/Electron live-overlay host contract;
4. connect the first Tandem tab as a live/snapshot resource portal;
5. run Neo + Claude + Codex shared-Canvas E2E.

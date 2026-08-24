# Phase 13 PMW Integration Coverage Matrix

Date: 2026-08-24

Release candidate: `MRMIC／NVCL v0.14.0`

Current-main baseline: `da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9`

This matrix answers the PMW Fabric minimum integration request. “Met” means implemented and locally replayed in this repository. It does not turn external PMW/provider behavior into a proven fact.

| Requirement | Status | Implementation | Verification |
|---|---|---|---|
| 1. Converge historical Phase 13 onto current main | Met | `docs/PHASE13_CONVERGENCE_PROVENANCE.md`; audited path-level port from `07da8848314d5e0ca50e3e956c6b7af1883d0d83`; current canonical theory/index preserved | `tests/workspace-layout.test.mjs`; full 174-test suite |
| 2. Versioned capability negotiation | Met | `packages/capability-contract`; HTTP `GET /api/capabilities`; MCP `mrmic://capabilities`; `contracts/phase13/mrmic-capabilities-v1.schema.json` | `tests/phase13-capability-contract.test.mjs` |
| 3. Native `resource_portal` v1 and migration | Met | `packages/resource-portal`; `contracts/phase13/native-resource-portal-v1.schema.json`; compat/native fixtures; `docs/PHASE13_PORTAL_MIGRATION.md` | `tests/resource-portal.test.mjs`; `tests/phase13-portal-migration.test.mjs`; invalid and identity-owning legacy frames rejected |
| 4. Identity verification on every mutation surface | Met in secure mode | One `IdentityResolver` feeds HTTP transaction/sync, WebSocket and `AuthenticatedMcpGateway`; server overwrites claimed actor; viewer/agent-direct/owner permissions are mechanical | `tests/phase13-http-auth-integration.test.mjs`; `tests/phase13-mcp-auth-integration.test.mjs`; `tests/websocket-auth.test.mjs`; `tests/mcp-auth-gateway.test.mjs` |
| 5. Provider-neutral PMW secure client contract | Met | `contracts/phase13/secure-canvas-messages-v1.schema.json`; hello/ack/presence/error examples; `packages/secure-canvas-client` | `tests/phase13-pmw-json-contract.test.mjs`; `tests/secure-client.test.mjs`; token absence control |
| 6. Ephemeral runtime presence | Met | `packages/runtime-presence`; `ephemeral_runtime_presence_v1`; identity comes only from authenticated channel; no persistence API | `tests/runtime-presence.test.mjs`; `tests/runtime-presence-e2e.test.mjs`; stale revision/sequence and forged identity controls |
| 7. Live portal host contract | Met at contract/runtime level | `packages/portal-overlay`; `live_portal_host_v1`; mounted/visible/focused/controlOwner separation; explicit activation/revocation and LRU budget | `tests/portal-runtime.test.mjs`; `tests/phase13-live-portal-host-contract.test.mjs`; offscreen and eviction controls |
| 8. Acceptance, release evidence and one canonical PR | Local met; GitHub pending | v0.14 workspace versions; this matrix; generated release manifest; one current-main branch | `npm run check`; 174/174 tests; Phase 12 offline demo; secret scan; GitHub CI to be recorded after PR |

## Required negative controls

| Control | Evidence | Result |
|---|---|---|
| Invalid native portal | `tests/resource-portal.test.mjs` | Rejected before canonical creation |
| Forged actor / semantic identity | HTTP, WebSocket, runtime-presence and secure-client tests | Overwritten from verified principal or rejected |
| Unauthenticated agent/system presence | `tests/websocket-auth.test.mjs` | Rejected |
| Cross-principal MCP session | `tests/phase13-mcp-auth-integration.test.mjs` | HTTP 403, original owner session remains usable |
| Stale runtime revision/sequence | `tests/runtime-presence.test.mjs` | Fail closed within one epoch |
| Duplicate idempotency | `tests/core.test.mjs` | No duplicate mutation |

## Stable machine contracts

- Capability: `contracts/phase13/mrmic-capabilities-v1.schema.json`
- Portal: `contracts/phase13/native-resource-portal-v1.schema.json`
- Secure Canvas messages: `contracts/phase13/secure-canvas-messages-v1.schema.json`
- Runtime presence: `contracts/phase13/ephemeral-runtime-presence-v1.schema.json`
- Live host state: `contracts/phase13/live-portal-host-v1.schema.json`
- Migration input/output: `contracts/phase13/fixtures/compat-frame-v0.json` and `native-resource-portal-v1.json`

## Not proven

- External Python PMW adapter end-to-end interoperability.
- Production Electron/WebView live portal host behavior or provider lifecycle integration.
- MCP `2026-07-28` stateless or formal conformance; advertised profile remains stateful `2025-11-25` subset.
- New Phase 13 real Provider A/B; no paid Provider was called during this convergence.
- Uncontrolled game, desktop, audio or video generalization.
- Independent production security review, OAuth, rate limiting or multi-tenant isolation.

# ADR-014 — Authenticated Observer Re-entry Protocol

Status: accepted for Phase 15.2.

## Context

Phase 15.1 made observer-relative workspace state durable, but durability alone does not let a new conversation or AI process safely re-enter that state. A protocol surface is required that can recover the authenticated principal, expose only that principal's visible workspace state, and apply explicit observer commands without exposing the private raw event stream.

The existing Canvas MCP server has a broad visual/runtime responsibility. Adding observer identity and private-view semantics directly into that large server would unnecessarily couple two authorities.

## Decision

Phase 15.2 introduces a separate composable `ObserverProtocolGateway` and reference server.

The authenticated HTTP surface is:

- `GET /api/observer/snapshot`
- `POST /api/observer/command`

The authenticated MCP surface is:

- path: `/mcp/observer`
- self resource: `mrmic://observer/self`
- rendezvous template: `mrmic://observer/rendezvous/{rendezvousId}`
- tools: `observer.get_snapshot`, `observer.command`

Every HTTP and MCP request resolves a bearer principal. MCP sessions are additionally pinned to the principal that initialized them. Cross-principal session reuse fails closed.

The protocol never accepts caller-supplied principal identity as command authority. `ObserverProtocolGateway` passes the resolved `AuthenticatedPrincipal` to the durable observer registry, which remains the authorization and transition authority.

## Deployment boundary

The reference implementation runs as `npm run observer` on `127.0.0.1:4180` by default. It requires `MRMIC_PMW_BINDINGS_JSON`; there is no anonymous compatibility mode for observer re-entry.

`MRMIC_OBSERVER_DATABASE_PATH` may point at the same persistent SQLite file used by other MRMIC durable authorities. The observer stream remains a separate table and does not become a Canvas event.

## Privacy boundary

The protocol exposes principal-filtered snapshots and member-visible rendezvous state. It does not expose `observer_workspace_events` as a public resource.

Bearer tokens are resolved at ingress and are never written to observer events, Canvas objects, protocol resources or durable snapshots.

## Consequences

A fresh conversation/process can authenticate, read `mrmic://observer/self`, recover its private view/rendezvous state, and continue through explicit commands without sharing the human's screen or inheriting another AI's private view.

The main Canvas MCP server remains independently evolvable. A future unified front door can route both MCP paths without merging their internal authority models.

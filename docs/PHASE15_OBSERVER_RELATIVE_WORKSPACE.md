# Phase 15 - Observer-Relative Workspace

Status: 15.2 authenticated durable re-entry baseline.

Phase 15 adds an observer-relative coordination layer above the existing Canvas, identity, resource portal, recursive Canvas, runtime-presence and durable-event authorities.

The phase does not replace Windows, provider runtimes, or existing portal ownership. It defines how authenticated human and AI principals can keep private views of one shared world, selectively converge on a shared rendezvous Canvas, recover that coordination state across process/conversation boundaries, and safely re-enter it through authenticated HTTP/MCP surfaces.

## Delivered in 15.0

- `observer_view_v1`: private-by-default observer view state.
- Independent foreground portal stacks and view lifecycle (`live`, `warm`, `frozen`, `sleeping`).
- `shared_rendezvous_v1`: explicit invite/join membership.
- `shared_resource_projection_v1`: selective projection of an existing portal into a shared room without moving or transferring the source resource.
- Fail-closed authorization for private views and rendezvous membership.
- Identity binding from `AuthenticatedPrincipal`; input contracts do not accept caller-supplied principal or semantic-agent identity.
- JSON Schemas for observer views and shared rendezvous rooms.

## Delivered in 15.1

- `observer_workspace_event_v1`: append-only durable transition contract for observer views and rendezvous rooms.
- `SqliteObserverWorkspaceEventStore`: sibling observer event stream in the same SQLite durable database authority used by MRMIC, without coercing observer transitions into `CanvasEvent`.
- `DurableObserverWorkspaceRegistry`: deterministic recovery wrapper around the existing authorization/transition registry.
- SHA-256 binding of persisted principal, replay command and resulting aggregate state.
- Recovery fail-closed checks for payload tampering, duplicate event IDs, non-contiguous revisions, command/event mismatch and replay divergence.
- Durable-append failure rollback and restart/idempotency validation.
- Explicit separation between durable observer-world intention and ephemeral provider/runtime presence.
- ADR-013 records the durability, privacy and authority boundary.

## Delivered in 15.2

- `ObserverProtocolGateway`: authenticated HTTP and MCP re-entry surface over the durable observer authority.
- HTTP: `GET /api/observer/snapshot` and `POST /api/observer/command`.
- MCP: `/mcp/observer`, resource `mrmic://observer/self`, member-visible rendezvous template, tools `observer.get_snapshot` and `observer.command`.
- Every request resolves a bearer principal; MCP sessions are pinned to the initializing principal and cross-principal reuse fails closed.
- `observer-protocol-command-v1` formalizes the external command envelope without accepting caller-owned identity.
- Standalone reference server `npm run observer`, secure-by-default: `MRMIC_PMW_BINDINGS_JSON` is mandatory.
- `MRMIC_OBSERVER_DATABASE_PATH` allows the reference server to open the same persistent SQLite authority used by the observer event stream.
- Capability discovery advertises the observer schemas, durability, auth requirement, HTTP paths, MCP path/resources/tools and reference-server port.
- Network E2E closes the loop: authenticated HTTP creates/reads a view, then a fresh MCP session reads the same principal-filtered durable world.
- ADR-014 records protocol, privacy and deployment boundaries.

## Explicit non-goals through 15.2

- Windows Graphics Capture, UI Automation, virtual desktops, remote sessions, or GPU transport.
- Treating recovered `live` lifecycle intent as proof that a provider process is alive.
- A new resource ownership system.
- Bypassing Phase 13 `controlOwner`, provider authorization, or secure-mode principal checks.
- Public unauthenticated access to raw private observer event history.
- Claiming HDUS integration as complete.
- Forcing the main Canvas MCP server and observer MCP authority into one internal server implementation.

## Next implementation slices

1. Add nested observer subcanvas projection and visibility inheritance.
2. Add provider adapters for Windows application capture and structured control.
3. Add lifecycle scheduling so inactive AI views can become warm/frozen/sleeping without destroying provider resources.
4. Add a unified routing/front-door option after the independent authorities are stable.
5. Add HDUS bridge contracts only after MRMIC semantics are stable.

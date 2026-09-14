# Phase 15 - Observer-Relative Workspace

Status: 15.1 durable observer-world baseline.

Phase 15 adds an observer-relative coordination layer above the existing Canvas, identity, resource portal, recursive Canvas, runtime-presence and durable-event authorities.

The phase does not replace Windows, provider runtimes, or existing portal ownership. It defines how authenticated human and AI principals can keep private views of one shared world, selectively converge on a shared rendezvous Canvas, and recover that coordination state across process/conversation boundaries.

## Delivered in 15.0

- `observer_view_v1`: private-by-default observer view state.
- Independent foreground portal stacks and view lifecycle (`live`, `warm`, `frozen`, `sleeping`).
- `shared_rendezvous_v1`: explicit invite/join membership.
- `shared_resource_projection_v1`: selective projection of an existing portal into a shared room without moving or transferring the source resource.
- Fail-closed authorization for private views and rendezvous membership.
- Identity binding from `AuthenticatedPrincipal`; input contracts do not accept caller-supplied principal or semantic-agent identity.
- JSON Schemas for observer views and shared rendezvous rooms.
- Tests for privacy, invitation, selective convergence, viewer restrictions, ownership and room closure.

## Delivered in 15.1

- `observer_workspace_event_v1`: append-only durable transition contract for observer views and rendezvous rooms.
- `SqliteObserverWorkspaceEventStore`: sibling observer event stream in the same SQLite durable database authority used by MRMIC, without coercing observer transitions into `CanvasEvent`.
- `DurableObserverWorkspaceRegistry`: deterministic recovery wrapper around the existing authorization/transition registry.
- SHA-256 binding of persisted principal, replay command and resulting aggregate state.
- Recovery fail-closed checks for payload tampering, duplicate event IDs, non-contiguous revisions, command/event mismatch and replay divergence.
- Durable-append failure rollback: memory is rebuilt from persisted history before the error is surfaced.
- Restart tests proving private view state, lifecycle, rendezvous membership and selective projections survive reconstruction.
- Idempotency tests proving repeated invite/join/close operations do not create duplicate durable revisions.
- Explicit separation between durable observer-world intention and ephemeral provider/runtime presence.
- ADR-013 records the durability, privacy and authority boundary.

## Explicit non-goals through 15.1

- Windows Graphics Capture, UI Automation, virtual desktops, remote sessions, or GPU transport.
- Treating recovered `live` lifecycle intent as proof that a provider process is alive.
- A new resource ownership system.
- Bypassing Phase 13 `controlOwner`, provider authorization, or secure-mode principal checks.
- Public unauthenticated access to raw private observer event history.
- Claiming HDUS integration as complete.

## Next implementation slices

1. Expose observer projection through capability discovery and authenticated MCP/HTTP contracts.
2. Add nested observer subcanvas projection and visibility inheritance.
3. Add provider adapters for Windows application capture and structured control.
4. Add lifecycle scheduling so inactive AI views can become warm/frozen/sleeping without destroying provider resources.
5. Add HDUS bridge contracts only after MRMIC semantics are stable.

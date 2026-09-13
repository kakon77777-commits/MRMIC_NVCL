# Phase 15 - Observer-Relative Workspace

Status: initial contract and runtime slice.

Phase 15 adds an observer-relative coordination layer above the existing Canvas, identity, resource portal, recursive Canvas, and runtime-presence authorities.

The phase does not replace Windows, provider runtimes, or existing portal ownership. It defines how authenticated human and AI principals can keep private views of one shared world and selectively converge on a shared rendezvous Canvas.

## Delivered in 15.0

- `observer_view_v1`: private-by-default observer view state.
- Independent foreground portal stacks and view lifecycle (`live`, `warm`, `frozen`, `sleeping`).
- `shared_rendezvous_v1`: explicit invite/join membership.
- `shared_resource_projection_v1`: selective projection of an existing portal into a shared room without moving or transferring the source resource.
- Fail-closed authorization for private views and rendezvous membership.
- Identity binding from `AuthenticatedPrincipal`; input contracts do not accept caller-supplied principal or semantic-agent identity.
- JSON Schemas for observer views and shared rendezvous rooms.
- Tests for privacy, invitation, selective convergence, viewer restrictions, ownership and room closure.

## Explicit non-goals for 15.0

- Windows Graphics Capture, UI Automation, virtual desktops, remote sessions, or GPU transport.
- Cross-process persistence or event-sourced recovery of observer state.
- A new resource ownership system.
- Bypassing Phase 13 `controlOwner`, provider authorization, or secure-mode principal checks.
- Claiming HDUS integration as complete.

## Next implementation slices

1. Persist/recover observer and rendezvous state through the existing Canvas/event authority.
2. Expose observer projection through capability discovery and MCP/HTTP contracts.
3. Add nested observer subcanvas projection and visibility inheritance.
4. Add provider adapters for Windows application capture and structured control.
5. Add lifecycle scheduling so inactive AI views can become warm/frozen/sleeping without destroying provider resources.
6. Add HDUS bridge contracts only after MRMIC semantics are stable.

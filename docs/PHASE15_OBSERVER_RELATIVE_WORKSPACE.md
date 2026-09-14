# Phase 15 - Observer-Relative Workspace

Status: 15.6 HWND-bound Windows Graphics Capture session baseline.

Phase 15 adds an observer-relative coordination layer above the existing Canvas, identity, resource portal, recursive Canvas, runtime-presence and durable-event authorities.

The phase does not replace Windows, provider runtimes, or existing portal ownership. It defines how authenticated human and AI principals can keep private views of one shared world, selectively converge on a shared rendezvous Canvas, recover that coordination state across process/conversation boundaries, safely re-enter it through authenticated HTTP/MCP surfaces, navigate existing recursive Canvas topology without creating a second competing world tree, and project Windows desktop windows as provider-owned resources without making the OS desktop the world authority.

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

## Delivered in 15.3

- `observer_nested_canvas_v1`: optional nested context stack inside an existing private observer view.
- Nested contexts reference existing Canvas topology by `parentCanvasId + childCanvasId + portalObjectId`; they do not create a second topology.
- `CanvasAuthorityTopologyResolver` validates both directions of the existing recursive Canvas relation: the child document must point to the parent/portal and the parent `subcanvas` object must point to the child.
- Nested navigation fails closed when topology authority is absent, mismatched, skipped or cyclic.
- Each nested context has an independent `foregroundPortalIds` stack while the root view keeps its existing foreground stack.
- Visibility is intentionally restrictive: nested contexts support only `inherit` and `hidden`; effective visibility is monotonic downward, so a hidden ancestor cannot be bypassed by a descendant.
- Maximum observer nesting depth is 64.
- Durable events add enter/leave, nested visibility and nested foreground transitions; deterministic replay requires the same topology authority for histories containing nested navigation.
- Observer MCP adds `observer.get_canvas_contexts` and `mrmic://observer/view/{viewId}/contexts` for principal-filtered resolved context/visibility reads.
- The standalone observer reference server accepts an injected topology resolver for integration tests and future unified runtime composition. With no resolver it remains root-only for nested navigation.
- Capability discovery advertises nested context schema, visibility modes, maximum depth and `topologyAuthorityRequired=true`.
- ADR-015 records the single-topology and visibility-inheritance boundary.

## Delivered in 15.4

- Canvas resource schema adds first-class `provider=windows` and `resourceKind=desktop_window`.
- `@mrmic/provider-windows` defines the replaceable Windows-native bridge boundary and the provider-side window catalog.
- `windows_provider_capabilities_v1` formalizes Windows Graphics Capture/UI Automation capability discovery.
- `windows_window_resource_v1` formalizes provider-owned native window resources.
- Provider resource identity is bound to `providerEpoch + processId + hwndHex`; HWND alone is explicitly not treated as durable identity.
- Default discovery filters invisible, DWM-cloaked and untitled top-level windows before they become MRMIC resources.
- `createWindowsWindowPortal` projects a provider-owned native window into the existing `resource_portal` contract while keeping dynamic HWND/UIA state out of canonical Canvas metadata.
- `WindowsLivePortalHost` plugs into the existing Phase 13 `LivePortalHostRegistry` / `CanvasLivePortalCoordinator` rather than creating another projection runtime.
- `WindowsProviderAccess` keeps inspection and mutation authority separate through `canInspect` / `canControl`; the provider does not invent a second `controlOwner`.
- Semantic UI operations are bounded to UIA-style invoke/toggle/select/set-value actions in this baseline contract.
- ADR-016 records Windows resource identity, capture, UIA and control-authority boundaries.

## Delivered in 15.5

- Adds the executable .NET 8 reference project at `native/windows-bridge-csharp/`.
- Adds `mrmic-windows-native-bridge/v1` JSONL process protocol and formal `windows-native-bridge-v1` schema.
- Native discovery implements top-level `EnumWindows`, visibility, DWM cloaking state, minimized state, PID/TID, title, class and normalized HWND facts.
- Adds a TypeScript JSONL bridge client with request correlation, timeout, malformed-output and unexpected-exit fail-closed behavior.
- Native discovery facts continue to flow through the existing Windows provider catalog; the helper does not own Canvas, observer state or `controlOwner`.
- Capability discovery advertises `referenceImplementation=true` together with the bounded implemented scope.
- Capture/UIA native commands failed explicitly rather than fabricating fallback success in this slice.
- ADR-017 records the native process, scope and authority boundaries.

## Delivered in 15.6

- Adds a real HWND-bound Windows Graphics Capture session manager to the reference native helper.
- `capture.mount` validates `providerEpoch + providerResourceId + PID + HWND`, verifies the HWND is still live and owned by the expected process, rejects minimized windows, then creates a WGC capture item with `IGraphicsCaptureItemInterop.CreateForWindow(HWND)`.
- The native helper creates a BGRA-capable D3D11 device, projects it into `IDirect3DDevice`, creates a free-threaded `Direct3D11CaptureFramePool`, creates a `GraphicsCaptureSession`, and calls `StartCapture`.
- `FrameArrived` dequeues the next frame, records frame count/time/content size, recreates the frame pool on a content-size change, and releases the frame without synchronous pixel conversion or encoding.
- `capture.update` returns bounded provider-runtime session facts; `capture.unmount` verifies resource identity and disposes the native WGC session.
- Capability discovery separates session lifecycle from full visual transport: `captureSessionImplemented=true`, `frameTransportImplemented=false`, `captureImplemented=false`, `sessionLifecycleSupported=true`, `frameTransport=none`.
- The helper still reports provider-level `capture.supported=false`, because MRMIC does not yet have a reference frame transport into a live/snapshot portal.
- CI now separates the portable Node/TypeScript test job from a Windows-native job. The native project compiles against a current Windows SDK while declaring Windows 10 build 18362 as its minimum supported OS platform.
- Windows-native CI launches the built helper and sends real `capabilities` and `window.enumerate` JSONL requests, closing the Phase 15.5 native-process discovery smoke gap.
- ADR-018 records the WGC session lifecycle / frame transport boundary.

## Explicit non-goals through 15.6

- Claiming a completed WGC pixel/frame transport or live Canvas rendering path. A native session is not the same thing as transported pixels.
- Claiming real interactive WGC session E2E before it is validated against an interactive Windows desktop target.
- Performing synchronous GPU readback, `SoftwareBitmap` conversion, PNG encoding or Canvas mutation inside the WGC `FrameArrived` callback.
- UI Automation inspection or UIA semantic mutation in the reference helper.
- UAC/secure-desktop automation, credential extraction, privileged desktop bypass, or unrestricted raw input injection.
- Treating recovered `live` lifecycle intent as proof that a provider process, HWND or WGC session is alive.
- Treating a reused HWND as the same native resource after a provider epoch changes.
- Letting observer state create, rewrite or own canonical Canvas parent/child topology.
- Allowing a child context to broaden visibility beyond a hidden ancestor.
- A new resource ownership system.
- Bypassing Phase 13 `controlOwner`, provider authorization, or secure-mode principal checks.
- Public unauthenticated access to raw private observer event history.
- Claiming HDUS integration as complete.
- Forcing the main Canvas MCP server and observer MCP authority into one internal server implementation.

## Next implementation slices

1. Implement bounded WGC frame transport/readback outside the `FrameArrived` callback and connect it to snapshot/live portal projection.
2. Validate the WGC session and frame transport on an interactive Windows desktop target.
3. Add read-only UI Automation inspection, then semantic UIA actions behind the existing `controlOwner` authority.
4. Validate multi-observer Windows portal isolation end-to-end.
5. Add lifecycle scheduling so inactive AI views can become warm/frozen/sleeping without destroying provider resources unnecessarily.
6. Add a unified routing/front-door option after the independent authorities are stable.
7. Add HDUS bridge contracts only after MRMIC semantics are stable.

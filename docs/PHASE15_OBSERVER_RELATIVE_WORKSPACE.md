# Phase 15 - Observer-Relative Workspace

Status: 15.7 bounded Windows Graphics Capture snapshot transport baseline.

Phase 15 adds an observer-relative coordination layer above the existing Canvas, identity, resource-portal, recursive-Canvas, runtime-presence and durable-event authorities. It does not replace Windows or provider runtimes: Windows remains a resource host, while MRMIC owns spatial projection, authenticated observer views, selective convergence and resource-control boundaries.

The guiding rule remains:

> Shared World != Shared Screen

Authenticated human and AI principals may keep different private views of one canonical world, enter existing recursive Canvas topology, selectively project resources into shared rendezvous spaces, and later re-enter the same durable coordination state from a new process or conversation.

## Delivered in 15.0 - observer-relative shared world

- `observer_view_v1`: private-by-default observer view state.
- Independent foreground portal stacks and view lifecycle (`live`, `warm`, `frozen`, `sleeping`).
- `shared_rendezvous_v1`: explicit invite/join membership.
- `shared_resource_projection_v1`: selective projection without moving or transferring the source resource.
- Identity binding from `AuthenticatedPrincipal`; caller payload cannot own principal or semantic-agent identity.
- Existing provider authorization and `controlOwner` remain authoritative.

## Delivered in 15.1 - durable continuity

- `observer_workspace_event_v1`: append-only durable transition stream.
- SQLite persistence and deterministic recovery across process/conversation restarts.
- SHA-256 binding of persisted principal, replay command and resulting state.
- Fail-closed recovery on tampering, duplicate IDs, revision gaps, command mismatch or replay divergence.
- Durable observer intention remains separate from ephemeral liveness/focus/runtime presence/control.
- ADR-013 records the durability boundary.

## Delivered in 15.2 - authenticated re-entry

- Authenticated HTTP and MCP re-entry through `ObserverProtocolGateway`.
- HTTP snapshot/command surfaces and a separate `/mcp/observer` authority.
- MCP sessions are pinned to the initializing principal.
- Raw observer event history remains private.
- Network E2E proves that state created/read through authenticated HTTP can be read again by a fresh MCP session under the same principal.
- ADR-014 records the protocol/privacy boundary.

## Delivered in 15.3 - topology-authorized nested observer contexts

- `observer_nested_canvas_v1` adds an observer-relative context stack without creating a second world tree.
- `CanvasAuthorityTopologyResolver` verifies child `parentCanvasId/parentObjectId` against the parent `subcanvas.content.childCanvasId` in both directions.
- Missing authority, skipped lineage, forged relations and cycles fail closed.
- Each Canvas depth has its own foreground stack.
- Visibility can only become more restrictive (`inherit | hidden`) down the hierarchy.
- Nested state participates in deterministic durable replay.
- ADR-015 records the single-topology boundary.

## Delivered in 15.4 - Windows desktop-window provider

- First-class Canvas resource type: `provider=windows`, `resourceKind=desktop_window`.
- `@mrmic/provider-windows` defines discovery/catalog, resource projection, live-host and inspect/control boundaries.
- Native resource identity is `providerEpoch + processId + hwndHex`; HWND alone is never durable identity.
- Invisible, DWM-cloaked and untitled top-level windows are filtered from default discovery.
- `WindowsLivePortalHost` reuses the existing `LivePortalHostRegistry` / `CanvasLivePortalCoordinator` instead of creating a second projection runtime.
- `WindowsProviderAccess` keeps inspect and control authority separate and does not invent another control owner.
- ADR-016 records Windows provider/resource authority.

## Delivered in 15.5 - executable native discovery bridge

- .NET 8 helper at `native/windows-bridge-csharp/`.
- JSONL protocol `mrmic-windows-native-bridge/v1`.
- Real Win32/DWM top-level discovery: visibility, minimized state, cloak state, PID/TID, title, class and normalized HWND.
- TypeScript JSONL client correlates requests and fails closed on malformed stdout, timeout or unexpected helper exit.
- Windows-native CI builds and actually launches the helper for discovery smoke requests.
- ADR-017 records the native process boundary.

## Delivered in 15.6 - HWND-bound WGC session lifecycle

- Real `capture.mount`, `capture.update`, `capture.unmount` native lifecycle.
- Mount revalidates provider epoch/resource identity/PID/HWND and rejects stale or reused HWND identity.
- `IGraphicsCaptureItemInterop.CreateForWindow(HWND)` creates the capture item.
- BGRA-capable D3D11 device -> WinRT `IDirect3DDevice` -> free-threaded `Direct3D11CaptureFramePool` -> `GraphicsCaptureSession` -> `StartCapture`.
- `FrameArrived` dequeues WGC frames without synchronous pixel conversion or encoding.
- Frame-pool resize is explicit and bounded.
- Windows CI compiles CsWinRT on Windows rather than pretending Linux is the native target.
- ADR-018 separates capture-session lifecycle from frame transport.

## Delivered in 15.7 - bounded WGC snapshot transport

- `BoundedPngFrameTransport` moves checked-out WGC frames away from `FrameArrived` into a background worker.
- Worker performs `SoftwareBitmap.CreateCopyFromSurfaceAsync`, PNG encoding and SHA-256.
- Per-mount queue capacity is **2**; saturation drops older pending frames.
- Only the latest encoded snapshot is retained.
- Maximum active capture mounts: **4**.
- Maximum snapshot pixels: **8,294,400**.
- Maximum encoded PNG bytes: **16 MiB**.
- Resize waits for transport-owned frames to drain before `FramePool.Recreate`.
- Native protocol adds `capture.snapshot` and `windows_capture_snapshot_v1`.
- TypeScript revalidates mount/resource identity, dimensions, pixel count, Base64 length, decoded byte count, SHA-256, MIME and transport identifier.
- Capability discovery reports `frameTransportImplemented=true` and `frameTransport=png_base64_snapshot_v1` while keeping `captureImplemented=false`.
- Provider-level `capture.supported` remains false until the snapshot bytes are wired into an actual MRMIC portal rendering surface.
- ADR-019 records the latest-only bounded transport and trust boundary.

## Authority model after 15.7

Durable world authority:

- observer views, rendezvous membership, selective projection and nested Canvas context are durable.

Ephemeral provider/runtime authority:

- HWND liveness, WGC sessions, frame queues, encoded snapshots, runtime focus and control remain provider/runtime state.

Canvas stores geometry and bounded provider identity. Windows continues to own the native window. A capture snapshot is visual evidence, not canonical Canvas state and not ownership transfer.

## Explicit non-goals through 15.7

- Claiming completed Windows pixels-to-Canvas portal rendering. Phase 15.7 crosses the native process boundary but does not yet bind snapshots to the Canvas surface.
- Claiming high-FPS streaming, zero-copy cross-process GPU sharing, video recording or archival frame completeness.
- Claiming authoritative interactive WGC E2E from GitHub-hosted Windows runners.
- UI Automation inspection or semantic actions in the reference helper.
- Keyboard/pointer injection, UAC/secure-desktop bypass or credential access.
- Treating recovered observer lifecycle intent as proof that a provider process, HWND or WGC session is alive.
- Treating a reused HWND as the same resource after a provider epoch changes.
- Letting observer state own or rewrite canonical Canvas topology.
- Bypassing provider authorization or the existing `controlOwner` authority.
- Claiming HDUS integration as complete.

## Next implementation slices

1. Phase 15.8: project `png_base64_snapshot_v1` into the existing resource-portal/live-host path under observer-relative visibility.
2. Validate capture + snapshot + portal rendering on an interactive Windows desktop target.
3. Add read-only UI Automation inspection, followed by semantic UIA actions behind existing control authority.
4. Validate multi-observer Windows portal isolation and selective convergence end-to-end.
5. Add warm/frozen/sleeping scheduling for inactive AI workspaces.
6. Consider higher-throughput or zero-copy frame transport only after the correctness path is closed.
7. Add HDUS bridge contracts after MRMIC semantics are stable.

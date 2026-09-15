# Phase 15 - Observer-Relative Workspace

Status: 15.10 interactive Windows user-session E2E validation harness baseline.

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
- ADR-019 records the latest-only bounded transport and trust boundary.

## Delivered in 15.8 - observer-gated Windows portal projection

- `live_portal_visual_frame_v1` defines a provider-neutral ephemeral visual frame bound to `portalObjectId + provider + providerResourceId`.
- `LivePortalHost` gains optional `snapshot(handle)` without changing providers that do not expose visual frames.
- `WindowsSnapshotLivePortalHost` adapts validated `windows_capture_snapshot_v1` into the provider-neutral frame.
- `observerAllowsPortalVisual` gates visual access from a principal-filtered observer snapshot.
- Private view access requires the semantic `portalId` in the active effectively-visible foreground stack; sleeping or hidden contexts do not receive pixels.
- Rendezvous membership alone is insufficient. Pixels become eligible only after an explicit `SharedResourceProjection`.
- `projectPortalForObserver` performs the observer gate before provider snapshot I/O.
- `snapshotPortalVisualFrame` checks canonical `portalObjectId`, provider and provider-resource identity.
- `projectPortalVisualFrame` injects the data URI only into an ephemeral structured clone.
- The canonical resource portal keeps its provider URI and never stores captured pixels or data URIs.
- Semantic `portalId` and canonical `portalObjectId` are explicitly distinct identities.
- Capability discovery fixes `portalProjection=ephemeral_render_copy_v1`, `observerGated=true` and `canonicalPixelsDurable=false`.
- ADR-020 records the provider/observer/Canvas authority split.

## Delivered in 15.9 - lifecycle-aware bounded refresh/compositor loop

- `observer_portal_refresh_policy_v1` makes the reference cadence and cache policy machine-readable.
- `ObserverPortalCompositor` retains only observer-scoped ephemeral render copies and applies LRU eviction.
- Reference cache bound is **4** observer-target/portal entries.
- `live` private view cadence is at most **250 ms** between provider reads.
- `warm` private view cadence is at most **2000 ms**.
- Explicitly projected rendezvous visual cadence is at most **500 ms**.
- `frozen` retains the latest cached frame but performs **zero provider snapshot I/O**.
- `sleeping` performs zero provider snapshot I/O and evicts cached pixels.
- Denied, hidden and non-foreground states do not read provider pixels and clear the relevant cache entry.
- Positive frame-sequence regression fails closed and removes stale pixels.
- Provider/projection failure removes stale pixels rather than silently continuing a stale visual truth.
- `ObserverPortalRefreshLoop` is non-overlapping: it schedules the next tick only after gate/read/projection/callback completion.
- Suspended/denied states use a **1000 ms** policy poll to notice lifecycle or visibility changes without reading provider pixels.
- ADR-021 records lifecycle-aware cadence, cache, monotonicity and non-overlap semantics.

## Delivered in 15.10 - interactive Windows user-session E2E validation harness

- `interactive_windows_e2e_v1` defines compact validation evidence for a caller-executed Windows session.
- `runInteractiveWindowsE2E()` reuses the production native bridge, Windows provider catalog, live portal host, Canvas coordinator, observer workspace and refresh/compositor path.
- `apps/windows-interactive-e2e/` exposes a Windows-only CLI.
- `scripts/windows-interactive-e2e.ps1` builds both the .NET/CsWinRT helper and TypeScript runtime before invoking the production-path CLI.
- Root command: `npm run windows:e2e --`.
- Exactly one real top-level target must be selected by title substring or normalized HWND; ambiguous/missing/minimized targets fail closed.
- `--confirm-interactive` is required before provider access. The repository does not infer user-session authority from hosted CI.
- Successful evidence records provider/resource identity, HWND/PID/title, frame sequence/timestamp, independently recomputed PNG SHA-256, byte length/dimensions, SVG projection proof and lifecycle checks.
- Evidence intentionally excludes Base64 image bytes, data URIs and screenshot payloads.
- The harness verifies `frozen` keeps the last frame with zero provider reads and `sleeping` clears cached pixels with zero provider reads.
- Canonical Canvas must retain the `windows://` provider preview URI; any persisted data URI fails the run.
- Windows hosted CI parses the PowerShell harness and keeps native build/smoke coverage, but `hostedCiAuthoritativeUserDesktop=false` remains machine-readable.
- ADR-022 records the user-session/evidence boundary.

## Authority model after 15.10

Durable world authority:

- observer views, lifecycle intent, rendezvous membership, selective projection and nested Canvas context are durable;
- canonical Canvas stores portal geometry and bounded provider/resource identity.

Ephemeral provider/runtime authority:

- HWND liveness, WGC sessions, native frame queues, encoded snapshots, compositor caches, refresh timers, runtime focus and control remain provider/runtime state;
- observer-authorized render copies may contain pixels but are never persisted as canonical Canvas state.

Visibility and refresh authority:

- the provider proves which resource a frame belongs to;
- the observer snapshot decides which principal/view/room may see the semantic portal;
- the observer lifecycle determines the bounded refresh cadence or suspension;
- the renderer consumes only the resulting ephemeral copy.

Validation authority:

- portable tests prove contracts and fail-closed semantics;
- hosted Windows CI proves native build/helper smoke and harness syntax validity;
- only a caller-executed interactive Windows run may produce `interactive_windows_e2e_v1` user-session evidence;
- even that evidence stores hashes/facts, not captured pixel payload.

Windows continues to own the native window. Visual projection, refresh and validation are neither ownership transfer nor durable world mutation.

## Explicit non-goals through 15.10

- Claiming high-FPS continuous compositor streaming or zero-copy cross-process GPU sharing.
- Claiming that the reference cadence is a guaranteed frame rate; slow work intentionally reduces effective rate because loops do not overlap.
- Treating GitHub-hosted Windows runners as authoritative evidence of a user's interactive desktop.
- UI Automation inspection or semantic actions in the reference helper.
- Keyboard/pointer injection, UAC/secure-desktop bypass or credential access.
- Persisting captured Windows pixels into Canvas, observer durable events, validation evidence or resource metadata.
- Retaining an unbounded visual history or treating the compositor cache as durable evidence.
- Exposing a private observer foreground merely because principals share a rendezvous.
- Treating recovered observer lifecycle intent as proof that a provider process, HWND or WGC session is alive.
- Letting observer state own or rewrite canonical Canvas topology.
- Bypassing provider authorization or the existing `controlOwner` authority.
- Claiming HDUS integration as complete.

## Next implementation slices

1. Collect at least one real `interactive_windows_e2e_v1` artifact on a local interactive Windows host.
2. Validate sustained multi-observer isolation and selective convergence against real Windows windows.
3. Add read-only UI Automation inspection as a separate semantic-observation authority.
4. Add semantic UIA actions only after inspection is stable and behind the existing `controlOwner` authority.
5. Consider higher-throughput or zero-copy visual transport only after interactive correctness evidence is collected.
6. Add HDUS bridge contracts after MRMIC semantics are stable.

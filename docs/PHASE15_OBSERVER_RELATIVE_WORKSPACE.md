# Phase 15 - Observer-Relative Workspace

Status: 15.12 control-owner-gated Windows UI Automation semantic action baseline.

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
- Windows-native CI builds and launches the helper for discovery smoke requests.
- ADR-017 records the native process boundary.

## Delivered in 15.6 - HWND-bound WGC session lifecycle

- Real `capture.mount`, `capture.update`, `capture.unmount` native lifecycle.
- Mount revalidates provider epoch/resource identity/PID/HWND and rejects stale or reused HWND identity.
- `IGraphicsCaptureItemInterop.CreateForWindow(HWND)` creates the capture item.
- BGRA-capable D3D11 device -> WinRT `IDirect3DDevice` -> free-threaded `Direct3D11CaptureFramePool` -> `GraphicsCaptureSession` -> `StartCapture`.
- `FrameArrived` dequeues WGC frames without synchronous pixel conversion or encoding.
- Frame-pool resize is explicit and bounded.
- ADR-018 separates capture-session lifecycle from frame transport.

## Delivered in 15.7 - bounded WGC snapshot transport

- `BoundedPngFrameTransport` moves checked-out WGC frames into a background worker.
- Worker performs `SoftwareBitmap.CreateCopyFromSurfaceAsync`, PNG encoding and SHA-256.
- Per-mount queue capacity is **2** and maximum active capture mounts is **4**.
- Maximum snapshot pixels: **8,294,400**; maximum encoded PNG bytes: **16 MiB**.
- Only the latest encoded snapshot is retained.
- Resize drains transport-owned frames before `FramePool.Recreate`.
- Native protocol adds `capture.snapshot` and `windows_capture_snapshot_v1`.
- TypeScript independently revalidates identity, dimensions, byte count, Base64 length, SHA-256, MIME and transport identifier.
- ADR-019 records the latest-only bounded transport and trust boundary.

## Delivered in 15.8 - observer-gated Windows portal projection

- `live_portal_visual_frame_v1` defines provider-neutral ephemeral visual frames.
- `WindowsSnapshotLivePortalHost` adapts validated Windows snapshots into the live-portal path.
- Private view access requires the semantic `portalId` in the active effectively-visible foreground stack.
- Rendezvous membership alone is insufficient; an explicit `SharedResourceProjection` is required.
- `projectPortalForObserver` checks observer authorization before provider snapshot I/O.
- `snapshotPortalVisualFrame` checks canonical `portalObjectId`, provider and provider-resource identity.
- Pixels are injected only into an ephemeral structured clone; canonical Canvas keeps the provider URI and never stores captured pixels.
- ADR-020 records the provider/observer/Canvas authority split.

## Delivered in 15.9 - lifecycle-aware bounded refresh/compositor loop

- `observer_portal_refresh_policy_v1` makes cadence/cache policy machine-readable.
- `ObserverPortalCompositor` keeps an observer-scoped LRU cache bounded to **4** entries.
- `live`: 250 ms reference cadence; `warm`: 2000 ms; explicitly projected rendezvous: 500 ms.
- `frozen` retains the last cached frame with zero provider snapshot I/O.
- `sleeping` performs zero provider snapshot I/O and evicts cached pixels.
- Denied/hidden/non-foreground states do not read provider pixels.
- Positive frame-sequence regression fails closed and removes stale pixels.
- `ObserverPortalRefreshLoop` is non-overlapping.
- Suspended states use a 1000 ms policy poll without pixel reads.
- ADR-021 records lifecycle-aware refresh semantics.

## Delivered in 15.10 - interactive Windows user-session E2E validation harness

- `interactive_windows_e2e_v1` defines compact caller-executed validation evidence.
- `runInteractiveWindowsE2E()` reuses the production native bridge, catalog, live host, Canvas coordinator, observer workspace and compositor.
- Root command: `npm run windows:e2e --`.
- A single visible/non-minimized target is selected by title substring or normalized HWND.
- Explicit caller confirmation is required before provider access.
- Evidence records identities, frame sequence/timestamp, independently recomputed PNG SHA-256, byte length/dimensions, SVG projection proof and lifecycle checks.
- Evidence excludes Base64 image bytes, data URIs and screenshot payloads.
- Hosted Windows CI validates native build/smoke and PowerShell syntax but is not authoritative user-desktop evidence.
- ADR-022 records the user-session/evidence boundary.

## Delivered in 15.11 - bounded read-only Windows UI Automation inspection

- `windows_uia_snapshot_v1` defines a bounded semantic UI snapshot.
- `WindowsUiaInspector` uses real Windows Desktop UI Automation through `AutomationElement.FromHandle(HWND)` and `TreeWalker.ControlViewWalker`.
- The native helper revalidates provider epoch, PID, HWND liveness and exact provider-resource identity before semantic inspection.
- Reference limits: maximum depth **8**, descendants **512**, supported-pattern names **32** per element.
- Snapshot metadata is limited to runtime topology, bounded `Name`/`AutomationId`/class/control-type fields, process/native HWND, enabled/offscreen/focusable/password flags, bounds and supported pattern names.
- The reference helper does not read `ValuePattern.Current.Value`, `TextPattern.DocumentRange` or password values.
- `parseWindowsUiaSnapshot()` independently validates resource identity, bounds, runtime-id uniqueness, parent topology and whitelisted fields at the TypeScript trust boundary.
- `WindowsUiaReadOnlyAccess.inspect()` checks `canInspect` before provider I/O and exposes no semantic-action method.
- Native `uia.inspect` is implemented.
- Local command: `npm run windows:uia -- -Title "Notepad"` or `npm run windows:uia -- -Hwnd "0x123456"`.
- `windows_uia_snapshot_v1` is ephemeral provider/runtime observation; it is not canonical Canvas state, durable observer state or a control lease.
- ADR-023 records the inspection/control separation and semantic minimization boundary.

## Delivered in 15.12 - semantic UIA actions behind `controlOwner`

- `WindowsUiaControlledAccess` is the reference semantic-control gateway.
- The requested portal must be mounted and visible and its actual `CanvasLivePortalCoordinator.controlOwner` must equal the requesting principal.
- `WindowsAccessAuthority.canControl` is checked before any UIA provider I/O.
- A new `WindowsUiaReadOnlyAccess.inspect()` is executed immediately before every action, preserving the Phase 15.11 `canInspect` gate.
- Reference inspection freshness bound is **2000 ms**.
- The target runtime id must still exist in the fresh bounded UIA tree, remain enabled and advertise the required UIA pattern.
- Supported actions are exactly `invoke`, `toggle`, `select`, and `set_value`.
- Native execution uses `InvokePattern`, `TogglePattern`, `SelectionItemPattern`, or `ValuePattern`; there is no coordinate/raw-input fallback.
- Fresh element facts (`processId`, native HWND, optional `AutomationId`, optional control type) are bound into the native request and revalidated after native runtime-id resolution.
- The native helper revalidates provider epoch, PID, HWND and exact provider-resource identity again before action execution.
- `set_value` is limited to **2048** characters, refuses password elements and returns redacted native value evidence.
- `windows_uia_controlled_action_v1` omits the set-value text entirely and contains only bounded identity/action/timestamp facts.
- Global capability now reports `automationImplemented=true` specifically for these four semantic actions, while `rawInputInjectionImplemented=false` and input-injection fallback remains disabled.
- No standalone action CLI is exposed in Phase 15.12, avoiding a convenience path that could bypass live MRMIC `controlOwner` state.
- ADR-024 records the ownership/freshness/element-binding boundary.

## Authority model after 15.12

Durable world authority:

- observer views, lifecycle intent, rendezvous membership, selective projection and nested Canvas context are durable;
- canonical Canvas stores portal geometry and bounded provider/resource identity.

Ephemeral Windows/provider authority:

- HWND liveness, WGC sessions, native frame queues, encoded snapshots, compositor caches, refresh timers and UIA semantic snapshots remain provider/runtime state;
- visual render copies and UIA trees are observations, not canonical world mutation;
- UIA action execution is a provider-side runtime effect, not a durable rewrite of Canvas truth.

Visibility and observation authority:

- the provider proves which Windows resource a visual or semantic observation belongs to;
- observer state decides visual visibility and refresh eligibility;
- inspect authority is checked before UIA provider access;
- UIA supported-pattern metadata alone does not grant control.

Control authority:

- `controlOwner` remains the single active portal control lease;
- successful semantic action additionally requires `canControl` and `canInspect` policy permission;
- each action is rebound to a fresh UIA observation and revalidated against provider/window/element identity;
- semantic UIA actions do not imply raw keyboard/pointer authority.

Validation authority:

- portable tests prove control-owner/policy/freshness/pattern/password/value-redaction fail-closed semantics;
- hosted Windows CI proves native UIA pattern-action compilation, capability smoke and existing PowerShell harness syntax;
- hosted CI still does not constitute caller-desktop interactive action evidence;
- a later action E2E harness must acquire a real MRMIC control lease rather than call the native helper directly.

Windows continues to own the native window and UI tree.

## Explicit non-goals through 15.12

- High-FPS or zero-copy visual streaming.
- Treating GitHub-hosted runners as authoritative user-desktop evidence.
- Arbitrary UIA pattern execution beyond invoke/toggle/select/set_value.
- `ValuePattern`/`TextPattern` content extraction or password extraction.
- Setting values on password elements.
- Raw keyboard/pointer injection, `SendInput`, coordinate clicking or drag gestures.
- UAC/secure-desktop bypass or credential access.
- Persisting captured Windows pixels, UIA snapshots or set-value payloads into canonical Canvas or durable observer events.
- Retaining an unbounded visual, semantic or action-value history.
- Implicit control acquisition from visibility, foreground state or rendezvous membership.
- Replaying actions against stale UIA snapshots or fuzzy-retargeting disappeared runtime ids.
- Treating recovered observer state as proof that a provider process/HWND/UIA element remains live.
- Letting observer state own/rewrite canonical Canvas topology.
- Bypassing provider authorization or `controlOwner`.
- Claiming HDUS integration as complete.

## Next implementation slices

1. Collect real local `interactive_windows_e2e_v1` and `windows_uia_snapshot_v1` evidence against representative Windows applications.
2. Add an interactive semantic-action E2E harness that constructs a real MRMIC portal, acquires `controlOwner`, performs one bounded action on a dedicated test app, and verifies post-action state through fresh UIA/WGC observation.
3. Validate sustained multi-observer isolation/selective convergence and control handoff against real Windows windows.
4. Keep raw input injection separate and disabled unless a later explicit fallback contract requires it.
5. Consider higher-throughput/zero-copy visual transport only after real interactive evidence is collected.
6. Add HDUS bridge contracts after MRMIC semantics are stable.

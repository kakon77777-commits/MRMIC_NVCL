# ADR-016 — Windows Desktop Windows Are Provider-Owned MRMIC Resources

Status: Accepted for Phase 15.4  
Phase: 15.4

## Context

Phase 15.0–15.3 established observer-relative views, durable re-entry and nested Canvas contexts. The next step toward the multi-observer Windows workspace is to project existing desktop applications into MRMIC without making Windows itself the world model and without forcing human and AI actors to share one OS foreground.

MRMIC already has the required separation:

- Canvas owns durable geometry and projection references;
- providers own native resource state;
- `CanvasLivePortalCoordinator` owns mounted/visible/focused/control-owner coordination;
- observer views own principal-relative foreground and visibility state.

The Windows adapter must fit these authorities instead of introducing another desktop/window authority.

## Decision

### 1. Windows is a first-class provider

Canvas resource portal schema adds:

```text
provider = windows
resourceKind = desktop_window
```

A native top-level window is represented by `windows_window_resource_v1` and projected through the existing `resource_portal` contract.

### 2. HWND is not a durable identity

A Windows provider instance owns a `providerEpoch`. The provider resource identity is derived from:

```text
providerEpoch + processId + hwndHex
```

The current form is:

```text
window:<providerEpoch>:<processId>:<hwndHex>
```

This deliberately makes a provider restart an identity boundary. Windows may reuse HWND values; a durable MRMIC portal must therefore become stale rather than silently bind to an unrelated future window.

### 3. Discovery defaults to ordinary visible top-level windows

The native bridge is expected to enumerate top-level windows through Win32 and report visibility, process/thread identity, title and DWM cloak state. The adapter's default discoverable set excludes:

- invisible windows;
- DWM-cloaked windows;
- untitled windows;
- malformed/invalid HWND or process identities.

Filtering policy can grow later, but hidden/shell implementation windows are not treated as normal user application resources by default.

### 4. Capture uses the Windows Graphics Capture boundary

The preferred live projection contract is:

```text
Windows.Graphics.Capture
  -> IGraphicsCaptureItemInterop::CreateForWindow(HWND)
  -> provider-owned capture surface
  -> MRMIC LivePortalHost
```

The capability contract records Windows build 18362 (Windows 10 version 1903) as the minimum build for the HWND interop capture path.

The TypeScript adapter does not claim that the Windows-only native bridge has already been implemented. Phase 15.4 fixes the bridge contract, provider identity and MRMIC integration surface; the WinRT/D3D implementation is the next native slice.

### 5. Structured control prefers UI Automation

The provider bridge exposes UI Automation as the semantic control path. Phase 15.4 semantic actions are deliberately bounded to UIA-style operations:

- invoke;
- toggle;
- select;
- set value.

OS-level mouse/keyboard input injection is not a default MRMIC control mechanism. A native bridge may advertise an input-injection fallback, but such injection remains explicitly capability-gated and requires an interactive unlocked desktop.

### 6. Inspection and control are separate authorities

`WindowsProviderAccess` receives a higher-layer `WindowsAccessAuthority` with separate decisions for:

```text
canInspect(...)
canControl(...)
```

The Windows provider does not invent or persist a second control owner. `canControl` is expected to bind to the existing MRMIC/PMW authority, including the live portal `controlOwner` state.

UIA inspection can therefore be granted more broadly than mutation while still remaining principal-scoped.

### 7. Dynamic Windows state stays provider-owned

Canvas canonical metadata stores only bounded provider references required for projection:

- Windows resource URI;
- provider epoch;
- live mount URI/kind;
- provider resource identity through the standard portal descriptor.

The Canvas does not copy dynamic HWND liveness, UIA trees, focus, process lifetime, capture frame state or native session state into durable canonical metadata.

## Native bridge boundary

`WindowsNativeBridge` owns platform-specific operations:

```text
capabilities
enumerateTopLevelWindows
mountCapture
updateCapture
unmountCapture
inspectUi
performUiAction
```

The bridge may be implemented out-of-process. Phase 15.4 intentionally keeps it replaceable so a future C++/WinRT, C#, Rust/Windows or other Windows-native helper can satisfy the same MRMIC contract.

## Security boundary

Phase 15.4 does not authorize:

- UAC/secure-desktop automation;
- credential extraction;
- arbitrary raw input injection;
- control without the existing principal/control authority;
- treating a recovered portal as proof that the native window still exists;
- treating a reused HWND as the same resource after a provider epoch changes.

## Consequences

Positive:

- Windows applications become first-class Canvas resources without modifying Windows itself;
- human and AI observer views can later reference different desktop windows without competing for one Canvas foreground;
- the existing live portal coordinator remains the single projection/control coordination layer;
- capture and UI automation backends can evolve independently of MRMIC world semantics;
- stale native window identity fails closed across provider restarts.

Trade-offs:

- Phase 15.4 alone does not render real WinRT capture frames because the Windows-only native bridge is not yet implemented;
- a durable portal may legitimately become stale after provider restart and must be rebound through fresh discovery;
- some applications expose incomplete UIA trees and will eventually require visual or input-injection fallback paths.

## Next slice

Implement and validate a Windows-native bridge on a real Windows host, beginning with:

1. Win32 top-level window discovery and DWM cloak filtering;
2. `GraphicsCaptureItem` creation from HWND and live frame transport;
3. UIA tree inspection and semantic pattern invocation;
4. explicit adapter wiring to observer-visible portals and existing `controlOwner` authority;
5. measured behavior for minimized, occluded, closed and recreated windows.

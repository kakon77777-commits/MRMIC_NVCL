# ADR-018 — Windows Graphics Capture Session Lifecycle Is Separate from Frame Transport

Status: Accepted  
Phase: 15.6

## Context

Phase 15.4 established Windows desktop windows as provider-owned `resource_portal` resources. Phase 15.5 then introduced the executable Windows native bridge and real Win32/DWM discovery, but capture operations still failed closed as unimplemented.

The next useful boundary is not yet a complete live visual transport. It is a real HWND-bound `Windows.Graphics.Capture` session that can prove the selected provider resource is still the same native window, create the Windows capture objects, receive frames and survive size changes without moving pixel ownership into observer state or Canvas state.

Combining WGC session creation, GPU readback, image encoding, portal transport and UI Automation in one slice would erase important failure boundaries and make it difficult to distinguish "Windows is producing frames" from "MRMIC can already transport/render those frames".

## Decision

Phase 15.6 implements the **capture-session lifecycle only**.

The reference native bridge now implements:

```text
capture.mount
capture.update
capture.unmount
```

A mount performs the following bounded native sequence:

```text
providerEpoch + PID + HWND validation
  -> IsWindow / current PID validation
  -> GraphicsCaptureSession.IsSupported
  -> GraphicsCaptureItem via IGraphicsCaptureItemInterop.CreateForWindow(HWND)
  -> D3D11 BGRA device
  -> IDirect3DDevice projection
  -> Direct3D11CaptureFramePool.CreateFreeThreaded
  -> GraphicsCaptureSession
  -> StartCapture
```

The session consumes `FrameArrived` events with `TryGetNextFrame`, records bounded runtime facts, recreates the frame pool when the content size changes, and disposes frames immediately.

## Capability Semantics

Phase 15.6 deliberately distinguishes session lifecycle from complete capture transport.

Global capability discovery therefore records:

```text
nativeBridge.scope = discovery_and_capture_session
nativeBridge.discoveryImplemented = true
nativeBridge.captureSessionImplemented = true
nativeBridge.frameTransportImplemented = false
nativeBridge.captureImplemented = false
nativeBridge.automationImplemented = false

capture.sessionLifecycleSupported = true
capture.frameTransport = none
```

`captureImplemented=false` remains authoritative until MRMIC has a bounded frame transport that can feed a live/snapshot portal surface. A running WGC session alone is not sufficient to advertise completed visual capture.

The provider-level helper similarly reports `capture.supported=false` while exposing `sessionLifecycleSupported=true` and `frameTransport=none`.

## Native Resource Identity

A mount is accepted only when all of the following still agree:

- current provider epoch;
- `providerResourceId`;
- PID;
- HWND;
- current HWND owner PID.

This prevents a reused HWND from silently rebinding a durable Canvas portal to a different native window.

A minimized window is rejected by the Phase 15.6 reference helper. The session baseline does not invent a fallback capture mechanism.

## Frame Callback Boundary

`FrameArrived` is intentionally lightweight.

It may:

- dequeue the next WGC frame;
- increment a frame counter;
- record last-frame time and content size;
- recreate the frame pool after a size change;
- release the frame.

It does **not** synchronously perform GPU readback, `SoftwareBitmap` conversion, PNG encoding, network transport or Canvas mutation.

Pixel conversion/transport belongs to a later bounded worker stage. This keeps the capture callback independent from slower transport/encoding work and makes backpressure policy explicit instead of implicit.

## Session State Is Ephemeral

WGC mount/session state is provider runtime truth, not durable observer truth.

Persisted observer state may remember that a portal is relevant or should be visible, but recovery does not prove that:

- the old HWND still exists;
- the old provider epoch is live;
- a `GraphicsCaptureSession` survived;
- a frame has arrived.

Re-entry must discover/rebind current provider runtime state.

## CI Boundary

The Windows native project now builds on a Windows runner rather than relying on cross-platform compilation of Windows-only CsWinRT tooling.

The project compiles against the Windows 26100 SDK while declaring `SupportedOSPlatformVersion=10.0.18362.0`, preserving the HWND WGC minimum target used by MRMIC.

Windows CI also launches the built helper and performs real protocol smoke requests for:

```text
capabilities
window.enumerate
```

This closes real Windows-host discovery-process evidence. It does not claim that a hosted CI runner provides a reliable interactive target for WGC session E2E.

## Explicit Non-Goals

Phase 15.6 does not implement or claim:

- GPU/CPU frame readback;
- PNG/raw-frame/shared-texture transport;
- completed live Canvas rendering from WGC frames;
- UI Automation inspection or mutation;
- keyboard/pointer injection;
- UAC or secure-desktop bypass;
- credential access;
- durable capture-session resurrection;
- arbitrary hidden/minimized-window fallback capture.

## Consequences

Positive:

- the native Windows layer now owns a real WGC session rather than a placeholder API;
- HWND identity is revalidated at mount time;
- frame arrival and resize behavior are exercised by compile-time native code paths without coupling them to transport;
- future frame transport can be designed as an explicit bounded producer/consumer layer;
- observer/Canvas ownership and `controlOwner` remain unchanged.

Trade-offs:

- a Phase 15.6 live portal still has no reference pixel transport;
- actual WGC runtime E2E should be validated on an interactive Windows desktop before the full capture capability is promoted;
- UIA remains a separate later slice.

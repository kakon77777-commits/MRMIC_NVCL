# MRMIC Windows Native Bridge — Phase 15.8 Snapshot-Backed Portal Integration

This Windows-only helper is the reference native process behind the `WindowsNativeBridge` boundary.

Phase 15.5 established Win32/DWM window discovery. Phase 15.6 added HWND-bound Windows Graphics Capture sessions. Phase 15.7 added bounded PNG snapshot transport. Phase 15.8 keeps the helper provider-owned while the MRMIC TypeScript layer projects those snapshots into observer-authorized ephemeral resource-portal render copies.

## Implemented native surface

Discovery:

- `EnumWindows`
- visibility / minimized / DWM cloak state
- PID / TID / title / class / normalized HWND

WGC lifecycle:

- `capture.mount`
- `capture.update`
- `capture.unmount`
- `GraphicsCaptureItem` from HWND
- BGRA-capable D3D11 + WinRT `IDirect3DDevice`
- free-threaded frame pool + `GraphicsCaptureSession`
- resize-safe frame-pool recreation

Bounded frame transport:

- queue capacity: **2 frames per mount**
- active mount limit: **4**
- snapshot pixel limit: **8,294,400**
- encoded PNG limit: **16 MiB**
- latest encoded snapshot retained per mount
- `capture.snapshot` returns `windows_capture_snapshot_v1`

## Callback / worker boundary

`FrameArrived` does not perform synchronous image readback or PNG encoding. It obtains the WGC frame and transfers ownership to `BoundedPngFrameTransport`.

The background worker performs:

```text
Direct3D11CaptureFrame.Surface
  -> SoftwareBitmap.CreateCopyFromSurfaceAsync
  -> BitmapEncoder(PNG)
  -> SHA-256
  -> latest bounded snapshot
```

If the queue is saturated, older pending frames are disposed and dropped. This transport is for fresh observer evidence, not lossless video recording.

On a WGC content-size change, new frames are temporarily dropped, pending transport frames are drained, and only then is `Direct3D11CaptureFramePool.Recreate` called.

## Phase 15.8 portal boundary

The native helper now reports `capture.supported=true` because the reference MRMIC stack has an actual bounded projection path for its snapshots.

That projection path remains outside the helper:

```text
windows_capture_snapshot_v1
  -> WindowsSnapshotLivePortalHost
  -> live_portal_visual_frame_v1
  -> observer gate
  -> ephemeral Canvas render copy
  -> existing resource_portal SVG/image rendering
```

The helper does **not** know observer identities, private views, rendezvous membership, Canvas object durability or `controlOwner`.

MRMIC performs observer authorization before provider snapshot I/O. The provider visual frame is then checked against canonical `portalObjectId + provider + providerResourceId`. Only an ephemeral clone receives the `data:image/png;base64,...` preview; canonical Canvas state retains the provider URI and stores no pixels.

## Capability boundary

Phase 15.8 native capabilities report:

```text
capture.supported = true
capture.sessionLifecycleSupported = true
capture.frameTransportSupported = true
capture.frameTransport = png_base64_snapshot_v1
capture.maxActiveMounts = 4
capture.frameQueueCapacity = 2
capture.maxSnapshotPixels = 8294400
capture.maxSnapshotBytes = 16777216
automation.supported = false
```

`capture.supported=true` means snapshot-backed resource-portal rendering exists in the reference MRMIC stack. It does not mean high-FPS live streaming, zero-copy compositor integration or UI Automation is complete.

## JSONL protocol

Protocol:

```text
mrmic-windows-native-bridge/v1
```

Implemented methods:

```text
capabilities
window.enumerate
capture.mount
capture.update
capture.snapshot
capture.unmount
```

Still unimplemented and fail-closed:

```text
uia.inspect
uia.action
```

A `capture.snapshot` success returns mount/resource identity, frame sequence, timestamp, dimensions, `image/png`, encoded byte count, SHA-256, Base64 bytes and `png_base64_snapshot_v1` transport metadata.

The TypeScript process client independently verifies those fields and the decoded SHA-256 before accepting the snapshot.

## Windows build/run

PowerShell from the repository root:

```powershell
 dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
 dotnet run --project .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
```

The project compiles against the current Windows SDK while retaining Windows 10 build 18362 as its declared minimum OS platform for the HWND WGC boundary.

## CI evidence

The repository keeps portable Node/TypeScript validation and Windows-native validation separate.

Windows CI builds the CsWinRT helper and launches the resulting process for real `capabilities` and `window.enumerate` JSONL smoke requests. Hosted CI is not treated as authoritative interactive-desktop WGC capture E2E evidence.

Portable tests exercise observer-gated private/shared projection and verify that denied views do not trigger provider snapshot I/O.

## Security and authority boundary

The helper does not:

- inject keyboard or pointer input;
- cross UAC/secure desktop boundaries;
- read credentials;
- own MRMIC observer identity, Canvas topology or `controlOwner`;
- persist HWND/capture identity across provider restart;
- retain an unbounded frame history;
- decide which observer or rendezvous may see a frame;
- persist frame bytes into canonical Canvas state.

Stdout is protocol-only. Diagnostics belong on stderr so malformed stdout remains a fail-closed contract violation.

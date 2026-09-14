# MRMIC Windows Native Bridge — Phase 15.6 WGC Session Baseline

This Windows-only helper is the reference native process behind the `WindowsNativeBridge` boundary.

Phase 15.5 established real Win32/DWM desktop-window discovery. Phase 15.6 adds a real HWND-bound `Windows.Graphics.Capture` **session lifecycle**, while intentionally stopping before pixel/frame transport.

## Implemented discovery

- `EnumWindows`
- `IsWindowVisible`
- `IsIconic`
- `GetWindowTextW`
- `GetClassNameW`
- `GetWindowThreadProcessId`
- `DwmGetWindowAttribute(DWMWA_CLOAKED)`

## Implemented WGC session lifecycle

The helper now implements:

```text
capture.mount
capture.update
capture.unmount
```

A capture mount:

1. validates `providerEpoch + providerResourceId + PID + HWND`;
2. confirms the HWND still exists and still belongs to the expected process;
3. checks `GraphicsCaptureSession.IsSupported()`;
4. creates a `GraphicsCaptureItem` using `IGraphicsCaptureItemInterop.CreateForWindow(HWND)`;
5. creates a BGRA-capable D3D11 device and projects it to `IDirect3DDevice`;
6. creates a free-threaded `Direct3D11CaptureFramePool`;
7. creates and starts a `GraphicsCaptureSession`;
8. dequeues frames with `TryGetNextFrame`, records bounded frame metadata and recreates the frame pool on size changes.

The `FrameArrived` callback deliberately does not perform bitmap conversion, image encoding or Canvas mutation.

## Capability boundary

Phase 15.6 reports the following distinction:

```text
capture.supported = false
capture.sessionLifecycleSupported = true
capture.frameTransport = none
automation.supported = false
```

This means the reference helper can create and maintain real WGC sessions but does **not** yet expose a completed visual frame transport to MRMIC portals.

A session snapshot may contain:

```text
mountId
providerResourceId
hwndHex
started
frameCount
lastFrameAt
contentSize
frameTransport = none
```

## JSONL protocol

The helper speaks newline-delimited JSON on stdin/stdout using:

```text
mrmic-windows-native-bridge/v1
```

Implemented methods:

```text
capabilities
window.enumerate
capture.mount
capture.update
capture.unmount
```

Still unimplemented and fail-closed:

```text
uia.inspect
uia.action
```

## Windows build/run

PowerShell from the repository root:

```powershell
 dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
 dotnet run --project .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
```

The project compiles against a current Windows SDK while retaining `10.0.18362.0` as its declared minimum supported OS platform for the HWND WGC boundary.

The helper is intended to be spawned by `WindowsJsonlNativeBridge`; humans normally do not send JSON manually.

## CI evidence

The repository uses a dedicated Windows CI job for the native helper because CsWinRT generation is Windows-native.

Windows CI:

1. builds the .NET 8 helper with warnings-as-errors;
2. launches the built helper;
3. sends real `capabilities` and `window.enumerate` protocol requests;
4. verifies provider epoch and bounded capture capability semantics.

The hosted runner smoke closes native-process discovery evidence but is not treated as a reliable interactive WGC target. Real WGC session E2E remains a separate Windows-desktop validation step.

## Security boundary

The helper does not:

- inject keyboard or pointer input;
- cross UAC/secure desktop boundaries;
- read credentials;
- own MRMIC observer identity or `controlOwner`;
- persist HWND or capture-session identity across process restart;
- fabricate frame transport when none exists.

Stdout is protocol-only. Diagnostics belong on stderr so the JSONL client can treat malformed stdout as a contract failure.

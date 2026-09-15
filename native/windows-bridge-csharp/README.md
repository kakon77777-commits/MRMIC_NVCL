# MRMIC Windows Native Bridge — Phase 15.11 Read-Only UIA Inspection

This Windows-only helper is the reference native process behind the `WindowsNativeBridge` boundary.

Phase 15.5 established Win32/DWM discovery. Phase 15.6 added HWND-bound Windows Graphics Capture sessions. Phase 15.7 added bounded PNG snapshot transport. Phase 15.8–15.10 connected that visual path to observer-authorized portals, bounded refresh and local user-session validation. Phase 15.11 adds bounded **read-only** Windows UI Automation inspection while keeping semantic actions unimplemented.

## Implemented native surface

Discovery:

- `EnumWindows`
- visibility / minimized / DWM cloak state
- PID / TID / title / class / normalized HWND

WGC lifecycle and transport:

- `capture.mount`
- `capture.update`
- `capture.snapshot`
- `capture.unmount`
- HWND `GraphicsCaptureItem`
- D3D11 + WinRT capture session
- bounded two-frame queue
- maximum four active mounts
- maximum 8,294,400 pixels
- maximum 16 MiB encoded PNG
- latest-only `windows_capture_snapshot_v1`

Read-only UI Automation:

- `uia.inspect`
- `AutomationElement.FromHandle(HWND)`
- `TreeWalker.ControlViewWalker`
- maximum depth **8**
- maximum descendants **512**
- maximum supported-pattern names per element **32**
- `windows_uia_snapshot_v1`

UIA inspection exposes bounded structural metadata such as runtime topology, `Name`, `AutomationId`, class/control type, enabled/offscreen/focusable state, `IsPassword`, bounds and supported pattern names.

It does **not** read `ValuePattern.Current.Value`, `TextPattern.DocumentRange`, password values, or equivalent UI content streams.

## Identity boundary

Both visual and semantic native reads are rooted in a provider-owned Windows resource identity:

```text
providerEpoch + processId + HWND -> providerResourceId
```

Before UIA inspection the helper revalidates provider epoch, HWND liveness, PID and exact resource identity. Stale/reused HWND identity fails closed.

## Read-only authority boundary

Phase 15.11 deliberately separates inspection from control:

```text
uia.inspect -> implemented
uia.action  -> UIA_ACTION_NOT_IMPLEMENTED
```

Native capability reports:

```text
automation.supported = true
automation.inspectionSupported = true
automation.actionSupported = false
automation.maxDepth = 8
automation.maxElements = 512
automation.maxPatternsPerElement = 32
automation.valueTextIncluded = false
automation.inputInjectionFallback = false
```

MRMIC independently validates the returned semantic tree and applies inspect authority before provider I/O. Supported pattern names describe capability only; they do not authorize execution.

`controlOwner` remains outside the helper and is unchanged by Phase 15.11.

## Visual callback / worker boundary

`FrameArrived` still does not perform synchronous image readback or PNG encoding. It transfers the WGC frame to `BoundedPngFrameTransport`, whose background worker performs deep copy, PNG encoding and SHA-256.

The visual path remains:

```text
windows_capture_snapshot_v1
  -> WindowsSnapshotLivePortalHost
  -> observer gate
  -> ephemeral Canvas render copy
```

Canonical Canvas stores no captured pixels.

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
uia.inspect
```

Explicitly unimplemented:

```text
uia.action
```

## Local usage

Build/run the raw helper:

```powershell
 dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
 dotnet run --project .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
```

Use the bounded MRMIC UIA CLI from repository root:

```powershell
npm run windows:uia -- -Title "Notepad"
```

or:

```powershell
npm run windows:uia -- -Hwnd "0x123456"
```

The PowerShell wrapper builds both native and TypeScript layers and writes a bounded `windows_uia_snapshot_v1` artifact.

## CI evidence

Portable CI runs strict TypeScript and the complete Node regression suite.

Windows CI:

- compiles the real `.NET 8 / System.Windows.Automation` reference path;
- launches the native helper for capability/window-enumeration smoke;
- validates UIA inspection capability while asserting actions remain disabled;
- parses the local Windows PowerShell validation harnesses.

Hosted CI is not treated as proof that a particular caller-owned application's UIA tree is useful or complete.

## Security and non-goals

The helper does not:

- execute UIA patterns or semantic actions;
- inject keyboard or pointer input;
- read UI value/text streams;
- read password values;
- cross UAC/secure-desktop boundaries;
- read credentials;
- own observer identity, Canvas topology or `controlOwner`;
- persist UIA snapshots as canonical Canvas truth;
- retain an unbounded visual or semantic history.

Stdout is protocol-only. Diagnostics belong on stderr so malformed stdout remains a fail-closed contract violation.

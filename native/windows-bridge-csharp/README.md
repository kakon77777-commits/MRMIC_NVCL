# MRMIC Windows Native Bridge — Phase 15.12 Controlled Semantic UIA Actions

This Windows-only helper is the reference native process behind the `WindowsNativeBridge` boundary.

Phase 15.5 established Win32/DWM discovery. Phase 15.6 added HWND-bound Windows Graphics Capture sessions. Phase 15.7 added bounded PNG snapshot transport. Phase 15.8–15.10 connected that visual path to observer-authorized portals, bounded refresh and local user-session validation. Phase 15.11 added bounded read-only UI Automation inspection. Phase 15.12 adds a minimal semantic UIA action executor while leaving MRMIC `controlOwner` authorization in the TypeScript runtime.

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

UI Automation inspection:

- `uia.inspect`
- `AutomationElement.FromHandle(HWND)`
- `TreeWalker.ControlViewWalker`
- maximum depth **8**
- maximum descendants **512**
- maximum supported-pattern names per element **32**
- `windows_uia_snapshot_v1`

UIA inspection exposes bounded structural metadata such as runtime topology, `Name`, `AutomationId`, class/control type, enabled/offscreen/focusable state, `IsPassword`, bounds and supported pattern names.

It does **not** read `ValuePattern.Current.Value`, `TextPattern.DocumentRange`, password values, or equivalent UI content streams.

Semantic UI Automation actions:

- `invoke` -> `InvokePattern.Invoke()`
- `toggle` -> `TogglePattern.Toggle()`
- `select` -> `SelectionItemPattern.Select()`
- `set_value` -> `ValuePattern.SetValue()`

The native action executor uses the same bounded depth/element search envelope as inspection. `set_value` is limited to **2048** characters and refuses elements whose current UIA state reports `IsPassword=true`.

## Identity boundary

Visual and semantic native operations are rooted in a provider-owned Windows resource identity:

```text
providerEpoch + processId + HWND -> providerResourceId
```

Before UIA inspection or action the helper revalidates provider epoch, HWND liveness, PID and exact resource identity. Stale/reused HWND identity fails closed.

For actions, a bare runtime id is not enough. The request must also contain fresh expected element facts supplied by the MRMIC control gateway:

```text
expected.processId
expected.nativeWindowHandle
expected.automationId? 
expected.controlType?
```

The helper resolves the runtime id again inside a bounded Control View traversal and verifies those expected facts before executing the pattern.

## MRMIC control authority boundary

The helper does not know MRMIC principals or `controlOwner` state.

The supported Phase 15.12 MRMIC entry point is `WindowsUiaControlledAccess`, which checks:

```text
portal mounted + visible
  -> controlOwner == principalId
  -> canControl
  -> fresh read-authorized UIA inspection
  -> runtimeId/pattern/enabled/password checks
  -> bound native action
```

The reference freshness bound is **2000 ms** from the fresh UIA inspection timestamp.

Direct JSONL use of `uia.action` is a provider/debug boundary, not equivalent to an authorized MRMIC semantic action.

## `set_value` privacy boundary

The requested text necessarily crosses the trusted MRMIC/native boundary in order for `ValuePattern.SetValue()` to execute.

The helper does not return that text in success evidence. Native result uses:

```text
value = [redacted]
```

The MRMIC-facing `windows_uia_controlled_action_v1` result omits the value field completely.

Password elements are rejected before `SetValue()`.

## Capability boundary

Native capability now reports:

```text
automation.supported = true
automation.inspectionSupported = true
automation.actionSupported = true
automation.supportedActions = [invoke, toggle, select, set_value]
automation.actionValueMaxLength = 2048
automation.passwordValueWriteAllowed = false
automation.maxDepth = 8
automation.maxElements = 512
automation.maxPatternsPerElement = 32
automation.valueTextIncluded = false
automation.inputInjectionFallback = false
```

MRMIC global capability additionally states that `controlOwner` and fresh inspection are required and that raw input injection is not implemented.

## No raw input fallback

Phase 15.12 does not use:

- `SendInput`
- `mouse_event`
- `keybd_event`
- coordinate clicking
- pointer gestures
- arbitrary keystroke injection
- clipboard injection

Semantic UIA action support therefore does not imply general desktop-input authority.

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
uia.action
```

`uia.action` remains restricted to the four explicit pattern actions above and requires the expected-element binding.

## Local usage

Build/run the raw helper:

```powershell
 dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
 dotnet run --project .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
```

Use the bounded read-only MRMIC UIA inspection CLI from repository root:

```powershell
npm run windows:uia -- -Title "Notepad"
```

or:

```powershell
npm run windows:uia -- -Hwnd "0x123456"
```

Phase 15.12 intentionally exposes no standalone semantic-action CLI. Authorized semantic control requires live MRMIC portal state and the current `controlOwner` lease.

## CI evidence

Portable CI runs strict TypeScript and the complete Node regression suite, including ownership/policy/freshness/pattern/password/value-redaction action tests.

Windows CI:

- compiles the real `.NET 8 / System.Windows.Automation` reference path;
- compiles `InvokePattern`, `TogglePattern`, `SelectionItemPattern` and `ValuePattern` action code;
- launches the native helper for capability/window-enumeration smoke;
- validates the exact semantic action capability set while raw input fallback remains false;
- parses the local Windows validation harnesses.

Hosted CI is not treated as proof that a semantic action has executed against a caller-owned interactive desktop application.

## Security and non-goals

The helper does not:

- inject raw keyboard or pointer input;
- read UI value/text streams as inspection output;
- read password values;
- set password element values;
- fuzzy-retarget disappeared runtime ids;
- execute arbitrary UIA patterns;
- cross UAC/secure-desktop boundaries;
- read credentials;
- own observer identity, Canvas topology or `controlOwner`;
- persist UIA snapshots or action values as canonical Canvas truth;
- retain an unbounded visual, semantic or action-value history.

Stdout is protocol-only. Diagnostics belong on stderr so malformed stdout remains a fail-closed contract violation.

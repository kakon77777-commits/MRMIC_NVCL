# MRMIC Windows Native Bridge — Phase 15.5 Discovery Baseline

This Windows-only helper is the first concrete implementation of the `WindowsNativeBridge` process boundary defined in Phase 15.4.

Phase 15.5 implements **real Win32 desktop-window discovery only**:

- `EnumWindows`
- `IsWindowVisible`
- `IsIconic`
- `GetWindowTextW`
- `GetClassNameW`
- `GetWindowThreadProcessId`
- `DwmGetWindowAttribute(DWMWA_CLOAKED)`

The helper speaks newline-delimited JSON on stdin/stdout using protocol `mrmic-windows-native-bridge/v1`.

## Windows build/run

PowerShell from the repository root:

```powershell
 dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
 dotnet run --project .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
```

The helper is intended to be spawned by `WindowsJsonlNativeBridge`; humans normally do not send JSON manually.

## Implemented methods

```text
capabilities
window.enumerate
```

The provider epoch is generated once per helper process. `window.enumerate` reports provider-local HWND facts; the TypeScript catalog applies the MRMIC discoverability policy and derives `providerEpoch + PID + HWND` resource identity.

## Explicitly not implemented yet

The following protocol methods fail closed with a typed error in Phase 15.5:

```text
capture.mount
capture.update
capture.unmount
uia.inspect
uia.action
```

Therefore this helper currently reports:

```text
capture.supported = false
automation.supported = false
```

Phase 15.5 must not be described as a completed Windows Graphics Capture or UI Automation implementation.

## Security boundary

The helper does not:

- inject keyboard or pointer input;
- cross UAC/secure desktop boundaries;
- read credentials;
- own MRMIC observer identity or `controlOwner`;
- persist HWND identity across process restart.

Stdout is protocol-only. Diagnostics belong on stderr so the JSONL client can treat malformed stdout as a contract failure.

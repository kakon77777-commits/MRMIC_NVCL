$ErrorActionPreference = 'Stop'

$dll = Get-ChildItem -Path "$PSScriptRoot\bin\Release" -Recurse -Filter 'MRMIC.WindowsBridge.dll' |
  Select-Object -First 1
if (-not $dll) { throw 'MRMIC.WindowsBridge.dll was not found after build' }

$requests = @(
  (@{
    protocol = 'mrmic-windows-native-bridge/v1'
    requestId = 'smoke-capabilities'
    method = 'capabilities'
    params = @{}
  } | ConvertTo-Json -Compress),
  (@{
    protocol = 'mrmic-windows-native-bridge/v1'
    requestId = 'smoke-enumerate'
    method = 'window.enumerate'
    params = @{}
  } | ConvertTo-Json -Compress)
)

$lines = @($requests | & dotnet $dll.FullName)
if ($LASTEXITCODE -ne 0) { throw "Windows bridge exited with code $LASTEXITCODE" }
if ($lines.Count -ne 2) { throw "Expected 2 JSONL responses, got $($lines.Count)" }

$responses = @($lines | ForEach-Object { $_ | ConvertFrom-Json })
$cap = $responses | Where-Object { $_.requestId -eq 'smoke-capabilities' } | Select-Object -First 1
$windows = $responses | Where-Object { $_.requestId -eq 'smoke-enumerate' } | Select-Object -First 1

if (-not $cap -or -not $cap.ok) { throw 'Capabilities smoke request failed' }
if ($cap.protocol -ne 'mrmic-windows-native-bridge/v1') { throw 'Unexpected bridge protocol' }
if ($cap.result.provider -ne 'windows') { throw 'Unexpected Windows provider id' }
if ([string]::IsNullOrWhiteSpace([string]$cap.result.providerEpoch)) { throw 'providerEpoch was not returned' }
if (-not $cap.result.capture.sessionLifecycleSupported) { throw 'WGC session lifecycle capability was not advertised' }
if ($cap.result.capture.frameTransport -ne 'none') { throw 'Phase 15.6 must not advertise frame transport' }
if ($cap.result.capture.supported) { throw 'Phase 15.6 must not advertise completed capture transport' }
if ($cap.result.automation.supported) { throw 'Phase 15.6 must not advertise UI Automation' }

if (-not $windows -or -not $windows.ok) { throw 'Window enumeration smoke request failed' }
if ($windows.protocol -ne 'mrmic-windows-native-bridge/v1') { throw 'Unexpected enumeration protocol' }

Write-Host "Windows bridge smoke passed; enumerated $(@($windows.result).Count) top-level window facts."

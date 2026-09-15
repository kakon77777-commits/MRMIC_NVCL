param(
  [ValidateRange(1,120000)]
  [int]$TimeoutMs = 20000,
  [string]$Output
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$targetProcess = $null

Push-Location $repoRoot
try {
  Write-Host 'Building Windows native bridge...'
  & dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
  if ($LASTEXITCODE -ne 0) { throw "Windows bridge build failed with exit code $LASTEXITCODE" }

  Write-Host 'Building dedicated Phase 15.13 safe WPF target...'
  & dotnet build .\native\windows-controlled-action-target\MRMIC.WindowsControlledActionTarget.csproj -c Release
  if ($LASTEXITCODE -ne 0) { throw "controlled-action target build failed with exit code $LASTEXITCODE" }

  Write-Host 'Building MRMIC TypeScript runtime...'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

  $bridgeDll = Get-ChildItem -Path .\native\windows-bridge-csharp\bin\Release -Recurse -Filter 'MRMIC.WindowsBridge.dll' |
    Select-Object -First 1
  if (-not $bridgeDll) { throw 'MRMIC.WindowsBridge.dll was not found after build.' }

  $targetExe = Get-ChildItem -Path .\native\windows-controlled-action-target\bin\Release -Recurse -Filter 'MRMIC.WindowsControlledActionTarget.exe' |
    Select-Object -First 1
  if (-not $targetExe) { throw 'MRMIC.WindowsControlledActionTarget.exe was not found after build.' }

  if (-not $Output) {
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
    $Output = Join-Path $repoRoot "artifacts\windows-controlled-action-e2e\evidence-$stamp.json"
  }

  Write-Host 'Launching dedicated controlled-action target...'
  $targetProcess = Start-Process -FilePath $targetExe.FullName -PassThru
  $deadline = (Get-Date).AddSeconds(15)
  do {
    Start-Sleep -Milliseconds 100
    $targetProcess.Refresh()
    if ($targetProcess.HasExited) { throw "controlled-action target exited early with code $($targetProcess.ExitCode)" }
  } while ($targetProcess.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)

  if ($targetProcess.MainWindowHandle -eq 0) { throw 'controlled-action target did not create an interactive top-level window in time.' }

  $nodeArgs = @(
    'dist/apps/windows-controlled-action-e2e/src/index.js',
    '--confirm-interactive',
    '--bridge-dll', $bridgeDll.FullName,
    '--target-pid', [string]$targetProcess.Id,
    '--timeout-ms', [string]$TimeoutMs,
    '--output', $Output
  )

  Write-Host 'Running controlOwner-gated UIA action E2E against the dedicated safe target...'
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw "controlled-action E2E failed with exit code $LASTEXITCODE" }

  Write-Host "Controlled-action E2E evidence: $Output"
} finally {
  if ($targetProcess -and -not $targetProcess.HasExited) {
    Stop-Process -Id $targetProcess.Id -Force -ErrorAction SilentlyContinue
  }
  Pop-Location
}

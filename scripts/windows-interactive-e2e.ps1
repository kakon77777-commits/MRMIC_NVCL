param(
  [string]$Title,
  [string]$Hwnd,
  [ValidateRange(1,20)]
  [int]$Samples = 3,
  [ValidateRange(1,120000)]
  [int]$TimeoutMs = 15000,
  [string]$Output
)

$ErrorActionPreference = 'Stop'

if (($Title -and $Hwnd) -or (-not $Title -and -not $Hwnd)) {
  throw 'Specify exactly one of -Title or -Hwnd.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  Write-Host 'Building Windows native bridge...'
  & dotnet build .\native\windows-bridge-csharp\MRMIC.WindowsBridge.csproj -c Release
  if ($LASTEXITCODE -ne 0) { throw "dotnet build failed with exit code $LASTEXITCODE" }

  $dll = Get-ChildItem -Path .\native\windows-bridge-csharp\bin\Release -Recurse -Filter 'MRMIC.WindowsBridge.dll' |
    Select-Object -First 1
  if (-not $dll) { throw 'MRMIC.WindowsBridge.dll was not found after build.' }

  Write-Host 'Building MRMIC TypeScript runtime...'
  & npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE" }

  if (-not $Output) {
    $stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssfffZ')
    $Output = Join-Path $repoRoot "artifacts\windows-interactive-e2e\evidence-$stamp.json"
  }

  $nodeArgs = @(
    'dist/apps/windows-interactive-e2e/src/index.js',
    '--confirm-interactive',
    '--bridge-dll', $dll.FullName,
    '--samples', [string]$Samples,
    '--timeout-ms', [string]$TimeoutMs,
    '--output', $Output
  )
  if ($Title) {
    $nodeArgs += @('--title', $Title)
  } else {
    $nodeArgs += @('--hwnd', $Hwnd)
  }

  Write-Host 'Running interactive Windows E2E against the selected top-level window...'
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw "interactive E2E failed with exit code $LASTEXITCODE" }

  Write-Host "Interactive Windows E2E evidence: $Output"
} finally {
  Pop-Location
}

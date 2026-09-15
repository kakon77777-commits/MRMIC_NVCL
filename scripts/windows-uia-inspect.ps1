param(
  [string]$Title,
  [string]$Hwnd,
  [string]$Output
)

$ErrorActionPreference = 'Stop'

if (($Title -and $Hwnd) -or (-not $Title -and -not $Hwnd)) {
  throw 'Specify exactly one of -Title or -Hwnd.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  Write-Host 'Building Windows native bridge with read-only UI Automation inspection...'
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
    $Output = Join-Path $repoRoot "artifacts\windows-uia-inspection\snapshot-$stamp.json"
  }

  $nodeArgs = @(
    'dist/apps/windows-uia-inspect/src/index.js',
    '--confirm-readonly',
    '--bridge-dll', $dll.FullName,
    '--output', $Output
  )
  if ($Title) {
    $nodeArgs += @('--title', $Title)
  } else {
    $nodeArgs += @('--hwnd', $Hwnd)
  }

  Write-Host 'Reading bounded UI Automation metadata from the selected window...'
  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) { throw "UIA inspection failed with exit code $LASTEXITCODE" }

  Write-Host "Read-only UIA snapshot: $Output"
} finally {
  Pop-Location
}

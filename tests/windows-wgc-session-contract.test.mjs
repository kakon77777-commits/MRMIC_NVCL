import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 15.6 native helper contains an HWND-bound WGC session lifecycle without frame transport', async () => {
  const manager = await readFile('native/windows-bridge-csharp/CaptureSessionManager.cs', 'utf8')
  const program = await readFile('native/windows-bridge-csharp/Program.cs', 'utf8')

  for (const token of [
    'IGraphicsCaptureItemInterop',
    'CreateForWindow',
    'D3D11CreateDevice',
    'CreateDirect3D11DeviceFromDXGIDevice',
    'Direct3D11CaptureFramePool.CreateFreeThreaded',
    'CreateCaptureSession',
    'StartCapture',
    'TryGetNextFrame',
    'sender.Recreate',
  ]) assert.ok(manager.includes(token), `missing WGC session primitive: ${token}`)

  assert.ok(manager.includes('providerEpoch + processId + HWND') || manager.includes('providerResourceId does not match providerEpoch + processId + HWND'))
  assert.ok(program.includes('sessionLifecycleSupported = true'))
  assert.ok(program.includes('frameTransport = "none"'))
  assert.ok(program.includes('supported = false'))
  assert.ok(!manager.includes('SoftwareBitmap.CreateCopyFromSurfaceAsync'), 'FrameArrived must not synchronously read back pixels in Phase 15.6')
})

test('Phase 15.6 Windows project targets current SDK while retaining Win10 1903 minimum support', async () => {
  const project = await readFile('native/windows-bridge-csharp/MRMIC.WindowsBridge.csproj', 'utf8')
  assert.ok(project.includes('<TargetFramework>net8.0-windows10.0.26100.0</TargetFramework>'))
  assert.ok(project.includes('<SupportedOSPlatformVersion>10.0.18362.0</SupportedOSPlatformVersion>'))
  assert.ok(project.includes('<TreatWarningsAsErrors>true</TreatWarningsAsErrors>'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 15.8 keeps WGC callback bounded and projects transported frames through ephemeral observer-gated render copies', async () => {
  const manager = await readFile('native/windows-bridge-csharp/CaptureSessionManager.cs', 'utf8')
  const transport = await readFile('native/windows-bridge-csharp/BoundedPngFrameTransport.cs', 'utf8')
  const program = await readFile('native/windows-bridge-csharp/Program.cs', 'utf8')
  const visual = await readFile('packages/portal-overlay/src/visual.ts', 'utf8')
  const windowsHost = await readFile('packages/provider-windows/src/visual-host.ts', 'utf8')
  const observerGate = await readFile('packages/observer-workspace/src/projection.ts', 'utf8')

  for (const token of [
    'IGraphicsCaptureItemInterop',
    'CreateForWindow',
    'D3D11CreateDevice',
    'CreateDirect3D11DeviceFromDXGIDevice',
    'Direct3D11CaptureFramePool.CreateFreeThreaded',
    'CreateCaptureSession',
    'StartCapture',
    'TryGetNextFrame',
    '_framePool.Recreate',
    'BoundedPngFrameTransport',
    'WaitUntilIdleAsync',
  ]) assert.ok(manager.includes(token), `missing WGC/transport primitive: ${token}`)

  for (const token of [
    'Channel.CreateBounded<QueuedFrame>',
    'QueueCapacity = 2',
    'SoftwareBitmap.CreateCopyFromSurfaceAsync',
    'BitmapEncoder.PngEncoderId',
    'encoder.FlushAsync()',
    'SHA256.HashData',
    'MaxSnapshotPixels = 8_294_400',
    'MaxSnapshotBytes = 16 * 1024 * 1024',
    'png_base64_snapshot_v1',
  ]) assert.ok(transport.includes(token), `missing bounded frame transport primitive: ${token}`)

  assert.ok(manager.includes('providerResourceId does not match providerEpoch + processId + HWND'))
  assert.ok(program.includes('case "capture.snapshot"'))
  assert.ok(program.includes('frameTransportSupported = true'))
  assert.ok(program.includes('frameTransport = BoundedPngFrameTransport.TransportName'))
  assert.ok(program.includes('supported = true'), 'Phase 15.8 must advertise snapshot-backed portal capture support')

  for (const token of ['snapshotPortalVisualFrame', 'projectPortalVisualFrame', 'livePortalVisualFrameDataUri']) {
    assert.ok(visual.includes(token), `missing portal visual projection primitive: ${token}`)
  }
  assert.ok(windowsHost.includes('class WindowsSnapshotLivePortalHost'))
  assert.ok(windowsHost.includes('snapshotCapture'))
  assert.ok(observerGate.includes('observerAllowsPortalVisual'))
  assert.ok(observerGate.includes('room.projections.some'))
  assert.ok(observerGate.includes('active.foregroundPortalIds.includes'))

  const callbackStart = manager.indexOf('private void OnFrameArrived')
  const callbackEnd = manager.indexOf('private async Task RecreateAfterDrainAsync', callbackStart)
  const callback = manager.slice(callbackStart, callbackEnd)
  assert.ok(callback.includes('_transport.Enqueue(frame)'))
  assert.ok(!callback.includes('SoftwareBitmap.CreateCopyFromSurfaceAsync'), 'FrameArrived must not synchronously read back pixels')
  assert.ok(!callback.includes('BitmapEncoder'), 'FrameArrived must not encode PNG bytes')
})

test('Phase 15.8 Windows project targets current SDK while retaining Win10 1903 minimum support', async () => {
  const project = await readFile('native/windows-bridge-csharp/MRMIC.WindowsBridge.csproj', 'utf8')
  assert.ok(project.includes('<TargetFramework>net8.0-windows10.0.26100.0</TargetFramework>'))
  assert.ok(project.includes('<SupportedOSPlatformVersion>10.0.18362.0</SupportedOSPlatformVersion>'))
  assert.ok(project.includes('<TreatWarningsAsErrors>true</TreatWarningsAsErrors>'))
})

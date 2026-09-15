import test from 'node:test'
import assert from 'node:assert/strict'
import { runInteractiveWindowsE2E } from '../dist/packages/provider-windows/src/interactive-e2e.js'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII='
const PNG_SHA256 = '98884e721ec2f605f3788f2bc39a61de305ff4f4fcaf26b6f4eabeebcd6c0fb4'

function fakeBridge() {
  const providerResourceId = 'window:epoch-e2e:71:0x710'
  let snapshotCalls = 0
  return {
    get snapshotCalls() { return snapshotCalls },
    capabilities() {
      return {
        schema: 'windows_provider_capabilities_v1',
        provider: 'windows',
        providerEpoch: 'epoch-e2e',
        platform: 'win32',
        capture: {
          api: 'windows_graphics_capture',
          supported: true,
          sessionLifecycleSupported: true,
          frameTransport: 'png_base64_snapshot_v1',
          frameTransportSupported: true,
          maxActiveMounts: 4,
          frameQueueCapacity: 2,
          maxSnapshotPixels: 8294400,
          maxSnapshotBytes: 16777216,
          minimumBuild: 18362,
          target: 'hwnd',
        },
        automation: {
          api: 'uia',
          supported: false,
          semanticPatternsPreferred: true,
          inputInjectionFallback: false,
          interactiveDesktopRequiredForInjection: true,
        },
      }
    },
    async enumerateTopLevelWindows() {
      return [{
        hwndHex: '0x710', processId: 71, threadId: 72, title: 'MRMIC Interactive Target',
        className: 'E2EClass', visible: true, minimized: false, cloakState: 'none',
      }]
    },
    async mountCapture(resource) {
      assert.equal(resource.providerResourceId, providerResourceId)
      return { mountId: 'mount:e2e', providerResourceId }
    },
    async updateCapture() {},
    async snapshotCapture(mount) {
      snapshotCalls += 1
      return {
        schema: 'windows_capture_snapshot_v1',
        mountId: mount.mountId,
        providerResourceId,
        frameSequence: snapshotCalls,
        capturedAt: `2026-09-15T07:10:${String(snapshotCalls).padStart(2, '0')}Z`,
        width: 1,
        height: 1,
        mimeType: 'image/png',
        encodedBytes: 68,
        sha256: PNG_SHA256,
        bytesBase64: PNG_BASE64,
        transport: 'png_base64_snapshot_v1',
      }
    },
    async unmountCapture() {},
    async inspectUi() { throw new Error('UIA unavailable') },
    async performUiAction() { throw new Error('UIA unavailable') },
  }
}

function virtualRuntime() {
  let now = 0
  return {
    now: () => now,
    schedule(callback, delayMs) {
      const handle = setTimeout(() => {
        now += delayMs
        callback()
      }, 0)
      return handle
    },
    cancel(handle) { clearTimeout(handle) },
  }
}

test('interactive Windows E2E harness proves refresh/render/lifecycle without persisting pixels in evidence', async () => {
  const bridge = fakeBridge()
  const evidence = await runInteractiveWindowsE2E({
    bridge,
    selector: { titleContains: 'Interactive Target' },
    samples: 3,
    timeoutMs: 2000,
    interactiveSessionConfirmedByCaller: true,
    runtime: virtualRuntime(),
  })

  assert.equal(evidence.schema, 'interactive_windows_e2e_v1')
  assert.equal(evidence.passed, true)
  assert.equal(evidence.target.hwndHex, '0x710')
  assert.equal(evidence.capture.samples.length, 3)
  assert.deepEqual(evidence.capture.samples.map(sample => sample.frameSequence), [1, 2, 3])
  for (const sample of evidence.capture.samples) {
    assert.equal(sample.sha256, PNG_SHA256)
    assert.equal(sample.encodedBytes, 68)
    assert.equal(sample.width, 1)
    assert.equal(sample.height, 1)
    assert.equal(sample.svgContainsProjectedImage, true)
  }
  assert.equal(evidence.lifecycle.frozenRetainedFrame, true)
  assert.equal(evidence.lifecycle.frozenProviderRead, false)
  assert.equal(evidence.lifecycle.sleepingClearedPixels, true)
  assert.equal(evidence.lifecycle.sleepingProviderRead, false)
  assert.equal(evidence.canonical.providerPreviewUriRetained, true)
  assert.equal(evidence.canonical.dataUriPersisted, false)
  assert.equal(bridge.snapshotCalls, 3, 'frozen/sleeping validation must not read more provider pixels')

  const serialized = JSON.stringify(evidence)
  assert.doesNotMatch(serialized, /bytesBase64/)
  assert.doesNotMatch(serialized, /data:image\/png;base64/)
  assert.doesNotMatch(serialized, new RegExp(PNG_BASE64.slice(0, 20)))
})

test('interactive Windows E2E harness requires explicit interactive-session confirmation before provider access', async () => {
  const bridge = fakeBridge()
  await assert.rejects(
    runInteractiveWindowsE2E({
      bridge,
      selector: { hwndHex: '0x710' },
      samples: 1,
      timeoutMs: 1000,
      interactiveSessionConfirmedByCaller: false,
      runtime: virtualRuntime(),
    }),
    /explicit caller confirmation/,
  )
  assert.equal(bridge.snapshotCalls, 0)
})

test('interactive Windows E2E selector fails closed when a title match is ambiguous', async () => {
  const bridge = fakeBridge()
  const original = bridge.enumerateTopLevelWindows
  bridge.enumerateTopLevelWindows = async () => [
    ...(await original()),
    {
      hwndHex: '0x711', processId: 73, threadId: 74, title: 'MRMIC Interactive Target - Duplicate',
      className: 'E2EClass', visible: true, minimized: false, cloakState: 'none',
    },
  ]
  await assert.rejects(
    runInteractiveWindowsE2E({
      bridge,
      selector: { titleContains: 'Interactive Target' },
      samples: 1,
      timeoutMs: 1000,
      interactiveSessionConfirmedByCaller: true,
      runtime: virtualRuntime(),
    }),
    /ambiguous/,
  )
  assert.equal(bridge.snapshotCalls, 0)
})

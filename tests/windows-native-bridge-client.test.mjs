import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  WindowsJsonlNativeBridge,
  WindowsNativeBridgeProtocolError,
} from '../dist/packages/provider-windows/src/jsonl-bridge.js'

const fixture = resolve('tests/fixtures/windows-native-bridge-fake.mjs')

function client(mode = 'normal', requestTimeoutMs = 1000) {
  return new WindowsJsonlNativeBridge({
    command: process.execPath,
    args: [fixture, mode],
    requestTimeoutMs,
  })
}

function resource() {
  return {
    schema: 'windows_window_resource_v1',
    provider: 'windows',
    resourceKind: 'desktop_window',
    providerResourceId: 'window:fake-epoch:20:0x200',
    resourceUri: 'windows://window/window%3Afake-epoch%3A20%3A0x200',
    providerEpoch: 'fake-epoch',
    hwndHex: '0x200',
    processId: 20,
    threadId: 21,
    title: 'Fake Editor',
    state: { visible: true, minimized: false, cloakState: 'none' },
    projection: {
      preferredDisplayMode: 'snapshot',
      previewUri: 'windows://window/window%3Afake-epoch%3A20%3A0x200/preview.png',
      liveMountUri: 'windows://window/window%3Afake-epoch%3A20%3A0x200/live',
      liveMountKind: 'windows-graphics-capture',
    },
    automation: { api: 'uia', available: false, inputInjectionFallback: false },
    updatedAt: '2026-09-14T08:00:00Z',
  }
}

const rect = { left: 0, top: 0, width: 100, height: 100, visible: true }

test('JSONL bridge correlates concurrent responses by requestId even when the helper reverses responses', async () => {
  const bridge = client('reverse')
  try {
    const [capabilities, windows] = await Promise.all([
      bridge.capabilities(),
      bridge.enumerateTopLevelWindows(),
    ])
    assert.equal(capabilities.providerEpoch, 'fake-epoch')
    assert.equal(capabilities.capture.supported, false)
    assert.equal(capabilities.capture.frameTransport, 'png_base64_snapshot_v1')
    assert.deepEqual(windows.map(window => window.title), ['Fake Editor'])
  } finally {
    bridge.close()
  }
})

test('bounded snapshot transport validates identity, byte length and SHA-256 across the process boundary', async () => {
  const bridge = client()
  try {
    const mount = await bridge.mountCapture(resource(), rect)
    const snapshot = await bridge.snapshotCapture(mount)
    assert.equal(snapshot.schema, 'windows_capture_snapshot_v1')
    assert.equal(snapshot.mountId, 'mount-1')
    assert.equal(snapshot.providerResourceId, resource().providerResourceId)
    assert.equal(snapshot.mimeType, 'image/png')
    assert.equal(snapshot.transport, 'png_base64_snapshot_v1')
    assert.equal(snapshot.width, 1)
    assert.equal(snapshot.height, 1)
    assert.match(snapshot.sha256, /^[0-9a-f]{64}$/)
    assert.ok(snapshot.encodedBytes > 0)
    await bridge.unmountCapture(mount)
  } finally {
    bridge.close()
  }
})

test('tampered snapshot digest fails closed at the TypeScript trust boundary', async () => {
  const bridge = client('bad-frame-hash')
  try {
    const mount = await bridge.mountCapture(resource(), rect)
    await assert.rejects(
      () => bridge.snapshotCapture(mount),
      error => error instanceof WindowsNativeBridgeProtocolError && error.code === 'FRAME_INTEGRITY',
    )
  } finally {
    bridge.close()
  }
})

test('discovery-only helper still propagates typed capture failure without fallback', async () => {
  const bridge = client('discovery-only')
  try {
    await assert.rejects(
      () => bridge.mountCapture(resource(), rect),
      error => error instanceof WindowsNativeBridgeProtocolError && error.code === 'CAPTURE_NOT_IMPLEMENTED',
    )
  } finally {
    bridge.close()
  }
})

test('malformed native stdout is terminal and fails closed', async () => {
  const bridge = client('malformed')
  await assert.rejects(() => bridge.capabilities(), error => error instanceof Error)
  bridge.close()
})

test('native request timeout kills the current process boundary instead of retrying ambiguous work', async () => {
  const bridge = client('silent', 25)
  try {
    await assert.rejects(
      () => bridge.capabilities(),
      error => error instanceof WindowsNativeBridgeProtocolError && error.code === 'REQUEST_TIMEOUT',
    )
  } finally {
    bridge.close()
  }
})

test('unexpected native helper exit rejects pending work', async () => {
  const bridge = client('exit', 500)
  try {
    await assert.rejects(() => bridge.capabilities())
  } finally {
    bridge.close()
  }
})

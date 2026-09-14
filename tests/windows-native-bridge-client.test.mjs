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

test('JSONL bridge correlates concurrent responses by requestId even when the helper reverses responses', async () => {
  const bridge = client('reverse')
  try {
    const [capabilities, windows] = await Promise.all([
      bridge.capabilities(),
      bridge.enumerateTopLevelWindows(),
    ])
    assert.equal(capabilities.providerEpoch, 'fake-epoch')
    assert.equal(capabilities.capture.supported, false)
    assert.deepEqual(windows.map(window => window.title), ['Fake Editor'])
  } finally {
    bridge.close()
  }
})

test('discovery baseline exposes capabilities and native window facts through the process boundary', async () => {
  const bridge = client()
  try {
    const capabilities = await bridge.capabilities()
    const windows = await bridge.enumerateTopLevelWindows()
    assert.equal(capabilities.provider, 'windows')
    assert.equal(capabilities.automation.supported, false)
    assert.equal(windows[0].hwndHex, '0x200')
    assert.equal(windows[0].processId, 20)
  } finally {
    bridge.close()
  }
})

test('remote typed capture failure propagates without fallback or fake success', async () => {
  const bridge = client()
  try {
    await assert.rejects(
      () => bridge.mountCapture(resource(), { left: 0, top: 0, width: 100, height: 100, visible: true }),
      error => error instanceof WindowsNativeBridgeProtocolError && error.code === 'CAPTURE_NOT_IMPLEMENTED',
    )
  } finally {
    bridge.close()
  }
})

test('malformed native stdout is terminal and fails closed', async () => {
  const bridge = client('malformed')
  await assert.rejects(
    () => bridge.capabilities(),
    error => error instanceof Error,
  )
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

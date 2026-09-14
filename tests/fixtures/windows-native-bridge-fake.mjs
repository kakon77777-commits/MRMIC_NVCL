import { createHash } from 'node:crypto'
import readline from 'node:readline'

const protocol = 'mrmic-windows-native-bridge/v1'
const mode = process.argv[2] ?? 'normal'
const frameBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z+e8AAAAASUVORK5CYII='
const frameBytes = Buffer.from(frameBase64, 'base64')
const frameSha = createHash('sha256').update(frameBytes).digest('hex')

if (mode === 'exit') process.exit(17)

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
const held = []

function write(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}

function success(requestId, result) {
  write({ protocol, requestId, ok: true, result })
}

function failure(requestId, code, message) {
  write({ protocol, requestId, ok: false, error: { code, message } })
}

function handle(request) {
  if (mode === 'malformed') {
    process.stdout.write('{not-json\n')
    return
  }
  if (mode === 'silent') return
  if (request.protocol !== protocol) return failure(request.requestId, 'PROTOCOL_MISMATCH', 'protocol mismatch')
  switch (request.method) {
    case 'capabilities':
      return success(request.requestId, {
        schema: 'windows_provider_capabilities_v1',
        provider: 'windows',
        providerEpoch: 'fake-epoch',
        platform: 'win32',
        capture: {
          api: 'windows_graphics_capture',
          supported: false,
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
        automation: { api: 'uia', supported: false, semanticPatternsPreferred: true, inputInjectionFallback: false, interactiveDesktopRequiredForInjection: true },
      })
    case 'window.enumerate':
      return success(request.requestId, [
        { hwndHex: '0x200', processId: 20, threadId: 21, title: 'Fake Editor', className: 'FakeClass', visible: true, minimized: false, cloakState: 'none' },
      ])
    case 'capture.mount':
      if (mode === 'discovery-only') return failure(request.requestId, 'CAPTURE_NOT_IMPLEMENTED', 'capture unavailable in fake discovery bridge')
      return success(request.requestId, { mountId: 'mount-1', providerResourceId: request.params.providerResourceId })
    case 'capture.update':
      return success(request.requestId, { mountId: request.params.mountId, providerResourceId: request.params.providerResourceId })
    case 'capture.snapshot':
      return success(request.requestId, {
        schema: 'windows_capture_snapshot_v1',
        mountId: request.params.mountId,
        providerResourceId: request.params.providerResourceId,
        frameSequence: 1,
        capturedAt: '2026-09-14T10:00:00.000Z',
        width: 1,
        height: 1,
        mimeType: 'image/png',
        encodedBytes: frameBytes.length,
        sha256: mode === 'bad-frame-hash' ? '0'.repeat(64) : frameSha,
        bytesBase64: frameBase64,
        transport: 'png_base64_snapshot_v1',
      })
    case 'capture.unmount':
      return success(request.requestId, { mountId: request.params.mountId, providerResourceId: request.params.providerResourceId })
    case 'uia.inspect':
    case 'uia.action':
      return failure(request.requestId, 'UIA_NOT_IMPLEMENTED', 'uia unavailable in fake bridge')
    default:
      return failure(request.requestId, 'METHOD_NOT_FOUND', request.method)
  }
}

lines.on('line', line => {
  const request = JSON.parse(line)
  if (mode === 'reverse') {
    held.push(request)
    if (held.length === 2) {
      handle(held[1])
      handle(held[0])
      held.length = 0
    }
    return
  }
  handle(request)
})

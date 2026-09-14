import readline from 'node:readline'

const protocol = 'mrmic-windows-native-bridge/v1'
const mode = process.argv[2] ?? 'normal'

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
        capture: { api: 'windows_graphics_capture', supported: false, minimumBuild: 18362, target: 'hwnd' },
        automation: { api: 'uia', supported: false, semanticPatternsPreferred: true, inputInjectionFallback: false, interactiveDesktopRequiredForInjection: true },
      })
    case 'window.enumerate':
      return success(request.requestId, [
        { hwndHex: '0x200', processId: 20, threadId: 21, title: 'Fake Editor', className: 'FakeClass', visible: true, minimized: false, cloakState: 'none' },
      ])
    case 'capture.mount':
    case 'capture.update':
    case 'capture.unmount':
      return failure(request.requestId, 'CAPTURE_NOT_IMPLEMENTED', 'capture unavailable in fake discovery bridge')
    case 'uia.inspect':
    case 'uia.action':
      return failure(request.requestId, 'UIA_NOT_IMPLEMENTED', 'uia unavailable in fake discovery bridge')
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

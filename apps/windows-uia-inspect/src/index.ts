import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { WindowsProviderCatalog, normalizeHwndHex } from '../../../packages/provider-windows/src/index.js'
import { WindowsJsonlNativeBridge } from '../../../packages/provider-windows/src/jsonl-bridge.js'
import { WindowsUiaReadOnlyAccess } from '../../../packages/provider-windows/src/uia.js'

interface Args {
  bridgeDll: string
  title?: string
  hwnd?: string
  output?: string
  confirmed: boolean
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function parseArgs(argv: string[]): Args {
  const result: Partial<Args> = { confirmed: false }
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index]
    if (token === '--confirm-readonly') result.confirmed = true
    else if (token === '--bridge-dll') result.bridgeDll = argv[++index]
    else if (token === '--title') result.title = argv[++index]
    else if (token === '--hwnd') result.hwnd = argv[++index]
    else if (token === '--output') result.output = argv[++index]
    else throw new Error(`unknown argument: ${token}`)
  }
  const bridgeDll = required(result.bridgeDll, '--bridge-dll')
  const title = result.title?.trim()
  const hwnd = result.hwnd?.trim()
  if (Boolean(title) === Boolean(hwnd)) throw new Error('specify exactly one of --title or --hwnd')
  return {
    bridgeDll,
    ...(title ? { title } : {}),
    ...(hwnd ? { hwnd } : {}),
    ...(result.output?.trim() ? { output: result.output.trim() } : {}),
    confirmed: Boolean(result.confirmed),
  }
}

function chooseResource(resources: ReturnType<WindowsProviderCatalog['list']>, args: Args) {
  const matches = args.hwnd
    ? resources.filter(resource => resource.hwndHex === normalizeHwndHex(args.hwnd!))
    : resources.filter(resource => resource.title.toLocaleLowerCase().includes(args.title!.toLocaleLowerCase()))
  if (matches.length === 0) throw new Error('no discoverable Windows target matched the selector')
  if (matches.length > 1) throw new Error(`Windows target selector is ambiguous: ${matches.length} resources matched`)
  const resource = matches[0]
  if (!resource) throw new Error('Windows target selection failed')
  if (resource.state.minimized) throw new Error('UIA inspection target must not be minimized')
  return resource
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!args.confirmed) throw new Error('--confirm-readonly is required before UI Automation inspection')
  if (process.platform !== 'win32') throw new Error('windows-uia-inspect requires Windows')

  const bridge = new WindowsJsonlNativeBridge({
    command: 'dotnet',
    args: [args.bridgeDll],
    requestTimeoutMs: 15_000,
  })
  try {
    const catalog = new WindowsProviderCatalog(bridge)
    const resources = await catalog.refresh()
    const resource = chooseResource(resources, args)
    const access = new WindowsUiaReadOnlyAccess(bridge, catalog, {
      canInspect: ({ providerResourceId }) => providerResourceId === resource.providerResourceId,
      canControl: () => false,
    })
    const snapshot = await access.inspect('portal:windows-uia-inspect', resource.providerResourceId, 'principal:windows-uia-inspect')
    const output = JSON.stringify(snapshot, null, 2)
    if (args.output) {
      mkdirSync(dirname(args.output), { recursive: true })
      writeFileSync(args.output, `${output}\n`, 'utf8')
    } else {
      console.log(output)
    }
  } finally {
    bridge.close()
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

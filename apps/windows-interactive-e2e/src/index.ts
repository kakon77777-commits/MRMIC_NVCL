import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { WindowsJsonlNativeBridge } from '../../../packages/provider-windows/src/jsonl-bridge.js'
import {
  runInteractiveWindowsE2E,
  type InteractiveWindowsTargetSelector,
} from '../../../packages/provider-windows/src/interactive-e2e.js'

interface CliOptions {
  selector: InteractiveWindowsTargetSelector
  bridgeDll: string
  samples?: number
  timeoutMs?: number
  output: string
  confirmInteractive: boolean
}

function usage(): string {
  return [
    'MRMIC Phase 15.10 interactive Windows E2E',
    '',
    'Usage:',
    '  node dist/apps/windows-interactive-e2e/src/index.js --confirm-interactive --bridge-dll <path> (--title <substring> | --hwnd <0x...>) [options]',
    '',
    'Options:',
    '  --title <substring>       Match exactly one discoverable top-level window by title substring.',
    '  --hwnd <0x...>            Match exactly one discoverable top-level window by HWND.',
    '  --bridge-dll <path>       Built MRMIC.WindowsBridge.dll. Can also use MRMIC_WINDOWS_BRIDGE_DLL.',
    '  --samples <n>             Provider-read samples to collect (default 3, max 20).',
    '  --timeout-ms <n>          Overall visual capture timeout (default 15000, max 120000).',
    '  --output <path>           Evidence JSON output path.',
    '  --confirm-interactive     Required explicit confirmation that this is a user-interactive Windows session.',
    '  --help                    Show this help.',
  ].join('\n')
}

function valueAfter(args: string[], index: number, label: string): string {
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${label} requires a value`)
  return value
}

function parseInteger(value: string, label: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) throw new Error(`${label} must be an integer`)
  return parsed
}

function defaultOutputPath(): string {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return resolve(process.cwd(), 'artifacts', 'windows-interactive-e2e', `evidence-${stamp}.json`)
}

function parseArgs(args: string[]): CliOptions | null {
  if (args.includes('--help')) return null
  let titleContains: string | undefined
  let hwndHex: string | undefined
  let bridgeDll = process.env.MRMIC_WINDOWS_BRIDGE_DLL
  let samples: number | undefined
  let timeoutMs: number | undefined
  let output = defaultOutputPath()
  let confirmInteractive = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--title':
        titleContains = valueAfter(args, index, '--title')
        index += 1
        break
      case '--hwnd':
        hwndHex = valueAfter(args, index, '--hwnd')
        index += 1
        break
      case '--bridge-dll':
        bridgeDll = valueAfter(args, index, '--bridge-dll')
        index += 1
        break
      case '--samples':
        samples = parseInteger(valueAfter(args, index, '--samples'), '--samples')
        index += 1
        break
      case '--timeout-ms':
        timeoutMs = parseInteger(valueAfter(args, index, '--timeout-ms'), '--timeout-ms')
        index += 1
        break
      case '--output':
        output = resolve(valueAfter(args, index, '--output'))
        index += 1
        break
      case '--confirm-interactive':
        confirmInteractive = true
        break
      default:
        throw new Error(`unknown argument: ${arg}`)
    }
  }

  if (!bridgeDll?.trim()) throw new Error('--bridge-dll or MRMIC_WINDOWS_BRIDGE_DLL is required')
  const selector: InteractiveWindowsTargetSelector = {
    ...(titleContains ? { titleContains } : {}),
    ...(hwndHex ? { hwndHex } : {}),
  }
  return {
    selector,
    bridgeDll: resolve(bridgeDll),
    ...(samples !== undefined ? { samples } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    output,
    confirmInteractive,
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (!options) {
    console.log(usage())
    return
  }
  if (process.platform !== 'win32') throw new Error('interactive Windows E2E can only run on Windows')
  if (!options.confirmInteractive) throw new Error('--confirm-interactive is required')
  if (!existsSync(options.bridgeDll)) throw new Error(`Windows bridge DLL not found: ${options.bridgeDll}`)

  const bridge = new WindowsJsonlNativeBridge({
    command: 'dotnet',
    args: [options.bridgeDll],
    cwd: process.cwd(),
    requestTimeoutMs: 5_000,
  })
  try {
    const evidence = await runInteractiveWindowsE2E({
      bridge,
      selector: options.selector,
      ...(options.samples !== undefined ? { samples: options.samples } : {}),
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
      interactiveSessionConfirmedByCaller: true,
    })
    mkdirSync(dirname(options.output), { recursive: true })
    writeFileSync(options.output, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ok: true, output: options.output, evidence }, null, 2))
  } finally {
    bridge.close()
  }
}

main().catch(error => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(JSON.stringify({ ok: false, error: message }, null, 2))
  process.exitCode = 1
})

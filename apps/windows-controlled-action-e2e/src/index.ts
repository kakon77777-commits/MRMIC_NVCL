import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { WindowsJsonlNativeBridge } from '../../../packages/provider-windows/src/jsonl-bridge.js'
import { runInteractiveWindowsControlledActionE2E } from '../../../packages/provider-windows/src/controlled-action-e2e.js'

interface CliOptions {
  bridgeDll: string
  targetProcessId: number
  timeoutMs?: number
  output: string
  confirmInteractive: boolean
}

function usage(): string {
  return [
    'MRMIC Phase 15.13 interactive controlled-action E2E',
    '',
    'This CLI only accepts the PID of the dedicated MRMIC safe WPF target.',
    '',
    'Usage:',
    '  node dist/apps/windows-controlled-action-e2e/src/index.js --confirm-interactive --bridge-dll <path> --target-pid <pid> [options]',
    '',
    'Options:',
    '  --bridge-dll <path>       Built MRMIC.WindowsBridge.dll. Can also use MRMIC_WINDOWS_BRIDGE_DLL.',
    '  --target-pid <pid>         PID of the dedicated Phase 15.13 WPF test target.',
    '  --timeout-ms <n>          Overall timeout (default 20000, max 120000).',
    '  --output <path>           Evidence JSON output path.',
    '  --confirm-interactive     Required explicit confirmation of an interactive Windows session.',
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
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`)
  return parsed
}

function defaultOutputPath(): string {
  const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
  return resolve(process.cwd(), 'artifacts', 'windows-controlled-action-e2e', `evidence-${stamp}.json`)
}

function parseArgs(args: string[]): CliOptions | null {
  if (args.includes('--help')) return null
  let bridgeDll = process.env.MRMIC_WINDOWS_BRIDGE_DLL
  let targetProcessId: number | undefined
  let timeoutMs: number | undefined
  let output = defaultOutputPath()
  let confirmInteractive = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    switch (arg) {
      case '--bridge-dll':
        bridgeDll = valueAfter(args, index, '--bridge-dll')
        index += 1
        break
      case '--target-pid':
        targetProcessId = parseInteger(valueAfter(args, index, '--target-pid'), '--target-pid')
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
  if (!targetProcessId) throw new Error('--target-pid is required')
  return {
    bridgeDll: resolve(bridgeDll),
    targetProcessId,
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
  if (process.platform !== 'win32') throw new Error('controlled-action E2E can only run on Windows')
  if (!options.confirmInteractive) throw new Error('--confirm-interactive is required')
  if (!existsSync(options.bridgeDll)) throw new Error(`Windows bridge DLL not found: ${options.bridgeDll}`)

  const bridge = new WindowsJsonlNativeBridge({
    command: 'dotnet',
    args: [options.bridgeDll],
    cwd: process.cwd(),
    requestTimeoutMs: 5_000,
  })
  try {
    const evidence = await runInteractiveWindowsControlledActionE2E({
      bridge,
      targetProcessId: options.targetProcessId,
      interactiveSessionConfirmedByCaller: true,
      ...(options.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : {}),
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

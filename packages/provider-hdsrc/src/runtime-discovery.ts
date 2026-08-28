import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { HdsrcProviderError } from './index.js'
import { HDSRC_PROCESS_PROTOCOL } from './process-client.js'

export interface HdsrcRuntimeBindingV1 {
  schema: 'hdsrc-runtime-binding/v1'
  runtimeId: string
  protocol: 'hdsrc-process/0.1'
  executable: string
  hostScript: string
  registry: string
  profileRoot: string
  materializationRoot: string
  cwd?: string
  timeoutMs?: number
  maxResourceBytes?: number
}

export interface HdsrcRuntimeDescriptor {
  schema: 'hdsrc-runtime-descriptor/v1'
  runtimeId: string
  source: 'explicit' | 'environment' | 'user_local'
  bindingPath: string
  protocol: 'hdsrc-process/0.1'
  executable: string
  hostScript: string
  registry: string
  profileRoot: string
  materializationRoot: string
  cwd?: string
  timeoutMs?: number
  maxResourceBytes?: number
}

export interface HdsrcRuntimeDiscoveryOptions {
  explicitBindingPath?: string
  env?: Record<string, string | undefined>
  platform?: string
  homeDir?: string
}

type DiscoverySource = HdsrcRuntimeDescriptor['source']

const BINDING_KEYS = new Set([
  'schema',
  'runtimeId',
  'protocol',
  'executable',
  'hostScript',
  'registry',
  'profileRoot',
  'materializationRoot',
  'cwd',
  'timeoutMs',
  'maxResourceBytes',
])

export async function discoverHdsrcRuntime(
  options: HdsrcRuntimeDiscoveryOptions = {},
): Promise<HdsrcRuntimeDescriptor> {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform

  if (options.explicitBindingPath !== undefined) {
    return readSelectedRuntimeBinding('explicit', options.explicitBindingPath)
  }

  const environmentBinding = env.HDSRC_RUNTIME_BINDING
  if (typeof environmentBinding === 'string' && environmentBinding.trim()) {
    return readSelectedRuntimeBinding('environment', environmentBinding)
  }

  const userLocal = userLocalHdsrcBindingPath({ ...options, env, platform })
  if (!userLocal) {
    throw new HdsrcProviderError('PROVIDER_UNAVAILABLE', 'no configured HDSRC runtime binding')
  }
  return readSelectedRuntimeBinding('user_local', userLocal)
}

export function userLocalHdsrcBindingPath(
  options: Pick<HdsrcRuntimeDiscoveryOptions, 'env' | 'platform' | 'homeDir'> = {},
): string | undefined {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform

  if (platform === 'win32') {
    const localAppData = optionalText(env.LOCALAPPDATA)
    return localAppData ? resolve(localAppData, 'EveMissLab/hdsrc/runtime-binding.json') : undefined
  }

  const xdgConfig = optionalText(env.XDG_CONFIG_HOME)
  if (xdgConfig) return resolve(xdgConfig, 'evemisslab/hdsrc/runtime-binding.json')

  const home = optionalText(options.homeDir) ?? optionalText(env.HOME)
  return home ? resolve(home, '.config/evemisslab/hdsrc/runtime-binding.json') : undefined
}

function readSelectedRuntimeBinding(
  source: DiscoverySource,
  selectedPath: string,
): HdsrcRuntimeDescriptor {
  const bindingPath = selectedBindingPath(selectedPath)
  let raw: string
  try {
    raw = Buffer.from(readFileSync(bindingPath)).toString('utf8')
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new HdsrcProviderError(
      'PROVIDER_UNAVAILABLE',
      `selected HDSRC runtime binding is unavailable: ${bindingPath}; ${detail}`,
    )
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new HdsrcProviderError('INTEGRITY_FAILURE', `invalid HDSRC runtime binding JSON: ${detail}`)
  }

  const binding = assertRuntimeBinding(parsed)
  const base = dirname(bindingPath)
  const descriptor: HdsrcRuntimeDescriptor = {
    schema: 'hdsrc-runtime-descriptor/v1',
    runtimeId: binding.runtimeId,
    source,
    bindingPath,
    protocol: HDSRC_PROCESS_PROTOCOL,
    executable: resolveDeploymentPath(base, binding.executable),
    hostScript: resolveDeploymentPath(base, binding.hostScript),
    registry: resolveDeploymentPath(base, binding.registry),
    profileRoot: resolveDeploymentPath(base, binding.profileRoot),
    materializationRoot: resolveDeploymentPath(base, binding.materializationRoot),
    ...(binding.cwd ? { cwd: resolveDeploymentPath(base, binding.cwd) } : {}),
    ...(binding.timeoutMs !== undefined ? { timeoutMs: binding.timeoutMs } : {}),
    ...(binding.maxResourceBytes !== undefined ? { maxResourceBytes: binding.maxResourceBytes } : {}),
  }
  return Object.freeze(descriptor)
}

function assertRuntimeBinding(value: unknown): HdsrcRuntimeBindingV1 {
  const input = record(value, 'HDSRC runtime binding')
  for (const key of Object.keys(input)) {
    if (!BINDING_KEYS.has(key)) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', `unsupported HDSRC runtime binding field ${key}`)
    }
  }
  if (input.schema !== 'hdsrc-runtime-binding/v1') {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC runtime binding schema is invalid')
  }
  const protocol = text(input.protocol, 'protocol')
  if (protocol !== HDSRC_PROCESS_PROTOCOL) {
    throw new HdsrcProviderError('UNSUPPORTED_PROFILE', `unsupported HDSRC process protocol ${protocol}`)
  }

  return {
    schema: 'hdsrc-runtime-binding/v1',
    runtimeId: text(input.runtimeId, 'runtimeId'),
    protocol: HDSRC_PROCESS_PROTOCOL,
    executable: text(input.executable, 'executable'),
    hostScript: text(input.hostScript, 'hostScript'),
    registry: text(input.registry, 'registry'),
    profileRoot: text(input.profileRoot, 'profileRoot'),
    materializationRoot: text(input.materializationRoot, 'materializationRoot'),
    ...(input.cwd !== undefined ? { cwd: text(input.cwd, 'cwd') } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: positiveInteger(input.timeoutMs, 'timeoutMs') } : {}),
    ...(input.maxResourceBytes !== undefined
      ? { maxResourceBytes: positiveInteger(input.maxResourceBytes, 'maxResourceBytes') }
      : {}),
  }
}

function selectedBindingPath(value: string): string {
  try {
    return resolve(text(value, 'binding path'))
  } catch (error) {
    if (error instanceof HdsrcProviderError) throw error
    throw new HdsrcProviderError('INTEGRITY_FAILURE', 'HDSRC runtime binding path is invalid')
  }
}

function resolveDeploymentPath(base: string, value: string): string {
  return resolve(base, value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', `${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', `${label} must be a non-empty string`)
  }
  return value.trim()
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0) {
    throw new HdsrcProviderError('INTEGRITY_FAILURE', `${label} must be a positive integer`)
  }
  return value as number
}

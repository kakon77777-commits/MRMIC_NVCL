import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import {
  discoverHdsrcRuntime,
  userLocalHdsrcBindingPath,
} from '../dist/packages/provider-hdsrc/src/runtime-discovery.js'

async function withTemp(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-discovery-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

async function writeBinding(path, overrides = {}) {
  await mkdir(dirname(path), { recursive: true })
  const binding = {
    schema: 'hdsrc-runtime-binding/v1',
    runtimeId: 'hdsrc:local:v0.10',
    protocol: 'hdsrc-process/0.1',
    executable: './python-bin',
    hostScript: './scripts/hdsrc_process_host.py',
    registry: './registry.json',
    profileRoot: './hdsrc-v010',
    materializationRoot: './materializations',
    ...overrides,
  }
  await writeFile(path, JSON.stringify(binding), 'utf8')
  return binding
}

test('explicit HDSRC binding wins and relative paths resolve against the binding directory', async t => {
  const root = await withTemp(t)
  const explicit = resolve(root, 'explicit/runtime-binding.json')
  const environment = resolve(root, 'environment/runtime-binding.json')
  await writeBinding(explicit)
  await writeBinding(environment, { runtimeId: 'hdsrc:environment' })

  const descriptor = await discoverHdsrcRuntime({
    explicitBindingPath: explicit,
    env: { HDSRC_RUNTIME_BINDING: environment },
    platform: 'linux',
    homeDir: resolve(root, 'home'),
  })

  assert.equal(descriptor.schema, 'hdsrc-runtime-descriptor/v1')
  assert.equal(descriptor.source, 'explicit')
  assert.equal(descriptor.runtimeId, 'hdsrc:local:v0.10')
  assert.equal(descriptor.bindingPath, explicit)
  assert.equal(descriptor.executable, resolve(dirname(explicit), 'python-bin'))
  assert.equal(descriptor.hostScript, resolve(dirname(explicit), 'scripts/hdsrc_process_host.py'))
  assert.equal(descriptor.registry, resolve(dirname(explicit), 'registry.json'))
  assert.equal(descriptor.profileRoot, resolve(dirname(explicit), 'hdsrc-v010'))
  assert.equal(descriptor.materializationRoot, resolve(dirname(explicit), 'materializations'))
  assert.equal(Object.isFrozen(descriptor), true)
})

test('selected explicit binding fails closed instead of falling through to a valid environment binding', async t => {
  const root = await withTemp(t)
  const malformed = resolve(root, 'malformed.json')
  const environment = resolve(root, 'environment.json')
  await writeFile(malformed, '{not-json', 'utf8')
  await writeBinding(environment)

  await assert.rejects(
    () => discoverHdsrcRuntime({
      explicitBindingPath: malformed,
      env: { HDSRC_RUNTIME_BINDING: environment },
      platform: 'linux',
      homeDir: root,
    }),
    error => error?.code === 'INTEGRITY_FAILURE',
  )
})

test('selected environment binding fails closed when missing and does not fall through to user-local', async t => {
  const root = await withTemp(t)
  const missing = resolve(root, 'missing.json')
  const home = resolve(root, 'home')
  const userLocal = resolve(home, '.config/evemisslab/hdsrc/runtime-binding.json')
  await writeBinding(userLocal)

  await assert.rejects(
    () => discoverHdsrcRuntime({
      env: { HDSRC_RUNTIME_BINDING: missing, HOME: home },
      platform: 'linux',
      homeDir: home,
    }),
    error => error?.code === 'PROVIDER_UNAVAILABLE',
  )
})

test('blank environment binding is selected and fails closed instead of falling through to user-local', async t => {
  const root = await withTemp(t)
  const home = resolve(root, 'home')
  const userLocal = resolve(home, '.config/evemisslab/hdsrc/runtime-binding.json')
  await writeBinding(userLocal, { runtimeId: 'hdsrc:user-local-should-not-win' })

  await assert.rejects(
    () => discoverHdsrcRuntime({
      env: { HDSRC_RUNTIME_BINDING: '   ', HOME: home },
      platform: 'linux',
      homeDir: home,
    }),
    error => error?.code === 'INTEGRITY_FAILURE',
  )
})

test('environment binding is used when no explicit binding is supplied', async t => {
  const root = await withTemp(t)
  const environment = resolve(root, 'runtime-binding.json')
  await writeBinding(environment, { runtimeId: 'hdsrc:environment' })

  const descriptor = await discoverHdsrcRuntime({
    env: { HDSRC_RUNTIME_BINDING: environment },
    platform: 'linux',
    homeDir: root,
  })
  assert.equal(descriptor.source, 'environment')
  assert.equal(descriptor.runtimeId, 'hdsrc:environment')
})

test('POSIX XDG and HOME user-local binding paths are deterministic', () => {
  assert.equal(
    userLocalHdsrcBindingPath({
      platform: 'linux',
      env: { XDG_CONFIG_HOME: '/config', HOME: '/home/example' },
      homeDir: '/home/example',
    }),
    resolve('/config/evemisslab/hdsrc/runtime-binding.json'),
  )
  assert.equal(
    userLocalHdsrcBindingPath({
      platform: 'linux',
      env: { HOME: '/home/example' },
      homeDir: '/home/example',
    }),
    resolve('/home/example/.config/evemisslab/hdsrc/runtime-binding.json'),
  )
})

test('Windows user-local binding uses LOCALAPPDATA and never guesses when it is absent', () => {
  assert.equal(
    userLocalHdsrcBindingPath({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' },
    }),
    resolve('C:\\Users\\Example\\AppData\\Local', 'EveMissLab/hdsrc/runtime-binding.json'),
  )
  assert.equal(userLocalHdsrcBindingPath({ platform: 'win32', env: {} }), undefined)
})

test('unknown HDSRC process protocol fails closed', async t => {
  const root = await withTemp(t)
  const binding = resolve(root, 'runtime-binding.json')
  await writeBinding(binding, { protocol: 'hdsrc-process/999' })

  await assert.rejects(
    () => discoverHdsrcRuntime({ explicitBindingPath: binding, env: {}, platform: 'linux', homeDir: root }),
    error => error?.code === 'UNSUPPORTED_PROFILE',
  )
})

test('invalid binding fields fail as integrity errors', async t => {
  const root = await withTemp(t)
  const binding = resolve(root, 'runtime-binding.json')
  await writeBinding(binding, { timeoutMs: 0 })

  await assert.rejects(
    () => discoverHdsrcRuntime({ explicitBindingPath: binding, env: {}, platform: 'linux', homeDir: root }),
    error => error?.code === 'INTEGRITY_FAILURE',
  )
})

test('no configured binding source reports provider unavailable', async t => {
  const root = await withTemp(t)
  await assert.rejects(
    () => discoverHdsrcRuntime({ env: {}, platform: 'win32' }),
    error => error?.code === 'PROVIDER_UNAVAILABLE',
  )
})

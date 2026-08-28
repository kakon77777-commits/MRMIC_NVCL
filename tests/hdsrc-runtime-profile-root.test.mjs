import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { HdsrcJsonlProcessClient } from '../dist/packages/provider-hdsrc/src/process-client.js'
import { productionHdsrcProcessEnv } from '../dist/packages/provider-hdsrc/src/local-process.js'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const hostScript = resolve('scripts/hdsrc_process_host.py')
const fixtureRoot = resolve('tests/fixtures')
const fixtureRuntime = resolve(fixtureRoot, 'hdsrc-stub-runtime/hdsrc_exp')
const fixtureState = resolve(fixtureRoot, 'hdsrc-state.hds1')

async function makeProductionProfile(root) {
  const packageRoot = resolve(root, 'profile/src/hdsrc_exp')
  await mkdir(packageRoot, { recursive: true })
  for (const name of ['__init__.py', 'codec.py']) {
    await writeFile(resolve(packageRoot, name), await readFile(resolve(fixtureRuntime, name)))
  }
  return resolve(root, 'profile')
}

async function makeRegistry(root) {
  const registry = resolve(root, 'registry.json')
  await writeFile(registry, JSON.stringify({
    schema: 'hdsrc-local-registry/v1',
    states: [{
      stateId: 'state:profile-root',
      stateRevision: 7,
      hds1Path: fixtureState,
      readPrincipals: ['principal:allowed'],
    }],
  }), 'utf8')
  return registry
}

async function startHost(t, { profileRoot, registry, env }) {
  const materializationRoot = resolve(await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-profile-root-materialization-')), 'materializations')
  const client = new HdsrcJsonlProcessClient({
    executable: python,
    args: [
      hostScript,
      '--registry', registry,
      '--profile-root', profileRoot,
      '--materialization-root', materializationRoot,
    ],
    env,
    timeoutMs: 2000,
  })
  t.after(() => client.close())
  return client
}

test('production HDSRC host loads codec from configured profileRoot without ambient PYTHONPATH', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-profile-root-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileRoot = await makeProductionProfile(root)
  const registry = await makeRegistry(root)
  const env = { ...process.env, PYTHONPATH: undefined, HDSRC_TEST_STUB_RUNTIME: undefined }
  const client = await startHost(t, { profileRoot, registry, env })

  const state = await client.request('state', {
    ref: 'hdsrc://state/state:profile-root',
    principalId: 'principal:allowed',
  })
  assert.equal(state.stateId, 'state:profile-root')
  assert.equal(state.dimension, 4096)
})

test('configured profileRoot wins over a conflicting ambient hdsrc_exp package', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-profile-conflict-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileRoot = await makeProductionProfile(root)
  const registry = await makeRegistry(root)
  const ambientPackage = resolve(root, 'ambient/hdsrc_exp')
  await mkdir(ambientPackage, { recursive: true })
  await writeFile(resolve(ambientPackage, '__init__.py'), "# ambient conflict\n", 'utf8')
  await writeFile(resolve(ambientPackage, 'codec.py'), "raise RuntimeError('AMBIENT HDSRC PACKAGE LOADED')\n", 'utf8')

  const env = { ...process.env, PYTHONPATH: resolve(root, 'ambient'), HDSRC_TEST_STUB_RUNTIME: undefined }
  const client = await startHost(t, { profileRoot, registry, env })
  const state = await client.request('state', {
    ref: 'hdsrc://state/state:profile-root',
    principalId: 'principal:allowed',
  })
  assert.equal(state.dimension, 4096)
})

test('missing configured profileRoot/src/hdsrc_exp fails closed', async t => {
  const root = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-profile-missing-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const profileRoot = resolve(root, 'empty-profile')
  await mkdir(profileRoot, { recursive: true })
  const registry = await makeRegistry(root)
  const client = await startHost(t, {
    profileRoot,
    registry,
    env: { ...process.env, HDSRC_TEST_STUB_RUNTIME: undefined },
  })

  await assert.rejects(() => client.request('initialize', {}), /profile|process|exited|HDSRC/i)
  assert.equal(client.closed, true)
})

test('production process environment strips ambient HDSRC test and module overrides', () => {
  const base = {
    KEEP_ME: 'yes',
    HDSRC_TEST_STUB_RUNTIME: '1',
    PYTHONPATH: ['/ambient/a', '/ambient/b'].join(delimiter),
  }
  const sanitized = productionHdsrcProcessEnv(base)
  assert.equal(sanitized.KEEP_ME, 'yes')
  assert.equal(sanitized.HDSRC_TEST_STUB_RUNTIME, undefined)
  assert.equal(sanitized.PYTHONPATH, undefined)
})

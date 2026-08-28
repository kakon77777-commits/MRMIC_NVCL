import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { HdsrcJsonlProcessClient } from '../dist/packages/provider-hdsrc/src/process-client.js'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const host = resolve('scripts/hdsrc_process_host.py')
const fixtureRoot = resolve('tests/fixtures')
const registry = resolve(fixtureRoot, 'hdsrc-local-registry.json')
const statePath = resolve(fixtureRoot, 'hdsrc-state.hds1')
const stubRuntime = resolve(fixtureRoot, 'hdsrc-stub-runtime')

async function makeHost(t) {
  const materializationRoot = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-host-'))
  const existingPythonPath = process.env.PYTHONPATH
  const env = {
    ...process.env,
    PYTHONPATH: existingPythonPath ? `${stubRuntime}${delimiter}${existingPythonPath}` : stubRuntime,
    HDSRC_TEST_STUB_RUNTIME: '1',
  }
  const client = new HdsrcJsonlProcessClient({
    executable: python,
    args: [
      host,
      '--registry', registry,
      '--profile-root', fixtureRoot,
      '--materialization-root', materializationRoot,
    ],
    env,
    timeoutMs: 2000,
  })
  t.after(async () => {
    client.close()
    await rm(materializationRoot, { recursive: true, force: true })
  })
  return client
}

test('HDSRC process host initializes as versioned read-only protocol surface', async t => {
  const client = await makeHost(t)
  const init = await client.request('initialize', { client: 'mrmic-nvcl', version: '0.14.0' })
  assert.equal(init.protocol, 'hdsrc-process/0.1')
  assert.equal(init.readOnly, true)
  assert.equal(init.host, 'hdsrc-local-process')
  assert.ok(Array.isArray(init.methods))
  for (const forbidden of ['write', 'patch', 'mutate', 'register', 'commit_state']) {
    assert.equal(init.methods.some(method => String(method).toLowerCase().includes(forbidden)), false, forbidden)
  }
})

test('HDSRC process host advertises read-only provider capabilities', async t => {
  const client = await makeHost(t)
  const capabilities = await client.request('capabilities', {})
  assert.equal(capabilities.schema, 'hdsrc-provider-capabilities/v1')
  assert.equal(capabilities.canonicalMutation, false)
  assert.equal(capabilities.partialRead, true)
  assert.equal(capabilities.oracleFallback, true)
})

test('HDSRC process state reads bind digest to HDS1 bytes and registry revision', async t => {
  const client = await makeHost(t)
  const bytes = await readFile(statePath)
  const expectedDigest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`
  const state = await client.request('state', {
    ref: 'hdsrc://state/state:fixture',
    principalId: 'principal:allowed',
  })
  assert.equal(state.schema, 'hdsrc-state-ref/v1')
  assert.equal(state.stateId, 'state:fixture')
  assert.equal(state.stateRevision, 3)
  assert.equal(state.stateDigest, expectedDigest)
  assert.equal(state.dimension, 4096)
  assert.equal(state.authority, 'hdsrc')
})

test('HDSRC process authorization is independent and valid denial does not kill the process', async t => {
  const client = await makeHost(t)
  await assert.rejects(
    () => client.request('state', {
      ref: 'hdsrc://state/state:fixture',
      principalId: 'principal:denied',
      allowHdsrcRead: true,
    }),
    error => error?.code === 'UNAUTHORIZED',
  )
  assert.equal(client.closed, false)
  const state = await client.request('state', {
    ref: 'hdsrc://state/state:fixture',
    principalId: 'principal:allowed',
  })
  assert.equal(state.stateId, 'state:fixture')
})

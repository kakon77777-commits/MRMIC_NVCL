import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { LocalProcessHdsrcProvider } from '../dist/packages/provider-hdsrc/src/local-process.js'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const hostScript = resolve('scripts/hdsrc_process_host.py')
const deadHostScript = resolve('tests/fixtures/hdsrc-dead-host.py')
const fixtureRoot = resolve('tests/fixtures')
const stubRuntime = resolve(fixtureRoot, 'hdsrc-stub-runtime')
const sourceState = resolve(fixtureRoot, 'hdsrc-state.hds1')
const stateRef = 'hdsrc://state/state:fixture'
const context = { principalId: 'principal:allowed', allowHdsrcRead: true, trustedMachine: true }

const request = {
  schema: 'hdsrc-materialization-request/v1',
  stateRef,
  workload: {
    schema: 'hdsrc-workload-hint/v1',
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'block',
    expectedSpan: 8,
    expectedReuse: 16,
    latencyClass: 'interactive',
  },
}

function testEnv() {
  const existingPythonPath = process.env.PYTHONPATH
  return {
    ...process.env,
    HDSRC_TEST_STUB_RUNTIME: '1',
    PYTHONPATH: existingPythonPath ? `${stubRuntime}${delimiter}${existingPythonPath}` : stubRuntime,
  }
}

async function makeIsolatedRuntime(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-hardening-'))
  const statePath = resolve(root, 'state.hds1')
  const registryPath = resolve(root, 'registry.json')
  const materializationRoot = resolve(root, 'materializations')
  await writeFile(statePath, await readFile(sourceState))
  await writeFile(registryPath, JSON.stringify({
    schema: 'hdsrc-local-registry/v1',
    states: [{
      stateId: 'state:fixture',
      stateRevision: 3,
      hds1Path: statePath,
      readPrincipals: ['principal:allowed'],
    }],
  }, null, 2))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, statePath, registryPath, materializationRoot }
}

function providerFor(runtime, host = hostScript) {
  return new LocalProcessHdsrcProvider({
    executable: python,
    hostScript: host,
    registry: runtime.registryPath,
    profileRoot: fixtureRoot,
    materializationRoot: runtime.materializationRoot,
    env: testEnv(),
    timeoutMs: 2000,
  })
}

test('persisted HDSRC materialization survives provider restart without changing identity', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const first = providerFor(runtime)
  const resolved = await first.materializeResolved(request, context)
  const machineBefore = await first.readResource(resolved.materialization.machineResourceUri, context)
  first.close()

  const second = providerFor(runtime)
  t.after(() => second.close())
  const manifest = await second.materialization(resolved.materializationRef, context)
  const machineAfter = await second.readResource(manifest.machineResourceUri, context)

  assert.deepEqual(manifest, resolved.materialization)
  assert.equal(machineAfter.uri, machineBefore.uri)
  assert.deepEqual(machineAfter.bytes, machineBefore.bytes)
})

test('changed canonical HDS1 bytes invalidate an existing materialization as stale', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const provider = providerFor(runtime)
  t.after(() => provider.close())
  const resolved = await provider.materializeResolved(request, context)
  const original = await readFile(runtime.statePath)
  await writeFile(runtime.statePath, new Uint8Array([...original, 45, 99, 104, 97, 110, 103, 101, 100]))

  await assert.rejects(
    () => provider.materialization(resolved.materializationRef, context),
    error => error?.code === 'STALE_STATE',
  )
})

test('tampered HMBT1 bytes fail closed on machine-resource read', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const provider = providerFor(runtime)
  t.after(() => provider.close())
  const resolved = await provider.materializeResolved(request, context)
  const identity = resolved.materialization.materializationId.slice('mat:'.length)
  const machinePath = resolve(runtime.materializationRoot, identity, 'machine.hmbt1.tif')
  const original = await readFile(machinePath)
  await writeFile(machinePath, new Uint8Array([...original, 0]))

  await assert.rejects(
    () => provider.readResource(resolved.materialization.machineResourceUri, context),
    error => error?.code === 'INTEGRITY_FAILURE',
  )
})

test('rebound manifest digest cannot authorize tampered HMBT1 bytes or a rewritten materialization identity', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const provider = providerFor(runtime)
  t.after(() => provider.close())
  const resolved = await provider.materializeResolved(request, context)
  const identity = resolved.materialization.materializationId.slice('mat:'.length)
  const folder = resolve(runtime.materializationRoot, identity)
  const machinePath = resolve(folder, 'machine.hmbt1.tif')
  const manifestPath = resolve(folder, 'manifest.json')
  const original = await readFile(machinePath)
  const tampered = new Uint8Array([...original, 0])
  await writeFile(machinePath, tampered)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.materializationDigest = `sha256:${createHash('sha256').update(tampered).digest('hex')}`
  manifest.materializationId = `mat:${'f'.repeat(64)}`
  manifest.machineResourceUri = `${resolved.materializationRef}/machine`
  manifest.previewResourceUri = `${resolved.materializationRef}/preview`
  await writeFile(manifestPath, JSON.stringify(manifest))

  await assert.rejects(
    () => provider.materialization(resolved.materializationRef, context),
    error => error?.code === 'INTEGRITY_FAILURE',
  )
  await assert.rejects(
    () => provider.readResource(resolved.materialization.machineResourceUri, context),
    error => error?.code === 'INTEGRITY_FAILURE',
  )
})

test('partial relation block-row read returns canonical relation data without returning the whole carrier', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const provider = providerFor(runtime)
  t.after(() => provider.close())
  const resolved = await provider.materializeResolved(request, context)
  const partial = await provider.readPartialRelationBlockRow(resolved.materializationRef, 0, context)

  assert.equal(partial.blockRow, 0)
  assert.ok(Number.isInteger(partial.srcStart) && partial.srcStart >= 0)
  assert.ok(Number.isInteger(partial.srcLength) && partial.srcLength > 0)
  assert.ok(Number.isInteger(partial.compressedBytesRead) && partial.compressedBytesRead > 0)
  assert.ok(Number.isInteger(partial.carrierBytes) && partial.carrierBytes >= partial.compressedBytesRead)
  assert.ok(Array.isArray(partial.relations))
  for (const relation of partial.relations) {
    assert.ok(Number.isInteger(relation.src))
    assert.ok(Number.isInteger(relation.dst))
    assert.equal(typeof relation.kind, 'string')
    assert.ok(Number.isInteger(relation.qsim))
  }
  const machine = await provider.readResource(resolved.materialization.machineResourceUri, context)
  assert.equal(partial.carrierBytes, machine.bytes.length)
  assert.ok(partial.compressedBytesRead < partial.carrierBytes)
})

test('dead HDSRC child process becomes PROVIDER_UNAVAILABLE instead of leaking transport errors', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const provider = providerFor(runtime, deadHostScript)
  t.after(() => provider.close())
  await assert.rejects(
    () => provider.capabilities(),
    error => error?.code === 'PROVIDER_UNAVAILABLE' && error?.retryable === true,
  )
})

test('materialization digest remains the SHA-256 of persisted machine-carrier bytes', async t => {
  const runtime = await makeIsolatedRuntime(t)
  const provider = providerFor(runtime)
  t.after(() => provider.close())
  const resolved = await provider.materializeResolved(request, context)
  const machine = await provider.readResource(resolved.materialization.machineResourceUri, context)
  const digest = `sha256:${createHash('sha256').update(machine.bytes).digest('hex')}`
  assert.equal(resolved.materialization.materializationDigest, digest)
  assert.equal((await readdir(runtime.materializationRoot)).length, 1)
})

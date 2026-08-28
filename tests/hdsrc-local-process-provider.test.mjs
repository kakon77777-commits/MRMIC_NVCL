import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, resolve } from 'node:path'
import { LocalProcessHdsrcProvider } from '../dist/packages/provider-hdsrc/src/local-process.js'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const hostScript = resolve('scripts/hdsrc_process_host.py')
const fixtureRoot = resolve('tests/fixtures')
const registry = resolve(fixtureRoot, 'hdsrc-local-registry.json')
const stubRuntime = resolve(fixtureRoot, 'hdsrc-stub-runtime')
const profileRoot = fixtureRoot
const stateRef = 'hdsrc://state/state:fixture'
const context = { principalId: 'principal:allowed', allowHdsrcRead: true, trustedMachine: true }

const fastRequest = {
  schema: 'hdsrc-materialization-request/v1',
  stateRef,
  workload: {
    schema: 'hdsrc-workload-hint/v1',
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'outgoing',
    expectedSpan: 8,
    expectedReuse: 16,
    latencyClass: 'interactive',
  },
}

const fallbackRequest = {
  schema: 'hdsrc-materialization-request/v1',
  stateRef,
  workload: {
    schema: 'hdsrc-workload-hint/v1',
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'block',
    expectedSpan: 63,
    expectedReuse: 1,
    latencyClass: 'interactive',
  },
}

async function makeProvider(t) {
  const materializationRoot = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-provider-'))
  const existingPythonPath = process.env.PYTHONPATH
  const env = {
    ...process.env,
    PYTHONPATH: existingPythonPath ? `${stubRuntime}${delimiter}${existingPythonPath}` : stubRuntime,
  }
  const provider = new LocalProcessHdsrcProvider({
    executable: python,
    hostScript,
    registry,
    profileRoot,
    materializationRoot,
    env,
    timeoutMs: 3000,
  })
  t.after(async () => {
    provider.close()
    await rm(materializationRoot, { recursive: true, force: true })
  })
  return { provider, materializationRoot }
}

test('local HDSRC provider preserves capabilities/state contracts across the process boundary', async t => {
  const { provider } = await makeProvider(t)
  const capabilities = await provider.capabilities()
  assert.equal(capabilities.schema, 'hdsrc-provider-capabilities/v1')
  assert.equal(capabilities.canonicalMutation, false)
  const state = await provider.state(stateRef, context)
  assert.equal(state.stateId, 'state:fixture')
  assert.equal(state.dimension, 4096)
})

test('HPCM2 fast planning returns a decision without persisting candidate carriers', async t => {
  const { provider, materializationRoot } = await makeProvider(t)
  const decision = await provider.materialize(fastRequest, context)
  assert.equal(decision.decision, 'fast_path')
  assert.equal(decision.confidence.requiresOracle, false)
  assert.equal(decision.selectedCarrier, 'HMBT1')
  assert.ok([8, 16, 32, 64].includes(decision.logicalScale))
  assert.deepEqual(await readdir(materializationRoot), [])
})

test('resolved fast path materializes exactly one selected HMBT1 resource', async t => {
  const { provider, materializationRoot } = await makeProvider(t)
  const result = await provider.materializeResolved(fastRequest, context)
  assert.equal(result.decision.decision, 'fast_path')
  assert.equal(result.oracleUsed, false)
  assert.equal(result.materialization.carrierProfile, 'HMBT1')
  assert.equal(result.materialization.logicalScale, result.decision.logicalScale)
  assert.match(result.materialization.materializationDigest, /^sha256:[0-9a-f]{64}$/)
  assert.match(result.materializationRef, /^hdsrc:\/\/state\/state:fixture\/materializations\//)
  assert.notEqual(result.materialization.machineResourceUri, result.materialization.previewResourceUri)
  assert.equal((await readdir(materializationRoot)).length, 1)
})

test('HPCM2 oracle fallback remains a defer decision and resolved path records oracle use', async t => {
  const { provider } = await makeProvider(t)
  const planned = await provider.materialize(fallbackRequest, context)
  assert.equal(planned.decision, 'oracle_fallback')
  assert.equal(planned.confidence.requiresOracle, true)

  const resolved = await provider.materializeResolved(fallbackRequest, context)
  assert.equal(resolved.decision.decision, 'oracle_fallback')
  assert.equal(resolved.oracleUsed, true)
  assert.equal(resolved.materialization.carrierProfile, 'HMBT1')
  assert.ok([8, 16, 32, 64].includes(resolved.materialization.logicalScale))
})

test('local HDSRC provider enforces MRMIC-side read gating before process access', async t => {
  const { provider } = await makeProvider(t)
  await assert.rejects(
    () => provider.state(stateRef, { principalId: 'principal:allowed', allowHdsrcRead: false }),
    error => error?.code === 'UNAUTHORIZED',
  )
})

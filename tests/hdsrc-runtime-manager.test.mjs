import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { HdsrcProviderError } from '../dist/packages/provider-hdsrc/src/index.js'
import { HdsrcLocalProcessProviderError } from '../dist/packages/provider-hdsrc/src/local-process.js'
import { HdsrcRuntimeManager } from '../dist/packages/provider-hdsrc/src/runtime-manager.js'

const context = { principalId: 'principal:manager', allowHdsrcRead: true }
const stateRef = 'hdsrc://state/state:manager'
const stateValue = {
  schema: 'hdsrc-state-ref/v1',
  stateId: 'state:manager',
  stateRevision: 9,
  stateDigest: `sha256:${'a'.repeat(64)}`,
  dimension: 4096,
  authority: 'hdsrc',
}
const capabilities = {
  schema: 'hdsrc-provider-capabilities/v1',
  providerVersion: 'manager-fixture',
  stateProfiles: ['HDSRC-SymbolicState'],
  carrierProfiles: ['HMBT1'],
  planningProfiles: ['HPCM2'],
  observationModes: ['human_preview', 'machine_carrier', 'structured_manifest'],
  partialRead: true,
  oracleFallback: true,
  canonicalMutation: false,
}
const request = {
  schema: 'hdsrc-materialization-request/v1',
  stateRef,
  workload: {
    schema: 'hdsrc-workload-hint/v1',
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'block',
    expectedSpan: 8,
    expectedReuse: 4,
    latencyClass: 'interactive',
  },
}

async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), 'mrmic-hdsrc-manager-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const binding = resolve(root, 'runtime-binding.json')
  await writeFile(binding, JSON.stringify({
    schema: 'hdsrc-runtime-binding/v1',
    runtimeId: 'hdsrc:test-manager',
    protocol: 'hdsrc-process/0.1',
    executable: './python',
    hostScript: './host.py',
    registry: './registry.json',
    profileRoot: './profile',
    materializationRoot: './materializations',
  }), 'utf8')
  return { root, binding }
}

function transport(message = 'transport failed') {
  return new HdsrcLocalProcessProviderError('PROVIDER_UNAVAILABLE', message, true, 'transport')
}
function contract(message = 'contract failed') {
  return new HdsrcLocalProcessProviderError('INTEGRITY_FAILURE', message, false, 'contract')
}
function remote(code = 'STALE_STATE', message = 'remote domain error') {
  return new HdsrcLocalProcessProviderError(code, message, code === 'STALE_STATE', 'remote_domain')
}

class FakeProvider {
  constructor(plan = {}) {
    this.plan = plan
    this.closed = false
    this.calls = []
  }
  close() { this.closed = true; this.calls.push('close') }
  async #value(name, fallback) {
    this.calls.push(name)
    const value = this.plan[name]
    if (value instanceof Error) throw value
    if (typeof value === 'function') return value()
    return value ?? fallback
  }
  async capabilities() { return this.#value('capabilities', capabilities) }
  async state() { return this.#value('state', stateValue) }
  async materialize() {
    return this.#value('materialize', {
      schema: 'hdsrc-materialization-decision/v1',
      decision: 'fast_path', selectedCarrier: 'HMBT1', logicalScale: 16,
      confidence: { mode: 'empirical', requiresOracle: false },
    })
  }
  async materializeResolved() {
    return this.#value('materializeResolved', {
      decision: {
        schema: 'hdsrc-materialization-decision/v1',
        decision: 'fast_path', selectedCarrier: 'HMBT1', logicalScale: 16,
        confidence: { mode: 'empirical', requiresOracle: false },
      },
      materializationRef: 'hdsrc://state/state:manager/materializations/mat:test',
      materialization: {
        schema: 'hdsrc-materialization/v1', materializationId: 'mat:test',
        stateId: 'state:manager', stateRevision: 9, stateDigest: `sha256:${'a'.repeat(64)}`,
        materializationDigest: `sha256:${'b'.repeat(64)}`, carrierProfile: 'HMBT1',
        spatializationId: 'RCM_PP', logicalScale: 16, workloadDigest: `sha256:${'c'.repeat(64)}`,
        machineResourceUri: 'hdsrc://state/state:manager/materializations/mat:test/machine',
        previewResourceUri: 'hdsrc://state/state:manager/materializations/mat:test/preview',
      },
      oracleUsed: false,
    })
  }
  async materialization() { return this.#value('materialization', { schema: 'hdsrc-materialization/v1' }) }
  async readResource() { return this.#value('readResource', { uri: 'hdsrc://resource', mimeType: 'application/octet-stream', bytes: new Uint8Array([1]) }) }
  async readPartialRelationBlockRow() { return this.#value('readPartialRelationBlockRow', { blockRow: 0, srcStart: 0, srcLength: 16, relations: [], compressedBytesRead: 1, carrierBytes: 10 }) }
}

function factoryFrom(plans) {
  const created = []
  const factory = () => {
    const provider = new FakeProvider(plans[created.length] ?? {})
    created.push(provider)
    return provider
  }
  return { factory, created }
}

test('runtime discovery is side-effect free and does not start a provider', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{}])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })
  assert.equal(manager.status().state, 'undiscovered')
  await manager.discover()
  assert.equal(manager.status().state, 'discovered')
  assert.equal(manager.status().runtimeEpoch, 0)
  assert.equal(f.created.length, 0)
  manager.stop()
})

test('concurrent first operations share one lazy provider start and one runtime epoch', async t => {
  const { binding } = await fixture(t)
  let release
  const gate = new Promise(resolveGate => { release = resolveGate })
  const f = factoryFrom([{ capabilities: async () => { await gate; return capabilities } }])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })

  const a = manager.state(stateRef, context)
  const b = manager.state(stateRef, context)
  await new Promise(resolveWait => setTimeout(resolveWait, 5))
  assert.equal(f.created.length, 1)
  release()
  const [left, right] = await Promise.all([a, b])
  assert.deepEqual(left, stateValue)
  assert.deepEqual(right, stateValue)
  assert.equal(manager.status().state, 'ready')
  assert.equal(manager.status().runtimeEpoch, 1)
  assert.equal(f.created.length, 1)
  manager.stop()
})

test('safe read retries once after transport failure and increments runtime epoch without changing HDSRC identity', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{ state: transport('first child died') }, { state: stateValue }])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })

  const result = await manager.state(stateRef, context)
  assert.deepEqual(result, stateValue)
  assert.equal(f.created.length, 2)
  assert.equal(f.created[0].closed, true)
  assert.equal(manager.status().runtimeEpoch, 2)
  assert.equal(manager.status().state, 'ready')
  assert.equal(result.stateRevision, 9)
  assert.equal(result.stateDigest, stateValue.stateDigest)
  manager.stop()
})

test('contract failure degrades the manager and never auto-restarts the same operation', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{ state: contract('bad peer') }, {}])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })

  await assert.rejects(() => manager.state(stateRef, context), error => error?.origin === 'contract')
  assert.equal(manager.status().state, 'degraded')
  assert.equal(f.created.length, 1)
  assert.equal(f.created[0].closed, true)
  manager.stop()
})

test('remote domain failure propagates while the healthy process remains ready', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{ state: remote('STALE_STATE') }])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })

  await assert.rejects(() => manager.state(stateRef, context), error => error?.origin === 'remote_domain' && error?.code === 'STALE_STATE')
  assert.equal(manager.status().state, 'ready')
  assert.equal(manager.status().runtimeEpoch, 1)
  assert.equal(f.created.length, 1)
  assert.equal(f.created[0].closed, false)
  manager.stop()
})

test('materializeResolved is not automatically replayed across a fatal transport boundary', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{ materializeResolved: transport('materialize child died') }, {}])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })

  await assert.rejects(() => manager.materializeResolved(request, context), error => error?.origin === 'transport')
  assert.equal(f.created.length, 1)
  assert.equal(manager.status().state, 'degraded')

  const explicitRetry = await manager.materializeResolved(request, context)
  assert.equal(explicitRetry.oracleUsed, false)
  assert.equal(f.created.length, 2)
  assert.equal(manager.status().runtimeEpoch, 2)
  assert.equal(manager.status().state, 'ready')
  manager.stop()
})

test('one operation never enters an unbounded transport restart loop', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{ state: transport('first') }, { state: transport('second') }, {}])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })

  await assert.rejects(() => manager.state(stateRef, context), error => error?.origin === 'transport')
  assert.equal(f.created.length, 2)
  assert.equal(manager.status().state, 'degraded')
  assert.equal(manager.status().runtimeEpoch, 2)
  manager.stop()
})

test('authorization failure occurs before discovery or provider construction', async () => {
  const f = factoryFrom([{}])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: '/definitely/not/a/binding.json' }, providerFactory: f.factory })

  await assert.rejects(
    () => manager.state(stateRef, { principalId: 'principal:no', allowHdsrcRead: false }),
    error => error instanceof HdsrcProviderError && error.code === 'UNAUTHORIZED',
  )
  assert.equal(manager.status().state, 'undiscovered')
  assert.equal(f.created.length, 0)
  manager.stop()
})

test('stop is terminal and later operations cannot silently create a new child', async t => {
  const { binding } = await fixture(t)
  const f = factoryFrom([{}])
  const manager = new HdsrcRuntimeManager({ discovery: { explicitBindingPath: binding }, providerFactory: f.factory })
  await manager.state(stateRef, context)
  manager.stop()
  assert.equal(manager.status().state, 'stopped')
  assert.equal(f.created[0].closed, true)

  await assert.rejects(() => manager.state(stateRef, context), error => error?.code === 'PROVIDER_UNAVAILABLE')
  assert.equal(f.created.length, 1)
})

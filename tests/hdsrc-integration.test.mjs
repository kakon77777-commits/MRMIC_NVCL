import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const CONTRACT_ROOT = 'contracts/hdsrc-integration'

const schemaFiles = [
  'hdsrc-provider-capabilities-v1.schema.json',
  'hdsrc-state-ref-v1.schema.json',
  'hdsrc-workload-hint-v1.schema.json',
  'hdsrc-materialization-request-v1.schema.json',
  'hdsrc-materialization-decision-v1.schema.json',
  'hdsrc-materialization-v1.schema.json',
  'hdsrc-provider-error-v1.schema.json',
]

const expectedIds = {
  'hdsrc-provider-capabilities-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-provider-capabilities-v1.schema.json',
  'hdsrc-state-ref-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-state-ref-v1.schema.json',
  'hdsrc-workload-hint-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-workload-hint-v1.schema.json',
  'hdsrc-materialization-request-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-materialization-request-v1.schema.json',
  'hdsrc-materialization-decision-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-materialization-decision-v1.schema.json',
  'hdsrc-materialization-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-materialization-v1.schema.json',
  'hdsrc-provider-error-v1.schema.json': 'https://evemisslab.com/schemas/hdsrc-provider-error-v1.schema.json',
}

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const providerModule = () => import('../dist/packages/provider-hdsrc/src/index.js')

test('HDSRC integration publishes seven versioned draft-2020-12 schemas', async () => {
  for (const name of schemaFiles) {
    const schema = await readJson(`${CONTRACT_ROOT}/${name}`)
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema', name)
    assert.equal(schema.$id, expectedIds[name], name)
    assert.equal(schema.type, 'object', name)
  }
})

test('HDSRC capability contract is read-only and advertises distinct observation modes', async () => {
  const capabilities = await readJson(`${CONTRACT_ROOT}/examples/provider-capabilities.json`)
  assert.equal(capabilities.schema, 'hdsrc-provider-capabilities/v1')
  assert.equal(capabilities.canonicalMutation, false)
  assert.equal(capabilities.partialRead, true)
  assert.equal(capabilities.oracleFallback, true)
  assert.deepEqual(
    new Set(capabilities.observationModes),
    new Set(['human_preview', 'machine_carrier', 'structured_manifest']),
  )
})

test('HDSRC state and materialization examples preserve authority and dual resource identity', async () => {
  const state = await readJson(`${CONTRACT_ROOT}/examples/state-ref.json`)
  const materialization = await readJson(`${CONTRACT_ROOT}/examples/materialization.json`)
  assert.equal(state.schema, 'hdsrc-state-ref/v1')
  assert.equal(state.authority, 'hdsrc')
  assert.equal(materialization.schema, 'hdsrc-materialization/v1')
  assert.equal(materialization.stateId, state.stateId)
  assert.equal(materialization.stateRevision, state.stateRevision)
  assert.equal(materialization.stateDigest, state.stateDigest)
  assert.match(materialization.previewResourceUri, /^hdsrc:\/\//)
  assert.match(materialization.machineResourceUri, /^hdsrc:\/\//)
  assert.notEqual(materialization.previewResourceUri, materialization.machineResourceUri)
})

test('HDSRC fast-path and oracle-fallback examples keep defer distinct from integrity failure', async () => {
  const fast = await readJson(`${CONTRACT_ROOT}/examples/materialization-decision-fast.json`)
  const defer = await readJson(`${CONTRACT_ROOT}/examples/materialization-decision-oracle.json`)
  assert.equal(fast.schema, 'hdsrc-materialization-decision/v1')
  assert.equal(fast.decision, 'fast_path')
  assert.equal(fast.confidence.requiresOracle, false)
  assert.equal(defer.decision, 'oracle_fallback')
  assert.equal(defer.confidence.requiresOracle, true)
  assert.equal(defer.confidence.reason, 'outside_current_trust_region')
})

test('public HDSRC positive examples contain no credential-bearing fields or secrets', async () => {
  const positive = [
    'provider-capabilities.json',
    'state-ref.json',
    'workload-hint.json',
    'materialization-request.json',
    'materialization-decision-fast.json',
    'materialization-decision-oracle.json',
    'materialization.json',
    'provider-error.json',
  ]
  for (const name of positive) {
    const text = await readFile(`${CONTRACT_ROOT}/examples/${name}`, 'utf8')
    assert.equal(/"(?:authToken|apiKey|bearerToken|password|secret)"\s*:/i.test(text), false, name)
    assert.equal(/sk-[A-Za-z0-9_-]{12,}/.test(text), false, name)
  }
})

test('negative examples explicitly exercise fail-closed contract boundaries', async () => {
  const mutation = await readJson(`${CONTRACT_ROOT}/examples/invalid-capabilities-mutation.json`)
  const resource = await readJson(`${CONTRACT_ROOT}/examples/invalid-materialization-resource-uri.json`)
  assert.equal(mutation.canonicalMutation, true)
  assert.equal(resource.machineResourceUri.startsWith('hdsrc://'), false)
})

test('provider-hdsrc validators accept canonical fixtures and reject malformed authority', async () => {
  const { assertHdsrcCapabilities, assertHdsrcStateRef, assertHdsrcMaterialization } = await providerModule()
  const capabilities = await readJson(`${CONTRACT_ROOT}/examples/provider-capabilities.json`)
  const state = await readJson(`${CONTRACT_ROOT}/examples/state-ref.json`)
  const materialization = await readJson(`${CONTRACT_ROOT}/examples/materialization.json`)
  assert.deepEqual(assertHdsrcCapabilities(capabilities), capabilities)
  assert.deepEqual(assertHdsrcStateRef(state), state)
  assert.deepEqual(assertHdsrcMaterialization(materialization), materialization)
  assert.throws(() => assertHdsrcCapabilities({ ...capabilities, canonicalMutation: true }), /canonicalMutation/i)
  assert.throws(() => assertHdsrcStateRef({ ...state, authority: 'canvas' }), /authority/i)
  assert.throws(() => assertHdsrcMaterialization({ ...materialization, machineResourceUri: 'https://example.invalid/machine' }), /machineResourceUri/i)
})

test('materialization freshness fails closed on state revision or digest mismatch', async () => {
  const { assertMaterializationFresh } = await providerModule()
  const state = await readJson(`${CONTRACT_ROOT}/examples/state-ref.json`)
  const materialization = await readJson(`${CONTRACT_ROOT}/examples/materialization.json`)
  assert.doesNotThrow(() => assertMaterializationFresh(state, materialization))
  assert.throws(
    () => assertMaterializationFresh({ ...state, stateRevision: state.stateRevision + 1 }, materialization),
    /revision/i,
  )
  assert.throws(
    () => assertMaterializationFresh({ ...state, stateDigest: `sha256:${'d'.repeat(64)}` }, materialization),
    /digest/i,
  )
})

test('deterministic fake HDSRC provider exposes read-only capability and deterministic fast path', async () => {
  const { DeterministicFakeHdsrcProvider } = await providerModule()
  const provider = new DeterministicFakeHdsrcProvider()
  const context = { principalId: 'principal:test', allowHdsrcRead: true }
  const capabilities = await provider.capabilities()
  assert.equal(capabilities.canonicalMutation, false)
  const state = await provider.state('hdsrc://state/state:demo-4096', context)
  assert.equal(state.stateId, 'state:demo-4096')
  const decision = await provider.materialize({
    schema: 'hdsrc-materialization-request/v1',
    stateRef: 'hdsrc://state/state:demo-4096',
    workload: {
      schema: 'hdsrc-workload-hint/v1',
      goalClass: 'relation_inspection',
      observationMode: 'machine_carrier',
      queryDirection: 'outgoing',
      expectedSpan: 16,
      expectedReuse: 32,
      latencyClass: 'interactive',
    },
  }, context)
  assert.equal(decision.decision, 'fast_path')
  assert.equal(decision.confidence.requiresOracle, false)
  const materialization = await provider.materialization('hdsrc://state/state:demo-4096/materializations/mat:demo-4096-hmbt1-32', context)
  assert.equal(materialization.stateDigest, state.stateDigest)
  assert.notEqual(materialization.previewResourceUri, materialization.machineResourceUri)
})

test('fake HDSRC provider preserves oracle fallback as defer and denies unauthorized reads', async () => {
  const { DeterministicFakeHdsrcProvider, HdsrcProviderError } = await providerModule()
  const provider = new DeterministicFakeHdsrcProvider()
  const allowed = { principalId: 'principal:test', allowHdsrcRead: true }
  const denied = { principalId: 'principal:test', allowHdsrcRead: false }
  const decision = await provider.materialize({
    schema: 'hdsrc-materialization-request/v1',
    stateRef: 'hdsrc://state/state:demo-4096',
    workload: {
      schema: 'hdsrc-workload-hint/v1',
      goalClass: 'uncertain_probe',
      observationMode: 'structured_manifest',
      expectedSpan: 16,
      expectedReuse: 1,
      latencyClass: 'interactive',
    },
  }, allowed)
  assert.equal(decision.decision, 'oracle_fallback')
  assert.equal(decision.confidence.requiresOracle, true)
  await assert.rejects(
    () => provider.state('hdsrc://state/state:demo-4096', denied),
    error => error instanceof HdsrcProviderError && error.code === 'UNAUTHORIZED',
  )
})

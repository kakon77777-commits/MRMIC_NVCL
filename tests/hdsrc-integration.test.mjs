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

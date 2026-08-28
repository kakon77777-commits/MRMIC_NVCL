import test from 'node:test'
import assert from 'node:assert/strict'
import { HdsrcProviderError } from '../dist/packages/provider-hdsrc/src/index.js'
import {
  assertHdsrcObservationIntent,
  intentToMaterializationRequest,
  routeHdsrcObservation,
} from '../dist/packages/provider-hdsrc/src/observation-router.js'

const stateRef = 'hdsrc://state/state:router'
const context = {
  principalId: 'principal:router',
  allowHdsrcRead: true,
  trustedStructured: true,
  trustedMachine: true,
}
const decision = {
  schema: 'hdsrc-materialization-decision/v1',
  decision: 'fast_path',
  selectedCarrier: 'HMBT1',
  logicalScale: 16,
  confidence: { mode: 'empirical', requiresOracle: false },
}
const materialization = {
  schema: 'hdsrc-materialization/v1',
  materializationId: 'mat:router',
  stateId: 'state:router',
  stateRevision: 3,
  stateDigest: `sha256:${'a'.repeat(64)}`,
  materializationDigest: `sha256:${'b'.repeat(64)}`,
  carrierProfile: 'HMBT1',
  spatializationId: 'RCM_PP',
  logicalScale: 16,
  workloadDigest: `sha256:${'c'.repeat(64)}`,
  machineResourceUri: 'hdsrc://state/state:router/materializations/mat:router/machine',
  previewResourceUri: 'hdsrc://state/state:router/materializations/mat:router/preview',
}
const resolved = {
  decision,
  materializationRef: 'hdsrc://state/state:router/materializations/mat:router',
  materialization,
  oracleUsed: false,
}

function intent(overrides = {}) {
  return {
    schema: 'hdsrc-observation-intent/v1',
    stateRef,
    goalClass: 'relation_inspection',
    observationMode: 'machine_carrier',
    queryDirection: 'block',
    expectedSpan: 16,
    expectedReuse: 8,
    latencyClass: 'interactive',
    ...overrides,
  }
}

function spyManager(overrides = {}) {
  const calls = []
  let runtimeEpoch = overrides.runtimeEpoch ?? 7
  const manager = {
    calls,
    status() { return { state: 'ready', runtimeEpoch, runtimeId: 'hdsrc:router' } },
    async materializeResolved(request, access) {
      calls.push({ method: 'materializeResolved', request, access })
      if (overrides.materializeResolved instanceof Error) throw overrides.materializeResolved
      return overrides.materializeResolved ?? resolved
    },
    async readResource(uri, access) {
      calls.push({ method: 'readResource', uri, access })
      if (overrides.readResource instanceof Error) throw overrides.readResource
      if (overrides.readResourceRuntimeEpoch !== undefined) runtimeEpoch = overrides.readResourceRuntimeEpoch
      if (overrides.readResource) return overrides.readResource
      const preview = uri.endsWith('/preview')
      return {
        uri,
        mimeType: preview ? 'image/png' : 'application/x-hdsrc-hmbt1',
        bytes: new Uint8Array(preview ? [137, 80, 78, 71] : [72, 77, 66, 84, 49]),
      }
    },
    async readPartialRelationBlockRow(ref, blockRow, access) {
      calls.push({ method: 'readPartialRelationBlockRow', ref, blockRow, access })
      if (overrides.readPartialRelationBlockRow instanceof Error) throw overrides.readPartialRelationBlockRow
      if (overrides.partialReadRuntimeEpoch !== undefined) runtimeEpoch = overrides.partialReadRuntimeEpoch
      return overrides.readPartialRelationBlockRow ?? {
        blockRow,
        srcStart: 0,
        srcLength: 16,
        relations: [{ src: 0, dst: 2, kind: 'knn', qsim: 9000 }],
        compressedBytesRead: 211,
        carrierBytes: 50000,
      }
    },
  }
  return manager
}

test('observation intent rejects partial relation requests outside machine-carrier block mode', () => {
  assert.throws(() => assertHdsrcObservationIntent(intent({
    observationMode: 'human_preview',
    partialRelationBlockRow: 0,
  })))
  assert.throws(() => assertHdsrcObservationIntent(intent({
    queryDirection: 'outgoing',
    partialRelationBlockRow: 0,
  })))
})

test('observation intent maps exactly to the existing HDSRC workload contract without carrier policy', () => {
  const request = intentToMaterializationRequest(assertHdsrcObservationIntent(intent()))
  assert.deepEqual(request, {
    schema: 'hdsrc-materialization-request/v1',
    stateRef,
    workload: {
      schema: 'hdsrc-workload-hint/v1',
      goalClass: 'relation_inspection',
      observationMode: 'machine_carrier',
      queryDirection: 'block',
      expectedSpan: 16,
      expectedReuse: 8,
      latencyClass: 'interactive',
    },
  })
  for (const forbidden of ['logicalScale', 'blockSize', 'spatializationId', 'carrierProfile', 'algorithm']) {
    assert.equal(forbidden in request.workload, false)
  }
})

test('MRMIC read authorization rejects before any runtime-manager access', async () => {
  const manager = spyManager()
  await assert.rejects(
    () => routeHdsrcObservation(intent({ observationMode: 'human_preview' }), {
      principalId: 'principal:no', allowHdsrcRead: false,
    }, manager),
    error => error instanceof HdsrcProviderError && error.code === 'UNAUTHORIZED',
  )
  assert.equal(manager.calls.length, 0)
})

test('structured and machine trust gates reject before any runtime-manager access', async () => {
  const structured = spyManager()
  await assert.rejects(
    () => routeHdsrcObservation(intent({ observationMode: 'structured_manifest', partialRelationBlockRow: undefined }), {
      principalId: 'principal:no-structured', allowHdsrcRead: true, trustedStructured: false,
    }, structured),
    error => error?.code === 'UNAUTHORIZED',
  )
  assert.equal(structured.calls.length, 0)

  const machine = spyManager()
  await assert.rejects(
    () => routeHdsrcObservation(intent(), {
      principalId: 'principal:no-machine', allowHdsrcRead: true, trustedMachine: false,
    }, machine),
    error => error?.code === 'UNAUTHORIZED',
  )
  assert.equal(machine.calls.length, 0)
})

test('human preview route returns only preview payload and bounded routing evidence', async () => {
  const manager = spyManager()
  const result = await routeHdsrcObservation(intent({
    observationMode: 'human_preview',
    queryDirection: 'block',
    partialRelationBlockRow: undefined,
  }), { principalId: 'principal:human', allowHdsrcRead: true }, manager)

  assert.equal(result.mode, 'human_preview')
  assert.equal(result.resource.uri, materialization.previewResourceUri)
  assert.equal(result.resource.mimeType, 'image/png')
  assert.equal(result.runtimeEpoch, 7)
  assert.equal(result.decision.decision, 'fast_path')
  assert.deepEqual(manager.calls.map(call => call.method), ['materializeResolved', 'readResource'])
  assert.equal('materialization' in result, false)
  assert.equal('principalId' in result, false)
  assert.equal('runtimeDescriptor' in result, false)
})

test('structured manifest route returns manifest without reading resource bytes', async () => {
  const manager = spyManager()
  const result = await routeHdsrcObservation(intent({
    observationMode: 'structured_manifest',
    partialRelationBlockRow: undefined,
  }), context, manager)

  assert.equal(result.mode, 'structured_manifest')
  assert.deepEqual(result.materialization, materialization)
  assert.equal(result.runtimeEpoch, 7)
  assert.deepEqual(manager.calls.map(call => call.method), ['materializeResolved'])
  assert.equal('resource' in result, false)
})

test('full machine route reads the machine resource and never aliases preview data', async () => {
  const manager = spyManager()
  const result = await routeHdsrcObservation(intent(), context, manager)
  assert.equal(result.mode, 'machine_carrier')
  assert.equal(result.resource.uri, materialization.machineResourceUri)
  assert.equal(result.resource.mimeType, 'application/x-hdsrc-hmbt1')
  assert.deepEqual(manager.calls.map(call => call.method), ['materializeResolved', 'readResource'])
})

test('partial relation route uses the canonical partial reader without a full resource fetch', async () => {
  const manager = spyManager()
  const result = await routeHdsrcObservation(intent({ partialRelationBlockRow: 2 }), context, manager)
  assert.equal(result.mode, 'partial_relation_block_row')
  assert.equal(result.partial.blockRow, 2)
  assert.ok(result.partial.compressedBytesRead < result.partial.carrierBytes)
  assert.deepEqual(manager.calls.map(call => call.method), ['materializeResolved', 'readPartialRelationBlockRow'])
})

test('routing evidence reports the final runtime epoch after a safe machine resource read restarts the runtime', async () => {
  const manager = spyManager({ runtimeEpoch: 1, readResourceRuntimeEpoch: 2 })
  const result = await routeHdsrcObservation(intent(), context, manager)
  assert.equal(result.mode, 'machine_carrier')
  assert.equal(result.runtimeEpoch, 2)
  assert.deepEqual(manager.calls.map(call => call.method), ['materializeResolved', 'readResource'])
})

test('partial routing evidence reports the final runtime epoch after a safe partial read restarts the runtime', async () => {
  const manager = spyManager({ runtimeEpoch: 3, partialReadRuntimeEpoch: 4 })
  const result = await routeHdsrcObservation(intent({ partialRelationBlockRow: 2 }), context, manager)
  assert.equal(result.mode, 'partial_relation_block_row')
  assert.equal(result.runtimeEpoch, 4)
  assert.deepEqual(manager.calls.map(call => call.method), ['materializeResolved', 'readPartialRelationBlockRow'])
})

test('oracle fallback remains routing evidence rather than a process failure', async () => {
  const oracleDecision = {
    schema: 'hdsrc-materialization-decision/v1',
    decision: 'oracle_fallback',
    confidence: { mode: 'empirical', requiresOracle: true, reason: 'outside_current_trust_region' },
  }
  const manager = spyManager({ materializeResolved: { ...resolved, decision: oracleDecision, oracleUsed: true } })
  const result = await routeHdsrcObservation(intent({ observationMode: 'structured_manifest', partialRelationBlockRow: undefined }), context, manager)
  assert.equal(result.decision.decision, 'oracle_fallback')
  assert.equal(result.oracleUsed, true)
})

test('stale and integrity errors propagate without silent substitution', async () => {
  const stale = spyManager({ materializeResolved: new HdsrcProviderError('STALE_STATE', 'stale', true) })
  await assert.rejects(() => routeHdsrcObservation(intent(), context, stale), error => error?.code === 'STALE_STATE')
  assert.equal(stale.calls.length, 1)

  const integrity = spyManager({ materializeResolved: new HdsrcProviderError('INTEGRITY_FAILURE', 'bad') })
  await assert.rejects(() => routeHdsrcObservation(intent(), context, integrity), error => error?.code === 'INTEGRITY_FAILURE' && error.retryable === false)
  assert.equal(integrity.calls.length, 1)
})

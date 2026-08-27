import test from 'node:test'
import assert from 'node:assert/strict'

const providerModule = () => import('../dist/packages/provider-hdsrc/src/index.js')

const NOW = '2026-08-27T00:00:00.000Z'
const ACTOR = { actorType: 'agent', actorId: 'agent:observation-test' }
const TRANSFORM = { x: 0, y: 0, width: 320, height: 180, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1 }

async function fixture() {
  const { DeterministicFakeHdsrcProvider, createHdsrcMaterializationPortal, HdsrcObservationBridge } = await providerModule()
  const provider = new DeterministicFakeHdsrcProvider()
  const read = { principalId: 'principal:test', allowHdsrcRead: true }
  const materialization = await provider.materialization(
    'hdsrc://state/state:demo-4096/materializations/mat:demo-4096-hmbt1-32',
    read,
  )
  const portal = createHdsrcMaterializationPortal({
    canvasObjectId: 'object:hdsrc-observation',
    canvasId: 'canvas:root',
    portalId: 'portal:hdsrc-observation',
    pmwWorkspaceId: 'workspace:test',
    title: 'HDSRC observation fixture',
    transform: TRANSFORM,
    actor: ACTOR,
    createdAt: NOW,
    materialization,
  })
  return { provider, portal, bridge: new HdsrcObservationBridge(provider), materialization }
}

test('human preview lane exposes only approved raster resource data', async () => {
  const { bridge, portal, materialization } = await fixture()
  const result = await bridge.observe(portal, 'human_preview', {
    principalId: 'principal:test',
    allowHdsrcRead: true,
  })
  assert.equal(result.mode, 'human_preview')
  assert.equal(result.resource.uri, materialization.previewResourceUri)
  assert.equal(result.resource.mimeType, 'image/png')
  assert.ok(result.resource.bytes instanceof Uint8Array)
  const serialized = JSON.stringify(result)
  for (const forbidden of ['stateDigest', 'spatializationId', 'machineResourceUri', 'principalId', 'canonicalMutation']) {
    assert.equal(serialized.includes(forbidden), false, forbidden)
  }
})

test('structured manifest lane requires explicit trusted structured access', async () => {
  const { bridge, portal, materialization } = await fixture()
  await assert.rejects(
    () => bridge.observe(portal, 'structured_manifest', {
      principalId: 'principal:test',
      allowHdsrcRead: true,
      trustedStructured: false,
    }),
    error => error?.code === 'UNAUTHORIZED',
  )
  const result = await bridge.observe(portal, 'structured_manifest', {
    principalId: 'principal:test',
    allowHdsrcRead: true,
    trustedStructured: true,
  })
  assert.equal(result.mode, 'structured_manifest')
  assert.deepEqual(result.materialization, materialization)
})

test('machine carrier lane requires trusted machine access and never aliases the preview', async () => {
  const { bridge, portal, materialization } = await fixture()
  await assert.rejects(
    () => bridge.observe(portal, 'machine_carrier', {
      principalId: 'principal:test',
      allowHdsrcRead: true,
      trustedMachine: false,
    }),
    error => error?.code === 'UNAUTHORIZED',
  )
  const result = await bridge.observe(portal, 'machine_carrier', {
    principalId: 'principal:test',
    allowHdsrcRead: true,
    trustedMachine: true,
  })
  assert.equal(result.mode, 'machine_carrier')
  assert.equal(result.resource.uri, materialization.machineResourceUri)
  assert.equal(result.resource.mimeType, 'application/x-hdsrc-hmbt1')
  assert.notEqual(result.resource.uri, materialization.previewResourceUri)
  assert.ok(result.resource.bytes.length > 0)
})

test('HDSRC observation bridge is read-only and does not expose canonical mutation methods', async () => {
  const { bridge } = await fixture()
  for (const method of ['mutate', 'patchState', 'writeState', 'applyMutation', 'commitState']) {
    assert.equal(typeof bridge[method], 'undefined', method)
  }
})

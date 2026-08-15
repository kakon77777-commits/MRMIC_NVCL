import test from 'node:test'
import assert from 'node:assert/strict'
import { resourcePortalDescriptor } from '../dist/packages/canvas-schema/src/index.js'
import {
  CtclClient,
  createCtclInstantPortal,
  createCtclTemporalReference,
} from '../dist/packages/provider-ctcl/src/index.js'

const actor = { actorType: 'system', actorId: 'pmw-fabric' }

function instant(overrides = {}) {
  return {
    id: 'ctcl:instant:11111111-2222-3333-4444-555555555555',
    unix_ns: '1786784400000000000',
    reference_timescale: 'utc',
    registered_at: '2026-08-15T09:00:00.000Z',
    label: 'PMW decision receipt',
    meta: { pmw_event_id: 'event-1' },
    from_wall_clock: true,
    signature: { algorithm: 'Ed25519', signature: 'test-signature' },
    retrieve: '/v1/instant/ctcl:instant:11111111-2222-3333-4444-555555555555',
    share: 'https://commoninstant.org/i/11111111-2222-3333-4444-555555555555',
    encodings: { rfc3339: '2026-08-15T09:00:00Z', unix_ns: '1786784400000000000' },
    timescales: { utc: '2026-08-15T09:00:00Z' },
    ...overrides,
  }
}

test('CTCL registered instant becomes an optional stable temporal Canvas portal', () => {
  const object = createCtclInstantPortal({
    record: instant(), portalId: 'instant-decision', canvasId: 'root',
    pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task', actor,
    createdAt: '2026-08-15T09:00:00.000Z',
  })
  assert.equal(object.content.resourceUri.startsWith('ctcl://instant/'), true)
  assert.deepEqual(resourcePortalDescriptor(object), {
    portalId: 'instant-decision', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task',
    provider: 'ctcl', resourceKind: 'temporal_instant',
    providerResourceId: instant().id, displayMode: 'summary', interactionMode: 'inspect',
  })
  assert.equal(object.metadata.providerRef.unixNs, '1786784400000000000')
})

test('CTCL provenance reference links an event to a common instant without becoming the event ledger', () => {
  const ref = createCtclTemporalReference(instant(), {
    eventId: 'decision-receipt-1', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task',
    actorSemanticId: 'agent:claude-main', provider: 'ai_board', providerResourceId: 'msg-root', operation: 'ACTION',
  })
  assert.equal(ref.instantId, instant().id)
  assert.equal(ref.context.eventId, 'decision-receipt-1')
  assert.equal(ref.context.provider, 'ai_board')
  assert.equal(ref.context.providerResourceId, 'msg-root')
  assert.deepEqual(ref.signature, instant().signature)
  assert.equal('content' in ref, false)
})

test('CTCL instant parser fails closed for malformed instant IDs and unix_ns', () => {
  assert.throws(() => createCtclTemporalReference(instant({ id: 'instant:wrong' }), {
    eventId: 'event-1', pmwWorkspaceId: 'pmw-ws',
  }), /must start with ctcl:instant:/)
  assert.throws(() => createCtclTemporalReference(instant({ unix_ns: '12.3' }), {
    eventId: 'event-1', pmwWorkspaceId: 'pmw-ws',
  }), /integer string/)
})

test('CTCL client registers a shared instant through POST /v1/instants', async () => {
  let request
  const client = new CtclClient('https://commoninstant.org/', async (url, init) => {
    request = { url, init }
    return { ok: true, status: 200, json: async () => ({ ok: true, data: instant(), meta: { api_version: 'v1' } }) }
  })
  const result = await client.registerInstant({
    label: 'pmw:event-1',
    meta: { pmw_workspace_id: 'pmw-ws', pmw_task_id: 'pmw-task', event_id: 'event-1' },
  })
  assert.equal(request.url, 'https://commoninstant.org/v1/instants')
  assert.equal(request.init.method, 'POST')
  assert.equal(JSON.parse(request.init.body).meta.event_id, 'event-1')
  assert.equal(result.id, instant().id)
})

test('CTCL client retrieves the same registered instant by stable id', async () => {
  let url
  const client = new CtclClient('https://commoninstant.org', async (input) => {
    url = input
    return { ok: true, status: 200, json: async () => ({ ok: true, data: instant() }) }
  })
  const result = await client.getInstant(instant().id)
  assert.equal(url, `https://commoninstant.org/v1/instant/${encodeURIComponent(instant().id)}`)
  assert.equal(result.unix_ns, instant().unix_ns)
})

test('CTCL client rejects an error envelope instead of fabricating temporal proof', async () => {
  const client = new CtclClient('https://commoninstant.org', async () => ({
    ok: true, status: 200,
    json: async () => ({ ok: false, error: { code: 'REGISTRY_UNAVAILABLE', message: 'KV unavailable' } }),
  }))
  await assert.rejects(client.registerInstant(), /REGISTRY_UNAVAILABLE/)
})

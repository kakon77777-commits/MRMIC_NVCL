import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase12Server } from '../dist/apps/web/src/server.js'

const AGENT_TOKEN = 'phase13-http-agent-token-0001'
const VIEWER_TOKEN = 'phase13-http-viewer-token-001'

const bindings = [
  {
    token: AGENT_TOKEN, principalId: 'principal:agent', role: 'agent-direct', actorType: 'agent',
    actorId: 'mrmic:verified-agent', semanticAgentId: 'agent:verified',
  },
  {
    token: VIEWER_TOKEN, principalId: 'principal:viewer', role: 'viewer', actorType: 'user',
    actorId: 'mrmic:verified-viewer',
  },
]

async function post(url, path, body, token) {
  return fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
}

test('secure HTTP mutations require a mutating principal and overwrite claimed actors', async () => {
  const previous = process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON = JSON.stringify(bindings)
  const app = createPhase12Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  try {
    const unauthorized = await post(started.url, '/api/transaction', app.createSeedTransaction())
    assert.equal(unauthorized.status, 401)
    assert.equal(app.store.listObjects(app.rootCanvas.id).length, 0)

    const viewer = await post(started.url, '/api/transaction', app.createSeedTransaction(), VIEWER_TOKEN)
    assert.equal(viewer.status, 403)
    assert.equal(app.store.listObjects(app.rootCanvas.id).length, 0)

    const seed = app.createSeedTransaction()
    const forgedSeed = { ...seed, actor: { actorType: 'user', actorId: 'user:neo' } }
    const update = app.room.nextUpdate('pmw-agent', forgedSeed)
    const synchronized = await post(started.url, '/api/sync/update', update, AGENT_TOKEN)
    assert.equal(synchronized.status, 200)
    assert.equal(app.ledger.list(app.workspace.id).at(-1).actor.actorId, 'mrmic:verified-agent')

    const repair = app.createRepairTransaction()
    const forgedRepair = { ...repair, actor: { actorType: 'system', actorId: 'forged-system' } }
    const direct = await post(started.url, '/api/transaction', forgedRepair, AGENT_TOKEN)
    assert.equal(direct.status, 200)
    const event = app.ledger.list(app.workspace.id).at(-1)
    assert.equal(event.actor.actorType, 'agent')
    assert.equal(event.actor.actorId, 'mrmic:verified-agent')
    assert.equal(JSON.stringify(event).includes(AGENT_TOKEN), false)
  } finally {
    await app.close()
    if (previous === undefined) delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON = previous
  }
})

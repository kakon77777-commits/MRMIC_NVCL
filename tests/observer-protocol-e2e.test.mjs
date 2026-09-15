import test from 'node:test'
import assert from 'node:assert/strict'
import { createObserverProtocolServer } from '../dist/apps/observer-protocol-server/src/index.js'

const token = 'phase15-observer-token-0001'
const binding = JSON.stringify([{
  token,
  principalId: 'principal:agent-a',
  role: 'agent-direct',
  actorType: 'agent',
  actorId: 'agent:a',
  semanticAgentId: 'agent:a',
}])

function auth(extra = {}) { return { authorization: `Bearer ${token}`, ...extra } }

test('reference observer server closes HTTP and MCP re-entry loop under one authenticated principal', async () => {
  const before = process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON = binding
  const app = createObserverProtocolServer({ port: 0, databasePath: ':memory:' })
  const started = await app.start()
  try {
    const create = await fetch(`${started.url}/api/observer/command`, {
      method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ command: { kind: 'create_view', input: { viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' } } }),
    })
    assert.equal(create.status, 200)

    const snapshotResponse = await fetch(`${started.url}/api/observer/snapshot`, { headers: auth() })
    assert.equal(snapshotResponse.status, 200)
    const snapshot = (await snapshotResponse.json()).snapshot
    assert.deepEqual(snapshot.views.map(view => view.viewId), ['view:a'])

    const init = await fetch(`${started.url}/mcp/observer`, {
      method: 'POST', headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }),
    })
    assert.equal(init.status, 200)
    const sessionId = init.headers.get('mcp-session-id')
    assert.ok(sessionId)

    const initialized = await fetch(`${started.url}/mcp/observer`, {
      method: 'POST', headers: { ...auth({ 'mcp-session-id': sessionId }), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })
    assert.equal(initialized.status, 202)

    const read = await fetch(`${started.url}/mcp/observer`, {
      method: 'POST', headers: { ...auth({ 'mcp-session-id': sessionId }), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'mrmic://observer/self' } }),
    })
    assert.equal(read.status, 200)
    const rpc = await read.json()
    const viaMcp = JSON.parse(rpc.result.contents[0].text)
    assert.deepEqual(viaMcp.views.map(view => view.viewId), ['view:a'])
  } finally {
    await app.close()
    if (before === undefined) delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON = before
  }
})

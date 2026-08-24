import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase12Server } from '../dist/apps/web/src/server.js'

const OWNER_TOKEN = 'phase13-mcp-owner-token-00001'
const VIEWER_TOKEN = 'phase13-mcp-viewer-token-0001'

async function rpc(url, body, token, sessionId) {
  return fetch(`${url}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  })
}

test('real server MCP gateway requires bearer auth and pins sessions to one principal', async () => {
  const previous = process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON = JSON.stringify([
    { token: OWNER_TOKEN, principalId: 'principal:owner', role: 'owner', actorType: 'agent', actorId: 'mrmic:owner' },
    { token: VIEWER_TOKEN, principalId: 'principal:viewer', role: 'viewer', actorType: 'user', actorId: 'mrmic:viewer' },
  ])
  const app = createPhase12Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  try {
    const initialize = {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'pmw-python', version: '1' } },
    }
    const missing = await rpc(started.url, initialize)
    assert.equal(missing.status, 401)

    const accepted = await rpc(started.url, initialize, OWNER_TOKEN)
    assert.equal(accepted.status, 200)
    const sessionId = accepted.headers.get('mcp-session-id')
    assert.ok(sessionId)

    const initialized = await rpc(started.url, { jsonrpc: '2.0', method: 'notifications/initialized' }, OWNER_TOKEN, sessionId)
    assert.equal(initialized.status, 202, await initialized.clone().text())

    const takeover = await rpc(started.url, { jsonrpc: '2.0', id: 2, method: 'resources/list' }, VIEWER_TOKEN, sessionId)
    assert.equal(takeover.status, 403)

    const ownerRead = await rpc(started.url, { jsonrpc: '2.0', id: 3, method: 'resources/list' }, OWNER_TOKEN, sessionId)
    assert.equal(ownerRead.status, 200)
  } finally {
    await app.close()
    if (previous === undefined) delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON = previous
  }
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { createObserverProtocolServer } from '../dist/apps/observer-protocol-server/src/index.js'
import { StaticObserverCanvasTopologyResolver } from '../dist/packages/observer-workspace/src/topology.js'

const token = 'phase15-nested-token-0001'
const binding = JSON.stringify([{
  token,
  principalId: 'principal:agent-a',
  role: 'agent-direct',
  actorType: 'agent',
  actorId: 'agent:a',
  semanticAgentId: 'agent:a',
}])

function auth(extra = {}) { return { authorization: `Bearer ${token}`, ...extra } }

test('reference observer server re-enters one topology-authorized nested canvas over HTTP and MCP', async () => {
  const before = process.env.MRMIC_PMW_BINDINGS_JSON
  process.env.MRMIC_PMW_BINDINGS_JSON = binding
  const topology = new StaticObserverCanvasTopologyResolver([
    { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:child', portalObjectId: 'portal:child' },
  ])
  const app = createObserverProtocolServer({ port: 0, databasePath: ':memory:', topology })
  const started = await app.start()
  try {
    for (const command of [
      { kind: 'create_view', input: { viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:root' } },
      { kind: 'enter_subcanvas', viewId: 'view:a', input: { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:child', portalObjectId: 'portal:child' } },
      { kind: 'set_nested_foreground', viewId: 'view:a', canvasId: 'canvas:child', portalIds: ['portal:editor'] },
    ]) {
      const response = await fetch(`${started.url}/api/observer/command`, {
        method: 'POST',
        headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      assert.equal(response.status, 200)
    }

    const init = await fetch(`${started.url}/mcp/observer`, {
      method: 'POST',
      headers: { ...auth(), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } }),
    })
    const sessionId = init.headers.get('mcp-session-id')
    assert.ok(sessionId)

    await fetch(`${started.url}/mcp/observer`, {
      method: 'POST',
      headers: { ...auth({ 'mcp-session-id': sessionId }), 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })

    const read = await fetch(`${started.url}/mcp/observer`, {
      method: 'POST',
      headers: { ...auth({ 'mcp-session-id': sessionId }), 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'resources/read',
        params: { uri: 'mrmic://observer/view/view%3Aa/contexts' },
      }),
    })
    assert.equal(read.status, 200)
    const rpc = await read.json()
    const payload = JSON.parse(rpc.result.contents[0].text)
    assert.deepEqual(payload.contexts.map(item => item.canvasId), ['canvas:root', 'canvas:child'])
    assert.deepEqual(payload.contexts[1].foregroundPortalIds, ['portal:editor'])
    assert.equal(payload.contexts[1].active, true)
  } finally {
    await app.close()
    if (before === undefined) delete process.env.MRMIC_PMW_BINDINGS_JSON
    else process.env.MRMIC_PMW_BINDINGS_JSON = before
  }
})

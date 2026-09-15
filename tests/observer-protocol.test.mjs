import test from 'node:test'
import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { DurableObserverWorkspaceRegistry } from '../dist/packages/observer-workspace/src/durable-registry.js'
import {
  OBSERVER_HTTP_COMMAND_PATH,
  OBSERVER_HTTP_SNAPSHOT_PATH,
  OBSERVER_SELF_RESOURCE_URI,
  ObserverProtocolGateway,
  executeObserverProtocolCommand,
} from '../dist/packages/observer-protocol/src/index.js'

const neo = {
  principalId: 'principal:neo',
  role: 'owner',
  actor: { actorType: 'user', actorId: 'user:neo' },
}
const agentA = {
  principalId: 'principal:agent-a',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'agent:a' },
  semanticAgentId: 'agent:a',
}
const agentB = {
  principalId: 'principal:agent-b',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'agent:b' },
  semanticAgentId: 'agent:b',
}

function runtime() {
  const events = []
  const store = {
    listObserverWorkspaceEvents() { return structuredClone(events) },
    appendObserverWorkspaceEvent(event) { events.push(structuredClone(event)) },
  }
  let tick = 0
  return new DurableObserverWorkspaceRegistry(store, () => `2026-09-14T02:00:${String(tick++).padStart(2, '0')}Z`)
}

function gateway(workspace) {
  const byToken = new Map([['neo-token', neo], ['agent-a-token', agentA], ['agent-b-token', agentB]])
  return new ObserverProtocolGateway({ workspace, identityResolver: { resolveToken: token => byToken.get(token) ?? null } })
}

function fakeHttp({ method, url, token, body }) {
  const request = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))])
  request.method = method
  request.url = url
  request.headers = { host: 'localhost', ...(token ? { authorization: `Bearer ${token}` } : {}) }
  let status = 0
  let headers = {}
  let payload = ''
  const response = {
    writeHead(code, nextHeaders = {}) { status = code; headers = nextHeaders },
    end(value = '') { payload += typeof value === 'string' ? value : String(value) },
    write(value = '') { payload += typeof value === 'string' ? value : String(value) },
  }
  return { request, response, result: () => ({ status, headers, payload }) }
}

test('protocol command delegates to authenticated durable observer authority', () => {
  const workspace = runtime()
  const view = executeObserverProtocolCommand(workspace, {
    kind: 'create_view', input: { viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' },
  }, agentA)
  assert.equal(view.observerPrincipalId, agentA.principalId)
  assert.equal(workspace.snapshotFor(agentA).views.length, 1)
})

test('MCP self resource is principal filtered', async () => {
  const workspace = runtime()
  workspace.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
  workspace.createPrivateView({ viewId: 'view:b', worldId: 'world:1', canvasId: 'canvas:b' }, agentB)
  const service = gateway(workspace)
  const result = await service.dispatchMcpForTesting({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: OBSERVER_SELF_RESOURCE_URI } }, agentA)
  const snapshot = JSON.parse(result.result.contents[0].text)
  assert.deepEqual(snapshot.views.map(view => view.viewId), ['view:a'])
})

test('MCP observer.command cannot mutate another principal private view', async () => {
  const workspace = runtime()
  workspace.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
  const service = gateway(workspace)
  const result = await service.dispatchMcpForTesting({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'observer.command', arguments: { command: { kind: 'set_foreground', viewId: 'view:a', portalIds: ['portal:x'] } } },
  }, agentB)
  assert.equal(result.result.structuredContent.ok, false)
  assert.match(result.result.structuredContent.error.message, /private to another principal/)
})

test('authenticated HTTP snapshot returns only the caller view', async () => {
  const workspace = runtime()
  workspace.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
  workspace.createPrivateView({ viewId: 'view:b', worldId: 'world:1', canvasId: 'canvas:b' }, agentB)
  const service = gateway(workspace)
  const io = fakeHttp({ method: 'GET', url: OBSERVER_HTTP_SNAPSHOT_PATH, token: 'agent-a-token' })
  assert.equal(await service.handleHttp(io.request, io.response), true)
  const out = io.result()
  assert.equal(out.status, 200)
  const snapshot = JSON.parse(out.payload).snapshot
  assert.deepEqual(snapshot.views.map(view => view.viewId), ['view:a'])
})

test('observer HTTP surface fails closed without bearer principal', async () => {
  const service = gateway(runtime())
  const io = fakeHttp({ method: 'GET', url: OBSERVER_HTTP_SNAPSHOT_PATH })
  assert.equal(await service.handleHttp(io.request, io.response), true)
  assert.equal(io.result().status, 401)
})

test('authenticated HTTP command mutates only under resolved principal', async () => {
  const workspace = runtime()
  const service = gateway(workspace)
  const io = fakeHttp({
    method: 'POST', url: OBSERVER_HTTP_COMMAND_PATH, token: 'agent-a-token',
    body: { command: { kind: 'create_view', input: { viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' } } },
  })
  assert.equal(await service.handleHttp(io.request, io.response), true)
  assert.equal(io.result().status, 200)
  assert.equal(workspace.getPrivateView('view:a', agentA).observerPrincipalId, agentA.principalId)
  assert.throws(() => workspace.getPrivateView('view:a', agentB), /private to another principal/)
})

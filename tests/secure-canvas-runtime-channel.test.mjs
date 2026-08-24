import test from 'node:test'
import assert from 'node:assert/strict'
import { SecureCanvasSyncClient } from '../dist/packages/secure-canvas-client/src/index.js'

class FakeSocket {
  readyState = 0
  sent = []
  listeners = new Map()
  addEventListener(type, listener) {
    const list = this.listeners.get(type) ?? []
    list.push(listener)
    this.listeners.set(type, list)
  }
  send(data) { this.sent.push(String(data)) }
  close(code, reason) { this.readyState = 3; this.emit('close', { code, reason }) }
  open() { this.readyState = 1; this.emit('open', {}) }
  message(value) { this.emit('message', { data: JSON.stringify(value) }) }
  emit(type, event) { for (const listener of this.listeners.get(type) ?? []) listener(event) }
}

function harness() {
  const sockets = []
  return {
    sockets,
    factory: () => {
      const socket = new FakeSocket()
      sockets.push(socket)
      return socket
    },
  }
}

function ack(runtimePresence = []) {
  return {
    type: 'hello_ack', roomId: 'ws:root', stateVector: {}, missingUpdates: [], presence: [], runtimePresence,
    identity: { verified: true, principalId: 'principal:claude', semanticAgentId: 'agent:claude-main' },
  }
}

async function connected() {
  const h = harness()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:8788/sync', clientId: 'bridge-claude', authToken: 'binding-token',
    webSocketFactory: h.factory, connectTimeoutMs: 1000,
  })
  const pending = client.connect()
  const socket = h.sockets[0]
  socket.open()
  socket.message(ack())
  await pending
  return { client, socket }
}

test('secure Canvas client sends bounded runtime facts without caller identity fields', async () => {
  const { client, socket } = await connected()
  client.sendRuntimePresence({
    provider: 'herdr', providerResourceId: 'terminal-claude', runtimeEpochId: 'epoch-1',
    status: 'working', revision: 7, sequence: 9, kind: 'claude',
    coordinates: { workspaceId: 'ws-1', tabId: 'tab-1', paneId: 'pane-1' },
    principalId: 'principal:forged', semanticAgentId: 'user:neo', actorId: 'user:neo', secret: 'drop-me',
  })
  const sent = JSON.parse(socket.sent.at(-1))
  assert.equal(sent.type, 'runtime_presence')
  assert.deepEqual(sent.runtime, {
    provider: 'herdr', providerResourceId: 'terminal-claude', runtimeEpochId: 'epoch-1',
    status: 'working', revision: 7, sequence: 9, kind: 'claude',
    coordinates: { workspaceId: 'ws-1', tabId: 'tab-1', paneId: 'pane-1' },
  })
  assert.equal('principalId' in sent.runtime, false)
  assert.equal('semanticAgentId' in sent.runtime, false)
  assert.equal('secret' in sent.runtime, false)
})

test('hello_ack exposes existing ephemeral runtime snapshot', async () => {
  const h = harness()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:8788/sync', clientId: 'bridge-codex', authToken: 'binding-token',
    webSocketFactory: h.factory, connectTimeoutMs: 1000,
  })
  const pending = client.connect()
  const socket = h.sockets[0]
  socket.open()
  socket.message(ack([{
    provider: 'herdr', providerResourceId: 'terminal-claude', runtimeEpochId: 'epoch-1', status: 'working',
    revision: 7, sequence: 9, clientId: 'bridge-claude', principalId: 'principal:claude',
    semanticAgentId: 'agent:claude-main', identityStatus: 'verified', updatedAt: '2026-08-15T00:00:00.000Z',
  }]))
  const result = await pending
  assert.equal(result.runtimePresence.length, 1)
  assert.equal(result.runtimePresence[0].semanticAgentId, 'agent:claude-main')
})

test('runtime broadcast, stale rejection and removal become dedicated client events', async () => {
  const { client, socket } = await connected()
  const events = []
  client.subscribe(event => events.push(event))
  const runtime = {
    provider: 'herdr', providerResourceId: 'terminal-claude', runtimeEpochId: 'epoch-1', status: 'blocked',
    revision: 8, sequence: 10, clientId: 'bridge-claude', principalId: 'principal:claude',
    semanticAgentId: 'agent:claude-main', identityStatus: 'verified', updatedAt: '2026-08-15T00:00:00.000Z',
  }
  socket.message({ type: 'runtime_presence', runtimePresence: runtime })
  socket.message({ type: 'runtime_presence_rejected', reason: 'stale_revision', runtimePresence: runtime })
  socket.message({ type: 'runtime_presence_removed', runtimePresence: runtime })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(events.map(event => event.type), ['runtime_presence', 'runtime_presence_rejected', 'runtime_presence_removed'])
  assert.equal(events[1].reason, 'stale_revision')
})

test('runtime presence removal carries provider identity only', async () => {
  const { client, socket } = await connected()
  client.removeRuntimePresence('herdr', 'terminal-claude')
  assert.deepEqual(JSON.parse(socket.sent.at(-1)), {
    type: 'runtime_presence_remove', provider: 'herdr', providerResourceId: 'terminal-claude',
  })
})

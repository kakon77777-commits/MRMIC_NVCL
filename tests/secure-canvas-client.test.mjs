import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SecureCanvasSyncClient,
  sanitizeSecurePresence,
} from '../dist/packages/secure-canvas-client/src/index.js'

class FakeSocket {
  readyState = 0
  sent = []
  closed = []
  listeners = new Map()

  addEventListener(type, listener) {
    const values = this.listeners.get(type) ?? []
    values.push(listener)
    this.listeners.set(type, values)
  }

  send(data) {
    if (this.readyState !== 1) throw new Error('fake socket is not open')
    this.sent.push(String(data))
  }

  close(code, reason) {
    this.closed.push({ code, reason })
    const wasClosed = this.readyState === 3
    this.readyState = 3
    if (!wasClosed) this.emit('close', { code, reason })
  }

  open() {
    this.readyState = 1
    this.emit('open', {})
  }

  message(value) {
    this.emit('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })
  }

  serverClose(code = 1006, reason = 'server closed') {
    this.readyState = 3
    this.emit('close', { code, reason })
  }

  emit(type, event) {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

function socketFactory() {
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

function verifiedAck(overrides = {}) {
  return {
    type: 'hello_ack',
    roomId: 'visual-ws:root',
    stateVector: { 'bridge-claude': 2, other: 5 },
    missingUpdates: [],
    presence: [],
    identity: {
      verified: true,
      principalId: 'principal:claude',
      semanticAgentId: 'agent:claude-main',
    },
    ...overrides,
  }
}

async function connectClient(options = {}) {
  const harness = socketFactory()
  const client = new SecureCanvasSyncClient({
    url: 'ws://127.0.0.1:8788/sync',
    clientId: 'bridge-claude',
    authToken: 'binding-token-secret',
    webSocketFactory: harness.factory,
    connectTimeoutMs: 1000,
    ...options,
  })
  const promise = client.connect()
  const socket = harness.sockets[0]
  socket.open()
  socket.message(verifiedAck())
  const ack = await promise
  return { client, harness, socket, ack }
}

test('secure client hello carries binding token and state vector but no caller-controlled actor identity', async () => {
  const harness = socketFactory()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:9000/sync',
    clientId: 'bridge-claude',
    authToken: 'binding-token-secret',
    initialStateVector: { 'bridge-claude': 7 },
    initialPresence: {
      label: 'Claude',
      task: 'Review theorem',
      actorType: 'user',
      actorId: 'user:neo',
    },
    webSocketFactory: harness.factory,
    connectTimeoutMs: 1000,
  })

  const pending = client.connect()
  const socket = harness.sockets[0]
  socket.open()
  const hello = JSON.parse(socket.sent[0])
  assert.equal(hello.type, 'hello')
  assert.equal(hello.authToken, 'binding-token-secret')
  assert.deepEqual(hello.stateVector, { 'bridge-claude': 7 })
  assert.deepEqual(hello.presence, { label: 'Claude', task: 'Review theorem' })
  assert.equal('actorType' in hello.presence, false)
  assert.equal('actorId' in hello.presence, false)

  socket.message(verifiedAck({ stateVector: { 'bridge-claude': 7 } }))
  const ack = await pending
  assert.equal(ack.identity.semanticAgentId, 'agent:claude-main')
  assert.equal(client.connected, true)
})

test('client rejects a hello_ack that does not verify PMW identity', async () => {
  const harness = socketFactory()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:9000/sync', clientId: 'bridge-claude', authToken: 'token',
    webSocketFactory: harness.factory, connectTimeoutMs: 1000,
  })
  const pending = client.connect()
  const socket = harness.sockets[0]
  socket.open()
  socket.message({ ...verifiedAck(), identity: { verified: false } })
  await assert.rejects(pending, /did not verify PMW identity/)
  assert.equal(client.connected, false)
})

test('server error before verified hello rejects connection instead of falling back anonymously', async () => {
  const harness = socketFactory()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:9000/sync', clientId: 'bridge-claude', authToken: 'bad-token',
    webSocketFactory: harness.factory, connectTimeoutMs: 1000,
  })
  const pending = client.connect()
  const socket = harness.sockets[0]
  socket.open()
  socket.message({ type: 'error', message: 'invalid PMW binding token' })
  await assert.rejects(pending, /invalid PMW binding token/)
  assert.equal(socket.closed.length, 1)
})

test('presence updates sanitize forged identity fields at runtime', async () => {
  const { client, socket } = await connectClient()
  client.sendPresence({
    label: 'Claude', task: 'Working', color: '#fff',
    cursor: { x: 10, y: 20 }, selectedObjectIds: ['note-1'],
    actorType: 'user', actorId: 'user:neo', principalId: 'forged-principal',
  })
  const message = JSON.parse(socket.sent.at(-1))
  assert.equal(message.type, 'presence')
  assert.deepEqual(message.presence, {
    label: 'Claude', color: '#fff', cursor: { x: 10, y: 20 }, selectedObjectIds: ['note-1'], task: 'Working',
  })
  assert.equal('actorId' in message.presence, false)
  assert.equal('principalId' in message.presence, false)
})

test('client tracks server state vectors and emits synchronized updates', async () => {
  const { client, socket } = await connectClient()
  const events = []
  client.subscribe(event => events.push(event))
  socket.message({
    type: 'update',
    update: { updateId: 'u-1', roomId: 'visual-ws:root', clientId: 'other', counter: 6, transaction: {}, createdAt: '' },
    stateVector: { 'bridge-claude': 2, other: 6 },
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(client.stateVector(), { 'bridge-claude': 2, other: 6 })
  assert.equal(events.at(-1).type, 'update')
  assert.equal(events.at(-1).stateVector.other, 6)
  assert.equal(client.nextCounter(), 3)
})

test('reconnect reuses last known state vector so server can return only missing updates', async () => {
  const harness = socketFactory()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:9000/sync', clientId: 'bridge-claude', authToken: 'token',
    webSocketFactory: harness.factory, connectTimeoutMs: 1000,
  })

  const first = client.connect()
  harness.sockets[0].open()
  harness.sockets[0].message(verifiedAck({ stateVector: { 'bridge-claude': 2, codex: 8 } }))
  await first
  harness.sockets[0].serverClose()

  const second = client.connect()
  harness.sockets[1].open()
  const hello = JSON.parse(harness.sockets[1].sent[0])
  assert.deepEqual(hello.stateVector, { 'bridge-claude': 2, codex: 8 })
  harness.sockets[1].message(verifiedAck({
    stateVector: { 'bridge-claude': 2, codex: 9 },
    missingUpdates: [{ updateId: 'missing-9', clientId: 'codex', counter: 9 }],
  }))
  const ack = await second
  assert.equal(ack.missingUpdates.length, 1)
  assert.equal(client.stateVector().codex, 9)
})

test('sendUpdate refuses another client identity before it reaches the network', async () => {
  const { client, socket } = await connectClient()
  const before = socket.sent.length
  assert.throws(() => client.sendUpdate({
    updateId: 'u-foreign', roomId: 'visual-ws:root', clientId: 'codex', counter: 1,
    transaction: {}, createdAt: '',
  }), /must match secure Canvas clientId/)
  assert.equal(socket.sent.length, before)
})

test('ping and presence require a verified live connection', () => {
  const harness = socketFactory()
  const client = new SecureCanvasSyncClient({
    url: 'ws://localhost:9000/sync', clientId: 'bridge-claude', authToken: 'token', webSocketFactory: harness.factory,
  })
  assert.throws(() => client.ping(), /not connected/)
  assert.throws(() => client.sendPresence({ task: 'x' }), /not connected/)
})

test('sanitizeSecurePresence rejects invalid geometry instead of forwarding malformed multimodal state', () => {
  assert.deepEqual(sanitizeSecurePresence({
    cursor: { x: Number.NaN, y: 2 },
    viewport: { x: 0, y: 0, width: -1, height: 100, zoom: 1 },
    selectedObjectIds: [1, 'two'],
  }), { selectedObjectIds: ['1', 'two'] })
})

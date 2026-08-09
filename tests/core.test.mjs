import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasCoreError, CanvasStore } from '../dist/packages/canvas-core/src/index.js'

const actor = { actorType: 'agent', actorId: 'test-agent' }
const now = new Date().toISOString()

function setup(eventSink) {
  const workspace = {
    id: 'ws', title: 'Test', rootCanvasId: 'root', schemaVersion: '0.1.0',
    createdAt: now, updatedAt: now,
  }
  const root = {
    id: 'root', workspaceId: 'ws', title: 'Root', objectIds: [], revision: 0,
    createdAt: now, updatedAt: now,
  }
  return new CanvasStore(workspace, root, eventSink ? { eventSink } : {})
}

function rectangle(id = 'r1') {
  return {
    id, canvasId: 'root', type: 'rectangle',
    transform: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
    style: {}, childIds: [], bindings: [], metadata: {}, createdBy: actor,
    createdAt: now, updatedAt: now, revision: 0,
  }
}

test('commits an atomic create transaction', () => {
  const events = []
  const store = setup({ append: (event) => events.push(event) })
  const result = store.applyTransaction({
    id: 'tx1', canvasId: 'root', actor, intent: 'create rectangle', preconditions: [],
    operations: [{ op: 'create_object', object: rectangle() }], mode: 'direct', createdAt: now,
  })
  assert.equal(result.revision, 1)
  assert.equal(store.listObjects('root').length, 1)
  assert.equal(events.length, 1)
  assert.notEqual(result.beforeHash, result.afterHash)
})

test('rejects a stale object revision without changing state', () => {
  const store = setup()
  store.applyTransaction({
    id: 'tx1', canvasId: 'root', actor, intent: 'create', preconditions: [],
    operations: [{ op: 'create_object', object: rectangle() }], mode: 'direct', createdAt: now,
  })
  const before = store.snapshot()
  assert.throws(() => store.applyTransaction({
    id: 'tx2', canvasId: 'root', actor, intent: 'stale patch', preconditions: [],
    operations: [{ op: 'patch_object', objectId: 'r1', expectedRevision: 99, patch: { transform: { x: 50 } } }],
    mode: 'direct', createdAt: now,
  }), (error) => error instanceof CanvasCoreError && error.code === 'REVISION_CONFLICT')
  assert.deepEqual(store.snapshot(), before)
})

test('rolls back the whole transaction when one operation fails', () => {
  const events = []
  const store = setup({ append: (event) => events.push(event) })
  assert.throws(() => store.applyTransaction({
    id: 'tx-bad', canvasId: 'root', actor, intent: 'partially invalid', preconditions: [],
    operations: [
      { op: 'create_object', object: rectangle('valid') },
      { op: 'patch_object', objectId: 'missing', expectedRevision: 0, patch: { transform: { x: 5 } } },
    ], mode: 'direct', createdAt: now,
  }))
  assert.equal(store.listObjects('root').length, 0)
  assert.equal(store.getCanvas('root').revision, 0)
  assert.equal(events.length, 0)
})

test('idempotency key prevents duplicate creation', () => {
  const store = setup()
  const tx = {
    id: 'tx-idem', canvasId: 'root', actor, intent: 'create once', preconditions: [],
    operations: [{ op: 'create_object', object: rectangle() }], mode: 'direct', createdAt: now,
    idempotencyKey: 'same-request',
  }
  store.applyTransaction(tx)
  store.applyTransaction({ ...tx, id: 'tx-idem-retry' })
  assert.equal(store.listObjects('root').length, 1)
  assert.equal(store.getCanvas('root').revision, 1)
})

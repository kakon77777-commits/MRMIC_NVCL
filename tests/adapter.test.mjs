import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasStore } from '../dist/packages/canvas-core/src/index.js'
import { SvgCanvasAdapter } from '../dist/packages/adapter-svg/src/index.js'

const actor = { actorType: 'agent', actorId: 'adapter-test' }
const now = new Date().toISOString()

function setup() {
  const workspace = { id: 'ws', title: 'Adapter', rootCanvasId: 'root', schemaVersion: '0.2.0', createdAt: now, updatedAt: now }
  const root = { id: 'root', workspaceId: 'ws', title: 'Root', objectIds: [], revision: 0, createdAt: now, updatedAt: now }
  const store = new CanvasStore(workspace, root)
  return { store, adapter: new SvgCanvasAdapter(store) }
}

function rectangle(id = 'rect-1') {
  return {
    id, canvasId: 'root', type: 'rectangle',
    transform: { x: 10, y: 20, width: 180, height: 90, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1 },
    style: { fill: '#ff00aa', stroke: '#111111', strokeWidth: 2 },
    childIds: [], bindings: [], metadata: { role: 'card' }, createdBy: actor,
    createdAt: now, updatedAt: now, revision: 0,
  }
}

test('SVG adapter renders core objects with stable IDs', async () => {
  const { adapter } = setup()
  await adapter.applyTransaction({
    id: 'tx-create', canvasId: 'root', actor, intent: 'render test', preconditions: [],
    operations: [{ op: 'create_object', object: rectangle() }], mode: 'direct', createdAt: now,
  })
  const result = await adapter.render({ canvasId: 'root', includeGrid: true })
  assert.match(result.svg, /data-object-id="rect-1"/)
  assert.match(result.svg, /fill="#ff00aa"/)
  assert.equal(result.revision, 1)
})

test('adapter emits one delta per committed transaction', async () => {
  const { adapter } = setup()
  const deltas = []
  const unsubscribe = adapter.subscribe(delta => deltas.push(delta))
  await adapter.applyTransaction({
    id: 'tx-create', canvasId: 'root', actor, intent: 'delta test', preconditions: [],
    operations: [{ op: 'create_object', object: rectangle() }], mode: 'direct', createdAt: now,
  })
  unsubscribe()
  assert.equal(deltas.length, 1)
  assert.deepEqual(deltas[0].affectedObjectIds, ['rect-1'])
  assert.equal(deltas[0].revision, 1)
})

test('adapter supports local query and viewport state', async () => {
  const { adapter } = setup()
  await adapter.applyTransaction({
    id: 'tx-create', canvasId: 'root', actor, intent: 'query test', preconditions: [],
    operations: [{ op: 'create_object', object: rectangle() }], mode: 'direct', createdAt: now,
  })
  const found = await adapter.listObjects('root', { types: ['rectangle'], metadata: { role: 'card' } })
  assert.equal(found.length, 1)
  await adapter.setViewport({ x: -100, y: -50, width: 900, height: 600, zoom: 1.5 })
  assert.deepEqual(await adapter.getViewport(), { x: -100, y: -50, width: 900, height: 600, zoom: 1.5 })
})

test('freehand SVG emits each style attribute once for strict rasterizers', async () => {
  const { adapter } = setup()
  const object = {
    ...rectangle('path-1'),
    type: 'freehand',
    style: { fill: 'none', stroke: '#0f766e', strokeWidth: 6 },
    content: { pathData: 'M 20 30 L 80 90 L 140 40' },
  }
  await adapter.applyTransaction({
    id: 'tx-freehand', canvasId: 'root', actor, intent: 'strict raster SVG', preconditions: [],
    operations: [{ op: 'create_object', object }], mode: 'direct', createdAt: now,
  })
  const result = await adapter.render({ canvasId: 'root', includeGrid: false })
  const path = result.svg.match(/<path data-object-id="path-1"[^>]+\/>/)?.[0]
  assert.ok(path)
  assert.equal(path.match(/ fill=/g)?.length, 1)
  assert.equal(path.match(/ stroke=/g)?.length, 1)
})

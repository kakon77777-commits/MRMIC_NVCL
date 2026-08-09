import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPhase6Server } from '../dist/apps/web/src/server.js'
import { LocalMcpCanvasClient } from '../dist/packages/nvcl-runtime/src/index.js'

function paths(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, databasePath: join(dir, 'events.sqlite'), syncDatabasePath: join(dir, 'sync.sqlite') }
}

function rectangle(id, x = 10) {
  return { id, type: 'rectangle', transform: { x, y: 10, width: 80, height: 60, zIndex: 1 }, style: { fill: '#ddd6fe', stroke: '#6d28d9' }, metadata: { role: 'phase6' } }
}

test('Phase 6 persists complete canvas state and trajectories across server restart', async () => {
  const files = paths('mrmic-phase6-restart-')
  let app = createPhase6Server({ port: 0, databasePath: files.databasePath, syncDatabasePath: files.syncDatabasePath })
  await app.start()
  try {
    const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'restart-owner', role: 'owner' })
    const created = await client.callTool('canvas.create_objects', { canvasId: app.rootCanvas.id, objects: [rectangle('persistent-object', 120)] })
    assert.equal(created.ok, true)
    const opened = await client.callTool('canvas.open_subcanvas', { canvasId: app.rootCanvas.id, create: { objectId: 'persistent-portal', childCanvasId: 'persistent-child', title: 'Persistent Child' } })
    assert.equal(opened.ok, true)
    const childCreated = await client.callTool('canvas.create_objects', { canvasId: 'persistent-child', objects: [rectangle('persistent-child-object', 30)] })
    assert.equal(childCreated.ok, true)
    app.mcp.registerTrajectory('persistent-run', { status: 'completed', canvasId: 'persistent-child' })
  } finally { await app.close() }

  app = createPhase6Server({ port: 0, databasePath: files.databasePath, syncDatabasePath: files.syncDatabasePath })
  await app.start()
  try {
    assert.ok(app.recoveredSnapshotId)
    assert.equal(app.store.getObject('persistent-object').transform.x, 120)
    assert.equal(app.store.getCanvas('persistent-child').parentCanvasId, app.rootCanvas.id)
    assert.equal(app.store.getObject('persistent-child-object').canvasId, 'persistent-child')
    assert.equal(app.ledger.getTrajectory('persistent-run')?.trajectory.status, 'completed')
    const uri = `canvas://workspace/${encodeURIComponent(app.workspace.id)}/trajectory/persistent-run`
    const read = await app.mcp.dispatchForTesting({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri } })
    assert.equal(read.result.contents[0].mimeType, 'application/json')
    assert.match(read.result.contents[0].text, /persistent-child/)
  } finally { await app.close(); rmSync(files.dir, { recursive: true, force: true }) }
})

test('snapshot restore is encoded as a synchronized state replacement update', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'restore-owner', role: 'owner' })
    await client.callTool('canvas.create_objects', { canvasId: app.rootCanvas.id, objects: [rectangle('restore-target', 40)] })
    const snapshot = await client.callTool('canvas.create_snapshot', { canvasId: app.rootCanvas.id })
    const snapshotId = snapshot.data.snapshotId
    const target = app.store.getObject('restore-target')
    await client.callTool('canvas.patch_objects', { canvasId: app.rootCanvas.id, patches: [{ objectId: target.id, expectedRevision: target.revision, patch: { transform: { x: 700 } } }] })
    const events = []
    const unsubscribe = app.registry.roomFor(app.rootCanvas.id).subscribe(event => events.push(event))
    const restored = await client.callTool('canvas.restore_snapshot', { snapshotId })
    unsubscribe()
    assert.equal(restored.ok, true)
    assert.equal(restored.data.synchronized, true)
    assert.equal(app.store.getObject('restore-target').transform.x, 40)
    const replacement = events.find(event => event.type === 'update' && event.update?.kind === 'state_replace')
    assert.ok(replacement)
    assert.equal(replacement.update.snapshotId, snapshotId)
    assert.equal(app.registry.roomFor(app.rootCanvas.id).diff({}) .some(update => update.kind === 'state_replace'), true)
  } finally { await app.close() }
})

test('root and child canvases use independent sync rooms, state vectors, and handles', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'room-owner', role: 'owner' })
    const opened = await client.callTool('canvas.open_subcanvas', { canvasId: app.rootCanvas.id, create: { objectId: 'room-portal', childCanvasId: 'room-child', title: 'Room Child' } })
    assert.equal(opened.ok, true)
    assert.equal(opened.data.syncHandle, '/sync?canvasId=room-child')
    await client.callTool('canvas.create_objects', { canvasId: 'room-child', objects: [rectangle('room-child-object')] })
    const rootRoom = app.registry.roomFor(app.rootCanvas.id)
    const childRoom = app.registry.roomFor('room-child')
    assert.notEqual(rootRoom.roomId, childRoom.roomId)
    assert.deepEqual(rootRoom.stateVector(), { [Object.keys(rootRoom.stateVector())[0]]: 1 })
    assert.equal(childRoom.updateCount(), 1)
    assert.equal(rootRoom.updateCount(), 1)
    assert.equal(app.registry.syncHandle(app.rootCanvas.id), '/sync?canvasId=canvas-root')
    assert.equal(app.registry.syncHandle('room-child'), '/sync?canvasId=room-child')
  } finally { await app.close() }
})

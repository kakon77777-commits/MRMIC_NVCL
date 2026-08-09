import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase6Server } from '../dist/apps/web/src/server.js'
import { LocalMcpCanvasClient, MemoryNvclTraceSink } from '../dist/packages/nvcl-runtime/src/index.js'
import {
  MemoryRecursiveTraceSink,
  REFERENCE_DETAIL_CHECKS,
  RecursiveNvclRuntime,
  ReferenceDetailNvclAgent,
} from '../dist/packages/recursive-nvcl-runtime/src/index.js'

async function runRecursive(app, trace = new MemoryRecursiveTraceSink()) {
  const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'recursive-test-agent', role: 'owner' })
  const runtime = new RecursiveNvclRuntime({ client, trace })
  const childTrace = new MemoryNvclTraceSink()
  const result = await runtime.run({
    runId: 'recursive-test-run',
    goal: 'Delegate a character detail task and fold the result into the parent.',
    parentCanvasId: app.rootCanvas.id,
    portal: {
      objectId: 'character-detail-portal',
      childCanvasId: 'canvas-character-detail',
      title: 'Character Detail',
      transform: { x: 820, y: 560, width: 320, height: 160, zIndex: 20 },
      style: { fill: '#faf5ff', stroke: '#7c3aed', strokeWidth: 3 },
    },
    childGoal: 'Create a face detail with exactly two eyes and repair the overlapping label.',
    childChecks: REFERENCE_DETAIL_CHECKS,
    childAgent: new ReferenceDetailNvclAgent(),
    childMaxIterations: 6,
    childTrace,
  })
  return { result, trace, childTrace }
}

test('recursive NVCL completes parent-child execution, folding, and lineage verification', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const { result } = await runRecursive(app)
    assert.equal(result.status, 'completed')
    assert.equal(result.restoredParentSnapshot, false)
    assert.deepEqual(result.lineage, [app.rootCanvas.id, 'canvas-character-detail'])
    assert.equal(result.childResult?.status, 'completed')
    assert.equal(result.childResult?.toolCalls, 2)
    assert.equal(app.store.listObjects('canvas-character-detail').length, 5)
    assert.equal(app.store.getObject('detail-label').transform.y, 55)
    assert.equal(app.store.listObjects('canvas-character-detail').filter(object => object.metadata.role === 'eye').length, 2)
    const portal = app.store.getObject('character-detail-portal')
    assert.equal(portal.content.childCanvasId, 'canvas-character-detail')
    assert.equal(portal.metadata.foldState, 'folded')
    assert.equal(portal.metadata.childObjectCount, 5)
    assert.equal(portal.metadata.childRevision, 2)
    assert.match(portal.content.text, /5 objects/)
    assert.ok(app.registry.rooms().reduce((sum, item) => sum + item.room.updateCount(), 0) >= 4)
    assert.ok(app.ledger.count() >= 4)
  } finally { await app.close() }
})

test('recursive trace records delegation, child completion, folding, lineage, and completion', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const trace = new MemoryRecursiveTraceSink()
    const { result } = await runRecursive(app, trace)
    const types = trace.events.map(event => event.type)
    for (const expected of [
      'recursive_run_started', 'parent_snapshot_created', 'subcanvas_opened',
      'child_run_started', 'child_run_completed', 'subcanvas_folded',
      'lineage_verified', 'recursive_run_completed',
    ]) assert.ok(types.includes(expected), `missing ${expected}`)
    assert.equal(trace.result?.runId, result.runId)
  } finally { await app.close() }
})

test('failed child run restores the complete parent snapshot and removes the recursive world', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    class CreateThenFailAgent {
      name = 'create-then-fail-child'
      async decide(context) {
        if (context.iteration === 0) {
          return {
            type: 'tool_call', tool: 'canvas.create_objects', summary: 'Create one temporary child object.',
            arguments: {
              canvasId: context.observation.canvasId,
              expectedCanvasRevision: context.observation.revision,
              objects: [{ id: 'temporary-child-object', type: 'rectangle', transform: { x: 10, y: 10, width: 50, height: 50, zIndex: 1 }, style: { fill: '#ddd' }, metadata: { role: 'temporary' } }],
            },
          }
        }
        return { type: 'stop', success: false, reason: 'Controlled child failure.' }
      }
    }
    const trace = new MemoryRecursiveTraceSink()
    const runtime = new RecursiveNvclRuntime({ client: new LocalMcpCanvasClient(app.mcp, { actorId: 'failure-recursive-agent', role: 'owner' }), trace })
    const result = await runtime.run({
      runId: 'recursive-failure-run', goal: 'Verify full parent recovery.', parentCanvasId: app.rootCanvas.id,
      portal: { objectId: 'failure-portal', childCanvasId: 'failure-child-canvas', title: 'Failure Child' },
      childGoal: 'Create then fail.', childChecks: [{ type: 'count', role: 'eye', expected: 2, rule: 'two_eyes' }],
      childAgent: new CreateThenFailAgent(), childMaxIterations: 3,
    })
    assert.equal(result.status, 'failed')
    assert.equal(result.restoredParentSnapshot, true)
    assert.equal(app.store.listObjects(app.rootCanvas.id).length, 0)
    assert.throws(() => app.store.getObject('failure-portal'), /not found/i)
    assert.throws(() => app.store.getCanvas('failure-child-canvas'), /not found/i)
    assert.ok(trace.events.some(event => event.type === 'parent_snapshot_restored'))
  } finally { await app.close() }
})

test('MCP fold_subcanvas and get_lineage expose recursive state as typed tools', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const owner = new LocalMcpCanvasClient(app.mcp, { actorId: 'fold-owner', role: 'owner' })
    const opened = await owner.callTool('canvas.open_subcanvas', { canvasId: app.rootCanvas.id, create: { objectId: 'fold-portal', childCanvasId: 'fold-child', title: 'Fold Child' } })
    assert.equal(opened.ok, true)
    const folded = await owner.callTool('canvas.fold_subcanvas', { objectId: 'fold-portal', summary: 'Fold Child ✓ · 0 objects', childRunId: 'child-run', status: 'completed', issueCount: 0 })
    assert.equal(folded.ok, true)
    assert.equal(app.store.getObject('fold-portal').metadata.foldState, 'folded')
    const lineage = await owner.callTool('canvas.get_lineage', { canvasId: 'fold-child' })
    assert.equal(lineage.ok, true)
    assert.deepEqual(lineage.data.canvasIds, [app.rootCanvas.id, 'fold-child'])
    assert.deepEqual(lineage.data.portalObjectIds, ['fold-portal'])
    const viewer = new LocalMcpCanvasClient(app.mcp, { actorId: 'fold-viewer', role: 'viewer' })
    const denied = await viewer.callTool('canvas.fold_subcanvas', { objectId: 'fold-portal', summary: 'bad', childRunId: 'bad', status: 'completed', issueCount: 0 })
    assert.equal(denied.ok, false)
    assert.equal(denied.error.code, 'PERMISSION_DENIED')
  } finally { await app.close() }
})

test('Phase 6 web endpoint runs recursive NVCL and publishes a trajectory resource', async () => {
  const app = createPhase6Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  try {
    const response = await fetch(`${started.url}/api/nvcl/recursive`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.status, 'completed')
    assert.equal(result.fold.childObjectCount, 5)
    assert.match(result.trajectoryUri, /\/trajectory\//)
    const state = await fetch(`${started.url}/api/state?canvasId=${encodeURIComponent(result.childCanvasId)}`).then(r => r.json())
    assert.equal(state.objects.length, 5)
    const render = await fetch(`${started.url}/api/render.svg?canvasId=${encodeURIComponent(result.childCanvasId)}`)
    assert.equal(render.status, 200)
    assert.match(await render.text(), /Character Detail/)
  } finally { await app.close() }
})

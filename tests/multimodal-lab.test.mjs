import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase7Server } from '../dist/apps/web/src/server.js'
import { LocalMcpCanvasClient } from '../dist/packages/nvcl-runtime/src/index.js'

async function withServer(run) {
  const app = createPhase7Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  try {
    await run(app, started.url)
  } finally {
    await app.close()
  }
}

test('pixel observation exposes an immutable frame without structured objects', async () => {
  await withServer(async (app, url) => {
    const observation = await app.lab.observe('pixel')
    assert.equal(observation.mode, 'pixel')
    assert.equal(observation.objects, undefined)
    assert.equal(observation.oracleAvailable, false)
    assert.match(observation.renderSha256, /^[a-f0-9]{64}$/)

    const frame = await fetch(`${url}${observation.renderUri}`)
    assert.equal(frame.status, 200)
    assert.equal(frame.headers.get('x-mrmic-frame-id'), observation.frameId)
    assert.equal(frame.headers.get('x-mrmic-render-sha256'), observation.renderSha256)
    assert.match(await frame.text(), /<svg/)
  })
})

test('fresh action records action ID, frame hashes and a guarded transition', async () => {
  await withServer(async app => {
    const before = await app.lab.observe('structured')
    const action = {
      actionId: 'action-create-rectangle',
      frameId: before.frameId,
      canvasId: before.canvasId,
      expectedCanvasRevision: before.canvasRevision,
      type: 'create',
      object: {
        objectId: 'lab-rectangle',
        type: 'rectangle',
        transform: { x: 100, y: 100, width: 180, height: 90 },
        style: { fill: '#f97316', stroke: '#9a3412', strokeWidth: 3 },
      },
    }
    const result = await app.lab.execute(action, 'hybrid')
    assert.equal(result.evidence.actionId, action.actionId)
    assert.equal(result.evidence.inputFrameId, before.frameId)
    assert.equal(result.evidence.transitionGuard, 'passed')
    assert.equal(result.evidence.verifiedChange, true)
    assert.notEqual(result.evidence.beforeStateHash, result.evidence.afterStateHash)
    assert.notEqual(result.evidence.beforeRenderSha256, result.evidence.afterRenderSha256)
    assert.equal(result.observation.canvasRevision, 1)
    assert.equal(result.observation.objects, undefined)

    const replay = await app.lab.execute(action, 'hybrid')
    assert.equal(replay.idempotentReplay, true)
    assert.equal(app.store.listObjects(app.rootCanvas.id).length, 1)
    await assert.rejects(
      () => app.lab.execute({ ...action, object: { ...action.object, objectId: 'different-object' } }, 'hybrid'),
      error => error?.code === 'ACTION_ID_REUSED',
    )
  })
})

test('a superseded frame fails closed before a second action', async () => {
  await withServer(async app => {
    const frame = await app.lab.observe('pixel')
    await app.lab.execute({
      actionId: 'first-action',
      frameId: frame.frameId,
      canvasId: frame.canvasId,
      expectedCanvasRevision: frame.canvasRevision,
      type: 'create',
      object: { objectId: 'first-object', type: 'ellipse', transform: { x: 20, y: 20, width: 50, height: 50 } },
    })
    await assert.rejects(
      () => app.lab.execute({
        actionId: 'stale-action',
        frameId: frame.frameId,
        canvasId: frame.canvasId,
        expectedCanvasRevision: frame.canvasRevision,
        type: 'move',
        objectId: 'first-object',
        x: 100,
        y: 100,
      }),
      error => error?.code === 'REVISION_CONFLICT',
    )
  })
})

test('benchmark supports visual move, deterministic verification, undo and redo', async () => {
  await withServer(async app => {
    const initial = await app.lab.observe('hybrid')
    const reset = await app.lab.resetBenchmark('benchmark-reset', initial.frameId)
    const resetReplay = await app.lab.resetBenchmark('benchmark-reset', initial.frameId)
    assert.equal(resetReplay.idempotentReplay, true)
    assert.equal(app.lab.trajectory.length, 1)
    assert.equal(app.lab.verifyBenchmark().passed, false)

    const move = await app.lab.execute({
      actionId: 'move-red-into-blue',
      frameId: reset.observation.frameId,
      canvasId: reset.observation.canvasId,
      expectedCanvasRevision: reset.observation.canvasRevision,
      type: 'move',
      objectId: 'benchmark-red-circle',
      x: 510,
      y: 230,
    })
    assert.equal(app.lab.verifyBenchmark().passed, true)

    const undone = await app.lab.undo('undo-red-move', move.observation.frameId)
    assert.equal(undone.evidence.transitionGuard, 'passed')
    assert.equal(app.lab.verifyBenchmark().passed, false)

    const redone = await app.lab.redo('redo-red-move', undone.observation.frameId)
    assert.equal(redone.evidence.transitionGuard, 'passed')
    assert.equal(app.lab.verifyBenchmark().passed, true)
    assert.equal(app.lab.trajectory.at(-1).actionType, 'redo')
  })
})

test('Phase 7 HTTP lab endpoints preserve pixel and oracle separation', async () => {
  await withServer(async (_app, url) => {
    const pixel = await fetch(`${url}/api/lab/observe?mode=pixel`).then(response => response.json())
    assert.equal(pixel.observation.objects, undefined)

    const structured = await fetch(`${url}/api/lab/observe?mode=structured`).then(response => response.json())
    assert.ok(Array.isArray(structured.observation.objects))

    const resetResponse = await fetch(`${url}/api/lab/benchmark/reset`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionId: 'http-reset', frameId: structured.observation.frameId, mode: 'hybrid' }),
    })
    assert.equal(resetResponse.status, 200)
    const reset = await resetResponse.json()
    assert.equal(reset.evidence.freshnessVerified, true)
    assert.equal(reset.evidence.transitionGuard, 'passed')

    const verification = await fetch(`${url}/api/lab/benchmark/verify`).then(response => response.json())
    assert.equal(verification.verification.passed, false)
    const trajectory = await fetch(`${url}/api/lab/trajectory`).then(response => response.json())
    assert.equal(trajectory.trajectory.length, 1)
  })
})

test('MCP exposes the freshness-bound lab loop to local AI clients', async () => {
  await withServer(async app => {
    const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'phase7-mcp-agent', role: 'owner' })
    const observed = await client.callTool('lab.observe', { mode: 'pixel' })
    assert.equal(observed.ok, true)
    assert.equal(observed.data.observation.objects, undefined)

    const reset = await client.callTool('lab.reset_benchmark', {
      actionId: 'mcp-benchmark-reset',
      frameId: observed.data.observation.frameId,
      mode: 'hybrid',
    })
    assert.equal(reset.ok, true)
    assert.equal(reset.data.evidence.transitionGuard, 'passed')

    const frame = reset.data.observation
    const moved = await client.callTool('lab.act', {
      mode: 'hybrid',
      action: {
        actionId: 'mcp-move-red-circle',
        frameId: frame.frameId,
        canvasId: frame.canvasId,
        expectedCanvasRevision: frame.canvasRevision,
        type: 'move',
        objectId: 'benchmark-red-circle',
        x: 510,
        y: 230,
      },
    })
    assert.equal(moved.ok, true)
    assert.equal(moved.data.evidence.freshnessVerified, true)
    assert.equal(moved.data.evidence.transitionGuard, 'passed')
    const verified = await client.callTool('lab.verify_benchmark', {})
    assert.equal(verified.data.verification.passed, true)
    const trajectory = await client.callTool('lab.get_trajectory', {})
    assert.equal(trajectory.data.trajectory.length, 2)
  })
})

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

test('immutable SVG frames rasterize to full and cropped PNG observations', async () => {
  await withServer(async app => {
    const observation = await app.lab.observe('pixel')
    const full = await app.lab.rasterize(observation.frameId)
    assert.equal(full.observation.frameId, observation.frameId)
    assert.equal(full.observation.mimeType, 'image/png')
    assert.equal(full.observation.width, observation.width)
    assert.equal(full.observation.height, observation.height)
    assert.equal(full.observation.sourceRenderSha256, observation.renderSha256)
    assert.match(full.observation.sha256, /^[a-f0-9]{64}$/)
    assert.equal(Buffer.from(full.png).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')

    const crop = await app.lab.rasterize(observation.frameId, { x: 20, y: 30, width: 240, height: 160 })
    assert.deepEqual(crop.observation.crop, { x: 20, y: 30, width: 240, height: 160 })
    assert.equal(crop.observation.width, 240)
    assert.equal(crop.observation.height, 160)
    assert.notEqual(crop.observation.sha256, full.observation.sha256)
    assert.deepEqual(app.lab.raster(crop.observation.rasterId).observation, crop.observation)
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

test('a viewport change invalidates old pixel coordinates before any action executes', async () => {
  await withServer(async app => {
    const frame = await app.lab.observe('pixel')
    await app.adapter.setViewport({ ...frame.viewport, x: frame.viewport.x + 80 })

    await assert.rejects(
      () => app.lab.execute({
        actionId: 'stale-viewport-action',
        frameId: frame.frameId,
        canvasId: frame.canvasId,
        expectedCanvasRevision: frame.canvasRevision,
        type: 'gesture',
        gesture: 'click',
        x: 100,
        y: 100,
        requestedAction: 'delete',
      }, 'pixel'),
      error => error?.code === 'STALE_FRAME' && /viewport/.test(error.message),
    )
    assert.equal(app.lab.trajectory.some(item => item.actionId === 'stale-viewport-action'), false)
  })
})

test('viewport actions require a real visual transition and record changed render evidence', async () => {
  await withServer(async app => {
    const frame = await app.lab.observe('pixel')
    await assert.rejects(
      () => app.lab.execute({
        actionId: 'no-op-viewport',
        frameId: frame.frameId,
        canvasId: frame.canvasId,
        expectedCanvasRevision: frame.canvasRevision,
        type: 'viewport',
        viewport: frame.viewport,
      }, 'pixel'),
      error => error?.code === 'INVALID_ACTION' && /must change/.test(error.message),
    )
    assert.equal(app.lab.trajectory.some(item => item.actionId === 'no-op-viewport'), false)

    const changed = await app.lab.execute({
      actionId: 'changed-viewport',
      frameId: frame.frameId,
      canvasId: frame.canvasId,
      expectedCanvasRevision: frame.canvasRevision,
      type: 'viewport',
      viewport: { ...frame.viewport, x: frame.viewport.x + 80 },
    }, 'pixel')
    assert.equal(changed.evidence.transitionGuard, 'passed')
    assert.equal(changed.evidence.verifiedChange, true)
    assert.notEqual(changed.evidence.beforeRenderSha256, changed.evidence.afterRenderSha256)
  })
})

test('rapid sustained observation keeps immutable frame history bounded and fails closed on eviction', async () => {
  await withServer(async app => {
    const oldest = await app.lab.observe('pixel')
    let newest = oldest
    for (let index = 0; index < 201; index += 1) newest = await app.lab.observe('pixel')
    assert.equal(app.lab.frame(oldest.frameId), undefined)
    assert.equal(app.lab.frame(newest.frameId)?.observation.frameId, newest.frameId)
    await assert.rejects(
      () => app.lab.execute({
        actionId: 'evicted-frame-action',
        frameId: oldest.frameId,
        canvasId: oldest.canvasId,
        expectedCanvasRevision: oldest.canvasRevision,
        type: 'viewport',
        viewport: { ...oldest.viewport, x: oldest.viewport.x + 1 },
      }, 'pixel'),
      error => error?.code === 'FRAME_NOT_FOUND',
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

test('pixel-native drag resolves a target by fresh frame coordinates without object ID input', async () => {
  await withServer(async app => {
    const initial = await app.lab.observe('pixel')
    const reset = await app.lab.resetBenchmark('gesture-benchmark-reset', initial.frameId, 'pixel')
    const action = {
      actionId: 'gesture-drag-red-into-blue',
      frameId: reset.observation.frameId,
      canvasId: reset.observation.canvasId,
      expectedCanvasRevision: reset.observation.canvasRevision,
      type: 'gesture',
      coordinateSpace: 'normalized_frame',
      gesture: {
        kind: 'drag',
        from: { x: 145 / reset.observation.width, y: 285 / reset.observation.height },
        to: { x: 565 / reset.observation.width, y: 285 / reset.observation.height },
      },
    }
    assert.equal(JSON.stringify(action).includes('objectId'), false)
    const result = await app.lab.execute(action, 'pixel')
    assert.equal(result.observation.objects, undefined)
    assert.equal(result.evidence.actionType, 'gesture')
    assert.equal(result.evidence.gesture.kind, 'drag')
    assert.equal(result.evidence.gesture.hitTestVerified, true)
    assert.equal(result.evidence.gesture.resolvedObjectCount, 1)
    assert.deepEqual(result.evidence.affectedObjectIds, ['benchmark-red-circle'])
    assert.equal(result.evidence.transitionGuard, 'passed')
    assert.equal(app.lab.verifyBenchmark().passed, true)

    const replay = await app.lab.execute(action, 'pixel')
    assert.equal(replay.idempotentReplay, true)
  })
})

test('Phase 8 HTTP lab endpoints preserve pixel and oracle separation', async () => {
  await withServer(async (_app, url) => {
    const pixel = await fetch(`${url}/api/lab/observe?mode=pixel`).then(response => response.json())
    assert.equal(pixel.observation.objects, undefined)
    const png = await fetch(`${url}${pixel.observation.rasterUri}`)
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.equal(png.headers.get('x-mrmic-frame-id'), pixel.observation.frameId)
    assert.equal(Buffer.from(await png.arrayBuffer()).subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    const crop = await fetch(`${url}${pixel.observation.rasterUri}?x=10&y=20&width=120&height=80`)
    assert.equal(crop.status, 200)
    assert.equal(crop.headers.get('content-type'), 'image/png')

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
    const rasterized = await client.callTool('lab.rasterize', {
      frameId: observed.data.observation.frameId,
      crop: { x: 10, y: 20, width: 160, height: 100 },
    })
    assert.equal(rasterized.ok, true)
    assert.equal(rasterized.data.observation.mimeType, 'image/png')
    assert.equal(rasterized.data.observation.width, 160)
    const rasterResource = await client.readResource(rasterized.resourceLinks[0])
    assert.equal(rasterResource[0].mimeType, 'image/png')
    assert.equal(typeof rasterResource[0].blob, 'string')

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

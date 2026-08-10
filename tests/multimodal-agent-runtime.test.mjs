import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase8Server } from '../dist/apps/web/src/server.js'
import {
  MultimodalAgentRuntime,
  SequenceMultimodalProvider,
  projectGestureFromRaster,
  validateProviderResponse,
} from '../dist/packages/multimodal-agent-runtime/src/index.js'

async function withLab(run) {
  const app = createPhase8Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  try {
    await run(app)
  } finally {
    app.mcp.close()
    app.ledger.close()
    app.syncLedger.close()
  }
}

const dragDecision = {
  model: 'pixel-protocol-fixture',
  usage: {
    inputTokens: 120,
    cachedInputTokens: 20,
    outputTokens: 32,
    reasoningOutputTokens: 8,
    totalTokens: 160,
  },
  decision: {
    type: 'gesture',
    coordinateSpace: 'normalized_frame',
    gesture: {
      kind: 'drag',
      from: { x: 145 / 1200, y: 285 / 800 },
      to: { x: 565 / 1200, y: 285 / 800 },
    },
    confidence: 1,
    summary: 'Move the visible red circle into the visible blue zone.',
  },
}

test('pixel agent closes observe-raster-decide-gesture-guard-verify without object identifiers', async () => {
  await withLab(async app => {
    const provider = new SequenceMultimodalProvider([dragDecision], 'phase8-pixel-fixture')
    const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider })
    const result = await runtime.run({
      runId: 'pixel-native-success',
      goal: 'Move the red circle completely inside the blue frame.',
      maxIterations: 2,
    })
    assert.equal(result.status, 'completed')
    assert.equal(result.success, true)
    assert.equal(result.steps.length, 1)
    assert.equal(result.steps[0].evidence.actionType, 'gesture')
    assert.equal(result.steps[0].evidence.gesture.kind, 'drag')
    assert.equal(result.steps[0].evidence.transitionGuard, 'passed')
    assert.equal(result.steps[0].benchmarkPassed, true)
    assert.equal(result.metrics.actions, 1)
    assert.equal(result.metrics.providerCalls, 1)
    assert.equal(result.metrics.usage.totalTokens, 160)

    assert.equal(provider.requests.length, 1)
    const request = provider.requests[0]
    assert.equal(JSON.stringify(request).includes('objectId'), false)
    assert.equal(request.frame.mimeType, 'image/png')
    assert.equal(Buffer.from(request.frame.imageBase64, 'base64').subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
    assert.deepEqual(Object.keys(request.frame).sort(), [
      'frameId', 'height', 'imageBase64', 'imageSha256', 'mimeType', 'sourceRenderSha256', 'width',
    ])
  })
})

test('provider output cannot smuggle object identifiers into the pixel lane', () => {
  assert.throws(
    () => validateProviderResponse({
      decision: {
        type: 'gesture',
        coordinateSpace: 'normalized_frame',
        gesture: {
          kind: 'drag',
          objectId: 'benchmark-red-circle',
          from: { x: 0.1, y: 0.2 },
          to: { x: 0.5, y: 0.2 },
        },
        confidence: 0.9,
        summary: 'invalid',
      },
    }),
    /forbidden identifier field/,
  )
})

test('invalid model confidence and unsupported gestures fail before any action', async () => {
  await withLab(async app => {
    const provider = new SequenceMultimodalProvider([{
      decision: {
        type: 'gesture',
        coordinateSpace: 'normalized_frame',
        gesture: { kind: 'teleport', at: { x: 0.2, y: 0.3 } },
        confidence: 2,
        summary: 'invalid',
      },
    }])
    const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider })
    await assert.rejects(
      () => runtime.run({ runId: 'invalid-provider-output', goal: 'Do not execute invalid output.', maxIterations: 1 }),
      /confidence must be within/,
    )
    assert.equal(app.lab.trajectory.filter(item => item.actionType === 'gesture').length, 0)
  })
})

test('cropped raster gestures are projected back into immutable full-frame coordinates', async () => {
  await withLab(async app => {
    const provider = new SequenceMultimodalProvider([{
      decision: {
        type: 'gesture',
        coordinateSpace: 'normalized_frame',
        gesture: {
          kind: 'drag',
          from: { x: (145 - 50) / 700, y: (285 - 150) / 300 },
          to: { x: (565 - 50) / 700, y: (285 - 150) / 300 },
        },
        confidence: 1,
        summary: 'Drag in cropped raster coordinates',
      },
    }])
    const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider })
    const result = await runtime.run({
      goal: 'Move the red circle into the blue zone',
      maxIterations: 1,
      crop: { x: 50, y: 150, width: 700, height: 300 },
    })
    assert.equal(result.success, true)
    assert.equal(provider.requests[0].frame.width, 700)
    assert.equal(provider.requests[0].frame.height, 300)
    assert.deepEqual(provider.requests[0].frame.crop, { x: 50, y: 150, width: 700, height: 300 })
    assert.ok(Math.abs(result.steps[0].evidence.gesture.framePoints[0].x - 145 / 1200) < 1e-9)
    assert.ok(Math.abs(result.steps[0].evidence.gesture.framePoints[1].x - 565 / 1200) < 1e-9)
  })
})

test('pixel crop projection supports frame-pixel coordinates without exposing IDs', () => {
  const gesture = projectGestureFromRaster(
    { kind: 'delete', at: { x: 20, y: 30 } },
    'frame_pixel',
    { width: 1200, height: 800 },
    { x: 100, y: 200, width: 300, height: 250 },
  )
  assert.deepEqual(gesture, { kind: 'delete', at: { x: 120, y: 230 } })
})

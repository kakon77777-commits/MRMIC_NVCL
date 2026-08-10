import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase8Server } from '../dist/apps/web/src/server.js'
import {
  MultimodalAgentRuntime,
  ObservationGovernor,
  SequenceMultimodalProvider,
  SustainedObservationBenchmarkRunner,
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

test('observation governor skips static frames, selects ROI for local change, and periodically resynchronizes', async () => {
  await withLab(async app => {
    const governor = new ObservationGovernor({
      lab: app.lab,
      differenceThreshold: 0.0001,
      blockDifferenceThreshold: 0.02,
      keyframeInterval: 4,
      maxRoiFraction: 0.9,
      roiPaddingPx: 24,
    })
    const initial = await app.lab.observe('pixel')
    const reset = await app.lab.resetBenchmark('governor-reset', initial.frameId, 'pixel')
    const first = await governor.observe(reset.observation.frameId)
    assert.equal(first.disposition, 'keyframe')
    assert.ok(first.raster)
    assert.equal(first.raster.perceptualSignature.width, 32)
    assert.equal(first.raster.perceptualSignature.samples.length, 32 * 32 * 3)

    const staticObservation = await app.lab.observe('pixel')
    const second = await governor.observe(staticObservation.frameId)
    assert.equal(second.disposition, 'skip')
    assert.equal(second.differenceScore, 0)
    assert.equal(second.raster, undefined)

    const moved = await app.lab.execute({
      actionId: 'governor-local-move',
      frameId: staticObservation.frameId,
      canvasId: staticObservation.canvasId,
      expectedCanvasRevision: staticObservation.canvasRevision,
      type: 'gesture',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'drag', from: { x: 145, y: 285 }, to: { x: 265, y: 285 } },
    }, 'pixel')
    const third = await governor.observe(moved.observation.frameId)
    assert.equal(third.disposition, 'roi')
    assert.ok(third.differenceScore > 0)
    assert.ok(third.changedFraction > 0)
    assert.ok(third.crop.width < moved.observation.width)
    assert.deepEqual(third.raster.observation.crop, third.crop)

    const fourthObservation = await app.lab.observe('pixel')
    assert.equal((await governor.observe(fourthObservation.frameId)).disposition, 'skip')
    const fifthObservation = await app.lab.observe('pixel')
    const fifth = await governor.observe(fifthObservation.frameId)
    assert.equal(fifth.disposition, 'keyframe')
    assert.equal(fifth.reason, 'periodic_resynchronization')
  })
})

test('stale Provider coordinates are recorded, rejected, and regenerated from a fresh keyframe', async () => {
  let now = 0
  const app = createPhase8Server({
    port: 0,
    databasePath: ':memory:',
    syncDatabasePath: ':memory:',
    labLeaseTtlMs: 50,
    now: () => now,
  })
  const requests = []
  const provider = {
    name: 'stale-recovery-provider',
    async generate(request) {
      requests.push(structuredClone(request))
      if (requests.length === 1) now = 100
      return structuredClone(dragDecision)
    },
  }
  try {
    const governor = new ObservationGovernor({ lab: app.lab, keyframeInterval: 8 })
    const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider, governor, now: () => now })
    const result = await runtime.run({
      runId: 'stale-recovery',
      goal: 'Move the red circle into the blue frame',
      maxIterations: 2,
      adaptiveObservation: true,
    })
    assert.equal(result.success, true)
    assert.equal(result.metrics.providerCalls, 2)
    assert.equal(result.metrics.actions, 1)
    assert.equal(result.metrics.staleFrameRejections, 1)
    assert.equal(result.metrics.corrections, 1)
    assert.equal(result.steps[0].actionRejectedCode, 'STALE_FRAME')
    assert.equal(result.steps[0].evidence, undefined)
    assert.equal(result.steps[1].observationDisposition, 'keyframe')
    assert.equal(result.steps[1].evidence.freshnessVerified, true)
    assert.notEqual(requests[0].frame.frameId, requests[1].frame.frameId)
  } finally {
    app.mcp.close()
    app.ledger.close()
    app.syncLedger.close()
  }
})

test('measured Token budget stops before a second Provider call', async () => {
  await withLab(async app => {
    const provider = new SequenceMultimodalProvider([{
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100 },
      decision: {
        type: 'gesture',
        coordinateSpace: 'frame_pixel',
        gesture: { kind: 'drag', from: { x: 145, y: 285 }, to: { x: 185, y: 285 } },
        confidence: 1,
        summary: 'A valid but insufficient move',
      },
    }])
    const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider })
    const result = await runtime.run({
      runId: 'token-budget',
      goal: 'Move the red circle into the blue frame',
      maxIterations: 3,
      maxTotalTokens: 50,
    })
    assert.equal(result.status, 'stopped')
    assert.equal(result.success, false)
    assert.equal(result.metrics.providerCalls, 1)
    assert.equal(result.metrics.actions, 1)
    assert.equal(result.metrics.tokenBudgetStops, 1)
    assert.equal(result.metrics.usage.totalTokens, 100)
    assert.match(result.reason, /Token budget 50 exhausted/)
  })
})

test('seeded sustained-observation benchmark reduces payload and preserves periodic keyframes', async () => {
  await withLab(async app => {
    const governor = new ObservationGovernor({
      lab: app.lab,
      differenceThreshold: 0.0001,
      blockDifferenceThreshold: 0.02,
      keyframeInterval: 8,
      maxRoiFraction: 0.45,
      roiPaddingPx: 24,
    })
    const runner = new SustainedObservationBenchmarkRunner({ lab: app.lab, governor })
    const result = await runner.run({ runId: 'sustained-seed-42', seed: 42 })
    assert.equal(result.steps.length, 9)
    assert.equal(result.steps[0].disposition, 'keyframe')
    assert.equal(result.steps.at(-1).disposition, 'keyframe')
    assert.equal(result.steps.at(-1).reason, 'periodic_resynchronization')
    assert.ok(result.counts.skip >= 4)
    assert.equal(result.counts.roi, 2)
    assert.ok(result.counts.full_frame >= 1)
    assert.equal(result.providerCallsAvoided, result.counts.skip)
    assert.ok(result.governedBytes < result.alwaysFullBytes)
    assert.ok(result.savedBytes > 0)
    assert.ok(result.savedPercent > 0)
    assert.equal(JSON.stringify(result).includes('objectId'), false)
  })
})

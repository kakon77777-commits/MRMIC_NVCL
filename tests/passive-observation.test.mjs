import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase10Server } from '../dist/apps/web/src/server.js'
import {
  ObservationGovernor,
  PassiveObservationScheduler,
  PassiveSceneBenchmarkRunner,
} from '../dist/packages/multimodal-agent-runtime/src/index.js'

function createLab(now) {
  return createPhase10Server({
    port: 0,
    databasePath: ':memory:',
    syncDatabasePath: ':memory:',
    now,
  })
}

function closeLab(app) {
  app.mcp.close()
  app.ledger.close()
  app.syncLedger.close()
}

function createGovernor(app, overrides = {}) {
  return new ObservationGovernor({
    lab: app.lab,
    differenceThreshold: 0.0001,
    blockDifferenceThreshold: 0.02,
    keyframeInterval: 50,
    maxRoiFraction: 0.9,
    roiPaddingPx: 24,
    ...overrides,
  })
}

test('passive observation coalesces a rapid visual burst without leaking object identifiers', async () => {
  let clock = 0
  const now = () => clock
  const app = createLab(now)
  try {
    const blank = await app.lab.observe('pixel')
    await app.lab.resetBenchmark('phase10-burst-reset', blank.frameId, 'pixel')
    const scheduler = new PassiveObservationScheduler({
      lab: app.lab,
      governor: createGovernor(app),
      timelineId: 'burst-coalescing',
      coalesceWindowMs: 200,
      maxCoalescedRoiFraction: 0.9,
      now,
    })

    const initial = await scheduler.sample()
    assert.equal(initial.emitted.length, 1)
    assert.equal(initial.emitted[0].disposition, 'keyframe')
    assert.equal(initial.sample.sceneEpoch, 1)

    clock += 50
    const moved = await app.lab.execute({
      actionId: 'phase10-burst-move',
      frameId: initial.sample.observation.frameId,
      canvasId: initial.sample.observation.canvasId,
      expectedCanvasRevision: initial.sample.observation.canvasRevision,
      type: 'gesture',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'drag', from: { x: 145, y: 285 }, to: { x: 235, y: 285 } },
    }, 'pixel')
    const firstChange = await scheduler.sample()
    assert.equal(firstChange.sample.observation.canvasRevision, moved.observation.canvasRevision)
    assert.equal(firstChange.sample.observation.renderSha256, moved.observation.renderSha256)
    assert.equal(firstChange.sample.sceneChanged, true)
    assert.equal(firstChange.emitted.length, 0)

    clock += 50
    await app.lab.execute({
      actionId: 'phase10-burst-restyle',
      frameId: firstChange.sample.observation.frameId,
      canvasId: firstChange.sample.observation.canvasId,
      expectedCanvasRevision: firstChange.sample.observation.canvasRevision,
      type: 'gesture',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'restyle',
        at: { x: 235, y: 285 },
        style: { fill: '#7c3aed', stroke: '#4c1d95', strokeWidth: 5 },
      },
    }, 'pixel')
    const secondChange = await scheduler.sample()
    assert.equal(secondChange.sample.sceneChanged, true)
    assert.equal(secondChange.emitted.length, 0)

    clock += 250
    const settled = await scheduler.sample()
    assert.equal(settled.sample.governance.disposition, 'skip')
    assert.equal(settled.emitted.length, 1)
    const event = settled.emitted[0]
    assert.equal(event.reason, 'coalesced_visual_burst')
    assert.equal(event.sampleCount, 2)
    assert.equal(event.sceneEpochStart, 2)
    assert.equal(event.sceneEpochEnd, 3)
    assert.equal(event.sampleIndexStart, 2)
    assert.equal(event.sampleIndexEnd, 3)
    assert.equal(event.resynchronization, false)
    assert.ok(event.raster.byteLength > 0)
    assert.equal(JSON.stringify(event).includes('objectId'), false)
    assert.equal(JSON.stringify(event).includes('imageBase64'), false)
    assert.equal(scheduler.stats.coalescedSamples, 1)
    assert.equal(scheduler.stats.sceneChanges, 3)
    assert.equal(scheduler.stats.pendingSamples, 0)
  } finally {
    closeLab(app)
  }
})

test('passive run suppresses static frames and emits bounded periodic keyframes', async () => {
  let clock = 0
  const now = () => clock
  const app = createLab(now)
  try {
    const observedEvents = []
    const scheduler = new PassiveObservationScheduler({
      lab: app.lab,
      governor: createGovernor(app, { keyframeInterval: 4 }),
      timelineId: 'static-periodic-keyframe',
      now,
      sleep: async milliseconds => { clock += milliseconds },
    })
    const result = await scheduler.run({
      maxSamples: 5,
      sampleIntervalMs: 100,
      onEvent: event => observedEvents.push(event),
    })

    assert.equal(result.status, 'completed')
    assert.equal(result.events.length, 2)
    assert.deepEqual(result.events.map(event => event.disposition), ['keyframe', 'keyframe'])
    assert.equal(result.events[1].reason, 'periodic_resynchronization')
    assert.equal(result.stats.samples, 5)
    assert.equal(result.stats.keyframes, 2)
    assert.equal(result.stats.skippedFrames, 3)
    assert.equal(result.stats.sceneEpoch, 1)
    assert.equal(result.stats.sceneChanges, 1)
    assert.equal(result.stats.emittedEvents, 2)
    assert.equal(observedEvents.length, 2)
    assert.equal(result.stats.elapsedMs, 400)
  } finally {
    closeLab(app)
  }
})

test('passive reset isolates timeline statistics, scene epochs, and governor history', async () => {
  let clock = 1_000
  const now = () => clock
  const app = createLab(now)
  try {
    const scheduler = new PassiveObservationScheduler({
      lab: app.lab,
      governor: createGovernor(app),
      timelineId: 'reset-isolation',
      now,
    })
    await scheduler.sample()
    clock += 25
    await scheduler.sample()
    assert.equal(scheduler.stats.samples, 2)

    scheduler.reset()
    assert.equal(scheduler.timeline.length, 0)
    assert.equal(scheduler.stats.samples, 0)
    assert.equal(scheduler.stats.sceneEpoch, 0)
    assert.equal(scheduler.stats.elapsedMs, 0)

    clock += 10
    const restarted = await scheduler.sample()
    assert.equal(restarted.sample.sampleIndex, 1)
    assert.equal(restarted.sample.sceneEpoch, 1)
    assert.equal(restarted.sample.governance.sequence, 1)
    assert.equal(restarted.emitted[0].eventIndex, 1)
    assert.equal(restarted.emitted[0].disposition, 'keyframe')
  } finally {
    closeLab(app)
  }
})

test('generated fixed and held-out passive timelines preserve guarded multi-action evidence', async () => {
  let clock = 10_000
  const now = () => clock
  const app = createLab(now)
  try {
    const scheduler = new PassiveObservationScheduler({
      lab: app.lab,
      governor: createGovernor(app, { keyframeInterval: 10, maxRoiFraction: 0.35 }),
      timelineId: 'generated-multi-action',
      coalesceWindowMs: 200,
      maxCoalescedRoiFraction: 0.55,
      now,
    })
    const runner = new PassiveSceneBenchmarkRunner({
      lab: app.lab,
      scheduler,
      advanceTime: milliseconds => { clock += milliseconds },
    })
    const fixed = await runner.run({ runId: 'phase10-fixed-42', seed: 42, seedClass: 'fixed' })
    const heldOut = await runner.run({ runId: 'phase10-held-out-65537', seed: 65_537, seedClass: 'held_out' })

    for (const result of [fixed, heldOut]) {
      assert.equal(result.protocolVersion, 'mrmic-passive-scene-timeline-v1')
      assert.equal(result.actions, 8)
      assert.equal(result.steps.length, 8)
      assert.equal(result.freshnessPassed, 8)
      assert.equal(result.transitionGuardsPassed, 8)
      assert.equal(result.passed, true)
      assert.equal(result.samples, 11)
      assert.equal(
        result.sceneEpochs,
        1 + result.steps.filter(step => step.observationDisposition !== 'skip').length,
      )
      assert.ok(result.sceneEpochs > 1)
      assert.ok(result.emittedEvents < result.samples)
      assert.ok(result.providerDeliveriesAvoided > 0)
      assert.ok(result.coalescedSamples > 0)
      assert.ok(result.eventCounts.keyframe >= 2)
      assert.ok(result.savedBytes > 0)
      assert.equal(JSON.stringify(result).includes('objectId'), false)
      assert.deepEqual(result.actionKinds, [
        'drag', 'restyle', 'resize', 'type_text', 'draw_path', 'delete', 'pan', 'zoom',
      ])
    }
    assert.notEqual(fixed.planSha256, heldOut.planSha256)
  } finally {
    closeLab(app)
  }
})

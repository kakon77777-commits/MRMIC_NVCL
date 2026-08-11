import { createPhase10Server } from '../../web/src/server.js'
import {
  ObservationGovernor,
  PassiveObservationScheduler,
  PassiveSceneBenchmarkRunner,
  type PassiveBenchmarkSeedClass,
  type PassiveSceneBenchmarkResult,
} from '../../../packages/multimodal-agent-runtime/src/index.js'

const runs: Array<{ seed: number; seedClass: PassiveBenchmarkSeedClass }> = [
  { seed: 7, seedClass: 'fixed' },
  { seed: 42, seedClass: 'fixed' },
  { seed: 2026, seedClass: 'fixed' },
  { seed: 9001, seedClass: 'held_out' },
  { seed: 65_537, seedClass: 'held_out' },
]
const results: PassiveSceneBenchmarkResult[] = []

for (const item of runs) {
  let clock = 1_000_000 + item.seed
  const app = createPhase10Server({
    port: 0,
    databasePath: ':memory:',
    syncDatabasePath: ':memory:',
    now: () => clock,
  })
  try {
    const governor = new ObservationGovernor({
      lab: app.lab,
      differenceThreshold: 0.0001,
      blockDifferenceThreshold: 0.02,
      keyframeInterval: 10,
      maxRoiFraction: 0.35,
      roiPaddingPx: 24,
    })
    const scheduler = new PassiveObservationScheduler({
      lab: app.lab,
      governor,
      timelineId: `phase10-${item.seedClass}-${item.seed}`,
      coalesceWindowMs: 200,
      maxCoalescedRoiFraction: 0.55,
      now: () => clock,
    })
    const runner = new PassiveSceneBenchmarkRunner({
      lab: app.lab,
      scheduler,
      advanceTime: milliseconds => { clock += milliseconds },
    })
    results.push(await runner.run({
      runId: `phase10-${item.seedClass}-${item.seed}`,
      seed: item.seed,
      seedClass: item.seedClass,
    }))
  } finally {
    app.mcp.close()
    app.ledger.close()
    app.syncLedger.close()
  }
}

const alwaysFullBytes = results.reduce((sum, result) => sum + result.alwaysFullBytes, 0)
const deliveredBytes = results.reduce((sum, result) => sum + result.deliveredBytes, 0)
const savedBytes = alwaysFullBytes - deliveredBytes
console.log(JSON.stringify({
  benchmark: 'phase10-passive-scene-timeline',
  protocolVersion: 'mrmic-passive-scene-timeline-v1',
  generatedRuns: runs,
  results,
  aggregate: {
    passedRuns: results.filter(result => result.passed).length,
    actions: results.reduce((sum, result) => sum + result.actions, 0),
    freshnessPassed: results.reduce((sum, result) => sum + result.freshnessPassed, 0),
    transitionGuardsPassed: results.reduce((sum, result) => sum + result.transitionGuardsPassed, 0),
    samples: results.reduce((sum, result) => sum + result.samples, 0),
    sceneEpochs: results.reduce((sum, result) => sum + result.sceneEpochs, 0),
    emittedEvents: results.reduce((sum, result) => sum + result.emittedEvents, 0),
    coalescedSamples: results.reduce((sum, result) => sum + result.coalescedSamples, 0),
    providerDeliveriesAvoided: results.reduce((sum, result) => sum + result.providerDeliveriesAvoided, 0),
    alwaysFullBytes,
    deliveredBytes,
    savedBytes,
    savedPercent: alwaysFullBytes ? savedBytes / alwaysFullBytes * 100 : 0,
  },
}, null, 2))

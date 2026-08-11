import { createPhase11Server } from '../../web/src/server.js'
import {
  ObservationPolicyBenchmarkRunner,
  rankObservationPolicies,
  type ObservationPolicyBenchmarkResult,
  type ObservationPolicyKind,
  type ObservationPolicyScoreInput,
} from '../../../packages/multimodal-agent-runtime/src/index.js'

const policies: ObservationPolicyKind[] = ['always_full', 'static_crop', 'governor_roi', 'passive_timeline']
const seeds: Array<{ seed: number; seedClass: 'fixed' | 'held_out' }> = [
  { seed: 42, seedClass: 'fixed' },
  { seed: 9001, seedClass: 'held_out' },
]
const results: ObservationPolicyBenchmarkResult[] = []

function scoreInput(result: ObservationPolicyBenchmarkResult): ObservationPolicyScoreInput {
  return {
    policy: result.policy,
    actions: result.actions,
    transitionGuardsPassed: result.transitionGuardsPassed,
    perceptualActions: result.perceptualActions,
    perceptuallyDeliveredActions: result.perceptuallyDeliveredActions,
    exactPostStatesRetained: result.exactPostStatesRetained,
    transientStateRetained: result.transientStateRetained,
    alwaysFullBytes: result.alwaysFullBytes,
    deliveredBytes: result.deliveredBytes,
  }
}

for (const fixture of seeds) {
  for (const policy of policies) {
    let clock = 3_000_000 + fixture.seed
    const app = createPhase11Server({
      port: 0,
      databasePath: ':memory:',
      syncDatabasePath: ':memory:',
      now: () => clock,
    })
    try {
      const runner = new ObservationPolicyBenchmarkRunner({
        lab: app.lab,
        policy,
        timelineId: `phase11-${policy}-${fixture.seed}`,
        now: () => clock,
        advanceTime: milliseconds => { clock += milliseconds },
      })
      results.push(await runner.run({
        runId: `phase11-${fixture.seedClass}-${policy}-${fixture.seed}`,
        seed: fixture.seed,
        seedClass: fixture.seedClass,
      }))
    } finally {
      app.mcp.close()
      app.ledger.close()
      app.syncLedger.close()
    }
  }
}

for (const fixture of seeds) {
  const group = results.filter(result => result.seed === fixture.seed)
  if (new Set(group.map(result => result.planSha256)).size !== 1) throw new Error(`Plan mismatch for seed ${fixture.seed}`)
  if (new Set(group.map(result => result.sourceTraceSha256)).size !== 1) throw new Error(`Visual trace mismatch for seed ${fixture.seed}`)
}

const aggregateInputs = policies.map(policy => {
  const group = results.filter(result => result.policy === policy)
  return {
    policy,
    actions: group.reduce((sum, result) => sum + result.actions, 0),
    transitionGuardsPassed: group.reduce((sum, result) => sum + result.transitionGuardsPassed, 0),
    perceptualActions: group.reduce((sum, result) => sum + result.perceptualActions, 0),
    perceptuallyDeliveredActions: group.reduce((sum, result) => sum + result.perceptuallyDeliveredActions, 0),
    exactPostStatesRetained: group.reduce((sum, result) => sum + result.exactPostStatesRetained, 0),
    transientStateRetained: group.every(result => result.transientStateRetained),
    alwaysFullBytes: group.reduce((sum, result) => sum + result.alwaysFullBytes, 0),
    deliveredBytes: group.reduce((sum, result) => sum + result.deliveredBytes, 0),
  } satisfies ObservationPolicyScoreInput
})

console.log(JSON.stringify({
  benchmark: 'phase11-controlled-observation-policy-ab',
  protocolVersion: 'mrmic-observation-policy-ab-v1',
  fixtures: seeds,
  policies,
  runs: results.map(result => ({
    runId: result.runId,
    seed: result.seed,
    seedClass: result.seedClass,
    policy: result.policy,
    planSha256: result.planSha256,
    sourceTraceSha256: result.sourceTraceSha256,
    actions: result.actions,
    freshnessPassed: result.freshnessPassed,
    transitionGuardsPassed: result.transitionGuardsPassed,
    samples: result.samples,
    deliveries: result.deliveries,
    providerDeliveriesAvoided: result.providerDeliveriesAvoided,
    perceptualActions: result.perceptualActions,
    perceptuallyDeliveredActions: result.perceptuallyDeliveredActions,
    fullyCoveredPerceptualActions: result.fullyCoveredPerceptualActions,
    exactPostStatesRetained: result.exactPostStatesRetained,
    tinyMotionDetected: result.tinyMotionDetected,
    transientStateRetained: result.transientStateRetained,
    alwaysFullBytes: result.alwaysFullBytes,
    deliveredBytes: result.deliveredBytes,
    savedPercent: result.savedPercent,
    passed: result.passed,
  })),
  perFixtureRankings: seeds.map(fixture => ({
    seed: fixture.seed,
    ranking: rankObservationPolicies(results.filter(result => result.seed === fixture.seed).map(scoreInput)),
  })),
  aggregateRanking: rankObservationPolicies(aggregateInputs),
}, null, 2))

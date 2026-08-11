import { createPhase12Server } from '../../web/src/server.js'
import {
  ObservationPolicyBenchmarkRunner,
  rankObservationPolicies,
  type ObservationPolicyBenchmarkResult,
  type ObservationPolicyKind,
  type ObservationPolicyScoreInput,
} from '../../../packages/multimodal-agent-runtime/src/index.js'

const policies: ObservationPolicyKind[] = [
  'always_full',
  'static_crop',
  'governor_roi',
  'passive_timeline',
  'hybrid_transient',
]
const fixtures: Array<{ seed: number; seedClass: 'fixed' | 'held_out' }> = [
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

for (const fixture of fixtures) {
  for (const policy of policies) {
    let clock = 4_000_000 + fixture.seed
    const app = createPhase12Server({
      port: 0,
      databasePath: ':memory:',
      syncDatabasePath: ':memory:',
      now: () => clock,
    })
    try {
      const runner = new ObservationPolicyBenchmarkRunner({
        lab: app.lab,
        policy,
        timelineId: `phase12-${policy}-${fixture.seed}`,
        now: () => clock,
        advanceTime: milliseconds => { clock += milliseconds },
      })
      results.push(await runner.run({
        runId: `phase12-${fixture.seedClass}-${policy}-${fixture.seed}`,
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

for (const fixture of fixtures) {
  const group = results.filter(result => result.seed === fixture.seed)
  if (new Set(group.map(result => result.planSha256)).size !== 1
    || new Set(group.map(result => result.sourceTraceSha256)).size !== 1) {
    throw new Error(`Fixture ${fixture.seed} did not preserve identical policy source traces`)
  }
}

const aggregate = policies.map(policy => {
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
  benchmark: 'phase12-transient-preserving-hybrid',
  protocolVersion: 'mrmic-observation-policy-ab-v1',
  fixtures,
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
    exactPostStatesRetained: result.exactPostStatesRetained,
    tinyMotionDetected: result.tinyMotionDetected,
    transientStateRetained: result.transientStateRetained,
    deliveredBytes: result.deliveredBytes,
    savedPercent: result.savedPercent,
    transientBoundaries: result.deliveryTrace.filter(delivery => delivery.reason === 'return_to_recent_visual_state').length,
    passed: result.passed,
  })),
  aggregateRanking: rankObservationPolicies(aggregate),
}, null, 2))

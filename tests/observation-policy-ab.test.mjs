import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase11Server } from '../dist/apps/web/src/server.js'
import {
  ObservationPolicyBenchmarkRunner,
} from '../dist/packages/multimodal-agent-runtime/src/index.js'

const policies = ['always_full', 'static_crop', 'governor_roi', 'passive_timeline']

async function runPolicy(policy, seed = 42) {
  let clock = 2_000_000 + seed
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
      timelineId: `phase11-${policy}-${seed}`,
      now: () => clock,
      advanceTime: milliseconds => { clock += milliseconds },
    })
    return await runner.run({ runId: `phase11-${policy}-${seed}`, seed, seedClass: 'fixed' })
  } finally {
    app.mcp.close()
    app.ledger.close()
    app.syncLedger.close()
  }
}

test('four observation policies run an identical guarded trace with explicit cost and retention tradeoffs', async () => {
  const results = []
  for (const policy of policies) results.push(await runPolicy(policy))
  const comparison = JSON.stringify(results.map(result => ({
    policy: result.policy,
    deliveries: result.deliveries,
    deliveredBytes: result.deliveredBytes,
    perceptualActions: result.perceptualActions,
    fullyCovered: result.fullyCoveredPerceptualActions,
    exactPostStates: result.exactPostStatesRetained,
    transientRetained: result.transientStateRetained,
    tinyMotionDetected: result.tinyMotionDetected,
  })))

  assert.equal(new Set(results.map(result => result.planSha256)).size, 1)
  assert.equal(new Set(results.map(result => result.sourceTraceSha256)).size, 1, comparison)
  for (const result of results) {
    assert.equal(result.protocolVersion, 'mrmic-observation-policy-ab-v1')
    assert.equal(result.actions, 11)
    assert.equal(result.freshnessPassed, 11)
    assert.equal(result.transitionGuardsPassed, 11)
    assert.equal(result.samples, 14)
    assert.equal(result.passed, true)
    assert.equal(JSON.stringify(result).includes('objectId'), false)
    assert.ok(result.perceptualActions > 0)
    assert.ok(result.deliveries <= result.samples)
  }

  const always = results.find(result => result.policy === 'always_full')
  const staticCrop = results.find(result => result.policy === 'static_crop')
  const governor = results.find(result => result.policy === 'governor_roi')
  const passive = results.find(result => result.policy === 'passive_timeline')
  assert.ok(always && staticCrop && governor && passive)

  assert.equal(always.deliveries, always.samples)
  assert.equal(always.deliveredBytes, always.alwaysFullBytes)
  assert.equal(always.savedPercent, 0)
  assert.equal(always.fullyCoveredPerceptualActions, always.perceptualActions)
  assert.equal(always.transientStateRetained, true)

  assert.equal(staticCrop.deliveries, staticCrop.samples)
  assert.ok(staticCrop.deliveredBytes < always.deliveredBytes)
  assert.ok(staticCrop.fullyCoveredPerceptualActions < always.fullyCoveredPerceptualActions)
  assert.equal(staticCrop.transientStateRetained, true)

  assert.ok(governor.deliveries < always.deliveries)
  assert.ok(governor.deliveredBytes < always.deliveredBytes)
  assert.equal(governor.transientStateRetained, true)

  assert.ok(passive.deliveries < governor.deliveries, comparison)
  assert.ok(passive.deliveredBytes < governor.deliveredBytes, comparison)
  assert.equal(passive.transientStateRetained, false, comparison)
  assert.ok(passive.exactPostStatesRetained < governor.exactPostStatesRetained, comparison)
})

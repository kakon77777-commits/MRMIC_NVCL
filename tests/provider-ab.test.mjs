import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase12Server } from '../dist/apps/web/src/server.js'
import {
  RealProviderABRunner,
  authorizeRealProviderAB,
  REAL_PROVIDER_AB_ACKNOWLEDGEMENT,
  validateVisualObservationResponse,
} from '../dist/packages/multimodal-agent-runtime/src/index.js'

class SequenceVisualProvider {
  name = 'sequence-visual-provider'
  requests = []
  #colors = ['red', 'red', 'amber', 'red', 'red', 'red', 'amber', 'red']

  async observeVisual(request) {
    this.requests.push(structuredClone(request))
    const circleColor = this.#colors.shift()
    if (!circleColor) throw new Error('No visual response remains')
    return {
      circleColor,
      targetVisible: request.frame.crop === undefined,
      confidence: 0.99,
      summary: `Visible circle is ${circleColor}`,
      model: 'fixture-vision-v1',
      usage: {
        inputTokens: 80,
        cachedInputTokens: 0,
        outputTokens: 15,
        reasoningOutputTokens: 5,
        totalTokens: 100,
      },
    }
  }
}

function createSession() {
  const app = createPhase12Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  return {
    lab: app.lab,
    close() {
      app.mcp.close()
      app.ledger.close()
      app.syncLedger.close()
    },
  }
}

test('controlled Provider A/B replays identical pixels and measures real-call-shaped Token tradeoffs', async () => {
  const provider = new SequenceVisualProvider()
  const progress = []
  const runner = new RealProviderABRunner({
    createLab: () => createSession(),
    provider,
    maxProviderCalls: 8,
    maxTotalTokens: 1_000,
    requireUsage: true,
    onProgress: checkpoint => progress.push(checkpoint),
  })
  const result = await runner.run('phase12-provider-ab-fixture')
  assert.equal(result.protocolVersion, 'mrmic-real-provider-ab-v1')
  assert.equal(result.sourceTraceIdentical, true)
  assert.equal(result.actionPlanIdentical, true)
  assert.equal(result.model, 'fixture-vision-v1')
  assert.equal(result.totalProviderCalls, 8)
  assert.equal(result.totalUsage.totalTokens, 800)
  assert.equal(result.callsSavedByGovernor, 2)
  assert.equal(result.inputTokensSavedByGovernor, 160)
  assert.equal(result.totalTokensSavedByGovernor, 200)
  assert.equal(result.arms.length, 2)

  const always = result.arms.find(arm => arm.policy === 'always_full')
  const governor = result.arms.find(arm => arm.policy === 'governor_roi')
  assert.ok(always && governor)
  assert.equal(always.samples, 5)
  assert.equal(always.providerCalls, 5)
  assert.equal(always.providerCallsAvoided, 0)
  assert.equal(always.semanticAccuracy, 1)
  assert.equal(governor.samples, 5)
  assert.equal(governor.providerCalls, 3)
  assert.equal(governor.providerCallsAvoided, 2)
  assert.equal(governor.semanticAccuracy, 1)
  assert.equal(governor.freshnessPassed, 2)
  assert.equal(governor.transitionGuardsPassed, 2)
  assert.ok(governor.deliveredBytes < always.deliveredBytes)
  assert.deepEqual(governor.steps.map(step => step.disposition), ['keyframe', 'skip', 'roi', 'roi', 'skip'])
  assert.equal(JSON.stringify(result).includes('objectId'), false)
  assert.equal(provider.requests.length, 8)
  assert.equal(provider.requests.every(request => !JSON.stringify(request).includes('objectId')), true)
  assert.equal(progress.length, 10)
  assert.equal(progress.at(-1).totalProviderCalls, 8)
  assert.equal(progress.at(-1).totalUsage.totalTokens, 800)
  assert.equal(progress.every(checkpoint => !JSON.stringify(checkpoint).includes('objectId')), true)
})

test('visual observation responses fail closed on invalid semantics and identifier fields', () => {
  assert.throws(() => validateVisualObservationResponse({
    circleColor: 'blue', targetVisible: true, confidence: 1, summary: 'invalid',
  }), /circleColor is invalid/)
  assert.throws(() => validateVisualObservationResponse({
    circleColor: 'red', targetVisible: true, confidence: 1, summary: 'invalid', objectId: 'forbidden',
  }), /forbidden object identifier/)
})

test('real Provider A/B authorization requires two confirmations and exact budgets', () => {
  assert.throws(() => authorizeRealProviderAB({ confirmed: true, maxProviderCalls: 8, maxTotalTokens: 1_000 }), /acknowledgement is missing/)
  assert.throws(() => authorizeRealProviderAB({ acknowledgement: REAL_PROVIDER_AB_ACKNOWLEDGEMENT, confirmed: false, maxProviderCalls: 8, maxTotalTokens: 1_000 }), /confirmation flag is missing/)
  assert.throws(() => authorizeRealProviderAB({ acknowledgement: REAL_PROVIDER_AB_ACKNOWLEDGEMENT, confirmed: true, maxProviderCalls: 9, maxTotalTokens: 1_000 }), /exact eight-call budget/)
  assert.throws(() => authorizeRealProviderAB({ acknowledgement: REAL_PROVIDER_AB_ACKNOWLEDGEMENT, confirmed: true, maxProviderCalls: 8 }), /positive Token budget/)
  assert.deepEqual(authorizeRealProviderAB({
    acknowledgement: REAL_PROVIDER_AB_ACKNOWLEDGEMENT,
    confirmed: true,
    maxProviderCalls: 8,
    maxTotalTokens: 50_000,
  }), { authorized: true, maxProviderCalls: 8, maxTotalTokens: 50_000 })
})

test('Provider A/B stops before the next call when measured Token budget is exhausted', async () => {
  const provider = new SequenceVisualProvider()
  const progress = []
  const runner = new RealProviderABRunner({
    createLab: () => createSession(),
    provider,
    maxProviderCalls: 8,
    maxTotalTokens: 500,
    requireUsage: true,
    onProgress: checkpoint => progress.push(checkpoint),
  })
  await assert.rejects(() => runner.run('phase12-provider-ab-budget-stop'), /Token budget 500 exhausted before another call/)
  assert.equal(provider.requests.length, 5)
  assert.equal(progress.length, 5)
  assert.equal(progress.at(-1).totalUsage.totalTokens, 500)
})

import { createPhase8Server } from '../../web/src/server.js'
import { MultimodalAgentRuntime, SequenceMultimodalProvider } from '../../../packages/multimodal-agent-runtime/src/index.js'

const app = createPhase8Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
const provider = new SequenceMultimodalProvider([{
  model: 'deterministic-protocol-fixture',
  usage: { inputTokens: 120, cachedInputTokens: 0, outputTokens: 32, reasoningOutputTokens: 8, totalTokens: 160 },
  decision: {
    type: 'gesture',
    coordinateSpace: 'normalized_frame',
    gesture: { kind: 'drag', from: { x: 145 / 1200, y: 285 / 800 }, to: { x: 565 / 1200, y: 285 / 800 } },
    confidence: 1,
    summary: 'Protocol fixture drags the visible red target into the visible blue zone.',
  },
}], 'phase8-protocol-fixture')

try {
  const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider })
  const result = await runtime.run({
    runId: 'phase8-pixel-native-reference',
    goal: 'Move the red circle completely inside the blue target frame using only pixels and normalized frame coordinates.',
    maxIterations: 2,
  })
  console.log(JSON.stringify({
    status: result.status,
    success: result.success,
    metrics: result.metrics,
    evidence: result.steps.at(-1)?.evidence,
    providerRequestContainsObjectId: JSON.stringify(provider.requests).includes('objectId'),
  }, null, 2))
  if (!result.success) process.exitCode = 1
} finally {
  app.mcp.close()
  app.ledger.close()
  app.syncLedger.close()
}

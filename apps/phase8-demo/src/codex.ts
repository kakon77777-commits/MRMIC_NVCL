import { createPhase8Server } from '../../web/src/server.js'
import { MultimodalAgentRuntime } from '../../../packages/multimodal-agent-runtime/src/index.js'
import { CodexAccountMultimodalProvider } from '../../../packages/provider-codex-account/src/index.js'

const app = createPhase8Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
const provider = new CodexAccountMultimodalProvider({ cwd: process.cwd(), timeoutMs: 120_000, detail: 'auto' })

try {
  const probe = await provider.probe()
  if (probe.appServer !== 'available' || !probe.selectedModel) {
    throw new Error(`Codex Account Provider unavailable: ${probe.appServer}`)
  }
  const runtime = new MultimodalAgentRuntime({ lab: app.lab, provider })
  const result = await runtime.run({
    runId: `phase8-codex-${Date.now()}`,
    goal: 'Move the visible solid red circle completely inside the visible blue outlined target rectangle using one drag gesture.',
    maxIterations: 2,
    crop: { x: 40, y: 140, width: 700, height: 300 },
  })
  const last = result.steps.at(-1)
  console.log(JSON.stringify({
    acceptance: 'phase8-real-codex-pixel-loop',
    status: result.status,
    success: result.success,
    reason: result.reason,
    provider: result.provider,
    model: last?.model ?? probe.selectedModel,
    metrics: result.metrics,
    evidence: last?.evidence ? {
      actionId: last.evidence.actionId,
      beforeFrameId: last.evidence.beforeFrameId,
      afterFrameId: last.evidence.afterFrameId,
      beforeRenderSha256: last.evidence.beforeRenderSha256,
      afterRenderSha256: last.evidence.afterRenderSha256,
      freshnessVerified: last.evidence.freshnessVerified,
      transitionGuard: last.evidence.transitionGuard,
      verifiedChange: last.evidence.verifiedChange,
      gesture: last.evidence.gesture,
    } : undefined,
    pixelBoundary: {
      providerReceivedPng: true,
      providerReceivedStructuredObjects: false,
      providerReceivedObjectIds: false,
    },
  }, null, 2))
  if (!result.success) process.exitCode = 1
} finally {
  app.mcp.close()
  app.ledger.close()
  app.syncLedger.close()
}

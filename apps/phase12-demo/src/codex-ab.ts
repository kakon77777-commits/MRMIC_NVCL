import { renameSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPhase12Server } from '../../web/src/server.js'
import {
  authorizeRealProviderAB,
  REAL_PROVIDER_AB_ACKNOWLEDGEMENT,
  RealProviderABRunner,
  type RealProviderABPolicy,
} from '../../../packages/multimodal-agent-runtime/src/index.js'
import { CodexAccountMultimodalProvider } from '../../../packages/provider-codex-account/src/index.js'

const args = new Set(process.argv.slice(2))
const value = (prefix: string): string | undefined => process.argv.slice(2).find(item => item.startsWith(`${prefix}=`))?.slice(prefix.length + 1)
const integer = (prefix: string): number | undefined => {
  const raw = value(prefix)
  if (raw === undefined) return undefined
  const parsed = Number(raw)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}

const provider = new CodexAccountMultimodalProvider({
  cwd: process.cwd(),
  timeoutMs: integer('--timeout-ms') ?? 120_000,
  detail: 'auto',
  ...(process.env.MRMIC_CODEX_MODEL ? { model: process.env.MRMIC_CODEX_MODEL } : {}),
})

if (args.has('--probe-only')) {
  console.log(JSON.stringify({ inferenceCalls: 0, probe: await provider.probe() }, null, 2))
  process.exit(0)
}

const maxProviderCalls = integer('--max-provider-calls')
const maxTotalTokens = integer('--max-total-tokens')
let authorization
try {
  authorization = authorizeRealProviderAB({
    acknowledgement: process.env.MRMIC_REAL_PROVIDER_AB,
    confirmed: args.has('--confirm-real-provider-ab'),
    maxProviderCalls,
    maxTotalTokens,
  })
} catch (error) {
  console.error(JSON.stringify({
    status: 'DENIED',
    inferenceCalls: 0,
    reason: 'Real Provider A/B requires both explicit acknowledgement and bounded call/Token budgets.',
    required: {
      environment: `MRMIC_REAL_PROVIDER_AB=${REAL_PROVIDER_AB_ACKNOWLEDGEMENT}`,
      flag: '--confirm-real-provider-ab',
      exactCallBudget: '--max-provider-calls=8',
      tokenBudget: '--max-total-tokens=<positive integer>',
    },
  }, null, 2))
  process.exit(2)
}

const probe = await provider.probe()
if (probe.appServer !== 'available' || !probe.selectedModel) {
  throw new Error(`Codex Account Provider unavailable: ${probe.appServer}`)
}

const outputPath = resolve(value('--output') ?? 'artifacts/phase12-real-provider-ab.json')
const temporaryPath = `${outputPath}.tmp`
const authorizationEvidence = {
  explicitEnvironmentAcknowledgement: true,
  explicitCommandFlag: true,
  maxProviderCalls: authorization.maxProviderCalls,
  maxTotalTokens: authorization.maxTotalTokens,
}
const probeEvidence = {
  provider: probe.provider,
  appServer: probe.appServer,
  selectedModel: probe.selectedModel,
  credentialFilesAccessed: probe.credentialFilesAccessed,
}
const progress: Array<unknown> = []
function writeArtifact(value: unknown): void {
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, outputPath)
}

const runner = new RealProviderABRunner({
  provider,
  maxProviderCalls: authorization.maxProviderCalls,
  maxTotalTokens: authorization.maxTotalTokens,
  requireUsage: true,
  onProgress(checkpoint) {
    progress.push(checkpoint)
    writeArtifact({
      acceptance: 'phase12-opt-in-real-provider-ab',
      status: 'RUNNING',
      probe: probeEvidence,
      authorization: authorizationEvidence,
      progress,
    })
  },
  createLab: (_policy: RealProviderABPolicy) => {
    const app = createPhase12Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
    return {
      lab: app.lab,
      close() {
        app.mcp.close()
        app.ledger.close()
        app.syncLedger.close()
      },
    }
  },
})
try {
  const result = await runner.run(`phase12-real-provider-ab-${Date.now()}`)
  const artifact = {
    acceptance: 'phase12-opt-in-real-provider-ab',
    status: 'COMPLETED',
    probe: probeEvidence,
    authorization: authorizationEvidence,
    result,
  }
  writeArtifact(artifact)
  console.log(JSON.stringify(artifact, null, 2))
} catch (error) {
  const artifact = {
    acceptance: 'phase12-opt-in-real-provider-ab',
    status: 'ABORTED',
    probe: probeEvidence,
    authorization: authorizationEvidence,
    progress,
    error: error instanceof Error ? error.message : String(error),
  }
  writeArtifact(artifact)
  console.error(JSON.stringify(artifact, null, 2))
  throw error
}

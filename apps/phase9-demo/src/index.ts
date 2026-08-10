import { createPhase9Server } from '../../web/src/server.js'
import {
  ObservationGovernor,
  SustainedObservationBenchmarkRunner,
  type SustainedObservationBenchmarkResult,
} from '../../../packages/multimodal-agent-runtime/src/index.js'

const seeds = [7, 42, 2026]
const results: SustainedObservationBenchmarkResult[] = []

for (const seed of seeds) {
  const app = createPhase9Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  try {
    const governor = new ObservationGovernor({
      lab: app.lab,
      differenceThreshold: 0.0001,
      blockDifferenceThreshold: 0.02,
      keyframeInterval: 8,
      maxRoiFraction: 0.3,
      roiPaddingPx: 24,
    })
    const runner = new SustainedObservationBenchmarkRunner({ lab: app.lab, governor })
    results.push(await runner.run({ runId: `phase9-seed-${seed}`, seed }))
  } finally {
    app.mcp.close()
    app.ledger.close()
    app.syncLedger.close()
  }
}

const totalAlwaysFullBytes = results.reduce((sum, result) => sum + result.alwaysFullBytes, 0)
const totalGovernedBytes = results.reduce((sum, result) => sum + result.governedBytes, 0)
const totalSavedBytes = totalAlwaysFullBytes - totalGovernedBytes
console.log(JSON.stringify({
  benchmark: 'phase9-sustained-observation-governor',
  seeds,
  runs: results,
  aggregate: {
    observations: results.reduce((sum, result) => sum + result.steps.length, 0),
    providerCallsAvoided: results.reduce((sum, result) => sum + result.providerCallsAvoided, 0),
    alwaysFullBytes: totalAlwaysFullBytes,
    governedBytes: totalGovernedBytes,
    savedBytes: totalSavedBytes,
    savedPercent: totalAlwaysFullBytes ? totalSavedBytes / totalAlwaysFullBytes * 100 : 0,
  },
}, null, 2))

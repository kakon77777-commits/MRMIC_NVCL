import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const outputFiles = new Set(['MANIFEST.json', 'SHA256SUMS.txt'])
const canonicalize = bytes => {
  const isText = !bytes.includes(0) && Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes)
  return isText
    ? { bytes: Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8'), normalization: 'lf' }
    : { bytes, normalization: 'binary' }
}
const listed = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .map(value => value.trim())
  .filter(Boolean)
  .filter(path => !outputFiles.has(path))
  .sort((a, b) => a.localeCompare(b))

const files = listed.map(path => {
  const absolute = resolve(root, path)
  const canonical = canonicalize(readFileSync(absolute))
  return {
    path: path.replaceAll('\\', '/'),
    size: canonical.bytes.length,
    sha256: createHash('sha256').update(canonical.bytes).digest('hex'),
    normalization: canonical.normalization,
  }
})

const manifest = {
  name: 'MRMIC_NVCL_MVP_Phase13_v0.14',
  version: '0.14.0',
  phase: 13,
  generatedAt: new Date().toISOString(),
  sourceBaseline: 'git main da1ec4f (organized Phase 12 v0.13)',
  phase13PortSource: '07da8848314d5e0ca50e3e956c6b7af1883d0d83 (audited path-level source, not merged)',
  automatedTests: { total: 175, passed: 175, failed: 0 },
  mcpTools: { total: 26, lab: 11 },
  phase13Integration: {
    capabilitySchema: 'mrmic-capabilities/v1',
    capabilityHttp: '/api/capabilities',
    capabilityMcpResource: 'mrmic://capabilities',
    portalSchema: 'native_resource_portal_v1',
    portalMigration: 'compat_frame_v0 -> native_resource_portal_v1',
    secureAuthSurfaces: ['http_transaction', 'http_sync_update', 'websocket', 'mcp'],
    runtimePresence: 'ephemeral_runtime_presence_v1',
    livePortalHost: 'live_portal_host_v1',
    coverage: 'docs/PHASE13_PMW_COVERAGE_MATRIX.md',
  },
  localAcceptance: {
    typescriptCheck: 'passed',
    automatedTests: '175/175 passed',
    phase12OfflineDemo: 'passed',
    realProviderRun: 'not_run',
  },
  historicalPhase12BrowserAcceptance: {
    status: 'passed',
    dragUndoRedo: 'passed',
    freshnessAndTransitionGuard: 'passed',
    warnings: 0,
    errors: 0,
    evidence: 'artifacts/phase12-browser-acceptance.json',
  },
  historicalPhase12RealCodexPixelAcceptance: {
    status: 'completed',
    provider: 'openai_codex_account',
    model: 'gpt-5.6-sol',
    sourceTraceIdentical: true,
    actionPlanIdentical: true,
    providerCalls: { alwaysFull: 5, governorRoi: 3, saved: 2 },
    semanticCorrect: '8/8',
    totalTokens: { alwaysFull: 104313, governorRoi: 58010, saved: 46303 },
    latencyMs: { alwaysFull: 62978, governorRoi: 29568, saved: 33410 },
    freshness: '4/4',
    transitionGuard: '4/4',
    evidence: 'artifacts/phase12-real-provider-ab.json',
  },
  historicalPhase12ObservationPolicyAB: {
    protocolVersion: 'mrmic-observation-policy-ab-v1',
    fixedSeeds: [42],
    heldOutSeeds: [9001],
    policies: ['always_full', 'static_crop', 'governor_roi', 'passive_timeline', 'hybrid_transient'],
    isolatedRuns: 10,
    actionsPerPolicy: 22,
    samplesPerPolicy: 28,
    freshnessPassedPerPolicy: 22,
    transitionGuardsPassedPerPolicy: 22,
    planAndFullPngTraceIdentity: 'passed',
    recommendedPolicy: 'governor_roi',
    governorRoi: {
      deliveries: 25,
      deliveredBytes: 491840,
      savedPercent: 66.97482286837737,
      perceptualCoverage: '21/21',
      exactPostStateRetention: '21/21',
      transientStateRetained: true,
    },
    passiveTimeline: {
      deliveries: 8,
      providerDeliveriesAvoided: 20,
      deliveredBytes: 378922,
      savedPercent: 74.55683521253108,
      exactPostStateRetention: '6/21',
      transientStateRetained: false,
    },
    hybridTransient: {
      deliveries: 8,
      providerDeliveriesAvoided: 20,
      deliveredBytes: 301745,
      savedPercent: 79.73897594018081,
      exactPostStateRetention: '6/21',
      transientStateRetained: true,
      reversalBoundaries: 2,
      paretoOptimal: true,
    },
    evidence: 'artifacts/phase12-hybrid-benchmark.json',
  },
  notProven: [
    'external Python PMW adapter end-to-end integration',
    'production Electron/WebView live portal host integration',
    'MCP 2026-07-28 stateless conformance',
    'new real Provider A/B results for Phase 13',
    'uncontrolled game, desktop, audio, or video generalization',
  ],
  fileCount: files.length,
  files,
}

writeFileSync(resolve(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(resolve(root, 'SHA256SUMS.txt'), `${files.map(file => `${file.sha256}  ${file.path}`).join('\n')}\n`)
console.log(`Wrote manifest for ${files.length} files.`)

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
  name: 'MRMIC_NVCL_MVP_Phase11_v0.12',
  version: '0.12.0',
  phase: 11,
  generatedAt: new Date().toISOString(),
  sourceBaseline: 'git agent/phase10-passive-scene-timeline f28a3d4 (Phase 10 v0.11)',
  automatedTests: { total: 69, passed: 69, failed: 0 },
  mcpTools: { total: 26, lab: 11 },
  browserAcceptance: 'passed',
  realCodexPixelAcceptance: 'inherited Phase 8 pass; no account-backed multi-call Provider A/B in Phase 11',
  observationPolicyAB: {
    protocolVersion: 'mrmic-observation-policy-ab-v1',
    fixedSeeds: [42],
    heldOutSeeds: [9001],
    isolatedRuns: 8,
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
  },
  fileCount: files.length,
  files,
}

writeFileSync(resolve(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(resolve(root, 'SHA256SUMS.txt'), `${files.map(file => `${file.sha256}  ${file.path}`).join('\n')}\n`)
console.log(`Wrote manifest for ${files.length} files.`)

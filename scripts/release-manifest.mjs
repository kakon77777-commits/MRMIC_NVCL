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
  name: 'MRMIC_NVCL_MVP_Phase10_v0.11',
  version: '0.11.0',
  phase: 10,
  generatedAt: new Date().toISOString(),
  sourceBaseline: 'git agent/phase9-observation-governor 1264b12 (Phase 9 v0.10)',
  automatedTests: { total: 67, passed: 67, failed: 0 },
  mcpTools: { total: 25, lab: 10 },
  browserAcceptance: 'passed',
  realCodexPixelAcceptance: 'inherited Phase 8 pass; no account-backed multi-call A/B in Phase 10',
  passiveSceneTimelineBenchmark: {
    fixedSeeds: [7, 42, 2026],
    heldOutSeeds: [9001, 65537],
    actions: 40,
    samples: 55,
    emittedEvents: 20,
    providerDeliveriesAvoided: 35,
    alwaysFullBytes: 2914396,
    deliveredBytes: 929788,
    savedPercent: 68.09671712423432,
  },
  fileCount: files.length,
  files,
}

writeFileSync(resolve(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(resolve(root, 'SHA256SUMS.txt'), `${files.map(file => `${file.sha256}  ${file.path}`).join('\n')}\n`)
console.log(`Wrote manifest for ${files.length} files.`)

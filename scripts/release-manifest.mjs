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
  name: 'MRMIC_NVCL_MVP_Phase9_v0.10',
  version: '0.10.0',
  phase: 9,
  generatedAt: new Date().toISOString(),
  sourceBaseline: 'git agent/phase8-pixel-native-loop 60bf9c4 (Phase 8 v0.9)',
  automatedTests: { total: 61, passed: 61, failed: 0 },
  mcpTools: { total: 24, lab: 9 },
  browserAcceptance: 'passed',
  realCodexPixelAcceptance: 'inherited Phase 8 pass; not rerun for single-call Phase 9',
  sustainedObservationBenchmark: {
    seeds: [7, 42, 2026],
    observations: 27,
    providerCallsAvoided: 12,
    alwaysFullBytes: 1505658,
    governedBytes: 529716,
    savedPercent: 64.81830535221145,
  },
  fileCount: files.length,
  files,
}

writeFileSync(resolve(root, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(resolve(root, 'SHA256SUMS.txt'), `${files.map(file => `${file.sha256}  ${file.path}`).join('\n')}\n`)
console.log(`Wrote manifest for ${files.length} files.`)

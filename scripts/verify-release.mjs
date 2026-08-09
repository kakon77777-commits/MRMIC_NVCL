import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifest = JSON.parse(readFileSync(resolve(root, 'MANIFEST.json'), 'utf8'))
const failures = []
const canonicalize = (bytes, normalization) => normalization === 'lf'
  ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'), 'utf8')
  : bytes

for (const file of manifest.files) {
  const absolute = resolve(root, file.path)
  if (!existsSync(absolute)) {
    failures.push(`${file.path}: missing`)
    continue
  }
  const bytes = canonicalize(readFileSync(absolute), file.normalization)
  const size = bytes.length
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  if (size !== file.size) failures.push(`${file.path}: size ${size} != ${file.size}`)
  if (sha256 !== file.sha256) failures.push(`${file.path}: SHA-256 mismatch`)
}

if (manifest.fileCount !== manifest.files.length) failures.push(`fileCount ${manifest.fileCount} != ${manifest.files.length}`)
if (failures.length) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Verified ${manifest.files.length} manifest entries for ${manifest.name}.`)
}

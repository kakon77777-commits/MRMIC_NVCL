import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const theoryRoot = resolve(root, 'docs/theory')
const canonicalRoot = resolve(theoryRoot, 'canonical')

const expectedTheory = new Map([
  ['原生符號繪圖假說_命題猜想論文_v1.0.md', 'b753b1c6594f47f8ea2acfc14f49fd086a2fb3d41461d413160ac7d2900e3be9'],
  ['原生視覺建構迴路_NVCL_命題猜想論文_v1.0.md', 'fc3883bb0d775422b4ffc9a00417edb3e0d9f6db13060f2503604530441ab045'],
  ['MCP原生遞歸多模態無限畫布_MRMIC_架構命題論文_v1.0.md', 'e572b7e1c912242acf8f23b83c4a082ee5a81a266ac0cf38a262a1666c97d8e5'],
  ['MRMIC_NVCL_MVP技術白皮書_v0.1.md', '7cdbebffa010497502b69c5661bf7e894451d261d41ee40c8d5fc641f5db2451'],
  ['視之基底系列_10_視之一般算子論_差異的場化位格化與回饋化_v1.0.md', '4fc1356435bda6a7ef4d5ca89585ed026b9319cbefc621c9ddbb36f21a7704d9'],
])

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

const assertLocalLinksExist = documentPath => {
  const markdown = readFileSync(documentPath, 'utf8')
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1].trim().replace(/^<|>$/g, '')
    if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) continue
    const path = href.split('#', 1)[0]
    assert.ok(existsSync(resolve(dirname(documentPath), path)), `${documentPath}: missing ${href}`)
  }
}

test('canonical theory layout and documentation links remain valid', () => {
  const canonicalMarkdown = new Set(
    readdirSync(canonicalRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name),
  )
  assert.deepEqual(canonicalMarkdown, new Set([...expectedTheory.keys(), 'README.md']))

  for (const [name, expectedHash] of expectedTheory) {
    assert.equal(sha256(resolve(canonicalRoot, name)), expectedHash, name)
  }

  const theoryRootMarkdown = readdirSync(theoryRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort()
  assert.deepEqual(theoryRootMarkdown, ['README.md'])

  for (const relative of [
    'README.md',
    'docs/INDEX.md',
    'docs/theory/README.md',
    'docs/theory/canonical/README.md',
    'docs/provenance/THEORY_SOURCE_MAP.md',
  ]) {
    const documentPath = resolve(root, relative)
    assert.ok(existsSync(documentPath), relative)
    assertLocalLinksExist(documentPath)
  }
})

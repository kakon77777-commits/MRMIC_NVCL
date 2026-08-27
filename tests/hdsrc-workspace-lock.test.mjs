import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('package-lock records provider-hdsrc as a workspace link and package entry', async () => {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'))
  assert.deepEqual(lock.packages['node_modules/@mrmic/provider-hdsrc'], {
    resolved: 'packages/provider-hdsrc',
    link: true,
  })
  assert.deepEqual(lock.packages['packages/provider-hdsrc'], {
    name: '@mrmic/provider-hdsrc',
    version: '0.14.0',
  })
})

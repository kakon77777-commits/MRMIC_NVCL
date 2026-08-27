import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'

test('committed package-lock records provider-hdsrc as a workspace link and package entry', () => {
  const committed = execFileSync('git', ['show', 'HEAD:package-lock.json'], { encoding: 'utf8' })
  const lock = JSON.parse(committed)
  assert.deepEqual(lock.packages['node_modules/@mrmic/provider-hdsrc'], {
    resolved: 'packages/provider-hdsrc',
    link: true,
  })
  assert.deepEqual(lock.packages['packages/provider-hdsrc'], {
    name: '@mrmic/provider-hdsrc',
    version: '0.14.0',
  })
})

test('npm install leaves the committed package-lock unchanged', () => {
  assert.doesNotThrow(() => execFileSync('git', ['diff', '--exit-code', '--', 'package-lock.json'], { stdio: 'pipe' }))
})

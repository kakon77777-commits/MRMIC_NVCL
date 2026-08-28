import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import {
  HdsrcJsonlProcessClient,
  HdsrcProcessClientError,
} from '../dist/packages/provider-hdsrc/src/process-client.js'
import {
  HdsrcLocalProcessProviderError,
  LocalProcessHdsrcProvider,
} from '../dist/packages/provider-hdsrc/src/local-process.js'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const jsonlFixture = resolve('tests/fixtures/hdsrc-jsonl-fixture.py')
const providerFixture = resolve('tests/fixtures/hdsrc-provider-origin-host.py')

function fixtureClient(mode, timeoutMs = 500) {
  return new HdsrcJsonlProcessClient({
    executable: python,
    args: [jsonlFixture, mode],
    timeoutMs,
  })
}

function provider(mode) {
  return new LocalProcessHdsrcProvider({
    executable: python,
    hostScript: providerFixture,
    registry: 'unused-registry.json',
    profileRoot: 'unused-profile',
    materializationRoot: 'unused-materializations',
    env: { ...process.env, HDSRC_ORIGIN_MODE: mode },
    timeoutMs: 1000,
  })
}

const readContext = { principalId: 'principal:origin-test', allowHdsrcRead: true }

test('HDSRC process timeout is classified as transport', async t => {
  const client = fixtureClient('sleep', 25)
  t.after(() => client.close())
  await assert.rejects(
    () => client.request('slow', {}),
    error => error instanceof HdsrcProcessClientError && error.origin === 'transport',
  )
})

test('malformed HDSRC stdout is classified as contract', async t => {
  const client = fixtureClient('malformed')
  t.after(() => client.close())
  await assert.rejects(
    () => client.request('bad', {}),
    error => error instanceof HdsrcProcessClientError && error.origin === 'contract',
  )
})

test('remote STALE_STATE preserves remote_domain origin through the provider', async t => {
  const client = provider('stale')
  t.after(() => client.close())
  await assert.rejects(
    () => client.state('hdsrc://state/state:any', readContext),
    error => error instanceof HdsrcLocalProcessProviderError
      && error.origin === 'remote_domain'
      && error.code === 'STALE_STATE',
  )
})

test('remote PROVIDER_UNAVAILABLE remains remote_domain instead of transport', async t => {
  const client = provider('unavailable')
  t.after(() => client.close())
  await assert.rejects(
    () => client.state('hdsrc://state/state:any', readContext),
    error => error instanceof HdsrcLocalProcessProviderError
      && error.origin === 'remote_domain'
      && error.code === 'PROVIDER_UNAVAILABLE',
  )
})

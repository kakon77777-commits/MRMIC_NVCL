import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { HdsrcJsonlProcessClient } from '../dist/packages/provider-hdsrc/src/process-client.js'

const python = process.env.PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
const fixture = resolve('tests/fixtures/hdsrc-jsonl-fixture.py')

function makeClient(mode, timeoutMs = 1000) {
  return new HdsrcJsonlProcessClient({
    executable: python,
    args: [fixture, mode],
    timeoutMs,
  })
}

test('HDSRC JSONL client correlates concurrent responses by request id even when responses are reversed', async t => {
  const client = makeClient('reverse')
  t.after(() => client.close())
  const [a, b] = await Promise.all([
    client.request('echo', { value: 'a' }),
    client.request('echo', { value: 'b' }),
  ])
  assert.deepEqual(a, { value: 'a' })
  assert.deepEqual(b, { value: 'b' })
})

test('malformed HDSRC stdout is fatal and permanently closes the client', async t => {
  const client = makeClient('malformed')
  t.after(() => client.close())
  await assert.rejects(() => client.request('echo', { value: 1 }), /protocol|json|malformed/i)
  await assert.rejects(() => client.request('echo', { value: 2 }), /closed/i)
})

test('unexpected HDSRC process exit rejects pending work and closes the client', async t => {
  const client = makeClient('exit')
  t.after(() => client.close())
  await assert.rejects(() => client.request('echo', { value: 1 }), /exit|closed|unavailable/i)
  await assert.rejects(() => client.request('echo', { value: 2 }), /closed/i)
})

test('HDSRC request timeout kills the process and permanently closes the client', async t => {
  const client = makeClient('sleep', 50)
  t.after(() => client.close())
  await assert.rejects(() => client.request('echo', { value: 1 }), /timed out|timeout/i)
  await assert.rejects(() => client.request('echo', { value: 2 }), /closed/i)
})

test('HDSRC JSONL client accepts ordinary successful responses', async t => {
  const client = makeClient('echo')
  t.after(() => client.close())
  const result = await client.request('echo', { ok: true, value: 7 })
  assert.deepEqual(result, { ok: true, value: 7 })
})

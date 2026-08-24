import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { sanitizeSecurePresence } from '../dist/packages/secure-canvas-client/src/index.js'
import { sanitizeRuntimePresenceInput } from '../dist/packages/runtime-presence/src/index.js'

const readJson = async name => JSON.parse(await readFile(`contracts/phase13/examples/${name}`, 'utf8'))

test('provider-neutral PMW JSON schemas expose stable message and runtime contracts', async () => {
  const messages = JSON.parse(await readFile('contracts/phase13/secure-canvas-messages-v1.schema.json', 'utf8'))
  const runtime = JSON.parse(await readFile('contracts/phase13/ephemeral-runtime-presence-v1.schema.json', 'utf8'))
  assert.equal(messages.$id, 'https://evemisslab.com/schemas/secure-canvas-messages-v1.schema.json')
  assert.equal(runtime.$id, 'https://evemisslab.com/schemas/ephemeral-runtime-presence-v1.schema.json')
  assert.deepEqual(runtime.required, ['provider', 'providerResourceId', 'runtimeEpochId', 'status', 'revision', 'sequence'])
})

test('examples preserve verified identity direction and identity-free caller payloads', async () => {
  const hello = await readJson('secure-hello.json')
  const ack = await readJson('secure-hello-ack.json')
  const presence = await readJson('secure-presence.json')
  const runtime = await readJson('runtime-presence-input.json')
  const rejected = await readJson('runtime-presence-rejected.json')
  const error = await readJson('server-error.json')

  assert.equal(hello.type, 'hello')
  assert.equal(hello.authToken, '${MRMIC_PMW_BEARER_TOKEN}')
  assert.equal(ack.identity.verified, true)
  assert.equal(sanitizeSecurePresence(presence.presence).actorId, undefined)
  assert.deepEqual(sanitizeSecurePresence(presence.presence), presence.presence)
  assert.deepEqual(sanitizeRuntimePresenceInput(runtime.runtime), runtime.runtime)
  for (const payload of [presence.presence, runtime.runtime]) {
    assert.equal('principalId' in payload, false)
    assert.equal('semanticAgentId' in payload, false)
    assert.equal('actorId' in payload, false)
    assert.equal('authToken' in payload, false)
  }
  assert.equal(rejected.reason, 'stale_revision')
  assert.equal(error.type, 'error')
})

test('public contract fixtures contain no actual binding token', async () => {
  const names = [
    'secure-hello.json', 'secure-hello-ack.json', 'secure-presence.json',
    'runtime-presence-input.json', 'runtime-presence-rejected.json', 'server-error.json',
  ]
  for (const name of names) {
    const text = await readFile(`contracts/phase13/examples/${name}`, 'utf8')
    assert.equal(/phase13-.*-token/i.test(text), false, name)
    assert.equal(/[A-Fa-f0-9]{32,}/.test(text), false, name)
  }
})

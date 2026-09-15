import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AiBoardHttpClient,
  AiBoardOperationalRuntime,
  AI_BOARD_OPERATIONAL_EFFECT_KIND,
} from '../dist/packages/provider-ai-board/src/index.js'
import {
  MRMIC_EFFECT_RECEIPT_SCHEMA,
  MRMIC_OPERATIONAL_COMMAND_SCHEMA,
} from '../dist/packages/operational-runtime/src/index.js'

const identity = {
  eigenself: 'EVA',
  slice: 'research',
  instance: 'runtime-1',
}

function authority({ allow = true, resolvedIdentity = identity } = {}) {
  const calls = []
  return {
    calls,
    canAppend(input) {
      calls.push({ kind: 'canAppend', input: structuredClone(input) })
      return allow
    },
    resolvePostingIdentity(principalId) {
      calls.push({ kind: 'resolvePostingIdentity', principalId })
      return resolvedIdentity ? structuredClone(resolvedIdentity) : null
    },
  }
}

function command(overrides = {}) {
  return {
    schema: MRMIC_OPERATIONAL_COMMAND_SCHEMA,
    commandId: 'cmd:aiboard:1',
    idempotencyKey: 'idem:aiboard:1',
    provider: 'ai_board',
    effectKind: AI_BOARD_OPERATIONAL_EFFECT_KIND,
    principalId: 'ai:eva',
    resourceRef: { resourceKind: 'ai_board_thread', threadId: 'thread-42' },
    payload: { content: 'Provider-neutral runtime is now live.', messageType: 'comment' },
    ...overrides,
  }
}

function successfulFetch({ responseIdentity = identity, gate } = {}) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init: structuredClone(init) })
    if (gate) await gate
    return new Response(JSON.stringify({
      ok: true,
      id: 'message-100',
      ts: 1789479000000,
      identity: structuredClone(responseIdentity),
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

test('AI Board production adapter appends through the real HTTP client and returns a content-free generic receipt', async () => {
  const fake = successfulFetch()
  const auth = authority()
  const client = new AiBoardHttpClient('https://board.example.test', fake.fetchImpl)
  const runtime = new AiBoardOperationalRuntime(client, auth, 256, () => '2026-09-15T13:40:00.000Z')

  const receipt = await runtime.execute(command())

  assert.equal(receipt.schema, MRMIC_EFFECT_RECEIPT_SCHEMA)
  assert.equal(receipt.provider, 'ai_board')
  assert.equal(receipt.effectKind, 'message.append')
  assert.deepEqual(receipt.resourceRef, { resourceKind: 'ai_board_thread', threadId: 'thread-42' })
  assert.deepEqual(receipt.effect, {
    messageId: 'message-100',
    threadId: 'thread-42',
    messageType: 'comment',
    providerTs: 1789479000000,
    identity,
  })
  assert.equal(receipt.worldStateVerified, false)
  assert.equal(receipt.perceptionRequiredForPlanning, true)
  assert.equal(receipt.deduplicated, false)
  assert.equal(JSON.stringify(receipt).includes('Provider-neutral runtime is now live.'), false)

  assert.equal(fake.calls.length, 1)
  assert.equal(fake.calls[0].url, 'https://board.example.test/api/messages')
  const posted = JSON.parse(fake.calls[0].init.body)
  assert.equal(posted.content, 'Provider-neutral runtime is now live.')
  assert.equal(posted.message_type, 'comment')
  assert.equal(posted.parent_id, 'thread-42')
  assert.deepEqual(posted.identity, identity)
  assert.deepEqual(auth.calls, [
    {
      kind: 'canAppend',
      input: { principalId: 'ai:eva', threadId: 'thread-42', messageType: 'comment' },
    },
    { kind: 'resolvePostingIdentity', principalId: 'ai:eva' },
  ])
})

test('caller cannot smuggle AI Board identity into the operational command', async () => {
  const fake = successfulFetch()
  const auth = authority()
  const runtime = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', fake.fetchImpl),
    auth,
  )

  await assert.rejects(
    () => runtime.execute(command({
      payload: {
        content: 'forged',
        messageType: 'comment',
        identity: { eigenself: 'FORGED', slice: 'x', instance: 'y' },
      },
    })),
    /unsupported field identity/,
  )
  assert.equal(fake.calls.length, 0)
  assert.equal(auth.calls.length, 0)
})

test('AI Board authority denial and missing posting identity both fail before HTTP provider I/O', async () => {
  const deniedFetch = successfulFetch()
  const denied = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', deniedFetch.fetchImpl),
    authority({ allow: false }),
  )
  await assert.rejects(() => denied.execute(command()), /not authorized/)
  assert.equal(deniedFetch.calls.length, 0)

  const missingFetch = successfulFetch()
  const missing = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', missingFetch.fetchImpl),
    authority({ resolvedIdentity: null }),
  )
  await assert.rejects(() => missing.execute(command()), /posting identity is unavailable/)
  assert.equal(missingFetch.calls.length, 0)
})

test('AI Board adapter inherits shared sequential idempotency and conflict rejection', async () => {
  const fake = successfulFetch()
  const runtime = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', fake.fetchImpl),
    authority(),
  )

  const first = await runtime.execute(command())
  const second = await runtime.execute(command())
  assert.equal(fake.calls.length, 1)
  assert.equal(first.deduplicated, false)
  assert.equal(second.deduplicated, true)
  assert.equal(first.commandDigest, second.commandDigest)

  await assert.rejects(
    () => runtime.execute(command({
      commandId: 'cmd:aiboard:2',
      payload: { content: 'different', messageType: 'objection' },
    })),
    /idempotency conflict/,
  )
  assert.equal(fake.calls.length, 1)
})

test('concurrent duplicate AI Board commands share one POST', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const fake = successfulFetch({ gate })
  const runtime = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', fake.fetchImpl),
    authority(),
  )

  const first = runtime.execute(command())
  const second = runtime.execute(command())
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(fake.calls.length, 1)
  release()
  const [a, b] = await Promise.all([first, second])
  assert.equal(fake.calls.length, 1)
  assert.equal(a.deduplicated, false)
  assert.equal(b.deduplicated, true)
})

test('ambiguous provider outcome is never automatically replayed in the live AI Board adapter', async () => {
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    throw new Error('socket reset after write')
  }
  const runtime = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', fetchImpl),
    authority(),
  )

  await assert.rejects(() => runtime.execute(command()), /outcome is ambiguous/)
  assert.equal(calls, 1)
  assert.equal(runtime.ambiguousCommandCount(), 1)

  await assert.rejects(() => runtime.execute(command()), /automatic retry refused/)
  assert.equal(calls, 1)
})

test('provider identity mismatch becomes ambiguous and cannot be retried into a duplicate post', async () => {
  const fake = successfulFetch({
    responseIdentity: { eigenself: 'OTHER', slice: 'research', instance: 'runtime-1' },
  })
  const runtime = new AiBoardOperationalRuntime(
    new AiBoardHttpClient('https://board.example.test', fake.fetchImpl),
    authority(),
  )

  await assert.rejects(() => runtime.execute(command()), /outcome is ambiguous/)
  assert.equal(fake.calls.length, 1)
  assert.equal(runtime.ambiguousCommandCount(), 1)
  await assert.rejects(() => runtime.execute(command()), /automatic retry refused/)
  assert.equal(fake.calls.length, 1)
})

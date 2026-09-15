import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  MRMIC_EFFECT_RECEIPT_SCHEMA,
  MRMIC_OPERATIONAL_COMMAND_SCHEMA,
  ProviderOperationalRuntime,
  canonicalOperationalValue,
  operationalCommandDigest,
} from '../dist/packages/operational-runtime/src/index.js'

function terminalCommand(overrides = {}) {
  return {
    schema: MRMIC_OPERATIONAL_COMMAND_SCHEMA,
    commandId: 'cmd:terminal:1',
    idempotencyKey: 'idem:terminal:1',
    provider: 'terminal',
    effectKind: 'process_write',
    principalId: 'ai:operator',
    resourceRef: { sessionId: 'terminal:session:1' },
    payload: { stdin: 'status\n' },
    ...overrides,
  }
}

function normalizeTerminal(input) {
  if (!input || input.schema !== MRMIC_OPERATIONAL_COMMAND_SCHEMA) throw new Error('terminal command schema mismatch')
  if (input.provider !== 'terminal' || input.effectKind !== 'process_write') throw new Error('terminal command provider mismatch')
  return structuredClone(input)
}

function terminalAdapter({ gate, failOnce = false } = {}) {
  const calls = []
  let failed = false
  return {
    calls,
    normalize: normalizeTerminal,
    digestValue(command) { return command },
    async execute(command, commandDigest) {
      calls.push(structuredClone(command))
      if (failOnce && !failed) {
        failed = true
        throw new Error('terminal provider failed')
      }
      if (gate) await gate
      return {
        schema: MRMIC_EFFECT_RECEIPT_SCHEMA,
        status: 'completed',
        provider: command.provider,
        effectKind: command.effectKind,
        commandId: command.commandId,
        idempotencyKey: command.idempotencyKey,
        commandDigest,
        principalId: command.principalId,
        resourceRef: structuredClone(command.resourceRef),
        effect: { bytesWritten: command.payload.stdin.length },
        completedAt: '2026-09-15T13:30:00.000Z',
        deduplicated: false,
        worldStateVerified: false,
        perceptionRequiredForPlanning: true,
      }
    },
    markDeduplicated(receipt) { return { ...structuredClone(receipt), deduplicated: true } },
  }
}

test('provider-neutral runtime executes a non-Windows terminal adapter', async () => {
  const adapter = terminalAdapter()
  const runtime = new ProviderOperationalRuntime(adapter)
  const receipt = await runtime.execute(terminalCommand())

  assert.equal(receipt.schema, MRMIC_EFFECT_RECEIPT_SCHEMA)
  assert.equal(receipt.provider, 'terminal')
  assert.equal(receipt.effectKind, 'process_write')
  assert.equal(receipt.effect.bytesWritten, 7)
  assert.equal(receipt.worldStateVerified, false)
  assert.equal(receipt.perceptionRequiredForPlanning, true)
  assert.equal(receipt.deduplicated, false)
  assert.equal(adapter.calls.length, 1)
})

test('provider-neutral runtime deduplicates sequential and concurrent effects', async () => {
  const sequential = terminalAdapter()
  const sequentialRuntime = new ProviderOperationalRuntime(sequential)
  const first = await sequentialRuntime.execute(terminalCommand())
  const second = await sequentialRuntime.execute(terminalCommand())
  assert.equal(sequential.calls.length, 1)
  assert.equal(first.deduplicated, false)
  assert.equal(second.deduplicated, true)

  let release
  const gate = new Promise(resolve => { release = resolve })
  const concurrent = terminalAdapter({ gate })
  const concurrentRuntime = new ProviderOperationalRuntime(concurrent)
  const one = concurrentRuntime.execute(terminalCommand())
  const two = concurrentRuntime.execute(terminalCommand())
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(concurrent.calls.length, 1)
  release()
  const [a, b] = await Promise.all([one, two])
  assert.equal(a.deduplicated, false)
  assert.equal(b.deduplicated, true)
})

test('provider-neutral idempotency conflict fails before a second provider effect', async () => {
  const adapter = terminalAdapter()
  const runtime = new ProviderOperationalRuntime(adapter)
  await runtime.execute(terminalCommand())
  await assert.rejects(
    () => runtime.execute(terminalCommand({ commandId: 'cmd:terminal:2', payload: { stdin: 'different\n' } })),
    /idempotency conflict/,
  )
  assert.equal(adapter.calls.length, 1)
})

test('failed provider effect is not cached as completed', async () => {
  const adapter = terminalAdapter({ failOnce: true })
  const runtime = new ProviderOperationalRuntime(adapter)
  await assert.rejects(() => runtime.execute(terminalCommand()), /terminal provider failed/)
  const receipt = await runtime.execute(terminalCommand())
  assert.equal(receipt.status, 'completed')
  assert.equal(adapter.calls.length, 2)
})

test('completed receipt cache is LRU-bounded without provider assumptions', async () => {
  const adapter = terminalAdapter()
  const runtime = new ProviderOperationalRuntime(adapter, 2)
  await runtime.execute(terminalCommand({ commandId: 'cmd:1', idempotencyKey: 'idem:1' }))
  await runtime.execute(terminalCommand({ commandId: 'cmd:2', idempotencyKey: 'idem:2' }))
  await runtime.execute(terminalCommand({ commandId: 'cmd:1', idempotencyKey: 'idem:1' }))
  await runtime.execute(terminalCommand({ commandId: 'cmd:3', idempotencyKey: 'idem:3' }))
  assert.equal(runtime.cachedReceiptCount(), 2)

  await runtime.execute(terminalCommand({ commandId: 'cmd:2', idempotencyKey: 'idem:2' }))
  assert.equal(adapter.calls.length, 4)
})

test('canonical operational digest is stable across object-key order', () => {
  const a = { z: 3, a: { y: 2, x: 1 }, list: [3, 2, 1] }
  const b = { list: [3, 2, 1], a: { x: 1, y: 2 }, z: 3 }
  assert.equal(canonicalOperationalValue(a), canonicalOperationalValue(b))
  assert.equal(operationalCommandDigest(a), operationalCommandDigest(b))
  assert.match(operationalCommandDigest(a), /^[0-9a-f]{64}$/)
})

test('provider-neutral core imports no Windows or perception/verifier runtime', async () => {
  const source = await readFile('packages/operational-runtime/src/index.ts', 'utf8')
  for (const forbidden of ['provider-windows', 'Windows', 'UIA', 'WGC', 'snapshotCapture', 'ObserverPortalCompositor', 'renderObjectsToSvg']) {
    assert.equal(source.includes(forbidden), false, `provider-neutral core must not depend on ${forbidden}`)
  }

  const windowsSource = await readFile('packages/provider-windows/src/operational-runtime.ts', 'utf8')
  assert.match(windowsSource, /ProviderOperationalRuntime/)
  assert.equal(windowsSource.includes('readonly #receipts = new Map'), false)
  assert.equal(windowsSource.includes('readonly #pending = new Map'), false)

  const commandSchema = JSON.parse(await readFile('contracts/phase15/mrmic-operational-command-v1.schema.json', 'utf8'))
  const receiptSchema = JSON.parse(await readFile('contracts/phase15/mrmic-effect-receipt-v1.schema.json', 'utf8'))
  assert.equal(commandSchema.properties.schema.const, MRMIC_OPERATIONAL_COMMAND_SCHEMA)
  assert.equal(receiptSchema.properties.schema.const, MRMIC_EFFECT_RECEIPT_SCHEMA)
  assert.equal(receiptSchema.properties.worldStateVerified.const, false)
  assert.equal(receiptSchema.properties.perceptionRequiredForPlanning.const, true)
})

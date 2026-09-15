import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  WindowsOperationalRuntime,
  WINDOWS_EFFECT_RECEIPT_SCHEMA,
  WINDOWS_OPERATIONAL_COMMAND_SCHEMA,
} from '../dist/packages/provider-windows/src/operational-runtime.js'

function command(overrides = {}) {
  return {
    schema: WINDOWS_OPERATIONAL_COMMAND_SCHEMA,
    commandId: 'cmd:1',
    idempotencyKey: 'idem:1',
    portalObjectId: 'portal:windows',
    providerResourceId: 'window:epoch:10:0x101',
    principalId: 'ai:operator',
    action: { kind: 'invoke', runtimeId: '1.2' },
    ...overrides,
  }
}

function executor({ gate } = {}) {
  const calls = []
  return {
    calls,
    async perform(portalObjectId, providerResourceId, principalId, action) {
      calls.push({ portalObjectId, providerResourceId, principalId, action: structuredClone(action) })
      if (gate) await gate
      return {
        schema: 'windows_uia_controlled_action_v1',
        ok: true,
        portalObjectId,
        providerResourceId,
        principalId,
        controlGeneration: 7,
        action: { kind: action.kind, runtimeId: action.runtimeId },
        inspectionCapturedAt: '2026-09-15T12:00:00.000Z',
        completedAt: '2026-09-15T12:00:00.100Z',
      }
    },
  }
}

test('operational command returns an effect receipt, not a world-state verification claim', async () => {
  const fake = executor()
  const runtime = new WindowsOperationalRuntime(fake)
  const receipt = await runtime.execute(command())

  assert.equal(receipt.schema, WINDOWS_EFFECT_RECEIPT_SCHEMA)
  assert.equal(receipt.status, 'completed')
  assert.equal(receipt.effectKind, 'uia_semantic_action')
  assert.equal(receipt.provider, 'windows')
  assert.equal(receipt.controlGeneration, 7)
  assert.deepEqual(receipt.action, { kind: 'invoke', runtimeId: '1.2' })
  assert.equal(receipt.worldStateVerified, false)
  assert.equal(receipt.perceptionRequiredForPlanning, true)
  assert.equal(receipt.deduplicated, false)
  assert.match(receipt.commandDigest, /^[0-9a-f]{64}$/)
  assert.equal(fake.calls.length, 1)
})

test('sequential retry of the same idempotent command returns cached receipt without provider I/O', async () => {
  const fake = executor()
  const runtime = new WindowsOperationalRuntime(fake)
  const first = await runtime.execute(command())
  const second = await runtime.execute(command())

  assert.equal(fake.calls.length, 1)
  assert.equal(first.commandDigest, second.commandDigest)
  assert.equal(first.completedAt, second.completedAt)
  assert.equal(first.deduplicated, false)
  assert.equal(second.deduplicated, true)
})

test('concurrent duplicate command shares one in-flight provider effect', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const fake = executor({ gate })
  const runtime = new WindowsOperationalRuntime(fake)

  const firstPromise = runtime.execute(command())
  const secondPromise = runtime.execute(command())
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.equal(fake.calls.length, 1)
  release()
  const [first, second] = await Promise.all([firstPromise, secondPromise])

  assert.equal(fake.calls.length, 1)
  assert.equal(first.deduplicated, false)
  assert.equal(second.deduplicated, true)
  assert.equal(first.commandDigest, second.commandDigest)
})

test('same idempotency key with a different command fails before another provider effect', async () => {
  const fake = executor()
  const runtime = new WindowsOperationalRuntime(fake)
  await runtime.execute(command())

  await assert.rejects(
    () => runtime.execute(command({ commandId: 'cmd:2', action: { kind: 'toggle', runtimeId: '1.3' } })),
    /idempotency conflict/,
  )
  assert.equal(fake.calls.length, 1)
})

test('failed provider effect is not cached as completed and may be retried', async () => {
  let count = 0
  const fake = {
    async perform(portalObjectId, providerResourceId, principalId, action) {
      count += 1
      if (count === 1) throw new Error('provider failed')
      return {
        schema: 'windows_uia_controlled_action_v1',
        ok: true,
        portalObjectId,
        providerResourceId,
        principalId,
        controlGeneration: 8,
        action: { kind: action.kind, runtimeId: action.runtimeId },
        inspectionCapturedAt: '2026-09-15T12:00:00.000Z',
        completedAt: '2026-09-15T12:00:00.200Z',
      }
    },
  }
  const runtime = new WindowsOperationalRuntime(fake)
  await assert.rejects(() => runtime.execute(command()), /provider failed/)
  const receipt = await runtime.execute(command())
  assert.equal(count, 2)
  assert.equal(receipt.status, 'completed')
})

test('set_value plaintext participates in command digest but never appears in effect receipt', async () => {
  const fake = executor()
  const runtime = new WindowsOperationalRuntime(fake)
  const secretLikeFixture = 'AI-RUNTIME-VALUE-NOT-A-RECEIPT'
  const receipt = await runtime.execute(command({
    commandId: 'cmd:value',
    idempotencyKey: 'idem:value',
    action: { kind: 'set_value', runtimeId: '1.5', value: secretLikeFixture },
  }))

  assert.equal(JSON.stringify(receipt).includes(secretLikeFixture), false)
  assert.deepEqual(receipt.action, { kind: 'set_value', runtimeId: '1.5' })
  assert.equal(fake.calls[0].action.value, secretLikeFixture)
})

test('Phase 15.15 operational runtime is decoupled from post-action UIA/WGC verification', async () => {
  const source = await readFile('packages/provider-windows/src/operational-runtime.ts', 'utf8')
  assert.equal(source.includes('snapshotCapture'), false)
  assert.equal(source.includes('ObserverPortalCompositor'), false)
  assert.equal(source.includes('renderObjectsToSvg'), false)
  assert.match(source, /worldStateVerified: false/)
  assert.match(source, /perceptionRequiredForPlanning: true/)

  const receiptSchema = JSON.parse(await readFile('contracts/phase15/windows-effect-receipt-v1.schema.json', 'utf8'))
  assert.equal(receiptSchema.properties.worldStateVerified.const, false)
  assert.equal(receiptSchema.properties.perceptionRequiredForPlanning.const, true)
  assert.equal(Object.hasOwn(receiptSchema.properties.action.properties, 'value'), false)

  const commandSchema = JSON.parse(await readFile('contracts/phase15/windows-operational-command-v1.schema.json', 'utf8'))
  assert.equal(commandSchema.properties.action.oneOf[1].properties.value.maxLength, 2048)
})

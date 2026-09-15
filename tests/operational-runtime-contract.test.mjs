import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('provider-neutral operational schemas remain generic and verifier-free', async () => {
  const command = JSON.parse(await readFile('contracts/phase15/mrmic-operational-command-v1.schema.json', 'utf8'))
  const receipt = JSON.parse(await readFile('contracts/phase15/mrmic-effect-receipt-v1.schema.json', 'utf8'))

  assert.equal(command.properties.schema.const, 'mrmic_operational_command_v1')
  assert.deepEqual(command.required, [
    'schema', 'commandId', 'idempotencyKey', 'provider', 'effectKind', 'principalId', 'resourceRef', 'payload',
  ])
  assert.equal(receipt.properties.schema.const, 'mrmic_effect_receipt_v1')
  assert.equal(receipt.properties.worldStateVerified.const, false)
  assert.equal(receipt.properties.perceptionRequiredForPlanning.const, true)

  const serialized = JSON.stringify({ command, receipt })
  for (const providerToken of ['windows', 'hwnd', 'uia', 'wgc', 'browser', 'terminal', 'git', 'trellis']) {
    assert.equal(serialized.toLowerCase().includes(providerToken), false, `generic schema must not hard-code ${providerToken}`)
  }
})

test('Windows operational adapter delegates shared idempotency mechanics', async () => {
  const source = await readFile('packages/provider-windows/src/operational-runtime.ts', 'utf8')
  assert.match(source, /ProviderOperationalRuntime/)
  assert.match(source, /WindowsOperationalAdapter/)
  assert.equal(source.includes("createHash"), false)
  assert.equal(source.includes('readonly #receipts = new Map'), false)
  assert.equal(source.includes('readonly #pending = new Map'), false)
  assert.equal(source.includes('snapshotCapture'), false)
  assert.equal(source.includes('ObserverPortalCompositor'), false)
})

test('shared operational core contains no provider or perception authority', async () => {
  const source = await readFile('packages/operational-runtime/src/index.ts', 'utf8')
  for (const token of [
    'provider-windows', 'WindowsUia', 'Windows.Graphics.Capture', 'snapshotCapture',
    'ObserverPortalCompositor', 'renderObjectsToSvg', 'acquireControl', 'controlOwner',
  ]) {
    assert.equal(source.includes(token), false, `shared core must not contain ${token}`)
  }
  assert.match(source, /runtime instance/)
  assert.match(source, /makes no claim/)
})

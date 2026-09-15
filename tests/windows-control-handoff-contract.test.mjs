import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES } from '../dist/packages/capability-contract/src/index.js'

test('Phase 15.14 publishes generation-bound live portal control leases', async () => {
  const leaseSchema = JSON.parse(await readFile('contracts/phase15/live-portal-control-lease-v1.schema.json', 'utf8'))
  const actionSchema = JSON.parse(await readFile('contracts/phase15/windows-uia-controlled-action-v1.schema.json', 'utf8'))
  assert.equal(leaseSchema.properties.schema.const, 'live_portal_control_lease_v1')
  assert.equal(leaseSchema.properties.generation.minimum, 0)
  assert.ok(leaseSchema.required.includes('controlOwner'))
  assert.ok(leaseSchema.required.includes('generation'))
  assert.equal(actionSchema.properties.controlGeneration.minimum, 1)
  assert.ok(actionSchema.required.includes('controlGeneration'))
  assert.deepEqual(MRMIC_CAPABILITIES.livePortalHost, {
    supported: true,
    stateVersion: 'live_portal_host_v1',
    controlLeaseSchemaVersion: 'live_portal_control_lease_v1',
    controlGenerationSupported: true,
    atomicHandoffSupported: true,
  })
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.automation.controlGenerationRequired, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.automation.preNativeActionLeaseRecheck, true)
})

test('controlled UIA action source rechecks lease generation and legacy provider access cannot dispatch actions', async () => {
  const runtime = await readFile('packages/portal-overlay/src/runtime.ts', 'utf8')
  const controlled = await readFile('packages/provider-windows/src/uia-action.ts', 'utf8')
  const provider = await readFile('packages/provider-windows/src/index.ts', 'utf8')
  assert.ok(runtime.includes("LIVE_PORTAL_CONTROL_LEASE_SCHEMA = 'live_portal_control_lease_v1'"))
  assert.ok(runtime.includes('handoffControl('))
  assert.ok(runtime.includes('#controlGenerations'))
  assert.ok(controlled.includes('assertSameLease('))
  assert.ok(controlled.includes('current.generation !== expected.generation'))
  assert.ok(controlled.includes('controlGeneration: lease.generation'))
  assert.ok(provider.includes('direct WindowsProviderAccess UIA action is disabled; use WindowsUiaControlledAccess'))
})

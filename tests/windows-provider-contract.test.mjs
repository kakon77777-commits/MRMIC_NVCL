import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES } from '../dist/packages/capability-contract/src/index.js'

test('Windows provider schemas publish bounded snapshot transport contracts', async () => {
  const capabilitySchema = JSON.parse(await readFile('contracts/phase15/windows-provider-capabilities-v1.schema.json', 'utf8'))
  const resourceSchema = JSON.parse(await readFile('contracts/phase15/windows-window-resource-v1.schema.json', 'utf8'))
  const snapshotSchema = JSON.parse(await readFile('contracts/phase15/windows-capture-snapshot-v1.schema.json', 'utf8'))
  assert.equal(capabilitySchema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/windows-provider-capabilities-v1.schema.json')
  assert.equal(resourceSchema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/windows-window-resource-v1.schema.json')
  assert.equal(snapshotSchema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/windows-capture-snapshot-v1.schema.json')
  assert.equal(capabilitySchema.properties.capture.properties.minimumBuild.const, 18362)
  assert.deepEqual(capabilitySchema.properties.capture.properties.frameTransport.enum, ['none', 'png_base64_snapshot_v1'])
  assert.equal(snapshotSchema.properties.mimeType.const, 'image/png')
  assert.equal(snapshotSchema.properties.encodedBytes.maximum, 16777216)
  assert.equal(snapshotSchema.properties.sha256.pattern, '^[0-9a-f]{64}$')
  assert.equal(resourceSchema.properties.provider.const, 'windows')
  assert.equal(resourceSchema.properties.resourceKind.const, 'desktop_window')
})

test('global capability claims bounded WGC snapshot transport but not portal completion or UIA', () => {
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.supported, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.adapterPackage, '@mrmic/provider-windows')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.adapterVersion, '0.15.4')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.required, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.protocolVersion, 'mrmic-windows-native-bridge/v1')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.referenceImplementation, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.scope, 'wgc_bounded_snapshot_transport')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.discoveryImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.captureSessionImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.frameTransportImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.captureImplemented, false)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.automationImplemented, false)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.frameTransport, 'png_base64_snapshot_v1')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.maxActiveMounts, 4)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.frameQueueCapacity, 2)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.automation.api, 'uia')
})

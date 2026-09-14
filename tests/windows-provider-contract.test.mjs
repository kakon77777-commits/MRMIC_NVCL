import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES } from '../dist/packages/capability-contract/src/index.js'

test('Windows provider schemas publish the Phase 15.4 contract surface', async () => {
  const capabilitySchema = JSON.parse(await readFile('contracts/phase15/windows-provider-capabilities-v1.schema.json', 'utf8'))
  const resourceSchema = JSON.parse(await readFile('contracts/phase15/windows-window-resource-v1.schema.json', 'utf8'))
  assert.equal(capabilitySchema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/windows-provider-capabilities-v1.schema.json')
  assert.equal(resourceSchema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/windows-window-resource-v1.schema.json')
  assert.equal(capabilitySchema.properties.capture.properties.api.const, 'windows_graphics_capture')
  assert.equal(capabilitySchema.properties.capture.properties.minimumBuild.const, 18362)
  assert.equal(capabilitySchema.properties.automation.properties.api.const, 'uia')
  assert.equal(resourceSchema.properties.provider.const, 'windows')
  assert.equal(resourceSchema.properties.resourceKind.const, 'desktop_window')
  assert.equal(resourceSchema.properties.hwndHex.pattern, '^0x[0-9a-f]+$')
})

test('global capability document does not overclaim a native Windows bridge', () => {
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.supported, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.adapterPackage, '@mrmic/provider-windows')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.adapterVersion, '0.15.4')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.required, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.referenceImplementation, false)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.api, 'windows_graphics_capture')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.automation.api, 'uia')
})

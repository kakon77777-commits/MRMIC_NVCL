import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES } from '../dist/packages/capability-contract/src/index.js'

test('global capability advertises local interactive Windows validation without overstating hosted CI evidence', async () => {
  const validation = MRMIC_CAPABILITIES.windowsProvider.interactiveValidation
  assert.equal(validation.supported, true)
  assert.equal(validation.evidenceSchemaVersion, 'interactive_windows_e2e_v1')
  assert.equal(validation.command, 'npm run windows:e2e --')
  assert.deepEqual(validation.targetSelectors, ['title', 'hwnd'])
  assert.equal(validation.callerConfirmationRequired, true)
  assert.equal(validation.hostedCiAuthoritativeUserDesktop, false)
  assert.equal(validation.evidencePersistsPixelPayload, false)

  const schema = JSON.parse(await readFile('contracts/phase13/mrmic-capabilities-v1.schema.json', 'utf8'))
  const windows = schema.properties.windowsProvider
  assert.ok(windows.required.includes('interactiveValidation'))
  const contract = windows.properties.interactiveValidation.properties
  assert.equal(contract.evidenceSchemaVersion.const, 'interactive_windows_e2e_v1')
  assert.equal(contract.hostedCiAuthoritativeUserDesktop.const, false)
  assert.equal(contract.evidencePersistsPixelPayload.const, false)
})

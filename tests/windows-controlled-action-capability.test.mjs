import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES } from '../dist/packages/capability-contract/src/index.js'

test('global capability advertises safe-target-only interactive controlled-action validation', () => {
  assert.deepEqual(MRMIC_CAPABILITIES.windowsProvider.interactiveControlValidation, {
    supported: true,
    evidenceSchemaVersion: 'interactive_windows_controlled_action_e2e_v1',
    command: 'npm run windows:control-e2e --',
    safeTargetOnly: true,
    targetTitle: 'MRMIC Phase 15.13 Controlled Action Target',
    rootAutomationId: 'MrmicControlledActionTargetRoot',
    callerConfirmationRequired: true,
    hostedCiAuthoritativeInteractiveAction: false,
    supportedActions: ['invoke', 'toggle', 'select', 'set_value'],
    evidencePersistsPixelPayload: false,
    evidencePersistsSetValuePayload: false,
    rawInputUsed: false,
  })
})

test('controlled-action evidence schema records facts/hashes but no pixel or set_value payload', async () => {
  const schema = JSON.parse(await readFile('contracts/phase15/interactive-windows-controlled-action-e2e-v1.schema.json', 'utf8'))
  assert.equal(schema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/interactive-windows-controlled-action-e2e-v1.schema.json')
  assert.equal(schema.properties.target.properties.title.const, 'MRMIC Phase 15.13 Controlled Action Target')
  assert.equal(schema.properties.target.properties.rootAutomationId.const, 'MrmicControlledActionTargetRoot')
  assert.equal(schema.properties.actions.minItems, 4)
  assert.equal(schema.properties.actions.maxItems, 4)
  assert.deepEqual(schema.$defs.action.properties.kind.enum, ['invoke', 'toggle', 'select', 'set_value'])
  assert.equal(schema.properties.privacy.properties.pixelPayloadPersisted.const, false)
  assert.equal(schema.properties.privacy.properties.setValuePayloadPersisted.const, false)
  assert.equal(schema.properties.privacy.properties.rawInputUsed.const, false)
  assert.equal('bytesBase64' in schema.$defs.visual.properties, false)
  assert.equal('value' in schema.$defs.action.properties, false)
})

test('global capability JSON schema pins hosted CI as non-authoritative for interactive semantic actions', async () => {
  const schema = JSON.parse(await readFile('contracts/phase13/mrmic-capabilities-v1.schema.json', 'utf8'))
  const control = schema.properties.windowsProvider.properties.interactiveControlValidation
  assert.equal(control.properties.safeTargetOnly.const, true)
  assert.equal(control.properties.hostedCiAuthoritativeInteractiveAction.const, false)
  assert.equal(control.properties.evidencePersistsPixelPayload.const, false)
  assert.equal(control.properties.evidencePersistsSetValuePayload.const, false)
  assert.equal(control.properties.rawInputUsed.const, false)
  assert.deepEqual(control.properties.supportedActions.const, ['invoke', 'toggle', 'select', 'set_value'])
})

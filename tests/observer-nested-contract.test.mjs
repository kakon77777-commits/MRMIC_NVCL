import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES } from '../dist/packages/capability-contract/src/index.js'

test('Phase 15.3 contracts advertise topology-authorized nested observer contexts', async () => {
  const viewSchema = JSON.parse(await readFile('contracts/phase15/observer-view-v1.schema.json', 'utf8'))
  const eventSchema = JSON.parse(await readFile('contracts/phase15/observer-workspace-event-v1.schema.json', 'utf8'))
  const commandSchema = JSON.parse(await readFile('contracts/phase15/observer-protocol-command-v1.schema.json', 'utf8'))
  const capabilitySchema = JSON.parse(await readFile('contracts/phase13/mrmic-capabilities-v1.schema.json', 'utf8'))

  const nested = viewSchema.properties.nestedCanvasContexts
  assert.equal(nested.maxItems, 64)
  assert.deepEqual(nested.items.properties.visibility.enum, ['inherit', 'hidden'])

  assert.ok(eventSchema.properties.eventType.enum.includes('view_subcanvas_entered'))
  assert.ok(eventSchema.properties.eventType.enum.includes('view_nested_visibility_set'))
  const commandKinds = commandSchema.oneOf.map(branch => branch.properties.kind.const)
  assert.ok(commandKinds.includes('enter_subcanvas'))
  assert.ok(commandKinds.includes('leave_subcanvas'))
  assert.ok(commandKinds.includes('set_nested_foreground'))

  assert.ok(capabilitySchema.properties.observerWorkspace.required.includes('nestedCanvas'))
  assert.equal(MRMIC_CAPABILITIES.observerWorkspace.nestedCanvas.supported, true)
  assert.equal(MRMIC_CAPABILITIES.observerWorkspace.nestedCanvas.topologyAuthorityRequired, true)
  assert.equal(MRMIC_CAPABILITIES.observerWorkspace.nestedCanvas.maxDepth, 64)
  assert.ok(MRMIC_CAPABILITIES.observerWorkspace.mcp.tools.includes('observer.get_canvas_contexts'))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 15.11 native helper implements bounded UIA inspection and no semantic actions', async () => {
  const inspector = await readFile('native/windows-bridge-csharp/WindowsUiaInspector.cs', 'utf8')
  const program = await readFile('native/windows-bridge-csharp/Program.cs', 'utf8')
  const project = await readFile('native/windows-bridge-csharp/MRMIC.WindowsBridge.csproj', 'utf8')

  for (const token of [
    'AutomationElement.FromHandle',
    'TreeWalker.ControlViewWalker',
    'MaxDepth = 8',
    'MaxElements = 512',
    'MaxPatternsPerElement = 32',
    'GetSupportedPatterns()',
    'current.IsPassword',
    'WINDOW_IDENTITY_MISMATCH',
  ]) assert.ok(inspector.includes(token), `missing bounded UIA primitive: ${token}`)

  assert.ok(project.includes('<UseWPF>true</UseWPF>'))
  assert.ok(program.includes('case "uia.inspect"'))
  assert.ok(program.includes('uia.Inspect('))
  assert.ok(program.includes('case "uia.action"'))
  assert.ok(program.includes('UIA_ACTION_NOT_IMPLEMENTED'))
  assert.ok(program.includes('inspectionSupported = true'))
  assert.ok(program.includes('actionSupported = false'))
  assert.ok(program.includes('valueTextIncluded = false'))
  assert.ok(!inspector.includes('ValuePattern.Current.Value'))
  assert.ok(!inspector.includes('TextPattern.DocumentRange'))
})

test('Phase 15.11 UIA contract is bounded and excludes value text payload', async () => {
  const schema = JSON.parse(await readFile('contracts/phase15/windows-uia-snapshot-v1.schema.json', 'utf8'))
  const provider = JSON.parse(await readFile('contracts/phase15/windows-provider-capabilities-v1.schema.json', 'utf8'))
  assert.equal(schema.properties.maxDepth.const, 8)
  assert.equal(schema.properties.maxElements.const, 512)
  assert.equal(schema.properties.maxPatternsPerElement.const, 32)
  assert.equal(schema.properties.elements.maxItems, 512)
  assert.equal(schema.$defs.element.properties.patterns.maxItems, 32)
  assert.equal(schema.$defs.element.additionalProperties, false)
  assert.equal('value' in schema.$defs.element.properties, false)
  assert.equal(provider.properties.automation.properties.inspectionSupported.const, true)
  assert.equal(provider.properties.automation.properties.actionSupported.const, false)
  assert.equal(provider.properties.automation.properties.valueTextIncluded.const, false)
})

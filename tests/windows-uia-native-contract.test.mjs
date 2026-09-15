import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 15.12 native helper keeps UIA inspection bounded and semantic actions identity-bound', async () => {
  const inspector = await readFile('native/windows-bridge-csharp/WindowsUiaInspector.cs', 'utf8')
  const executor = await readFile('native/windows-bridge-csharp/WindowsUiaActionExecutor.cs', 'utf8')
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
  ]) assert.ok(inspector.includes(token), `missing bounded UIA inspection primitive: ${token}`)

  for (const token of [
    'InvokePattern.Pattern',
    'TogglePattern.Pattern',
    'SelectionItemPattern.Pattern',
    'ValuePattern.Pattern',
    'MaxValueLength = 2048',
    'UIA_PASSWORD_VALUE_DENIED',
    'UIA_ELEMENT_IDENTITY_MISMATCH',
    'MaxSearchDepth = WindowsUiaInspector.MaxDepth',
    'MaxSearchElements = WindowsUiaInspector.MaxElements',
    'expected',
    '[redacted]',
  ]) assert.ok(executor.includes(token), `missing bounded UIA action primitive: ${token}`)

  assert.ok(project.includes('<UseWPF>true</UseWPF>'))
  assert.ok(program.includes('case "uia.inspect"'))
  assert.ok(program.includes('uia.Inspect('))
  assert.ok(program.includes('case "uia.action"'))
  assert.ok(program.includes('uiaActions.Execute('))
  assert.ok(program.includes('inspectionSupported = true'))
  assert.ok(program.includes('actionSupported = true'))
  assert.ok(program.includes('supportedActions = new[] { "invoke", "toggle", "select", "set_value" }'))
  assert.ok(program.includes('passwordValueWriteAllowed = false'))
  assert.ok(program.includes('inputInjectionFallback = false'))
  assert.ok(program.includes('valueTextIncluded = false'))

  assert.ok(!inspector.includes('ValuePattern.Current.Value'))
  assert.ok(!inspector.includes('TextPattern.DocumentRange'))
  assert.ok(!executor.includes('SendInput'))
  assert.ok(!executor.includes('mouse_event'))
  assert.ok(!executor.includes('keybd_event'))
})

test('Phase 15.11 UIA snapshot contract remains bounded and excludes value text payload', async () => {
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
  assert.equal(provider.properties.automation.properties.valueTextIncluded.const, false)
})

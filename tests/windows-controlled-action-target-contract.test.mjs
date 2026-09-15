import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 15.13 dedicated WPF target exposes only the fixed semantic-action fixture', async () => {
  const project = await readFile('native/windows-controlled-action-target/MRMIC.WindowsControlledActionTarget.csproj', 'utf8')
  const source = await readFile('native/windows-controlled-action-target/Program.cs', 'utf8')
  assert.ok(project.includes('<UseWPF>true</UseWPF>'))
  assert.ok(source.includes('MRMIC Phase 15.13 Controlled Action Target'))
  for (const automationId of [
    'MrmicControlledActionTargetRoot',
    'MrmicInvokeButton',
    'MrmicToggleCheckBox',
    'MrmicValueTextBox',
    'MrmicSelectItemBeta',
    'MrmicStatusText',
  ]) assert.ok(source.includes(automationId), `missing safe target AutomationId ${automationId}`)
  assert.ok(source.includes('invoke='))
  assert.ok(source.includes('toggle='))
  assert.ok(source.includes('selection='))
  assert.ok(source.includes('valueLength='))
  assert.equal(source.includes('PasswordBox'), false)
})

test('Phase 15.13 runner launches its own target and exposes no arbitrary application selector', async () => {
  const script = await readFile('scripts/windows-controlled-action-e2e.ps1', 'utf8')
  const cli = await readFile('apps/windows-controlled-action-e2e/src/index.ts', 'utf8')
  const pkg = JSON.parse(await readFile('package.json', 'utf8'))
  assert.equal(pkg.scripts['windows:control-e2e'], 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\windows-controlled-action-e2e.ps1')
  assert.ok(script.includes('MRMIC.WindowsControlledActionTarget.csproj'))
  assert.ok(script.includes('Start-Process'))
  assert.ok(script.includes('--target-pid'))
  assert.equal(script.includes('[string]$Title'), false)
  assert.equal(script.includes('[string]$Hwnd'), false)
  assert.equal(cli.includes('--title'), false)
  assert.equal(cli.includes('--hwnd'), false)
  assert.ok(cli.includes('--confirm-interactive'))
})

test('hosted CI builds but does not execute the interactive controlled-action target', async () => {
  const workflow = await readFile('.github/workflows/ci.yml', 'utf8')
  assert.ok(workflow.includes('windows-controlled-action-target\\MRMIC.WindowsControlledActionTarget.csproj'))
  assert.ok(workflow.includes('windows-controlled-action-e2e.ps1'))
  assert.equal(workflow.includes('npm run windows:control-e2e'), false)
  assert.equal(workflow.includes('Start-Process'), false)
})

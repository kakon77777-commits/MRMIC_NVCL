import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('Phase 15.10 interactive evidence schema stores hashes/facts but no captured pixel payload', async () => {
  const schema = JSON.parse(await readFile('contracts/phase15/interactive-windows-e2e-v1.schema.json', 'utf8'))
  assert.equal(schema.$id, 'https://evemisslab.com/mrmic/contracts/phase15/interactive-windows-e2e-v1.schema.json')
  assert.equal(schema.properties.schema.const, 'interactive_windows_e2e_v1')
  assert.equal(schema.properties.passed.const, true)
  assert.equal(schema.properties.interactiveSessionConfirmedByCaller.const, true)
  const sampleProperties = schema.properties.capture.properties.samples.items.properties
  assert.equal(sampleProperties.sha256.pattern, '^[0-9a-f]{64}$')
  assert.equal(sampleProperties.encodedBytes.maximum, 16777216)
  assert.equal(sampleProperties.svgContainsProjectedImage.const, true)
  assert.equal(Object.hasOwn(sampleProperties, 'bytesBase64'), false)
  assert.equal(Object.hasOwn(sampleProperties, 'dataUri'), false)
  assert.match(schema.$comment, /excludes bytesBase64, data URIs/)
})

test('PowerShell interactive runner builds both native and TypeScript authorities before executing the real harness', async () => {
  const script = await readFile('scripts/windows-interactive-e2e.ps1', 'utf8')
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  assert.match(script, /dotnet build .*MRMIC\.WindowsBridge\.csproj -c Release/)
  assert.match(script, /npm run build/)
  assert.match(script, /--confirm-interactive/)
  assert.match(script, /--bridge-dll/)
  assert.match(script, /--title/)
  assert.match(script, /--hwnd/)
  assert.equal(packageJson.scripts['windows:e2e'], 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\windows-interactive-e2e.ps1')
})

test('interactive CLI is Windows-only and requires caller confirmation instead of treating hosted CI as user-desktop evidence', async () => {
  const cli = await readFile('apps/windows-interactive-e2e/src/index.ts', 'utf8')
  assert.match(cli, /process\.platform !== 'win32'/)
  assert.match(cli, /--confirm-interactive is required/)
  assert.match(cli, /MRMIC_WINDOWS_BRIDGE_DLL/)
  assert.match(cli, /interactive Windows E2E can only run on Windows/)
})

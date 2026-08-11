import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CodexAccountMultimodalProvider,
  codexGestureOutputSchema,
  codexVisualObservationOutputSchema,
  normalizeCodexUsage,
  resolveCodexExecutable,
} from '../dist/packages/provider-codex-account/src/index.js'

test('Codex provider resolves only a versioned user-local executable and exposes a bounded schema', () => {
  const fixture = mkdtempSync(join(tmpdir(), 'mrmic-codex-provider-'))
  const versionDir = join(fixture, 'OpenAI', 'Codex', 'bin', 'versioned-build')
  mkdirSync(versionDir, { recursive: true })
  const expected = join(versionDir, process.platform === 'win32' ? 'codex.exe' : 'codex')
  writeFileSync(expected, '')
  const executable = resolveCodexExecutable(fixture)
  assert.equal(executable, expected)
  assert.match(executable, process.platform === 'win32'
    ? /OpenAI[\\/]Codex[\\/]bin[\\/][^\\/]+[\\/]codex\.exe$/i
    : /OpenAI[\\/]Codex[\\/]bin[\\/][^\\/]+[\\/]codex$/i)
  assert.equal(executable.toLowerCase().includes('windowsapps'), false)
  rmSync(fixture, { recursive: true, force: true })

  const schema = codexGestureOutputSchema()
  assert.equal(schema.type, 'object')
  assert.equal(schema.additionalProperties, false)
  assert.deepEqual(schema.properties.type.enum, ['gesture', 'stop'])
  assert.equal(schema.required.length, Object.keys(schema.properties).length)
  assert.equal(JSON.stringify(schema).includes('oneOf'), false)
  assert.equal(JSON.stringify(schema).includes('objectId'), false)
  assert.match(JSON.stringify(schema), /normalized_frame/)

  const observationSchema = codexVisualObservationOutputSchema()
  assert.equal(observationSchema.type, 'object')
  assert.equal(observationSchema.additionalProperties, false)
  assert.deepEqual(observationSchema.properties.circleColor.enum, ['red', 'amber', 'other', 'not_visible'])
  assert.equal(observationSchema.required.length, Object.keys(observationSchema.properties).length)
  assert.equal(JSON.stringify(observationSchema).includes('objectId'), false)
})

test('Codex token telemetry is normalized without exposing thread totals', () => {
  const usage = normalizeCodexUsage({
    threadId: 'thread-private',
    turnId: 'turn-private',
    tokenUsage: {
      last: {
        inputTokens: 100,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 0,
        outputTokens: 20,
        reasoningOutputTokens: 5,
        totalTokens: 125,
      },
      total: {
        inputTokens: 999,
        cachedInputTokens: 400,
        cacheWriteInputTokens: 0,
        outputTokens: 200,
        reasoningOutputTokens: 50,
        totalTokens: 1249,
      },
      modelContextWindow: 100000,
    },
  })
  assert.deepEqual(usage, {
    inputTokens: 100,
    cachedInputTokens: 40,
    outputTokens: 20,
    reasoningOutputTokens: 5,
    totalTokens: 125,
  })
  assert.equal(JSON.stringify(usage).includes('thread'), false)
})

const liveExecutable = resolveCodexExecutable()
test('Codex provider capability probe is sanitized and does not access credential files', { skip: !liveExecutable }, async () => {
  const provider = new CodexAccountMultimodalProvider({ timeoutMs: 15_000 })
  const probe = await provider.probe()
  assert.equal(probe.provider, 'openai_codex_account')
  assert.equal(probe.executableAvailable, true)
  assert.equal(probe.appServer, 'available')
  assert.ok(probe.imageModels.length > 0)
  assert.equal(typeof probe.selectedModel, 'string')
  assert.equal(probe.credentialFilesAccessed, false)
  assert.equal(JSON.stringify(probe).toLowerCase().includes('token'), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('AI Board operational capability contract pins authority-bound identity and ambiguous replay refusal', async () => {
  const schema = JSON.parse(await readFile('contracts/phase15/ai-board-operational-capabilities-v1.schema.json', 'utf8'))
  assert.equal(schema.properties.schema.const, 'ai_board_operational_capabilities_v1')
  assert.equal(schema.properties.provider.const, 'ai_board')
  assert.equal(schema.properties.resourceKind.const, 'ai_board_thread')
  assert.equal(schema.properties.sharedRuntimeVersion.const, 'provider_operational_runtime_v1')
  assert.deepEqual(schema.properties.supportedEffects.const, ['message.append'])
  assert.equal(schema.properties.authorityBoundIdentity.const, true)
  assert.equal(schema.properties.callerSuppliedProviderIdentity.const, false)
  assert.equal(schema.properties.appendTarget.const, 'existing_thread_root')
  assert.equal(schema.properties.receiptIncludesContent.const, false)
  assert.equal(schema.properties.providerNativeIdempotency.const, false)
  assert.equal(schema.properties.ambiguousOutcomePolicy.const, 'refuse_same_command_replay')
  assert.equal(schema.properties.ambiguousOutcomeScope.const, 'runtime_instance')
  assert.equal(schema.properties.maxAmbiguousOutcomes.const, 256)
})

test('AI Board production adapter uses the shared runtime and contains no synchronous verifier loop', async () => {
  const source = await readFile('packages/provider-ai-board/src/operational-runtime.ts', 'utf8')
  assert.match(source, /ProviderOperationalRuntime/)
  assert.match(source, /AiBoardOperationalAuthority/)
  assert.match(source, /postMessage/)
  assert.match(source, /automatic retry refused/)
  assert.equal(source.includes('snapshotCapture'), false)
  assert.equal(source.includes('ObserverPortalCompositor'), false)
  assert.equal(source.includes('renderObjectsToSvg'), false)
  assert.equal(source.includes('postActionVerification'), false)
  assert.equal(source.includes('humanApproval'), false)

  const indexSource = await readFile('packages/provider-ai-board/src/index.ts', 'utf8')
  assert.match(indexSource, /export \* from '\.\/operational-runtime\.js'/)
})

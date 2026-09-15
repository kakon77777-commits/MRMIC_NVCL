import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { MRMIC_CAPABILITIES, MRMIC_CAPABILITIES_URI } from '../dist/packages/capability-contract/src/index.js'
import { createPhase12Server } from '../dist/apps/web/src/server.js'

test('HTTP and MCP expose one versioned provider-neutral capability document', async () => {
  const app = createPhase12Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  try {
    const http = await fetch(`${started.url}/api/capabilities`).then(response => response.json())
    assert.deepEqual(http, MRMIC_CAPABILITIES)

    const listed = await app.mcp.dispatchForTesting({ jsonrpc: '2.0', id: 1, method: 'resources/list' })
    assert.ok(listed.result.resources.some(resource => resource.uri === MRMIC_CAPABILITIES_URI))
    const read = await app.mcp.dispatchForTesting({
      jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: MRMIC_CAPABILITIES_URI },
    })
    assert.deepEqual(JSON.parse(read.result.contents[0].text), MRMIC_CAPABILITIES)
  } finally {
    await app.close()
  }
})

test('capability schema advertises provider-neutral operational runtime plus Windows and AI Board adapters', async () => {
  const schema = JSON.parse(await readFile('contracts/phase13/mrmic-capabilities-v1.schema.json', 'utf8'))
  assert.equal(schema.$id, 'https://evemisslab.com/schemas/mrmic-capabilities-v1.schema.json')
  assert.deepEqual(schema.required, [
    'schema', 'mrmicVersion', 'canvasSchemaVersion', 'mcpProtocolProfile', 'projectionModes',
    'authModes', 'resourcePortal', 'runtimePresence', 'livePortalHost', 'operationalRuntime', 'observerWorkspace', 'windowsProvider',
  ])
  assert.equal(MRMIC_CAPABILITIES.schema, 'mrmic-capabilities/v1')
  assert.equal(MRMIC_CAPABILITIES.mrmicVersion, '0.14.0')
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('native_resource_portal_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('observer_relative_view_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_desktop_window_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_snapshot_portal_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('observer_portal_refresh_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_uia_inspection_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_uia_controlled_action_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_ai_native_operational_runtime_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('provider_neutral_operational_runtime_v1'))

  assert.equal(MRMIC_CAPABILITIES.resourcePortal.supported, true)
  assert.equal(MRMIC_CAPABILITIES.runtimePresence.supported, true)
  assert.deepEqual(MRMIC_CAPABILITIES.livePortalHost, {
    supported: true,
    stateVersion: 'live_portal_host_v1',
    controlLeaseSchemaVersion: 'live_portal_control_lease_v1',
    controlGenerationSupported: true,
    atomicHandoffSupported: true,
  })

  assert.deepEqual(MRMIC_CAPABILITIES.operationalRuntime, {
    supported: true,
    runtimeVersion: 'provider_operational_runtime_v1',
    commandSchemaVersion: 'mrmic_operational_command_v1',
    effectReceiptSchemaVersion: 'mrmic_effect_receipt_v1',
    idempotencyScope: 'runtime_instance',
    maxCachedReceipts: 256,
    providerAdapters: ['windows', 'ai_board'],
    strongerProviderIdempotencyAllowed: true,
    postActionVerificationRequired: false,
    continuousPerceptionDecoupled: true,
    effectReceiptClaimsWorldState: false,
    mrmicHumanApprovalGateRequired: false,
    conformanceHarnessRuntimeAuthority: false,
  })

  assert.equal(schema.properties.operationalRuntime.properties.runtimeVersion.const, 'provider_operational_runtime_v1')
  assert.equal(schema.properties.operationalRuntime.properties.commandSchemaVersion.const, 'mrmic_operational_command_v1')
  assert.equal(schema.properties.operationalRuntime.properties.effectReceiptSchemaVersion.const, 'mrmic_effect_receipt_v1')
  assert.deepEqual(schema.properties.operationalRuntime.properties.providerAdapters.const, ['windows', 'ai_board'])
  assert.equal(schema.properties.operationalRuntime.properties.postActionVerificationRequired.const, false)
  assert.equal(schema.properties.operationalRuntime.properties.continuousPerceptionDecoupled.const, true)

  assert.equal(MRMIC_CAPABILITIES.observerWorkspace.supported, true)
  assert.equal(MRMIC_CAPABILITIES.observerWorkspace.durable, true)
  assert.equal(MRMIC_CAPABILITIES.observerWorkspace.authRequired, true)

  assert.equal(MRMIC_CAPABILITIES.windowsProvider.providerId, 'windows')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.api, 'windows_graphics_capture')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.minimumBuild, 18362)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.sessionLifecycleSupported, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.frameTransport, 'png_base64_snapshot_v1')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.portalProjection, 'ephemeral_render_copy_v1')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.observerGated, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.canonicalPixelsDurable, false)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.maxActiveMounts, 4)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.frameQueueCapacity, 2)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.maxSnapshotPixels, 8294400)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.capture.maxSnapshotBytes, 16777216)
  assert.deepEqual(MRMIC_CAPABILITIES.windowsProvider.capture.refresh, {
    policySchemaVersion: 'observer_portal_refresh_policy_v1',
    liveRefreshMs: 250,
    warmRefreshMs: 2000,
    sharedRefreshMs: 500,
    policyPollMs: 1000,
    maxCachedFramesPerTarget: 4,
    frozenRetainsLastFrame: true,
    sleepingDropsFrame: true,
    nonOverlapping: true,
  })
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.scope, 'observer_gated_snapshot_portal')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.discoveryImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.captureSessionImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.frameTransportImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.captureImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.automationInspectionImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.automationImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.rawInputInjectionImplemented, false)

  assert.deepEqual(MRMIC_CAPABILITIES.windowsProvider.operationalAdapter, {
    supported: true,
    sharedRuntimeVersion: 'provider_operational_runtime_v1',
    commandSchemaVersion: 'windows_operational_command_v1',
    effectReceiptSchemaVersion: 'windows_effect_receipt_v1',
  })
  assert.equal(Object.hasOwn(MRMIC_CAPABILITIES.windowsProvider, 'operationalRuntime'), false)

  assert.deepEqual(MRMIC_CAPABILITIES.windowsProvider.automation, {
    api: 'uia',
    inspectionSupported: true,
    actionSupported: true,
    snapshotSchemaVersion: 'windows_uia_snapshot_v1',
    actionResultSchemaVersion: 'windows_uia_controlled_action_v1',
    supportedActions: ['invoke', 'toggle', 'select', 'set_value'],
    controlOwnerRequired: true,
    controlGenerationRequired: true,
    freshInspectionRequired: true,
    preNativeActionLeaseRecheck: true,
    maxInspectionAgeMs: 2000,
    actionValueMaxLength: 2048,
    passwordValueWriteAllowed: false,
    maxDepth: 8,
    maxElements: 512,
    maxPatternsPerElement: 32,
    valueTextIncluded: false,
    semanticPatternsPreferred: true,
    inputInjectionFallback: 'disabled',
    rawInputInjectionImplemented: false,
    interactiveDesktopRequiredForInjection: true,
  })
})

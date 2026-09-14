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

test('capability schema advertises observer-gated Windows snapshot portal projection', async () => {
  const schema = JSON.parse(await readFile('contracts/phase13/mrmic-capabilities-v1.schema.json', 'utf8'))
  assert.equal(schema.$id, 'https://evemisslab.com/schemas/mrmic-capabilities-v1.schema.json')
  assert.deepEqual(schema.required, [
    'schema', 'mrmicVersion', 'canvasSchemaVersion', 'mcpProtocolProfile', 'projectionModes',
    'authModes', 'resourcePortal', 'runtimePresence', 'livePortalHost', 'observerWorkspace', 'windowsProvider',
  ])
  assert.equal(MRMIC_CAPABILITIES.schema, 'mrmic-capabilities/v1')
  assert.equal(MRMIC_CAPABILITIES.mrmicVersion, '0.14.0')
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('native_resource_portal_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('observer_relative_view_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_desktop_window_v1'))
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('windows_snapshot_portal_v1'))
  assert.equal(MRMIC_CAPABILITIES.resourcePortal.supported, true)
  assert.equal(MRMIC_CAPABILITIES.runtimePresence.supported, true)
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
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.scope, 'observer_gated_snapshot_portal')
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.discoveryImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.captureSessionImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.frameTransportImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.captureImplemented, true)
  assert.equal(MRMIC_CAPABILITIES.windowsProvider.nativeBridge.automationImplemented, false)
})

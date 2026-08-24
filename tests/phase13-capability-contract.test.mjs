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

test('capability schema and document advertise the required Phase 13 contract surface', async () => {
  const schema = JSON.parse(await readFile('contracts/phase13/mrmic-capabilities-v1.schema.json', 'utf8'))
  assert.equal(schema.$id, 'https://evemisslab.com/schemas/mrmic-capabilities-v1.schema.json')
  assert.deepEqual(schema.required, [
    'schema', 'mrmicVersion', 'canvasSchemaVersion', 'mcpProtocolProfile', 'projectionModes',
    'authModes', 'resourcePortal', 'runtimePresence', 'livePortalHost',
  ])
  assert.equal(MRMIC_CAPABILITIES.schema, 'mrmic-capabilities/v1')
  assert.equal(MRMIC_CAPABILITIES.mrmicVersion, '0.14.0')
  assert.ok(MRMIC_CAPABILITIES.projectionModes.includes('native_resource_portal_v1'))
  assert.equal(MRMIC_CAPABILITIES.resourcePortal.supported, true)
  assert.equal(MRMIC_CAPABILITIES.runtimePresence.supported, true)
})

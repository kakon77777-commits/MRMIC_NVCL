import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { migrateCompatFrameV0 } from '../dist/packages/resource-portal/src/index.js'

const actor = { actorType: 'agent', actorId: 'mrmic:verified-pmw-binding' }
const at = '2026-08-24T00:00:00.000Z'

test('compat_frame_v0 deterministically migrates to native_resource_portal_v1', async () => {
  const input = JSON.parse(await readFile('contracts/phase13/fixtures/compat-frame-v0.json', 'utf8'))
  const expected = JSON.parse(await readFile('contracts/phase13/fixtures/native-resource-portal-v1.json', 'utf8'))
  assert.deepEqual(migrateCompatFrameV0(input, actor, at), expected)
})

test('compat migration rejects malformed or identity-owning legacy frames', () => {
  const validMinimum = {
    schema: 'compat_frame_v0', canvasObjectId: 'portal-x', canvasId: 'root', portalId: 'portal-x',
    pmwWorkspaceId: 'pmw', provider: 'herdr', resourceKind: 'terminal_agent', providerResourceId: 'term-1',
    transform: { x: 0, y: 0, width: 10, height: 10, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
  }
  const { canvasObjectId: _omitted, ...missingCanvasObjectId } = validMinimum
  assert.throws(() => migrateCompatFrameV0(missingCanvasObjectId, actor, at), /canvasObjectId/)
  assert.throws(() => migrateCompatFrameV0({
    ...validMinimum,
    principalId: 'forged',
  }, actor, at), /identity fields are not allowed/)
})

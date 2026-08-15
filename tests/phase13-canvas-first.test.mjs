import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SchemaValidationError,
  resourcePortalDescriptor,
  validateCanvasObject,
} from '../dist/packages/canvas-schema/src/index.js'
import { renderObjectsToSvg } from '../dist/packages/adapter-svg/src/index.js'
import {
  StaticBearerIdentityResolver,
  parsePrincipalBindings,
} from '../dist/packages/identity-auth/src/index.js'
import { bindPresenceToPrincipal } from '../dist/packages/websocket-sync/src/index.js'
import { ResourcePortalProjectionRegistry } from '../dist/packages/resource-portal/src/index.js'
import { StateVectorSyncRoom } from '../dist/packages/state-vector-sync/src/index.js'

const now = new Date().toISOString()
const actor = { actorType: 'agent', actorId: 'agent:claude-main' }

function portal(overrides = {}) {
  return {
    id: 'portal-browser-a', canvasId: 'root', type: 'resource_portal',
    transform: { x: 20, y: 30, width: 640, height: 420, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 10 },
    style: {},
    content: { text: 'Research Browser A', previewUri: 'https://example.test/preview.png' },
    childIds: [], bindings: [],
    metadata: {
      portal: {
        portalId: 'portal-browser-a',
        pmwWorkspaceId: 'pmw-ws-1',
        pmwTaskId: 'pmw-task-1',
        provider: 'tandem',
        resourceKind: 'browser_tab',
        providerResourceId: 'tab-2',
        displayMode: 'snapshot',
        interactionMode: 'control',
        ownerSemanticAgentId: 'agent:claude-main',
      },
    },
    createdBy: actor, createdAt: now, updatedAt: now, revision: 0,
    ...overrides,
  }
}

test('resource_portal is a first-class validated canvas object', () => {
  const value = portal()
  validateCanvasObject(value)
  const descriptor = resourcePortalDescriptor(value)
  assert.equal(descriptor.provider, 'tandem')
  assert.equal(descriptor.resourceKind, 'browser_tab')
  assert.equal(descriptor.providerResourceId, 'tab-2')
})

test('resource_portal fails closed without a valid provider descriptor', () => {
  const value = portal({ metadata: {} })
  assert.throws(() => validateCanvasObject(value), SchemaValidationError)
})

test('resource portal SVG preserves provider/resource identity in the visual projection', () => {
  const svg = renderObjectsToSvg([portal()], { x: 0, y: 0, width: 1200, height: 800, zoom: 1 })
  assert.match(svg, /data-resource-provider="tandem"/)
  assert.match(svg, /data-resource-kind="browser_tab"/)
  assert.match(svg, /tab-2/)
  assert.match(svg, /Research Browser A/)
})

test('static bearer resolver returns a verified semantic principal and rejects other tokens', () => {
  const resolver = new StaticBearerIdentityResolver([{
    token: 'phase13-test-token-claude',
    principalId: 'principal:claude-local',
    role: 'agent-direct',
    actorType: 'agent',
    actorId: 'mrmic:claude-binding',
    semanticAgentId: 'agent:claude-main',
  }])
  assert.equal(resolver.resolveToken('wrong-token-value'), null)
  const principal = resolver.resolveToken('phase13-test-token-claude')
  assert.equal(principal?.semanticAgentId, 'agent:claude-main')
  assert.equal(principal?.actor.actorId, 'mrmic:claude-binding')
})

test('binding JSON parser rejects empty binding sets', () => {
  assert.throws(() => parsePrincipalBindings('[]'))
})

test('authenticated presence overrides forged actor identity', () => {
  const principal = new StaticBearerIdentityResolver([{
    token: 'phase13-test-token-codex',
    principalId: 'principal:codex-local',
    role: 'agent-direct',
    actorType: 'agent',
    actorId: 'mrmic:codex-binding',
    semanticAgentId: 'agent:codex-reviewer',
  }]).resolveToken('phase13-test-token-codex')
  assert.ok(principal)
  const presence = bindPresenceToPrincipal({
    actorType: 'user', actorId: 'user:neo', label: 'Codex', cursor: { x: 4, y: 9 },
  }, 'client-codex', principal)
  assert.equal(presence.actorType, 'agent')
  assert.equal(presence.actorId, 'mrmic:codex-binding')
  assert.equal(presence.semanticAgentId, 'agent:codex-reviewer')
  assert.equal(presence.identityStatus, 'verified')
})

test('anonymous peers cannot claim agent/system presence', () => {
  assert.throws(() => bindPresenceToPrincipal({ actorType: 'agent', actorId: 'agent:fake', label: 'fake' }, 'client-x'))
})

test('local browser presence is sanitized instead of trusting caller actorId', () => {
  const presence = bindPresenceToPrincipal({ actorType: 'user', actorId: 'user:neo', label: 'Browser' }, 'browser-123')
  assert.equal(presence.actorId, 'ui:browser-123')
  assert.equal(presence.identityStatus, 'local_ui')
})

test('projection registry separates canvas geometry from provider lifecycle', () => {
  const registry = new ResourcePortalProjectionRegistry()
  const initial = registry.upsertFromCanvasObject(portal())
  assert.equal(initial.lifecycle, 'projected_snapshot')
  const live = registry.setLifecycle('portal-browser-a', 'projected_live', { liveHandle: 'tandem:webcontents:42' })
  assert.equal(live.liveHandle, 'tandem:webcontents:42')
  assert.equal(live.descriptor.providerResourceId, 'tab-2')
})

test('presence remains ephemeral and can preserve verified semantic identity in a room', () => {
  const room = new StateVectorSyncRoom({
    roomId: 'ws:root',
    applyTransaction: () => ({ ok: true, transactionId: 'noop', canvasId: 'root', revision: 0, affectedObjectIds: [], beforeHash: 'a', afterHash: 'a' }),
  })
  room.setPresence({
    clientId: 'claude-client', actorType: 'agent', actorId: 'mrmic:claude-binding', label: 'Claude',
    semanticAgentId: 'agent:claude-main', principalId: 'principal:claude-local', identityStatus: 'verified', updatedAt: now,
  })
  assert.equal(room.presenceSnapshot()[0]?.semanticAgentId, 'agent:claude-main')
  room.removePresence('claude-client')
  assert.equal(room.presenceSnapshot().length, 0)
})

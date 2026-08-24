import test from 'node:test'
import assert from 'node:assert/strict'
import { resourcePortalDescriptor, validateCanvasObject } from '../dist/packages/canvas-schema/src/index.js'
import { createTandemBrowserPortal } from '../dist/packages/provider-tandem/src/index.js'

const actor = { actorType: 'agent', actorId: 'mrmic:claude-binding' }

function tandemResource(overrides = {}) {
  return {
    provider: 'tandem',
    resourceKind: 'browser_tab',
    providerResourceId: 'tab-17',
    resourceUri: 'tandem://browser/tab/tab-17',
    title: 'Evidence Search',
    url: 'https://example.com/private-provider-state',
    workspaceId: 'tandem-ws-1',
    webContentsId: 17,
    partition: 'persist:tandem',
    source: 'ai',
    state: {
      mounted: true,
      loading: false,
      focused: false,
      visible: false,
      legacyFocusVisibilityCoupled: true,
    },
    projection: {
      preferredDisplayMode: 'snapshot',
      previewUri: 'tandem://browser/tab/tab-17/preview.png',
      liveMountUri: 'tandem://browser/tab/tab-17/live',
      liveMountKind: 'electron-webview',
    },
    capabilities: ['snapshot', 'live', 'navigate', 'dom', 'mcp', 'session_state'],
    ...overrides,
  }
}

test('Tandem provider descriptor becomes a first-class MRMIC resource_portal', () => {
  const object = createTandemBrowserPortal({
    resource: tandemResource(),
    portalId: 'portal-browser-17',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    pmwTaskId: 'pmw-task-1',
    ownerSemanticAgentId: 'agent:claude-main',
    actor,
    transform: { x: 100, y: 200, width: 1200, height: 700, zIndex: 5 },
    createdAt: '2026-08-15T00:00:00.000Z',
  })

  assert.doesNotThrow(() => validateCanvasObject(object))
  assert.equal(object.type, 'resource_portal')
  assert.equal(object.content.resourceUri, 'tandem://browser/tab/tab-17')
  assert.equal(object.content.previewUri, 'tandem://browser/tab/tab-17/preview.png')
  assert.deepEqual(resourcePortalDescriptor(object), {
    portalId: 'portal-browser-17',
    pmwWorkspaceId: 'pmw-ws-1',
    pmwTaskId: 'pmw-task-1',
    provider: 'tandem',
    resourceKind: 'browser_tab',
    providerResourceId: 'tab-17',
    displayMode: 'snapshot',
    interactionMode: 'inspect',
    ownerSemanticAgentId: 'agent:claude-main',
  })
})

test('Canvas projection does not copy Tandem URL/browser dynamic state as canonical portal metadata', () => {
  const object = createTandemBrowserPortal({
    resource: tandemResource(),
    portalId: 'portal-browser-17',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    actor,
    createdAt: '2026-08-15T00:00:00.000Z',
  })
  const serializedMetadata = JSON.stringify(object.metadata)
  assert.equal(serializedMetadata.includes('private-provider-state'), false)
  assert.equal(serializedMetadata.includes('"loading"'), false)
  assert.equal(serializedMetadata.includes('"focused"'), false)
  assert.equal(serializedMetadata.includes('"visible"'), false)
  assert.equal(object.metadata.providerRef.resourceUri, 'tandem://browser/tab/tab-17')
})

test('Tandem provider identity mismatch fails closed before a Canvas object is created', () => {
  assert.throws(() => createTandemBrowserPortal({
    resource: tandemResource({ resourceUri: 'tandem://browser/tab/different-tab' }),
    portalId: 'portal-browser-17',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    actor,
  }), /resourceUri must equal/)
})

test('live portal mode preserves provider live-mount handle without owning WebContents state', () => {
  const object = createTandemBrowserPortal({
    resource: tandemResource(),
    portalId: 'portal-browser-17',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    actor,
    displayMode: 'live',
    interactionMode: 'control',
  })
  const descriptor = resourcePortalDescriptor(object)
  assert.equal(descriptor.displayMode, 'live')
  assert.equal(descriptor.interactionMode, 'control')
  assert.equal(object.metadata.providerRef.liveMountUri, 'tandem://browser/tab/tab-17/live')
  assert.equal(object.metadata.providerRef.liveMountKind, 'electron-webview')
})

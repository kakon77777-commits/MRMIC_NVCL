import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WindowsLivePortalHost,
  WindowsProviderAccess,
  WindowsProviderCatalog,
  createWindowsWindowPortal,
  discoverableWindows,
  toWindowsWindowResource,
  windowsProviderResourceId,
} from '../dist/packages/provider-windows/src/index.js'
import {
  CanvasLivePortalCoordinator,
  LivePortalHostRegistry,
} from '../dist/packages/portal-overlay/src/runtime.js'

const capabilities = {
  schema: 'windows_provider_capabilities_v1',
  provider: 'windows',
  providerEpoch: 'epoch-1',
  platform: 'win32',
  capture: {
    api: 'windows_graphics_capture',
    supported: true,
    minimumBuild: 18362,
    target: 'hwnd',
  },
  automation: {
    api: 'uia',
    supported: true,
    semanticPatternsPreferred: true,
    inputInjectionFallback: false,
    interactiveDesktopRequiredForInjection: true,
  },
}

const windows = [
  { hwndHex: '0x101', processId: 10, threadId: 11, title: 'Editor', visible: true, minimized: false, cloakState: 'none' },
  { hwndHex: '0x102', processId: 12, threadId: 13, title: 'Shell cloaked', visible: true, minimized: false, cloakState: 'shell' },
  { hwndHex: '0x103', processId: 14, threadId: 15, title: '', visible: true, minimized: false, cloakState: 'none' },
]

function bridge() {
  const calls = []
  return {
    calls,
    capabilities() { return capabilities },
    async enumerateTopLevelWindows() { return structuredClone(windows) },
    async mountCapture(resource, rect) {
      calls.push(['mount', resource.providerResourceId, rect])
      return { mountId: 'mount-1', providerResourceId: resource.providerResourceId }
    },
    async updateCapture(mount, rect) { calls.push(['update', mount.mountId, rect]) },
    async unmountCapture(mount) { calls.push(['unmount', mount.mountId]) },
    async inspectUi(resource) {
      calls.push(['inspect', resource.providerResourceId])
      return {
        schema: 'windows_uia_snapshot_v1',
        providerResourceId: resource.providerResourceId,
        capturedAt: '2026-09-14T08:00:00Z',
        root: { runtimeId: 'root', patterns: [] },
        elements: [],
      }
    },
    async performUiAction(resource, action) {
      calls.push(['action', resource.providerResourceId, action.kind])
      return {
        ok: true,
        providerResourceId: resource.providerResourceId,
        action,
        completedAt: '2026-09-14T08:00:01Z',
      }
    },
  }
}

async function catalogFixture() {
  const native = bridge()
  const catalog = new WindowsProviderCatalog(native)
  const resources = await catalog.refresh()
  assert.equal(resources.length, 1)
  return { native, catalog, resource: resources[0] }
}

test('Windows discovery filters cloaked and untitled top-level windows', () => {
  assert.deepEqual(discoverableWindows(windows).map(window => window.title), ['Editor'])
})

test('Windows resource identity is bound to provider epoch, PID and HWND', () => {
  assert.equal(windowsProviderResourceId('epoch-1', windows[0]), 'window:epoch-1:10:0x101')
})

test('Windows descriptor advertises Graphics Capture and UIA without durable liveness claims', () => {
  const resource = toWindowsWindowResource('epoch-1', windows[0], capabilities, '2026-09-14T08:00:00Z')
  assert.equal(resource.projection.liveMountKind, 'windows-graphics-capture')
  assert.equal(resource.automation.api, 'uia')
  assert.equal(resource.providerResourceId, 'window:epoch-1:10:0x101')
  assert.equal(resource.state.cloakState, 'none')
})

test('Windows catalog replaces provider-local discovery state on refresh', async () => {
  const { catalog, resource } = await catalogFixture()
  assert.equal(catalog.get(resource.providerResourceId).title, 'Editor')
  assert.equal(catalog.capabilities().providerEpoch, 'epoch-1')
})

test('Windows window becomes a first-class windows/desktop_window resource portal', async () => {
  const { resource } = await catalogFixture()
  const portal = createWindowsWindowPortal({
    resource,
    portalId: 'windows-editor',
    canvasId: 'root',
    pmwWorkspaceId: 'ws',
    actor: { actorType: 'user', actorId: 'user:neo' },
    createdAt: '2026-09-14T08:00:00Z',
  })
  assert.equal(portal.metadata.portal.provider, 'windows')
  assert.equal(portal.metadata.portal.resourceKind, 'desktop_window')
  assert.equal(portal.metadata.providerRef.providerEpoch, 'epoch-1')
  assert.equal(portal.metadata.providerRef.liveMountKind, 'windows-graphics-capture')
})

test('Windows live host preserves provider resource identity across mount/update/unmount', async () => {
  const { native, catalog, resource } = await catalogFixture()
  const host = new WindowsLivePortalHost(native, catalog)
  const handle = {
    portalObjectId: 'portal:windows-editor',
    provider: 'windows',
    providerResourceId: resource.providerResourceId,
  }
  await host.mount(handle, { left: 0, top: 0, width: 100, height: 100, visible: true })
  assert.equal(host.isMounted(handle.portalObjectId), true)
  await host.update(handle, { left: 5, top: 5, width: 100, height: 100, visible: true })
  await host.unmount(handle)
  assert.equal(host.isMounted(handle.portalObjectId), false)
  assert.deepEqual(native.calls.map(call => call[0]), ['mount', 'update', 'unmount'])
})

test('Windows live host plugs into the existing Canvas live portal coordinator', async () => {
  const { native, catalog, resource } = await catalogFixture()
  const host = new WindowsLivePortalHost(native, catalog)
  const hosts = new LivePortalHostRegistry()
  hosts.register('windows', host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  const portal = createWindowsWindowPortal({
    resource,
    portalId: 'windows-editor',
    canvasObjectId: 'portal:windows-editor',
    canvasId: 'root',
    pmwWorkspaceId: 'ws',
    actor: { actorType: 'user', actorId: 'user:neo' },
    createdAt: '2026-09-14T08:00:00Z',
  })
  const result = await coordinator.activate(
    portal,
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { left: 0, top: 0, width: 1200, height: 800 },
  )
  assert.equal(result.provider, 'windows')
  assert.equal(result.mounted, true)
  assert.equal(coordinator.state(portal.id).controlOwner, null)
  await coordinator.deactivate(portal.id)
})

test('structured UI inspection and semantic action use separate inspect/control authority', async () => {
  const { native, catalog, resource } = await catalogFixture()
  const access = new WindowsProviderAccess(native, catalog, {
    canInspect: ({ principalId }) => principalId === 'reader' || principalId === 'owner',
    canControl: ({ principalId }) => principalId === 'owner',
  })
  const snapshot = await access.inspectUi('portal:windows-editor', resource.providerResourceId, 'reader')
  assert.equal(snapshot.providerResourceId, resource.providerResourceId)
  await assert.rejects(
    () => access.performUiAction('portal:windows-editor', resource.providerResourceId, 'reader', { kind: 'invoke', runtimeId: 'button:1' }),
    /does not own Windows portal control/,
  )
  const result = await access.performUiAction(
    'portal:windows-editor',
    resource.providerResourceId,
    'owner',
    { kind: 'invoke', runtimeId: 'button:1' },
  )
  assert.equal(result.ok, true)
})

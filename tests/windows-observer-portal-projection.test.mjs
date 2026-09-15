import test from 'node:test'
import assert from 'node:assert/strict'
import { renderObjectsToSvg } from '../dist/packages/adapter-svg/src/index.js'
import { ObserverWorkspaceRegistry } from '../dist/packages/observer-workspace/src/index.js'
import { observerAllowsPortalVisual } from '../dist/packages/observer-workspace/src/projection.js'
import { projectPortalForObserver } from '../dist/packages/observer-workspace/src/visual-projection.js'
import {
  LivePortalHostRegistry,
  CanvasLivePortalCoordinator,
} from '../dist/packages/portal-overlay/src/runtime.js'
import {
  WindowsProviderCatalog,
  createWindowsWindowPortal,
} from '../dist/packages/provider-windows/src/index.js'
import { WindowsSnapshotLivePortalHost } from '../dist/packages/provider-windows/src/visual-host.js'

const neo = {
  principalId: 'principal:neo',
  role: 'owner',
  actor: { actorType: 'user', actorId: 'user:neo' },
}
const agentA = {
  principalId: 'principal:agent-a',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'agent:a' },
  semanticAgentId: 'agent:a',
}
const agentB = {
  principalId: 'principal:agent-b',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'agent:b' },
  semanticAgentId: 'agent:b',
}

function windowsBridge() {
  const resourceId = 'window:epoch-visual:41:0x410'
  let snapshotCalls = 0
  return {
    get snapshotCalls() { return snapshotCalls },
    capabilities() {
      return {
        schema: 'windows_provider_capabilities_v1',
        provider: 'windows',
        providerEpoch: 'epoch-visual',
        platform: 'win32',
        capture: {
          api: 'windows_graphics_capture',
          supported: true,
          sessionLifecycleSupported: true,
          frameTransport: 'png_base64_snapshot_v1',
          frameTransportSupported: true,
          maxActiveMounts: 4,
          frameQueueCapacity: 2,
          maxSnapshotPixels: 8294400,
          maxSnapshotBytes: 16777216,
          minimumBuild: 18362,
          target: 'hwnd',
        },
        automation: {
          api: 'uia',
          supported: false,
          semanticPatternsPreferred: true,
          inputInjectionFallback: false,
          interactiveDesktopRequiredForInjection: true,
        },
      }
    },
    async enumerateTopLevelWindows() {
      return [{
        hwndHex: '0x410', processId: 41, threadId: 42, title: 'Private Editor',
        className: 'EditorClass', visible: true, minimized: false, cloakState: 'none',
      }]
    },
    async mountCapture(resource) {
      assert.equal(resource.providerResourceId, resourceId)
      return { mountId: 'mount:visual', providerResourceId: resourceId }
    },
    async updateCapture() {},
    async snapshotCapture(mount) {
      snapshotCalls += 1
      assert.equal(mount.mountId, 'mount:visual')
      return {
        schema: 'windows_capture_snapshot_v1',
        mountId: 'mount:visual',
        providerResourceId: resourceId,
        frameSequence: 7,
        capturedAt: '2026-09-14T11:20:00Z',
        width: 2,
        height: 2,
        mimeType: 'image/png',
        encodedBytes: 6,
        sha256: '823ceb99fcef5252333ede1b2202341c3b287b6d47571963e6b0ddf393a24f82',
        bytesBase64: 'iVBORw0K',
        transport: 'png_base64_snapshot_v1',
      }
    },
    async unmountCapture() {},
    async inspectUi() { throw new Error('UIA unavailable') },
    async performUiAction() { throw new Error('UIA unavailable') },
  }
}

function observerRegistry() {
  let tick = 0
  return new ObserverWorkspaceRegistry(() => `2026-09-14T11:20:${String(tick++).padStart(2, '0')}Z`)
}

test('Windows pixels enter a private render copy and reach rendezvous only after selective convergence', async () => {
  const bridge = windowsBridge()
  const catalog = new WindowsProviderCatalog(bridge)
  const [resource] = await catalog.refresh()
  assert.ok(resource)
  assert.equal(resource.projection.preferredDisplayMode, 'live')

  const portalId = 'portal:windows-editor'
  const portal = createWindowsWindowPortal({
    resource,
    portalId,
    canvasObjectId: 'object:windows-editor',
    canvasId: 'canvas:root',
    pmwWorkspaceId: 'world:1',
    actor: neo.actor,
    createdAt: '2026-09-14T11:20:00Z',
  })
  assert.equal(portal.metadata.portal.displayMode, 'live')

  const hosts = new LivePortalHostRegistry()
  hosts.register('windows', new WindowsSnapshotLivePortalHost(bridge, catalog))
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  await coordinator.activate(
    portal,
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { left: 0, top: 0, width: 1200, height: 800 },
  )

  const observers = observerRegistry()
  observers.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:root' }, agentA)
  observers.createPrivateView({ viewId: 'view:b', worldId: 'world:1', canvasId: 'canvas:root' }, agentB)
  observers.setForegroundStack('view:a', [portalId], agentA)

  const aPrivate = await projectPortalForObserver(
    portal, hosts, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' },
  )
  assert.equal(aPrivate.allowed, true)
  assert.equal(aPrivate.frameSequence, 7)
  assert.equal(bridge.snapshotCalls, 1)
  const svgA = renderObjectsToSvg([aPrivate.object], { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }, { includeGrid: false })
  assert.match(svgA, /data:image\/png;base64,iVBORw0K/)

  const bPrivate = await projectPortalForObserver(
    portal, hosts, observers.snapshotFor(agentB), { kind: 'private_view', viewId: 'view:b' },
  )
  assert.equal(bPrivate.allowed, false)
  assert.equal(bridge.snapshotCalls, 1, 'denied observer must not trigger provider snapshot I/O')
  const svgB = renderObjectsToSvg([bPrivate.object], { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }, { includeGrid: false })
  assert.doesNotMatch(svgB, /data:image\/png;base64/)

  observers.openRendezvous({ rendezvousId: 'room:shared', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  observers.invite('room:shared', agentA.principalId, neo)
  observers.invite('room:shared', agentB.principalId, neo)
  observers.join('room:shared', agentA)
  observers.join('room:shared', agentB)

  const beforeShare = await projectPortalForObserver(
    portal, hosts, observers.snapshotFor(agentB), { kind: 'rendezvous', rendezvousId: 'room:shared' },
  )
  assert.equal(beforeShare.allowed, false)
  assert.equal(bridge.snapshotCalls, 1, 'room membership alone must not read private portal pixels')

  observers.projectPortal('room:shared', {
    projectionId: 'projection:windows-editor',
    sourceViewId: 'view:a',
    portalId,
  }, agentA)
  assert.equal(observerAllowsPortalVisual(observers.snapshotFor(agentB), { kind: 'rendezvous', rendezvousId: 'room:shared' }, portalId), true)

  const shared = await projectPortalForObserver(
    portal, hosts, observers.snapshotFor(agentB), { kind: 'rendezvous', rendezvousId: 'room:shared' },
  )
  assert.equal(shared.allowed, true)
  assert.equal(bridge.snapshotCalls, 2)
  const sharedSvg = renderObjectsToSvg([shared.object], { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }, { includeGrid: false })
  assert.match(sharedSvg, /data:image\/png;base64,iVBORw0K/)

  assert.match(portal.content.previewUri, /^windows:\/\//)
  assert.doesNotMatch(portal.content.previewUri, /^data:/)
  await coordinator.deactivateAll()
})

test('observer visual gate respects hidden nested contexts even when the portal is in the nested foreground stack', async () => {
  const snapshot = {
    views: [{
      schema: 'observer_view_v1',
      viewId: 'view:hidden',
      worldId: 'world:1',
      canvasId: 'canvas:root',
      observerPrincipalId: agentA.principalId,
      lifecycle: 'live',
      foregroundPortalIds: [],
      nestedCanvasContexts: [{
        schema: 'observer_nested_canvas_v1',
        parentCanvasId: 'canvas:root',
        canvasId: 'canvas:child',
        portalObjectId: 'subcanvas:child',
        visibility: 'hidden',
        foregroundPortalIds: ['portal:secret'],
        enteredAt: '2026-09-14T11:20:00Z',
      }],
      revision: 1,
      createdAt: '2026-09-14T11:20:00Z',
      updatedAt: '2026-09-14T11:20:01Z',
    }],
    rendezvous: [],
  }
  assert.equal(observerAllowsPortalVisual(snapshot, { kind: 'private_view', viewId: 'view:hidden' }, 'portal:secret'), false)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { ObserverWorkspaceRegistry } from '../dist/packages/observer-workspace/src/index.js'
import {
  OBSERVER_PORTAL_LIVE_REFRESH_MS,
  OBSERVER_PORTAL_WARM_REFRESH_MS,
  OBSERVER_PORTAL_SHARED_REFRESH_MS,
  ObserverPortalCompositor,
  ObserverPortalRefreshLoop,
  observerPortalRefreshPlan,
} from '../dist/packages/observer-workspace/src/refresh.js'
import { LivePortalHostRegistry, CanvasLivePortalCoordinator } from '../dist/packages/portal-overlay/src/runtime.js'
import { WindowsProviderCatalog, createWindowsWindowPortal } from '../dist/packages/provider-windows/src/index.js'
import { WindowsSnapshotLivePortalHost } from '../dist/packages/provider-windows/src/visual-host.js'

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
const neo = {
  principalId: 'principal:neo',
  role: 'owner',
  actor: { actorType: 'user', actorId: 'user:neo' },
}

function bridgeFixture() {
  const resourceId = 'window:epoch-refresh:51:0x510'
  let snapshotCalls = 0
  let frameSequence = 0
  return {
    resourceId,
    get snapshotCalls() { return snapshotCalls },
    set frameSequence(value) { frameSequence = value },
    capabilities() {
      return {
        schema: 'windows_provider_capabilities_v1', provider: 'windows', providerEpoch: 'epoch-refresh', platform: 'win32',
        capture: {
          api: 'windows_graphics_capture', supported: true, sessionLifecycleSupported: true,
          frameTransport: 'png_base64_snapshot_v1', frameTransportSupported: true,
          maxActiveMounts: 4, frameQueueCapacity: 2, maxSnapshotPixels: 8294400, maxSnapshotBytes: 16777216,
          minimumBuild: 18362, target: 'hwnd',
        },
        automation: {
          api: 'uia', supported: false, semanticPatternsPreferred: true,
          inputInjectionFallback: false, interactiveDesktopRequiredForInjection: true,
        },
      }
    },
    async enumerateTopLevelWindows() {
      return [{
        hwndHex: '0x510', processId: 51, threadId: 52, title: 'Refresh Editor', className: 'RefreshClass',
        visible: true, minimized: false, cloakState: 'none',
      }]
    },
    async mountCapture(resource) {
      assert.equal(resource.providerResourceId, resourceId)
      return { mountId: 'mount:refresh', providerResourceId: resourceId }
    },
    async updateCapture() {},
    async snapshotCapture(mount) {
      snapshotCalls += 1
      frameSequence += 1
      return {
        schema: 'windows_capture_snapshot_v1',
        mountId: mount.mountId,
        providerResourceId: resourceId,
        frameSequence,
        capturedAt: `2026-09-15T06:00:${String(frameSequence).padStart(2, '0')}Z`,
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

async function setup() {
  const bridge = bridgeFixture()
  const catalog = new WindowsProviderCatalog(bridge)
  const [resource] = await catalog.refresh()
  assert.ok(resource)
  const portalId = 'portal:refresh-editor'
  const portal = createWindowsWindowPortal({
    resource,
    portalId,
    canvasObjectId: 'object:refresh-editor',
    canvasId: 'canvas:root',
    pmwWorkspaceId: 'world:1',
    actor: neo.actor,
    createdAt: '2026-09-15T06:00:00Z',
  })
  const host = new WindowsSnapshotLivePortalHost(bridge, catalog)
  const hosts = new LivePortalHostRegistry()
  hosts.register('windows', host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  await coordinator.activate(
    portal,
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { left: 0, top: 0, width: 1200, height: 800 },
  )
  let tick = 0
  const observers = new ObserverWorkspaceRegistry(() => `2026-09-15T06:10:${String(tick++).padStart(2, '0')}Z`)
  observers.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:root' }, agentA)
  observers.createPrivateView({ viewId: 'view:b', worldId: 'world:1', canvasId: 'canvas:root' }, agentB)
  observers.setForegroundStack('view:a', [portalId], agentA)
  return { bridge, portal, portalId, hosts, coordinator, observers }
}

test('live and warm lifecycle cadences throttle provider reads while retaining one latest render copy', async () => {
  const { bridge, portal, hosts, coordinator, observers } = await setup()
  const compositor = new ObserverPortalCompositor(hosts)
  try {
    const first = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 0)
    assert.equal(first.mode, 'live')
    assert.equal(first.providerRead, true)
    assert.equal(first.frameSequence, 1)
    assert.equal(bridge.snapshotCalls, 1)
    assert.equal(first.nextRefreshAtMs, OBSERVER_PORTAL_LIVE_REFRESH_MS)

    const early = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 100)
    assert.equal(early.fromCache, true)
    assert.equal(early.providerRead, false)
    assert.equal(bridge.snapshotCalls, 1)

    const due = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, OBSERVER_PORTAL_LIVE_REFRESH_MS)
    assert.equal(due.frameSequence, 2)
    assert.equal(bridge.snapshotCalls, 2)

    observers.setViewLifecycle('view:a', 'warm', agentA)
    const warmStart = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 500)
    assert.equal(warmStart.mode, 'warm')
    assert.equal(warmStart.providerRead, false)
    assert.equal(warmStart.fromCache, true)

    const warmDueAt = OBSERVER_PORTAL_LIVE_REFRESH_MS + OBSERVER_PORTAL_WARM_REFRESH_MS
    const warmDue = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, warmDueAt)
    assert.equal(warmDue.mode, 'warm')
    assert.equal(warmDue.providerRead, true)
    assert.equal(warmDue.frameSequence, 3)
    assert.equal(bridge.snapshotCalls, 3)
  } finally {
    await coordinator.deactivateAll()
  }
})

test('frozen retains the latest frame without provider I/O while sleeping drops pixels and cache', async () => {
  const { bridge, portal, hosts, coordinator, observers } = await setup()
  const compositor = new ObserverPortalCompositor(hosts)
  try {
    const first = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 0)
    assert.equal(first.frameSequence, 1)
    assert.equal(compositor.cachedPortalCount(), 1)

    observers.setViewLifecycle('view:a', 'frozen', agentA)
    const frozen = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 10_000)
    assert.equal(frozen.mode, 'frozen')
    assert.equal(frozen.fromCache, true)
    assert.equal(frozen.providerRead, false)
    assert.equal(frozen.frameSequence, 1)
    assert.equal(bridge.snapshotCalls, 1)

    observers.setViewLifecycle('view:a', 'sleeping', agentA)
    const sleeping = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 20_000)
    assert.equal(sleeping.mode, 'sleeping')
    assert.equal(sleeping.allowed, false)
    assert.equal(sleeping.providerRead, false)
    assert.equal(compositor.cachedPortalCount(), 0)
    assert.equal(sleeping.object.content?.previewUri, undefined)
    assert.equal(bridge.snapshotCalls, 1)
  } finally {
    await coordinator.deactivateAll()
  }
})

test('rendezvous refresh is bounded and requires explicit projection before provider I/O', async () => {
  const { bridge, portal, portalId, hosts, coordinator, observers } = await setup()
  const compositor = new ObserverPortalCompositor(hosts)
  try {
    observers.openRendezvous({ rendezvousId: 'room:refresh', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
    observers.invite('room:refresh', agentA.principalId, neo)
    observers.invite('room:refresh', agentB.principalId, neo)
    observers.join('room:refresh', agentA)
    observers.join('room:refresh', agentB)

    const denied = await compositor.compose(portal, observers.snapshotFor(agentB), { kind: 'rendezvous', rendezvousId: 'room:refresh' }, 0)
    assert.equal(denied.allowed, false)
    assert.equal(denied.providerRead, false)
    assert.equal(bridge.snapshotCalls, 0)

    observers.projectPortal('room:refresh', {
      projectionId: 'projection:refresh', sourceViewId: 'view:a', portalId,
    }, agentA)
    const shared = await compositor.compose(portal, observers.snapshotFor(agentB), { kind: 'rendezvous', rendezvousId: 'room:refresh' }, 0)
    assert.equal(shared.mode, 'shared')
    assert.equal(shared.providerRead, true)
    assert.equal(shared.nextRefreshAtMs, OBSERVER_PORTAL_SHARED_REFRESH_MS)
    assert.equal(bridge.snapshotCalls, 1)

    const throttled = await compositor.compose(portal, observers.snapshotFor(agentB), { kind: 'rendezvous', rendezvousId: 'room:refresh' }, 200)
    assert.equal(throttled.providerRead, false)
    assert.equal(throttled.fromCache, true)
    assert.equal(bridge.snapshotCalls, 1)
  } finally {
    await coordinator.deactivateAll()
  }
})

test('regressed positive provider frame sequence fails closed and evicts stale pixels', async () => {
  const { bridge, portal, hosts, coordinator, observers } = await setup()
  const compositor = new ObserverPortalCompositor(hosts)
  try {
    bridge.frameSequence = 1
    const first = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, 0)
    assert.equal(first.frameSequence, 2)
    bridge.frameSequence = 0
    const regressed = await compositor.compose(portal, observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, OBSERVER_PORTAL_LIVE_REFRESH_MS)
    assert.equal(regressed.error, 'provider frame sequence regressed')
    assert.equal(regressed.object.content?.previewUri, undefined)
    assert.equal(compositor.cachedPortalCount(), 0)
  } finally {
    await coordinator.deactivateAll()
  }
})

test('refresh plan exposes lifecycle semantics without provider access', async () => {
  const { portalId, coordinator, observers } = await setup()
  try {
    let plan = observerPortalRefreshPlan(observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, portalId)
    assert.deepEqual(plan, { allowed: true, mode: 'live', refreshIntervalMs: 250, retainLastFrame: true })
    observers.setViewLifecycle('view:a', 'warm', agentA)
    plan = observerPortalRefreshPlan(observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, portalId)
    assert.deepEqual(plan, { allowed: true, mode: 'warm', refreshIntervalMs: 2000, retainLastFrame: true })
    observers.setViewLifecycle('view:a', 'frozen', agentA)
    plan = observerPortalRefreshPlan(observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, portalId)
    assert.deepEqual(plan, { allowed: true, mode: 'frozen', refreshIntervalMs: null, retainLastFrame: true })
    observers.setViewLifecycle('view:a', 'sleeping', agentA)
    plan = observerPortalRefreshPlan(observers.snapshotFor(agentA), { kind: 'private_view', viewId: 'view:a' }, portalId)
    assert.deepEqual(plan, { allowed: false, mode: 'sleeping', refreshIntervalMs: null, retainLastFrame: false })
  } finally {
    await coordinator.deactivateAll()
  }
})

test('refresh loop schedules the next tick only after one projection finishes', async () => {
  const { portal, hosts, coordinator, observers } = await setup()
  const compositor = new ObserverPortalCompositor(hosts)
  let now = 0
  const scheduled = []
  const projections = []
  const loop = new ObserverPortalRefreshLoop({
    compositor,
    object: () => portal,
    observerSnapshot: () => observers.snapshotFor(agentA),
    target: { kind: 'private_view', viewId: 'view:a' },
    onProjection: result => { projections.push(result) },
    now: () => now,
    schedule: (callback, delayMs) => {
      const handle = { callback, delayMs, cancelled: false }
      scheduled.push(handle)
      return handle
    },
    cancel: handle => { handle.cancelled = true },
  })
  try {
    loop.start()
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].delayMs, 0)
    scheduled.shift().callback()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(projections.length, 1)
    assert.equal(scheduled.length, 1)
    assert.equal(scheduled[0].delayMs, OBSERVER_PORTAL_LIVE_REFRESH_MS)

    now = OBSERVER_PORTAL_LIVE_REFRESH_MS
    scheduled.shift().callback()
    await new Promise(resolve => setTimeout(resolve, 10))
    assert.equal(projections.length, 2)
    assert.equal(scheduled.length, 1)
    loop.stop()
    assert.equal(loop.isRunning(), false)
  } finally {
    loop.stop()
    await coordinator.deactivateAll()
  }
})

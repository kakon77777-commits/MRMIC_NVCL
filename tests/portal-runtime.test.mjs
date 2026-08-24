import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasLivePortalCoordinator, LivePortalHostRegistry } from '../dist/packages/portal-overlay/src/runtime.js'
import { LiveSurfaceBudget } from '../dist/packages/portal-overlay/src/index.js'

const actor = { actorType: 'agent', actorId: 'mrmic:claude-binding' }
const viewport = { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }
const clientRect = { left: 10, top: 20, width: 1200, height: 800 }

function portal(id, providerResourceId, overrides = {}) {
  const now = '2026-08-15T00:00:00.000Z'
  return {
    id,
    canvasId: 'canvas-root',
    type: 'resource_portal',
    transform: { x: 100, y: 100, width: 500, height: 400, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1 },
    style: {},
    content: { text: id, resourceUri: `tandem://browser/tab/${providerResourceId}` },
    childIds: [],
    bindings: [],
    metadata: {
      portal: {
        portalId: id,
        pmwWorkspaceId: 'pmw-ws-1',
        provider: 'tandem',
        resourceKind: 'browser_tab',
        providerResourceId,
        displayMode: 'live',
        interactionMode: 'inspect',
      },
    },
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
    revision: 0,
    ...overrides,
  }
}

function fakeHost() {
  const events = []
  return {
    events,
    host: {
      mount: async (handle, rect) => events.push({ type: 'mount', handle: structuredClone(handle), rect: structuredClone(rect) }),
      update: async (handle, rect) => events.push({ type: 'update', handle: structuredClone(handle), rect: structuredClone(rect) }),
      unmount: async handle => events.push({ type: 'unmount', handle: structuredClone(handle) }),
    },
  }
}

test('live portal coordinator mounts provider surface from Canvas geometry', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)

  const result = await coordinator.activate(portal('portal-a', 'tab-a'), viewport, clientRect)
  assert.equal(result.mounted, true)
  assert.equal(coordinator.isMounted('portal-a'), true)
  assert.deepEqual(coordinator.state('portal-a'), {
    portalObjectId: 'portal-a',
    mounted: true,
    visible: true,
    focused: false,
    controlOwner: null,
  })
  assert.deepEqual(tandem.events[0], {
    type: 'mount',
    handle: { portalObjectId: 'portal-a', provider: 'tandem', providerResourceId: 'tab-a' },
    rect: { left: 110, top: 120, width: 500, height: 400, visible: true },
  })
})

test('focus and control ownership are explicit, separate, and single-owner', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  await coordinator.activate(portal('portal-a', 'tab-a'), viewport, clientRect)

  assert.equal(coordinator.setFocused('portal-a', true).focused, true)
  assert.equal(coordinator.acquireControl('portal-a', 'principal:neo.k').controlOwner, 'principal:neo.k')
  assert.equal(coordinator.acquireControl('portal-a', 'principal:neo.k').controlOwner, 'principal:neo.k')
  assert.throws(
    () => coordinator.acquireControl('portal-a', 'principal:other'),
    /already controlled by principal:neo\.k/,
  )
  assert.throws(
    () => coordinator.releaseControl('portal-a', 'principal:other'),
    /cannot release control owned by principal:neo\.k/,
  )

  assert.equal(coordinator.releaseControl('portal-a', 'principal:neo.k').controlOwner, null)
  coordinator.acquireControl('portal-a', 'principal:neo.k')
  assert.equal(coordinator.revokeControl('portal-a').controlOwner, null)
  assert.equal(coordinator.state('portal-a').focused, true)
})

test('geometry sync updates an already-active live surface without creating another resource', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  const first = portal('portal-a', 'tab-a')
  await coordinator.activate(first, viewport, clientRect)

  const moved = portal('portal-a', 'tab-a', {
    transform: { ...first.transform, x: 350, y: 220 },
  })
  await coordinator.syncGeometry([moved], viewport, clientRect)
  assert.equal(tandem.events.filter(event => event.type === 'mount').length, 1)
  const last = tandem.events.at(-1)
  assert.equal(last.type, 'update')
  assert.equal(last.rect.left, 360)
  assert.equal(last.rect.top, 240)
})

test('LRU live surface budget evicts the older provider projection without destroying Canvas objects', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts, new LiveSurfaceBudget(1))

  await coordinator.activate(portal('portal-a', 'tab-a'), viewport, clientRect)
  const second = await coordinator.activate(portal('portal-b', 'tab-b'), viewport, clientRect)
  assert.deepEqual(second.evicted, ['portal-a'])
  assert.equal(coordinator.isMounted('portal-a'), false)
  assert.equal(coordinator.isMounted('portal-b'), true)
  assert.ok(tandem.events.some(event => event.type === 'unmount' && event.handle.portalObjectId === 'portal-a'))
})

test('offscreen activation does not consume a live-surface slot or mount a provider resource', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts, new LiveSurfaceBudget(1))
  const offscreen = portal('portal-a', 'tab-a', {
    transform: { x: 5000, y: 5000, width: 500, height: 400, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1 },
  })
  const result = await coordinator.activate(offscreen, viewport, clientRect)
  assert.equal(result.reason, 'offscreen')
  assert.equal(result.mounted, false)
  assert.deepEqual(coordinator.activePortalObjectIds(), [])
  assert.equal(tandem.events.length, 0)
  assert.deepEqual(coordinator.state('portal-a'), {
    portalObjectId: 'portal-a',
    mounted: false,
    visible: false,
    focused: false,
    controlOwner: null,
  })
})

test('offscreen geometry revokes focus and control without destroying the provider resource', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts, new LiveSurfaceBudget(1))
  const live = portal('portal-a', 'tab-a')
  await coordinator.activate(live, viewport, clientRect)
  coordinator.setFocused('portal-a', true)
  coordinator.acquireControl('portal-a', 'principal:neo.k')

  const offscreen = portal('portal-a', 'tab-a', {
    transform: { ...live.transform, x: 5000, y: 5000 },
  })
  await coordinator.syncGeometry([offscreen], viewport, clientRect)
  assert.deepEqual(coordinator.state('portal-a'), {
    portalObjectId: 'portal-a',
    mounted: true,
    visible: false,
    focused: false,
    controlOwner: null,
  })
  assert.deepEqual(coordinator.activePortalObjectIds(), [])
  assert.equal(tandem.events.filter(event => event.type === 'unmount').length, 0)

  await coordinator.syncGeometry([live], viewport, clientRect)
  assert.equal(coordinator.state('portal-a').visible, true)
  assert.deepEqual(coordinator.activePortalObjectIds(), ['portal-a'])
  assert.equal(tandem.events.filter(event => event.type === 'mount').length, 1)
})

test('switching a Canvas portal out of live mode unmounts only the projection', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  const live = portal('portal-a', 'tab-a')
  await coordinator.activate(live, viewport, clientRect)
  const snapshot = structuredClone(live)
  snapshot.metadata.portal.displayMode = 'snapshot'
  await coordinator.syncGeometry([snapshot], viewport, clientRect)
  assert.equal(coordinator.isMounted('portal-a'), false)
  assert.equal(tandem.events.at(-1).type, 'unmount')
  assert.deepEqual(coordinator.state('portal-a'), {
    portalObjectId: 'portal-a',
    mounted: false,
    visible: false,
    focused: false,
    controlOwner: null,
  })
})

test('deactivation and LRU eviction revoke focus and control while only unmounting the projection', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts, new LiveSurfaceBudget(1))
  await coordinator.activate(portal('portal-a', 'tab-a'), viewport, clientRect)
  coordinator.setFocused('portal-a', true)
  coordinator.acquireControl('portal-a', 'principal:neo.k')

  await coordinator.activate(portal('portal-b', 'tab-b'), viewport, clientRect)
  assert.deepEqual(coordinator.state('portal-a'), {
    portalObjectId: 'portal-a',
    mounted: false,
    visible: false,
    focused: false,
    controlOwner: null,
  })
  assert.equal(tandem.events.filter(event => event.type === 'unmount' && event.handle.portalObjectId === 'portal-a').length, 1)
})

test('provider resource identity change cannot silently reuse an existing live handle', async () => {
  const tandem = fakeHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', tandem.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  await coordinator.activate(portal('portal-a', 'tab-a'), viewport, clientRect)
  const changed = portal('portal-a', 'tab-b')
  await coordinator.activate(changed, viewport, clientRect)
  assert.ok(tandem.events.some(event => event.type === 'unmount' && event.handle.providerResourceId === 'tab-a'))
  assert.equal(tandem.events.at(-1).handle.providerResourceId, 'tab-b')
})

test('missing provider host fails closed', async () => {
  const coordinator = new CanvasLivePortalCoordinator(new LivePortalHostRegistry())
  await assert.rejects(
    coordinator.activate(portal('portal-a', 'tab-a'), viewport, clientRect),
    /No live portal host registered/,
  )
})

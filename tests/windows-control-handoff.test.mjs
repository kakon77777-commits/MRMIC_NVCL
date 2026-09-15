import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WindowsLivePortalHost,
  WindowsProviderCatalog,
  createWindowsWindowPortal,
} from '../dist/packages/provider-windows/src/index.js'
import { WindowsUiaControlledAccess } from '../dist/packages/provider-windows/src/uia-action.js'
import { CanvasLivePortalCoordinator, LivePortalHostRegistry } from '../dist/packages/portal-overlay/src/runtime.js'

const nowMs = Date.parse('2026-09-15T12:00:00.000Z')
const providerEpoch = 'epoch-handoff'
const nativeWindow = {
  hwndHex: '0x777', processId: 777, threadId: 778, title: 'Handoff Fixture', className: 'FixtureWindow',
  visible: true, minimized: false, cloakState: 'none',
}

function capabilities() {
  return {
    schema: 'windows_provider_capabilities_v1', provider: 'windows', providerEpoch, platform: 'win32',
    capture: { api: 'windows_graphics_capture', supported: true, minimumBuild: 18362, target: 'hwnd' },
    automation: {
      api: 'uia', supported: true, semanticPatternsPreferred: true,
      inputInjectionFallback: false, interactiveDesktopRequiredForInjection: true,
    },
  }
}

function snapshot(providerResourceId) {
  return {
    schema: 'windows_uia_snapshot_v1', providerResourceId,
    capturedAt: '2026-09-15T12:00:00.000Z', maxDepth: 8, maxElements: 512,
    maxPatternsPerElement: 32, truncated: false,
    root: {
      runtimeId: '7.1', depth: 0, processId: 777, nativeWindowHandle: 1911,
      enabled: true, offscreen: false, keyboardFocusable: true, password: false,
      name: 'Handoff Fixture', controlType: 'ControlType.Window', patterns: [],
    },
    elements: [{
      runtimeId: '7.2', parentRuntimeId: '7.1', depth: 1, processId: 777, nativeWindowHandle: 0,
      enabled: true, offscreen: false, keyboardFocusable: true, password: false,
      name: 'Run', automationId: 'run', controlType: 'ControlType.Button',
      patterns: ['InvokePatternIdentifiers.Pattern'],
    }],
  }
}

function fakeBridge() {
  const calls = []
  let onInspect
  return {
    calls,
    setOnInspect(callback) { onInspect = callback },
    capabilities() { return capabilities() },
    async enumerateTopLevelWindows() { return [structuredClone(nativeWindow)] },
    async mountCapture(resource) {
      calls.push(['mount', resource.providerResourceId])
      return { mountId: 'mount-handoff', providerResourceId: resource.providerResourceId }
    },
    async updateCapture() {},
    async unmountCapture() {},
    async inspectUi(resource) {
      calls.push(['inspect', resource.providerResourceId])
      onInspect?.()
      return snapshot(resource.providerResourceId)
    },
    async performUiAction(resource, action) {
      calls.push(['action', resource.providerResourceId, structuredClone(action)])
      return {
        schema: 'windows_uia_action_result_v1', ok: true,
        providerResourceId: resource.providerResourceId,
        action: { kind: action.kind, runtimeId: action.runtimeId },
        completedAt: '2026-09-15T12:00:00.100Z',
      }
    },
  }
}

async function fixture() {
  const bridge = fakeBridge()
  const catalog = new WindowsProviderCatalog(bridge)
  const [resource] = await catalog.refresh()
  assert.ok(resource)
  const portal = createWindowsWindowPortal({
    resource, portalId: 'handoff-portal', canvasObjectId: 'portal:handoff', canvasId: 'root',
    pmwWorkspaceId: 'workspace', actor: { actorType: 'user', actorId: 'handoff-fixture' },
    createdAt: '2026-09-15T12:00:00.000Z',
  })
  const host = new WindowsLivePortalHost(bridge, catalog)
  const hosts = new LivePortalHostRegistry()
  hosts.register('windows', host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  await coordinator.activate(
    portal,
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { left: 0, top: 0, width: 1200, height: 800 },
  )
  const authority = {
    canInspect: ({ principalId }) => principalId === 'agent:a' || principalId === 'agent:b',
    canControl: ({ principalId }) => principalId === 'agent:a' || principalId === 'agent:b',
  }
  const access = new WindowsUiaControlledAccess(bridge, catalog, authority, coordinator, () => nowMs)
  return { bridge, catalog, coordinator, portal, resource, access }
}

function providerIo(bridge) {
  return bridge.calls.filter(call => call[0] === 'inspect' || call[0] === 'action')
}

test('atomic A-to-B handoff advances generation and old owner loses action authority before provider I/O', async () => {
  const { bridge, coordinator, portal, resource, access } = await fixture()
  assert.deepEqual(coordinator.controlLease(portal.id), {
    schema: 'live_portal_control_lease_v1', portalObjectId: portal.id,
    controlOwner: null, generation: 0, mounted: true, visible: true,
  })

  coordinator.acquireControl(portal.id, 'agent:a')
  const aLease = coordinator.controlLease(portal.id)
  assert.equal(aLease.controlOwner, 'agent:a')
  assert.equal(aLease.generation, 1)

  const aResult = await access.perform(portal.id, resource.providerResourceId, 'agent:a', { kind: 'invoke', runtimeId: '7.2' })
  assert.equal(aResult.controlGeneration, 1)

  const handoff = coordinator.handoffControl(portal.id, 'agent:a', 'agent:b')
  assert.equal(handoff.controlOwner, 'agent:b')
  assert.equal(handoff.generation, 2)

  const beforeDenied = providerIo(bridge).length
  await assert.rejects(
    () => access.perform(portal.id, resource.providerResourceId, 'agent:a', { kind: 'invoke', runtimeId: '7.2' }),
    /does not own Windows portal control/,
  )
  assert.equal(providerIo(bridge).length, beforeDenied)

  const bResult = await access.perform(portal.id, resource.providerResourceId, 'agent:b', { kind: 'invoke', runtimeId: '7.2' })
  assert.equal(bResult.controlGeneration, 2)
})

test('release/reacquire creates a new control generation rather than reviving an old lease', async () => {
  const { coordinator, portal } = await fixture()
  coordinator.acquireControl(portal.id, 'agent:a')
  assert.equal(coordinator.controlLease(portal.id).generation, 1)
  coordinator.releaseControl(portal.id, 'agent:a')
  assert.equal(coordinator.controlLease(portal.id).generation, 2)
  assert.equal(coordinator.controlLease(portal.id).controlOwner, null)
  coordinator.acquireControl(portal.id, 'agent:b')
  assert.equal(coordinator.controlLease(portal.id).generation, 3)
  assert.equal(coordinator.controlLease(portal.id).controlOwner, 'agent:b')
})

test('ABA handoff during fresh inspection is detected by generation recheck before native action I/O', async () => {
  const { bridge, coordinator, portal, resource, access } = await fixture()
  coordinator.acquireControl(portal.id, 'agent:a')
  let fired = false
  bridge.setOnInspect(() => {
    if (fired) return
    fired = true
    const toB = coordinator.handoffControl(portal.id, 'agent:a', 'agent:b')
    assert.equal(toB.generation, 2)
    const backToA = coordinator.handoffControl(portal.id, 'agent:b', 'agent:a')
    assert.equal(backToA.generation, 3)
  })

  await assert.rejects(
    () => access.perform(portal.id, resource.providerResourceId, 'agent:a', { kind: 'invoke', runtimeId: '7.2' }),
    /control lease changed during UIA action preparation/,
  )
  assert.deepEqual(providerIo(bridge).map(call => call[0]), ['inspect'])
  assert.equal(coordinator.controlLease(portal.id).controlOwner, 'agent:a')
  assert.equal(coordinator.controlLease(portal.id).generation, 3)
})

test('handoff is fail-closed for wrong current owner and same-principal transfer', async () => {
  const { coordinator, portal } = await fixture()
  coordinator.acquireControl(portal.id, 'agent:a')
  await assert.rejects(
    async () => coordinator.handoffControl(portal.id, 'agent:b', 'agent:a'),
    /cannot hand off control owned by agent:a/,
  )
  await assert.rejects(
    async () => coordinator.handoffControl(portal.id, 'agent:a', 'agent:a'),
    /requires distinct principals/,
  )
  assert.equal(coordinator.controlLease(portal.id).generation, 1)
})

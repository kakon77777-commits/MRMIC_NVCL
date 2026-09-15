import test from 'node:test'
import assert from 'node:assert/strict'
import {
  WindowsLivePortalHost,
  WindowsProviderCatalog,
  createWindowsWindowPortal,
} from '../dist/packages/provider-windows/src/index.js'
import { WindowsUiaControlledAccess } from '../dist/packages/provider-windows/src/uia-action.js'
import { CanvasLivePortalCoordinator, LivePortalHostRegistry } from '../dist/packages/portal-overlay/src/runtime.js'

const nowMs = Date.parse('2026-09-15T08:30:00.000Z')
const providerEpoch = 'epoch-uia-action'
const nativeWindow = {
  hwndHex: '0x501',
  processId: 501,
  threadId: 502,
  title: 'Action Fixture',
  className: 'FixtureWindow',
  visible: true,
  minimized: false,
  cloakState: 'none',
}

function capabilities() {
  return {
    schema: 'windows_provider_capabilities_v1',
    provider: 'windows',
    providerEpoch,
    platform: 'win32',
    capture: { api: 'windows_graphics_capture', supported: true, minimumBuild: 18362, target: 'hwnd' },
    automation: {
      api: 'uia',
      supported: true,
      semanticPatternsPreferred: true,
      inputInjectionFallback: false,
      interactiveDesktopRequiredForInjection: true,
    },
  }
}

function snapshot(providerResourceId, capturedAt = '2026-09-15T08:30:00.000Z') {
  return {
    schema: 'windows_uia_snapshot_v1',
    providerResourceId,
    capturedAt,
    maxDepth: 8,
    maxElements: 512,
    maxPatternsPerElement: 32,
    truncated: false,
    root: {
      runtimeId: '1.1', depth: 0, processId: 501, nativeWindowHandle: 1281,
      enabled: true, offscreen: false, keyboardFocusable: true, password: false,
      name: 'Action Fixture', controlType: 'ControlType.Window', patterns: [],
    },
    elements: [
      {
        runtimeId: '1.2', parentRuntimeId: '1.1', depth: 1, processId: 501, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Run', automationId: 'run', controlType: 'ControlType.Button',
        patterns: ['InvokePatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.3', parentRuntimeId: '1.1', depth: 1, processId: 501, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Enabled', automationId: 'toggle', controlType: 'ControlType.CheckBox',
        patterns: ['TogglePatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.4', parentRuntimeId: '1.1', depth: 1, processId: 501, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Row', automationId: 'row', controlType: 'ControlType.ListItem',
        patterns: ['SelectionItemPatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.5', parentRuntimeId: '1.1', depth: 1, processId: 501, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Title', automationId: 'title', controlType: 'ControlType.Edit',
        patterns: ['ValuePatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.6', parentRuntimeId: '1.1', depth: 1, processId: 501, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: true,
        name: 'Password', automationId: 'password', controlType: 'ControlType.Edit',
        patterns: ['ValuePatternIdentifiers.Pattern'],
      },
    ],
  }
}

function fakeBridge({ capturedAt } = {}) {
  const calls = []
  let providerResourceId
  return {
    calls,
    capabilities() { return capabilities() },
    async enumerateTopLevelWindows() { return [structuredClone(nativeWindow)] },
    async mountCapture(resource) {
      providerResourceId = resource.providerResourceId
      calls.push(['mount', providerResourceId])
      return { mountId: 'mount-action', providerResourceId }
    },
    async updateCapture() {},
    async unmountCapture() {},
    async inspectUi(resource) {
      calls.push(['inspect', resource.providerResourceId])
      return snapshot(resource.providerResourceId, capturedAt)
    },
    async performUiAction(resource, action) {
      calls.push(['action', resource.providerResourceId, structuredClone(action)])
      return {
        schema: 'windows_uia_action_result_v1',
        ok: true,
        providerResourceId: resource.providerResourceId,
        action: action.kind === 'set_value'
          ? { kind: action.kind, runtimeId: action.runtimeId, value: '[redacted]' }
          : { kind: action.kind, runtimeId: action.runtimeId },
        completedAt: '2026-09-15T08:30:00.100Z',
      }
    },
  }
}

async function fixture({ authority, capturedAt } = {}) {
  const bridge = fakeBridge({ capturedAt })
  const catalog = new WindowsProviderCatalog(bridge)
  const [resource] = await catalog.refresh()
  assert.ok(resource)
  const portal = createWindowsWindowPortal({
    resource,
    portalId: 'uia-action-portal',
    canvasObjectId: 'portal:uia-action',
    canvasId: 'root',
    pmwWorkspaceId: 'workspace',
    actor: { actorType: 'user', actorId: 'owner' },
    createdAt: '2026-09-15T08:30:00.000Z',
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
  coordinator.acquireControl(portal.id, 'owner')
  const policy = authority ?? {
    canInspect: ({ principalId }) => principalId === 'owner',
    canControl: ({ principalId }) => principalId === 'owner',
  }
  const access = new WindowsUiaControlledAccess(bridge, catalog, policy, coordinator, () => nowMs)
  return { bridge, catalog, coordinator, portal, resource, access }
}

function providerIoCalls(bridge) {
  return bridge.calls.filter(call => call[0] === 'inspect' || call[0] === 'action')
}

test('controlOwner + fresh inspection gate invoke before native semantic action', async () => {
  const { bridge, access, portal, resource } = await fixture()
  const result = await access.perform(portal.id, resource.providerResourceId, 'owner', { kind: 'invoke', runtimeId: '1.2' })
  assert.equal(result.schema, 'windows_uia_controlled_action_v1')
  assert.deepEqual(result.action, { kind: 'invoke', runtimeId: '1.2' })
  assert.deepEqual(providerIoCalls(bridge).map(call => call[0]), ['inspect', 'action'])
  const nativeAction = providerIoCalls(bridge)[1][2]
  assert.equal(nativeAction.expected.processId, 501)
  assert.equal(nativeAction.expected.nativeWindowHandle, 0)
  assert.equal(nativeAction.expected.automationId, 'run')
  assert.equal(nativeAction.expected.controlType, 'ControlType.Button')
})

test('non-control-owner is rejected before any UIA provider I/O', async () => {
  const { bridge, access, portal, resource } = await fixture({
    authority: { canInspect: () => true, canControl: () => true },
  })
  await assert.rejects(
    () => access.perform(portal.id, resource.providerResourceId, 'intruder', { kind: 'invoke', runtimeId: '1.2' }),
    /does not own Windows portal control/,
  )
  assert.deepEqual(providerIoCalls(bridge), [])
})

test('control policy denial occurs before fresh inspection provider I/O', async () => {
  const { bridge, access, portal, resource } = await fixture({
    authority: { canInspect: () => true, canControl: () => false },
  })
  await assert.rejects(
    () => access.perform(portal.id, resource.providerResourceId, 'owner', { kind: 'invoke', runtimeId: '1.2' }),
    /not authorized to control/,
  )
  assert.deepEqual(providerIoCalls(bridge), [])
})

test('stale fresh-inspection timestamp fails before native action', async () => {
  const { bridge, access, portal, resource } = await fixture({ capturedAt: '2026-09-15T08:29:50.000Z' })
  await assert.rejects(
    () => access.perform(portal.id, resource.providerResourceId, 'owner', { kind: 'invoke', runtimeId: '1.2' }),
    /freshness bound/,
  )
  assert.deepEqual(providerIoCalls(bridge).map(call => call[0]), ['inspect'])
})

test('unsupported pattern and password set_value fail before native action', async () => {
  const first = await fixture()
  await assert.rejects(
    () => first.access.perform(first.portal.id, first.resource.providerResourceId, 'owner', { kind: 'toggle', runtimeId: '1.2' }),
    /TogglePattern/,
  )
  assert.deepEqual(providerIoCalls(first.bridge).map(call => call[0]), ['inspect'])

  const second = await fixture()
  await assert.rejects(
    () => second.access.perform(second.portal.id, second.resource.providerResourceId, 'owner', { kind: 'set_value', runtimeId: '1.6', value: 'secret' }),
    /does not set password element values/,
  )
  assert.deepEqual(providerIoCalls(second.bridge).map(call => call[0]), ['inspect'])
})

test('set_value is bounded and returned controlled result never echoes the requested value', async () => {
  const { bridge, access, portal, resource } = await fixture()
  const value = 'MRMIC semantic value'
  const result = await access.perform(portal.id, resource.providerResourceId, 'owner', { kind: 'set_value', runtimeId: '1.5', value })
  assert.deepEqual(result.action, { kind: 'set_value', runtimeId: '1.5' })
  assert.equal(JSON.stringify(result).includes(value), false)
  const nativeAction = providerIoCalls(bridge)[1][2]
  assert.equal(nativeAction.value, value)
  assert.equal(nativeAction.expected.automationId, 'title')

  await assert.rejects(
    () => access.perform(portal.id, resource.providerResourceId, 'owner', { kind: 'set_value', runtimeId: '1.5', value: 'x'.repeat(2049) }),
    /exceeds 2048/,
  )
})

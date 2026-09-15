import test from 'node:test'
import assert from 'node:assert/strict'
import { WindowsProviderCatalog } from '../dist/packages/provider-windows/src/index.js'
import {
  WINDOWS_UIA_MAX_DEPTH,
  WINDOWS_UIA_MAX_ELEMENTS,
  WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT,
  WindowsUiaReadOnlyAccess,
  parseWindowsUiaSnapshot,
} from '../dist/packages/provider-windows/src/uia.js'

function capabilities() {
  return {
    schema: 'windows_provider_capabilities_v1',
    provider: 'windows',
    providerEpoch: 'epoch-uia',
    platform: 'win32',
    capture: { api: 'windows_graphics_capture', supported: true, minimumBuild: 18362, target: 'hwnd' },
    automation: {
      api: 'uia', supported: true, inspectionSupported: true, actionSupported: false,
      maxDepth: 8, maxElements: 512, maxPatternsPerElement: 32, valueTextIncluded: false,
      semanticPatternsPreferred: true, inputInjectionFallback: false, interactiveDesktopRequiredForInjection: true,
    },
  }
}

function rawSnapshot(providerResourceId) {
  return {
    schema: 'windows_uia_snapshot_v1',
    providerResourceId,
    capturedAt: '2026-09-15T08:00:00.000Z',
    maxDepth: 8,
    maxElements: 512,
    maxPatternsPerElement: 32,
    truncated: false,
    root: {
      runtimeId: '42.1', depth: 0, parentRuntimeId: null, name: 'Editor', automationId: null,
      className: 'EditorClass', controlType: 'ControlType.Window', localizedControlType: 'window',
      processId: 91, nativeWindowHandle: 0x910, enabled: true, offscreen: false,
      keyboardFocusable: true, password: false, bounds: { x: 10, y: 20, width: 800, height: 600 }, patterns: [],
    },
    elements: [{
      runtimeId: '42.2', depth: 1, parentRuntimeId: '42.1', name: 'Save', automationId: 'save',
      className: 'Button', controlType: 'ControlType.Button', localizedControlType: 'button',
      processId: 91, nativeWindowHandle: 0, enabled: true, offscreen: false,
      keyboardFocusable: true, password: false, bounds: { x: 20, y: 30, width: 80, height: 30 },
      patterns: ['InvokePatternIdentifiers.Pattern'],
    }],
  }
}

function bridgeFixture() {
  let inspectCalls = 0
  const bridge = {
    get inspectCalls() { return inspectCalls },
    capabilities() { return capabilities() },
    async enumerateTopLevelWindows() {
      return [{ hwndHex: '0x910', processId: 91, threadId: 92, title: 'Editor', className: 'EditorClass', visible: true, minimized: false, cloakState: 'none' }]
    },
    async mountCapture(resource) { return { mountId: 'mount:u', providerResourceId: resource.providerResourceId } },
    async updateCapture() {},
    async unmountCapture() {},
    async inspectUi(resource) {
      inspectCalls += 1
      return rawSnapshot(resource.providerResourceId)
    },
    async performUiAction() { throw new Error('Phase 15.11 actions unavailable') },
  }
  return bridge
}

async function fixture() {
  const bridge = bridgeFixture()
  const catalog = new WindowsProviderCatalog(bridge)
  const [resource] = await catalog.refresh()
  assert.ok(resource)
  return { bridge, catalog, resource }
}

test('read-only UIA access validates bounded semantic tree after inspect authority', async () => {
  const { bridge, catalog, resource } = await fixture()
  const access = new WindowsUiaReadOnlyAccess(bridge, catalog, {
    canInspect: ({ principalId }) => principalId === 'reader',
    canControl: () => false,
  })
  const snapshot = await access.inspect('portal:editor', resource.providerResourceId, 'reader')
  assert.equal(snapshot.providerResourceId, resource.providerResourceId)
  assert.equal(snapshot.root.controlType, 'ControlType.Window')
  assert.equal(snapshot.elements[0].parentRuntimeId, snapshot.root.runtimeId)
  assert.deepEqual(snapshot.elements[0].patterns, ['InvokePatternIdentifiers.Pattern'])
  assert.equal(snapshot.maxDepth, WINDOWS_UIA_MAX_DEPTH)
  assert.equal(snapshot.maxElements, WINDOWS_UIA_MAX_ELEMENTS)
  assert.equal(snapshot.maxPatternsPerElement, WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT)
  assert.equal(bridge.inspectCalls, 1)
  assert.equal('performUiAction' in access, false)
})

test('UIA read authority fails before native provider inspection', async () => {
  const { bridge, catalog, resource } = await fixture()
  const access = new WindowsUiaReadOnlyAccess(bridge, catalog, { canInspect: () => false, canControl: () => true })
  await assert.rejects(() => access.inspect('portal:editor', resource.providerResourceId, 'denied'), /not authorized/)
  assert.equal(bridge.inspectCalls, 0)
})

test('UIA parser fails closed on resource mismatch and malformed tree topology', async () => {
  const { resource } = await fixture()
  assert.throws(
    () => parseWindowsUiaSnapshot(rawSnapshot('window:wrong:1:0x1'), resource.providerResourceId),
    /resource identity mismatch/,
  )
  const duplicate = rawSnapshot(resource.providerResourceId)
  duplicate.elements[0].runtimeId = duplicate.root.runtimeId
  assert.throws(() => parseWindowsUiaSnapshot(duplicate, resource.providerResourceId), /runtime ids must be unique/)

  const orphan = rawSnapshot(resource.providerResourceId)
  orphan.elements[0].parentRuntimeId = 'missing'
  assert.throws(() => parseWindowsUiaSnapshot(orphan, resource.providerResourceId), /parent runtime id is invalid/)
})

test('UIA parser rejects value-like overreach by accepting only bounded metadata fields', async () => {
  const { resource } = await fixture()
  const snapshot = rawSnapshot(resource.providerResourceId)
  snapshot.elements[0].value = 'secret text must not be part of the Phase 15.11 contract'
  const parsed = parseWindowsUiaSnapshot(snapshot, resource.providerResourceId)
  assert.equal('value' in parsed.elements[0], false)
  assert.equal(parsed.elements[0].password, false)
})

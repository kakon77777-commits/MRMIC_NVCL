import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  CONTROLLED_ACTION_E2E_SET_VALUE,
  CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID,
  CONTROLLED_ACTION_TARGET_TITLE,
  runInteractiveWindowsControlledActionE2E,
} from '../dist/packages/provider-windows/src/controlled-action-e2e.js'

const providerEpoch = 'epoch-controlled-e2e'
const processId = 1513
const hwndHex = '0x5e9'

function pngForRevision(revision) {
  const bytes = Buffer.alloc(32)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0)
  bytes.writeUInt32BE(13, 8)
  Buffer.from('IHDR').copy(bytes, 12)
  bytes.writeUInt32BE(2, 16)
  bytes.writeUInt32BE(2, 20)
  bytes[24] = revision & 0xff
  return bytes
}

function fakeBridge(now) {
  let providerResourceId
  let frameSequence = 0
  let visualRevision = 1
  const state = { invoke: 0, toggle: false, selection: 'alpha', value: '' }
  const calls = []

  const status = () => `invoke=${state.invoke};toggle=${state.toggle ? 'on' : 'off'};selection=${state.selection};valueLength=${state.value.length}`
  const snapshot = resourceId => ({
    schema: 'windows_uia_snapshot_v1',
    providerResourceId: resourceId,
    capturedAt: new Date(now()).toISOString(),
    maxDepth: 8,
    maxElements: 512,
    maxPatternsPerElement: 32,
    truncated: false,
    root: {
      runtimeId: '1.1', depth: 0, processId, nativeWindowHandle: 1513,
      enabled: true, offscreen: false, keyboardFocusable: true, password: false,
      name: CONTROLLED_ACTION_TARGET_TITLE,
      automationId: CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID,
      controlType: 'ControlType.Window', patterns: [],
    },
    elements: [
      {
        runtimeId: '1.2', parentRuntimeId: '1.1', depth: 1, processId, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Invoke action', automationId: 'MrmicInvokeButton', controlType: 'ControlType.Button',
        patterns: ['InvokePatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.3', parentRuntimeId: '1.1', depth: 1, processId, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Toggle semantic state', automationId: 'MrmicToggleCheckBox', controlType: 'ControlType.CheckBox',
        patterns: ['TogglePatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.4', parentRuntimeId: '1.1', depth: 1, processId, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Beta selection', automationId: 'MrmicSelectItemBeta', controlType: 'ControlType.ListItem',
        patterns: ['SelectionItemPatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.5', parentRuntimeId: '1.1', depth: 1, processId, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: true, password: false,
        name: 'Controlled value input', automationId: 'MrmicValueTextBox', controlType: 'ControlType.Edit',
        patterns: ['ValuePatternIdentifiers.Pattern'],
      },
      {
        runtimeId: '1.6', parentRuntimeId: '1.1', depth: 1, processId, nativeWindowHandle: 0,
        enabled: true, offscreen: false, keyboardFocusable: false, password: false,
        name: status(), automationId: 'MrmicStatusText', controlType: 'ControlType.Text', patterns: [],
      },
    ],
  })

  return {
    calls,
    capabilities() {
      return {
        schema: 'windows_provider_capabilities_v1', provider: 'windows', providerEpoch, platform: 'win32',
        capture: { api: 'windows_graphics_capture', supported: true, minimumBuild: 18362, target: 'hwnd' },
        automation: { api: 'uia', supported: true, semanticPatternsPreferred: true, inputInjectionFallback: false, interactiveDesktopRequiredForInjection: true },
      }
    },
    async enumerateTopLevelWindows() {
      return [{ hwndHex, processId, threadId: 1514, title: CONTROLLED_ACTION_TARGET_TITLE, className: 'HwndWrapper', visible: true, minimized: false, cloakState: 'none' }]
    },
    async mountCapture(resource) {
      providerResourceId = resource.providerResourceId
      calls.push(['mount', providerResourceId])
      return { mountId: 'mount-controlled-e2e', providerResourceId }
    },
    async updateCapture() {},
    async unmountCapture() { calls.push(['unmount']) },
    async snapshotCapture(mount) {
      frameSequence += 1
      const bytes = pngForRevision(visualRevision)
      return {
        schema: 'windows_capture_snapshot_v1', mountId: mount.mountId, providerResourceId: mount.providerResourceId,
        frameSequence, capturedAt: new Date(now()).toISOString(), width: 2, height: 2,
        mimeType: 'image/png', encodedBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'), bytesBase64: bytes.toString('base64'),
        transport: 'png_base64_snapshot_v1',
      }
    },
    async inspectUi(resource) {
      calls.push(['inspect', resource.providerResourceId])
      return snapshot(resource.providerResourceId)
    },
    async performUiAction(resource, action) {
      calls.push(['action', action.kind, structuredClone(action)])
      if (action.kind === 'invoke') state.invoke += 1
      else if (action.kind === 'toggle') state.toggle = !state.toggle
      else if (action.kind === 'select') state.selection = 'beta'
      else if (action.kind === 'set_value') state.value = action.value
      visualRevision += 1
      return {
        schema: 'windows_uia_action_result_v1', ok: true, providerResourceId: resource.providerResourceId,
        action: action.kind === 'set_value'
          ? { kind: action.kind, runtimeId: action.runtimeId, value: '[redacted]' }
          : { kind: action.kind, runtimeId: action.runtimeId },
        completedAt: new Date(now()).toISOString(),
      }
    },
  }
}

test('dedicated controlled-action E2E closes controlOwner -> UIA action -> fresh UIA + WGC verification without persisting payloads', async () => {
  let clock = Date.parse('2026-09-15T09:00:00.000Z')
  const runtime = {
    now: () => clock,
    sleep: async delayMs => { clock += Math.max(delayMs, 300) },
  }
  const bridge = fakeBridge(runtime.now)
  const evidence = await runInteractiveWindowsControlledActionE2E({
    bridge,
    targetProcessId: processId,
    interactiveSessionConfirmedByCaller: true,
    timeoutMs: 20_000,
    runtime,
  })

  assert.equal(evidence.schema, 'interactive_windows_controlled_action_e2e_v1')
  assert.equal(evidence.passed, true)
  assert.equal(evidence.target.title, CONTROLLED_ACTION_TARGET_TITLE)
  assert.equal(evidence.target.rootAutomationId, CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID)
  assert.equal(evidence.portal.controlOwner, 'principal:windows-controlled-action-e2e')
  assert.equal(evidence.baseline.statusName, 'invoke=0;toggle=off;selection=alpha;valueLength=0')
  assert.deepEqual(evidence.actions.map(action => action.kind), ['invoke', 'toggle', 'select', 'set_value'])
  assert.ok(evidence.actions.every(action => action.uiaPostcondition && action.visualChanged && action.beforeFrameSha256 !== action.afterFrameSha256))
  assert.equal(evidence.actions[0].postStatusName.includes('invoke=1'), true)
  assert.equal(evidence.actions[1].postStatusName.includes('toggle=on'), true)
  assert.equal(evidence.actions[2].postStatusName.includes('selection=beta'), true)
  assert.equal(evidence.actions[3].postStatusName.includes(`valueLength=${CONTROLLED_ACTION_E2E_SET_VALUE.length}`), true)
  assert.equal(evidence.actions[3].valueSha256, createHash('sha256').update(CONTROLLED_ACTION_E2E_SET_VALUE).digest('hex'))
  assert.deepEqual(evidence.privacy, { pixelPayloadPersisted: false, setValuePayloadPersisted: false, rawInputUsed: false })
  assert.deepEqual(evidence.canonical, { providerPreviewUriRetained: true, dataUriPersisted: false })

  const serialized = JSON.stringify(evidence)
  assert.equal(serialized.includes('data:image/png;base64'), false)
  assert.equal(serialized.includes('bytesBase64'), false)
  assert.equal(serialized.includes(CONTROLLED_ACTION_E2E_SET_VALUE), false)
  assert.equal(bridge.calls.filter(call => call[0] === 'action').length, 4)
})

test('controlled-action E2E requires caller confirmation before provider access', async () => {
  let touched = false
  const bridge = { capabilities() { touched = true; throw new Error('should not run') } }
  await assert.rejects(
    () => runInteractiveWindowsControlledActionE2E({ bridge, targetProcessId: processId, interactiveSessionConfirmedByCaller: false }),
    /explicit caller confirmation/,
  )
  assert.equal(touched, false)
})

test('controlled-action E2E is pinned to the dedicated target PID and title', async () => {
  let clock = Date.parse('2026-09-15T09:00:00.000Z')
  const bridge = fakeBridge(() => clock)
  await assert.rejects(
    () => runInteractiveWindowsControlledActionE2E({
      bridge,
      targetProcessId: processId + 1,
      interactiveSessionConfirmedByCaller: true,
      runtime: { now: () => clock, sleep: async ms => { clock += ms } },
    }),
    /must resolve exactly once/,
  )
  assert.equal(bridge.calls.filter(call => call[0] === 'action').length, 0)
})

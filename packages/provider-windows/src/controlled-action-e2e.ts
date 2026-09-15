import { createHash, randomUUID } from 'node:crypto'
import { renderObjectsToSvg } from '../../adapter-svg/src/index.js'
import { ObserverWorkspaceRegistry } from '../../observer-workspace/src/index.js'
import { ObserverPortalCompositor, type ObserverPortalCompositorResult } from '../../observer-workspace/src/refresh.js'
import { CanvasLivePortalCoordinator, LivePortalHostRegistry } from '../../portal-overlay/src/runtime.js'
import type { WindowsAccessAuthority, WindowsUiSemanticAction } from './index.js'
import { createWindowsWindowPortal, WindowsProviderCatalog } from './index.js'
import { WindowsUiaControlledAccess } from './uia-action.js'
import { WindowsUiaReadOnlyAccess, type WindowsUiaElement, type WindowsUiaSnapshot } from './uia.js'
import { WindowsSnapshotLivePortalHost, type WindowsSnapshotNativeBridge } from './visual-host.js'

export const INTERACTIVE_WINDOWS_CONTROLLED_ACTION_E2E_SCHEMA = 'interactive_windows_controlled_action_e2e_v1' as const
export const CONTROLLED_ACTION_TARGET_TITLE = 'MRMIC Phase 15.13 Controlled Action Target' as const
export const CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID = 'MrmicControlledActionTargetRoot' as const
export const CONTROLLED_ACTION_E2E_SET_VALUE = 'MRMIC-PHASE-15.13' as const
export const CONTROLLED_ACTION_E2E_DEFAULT_TIMEOUT_MS = 20_000

const IDS = Object.freeze({
  invoke: 'MrmicInvokeButton',
  toggle: 'MrmicToggleCheckBox',
  select: 'MrmicSelectItemBeta',
  set_value: 'MrmicValueTextBox',
  status: 'MrmicStatusText',
})

const PRINCIPAL = {
  principalId: 'principal:windows-controlled-action-e2e',
  role: 'owner' as const,
  actor: { actorType: 'user' as const, actorId: 'windows-controlled-action-e2e' },
}

export interface InteractiveWindowsControlledActionE2ERuntime {
  now?: () => number
  sleep?: (delayMs: number) => Promise<void>
}

export interface InteractiveWindowsControlledActionE2EOptions {
  bridge: WindowsSnapshotNativeBridge
  targetProcessId: number
  interactiveSessionConfirmedByCaller: boolean
  timeoutMs?: number
  runtime?: InteractiveWindowsControlledActionE2ERuntime
}

export interface ControlledActionVisualEvidence {
  frameSequence: number
  capturedAt?: string
  sha256: string
  encodedBytes: number
  width: number
  height: number
  svgContainsProjectedImage: true
}

export interface ControlledActionStepEvidence {
  kind: WindowsUiSemanticAction['kind']
  targetAutomationId: string
  inspectionCapturedAt: string
  completedAt: string
  postInspectionCapturedAt: string
  postStatusName: string
  uiaPostcondition: true
  beforeFrameSha256: string
  afterFrameSha256: string
  visualChanged: true
  valueSha256?: string
}

export interface InteractiveWindowsControlledActionE2EEvidence {
  schema: typeof INTERACTIVE_WINDOWS_CONTROLLED_ACTION_E2E_SCHEMA
  passed: true
  startedAt: string
  completedAt: string
  interactiveSessionConfirmedByCaller: true
  target: {
    providerResourceId: string
    providerEpoch: string
    hwndHex: string
    processId: number
    title: typeof CONTROLLED_ACTION_TARGET_TITLE
    rootAutomationId: typeof CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID
  }
  portal: {
    portalId: string
    portalObjectId: string
    canvasId: string
    viewId: string
    controlOwner: typeof PRINCIPAL.principalId
  }
  baseline: {
    statusName: string
    visual: ControlledActionVisualEvidence
  }
  actions: ControlledActionStepEvidence[]
  canonical: {
    providerPreviewUriRetained: true
    dataUriPersisted: false
  }
  privacy: {
    pixelPayloadPersisted: false
    setValuePayloadPersisted: false
    rawInputUsed: false
  }
}

function positiveInteger(value: unknown, label: string, fallback: number, max: number): number {
  const actual = value ?? fallback
  if (!Number.isInteger(actual) || Number(actual) < 1 || Number(actual) > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}`)
  }
  return Number(actual)
}

function visualEvidence(result: ObserverPortalCompositorResult): ControlledActionVisualEvidence {
  if (result.error) throw new Error(result.error)
  if (!result.allowed || result.frameSequence === undefined) throw new Error('controlled-action visual projection did not expose a frame')
  const preview = result.object.content?.previewUri
  if (typeof preview !== 'string' || !preview.startsWith('data:image/png;base64,')) {
    throw new Error('controlled-action visual projection did not expose PNG bytes')
  }
  const bytes = Buffer.from(preview.slice('data:image/png;base64,'.length), 'base64')
  if (bytes.length < 24) throw new Error('controlled-action PNG is too small')
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('controlled-action visual frame is not PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  if (width < 1 || height < 1) throw new Error('controlled-action PNG dimensions are invalid')
  const svg = renderObjectsToSvg(
    [result.object],
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { includeGrid: false },
  )
  if (!svg.includes('data:image/png;base64,')) throw new Error('controlled-action SVG omitted projected image')
  return {
    frameSequence: result.frameSequence,
    ...(result.capturedAt ? { capturedAt: result.capturedAt } : {}),
    sha256: createHash('sha256').update(bytes).digest('hex'),
    encodedBytes: bytes.length,
    width,
    height,
    svgContainsProjectedImage: true,
  }
}

function elementByAutomationId(snapshot: WindowsUiaSnapshot, automationId: string): WindowsUiaElement {
  const all = [snapshot.root, ...snapshot.elements]
  const matches = all.filter(element => element.automationId === automationId)
  if (matches.length !== 1) throw new Error(`expected exactly one UIA element with AutomationId ${automationId}, got ${matches.length}`)
  return matches[0]!
}

function statusName(snapshot: WindowsUiaSnapshot): string {
  const status = elementByAutomationId(snapshot, IDS.status)
  if (!status.name) throw new Error('controlled-action status element did not expose a UIA Name')
  return status.name
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, delayMs))
}

async function waitForStatus(
  readOnly: WindowsUiaReadOnlyAccess,
  portalObjectId: string,
  providerResourceId: string,
  expectedToken: string,
  deadlineMs: number,
  now: () => number,
  sleep: (delayMs: number) => Promise<void>,
): Promise<WindowsUiaSnapshot> {
  while (now() <= deadlineMs) {
    const snapshot = await readOnly.inspect(portalObjectId, providerResourceId, PRINCIPAL.principalId)
    if (statusName(snapshot).includes(expectedToken)) return snapshot
    await sleep(50)
  }
  throw new Error(`controlled-action UIA postcondition timed out: ${expectedToken}`)
}

async function waitForVisual(
  compositor: ObserverPortalCompositor,
  portal: Parameters<ObserverPortalCompositor['compose']>[0],
  observers: ObserverWorkspaceRegistry,
  viewId: string,
  previousSha256: string | undefined,
  deadlineMs: number,
  now: () => number,
  sleep: (delayMs: number) => Promise<void>,
): Promise<ControlledActionVisualEvidence> {
  while (now() <= deadlineMs) {
    const result = await compositor.compose(
      portal,
      observers.snapshotFor(PRINCIPAL),
      { kind: 'private_view', viewId },
      now(),
    )
    try {
      const frame = visualEvidence(result)
      if (!previousSha256 || frame.sha256 !== previousSha256) return frame
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!message.includes('No encoded Windows capture frame is available yet') && !message.includes('did not expose a frame')) throw error
    }
    await sleep(100)
  }
  throw new Error('controlled-action WGC visual postcondition timed out')
}

function actionFor(kind: WindowsUiSemanticAction['kind'], runtimeId: string): WindowsUiSemanticAction {
  if (kind === 'set_value') return { kind, runtimeId, value: CONTROLLED_ACTION_E2E_SET_VALUE }
  return { kind, runtimeId }
}

/**
 * Phase 15.13 caller-executed E2E for the dedicated safe WPF target only.
 * It proves the controlOwner-gated semantic action path and verifies every
 * action with both a fresh UIA postcondition and a changed WGC render frame.
 */
export async function runInteractiveWindowsControlledActionE2E(
  options: InteractiveWindowsControlledActionE2EOptions,
): Promise<InteractiveWindowsControlledActionE2EEvidence> {
  if (!options.interactiveSessionConfirmedByCaller) {
    throw new Error('controlled-action E2E requires explicit caller confirmation of an interactive Windows session')
  }
  if (!Number.isInteger(options.targetProcessId) || options.targetProcessId < 1) throw new Error('targetProcessId must be a positive integer')
  const timeoutMs = positiveInteger(options.timeoutMs, 'timeoutMs', CONTROLLED_ACTION_E2E_DEFAULT_TIMEOUT_MS, 120_000)
  const now = options.runtime?.now ?? Date.now
  const sleep = options.runtime?.sleep ?? defaultSleep
  const startedAt = new Date().toISOString()
  const deadlineMs = now() + timeoutMs

  const catalog = new WindowsProviderCatalog(options.bridge)
  const resources = await catalog.refresh()
  const matches = resources.filter(resource => resource.processId === options.targetProcessId && resource.title === CONTROLLED_ACTION_TARGET_TITLE)
  if (matches.length !== 1) throw new Error(`dedicated controlled-action target must resolve exactly once, got ${matches.length}`)
  const target = matches[0]!
  if (target.state.minimized || !target.state.visible) throw new Error('dedicated controlled-action target must be visible and non-minimized')

  const portalId = `portal:windows-control-e2e:${randomUUID()}`
  const portalObjectId = `object:windows-control-e2e:${randomUUID()}`
  const canvasId = 'canvas:windows-controlled-action-e2e'
  const viewId = 'view:windows-controlled-action-e2e'
  const portal = createWindowsWindowPortal({
    resource: target,
    portalId,
    canvasObjectId: portalObjectId,
    canvasId,
    pmwWorkspaceId: 'world:windows-controlled-action-e2e',
    actor: PRINCIPAL.actor,
    createdAt: startedAt,
  })

  const host = new WindowsSnapshotLivePortalHost(options.bridge, catalog)
  const hosts = new LivePortalHostRegistry()
  hosts.register('windows', host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  const observers = new ObserverWorkspaceRegistry()
  observers.createPrivateView({ viewId, worldId: 'world:windows-controlled-action-e2e', canvasId }, PRINCIPAL)
  observers.setForegroundStack(viewId, [portalId], PRINCIPAL)

  const authority: WindowsAccessAuthority = {
    canInspect: input => input.portalObjectId === portalObjectId
      && input.providerResourceId === target.providerResourceId
      && input.principalId === PRINCIPAL.principalId,
    canControl: input => input.portalObjectId === portalObjectId
      && input.providerResourceId === target.providerResourceId
      && input.principalId === PRINCIPAL.principalId,
  }
  const readOnly = new WindowsUiaReadOnlyAccess(options.bridge, catalog, authority)
  const controlled = new WindowsUiaControlledAccess(options.bridge, catalog, authority, coordinator, now)
  const compositor = new ObserverPortalCompositor(hosts)

  await coordinator.activate(
    portal,
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { left: 0, top: 0, width: 1200, height: 800 },
  )
  coordinator.acquireControl(portalObjectId, PRINCIPAL.principalId)

  try {
    const initialInspection = await readOnly.inspect(portalObjectId, target.providerResourceId, PRINCIPAL.principalId)
    if (initialInspection.root.automationId !== CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID) {
      throw new Error('selected Windows process is not the dedicated Phase 15.13 controlled-action target')
    }
    const initialStatus = statusName(initialInspection)
    if (initialStatus !== 'invoke=0;toggle=off;selection=alpha;valueLength=0') {
      throw new Error(`dedicated target initial state mismatch: ${initialStatus}`)
    }
    let visual = await waitForVisual(compositor, portal, observers, viewId, undefined, deadlineMs, now, sleep)
    const baseline = { statusName: initialStatus, visual }
    const actions: ControlledActionStepEvidence[] = []

    const plan: Array<{ kind: WindowsUiSemanticAction['kind']; automationId: string; postToken: string }> = [
      { kind: 'invoke', automationId: IDS.invoke, postToken: 'invoke=1' },
      { kind: 'toggle', automationId: IDS.toggle, postToken: 'toggle=on' },
      { kind: 'select', automationId: IDS.select, postToken: 'selection=beta' },
      { kind: 'set_value', automationId: IDS.set_value, postToken: `valueLength=${CONTROLLED_ACTION_E2E_SET_VALUE.length}` },
    ]

    for (const step of plan) {
      if (now() > deadlineMs) throw new Error('controlled-action E2E exceeded the overall timeout')
      const preInspection = await readOnly.inspect(portalObjectId, target.providerResourceId, PRINCIPAL.principalId)
      const targetElement = elementByAutomationId(preInspection, step.automationId)
      const action = actionFor(step.kind, targetElement.runtimeId)
      const beforeFrameSha256 = visual.sha256
      const result = await controlled.perform(
        portalObjectId,
        target.providerResourceId,
        PRINCIPAL.principalId,
        action,
      )
      const postInspection = await waitForStatus(
        readOnly,
        portalObjectId,
        target.providerResourceId,
        step.postToken,
        deadlineMs,
        now,
        sleep,
      )
      const postName = statusName(postInspection)
      visual = await waitForVisual(compositor, portal, observers, viewId, beforeFrameSha256, deadlineMs, now, sleep)
      actions.push({
        kind: step.kind,
        targetAutomationId: step.automationId,
        inspectionCapturedAt: result.inspectionCapturedAt,
        completedAt: result.completedAt,
        postInspectionCapturedAt: postInspection.capturedAt,
        postStatusName: postName,
        uiaPostcondition: true,
        beforeFrameSha256,
        afterFrameSha256: visual.sha256,
        visualChanged: true,
        ...(step.kind === 'set_value'
          ? { valueSha256: createHash('sha256').update(CONTROLLED_ACTION_E2E_SET_VALUE, 'utf8').digest('hex') }
          : {}),
      })
    }

    const canonicalPreview = portal.content?.previewUri
    const providerPreviewUriRetained = typeof canonicalPreview === 'string' && canonicalPreview.startsWith('windows://')
    const dataUriPersisted = typeof canonicalPreview === 'string' && canonicalPreview.startsWith('data:')
    if (!providerPreviewUriRetained || dataUriPersisted) throw new Error('canonical controlled-action portal persisted visual frame bytes')

    return {
      schema: INTERACTIVE_WINDOWS_CONTROLLED_ACTION_E2E_SCHEMA,
      passed: true,
      startedAt,
      completedAt: new Date().toISOString(),
      interactiveSessionConfirmedByCaller: true,
      target: {
        providerResourceId: target.providerResourceId,
        providerEpoch: target.providerEpoch,
        hwndHex: target.hwndHex,
        processId: target.processId,
        title: CONTROLLED_ACTION_TARGET_TITLE,
        rootAutomationId: CONTROLLED_ACTION_TARGET_ROOT_AUTOMATION_ID,
      },
      portal: {
        portalId,
        portalObjectId,
        canvasId,
        viewId,
        controlOwner: PRINCIPAL.principalId,
      },
      baseline,
      actions,
      canonical: {
        providerPreviewUriRetained: true,
        dataUriPersisted: false,
      },
      privacy: {
        pixelPayloadPersisted: false,
        setValuePayloadPersisted: false,
        rawInputUsed: false,
      },
    }
  } finally {
    const state = coordinator.state(portalObjectId)
    if (state?.controlOwner === PRINCIPAL.principalId) coordinator.releaseControl(portalObjectId, PRINCIPAL.principalId)
    await coordinator.deactivateAll()
  }
}

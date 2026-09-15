import type { CanvasLivePortalCoordinator } from '../../portal-overlay/src/runtime.js'
import type {
  WindowsAccessAuthority,
  WindowsNativeBridge,
  WindowsProviderCatalog,
  WindowsUiActionResult,
  WindowsUiSemanticAction,
  WindowsWindowResourceDescriptor,
} from './index.js'
import {
  WindowsUiaReadOnlyAccess,
  type WindowsUiaElement,
  type WindowsUiaSnapshot,
} from './uia.js'

export const WINDOWS_UIA_CONTROLLED_ACTION_SCHEMA = 'windows_uia_controlled_action_v1' as const
export const WINDOWS_UIA_ACTION_MAX_INSPECTION_AGE_MS = 2_000
export const WINDOWS_UIA_ACTION_MAX_VALUE_LENGTH = 2_048

export interface WindowsUiaControlledActionResult {
  schema: typeof WINDOWS_UIA_CONTROLLED_ACTION_SCHEMA
  ok: true
  portalObjectId: string
  providerResourceId: string
  principalId: string
  action: { kind: WindowsUiSemanticAction['kind']; runtimeId: string }
  inspectionCapturedAt: string
  completedAt: string
}

interface ExpectedElementBinding {
  processId: number
  nativeWindowHandle: number
  automationId?: string
  controlType?: string
}

type BoundSemanticAction = WindowsUiSemanticAction & { expected: ExpectedElementBinding }

function requiredText(value: unknown, label: string, max = 512): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return text
}

function validateIntent(action: WindowsUiSemanticAction): WindowsUiSemanticAction {
  const runtimeId = requiredText(action.runtimeId, 'action.runtimeId', 512)
  if (!['invoke', 'toggle', 'select', 'set_value'].includes(action.kind)) throw new Error('unsupported UIA semantic action')
  if (action.kind === 'set_value') {
    if (typeof action.value !== 'string') throw new Error('set_value requires a string value')
    if (action.value.length > WINDOWS_UIA_ACTION_MAX_VALUE_LENGTH) {
      throw new Error(`set_value exceeds ${WINDOWS_UIA_ACTION_MAX_VALUE_LENGTH} characters`)
    }
    if (action.value.includes('\0')) throw new Error('set_value contains an invalid null character')
    return { kind: 'set_value', runtimeId, value: action.value }
  }
  return { kind: action.kind, runtimeId }
}

function findElement(snapshot: WindowsUiaSnapshot, runtimeId: string): WindowsUiaElement {
  if (snapshot.root.runtimeId === runtimeId) return snapshot.root
  const element = snapshot.elements.find(candidate => candidate.runtimeId === runtimeId)
  if (!element) throw new Error('UIA action target is stale or outside the bounded inspection tree')
  return element
}

function requiredPattern(action: WindowsUiSemanticAction['kind']): string {
  switch (action) {
    case 'invoke': return 'InvokePattern'
    case 'toggle': return 'TogglePattern'
    case 'select': return 'SelectionItemPattern'
    case 'set_value': return 'ValuePattern'
  }
}

function assertPattern(element: WindowsUiaElement, kind: WindowsUiSemanticAction['kind']): void {
  const token = requiredPattern(kind)
  if (!element.patterns.some(pattern => pattern.includes(token))) {
    throw new Error(`UIA action target does not advertise ${token}`)
  }
}

function bindAction(action: WindowsUiSemanticAction, element: WindowsUiaElement): BoundSemanticAction {
  const expected: ExpectedElementBinding = {
    processId: element.processId,
    nativeWindowHandle: element.nativeWindowHandle,
    ...(element.automationId ? { automationId: element.automationId } : {}),
    ...(element.controlType ? { controlType: element.controlType } : {}),
  }
  return { ...structuredClone(action), expected } as BoundSemanticAction
}

function validateNativeResult(
  result: WindowsUiActionResult,
  resource: WindowsWindowResourceDescriptor,
  action: WindowsUiSemanticAction,
): string {
  if (!result || result.ok !== true) throw new Error('native UIA action did not report success')
  if (result.providerResourceId !== resource.providerResourceId) throw new Error('native UIA action provider resource identity mismatch')
  if (!result.action || result.action.kind !== action.kind || result.action.runtimeId !== action.runtimeId) {
    throw new Error('native UIA action result identity mismatch')
  }
  if (action.kind === 'set_value') {
    const returned = result.action as Extract<WindowsUiSemanticAction, { kind: 'set_value' }>
    if (returned.value !== '[redacted]') throw new Error('native UIA action result must redact set_value content')
  }
  if (typeof result.completedAt !== 'string' || !Number.isFinite(Date.parse(result.completedAt))) {
    throw new Error('native UIA action completion timestamp is invalid')
  }
  return result.completedAt
}

/**
 * Phase 15.12 reference control lane. controlOwner and policy authorization are
 * checked before provider I/O. A fresh bounded UIA inspection is then used to
 * bind the runtime element identity and supported pattern immediately before
 * the native action call.
 */
export class WindowsUiaControlledAccess {
  readonly #bridge: WindowsNativeBridge
  readonly #catalog: WindowsProviderCatalog
  readonly #authority: WindowsAccessAuthority
  readonly #coordinator: CanvasLivePortalCoordinator
  readonly #readOnly: WindowsUiaReadOnlyAccess
  readonly #now: () => number

  constructor(
    bridge: WindowsNativeBridge,
    catalog: WindowsProviderCatalog,
    authority: WindowsAccessAuthority,
    coordinator: CanvasLivePortalCoordinator,
    now: () => number = Date.now,
  ) {
    this.#bridge = bridge
    this.#catalog = catalog
    this.#authority = authority
    this.#coordinator = coordinator
    this.#readOnly = new WindowsUiaReadOnlyAccess(bridge, catalog, authority)
    this.#now = now
  }

  async perform(
    portalObjectId: string,
    providerResourceId: string,
    principalId: string,
    requestedAction: WindowsUiSemanticAction,
  ): Promise<WindowsUiaControlledActionResult> {
    const portal = requiredText(portalObjectId, 'portalObjectId')
    const resourceId = requiredText(providerResourceId, 'providerResourceId')
    const principal = requiredText(principalId, 'principalId')
    const action = validateIntent(requestedAction)
    const accessInput = { portalObjectId: portal, providerResourceId: resourceId, principalId: principal }

    const state = this.#coordinator.state(portal)
    if (!state?.mounted || !state.visible) throw new Error('Windows portal must be mounted and visible before UIA control')
    if (state.controlOwner !== principal) throw new Error('principal does not own Windows portal control')
    if (!this.#authority.canControl(accessInput)) throw new Error('principal is not authorized to control Windows resource')

    // WindowsUiaReadOnlyAccess performs canInspect before native provider I/O.
    const inspection = await this.#readOnly.inspect(portal, resourceId, principal)
    const capturedAtMs = Date.parse(inspection.capturedAt)
    const ageMs = this.#now() - capturedAtMs
    if (!Number.isFinite(ageMs) || ageMs < -5_000 || ageMs > WINDOWS_UIA_ACTION_MAX_INSPECTION_AGE_MS) {
      throw new Error('fresh UIA inspection exceeded the action freshness bound')
    }

    const element = findElement(inspection, action.runtimeId)
    if (!element.enabled) throw new Error('UIA action target is disabled')
    if (action.kind === 'set_value' && element.password) throw new Error('Phase 15.12 does not set password element values')
    assertPattern(element, action.kind)

    const resource = this.#catalog.get(resourceId)
    if (!resource) throw new Error(`Windows resource ${resourceId} is not present in the current provider epoch`)
    const nativeResult = await this.#bridge.performUiAction(resource, bindAction(action, element))
    const completedAt = validateNativeResult(nativeResult, resource, action)

    return {
      schema: WINDOWS_UIA_CONTROLLED_ACTION_SCHEMA,
      ok: true,
      portalObjectId: portal,
      providerResourceId: resourceId,
      principalId: principal,
      action: { kind: action.kind, runtimeId: action.runtimeId },
      inspectionCapturedAt: inspection.capturedAt,
      completedAt,
    }
  }
}

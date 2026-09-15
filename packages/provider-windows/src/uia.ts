import type {
  WindowsAccessAuthority,
  WindowsNativeBridge,
  WindowsProviderCatalog,
  WindowsUiElementRef,
  WindowsUiSnapshot,
  WindowsWindowResourceDescriptor,
} from './index.js'

export const WINDOWS_UIA_SNAPSHOT_SCHEMA = 'windows_uia_snapshot_v1' as const
export const WINDOWS_UIA_MAX_DEPTH = 8
export const WINDOWS_UIA_MAX_ELEMENTS = 512
export const WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT = 32
export const WINDOWS_UIA_MAX_TEXT = 2048

export interface WindowsUiaBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface WindowsUiaElement extends WindowsUiElementRef {
  depth: number
  parentRuntimeId?: string
  className?: string
  localizedControlType?: string
  processId: number
  nativeWindowHandle: number
  keyboardFocusable: boolean
  password: boolean
  bounds?: WindowsUiaBounds
}

export interface WindowsUiaSnapshot extends WindowsUiSnapshot {
  schema: typeof WINDOWS_UIA_SNAPSHOT_SCHEMA
  maxDepth: typeof WINDOWS_UIA_MAX_DEPTH
  maxElements: typeof WINDOWS_UIA_MAX_ELEMENTS
  maxPatternsPerElement: typeof WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT
  truncated: boolean
  root: WindowsUiaElement
  elements: WindowsUiaElement[]
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function requiredText(value: unknown, label: string, max = WINDOWS_UIA_MAX_TEXT): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  const text = value.trim()
  if (text.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return text
}

function optionalText(value: unknown, label: string, max = WINDOWS_UIA_MAX_TEXT): string | undefined {
  if (value === null || value === undefined || value === '') return undefined
  return requiredText(value, label, max)
}

function integer(value: unknown, label: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max) {
    throw new Error(`${label} must be an integer between ${min} and ${max}`)
  }
  return Number(value)
}

function bool(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${label} must be boolean`)
  return value
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function parseBounds(value: unknown, label: string): WindowsUiaBounds | undefined {
  if (value === null || value === undefined) return undefined
  const input = record(value, label)
  const width = finiteNumber(input.width, `${label}.width`)
  const height = finiteNumber(input.height, `${label}.height`)
  if (width < 0 || height < 0) throw new Error(`${label} dimensions must be non-negative`)
  return {
    x: finiteNumber(input.x, `${label}.x`),
    y: finiteNumber(input.y, `${label}.y`),
    width,
    height,
  }
}

function parsePatterns(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`)
  if (value.length > WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT) throw new Error(`${label} exceeds the pattern bound`)
  const patterns = value.map((item, index) => requiredText(item, `${label}[${index}]`, 256))
  if (new Set(patterns).size !== patterns.length) throw new Error(`${label} must not contain duplicate patterns`)
  return patterns
}

function parseElement(value: unknown, label: string): WindowsUiaElement {
  const input = record(value, label)
  const element: WindowsUiaElement = {
    runtimeId: requiredText(input.runtimeId, `${label}.runtimeId`, 512),
    depth: integer(input.depth, `${label}.depth`, 0, WINDOWS_UIA_MAX_DEPTH),
    processId: integer(input.processId, `${label}.processId`, 0, 0x7fffffff),
    nativeWindowHandle: integer(input.nativeWindowHandle, `${label}.nativeWindowHandle`, 0, 0x7fffffff),
    enabled: bool(input.enabled, `${label}.enabled`),
    offscreen: bool(input.offscreen, `${label}.offscreen`),
    keyboardFocusable: bool(input.keyboardFocusable, `${label}.keyboardFocusable`),
    password: bool(input.password, `${label}.password`),
    patterns: parsePatterns(input.patterns, `${label}.patterns`),
  }
  const parentRuntimeId = optionalText(input.parentRuntimeId, `${label}.parentRuntimeId`, 512)
  const name = optionalText(input.name, `${label}.name`)
  const automationId = optionalText(input.automationId, `${label}.automationId`)
  const className = optionalText(input.className, `${label}.className`)
  const controlType = optionalText(input.controlType, `${label}.controlType`, 512)
  const localizedControlType = optionalText(input.localizedControlType, `${label}.localizedControlType`, 512)
  const bounds = parseBounds(input.bounds, `${label}.bounds`)
  if (parentRuntimeId) element.parentRuntimeId = parentRuntimeId
  if (name) element.name = name
  if (automationId) element.automationId = automationId
  if (className) element.className = className
  if (controlType) element.controlType = controlType
  if (localizedControlType) element.localizedControlType = localizedControlType
  if (bounds) element.bounds = bounds
  return element
}

export function parseWindowsUiaSnapshot(value: unknown, expectedProviderResourceId: string): WindowsUiaSnapshot {
  const input = record(value, 'uia.inspect')
  if (input.schema !== WINDOWS_UIA_SNAPSHOT_SCHEMA) throw new Error('uia.inspect schema mismatch')
  const providerResourceId = requiredText(input.providerResourceId, 'uia.inspect.providerResourceId', 512)
  if (providerResourceId !== expectedProviderResourceId) throw new Error('uia.inspect provider resource identity mismatch')
  const capturedAt = requiredText(input.capturedAt, 'uia.inspect.capturedAt', 128)
  if (!Number.isFinite(Date.parse(capturedAt))) throw new Error('uia.inspect.capturedAt must be an ISO timestamp')
  if (input.maxDepth !== WINDOWS_UIA_MAX_DEPTH) throw new Error('uia.inspect maxDepth contract mismatch')
  if (input.maxElements !== WINDOWS_UIA_MAX_ELEMENTS) throw new Error('uia.inspect maxElements contract mismatch')
  if (input.maxPatternsPerElement !== WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT) throw new Error('uia.inspect maxPatternsPerElement contract mismatch')
  const truncated = bool(input.truncated, 'uia.inspect.truncated')
  const root = parseElement(input.root, 'uia.inspect.root')
  if (root.depth !== 0 || root.parentRuntimeId !== undefined) throw new Error('uia.inspect root topology is invalid')
  if (!Array.isArray(input.elements)) throw new Error('uia.inspect.elements must be an array')
  if (input.elements.length > WINDOWS_UIA_MAX_ELEMENTS) throw new Error('uia.inspect element count exceeds the bound')
  const elements = input.elements.map((item, index) => parseElement(item, `uia.inspect.elements[${index}]`))
  const runtimeIds = new Set<string>([root.runtimeId])
  for (const element of elements) {
    if (runtimeIds.has(element.runtimeId)) throw new Error('uia.inspect runtime ids must be unique')
    runtimeIds.add(element.runtimeId)
  }
  for (const element of elements) {
    if (element.depth < 1) throw new Error('uia.inspect descendants must have positive depth')
    if (!element.parentRuntimeId || !runtimeIds.has(element.parentRuntimeId)) throw new Error('uia.inspect parent runtime id is invalid')
  }
  return {
    schema: WINDOWS_UIA_SNAPSHOT_SCHEMA,
    providerResourceId,
    capturedAt,
    maxDepth: WINDOWS_UIA_MAX_DEPTH,
    maxElements: WINDOWS_UIA_MAX_ELEMENTS,
    maxPatternsPerElement: WINDOWS_UIA_MAX_PATTERNS_PER_ELEMENT,
    truncated,
    root,
    elements,
  }
}

/**
 * Phase 15.11 reference semantic lane. It deliberately exposes inspection only;
 * there is no action method, so semantic observation cannot silently become control.
 */
export class WindowsUiaReadOnlyAccess {
  readonly #bridge: WindowsNativeBridge
  readonly #catalog: WindowsProviderCatalog
  readonly #authority: WindowsAccessAuthority

  constructor(bridge: WindowsNativeBridge, catalog: WindowsProviderCatalog, authority: WindowsAccessAuthority) {
    this.#bridge = bridge
    this.#catalog = catalog
    this.#authority = authority
  }

  async inspect(
    portalObjectId: string,
    providerResourceId: string,
    principalId: string,
  ): Promise<WindowsUiaSnapshot> {
    const portal = requiredText(portalObjectId, 'portalObjectId', 512)
    const resourceId = requiredText(providerResourceId, 'providerResourceId', 512)
    const principal = requiredText(principalId, 'principalId', 512)
    if (!this.#authority.canInspect({ portalObjectId: portal, providerResourceId: resourceId, principalId: principal })) {
      throw new Error('principal is not authorized to inspect Windows resource')
    }
    const resource = this.#catalog.get(resourceId)
    if (!resource) throw new Error(`Windows resource ${resourceId} is not present in the current provider epoch`)
    if (!resource.automation.available) throw new Error('UI Automation inspection is unavailable for this Windows resource')
    const raw = await this.#bridge.inspectUi(resource)
    return parseWindowsUiaSnapshot(raw, resource.providerResourceId)
  }
}

export function windowsUiaInspectionResource(resource: WindowsWindowResourceDescriptor): Pick<WindowsWindowResourceDescriptor, 'providerResourceId' | 'providerEpoch' | 'hwndHex' | 'processId'> {
  return {
    providerResourceId: resource.providerResourceId,
    providerEpoch: resource.providerEpoch,
    hwndHex: resource.hwndHex,
    processId: resource.processId,
  }
}

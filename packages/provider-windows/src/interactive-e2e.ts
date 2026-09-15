import { createHash, randomUUID } from 'node:crypto'
import { renderObjectsToSvg } from '../../adapter-svg/src/index.js'
import { ObserverWorkspaceRegistry } from '../../observer-workspace/src/index.js'
import {
  ObserverPortalCompositor,
  ObserverPortalRefreshLoop,
  type ObserverPortalCompositorResult,
} from '../../observer-workspace/src/refresh.js'
import { LivePortalHostRegistry, CanvasLivePortalCoordinator } from '../../portal-overlay/src/runtime.js'
import { WindowsProviderCatalog, createWindowsWindowPortal, normalizeHwndHex } from './index.js'
import { WindowsSnapshotLivePortalHost, type WindowsSnapshotNativeBridge } from './visual-host.js'

export const INTERACTIVE_WINDOWS_E2E_SCHEMA = 'interactive_windows_e2e_v1' as const
export const INTERACTIVE_WINDOWS_E2E_DEFAULT_SAMPLES = 3
export const INTERACTIVE_WINDOWS_E2E_MAX_SAMPLES = 20
export const INTERACTIVE_WINDOWS_E2E_DEFAULT_TIMEOUT_MS = 15_000

export interface InteractiveWindowsTargetSelector {
  titleContains?: string
  hwndHex?: string
}

export interface InteractiveWindowsE2ERuntime {
  now?: () => number
  schedule?: (callback: () => void, delayMs: number) => unknown
  cancel?: (handle: unknown) => void
}

export interface InteractiveWindowsE2EOptions {
  bridge: WindowsSnapshotNativeBridge
  selector: InteractiveWindowsTargetSelector
  samples?: number
  timeoutMs?: number
  interactiveSessionConfirmedByCaller: boolean
  runtime?: InteractiveWindowsE2ERuntime
}

export interface InteractiveWindowsE2ESample {
  frameSequence: number
  capturedAt?: string
  sha256: string
  encodedBytes: number
  width: number
  height: number
  svgContainsProjectedImage: boolean
}

export interface InteractiveWindowsE2EEvidence {
  schema: typeof INTERACTIVE_WINDOWS_E2E_SCHEMA
  passed: true
  startedAt: string
  completedAt: string
  interactiveSessionConfirmedByCaller: true
  target: {
    provider: 'windows'
    providerEpoch: string
    providerResourceId: string
    hwndHex: string
    processId: number
    title: string
  }
  portal: {
    portalId: string
    portalObjectId: string
    canvasId: string
    viewId: string
  }
  capture: {
    samplesRequested: number
    samples: InteractiveWindowsE2ESample[]
    distinctFrameSequences: number
    monotonicNonDecreasing: true
  }
  lifecycle: {
    frozenRetainedFrame: boolean
    frozenProviderRead: false
    sleepingClearedPixels: boolean
    sleepingProviderRead: false
  }
  canonical: {
    providerPreviewUriRetained: boolean
    dataUriPersisted: false
  }
}

const E2E_PRINCIPAL = {
  principalId: 'principal:windows-interactive-e2e',
  role: 'owner' as const,
  actor: { actorType: 'user' as const, actorId: 'windows-interactive-e2e' },
}

function required(value: unknown, label: string, max = 2048): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  const normalized = value.trim()
  if (normalized.length > max) throw new Error(`${label} exceeds ${max} characters`)
  return normalized
}

function boundedPositiveInteger(value: unknown, label: string, fallback: number, max: number): number {
  const actual = value ?? fallback
  if (!Number.isInteger(actual) || Number(actual) < 1 || Number(actual) > max) {
    throw new Error(`${label} must be an integer between 1 and ${max}`)
  }
  return Number(actual)
}

function selectTarget(resources: ReturnType<WindowsProviderCatalog['list']>, selector: InteractiveWindowsTargetSelector) {
  const hwnd = selector.hwndHex ? normalizeHwndHex(selector.hwndHex) : undefined
  const title = selector.titleContains?.trim().toLocaleLowerCase()
  if (!hwnd && !title) throw new Error('one of selector.hwndHex or selector.titleContains is required')
  if (hwnd && title) throw new Error('selector.hwndHex and selector.titleContains are mutually exclusive')

  const matches = hwnd
    ? resources.filter(resource => resource.hwndHex === hwnd)
    : resources.filter(resource => resource.title.toLocaleLowerCase().includes(title!))

  if (matches.length === 0) throw new Error('no discoverable Windows target matched the selector')
  if (matches.length > 1) throw new Error(`Windows target selector is ambiguous: ${matches.length} resources matched`)
  const target = matches[0]
  if (!target) throw new Error('Windows target selection failed')
  if (target.state.minimized) throw new Error('interactive Windows E2E target must not be minimized')
  return target
}

function dataUriEvidence(result: ObserverPortalCompositorResult): InteractiveWindowsE2ESample {
  const previewUri = result.object.content?.previewUri
  if (typeof previewUri !== 'string' || !previewUri.startsWith('data:image/png;base64,')) {
    throw new Error('observer refresh did not produce a PNG data URI')
  }
  if (result.frameSequence === undefined) throw new Error('observer refresh did not expose a frame sequence')
  const encoded = previewUri.slice('data:image/png;base64,'.length)
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length < 24) throw new Error('projected PNG is too small to contain a valid IHDR')
  const signature = [137, 80, 78, 71, 13, 10, 26, 10]
  if (!signature.every((value, index) => bytes[index] === value)) throw new Error('projected visual is not a PNG')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const width = view.getUint32(16, false)
  const height = view.getUint32(20, false)
  if (width < 1 || height < 1) throw new Error('projected PNG has invalid dimensions')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const svg = renderObjectsToSvg(
    [result.object],
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { includeGrid: false },
  )
  return {
    frameSequence: result.frameSequence,
    ...(result.capturedAt ? { capturedAt: result.capturedAt } : {}),
    sha256,
    encodedBytes: bytes.length,
    width,
    height,
    svgContainsProjectedImage: svg.includes('data:image/png;base64,'),
  }
}

function isFrameNotReady(error: string | undefined): boolean {
  return Boolean(error?.includes('No encoded Windows capture frame is available yet'))
}

/**
 * Execute the real provider -> WGC -> observer refresh -> Canvas render-copy path.
 * The evidence intentionally excludes PNG/Base64 bytes; hashes and dimensions are
 * retained instead so validation does not become a durable screenshot channel.
 */
export async function runInteractiveWindowsE2E(options: InteractiveWindowsE2EOptions): Promise<InteractiveWindowsE2EEvidence> {
  if (!options.interactiveSessionConfirmedByCaller) {
    throw new Error('interactive Windows E2E requires explicit caller confirmation of an interactive user session')
  }
  const samplesRequested = boundedPositiveInteger(
    options.samples,
    'samples',
    INTERACTIVE_WINDOWS_E2E_DEFAULT_SAMPLES,
    INTERACTIVE_WINDOWS_E2E_MAX_SAMPLES,
  )
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, 'timeoutMs', INTERACTIVE_WINDOWS_E2E_DEFAULT_TIMEOUT_MS, 120_000)
  const startedAt = new Date().toISOString()

  const catalog = new WindowsProviderCatalog(options.bridge)
  const resources = await catalog.refresh()
  const target = selectTarget(resources, options.selector)
  const portalId = `portal:windows-e2e:${randomUUID()}`
  const portalObjectId = `object:windows-e2e:${randomUUID()}`
  const canvasId = 'canvas:windows-interactive-e2e'
  const viewId = 'view:windows-interactive-e2e'
  const portal = createWindowsWindowPortal({
    resource: target,
    portalId,
    canvasObjectId: portalObjectId,
    canvasId,
    pmwWorkspaceId: 'world:windows-interactive-e2e',
    actor: E2E_PRINCIPAL.actor,
    createdAt: startedAt,
  })

  if (target.projection.preferredDisplayMode !== 'live') throw new Error('interactive Windows target did not advertise live capture')

  const host = new WindowsSnapshotLivePortalHost(options.bridge, catalog)
  const hosts = new LivePortalHostRegistry()
  hosts.register('windows', host)
  const coordinator = new CanvasLivePortalCoordinator(hosts)
  const observers = new ObserverWorkspaceRegistry()
  observers.createPrivateView({
    viewId,
    worldId: 'world:windows-interactive-e2e',
    canvasId,
  }, E2E_PRINCIPAL)
  observers.setForegroundStack(viewId, [portalId], E2E_PRINCIPAL)

  await coordinator.activate(
    portal,
    { x: 0, y: 0, width: 1200, height: 800, zoom: 1 },
    { left: 0, top: 0, width: 1200, height: 800 },
  )

  const compositor = new ObserverPortalCompositor(hosts)
  const samples: InteractiveWindowsE2ESample[] = []
  const runtime = options.runtime ?? {}
  let loop: ObserverPortalRefreshLoop | undefined

  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        loop?.stop()
        clearTimeout(timeout)
        if (error) reject(error)
        else resolve()
      }
      const timeout = setTimeout(
        () => finish(new Error(`interactive Windows E2E timed out after ${timeoutMs} ms with ${samples.length}/${samplesRequested} samples`)),
        timeoutMs,
      )
      loop = new ObserverPortalRefreshLoop({
        compositor,
        object: () => portal,
        observerSnapshot: () => observers.snapshotFor(E2E_PRINCIPAL),
        target: { kind: 'private_view', viewId },
        onProjection: result => {
          if (result.error) {
            if (isFrameNotReady(result.error)) return
            finish(new Error(result.error))
            return
          }
          if (!result.providerRead || result.frameSequence === undefined) return
          try {
            const sample = dataUriEvidence(result)
            const previous = samples.at(-1)
            if (previous && sample.frameSequence < previous.frameSequence) {
              finish(new Error('interactive Windows frame sequence regressed'))
              return
            }
            if (!sample.svgContainsProjectedImage) {
              finish(new Error('interactive Windows render did not contain the projected image'))
              return
            }
            samples.push(sample)
            if (samples.length >= samplesRequested) finish()
          } catch (error) {
            finish(error instanceof Error ? error : new Error(String(error)))
          }
        },
        ...(runtime.now ? { now: runtime.now } : {}),
        ...(runtime.schedule ? { schedule: runtime.schedule } : {}),
        ...(runtime.cancel ? { cancel: runtime.cancel } : {}),
      })
      loop.start()
    })

    const last = samples.at(-1)
    if (!last) throw new Error('interactive Windows E2E did not capture any visual sample')

    observers.setViewLifecycle(viewId, 'frozen', E2E_PRINCIPAL)
    const frozen = await compositor.compose(
      portal,
      observers.snapshotFor(E2E_PRINCIPAL),
      { kind: 'private_view', viewId },
      (runtime.now ?? Date.now)() + 10_000,
    )
    const frozenRetainedFrame = frozen.fromCache && frozen.frameSequence === last.frameSequence
    if (frozen.providerRead || !frozenRetainedFrame) throw new Error('frozen lifecycle did not retain the latest frame without provider I/O')

    observers.setViewLifecycle(viewId, 'sleeping', E2E_PRINCIPAL)
    const sleeping = await compositor.compose(
      portal,
      observers.snapshotFor(E2E_PRINCIPAL),
      { kind: 'private_view', viewId },
      (runtime.now ?? Date.now)() + 20_000,
    )
    const sleepingClearedPixels = !sleeping.providerRead
      && sleeping.allowed === false
      && sleeping.object.content?.previewUri === undefined
      && compositor.cachedPortalCount() === 0
    if (!sleepingClearedPixels) throw new Error('sleeping lifecycle did not clear observer pixel state without provider I/O')

    const canonicalPreview = portal.content?.previewUri
    const providerPreviewUriRetained = typeof canonicalPreview === 'string' && canonicalPreview.startsWith('windows://')
    const dataUriPersisted = typeof canonicalPreview === 'string' && canonicalPreview.startsWith('data:')
    if (!providerPreviewUriRetained || dataUriPersisted) throw new Error('canonical Windows portal persisted visual frame bytes')

    return {
      schema: INTERACTIVE_WINDOWS_E2E_SCHEMA,
      passed: true,
      startedAt,
      completedAt: new Date().toISOString(),
      interactiveSessionConfirmedByCaller: true,
      target: {
        provider: 'windows',
        providerEpoch: target.providerEpoch,
        providerResourceId: target.providerResourceId,
        hwndHex: target.hwndHex,
        processId: target.processId,
        title: target.title,
      },
      portal: { portalId, portalObjectId, canvasId, viewId },
      capture: {
        samplesRequested,
        samples,
        distinctFrameSequences: new Set(samples.map(sample => sample.frameSequence)).size,
        monotonicNonDecreasing: true,
      },
      lifecycle: {
        frozenRetainedFrame,
        frozenProviderRead: false,
        sleepingClearedPixels,
        sleepingProviderRead: false,
      },
      canonical: {
        providerPreviewUriRetained,
        dataUriPersisted: false,
      },
    }
  } finally {
    loop?.stop()
    await coordinator.deactivateAll()
  }
}

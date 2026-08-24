import type { CanvasStore } from '../../canvas-core/src/index.js'
import { boundsOf, resourcePortalDescriptor, type Bounds, type CanvasObject, type CanvasTransaction, type TransactionResult } from '../../canvas-schema/src/index.js'
import type {
  CanvasAdapter,
  CanvasDelta,
  CanvasDeltaListener,
  CanvasQuery,
  RenderRequest,
  RenderResult,
  Viewport,
} from '../../canvas-adapter/src/index.js'

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function intersects(a: Bounds, b: Bounds): boolean {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y
}

function matchesMetadata(object: CanvasObject, expected: Record<string, unknown>): boolean {
  return Object.entries(expected).every(([key, value]) => Object.is(object.metadata[key], value))
}

function transformAttribute(object: CanvasObject): string {
  const { x, y, width, height, rotation, scaleX, scaleY } = object.transform
  const cx = x + width / 2
  const cy = y + height / 2
  const operations: string[] = []
  if (rotation !== 0) operations.push(`rotate(${rotation} ${cx} ${cy})`)
  if (scaleX !== 1 || scaleY !== 1) operations.push(`translate(${x} ${y}) scale(${scaleX} ${scaleY}) translate(${-x} ${-y})`)
  return operations.length ? ` transform="${operations.join(' ')}"` : ''
}

function styleAttributes(object: CanvasObject): string {
  const fill = object.style.fill ?? 'none'
  const stroke = object.style.stroke ?? 'none'
  const strokeWidth = object.style.strokeWidth ?? 0
  const opacity = object.style.opacity ?? 1
  return ` fill="${escapeXml(fill)}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" opacity="${opacity}"`
}

function resourcePortalToSvg(object: CanvasObject): string {
  const { x, y, width, height } = object.transform
  const portal = resourcePortalDescriptor(object)
  const title = escapeXml(object.content?.text ?? `${portal.resourceKind}`)
  const provider = escapeXml(portal.provider)
  const resource = escapeXml(portal.providerResourceId)
  const mode = escapeXml(portal.displayMode)
  const preview = object.content?.previewUri
  const previewImage = preview && (preview.startsWith('data:') || preview.startsWith('http://') || preview.startsWith('https://'))
    ? `<image x="${x + 10}" y="${y + 48}" width="${Math.max(0, width - 20)}" height="${Math.max(0, height - 82)}" href="${escapeXml(preview)}" preserveAspectRatio="xMidYMid slice" opacity="0.94" />`
    : ''
  return `<g data-object-id="${escapeXml(object.id)}" data-resource-provider="${provider}" data-resource-kind="${escapeXml(portal.resourceKind)}"${transformAttribute(object)}><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${escapeXml(object.style.fill ?? '#f8fafc')}" stroke="${escapeXml(object.style.stroke ?? '#475569')}" stroke-width="${object.style.strokeWidth ?? 2}" opacity="${object.style.opacity ?? 1}"/><rect x="${x}" y="${y}" width="${width}" height="38" rx="14" fill="#e2e8f0"/><text x="${x + 14}" y="${y + 25}" fill="#0f172a" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="700">${title}</text><text x="${x + width - 14}" y="${y + 25}" text-anchor="end" fill="#475569" font-family="Inter, system-ui, sans-serif" font-size="12">${provider} · ${mode}</text>${previewImage}<text x="${x + 14}" y="${y + height - 14}" fill="#64748b" font-family="ui-monospace, monospace" font-size="11">${resource}</text></g>`
}

function objectToSvg(object: CanvasObject): string {
  const { x, y, width, height } = object.transform
  const common = `data-object-id="${escapeXml(object.id)}"${styleAttributes(object)}${transformAttribute(object)}`

  switch (object.type) {
    case 'rectangle':
      return `<rect ${common} x="${x}" y="${y}" width="${width}" height="${height}" rx="${Number(object.metadata.cornerRadius ?? 12)}" />`
    case 'frame':
      return `<rect ${common} x="${x}" y="${y}" width="${width}" height="${height}" rx="8" stroke-dasharray="10 8" />`
    case 'ellipse':
      return `<ellipse ${common} cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" />`
    case 'line':
      return `<line ${common} x1="${x}" y1="${y}" x2="${x + width}" y2="${y + height}" />`
    case 'freehand': {
      const path = object.content?.pathData ?? `M ${x} ${y} L ${x + width} ${y + height}`
      return `<path ${common} d="${escapeXml(path)}" stroke-linecap="round" stroke-linejoin="round" />`
    }
    case 'text':
    case 'agent_note': {
      const fontSize = object.style.fontSize ?? Math.max(14, Math.min(height * 0.7, 48))
      const fontFamily = escapeXml(object.style.fontFamily ?? 'Inter, system-ui, sans-serif')
      const text = escapeXml(object.content?.text ?? '')
      const fontWeight = object.type === 'agent_note' ? 500 : Number(object.metadata.fontWeight ?? 700)
      return `<text ${common} x="${x}" y="${y + fontSize}" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}">${text}</text>`
    }
    case 'image': {
      const href = object.content?.blobUri
      if (href?.startsWith('data:') || href?.startsWith('http://') || href?.startsWith('https://')) {
        return `<image ${common} x="${x}" y="${y}" width="${width}" height="${height}" href="${escapeXml(href)}" preserveAspectRatio="xMidYMid slice" />`
      }
      return `<g data-object-id="${escapeXml(object.id)}"${transformAttribute(object)}><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="#e5e7eb" stroke="#64748b" /><path d="M ${x + 12} ${y + height - 18} L ${x + width * 0.42} ${y + height * 0.5} L ${x + width * 0.62} ${y + height * 0.72} L ${x + width - 12} ${y + height * 0.32}" fill="none" stroke="#64748b" stroke-width="3" /><circle cx="${x + width * 0.72}" cy="${y + height * 0.28}" r="8" fill="#94a3b8" /></g>`
    }
    case 'subcanvas':
      return `<g data-object-id="${escapeXml(object.id)}"${transformAttribute(object)}><rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="#f8fafc" stroke="#7c3aed" stroke-width="3" stroke-dasharray="8 6" /><text x="${x + 18}" y="${y + 34}" fill="#5b21b6" font-family="Inter, system-ui, sans-serif" font-size="18" font-weight="700">↳ ${escapeXml(object.content?.text ?? 'Subcanvas')}</text></g>`
    case 'resource_portal':
      return resourcePortalToSvg(object)
    case 'group':
      return `<rect ${common} x="${x}" y="${y}" width="${width}" height="${height}" rx="6" fill="none" stroke-dasharray="4 6" />`
    default:
      return ''
  }
}

export function renderObjectsToSvg(
  objects: CanvasObject[],
  viewport: Viewport,
  options: { background?: string; includeGrid?: boolean } = {},
): string {
  const worldWidth = viewport.width / viewport.zoom
  const worldHeight = viewport.height / viewport.zoom
  const background = escapeXml(options.background ?? '#f8fafc')
  const grid = options.includeGrid === false
    ? ''
    : `<defs><pattern id="smallGrid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M 24 0 L 0 0 0 24" fill="none" stroke="#cbd5e1" stroke-width="0.7" opacity="0.5" /></pattern><pattern id="grid" width="120" height="120" patternUnits="userSpaceOnUse"><rect width="120" height="120" fill="url(#smallGrid)"/><path d="M 120 0 L 0 0 0 120" fill="none" stroke="#94a3b8" stroke-width="1" opacity="0.55" /></pattern></defs><rect x="${viewport.x}" y="${viewport.y}" width="${worldWidth}" height="${worldHeight}" fill="url(#grid)" />`

  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${viewport.width}" height="${viewport.height}" viewBox="${viewport.x} ${viewport.y} ${worldWidth} ${worldHeight}"><rect x="${viewport.x}" y="${viewport.y}" width="${worldWidth}" height="${worldHeight}" fill="${background}" />${grid}<g>${objects.map(objectToSvg).join('')}</g></svg>`
}

export class SvgCanvasAdapter implements CanvasAdapter {
  readonly #store: CanvasStore
  #viewport: Viewport
  readonly #listeners = new Set<CanvasDeltaListener>()

  constructor(store: CanvasStore, viewport: Viewport = DEFAULT_VIEWPORT) {
    this.#store = store
    this.#viewport = structuredClone(viewport)
  }

  async getViewport(): Promise<Viewport> {
    return structuredClone(this.#viewport)
  }

  async setViewport(viewport: Viewport): Promise<void> {
    if (![viewport.x, viewport.y, viewport.width, viewport.height, viewport.zoom].every(Number.isFinite)) {
      throw new Error('Viewport values must be finite')
    }
    if (viewport.width <= 0 || viewport.height <= 0 || viewport.zoom <= 0) {
      throw new Error('Viewport width, height and zoom must be positive')
    }
    this.#viewport = structuredClone(viewport)
  }

  async listObjects(canvasId: string, query: CanvasQuery = {}): Promise<CanvasObject[]> {
    let objects = this.#store.listObjects(canvasId)
    if (query.ids) {
      const ids = new Set(query.ids)
      objects = objects.filter((object) => ids.has(object.id))
    }
    if (query.types) {
      const types = new Set(query.types)
      objects = objects.filter((object) => types.has(object.type))
    }
    if (query.bounds) objects = objects.filter((object) => intersects(boundsOf(object), query.bounds!))
    if (query.text) {
      const needle = query.text.toLocaleLowerCase()
      objects = objects.filter((object) => (object.content?.text ?? '').toLocaleLowerCase().includes(needle))
    }
    if (query.metadata) objects = objects.filter((object) => matchesMetadata(object, query.metadata!))
    return objects
  }

  async applyTransaction(transaction: CanvasTransaction): Promise<TransactionResult> {
    const result = this.#store.applyTransaction(transaction)
    const delta: CanvasDelta = {
      transactionId: result.transactionId,
      canvasId: result.canvasId,
      revision: result.revision,
      affectedObjectIds: result.affectedObjectIds,
      timestamp: new Date().toISOString(),
    }
    for (const listener of this.#listeners) listener(structuredClone(delta))
    return result
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    const viewport = request.viewport ? structuredClone(request.viewport) : await this.getViewport()
    let objects = await this.listObjects(request.canvasId)
    if (request.objectIds) {
      const ids = new Set(request.objectIds)
      objects = objects.filter((object) => ids.has(object.id))
    }
    const canvas = this.#store.getCanvas(request.canvasId)
    return {
      mimeType: 'image/svg+xml',
      svg: renderObjectsToSvg(objects, viewport, request),
      width: viewport.width,
      height: viewport.height,
      viewport,
      revision: canvas.revision,
    }
  }

  subscribe(listener: CanvasDeltaListener): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }
}

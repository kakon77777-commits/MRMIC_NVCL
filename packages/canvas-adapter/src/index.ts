import type {
  Bounds,
  CanvasObject,
  CanvasObjectType,
  CanvasTransaction,
  TransactionResult,
} from '../../canvas-schema/src/index.js'

export interface Viewport {
  x: number
  y: number
  width: number
  height: number
  zoom: number
}

export interface CanvasQuery {
  ids?: string[]
  types?: CanvasObjectType[]
  bounds?: Bounds
  text?: string
  metadata?: Record<string, unknown>
}

export interface RenderRequest {
  canvasId: string
  viewport?: Viewport
  objectIds?: string[]
  background?: string
  includeGrid?: boolean
}

export interface RenderResult {
  mimeType: 'image/svg+xml'
  svg: string
  width: number
  height: number
  viewport: Viewport
  revision: number
}

export interface CanvasDelta {
  transactionId: string
  canvasId: string
  revision: number
  affectedObjectIds: string[]
  timestamp: string
}

export type CanvasDeltaListener = (delta: CanvasDelta) => void

export interface CanvasAdapter {
  getViewport(): Promise<Viewport>
  setViewport(viewport: Viewport): Promise<void>
  listObjects(canvasId: string, query?: CanvasQuery): Promise<CanvasObject[]>
  applyTransaction(transaction: CanvasTransaction): Promise<TransactionResult>
  render(request: RenderRequest): Promise<RenderResult>
  subscribe(listener: CanvasDeltaListener): () => void
}

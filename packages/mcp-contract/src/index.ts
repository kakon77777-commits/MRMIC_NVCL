export const CANVAS_TOOLS = [
  'canvas.get_state',
  'canvas.get_viewport',
  'canvas.query_objects',
  'canvas.create_objects',
  'canvas.patch_objects',
  'canvas.delete_objects',
  'canvas.set_viewport',
  'canvas.render_viewport',
  'canvas.verify',
  'canvas.create_snapshot',
  'canvas.restore_snapshot',
  'canvas.open_subcanvas',
  'canvas.fold_subcanvas',
  'canvas.get_lineage',
  'canvas.get_events',
] as const

export type CanvasToolName = typeof CANVAS_TOOLS[number]

export const CanvasResource = {
  workspace: (workspaceId: string) => `canvas://workspace/${encodeURIComponent(workspaceId)}`,
  canvas: (workspaceId: string, canvasId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/canvas/${encodeURIComponent(canvasId)}`,
  viewport: (workspaceId: string, canvasId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/canvas/${encodeURIComponent(canvasId)}/viewport`,
  object: (workspaceId: string, objectId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/object/${encodeURIComponent(objectId)}`,
  events: (workspaceId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/events`,
  render: (workspaceId: string, canvasId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/canvas/${encodeURIComponent(canvasId)}/render/current.svg`,
  snapshot: (workspaceId: string, snapshotId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/snapshot/${encodeURIComponent(snapshotId)}`,
  trajectory: (workspaceId: string, runId: string) =>
    `canvas://workspace/${encodeURIComponent(workspaceId)}/trajectory/${encodeURIComponent(runId)}`,
} as const

export interface CanvasToolResult<T> {
  ok: boolean
  transactionId?: string
  revision?: number
  data?: T
  warnings: Array<{ code: string; message: string }>
  resourceLinks: string[]
  error?: { code: string; message: string; details?: Record<string, unknown> }
}

import { randomUUID } from 'node:crypto'
import type {
  ActorRef,
  CanvasDocument,
  CanvasObject,
  Transform2D,
  Workspace,
} from '../../../packages/canvas-schema/src/index.js'

export const agent: ActorRef = {
  actorType: 'agent',
  actorId: 'mrmic-demo-agent',
  instanceId: 'local-demo',
}

export function createWorkspace(): { workspace: Workspace; rootCanvas: CanvasDocument } {
  const now = new Date().toISOString()
  const rootCanvasId = 'canvas-root'
  return {
    workspace: {
      id: 'workspace-demo',
      title: 'MRMIC NVCL Demo',
      rootCanvasId,
      schemaVersion: '0.2.0',
      createdAt: now,
      updatedAt: now,
    },
    rootCanvas: {
      id: rootCanvasId,
      workspaceId: 'workspace-demo',
      title: 'Root canvas',
      bounds: { x: 0, y: 0, width: 1200, height: 800 },
      objectIds: [],
      revision: 0,
      createdAt: now,
      updatedAt: now,
    },
  }
}

export function object(
  id: string,
  type: CanvasObject['type'],
  transform: Partial<Transform2D>,
  metadata: Record<string, unknown> = {},
  content: CanvasObject['content'] = undefined,
): CanvasObject {
  const now = new Date().toISOString()
  return {
    id,
    canvasId: 'canvas-root',
    type,
    transform: {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      zIndex: 0,
      ...transform,
    },
    style: { fill: '#ffffff', stroke: '#111111', strokeWidth: 2, opacity: 1 },
    ...(content ? { content } : {}),
    childIds: [],
    bindings: [],
    metadata,
    createdBy: agent,
    createdAt: now,
    updatedAt: now,
    revision: 0,
  }
}

export function transactionId(): string {
  return randomUUID()
}

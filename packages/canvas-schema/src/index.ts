export type ActorType = 'user' | 'agent' | 'system'

export interface ActorRef {
  actorType: ActorType
  actorId: string
  instanceId?: string
  sessionId?: string
}

export interface Transform2D {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
  zIndex: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ObjectStyle {
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
  fontSize?: number
  fontFamily?: string
}

export interface ObjectContent {
  text?: string
  blobUri?: string
  childCanvasId?: string
  pathData?: string
  resourceUri?: string
  previewUri?: string
}

export type ResourceProvider = 'mrmic' | 'tandem' | 'herdr' | 'ai_board' | 'github' | 'ctcl' | 'external'
export type ResourceKind =
  | 'browser_tab'
  | 'browser_workspace'
  | 'browser_state_node'
  | 'terminal_agent'
  | 'terminal_pane'
  | 'ai_board_thread'
  | 'code_diff'
  | 'document'
  | 'image'
  | 'video'
  | 'artifact'
  | 'external_generic'
export type ResourcePortalDisplayMode = 'snapshot' | 'live' | 'summary' | 'hidden'
export type ResourcePortalInteractionMode = 'inspect' | 'interact' | 'control' | 'read_only'

export interface ResourcePortalDescriptor {
  portalId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  provider: ResourceProvider
  resourceKind: ResourceKind
  providerResourceId: string
  displayMode: ResourcePortalDisplayMode
  interactionMode: ResourcePortalInteractionMode
  ownerSemanticAgentId?: string
}

export type CanvasObjectType =
  | 'rectangle'
  | 'ellipse'
  | 'line'
  | 'freehand'
  | 'text'
  | 'image'
  | 'group'
  | 'frame'
  | 'subcanvas'
  | 'agent_note'
  | 'resource_portal'

export interface Binding {
  id: string
  type: 'attached_to' | 'inside' | 'points_to' | 'aligned_with' | 'subcanvas_of'
  fromId: string
  toId: string
  metadata?: Record<string, unknown>
}

export interface CanvasObject {
  id: string
  canvasId: string
  type: CanvasObjectType
  parentId?: string
  transform: Transform2D
  style: ObjectStyle
  content?: ObjectContent
  childIds: string[]
  bindings: Binding[]
  metadata: Record<string, unknown>
  createdBy: ActorRef
  createdAt: string
  updatedAt: string
  revision: number
}

export interface Workspace {
  id: string
  title: string
  rootCanvasId: string
  schemaVersion: string
  createdAt: string
  updatedAt: string
}

export interface CanvasDocument {
  id: string
  workspaceId: string
  parentCanvasId?: string
  parentObjectId?: string
  title: string
  bounds?: Bounds
  objectIds: string[]
  revision: number
  createdAt: string
  updatedAt: string
}

export interface CreateObjectOperation {
  op: 'create_object'
  object: CanvasObject
}

export interface PatchObjectOperation {
  op: 'patch_object'
  objectId: string
  expectedRevision: number
  patch: {
    transform?: Partial<Transform2D>
    style?: Partial<ObjectStyle>
    content?: Partial<ObjectContent>
    metadata?: Record<string, unknown>
  }
}

export interface DeleteObjectOperation {
  op: 'delete_object'
  objectId: string
  expectedRevision: number
}

export interface ReorderObjectOperation {
  op: 'reorder_object'
  objectId: string
  expectedRevision: number
  zIndex: number
}

export interface CreateSubcanvasOperation {
  op: 'create_subcanvas'
  object: CanvasObject
  canvas: CanvasDocument
}

export type CanvasOperation =
  | CreateObjectOperation
  | PatchObjectOperation
  | DeleteObjectOperation
  | ReorderObjectOperation
  | CreateSubcanvasOperation

export interface TransactionPrecondition {
  type: 'canvas_revision' | 'object_exists' | 'object_revision'
  targetId: string
  expected?: number | boolean
}

export interface CanvasTransaction {
  id: string
  canvasId: string
  actor: ActorRef
  intent: string
  expectedOutcome?: string
  preconditions: TransactionPrecondition[]
  operations: CanvasOperation[]
  mode: 'direct' | 'proposal' | 'branch'
  createdAt: string
  idempotencyKey?: string
}

export interface CanvasEvent {
  eventId: string
  workspaceId: string
  canvasId: string
  transactionId: string
  actor: ActorRef
  eventType: 'transaction_committed' | 'transaction_rolled_back'
  objectIds: string[]
  intent: string
  payload: Record<string, unknown>
  beforeHash: string
  afterHash: string
  createdAt: string
}

export interface TransactionResult {
  ok: true
  transactionId: string
  canvasId: string
  revision: number
  affectedObjectIds: string[]
  beforeHash: string
  afterHash: string
}

export class SchemaValidationError extends Error {
  readonly issues: string[]

  constructor(issues: string[]) {
    super(`Schema validation failed: ${issues.join('; ')}`)
    this.name = 'SchemaValidationError'
    this.issues = issues
  }
}

const objectTypes = new Set<CanvasObjectType>([
  'rectangle', 'ellipse', 'line', 'freehand', 'text', 'image',
  'group', 'frame', 'subcanvas', 'agent_note', 'resource_portal',
])
const resourceProviders = new Set<ResourceProvider>(['mrmic', 'tandem', 'herdr', 'ai_board', 'github', 'ctcl', 'external'])
const resourceKinds = new Set<ResourceKind>([
  'browser_tab', 'browser_workspace', 'browser_state_node', 'terminal_agent', 'terminal_pane',
  'ai_board_thread', 'code_diff', 'document', 'image', 'video', 'artifact', 'external_generic',
])
const portalDisplayModes = new Set<ResourcePortalDisplayMode>(['snapshot', 'live', 'summary', 'hidden'])
const portalInteractionModes = new Set<ResourcePortalInteractionMode>(['inspect', 'interact', 'control', 'read_only'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertFiniteNumber(value: unknown, label: string, issues: string[]): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) issues.push(`${label} must be finite`)
}

function requiredString(value: unknown, label: string, issues: string[]): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issues.push(`${label} is required`)
    return ''
  }
  return value.trim()
}

export function validateActorRef(value: unknown): asserts value is ActorRef {
  const issues: string[] = []
  if (!isRecord(value)) throw new SchemaValidationError(['actor must be an object'])
  if (!['user', 'agent', 'system'].includes(String(value.actorType))) issues.push('actorType is invalid')
  if (typeof value.actorId !== 'string' || value.actorId.length === 0) issues.push('actorId is required')
  if (issues.length) throw new SchemaValidationError(issues)
}

export function validateResourcePortalDescriptor(value: unknown): asserts value is ResourcePortalDescriptor {
  const issues: string[] = []
  if (!isRecord(value)) throw new SchemaValidationError(['resource portal descriptor must be an object'])
  requiredString(value.portalId, 'portalId', issues)
  requiredString(value.pmwWorkspaceId, 'pmwWorkspaceId', issues)
  const provider = requiredString(value.provider, 'provider', issues) as ResourceProvider
  const resourceKind = requiredString(value.resourceKind, 'resourceKind', issues) as ResourceKind
  requiredString(value.providerResourceId, 'providerResourceId', issues)
  const displayMode = requiredString(value.displayMode, 'displayMode', issues) as ResourcePortalDisplayMode
  const interactionMode = requiredString(value.interactionMode, 'interactionMode', issues) as ResourcePortalInteractionMode
  if (provider && !resourceProviders.has(provider)) issues.push('provider is invalid')
  if (resourceKind && !resourceKinds.has(resourceKind)) issues.push('resourceKind is invalid')
  if (displayMode && !portalDisplayModes.has(displayMode)) issues.push('displayMode is invalid')
  if (interactionMode && !portalInteractionModes.has(interactionMode)) issues.push('interactionMode is invalid')
  if (value.pmwTaskId !== undefined && (typeof value.pmwTaskId !== 'string' || !value.pmwTaskId.trim())) issues.push('pmwTaskId must be a non-empty string when supplied')
  if (value.ownerSemanticAgentId !== undefined && (typeof value.ownerSemanticAgentId !== 'string' || !value.ownerSemanticAgentId.trim())) issues.push('ownerSemanticAgentId must be a non-empty string when supplied')
  if (issues.length) throw new SchemaValidationError(issues)
}

export function resourcePortalDescriptor(object: CanvasObject): ResourcePortalDescriptor {
  if (object.type !== 'resource_portal') throw new SchemaValidationError(['object is not a resource_portal'])
  const descriptor = object.metadata.portal
  validateResourcePortalDescriptor(descriptor)
  return structuredClone(descriptor)
}

export function validateCanvasObject(value: unknown): asserts value is CanvasObject {
  const issues: string[] = []
  if (!isRecord(value)) throw new SchemaValidationError(['object must be a record'])
  if (typeof value.id !== 'string' || value.id.length === 0) issues.push('id is required')
  if (typeof value.canvasId !== 'string' || value.canvasId.length === 0) issues.push('canvasId is required')
  if (!objectTypes.has(value.type as CanvasObjectType)) issues.push('type is invalid')
  if (!isRecord(value.transform)) {
    issues.push('transform is required')
  } else {
    for (const key of ['x','y','width','height','rotation','scaleX','scaleY','zIndex'] as const) {
      assertFiniteNumber(value.transform[key], `transform.${key}`, issues)
    }
    if (typeof value.transform.width === 'number' && value.transform.width < 0) issues.push('width cannot be negative')
    if (typeof value.transform.height === 'number' && value.transform.height < 0) issues.push('height cannot be negative')
  }
  if (!isRecord(value.style)) issues.push('style must be an object')
  if (!Array.isArray(value.childIds)) issues.push('childIds must be an array')
  if (!Array.isArray(value.bindings)) issues.push('bindings must be an array')
  if (!isRecord(value.metadata)) issues.push('metadata must be an object')
  if (value.type === 'resource_portal') {
    if (!isRecord(value.metadata)) {
      issues.push('resource_portal metadata is required')
    } else {
      try { validateResourcePortalDescriptor(value.metadata.portal) } catch (error) {
        issues.push(error instanceof Error ? error.message : 'resource portal descriptor is invalid')
      }
    }
  }
  if (!Number.isInteger(value.revision) || Number(value.revision) < 0) issues.push('revision must be a non-negative integer')
  try { validateActorRef(value.createdBy) } catch (error) {
    issues.push(error instanceof Error ? error.message : 'createdBy is invalid')
  }
  if (issues.length) throw new SchemaValidationError(issues)
}

export function validateCanvasTransaction(value: unknown): asserts value is CanvasTransaction {
  const issues: string[] = []
  if (!isRecord(value)) throw new SchemaValidationError(['transaction must be a record'])
  if (typeof value.id !== 'string' || value.id.length === 0) issues.push('transaction id is required')
  if (typeof value.canvasId !== 'string' || value.canvasId.length === 0) issues.push('canvasId is required')
  if (typeof value.intent !== 'string' || value.intent.length === 0) issues.push('intent is required')
  if (!['direct','proposal','branch'].includes(String(value.mode))) issues.push('mode is invalid')
  if (!Array.isArray(value.operations) || value.operations.length === 0) issues.push('at least one operation is required')
  if (!Array.isArray(value.preconditions)) issues.push('preconditions must be an array')
  try { validateActorRef(value.actor) } catch (error) {
    issues.push(error instanceof Error ? error.message : 'actor is invalid')
  }
  if (Array.isArray(value.operations)) {
    for (const [index, operation] of value.operations.entries()) {
      if (!isRecord(operation) || typeof operation.op !== 'string') {
        issues.push(`operations[${index}] is invalid`)
        continue
      }
      if (operation.op === 'create_object') {
        try { validateCanvasObject(operation.object) } catch (error) {
          issues.push(`operations[${index}]: ${error instanceof Error ? error.message : 'invalid object'}`)
        }
      }
    }
  }
  if (issues.length) throw new SchemaValidationError(issues)
}

export function boundsOf(object: CanvasObject): Bounds {
  return {
    x: object.transform.x,
    y: object.transform.y,
    width: object.transform.width * object.transform.scaleX,
    height: object.transform.height * object.transform.scaleY,
  }
}

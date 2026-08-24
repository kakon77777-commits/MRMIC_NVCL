import type { ActorRef, CanvasObject, Transform2D } from '../../canvas-schema/src/index.js'
import { validateCanvasObject } from '../../canvas-schema/src/index.js'

export type HerdrAgentStatus = 'idle' | 'working' | 'blocked' | 'done' | 'unknown'

export interface HerdrAgentSessionInfo {
  source: string
  agent: string
  kind: string
  value: string
}

/** Structural subset of Herdr v0.8 AgentInfo used by the Visual World adapter. */
export interface HerdrAgentInfo {
  terminal_id: string
  name?: string
  agent?: string
  title?: string
  terminal_title?: string
  terminal_title_stripped?: string
  display_agent?: string
  agent_status: HerdrAgentStatus
  screen_detection_skipped?: boolean
  state_labels?: Record<string, string>
  tokens?: Record<string, string>
  agent_session?: HerdrAgentSessionInfo
  workspace_id: string
  tab_id: string
  pane_id: string
  focused: boolean
  launch_pending?: boolean
  interactive_ready?: boolean
  state_change_seq: number
  cwd?: string
  foreground_cwd?: string
  revision: number
}

export interface CreateHerdrAgentPortalInput {
  info: HerdrAgentInfo
  semanticAgentId: string
  portalId: string
  canvasId: string
  pmwWorkspaceId: string
  pmwTaskId?: string
  actor: ActorRef
  transform?: Partial<Transform2D>
  createdAt?: string
}

export interface HerdrRuntimeProjection {
  runtimeEpochId: string
  semanticAgentId: string
  provider: 'herdr'
  providerResourceId: string
  resourceUri: string
  displayName: string
  agentKind?: string
  status: HerdrAgentStatus
  focused: boolean
  launchPending: boolean
  interactiveReady: boolean
  stateChangeSeq: number
  revision: number
  coordinates: {
    workspaceId: string
    tabId: string
    paneId: string
  }
  nativeSession?: HerdrAgentSessionInfo
  cwd?: string
  foregroundCwd?: string
}

export interface RuntimeProjectionApplyResult {
  accepted: boolean
  state: HerdrRuntimeProjection
  reason?: 'stale_revision' | 'stale_state_change_seq'
}

const statuses = new Set<HerdrAgentStatus>(['idle', 'working', 'blocked', 'done', 'unknown'])

function required(value: string | undefined, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function assertInfo(info: HerdrAgentInfo): void {
  required(info.terminal_id, 'terminal_id')
  required(info.workspace_id, 'workspace_id')
  required(info.tab_id, 'tab_id')
  required(info.pane_id, 'pane_id')
  if (!statuses.has(info.agent_status)) throw new Error(`Unsupported Herdr agent status: ${String(info.agent_status)}`)
  if (!Number.isInteger(info.state_change_seq) || info.state_change_seq < 0) throw new Error('state_change_seq must be a non-negative integer')
  if (!Number.isInteger(info.revision) || info.revision < 0) throw new Error('revision must be a non-negative integer')
}

function resourceUri(terminalId: string): string {
  return `herdr://agent/${encodeURIComponent(terminalId)}`
}

function displayName(info: HerdrAgentInfo): string {
  return info.name?.trim()
    || info.title?.trim()
    || info.display_agent?.trim()
    || info.agent?.trim()
    || info.terminal_id
}

/**
 * Create a stable Canvas projection of a Herdr agent runtime resource.
 *
 * Deliberately excluded from Canvas canonical metadata: agent_status,
 * workspace/tab/pane coordinates, cwd, focused, state_change_seq and revision.
 * Those values belong to Herdr runtime truth and are projected ephemerally by
 * HerdrRuntimeProjectionRegistry instead of becoming Canvas history.
 */
export function createHerdrAgentPortal(input: CreateHerdrAgentPortalInput): CanvasObject {
  assertInfo(input.info)
  const semanticAgentId = required(input.semanticAgentId, 'semanticAgentId')
  const portalId = required(input.portalId, 'portalId')
  const canvasId = required(input.canvasId, 'canvasId')
  const pmwWorkspaceId = required(input.pmwWorkspaceId, 'pmwWorkspaceId')
  const terminalId = input.info.terminal_id
  const timestamp = input.createdAt ?? new Date().toISOString()
  const transform: Transform2D = {
    x: input.transform?.x ?? 0,
    y: input.transform?.y ?? 0,
    width: input.transform?.width ?? 360,
    height: input.transform?.height ?? 180,
    rotation: input.transform?.rotation ?? 0,
    scaleX: input.transform?.scaleX ?? 1,
    scaleY: input.transform?.scaleY ?? 1,
    zIndex: input.transform?.zIndex ?? 1,
  }
  const kind = input.info.agent?.trim() || input.info.display_agent?.trim() || undefined

  const object: CanvasObject = {
    id: `portal:${portalId}`,
    canvasId,
    type: 'resource_portal',
    transform,
    style: { fill: '#f8fafc', stroke: '#334155', strokeWidth: 2, opacity: 1 },
    content: {
      text: displayName(input.info),
      resourceUri: resourceUri(terminalId),
    },
    childIds: [],
    bindings: [],
    metadata: {
      portal: {
        portalId,
        pmwWorkspaceId,
        ...(input.pmwTaskId ? { pmwTaskId: input.pmwTaskId } : {}),
        provider: 'herdr',
        resourceKind: 'terminal_agent',
        providerResourceId: terminalId,
        displayMode: 'summary',
        interactionMode: 'inspect',
        ownerSemanticAgentId: semanticAgentId,
      },
      providerRef: {
        resourceUri: resourceUri(terminalId),
        terminalId,
        ...(kind ? { agentKind: kind } : {}),
        ...(input.info.agent_session ? { nativeSessionRef: {
          source: input.info.agent_session.source,
          agent: input.info.agent_session.agent,
          kind: input.info.agent_session.kind,
          value: input.info.agent_session.value,
        } } : {}),
      },
    },
    createdBy: structuredClone(input.actor),
    createdAt: timestamp,
    updatedAt: timestamp,
    revision: 0,
  }
  validateCanvasObject(object)
  return object
}

export function toHerdrRuntimeProjection(
  info: HerdrAgentInfo,
  semanticAgentId: string,
  runtimeEpochId: string,
): HerdrRuntimeProjection {
  assertInfo(info)
  const semantic = required(semanticAgentId, 'semanticAgentId')
  const epoch = required(runtimeEpochId, 'runtimeEpochId')
  return {
    runtimeEpochId: epoch,
    semanticAgentId: semantic,
    provider: 'herdr',
    providerResourceId: info.terminal_id,
    resourceUri: resourceUri(info.terminal_id),
    displayName: displayName(info),
    ...(info.agent || info.display_agent ? { agentKind: info.agent ?? info.display_agent } : {}),
    status: info.agent_status,
    focused: info.focused,
    launchPending: info.launch_pending ?? false,
    interactiveReady: info.interactive_ready ?? false,
    stateChangeSeq: info.state_change_seq,
    revision: info.revision,
    coordinates: {
      workspaceId: info.workspace_id,
      tabId: info.tab_id,
      paneId: info.pane_id,
    },
    ...(info.agent_session ? { nativeSession: structuredClone(info.agent_session) } : {}),
    ...(info.cwd ? { cwd: info.cwd } : {}),
    ...(info.foreground_cwd ? { foregroundCwd: info.foreground_cwd } : {}),
  }
}

/**
 * Ephemeral Herdr runtime truth cache. A new runtime epoch may reset Herdr
 * revision counters; inside one epoch, stale revision/sequence updates are
 * rejected so an older event cannot overwrite a newer visual runtime state.
 */
export class HerdrRuntimeProjectionRegistry {
  readonly #bySemanticAgent = new Map<string, HerdrRuntimeProjection>()

  get(semanticAgentId: string): HerdrRuntimeProjection | null {
    const state = this.#bySemanticAgent.get(semanticAgentId)
    return state ? structuredClone(state) : null
  }

  list(): HerdrRuntimeProjection[] {
    return [...this.#bySemanticAgent.values()].map(item => structuredClone(item))
  }

  apply(info: HerdrAgentInfo, semanticAgentId: string, runtimeEpochId: string): RuntimeProjectionApplyResult {
    const next = toHerdrRuntimeProjection(info, semanticAgentId, runtimeEpochId)
    const current = this.#bySemanticAgent.get(next.semanticAgentId)
    if (current && current.runtimeEpochId === next.runtimeEpochId) {
      if (next.revision < current.revision) {
        return { accepted: false, state: structuredClone(current), reason: 'stale_revision' }
      }
      if (next.revision === current.revision && next.stateChangeSeq < current.stateChangeSeq) {
        return { accepted: false, state: structuredClone(current), reason: 'stale_state_change_seq' }
      }
    }
    this.#bySemanticAgent.set(next.semanticAgentId, structuredClone(next))
    return { accepted: true, state: structuredClone(next) }
  }

  remove(semanticAgentId: string): boolean {
    return this.#bySemanticAgent.delete(semanticAgentId)
  }
}

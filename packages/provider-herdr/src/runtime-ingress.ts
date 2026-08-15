import type { RuntimePresenceInput } from '../../runtime-presence/src/index.js'
import type { HerdrAgentInfo } from './index.js'

function required(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

/**
 * Canonical Herdr v0.8 AgentInfo -> MRMIC ephemeral runtime ingress mapping.
 *
 * Semantic/principal identity is intentionally absent. The secure Canvas
 * binding token supplies that identity at transport time.
 */
export function herdrAgentInfoToRuntimePresence(
  info: HerdrAgentInfo,
  runtimeEpochId: string,
): RuntimePresenceInput {
  const providerResourceId = required(info.terminal_id, 'terminal_id')
  const epoch = required(runtimeEpochId, 'runtimeEpochId')
  if (!Number.isInteger(info.revision) || info.revision < 0) throw new Error('revision must be a non-negative integer')
  if (!Number.isInteger(info.state_change_seq) || info.state_change_seq < 0) throw new Error('state_change_seq must be a non-negative integer')
  return {
    provider: 'herdr',
    providerResourceId,
    runtimeEpochId: epoch,
    status: info.agent_status,
    revision: info.revision,
    sequence: info.state_change_seq,
    ...(info.agent || info.display_agent ? { kind: info.agent ?? info.display_agent } : {}),
    focused: info.focused,
    interactiveReady: info.interactive_ready ?? false,
    launchPending: info.launch_pending ?? false,
    coordinates: {
      workspaceId: required(info.workspace_id, 'workspace_id'),
      tabId: required(info.tab_id, 'tab_id'),
      paneId: required(info.pane_id, 'pane_id'),
    },
  }
}

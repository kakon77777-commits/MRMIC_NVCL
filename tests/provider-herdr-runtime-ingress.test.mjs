import test from 'node:test'
import assert from 'node:assert/strict'
import { herdrAgentInfoToRuntimePresence } from '../dist/packages/provider-herdr/src/runtime-ingress.js'

function info(overrides = {}) {
  return {
    terminal_id: 'terminal-claude',
    name: 'Claude Researcher',
    agent: 'claude',
    display_agent: 'Claude',
    agent_status: 'blocked',
    workspace_id: 'herdr-ws', tab_id: 'tab-claude', pane_id: 'pane-claude',
    focused: false, launch_pending: false, interactive_ready: true,
    state_change_seq: 17, revision: 12,
    cwd: '/private/provider/path', foreground_cwd: '/private/provider/path/project',
    ...overrides,
  }
}

test('Herdr AgentInfo maps exactly into provider runtime facts for secure Canvas ingress', () => {
  assert.deepEqual(herdrAgentInfoToRuntimePresence(info(), 'runtime-epoch-1'), {
    provider: 'herdr',
    providerResourceId: 'terminal-claude',
    runtimeEpochId: 'runtime-epoch-1',
    status: 'blocked',
    revision: 12,
    sequence: 17,
    kind: 'claude',
    focused: false,
    interactiveReady: true,
    launchPending: false,
    coordinates: { workspaceId: 'herdr-ws', tabId: 'tab-claude', paneId: 'pane-claude' },
  })
})

test('Herdr ingress mapping excludes semantic identity and unnecessary provider-local paths', () => {
  const mapped = herdrAgentInfoToRuntimePresence({
    ...info(),
    semanticAgentId: 'user:neo',
    principalId: 'principal:forged',
  }, 'epoch-1')
  assert.equal('semanticAgentId' in mapped, false)
  assert.equal('principalId' in mapped, false)
  assert.equal('cwd' in mapped, false)
  assert.equal('foregroundCwd' in mapped, false)
})

test('Herdr ingress mapping preserves reset counters only when caller supplies a new runtime epoch', () => {
  const reset = herdrAgentInfoToRuntimePresence(info({ revision: 1, state_change_seq: 1, agent_status: 'idle' }), 'epoch-after-handoff')
  assert.equal(reset.runtimeEpochId, 'epoch-after-handoff')
  assert.equal(reset.revision, 1)
  assert.equal(reset.sequence, 1)
  assert.equal(reset.status, 'idle')
})

test('Herdr ingress mapping fails closed for missing runtime coordinates or counters', () => {
  assert.throws(() => herdrAgentInfoToRuntimePresence(info({ terminal_id: '' }), 'epoch-1'), /terminal_id/)
  assert.throws(() => herdrAgentInfoToRuntimePresence(info({ workspace_id: '' }), 'epoch-1'), /workspace_id/)
  assert.throws(() => herdrAgentInfoToRuntimePresence(info({ revision: -1 }), 'epoch-1'), /revision/)
  assert.throws(() => herdrAgentInfoToRuntimePresence(info({ state_change_seq: 1.5 }), 'epoch-1'), /state_change_seq/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { resourcePortalDescriptor, validateCanvasObject } from '../dist/packages/canvas-schema/src/index.js'
import {
  HerdrRuntimeProjectionRegistry,
  createHerdrAgentPortal,
  toHerdrRuntimeProjection,
} from '../dist/packages/provider-herdr/src/index.js'

const actor = { actorType: 'system', actorId: 'pmw-fabric' }

function info(overrides = {}) {
  return {
    terminal_id: 'terminal-claude-1',
    name: 'Claude Researcher',
    agent: 'claude',
    title: 'Claude Researcher',
    display_agent: 'Claude',
    agent_status: 'working',
    agent_session: { source: 'claude', agent: 'claude', kind: 'native', value: 'session-123' },
    workspace_id: 'herdr-ws-1',
    tab_id: 'herdr-tab-1',
    pane_id: 'herdr-pane-1',
    focused: true,
    launch_pending: false,
    interactive_ready: true,
    state_change_seq: 7,
    cwd: '/workspace/research',
    foreground_cwd: '/workspace/research/project',
    revision: 12,
    ...overrides,
  }
}

test('Herdr AgentInfo becomes a stable terminal_agent Canvas portal', () => {
  const object = createHerdrAgentPortal({
    info: info(),
    semanticAgentId: 'agent:claude-main',
    portalId: 'portal-claude',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    pmwTaskId: 'pmw-task-1',
    actor,
    createdAt: '2026-08-15T00:00:00.000Z',
  })
  assert.doesNotThrow(() => validateCanvasObject(object))
  assert.equal(object.content.resourceUri, 'herdr://agent/terminal-claude-1')
  assert.deepEqual(resourcePortalDescriptor(object), {
    portalId: 'portal-claude',
    pmwWorkspaceId: 'pmw-ws-1',
    pmwTaskId: 'pmw-task-1',
    provider: 'herdr',
    resourceKind: 'terminal_agent',
    providerResourceId: 'terminal-claude-1',
    displayMode: 'summary',
    interactionMode: 'inspect',
    ownerSemanticAgentId: 'agent:claude-main',
  })
})

test('Canvas portal excludes volatile Herdr runtime truth from canonical metadata', () => {
  const object = createHerdrAgentPortal({
    info: info(),
    semanticAgentId: 'agent:claude-main',
    portalId: 'portal-claude',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    actor,
  })
  const metadata = JSON.stringify(object.metadata)
  assert.equal(metadata.includes('"working"'), false)
  assert.equal(metadata.includes('herdr-pane-1'), false)
  assert.equal(metadata.includes('/workspace/research'), false)
  assert.equal(metadata.includes('state_change_seq'), false)
  assert.equal(metadata.includes('"revision"'), false)
  assert.equal(metadata.includes('terminal-claude-1'), true)
  assert.equal(metadata.includes('session-123'), true)
})

test('runtime projection keeps Herdr status and coordinates ephemeral', () => {
  const state = toHerdrRuntimeProjection(info(), 'agent:claude-main', 'epoch-1')
  assert.equal(state.status, 'working')
  assert.equal(state.focused, true)
  assert.equal(state.interactiveReady, true)
  assert.equal(state.stateChangeSeq, 7)
  assert.equal(state.revision, 12)
  assert.deepEqual(state.coordinates, {
    workspaceId: 'herdr-ws-1',
    tabId: 'herdr-tab-1',
    paneId: 'herdr-pane-1',
  })
})

test('runtime registry rejects stale revisions inside one Herdr epoch', () => {
  const registry = new HerdrRuntimeProjectionRegistry()
  registry.apply(info({ revision: 10, state_change_seq: 10, agent_status: 'working' }), 'agent:claude-main', 'epoch-1')
  const stale = registry.apply(info({ revision: 9, state_change_seq: 99, agent_status: 'done' }), 'agent:claude-main', 'epoch-1')
  assert.equal(stale.accepted, false)
  assert.equal(stale.reason, 'stale_revision')
  assert.equal(stale.state.status, 'working')
})

test('runtime registry rejects lower state_change_seq at equal revision', () => {
  const registry = new HerdrRuntimeProjectionRegistry()
  registry.apply(info({ revision: 10, state_change_seq: 10 }), 'agent:claude-main', 'epoch-1')
  const stale = registry.apply(info({ revision: 10, state_change_seq: 9, agent_status: 'blocked' }), 'agent:claude-main', 'epoch-1')
  assert.equal(stale.accepted, false)
  assert.equal(stale.reason, 'stale_state_change_seq')
})

test('new Herdr runtime epoch accepts reset revision counters', () => {
  const registry = new HerdrRuntimeProjectionRegistry()
  registry.apply(info({ revision: 100, state_change_seq: 100, agent_status: 'done' }), 'agent:claude-main', 'epoch-old')
  const restarted = registry.apply(info({ revision: 1, state_change_seq: 1, agent_status: 'idle' }), 'agent:claude-main', 'epoch-new')
  assert.equal(restarted.accepted, true)
  assert.equal(restarted.state.runtimeEpochId, 'epoch-new')
  assert.equal(restarted.state.revision, 1)
  assert.equal(restarted.state.status, 'idle')
})

test('unsupported Herdr status fails closed', () => {
  assert.throws(() => toHerdrRuntimeProjection(
    info({ agent_status: 'sleeping' }),
    'agent:claude-main',
    'epoch-1',
  ), /Unsupported Herdr agent status/)
})

test('semantic agent identity is mandatory and independent from terminal identity', () => {
  assert.throws(() => createHerdrAgentPortal({
    info: info(),
    semanticAgentId: '',
    portalId: 'portal-claude',
    canvasId: 'canvas-root',
    pmwWorkspaceId: 'pmw-ws-1',
    actor,
  }), /semanticAgentId is required/)
})

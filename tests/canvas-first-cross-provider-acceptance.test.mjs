import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasStore } from '../dist/packages/canvas-core/src/index.js'
import { resourcePortalDescriptor } from '../dist/packages/canvas-schema/src/index.js'
import { createTandemBrowserPortal } from '../dist/packages/provider-tandem/src/index.js'
import { createHerdrAgentPortal, HerdrRuntimeProjectionRegistry } from '../dist/packages/provider-herdr/src/index.js'
import { CanvasLivePortalCoordinator, LivePortalHostRegistry } from '../dist/packages/portal-overlay/src/runtime.js'
import { LiveSurfaceBudget } from '../dist/packages/portal-overlay/src/index.js'

const timestamp = '2026-08-15T00:00:00.000Z'
const systemActor = { actorType: 'system', actorId: 'pmw-fabric' }

function setupStore() {
  const workspace = { id: 'mrmic-ws', title: 'PMW Shared Canvas', rootCanvasId: 'root', schemaVersion: '0.13.3', createdAt: timestamp, updatedAt: timestamp }
  const root = { id: 'root', workspaceId: 'mrmic-ws', title: 'Root', objectIds: [], revision: 0, createdAt: timestamp, updatedAt: timestamp }
  return new CanvasStore(workspace, root)
}

function tandemResource(id, webContentsId) {
  const uri = `tandem://browser/tab/${id}`
  return {
    provider: 'tandem', resourceKind: 'browser_tab', providerResourceId: id, resourceUri: uri,
    title: `Browser ${id}`, url: `https://example.com/${id}`, workspaceId: 'tandem-ws', webContentsId,
    partition: 'persist:tandem', source: 'ai',
    state: { mounted: true, loading: false, focused: false, visible: true, legacyFocusVisibilityCoupled: false },
    projection: { preferredDisplayMode: 'live', previewUri: `${uri}/preview.png`, liveMountUri: `${uri}/live`, liveMountKind: 'electron-webview' },
    capabilities: ['snapshot', 'live', 'navigate', 'dom', 'mcp', 'session_state'],
  }
}

function herdrInfo(terminalId, agent, status, revision = 1, seq = 1) {
  return {
    terminal_id: terminalId,
    name: agent === 'claude' ? 'Claude Researcher' : 'Codex Reviewer',
    agent,
    display_agent: agent,
    agent_status: status,
    workspace_id: 'herdr-ws', tab_id: `tab-${agent}`, pane_id: `pane-${agent}`,
    focused: false, launch_pending: false, interactive_ready: true,
    state_change_seq: seq, revision,
  }
}

function agentNote(id, actorId, semanticAgentId, text, x, y) {
  return {
    id, canvasId: 'root', type: 'agent_note',
    transform: { x, y, width: 360, height: 100, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 20 },
    style: { fill: '#ffffff', stroke: '#64748b', strokeWidth: 1, opacity: 1, fontSize: 18 },
    content: { text }, childIds: [], bindings: [], metadata: { semanticAgentId },
    createdBy: { actorType: 'agent', actorId }, createdAt: timestamp, updatedAt: timestamp, revision: 0,
  }
}

function fakeLiveHost() {
  const events = []
  return {
    events,
    host: {
      mount: async (handle, rect) => events.push({ type: 'mount', handle: structuredClone(handle), rect: structuredClone(rect) }),
      update: async (handle, rect) => events.push({ type: 'update', handle: structuredClone(handle), rect: structuredClone(rect) }),
      unmount: async handle => events.push({ type: 'unmount', handle: structuredClone(handle) }),
    },
  }
}

test('Canvas-first PMW contract holds Tandem resources, Herdr agents and agent notes in one shared visual world', async () => {
  const store = setupStore()
  const claudeBrowser = createTandemBrowserPortal({
    resource: tandemResource('tab-browser-claude', 101), portalId: 'browser-claude', canvasId: 'root',
    pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task-research', ownerSemanticAgentId: 'agent:claude-main',
    actor: systemActor, displayMode: 'live', interactionMode: 'control',
    transform: { x: 40, y: 260, width: 520, height: 360, zIndex: 5 }, createdAt: timestamp,
  })
  const codexBrowser = createTandemBrowserPortal({
    resource: tandemResource('tab-browser-codex', 102), portalId: 'browser-codex', canvasId: 'root',
    pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task-research', ownerSemanticAgentId: 'agent:codex-reviewer',
    actor: systemActor, displayMode: 'live', interactionMode: 'control',
    transform: { x: 600, y: 260, width: 520, height: 360, zIndex: 6 }, createdAt: timestamp,
  })
  const claudeAgent = createHerdrAgentPortal({
    info: herdrInfo('terminal-claude', 'claude', 'working'), semanticAgentId: 'agent:claude-main',
    portalId: 'agent-claude', canvasId: 'root', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task-research',
    actor: systemActor, transform: { x: 40, y: 40, width: 360, height: 140, zIndex: 10 }, createdAt: timestamp,
  })
  const codexAgent = createHerdrAgentPortal({
    info: herdrInfo('terminal-codex', 'codex', 'idle'), semanticAgentId: 'agent:codex-reviewer',
    portalId: 'agent-codex', canvasId: 'root', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task-research',
    actor: systemActor, transform: { x: 440, y: 40, width: 360, height: 140, zIndex: 11 }, createdAt: timestamp,
  })
  const claudeNote = agentNote('note-claude', 'mrmic:claude-binding', 'agent:claude-main', 'Hypothesis from browser A', 40, 660)
  const codexNote = agentNote('note-codex', 'mrmic:codex-binding', 'agent:codex-reviewer', 'Independent verification from browser B', 600, 660)

  store.applyTransaction({
    id: 'tx-shared-world', canvasId: 'root', actor: systemActor, intent: 'Project two agents and two independent browser resources into one PMW Canvas',
    preconditions: [{ type: 'canvas_revision', targetId: 'root', expected: 0 }],
    operations: [claudeAgent, codexAgent, claudeBrowser, codexBrowser, claudeNote, codexNote].map(object => ({ op: 'create_object', object })),
    mode: 'direct', createdAt: timestamp, idempotencyKey: 'shared-world-v1',
  })

  assert.equal(store.getCanvas('root').revision, 1)
  assert.equal(store.listObjects('root').length, 6)
  assert.equal(resourcePortalDescriptor(store.getObject(claudeAgent.id)).ownerSemanticAgentId, 'agent:claude-main')
  assert.equal(resourcePortalDescriptor(store.getObject(codexAgent.id)).ownerSemanticAgentId, 'agent:codex-reviewer')
  assert.equal(resourcePortalDescriptor(store.getObject(claudeBrowser.id)).provider, 'tandem')
  assert.equal(resourcePortalDescriptor(store.getObject(codexBrowser.id)).provider, 'tandem')

  const live = fakeLiveHost()
  const hosts = new LivePortalHostRegistry()
  hosts.register('tandem', live.host)
  const coordinator = new CanvasLivePortalCoordinator(hosts, new LiveSurfaceBudget(2))
  const viewport = { x: 0, y: 0, width: 1200, height: 800, zoom: 1 }
  const clientRect = { left: 0, top: 0, width: 1200, height: 800 }
  await coordinator.activate(store.getObject(claudeBrowser.id), viewport, clientRect)
  await coordinator.activate(store.getObject(codexBrowser.id), viewport, clientRect)
  assert.deepEqual(new Set(coordinator.activePortalObjectIds()), new Set([claudeBrowser.id, codexBrowser.id]))
  assert.equal(live.events.filter(event => event.type === 'mount').length, 2)

  const runtimeRevisionBefore = store.getCanvas('root').revision
  const runtime = new HerdrRuntimeProjectionRegistry()
  runtime.apply(herdrInfo('terminal-claude', 'claude', 'working', 3, 5), 'agent:claude-main', 'herdr-epoch-1')
  runtime.apply(herdrInfo('terminal-codex', 'codex', 'idle', 2, 2), 'agent:codex-reviewer', 'herdr-epoch-1')
  runtime.apply(herdrInfo('terminal-claude', 'claude', 'blocked', 4, 6), 'agent:claude-main', 'herdr-epoch-1')
  runtime.apply(herdrInfo('terminal-codex', 'codex', 'done', 3, 3), 'agent:codex-reviewer', 'herdr-epoch-1')

  assert.equal(runtime.get('agent:claude-main').status, 'blocked')
  assert.equal(runtime.get('agent:codex-reviewer').status, 'done')
  assert.equal(store.getCanvas('root').revision, runtimeRevisionBefore, 'Herdr runtime state must not rewrite Canvas canonical history')
})

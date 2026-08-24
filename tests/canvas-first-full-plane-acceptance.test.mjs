import test from 'node:test'
import assert from 'node:assert/strict'
import { CanvasStore } from '../dist/packages/canvas-core/src/index.js'
import { resourcePortalDescriptor } from '../dist/packages/canvas-schema/src/index.js'
import { createTandemBrowserPortal } from '../dist/packages/provider-tandem/src/index.js'
import { createHerdrAgentPortal, HerdrRuntimeProjectionRegistry } from '../dist/packages/provider-herdr/src/index.js'
import { createAiBoardThreadPortal, AiBoardThreadProjectionRegistry } from '../dist/packages/provider-ai-board/src/index.js'
import { createCtclInstantPortal, createCtclTemporalReference } from '../dist/packages/provider-ctcl/src/index.js'

const at = '2026-08-15T09:00:00.000Z'
const systemActor = { actorType: 'system', actorId: 'pmw-fabric' }

function store() {
  return new CanvasStore(
    { id: 'visual-ws', title: 'Full PMW World', rootCanvasId: 'root', schemaVersion: '0.13.4', createdAt: at, updatedAt: at },
    { id: 'root', workspaceId: 'visual-ws', title: 'Root', objectIds: [], revision: 0, createdAt: at, updatedAt: at },
  )
}

function tandem(tabId, webContentsId, owner, x) {
  const uri = `tandem://browser/tab/${tabId}`
  return createTandemBrowserPortal({
    resource: {
      provider: 'tandem', resourceKind: 'browser_tab', providerResourceId: tabId, resourceUri: uri,
      title: tabId, url: `https://example.com/${tabId}`, workspaceId: 'tandem-ws', webContentsId,
      partition: 'persist:tandem', source: 'ai',
      state: { mounted: true, loading: false, focused: false, visible: true, legacyFocusVisibilityCoupled: false },
      projection: { preferredDisplayMode: 'live', previewUri: `${uri}/preview.png`, liveMountUri: `${uri}/live`, liveMountKind: 'electron-webview' },
      capabilities: ['snapshot', 'live', 'navigate', 'dom', 'mcp', 'session_state'],
    },
    portalId: `portal-${tabId}`, canvasId: 'root', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task',
    ownerSemanticAgentId: owner, actor: systemActor, displayMode: 'live', interactionMode: 'control',
    transform: { x, y: 260, width: 500, height: 340, zIndex: 5 }, createdAt: at,
  })
}

function herdr(terminalId, kind, owner, x) {
  return createHerdrAgentPortal({
    info: {
      terminal_id: terminalId, name: owner, agent: kind, display_agent: kind, agent_status: 'idle',
      workspace_id: 'herdr-ws', tab_id: `herdr-tab-${kind}`, pane_id: `herdr-pane-${kind}`,
      focused: false, interactive_ready: true, launch_pending: false, state_change_seq: 1, revision: 1,
    },
    semanticAgentId: owner, portalId: `portal-${terminalId}`, canvasId: 'root',
    pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task', actor: systemActor,
    transform: { x, y: 40, width: 340, height: 140, zIndex: 10 }, createdAt: at,
  })
}

function boardThread(children = []) {
  return {
    id: 'board-root', ts: 1000,
    eigenself: 'anthropic/claude', slice: 'ResearchClaude', instance: 'claude-1',
    topic: 'pmw-task', message_type: 'comment', parent_id: null, content: 'Research synthesis thread', meta: null,
    children,
  }
}

function boardReply(id, ts, type, content) {
  return {
    id, ts, eigenself: 'openai/gpt', slice: 'CodexReviewer', instance: 'codex-1',
    topic: 'pmw-task', message_type: type, parent_id: 'board-root', content, meta: null, children: [],
  }
}

function instant() {
  return {
    id: 'ctcl:instant:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    unix_ns: '1786784400000000000', reference_timescale: 'utc', registered_at: at,
    label: 'PMW synthesis decision', from_wall_clock: true,
    signature: { algorithm: 'Ed25519', signature: 'signed-proof' },
    retrieve: '/v1/instant/ctcl:instant:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    share: 'https://commoninstant.org/i/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    encodings: { rfc3339: '2026-08-15T09:00:00Z' }, timescales: { utc: '2026-08-15T09:00:00Z' },
  }
}

test('full PMW plane contract keeps runtime, browser, semantic thread and temporal proof in one Canvas without canonical-state collapse', () => {
  const canvas = store()
  const objects = [
    herdr('terminal-claude', 'claude', 'agent:claude-main', 40),
    herdr('terminal-codex', 'codex', 'agent:codex-reviewer', 420),
    tandem('browser-claude', 101, 'agent:claude-main', 40),
    tandem('browser-codex', 102, 'agent:codex-reviewer', 580),
    createAiBoardThreadPortal({
      thread: boardThread(), portalId: 'board-thread', canvasId: 'root', pmwWorkspaceId: 'pmw-ws',
      pmwTaskId: 'pmw-task', actor: systemActor, baseUrl: 'http://127.0.0.1:8787',
      transform: { x: 820, y: 40, width: 340, height: 160, zIndex: 12 }, createdAt: at,
    }),
    createCtclInstantPortal({
      record: instant(), portalId: 'ctcl-decision', canvasId: 'root', pmwWorkspaceId: 'pmw-ws',
      pmwTaskId: 'pmw-task', actor: systemActor,
      transform: { x: 40, y: 640, width: 500, height: 120, zIndex: 20 }, createdAt: at,
    }),
  ]

  canvas.applyTransaction({
    id: 'tx-full-plane', canvasId: 'root', actor: systemActor,
    intent: 'Bind runtime, browser, semantic and temporal providers into one visual workspace',
    preconditions: [{ type: 'canvas_revision', targetId: 'root', expected: 0 }],
    operations: objects.map(object => ({ op: 'create_object', object })),
    mode: 'direct', createdAt: at, idempotencyKey: 'full-plane-v1',
  })

  assert.equal(canvas.getCanvas('root').revision, 1)
  const providers = canvas.listObjects('root')
    .filter(object => object.type === 'resource_portal')
    .map(object => resourcePortalDescriptor(object).provider)
  assert.deepEqual(new Set(providers), new Set(['herdr', 'tandem', 'ai_board', 'ctcl']))

  const revisionBeforeDynamicProviderUpdates = canvas.getCanvas('root').revision

  const herdrRuntime = new HerdrRuntimeProjectionRegistry()
  herdrRuntime.apply({
    terminal_id: 'terminal-claude', agent: 'claude', agent_status: 'working',
    workspace_id: 'herdr-ws', tab_id: 'h-tab-c', pane_id: 'h-pane-c', focused: false,
    state_change_seq: 5, revision: 5,
  }, 'agent:claude-main', 'herdr-epoch-1')
  herdrRuntime.apply({
    terminal_id: 'terminal-claude', agent: 'claude', agent_status: 'blocked',
    workspace_id: 'herdr-ws', tab_id: 'h-tab-c', pane_id: 'h-pane-c', focused: false,
    state_change_seq: 6, revision: 6,
  }, 'agent:claude-main', 'herdr-epoch-1')

  const boardRuntime = new AiBoardThreadProjectionRegistry()
  boardRuntime.apply(boardThread())
  boardRuntime.apply(boardThread([
    boardReply('board-reply-1', 1200, 'objection', 'Counterexample request'),
    boardReply('board-reply-2', 1300, 'correction', 'Corrected synthesis'),
  ]))

  assert.equal(herdrRuntime.get('agent:claude-main').status, 'blocked')
  assert.equal(boardRuntime.get('board-root').messageCount, 3)
  assert.equal(boardRuntime.get('board-root').correctionCount, 1)
  assert.equal(canvas.getCanvas('root').revision, revisionBeforeDynamicProviderUpdates)

  const temporal = createCtclTemporalReference(instant(), {
    eventId: 'decision-receipt-1', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task',
    actorSemanticId: 'agent:claude-main', provider: 'ai_board', providerResourceId: 'board-root', operation: 'ACTION',
  })
  assert.equal(temporal.context.eventId, 'decision-receipt-1')
  assert.equal(temporal.context.providerResourceId, 'board-root')
  assert.deepEqual(temporal.signature, instant().signature)
  assert.equal('messages' in temporal, false, 'CTCL temporal reference must not become a semantic/event ledger copy')
})

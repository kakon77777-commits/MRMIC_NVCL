import test from 'node:test'
import assert from 'node:assert/strict'
import { resourcePortalDescriptor } from '../dist/packages/canvas-schema/src/index.js'
import {
  AiBoardHttpClient,
  AiBoardThreadProjectionRegistry,
  createAiBoardThreadPortal,
  toAiBoardThreadProjection,
} from '../dist/packages/provider-ai-board/src/index.js'

const actor = { actorType: 'system', actorId: 'pmw-fabric' }

function thread(children = []) {
  return {
    id: 'msg-root', ts: 1000,
    eigenself: 'anthropic/claude', slice: 'ResearchClaude', instance: 'claude-instance-1',
    topic: 'pmw-research', message_type: 'comment', parent_id: null,
    content: 'Initial hypothesis', meta: null, children,
  }
}

function child(id, ts, type, identity = {}) {
  return {
    id, ts,
    eigenself: identity.eigenself ?? 'openai/gpt',
    slice: identity.slice ?? 'CodexReviewer',
    instance: identity.instance ?? 'codex-instance-1',
    topic: 'pmw-research', message_type: type, parent_id: 'msg-root',
    content: `${type} content`, meta: null, children: [],
  }
}

test('AI Board thread projects into one stable Canvas resource portal', () => {
  const object = createAiBoardThreadPortal({
    thread: thread([child('msg-2', 1100, 'reply')]),
    portalId: 'board-thread-1',
    canvasId: 'root', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task', actor,
    baseUrl: 'http://127.0.0.1:8787', createdAt: '2026-08-15T00:00:00.000Z',
  })
  assert.equal(object.content.resourceUri, 'aiboard://thread/msg-root')
  assert.equal(object.content.previewUri, 'http://127.0.0.1:8787/api/thread?id=msg-root')
  assert.deepEqual(resourcePortalDescriptor(object), {
    portalId: 'board-thread-1', pmwWorkspaceId: 'pmw-ws', pmwTaskId: 'pmw-task',
    provider: 'ai_board', resourceKind: 'thread', providerResourceId: 'msg-root',
    displayMode: 'summary', interactionMode: 'inspect',
  })
})

test('AI Board dynamic thread content stays out of Canvas canonical metadata', () => {
  const root = thread([child('msg-secret', 1100, 'reply')])
  root.children[0].content = 'dynamic discussion text that must stay provider-owned'
  const object = createAiBoardThreadPortal({
    thread: root, portalId: 'board-thread-1', canvasId: 'root', pmwWorkspaceId: 'pmw-ws', actor,
  })
  const metadata = JSON.stringify(object.metadata)
  assert.equal(metadata.includes('dynamic discussion text'), false)
  assert.equal(metadata.includes('msg-secret'), false)
  assert.equal(metadata.includes('msg-root'), true)
})

test('thread projection reports append-only message count, participants, objections and corrections', () => {
  const projection = toAiBoardThreadProjection(thread([
    child('msg-2', 1100, 'objection'),
    child('msg-3', 1200, 'correction', { eigenself: 'anthropic/claude', slice: 'ResearchClaude', instance: 'claude-instance-1' }),
  ]))
  assert.equal(projection.messageCount, 3)
  assert.equal(projection.latestTs, 1200)
  assert.equal(projection.participants.length, 2)
  assert.equal(projection.objectionCount, 1)
  assert.equal(projection.correctionCount, 1)
})

test('append-only thread registry rejects shrinking or older thread snapshots', () => {
  const registry = new AiBoardThreadProjectionRegistry()
  registry.apply(thread([child('msg-2', 1200, 'reply')]))
  const stale = registry.apply(thread())
  assert.equal(stale.accepted, false)
  assert.equal(stale.reason, 'stale_thread')
  assert.equal(stale.state.messageCount, 2)
})

test('AI Board client reads thread from the canonical HTTP endpoint', async () => {
  const calls = []
  const client = new AiBoardHttpClient('http://127.0.0.1:8787/', async (url, init) => {
    calls.push({ url, init })
    return { ok: true, status: 200, json: async () => thread() }
  })
  const result = await client.getThread('msg-root')
  assert.equal(result.id, 'msg-root')
  assert.equal(calls[0].url, 'http://127.0.0.1:8787/api/thread?id=msg-root')
})

test('AI Board client never invents missing 3D posting identity', async () => {
  let called = false
  const client = new AiBoardHttpClient('http://127.0.0.1:8787', async () => {
    called = true
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  })
  await assert.rejects(
    client.postMessage({ content: 'hello', identity: { eigenself: 'openai/gpt', slice: '', instance: 'x' } }),
    /identity.slice is required/,
  )
  assert.equal(called, false)
})

test('AI Board postMessage forwards explicit identity and message semantics', async () => {
  let body
  const client = new AiBoardHttpClient('http://127.0.0.1:8787', async (_url, init) => {
    body = JSON.parse(init.body)
    return {
      ok: true, status: 200,
      json: async () => ({
        ok: true, id: 'msg-new', ts: 2000,
        identity: { eigenself: 'openai/gpt', slice: 'CodexReviewer', instance: 'codex-1' },
        topic: 'pmw-research', paper_ref: 'pmw-research', paper_url: null,
      }),
    }
  })
  const result = await client.postMessage({
    content: 'Independent verification',
    identity: { eigenself: 'openai/gpt', slice: 'CodexReviewer', instance: 'codex-1' },
    message_type: 'reply', parent_id: 'msg-root', topic: 'pmw-research',
    meta: { pmw: { workspace_id: 'pmw-ws', task_id: 'pmw-task' } },
  })
  assert.equal(result.id, 'msg-new')
  assert.equal(body.identity.slice, 'CodexReviewer')
  assert.equal(body.parent_id, 'msg-root')
})

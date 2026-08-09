import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase4Server } from '../dist/apps/web/src/server.js'
import {
  filterChecks,
  JsonModelNvclAgent,
  LocalMcpCanvasClient,
  MemoryNvclTraceSink,
  NvclRuntime,
  ReferenceSceneNvclAgent,
  scoreIssues,
  validateDecision,
} from '../dist/packages/nvcl-runtime/src/index.js'

const checks = [
  { type: 'count', role: 'star', expected: 3, rule: 'three_stars' },
  { type: 'max_overlap', foregroundId: 'title', backgroundId: 'character', maximum: 0.10 },
  { type: 'inside_bounds', objectId: 'title', bounds: { x: 0, y: 0, width: 1200, height: 800 } },
]

async function runReference(app, trace = new MemoryNvclTraceSink()) {
  const runtime = new NvclRuntime({
    client: new LocalMcpCanvasClient(app.mcp, { actorId: 'nvcl-test-agent', role: 'owner' }),
    agent: new ReferenceSceneNvclAgent(),
    trace,
  })
  const result = await runtime.run({
    runId: 'test-reference-run',
    goal: 'Create and repair the reference scene.',
    canvasId: app.rootCanvas.id,
    checks,
    maxIterations: 6,
  })
  return { result, trace }
}

test('NVCL reference agent completes observe-plan-act-render-verify-repair-stop through MCP', async () => {
  const app = createPhase4Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const { result } = await runReference(app)
    assert.equal(result.status, 'completed')
    assert.equal(result.toolCalls, 2)
    assert.equal(result.finalIssues.length, 0)
    assert.equal(app.store.listObjects(app.rootCanvas.id).length, 8)
    assert.equal(app.store.getObject('title').transform.y, 55)
    assert.equal(app.store.listObjects(app.rootCanvas.id).filter(object => object.metadata.role === 'star').length, 3)
    assert.equal(app.room.updateCount(), 2)
  } finally { await app.close() }
})

test('NVCL trace records observations, decisions, tool results, snapshots, and completion', async () => {
  const app = createPhase4Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const trace = new MemoryNvclTraceSink()
    const { result } = await runReference(app, trace)
    const types = trace.events.map(event => event.type)
    assert.ok(types.includes('run_started'))
    assert.ok(types.includes('observation'))
    assert.equal(types.filter(type => type === 'decision').length, result.iterations)
    assert.equal(types.filter(type => type === 'tool_result').length, result.toolCalls)
    assert.ok(types.includes('best_snapshot'))
    assert.equal(types.at(-1), 'run_completed')
    assert.equal(trace.result?.runId, result.runId)
  } finally { await app.close() }
})

test('NVCL restores the best snapshot after a regression followed by an MCP tool failure', async () => {
  const app = createPhase4Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    await runReference(app)
    class RegressThenFailAgent {
      name = 'regress-then-fail'
      async decide(context) {
        if (context.iteration === 0) {
          const title = context.observation.objects.find(object => object.id === 'title')
          return {
            type: 'tool_call', tool: 'canvas.patch_objects', summary: 'Intentionally regress title position.',
            arguments: { canvasId: context.observation.canvasId, expectedCanvasRevision: context.observation.revision, patches: [{ objectId: 'title', expectedRevision: title.revision, patch: { transform: { y: 230 } } }] },
          }
        }
        return {
          type: 'tool_call', tool: 'canvas.patch_objects', summary: 'Trigger a controlled invalid object failure.',
          arguments: { canvasId: context.observation.canvasId, expectedCanvasRevision: context.observation.revision, patches: [{ objectId: 'missing-object', expectedRevision: 0, patch: { transform: { x: 1 } } }] },
        }
      }
    }
    const trace = new MemoryNvclTraceSink()
    const runtime = new NvclRuntime({ client: new LocalMcpCanvasClient(app.mcp, { actorId: 'failure-agent', role: 'owner' }), agent: new RegressThenFailAgent(), trace })
    const result = await runtime.run({ runId: 'restore-best-run', goal: 'Test best-state recovery.', canvasId: app.rootCanvas.id, checks, maxIterations: 4, maxConsecutiveFailures: 1 })
    assert.equal(result.status, 'failed')
    assert.equal(result.restoredBestSnapshot, true)
    assert.equal(app.store.getObject('title').transform.y, 55)
    assert.ok(trace.events.some(event => event.type === 'snapshot_restored'))
  } finally { await app.close() }
})

test('provider-neutral JSON model agent validates structured MCP decisions', async () => {
  const provider = { name: 'fixture-provider', async generate() { return { type: 'stop', success: true, reason: 'done' } } }
  const agent = new JsonModelNvclAgent(provider)
  const decision = await agent.decide({ runId: 'r', goal: 'g', iteration: 0, maxIterations: 1, previousDecisions: [], observation: { runId: 'r', iteration: 0, goal: 'g', canvasId: 'c', revision: 0, viewport: {}, objects: [], renderUri: 'x', renderSvg: '', issues: [], eventCount: 0 } })
  assert.deepEqual(decision, { type: 'stop', success: true, reason: 'done' })
  assert.throws(() => validateDecision({ type: 'tool_call', tool: 'shell.exec', arguments: {}, summary: 'bad' }), /canvas\.\*/)
})

test('verification filtering avoids unavailable object references and issue scoring is deterministic', () => {
  const filtered = filterChecks(checks, new Set())
  assert.equal(filtered.length, 1)
  assert.equal(filtered[0].type, 'count')
  assert.equal(scoreIssues([{ id: 'a', severity: 'error', rule: 'x', objectIds: [], message: 'x' }, { id: 'b', severity: 'warning', rule: 'y', objectIds: [], message: 'y' }]), 110)
})

test('Flat NVCL web endpoint runs NVCL and exposes the result as an MCP trajectory resource', async () => {
  const app = createPhase4Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  try {
    const response = await fetch(`${started.url}/api/nvcl/reference`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.status, 'completed')
    assert.equal(result.finalIssues.length, 0)
    assert.match(result.trajectoryUri, /\/trajectory\//)
    const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'trajectory-reader', role: 'viewer' })
    const contents = await client.readResource(result.trajectoryUri)
    assert.match(contents[0].text, /phase4|web-nvcl/i)
  } finally { await app.close() }
})

test('NVCL supports cancellation and restores the best known snapshot', async () => {
  const app = createPhase4Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  await app.start()
  try {
    const controller = new AbortController()
    controller.abort()
    const runtime = new NvclRuntime({ client: new LocalMcpCanvasClient(app.mcp, { actorId: 'cancel-agent', role: 'owner' }), agent: new ReferenceSceneNvclAgent() })
    const result = await runtime.run({ runId: 'cancel-run', goal: 'Cancelled task.', canvasId: app.rootCanvas.id, checks, maxIterations: 3, signal: controller.signal })
    assert.equal(result.status, 'cancelled')
    assert.equal(result.toolCalls, 0)
    assert.equal(result.restoredBestSnapshot, true)
    assert.equal(app.store.listObjects(app.rootCanvas.id).length, 0)
  } finally { await app.close() }
})

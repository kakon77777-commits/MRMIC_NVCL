import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ObserverWorkspaceRegistry,
  resolveObserverCanvasContexts,
} from '../dist/packages/observer-workspace/src/index.js'
import { DurableObserverWorkspaceRegistry } from '../dist/packages/observer-workspace/src/durable-registry.js'
import { CanvasAuthorityTopologyResolver, StaticObserverCanvasTopologyResolver } from '../dist/packages/observer-workspace/src/topology.js'
import {
  ObserverProtocolGateway,
  executeObserverProtocolCommand,
} from '../dist/packages/observer-protocol/src/index.js'

const neo = {
  principalId: 'principal:neo',
  role: 'owner',
  actor: { actorType: 'user', actorId: 'user:neo' },
}

function topology() {
  return new StaticObserverCanvasTopologyResolver([
    { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a' },
    { parentCanvasId: 'canvas:a', childCanvasId: 'canvas:b', portalObjectId: 'portal:b' },
  ])
}

function clock() {
  let tick = 0
  return () => `2026-09-14T10:00:${String(tick++).padStart(2, '0')}Z`
}

class MemoryStore {
  events = []
  appendObserverWorkspaceEvent(event) { this.events.push(structuredClone(event)) }
  listObserverWorkspaceEvents() { return structuredClone(this.events) }
}

function view(runtime) {
  return runtime.createPrivateView({ viewId: 'view:neo', worldId: 'world:1', canvasId: 'canvas:root' }, neo)
}

test('nested observer context is authorized by canonical topology and owns an independent foreground stack', () => {
  const runtime = new ObserverWorkspaceRegistry(clock(), topology())
  view(runtime)
  runtime.setForegroundStack('view:neo', ['portal:root-tool'], neo)
  const entered = runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:root',
    childCanvasId: 'canvas:a',
    portalObjectId: 'portal:a',
  }, neo)
  assert.equal(entered.nestedCanvasContexts?.length, 1)
  const next = runtime.setNestedForegroundStack('view:neo', 'canvas:a', ['portal:child-tool', 'portal:child-tool'], neo)
  assert.deepEqual(next.foregroundPortalIds, ['portal:root-tool'])
  assert.deepEqual(next.nestedCanvasContexts?.[0].foregroundPortalIds, ['portal:child-tool'])
  assert.equal(runtime.getResolvedCanvasContexts('view:neo', neo).at(-1).active, true)
})

test('hidden visibility is inherited monotonically by deeper contexts', () => {
  const runtime = new ObserverWorkspaceRegistry(clock(), topology())
  view(runtime)
  runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a',
  }, neo)
  runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:a', childCanvasId: 'canvas:b', portalObjectId: 'portal:b',
  }, neo)
  runtime.setNestedVisibility('view:neo', 'canvas:a', 'hidden', neo)
  const resolved = runtime.getResolvedCanvasContexts('view:neo', neo)
  assert.deepEqual(resolved.map(item => [item.canvasId, item.effectiveVisible]), [
    ['canvas:root', true],
    ['canvas:a', false],
    ['canvas:b', false],
  ])
})

test('observer cannot skip lineage, forge topology, or enter a cycle', () => {
  const runtime = new ObserverWorkspaceRegistry(clock(), topology())
  view(runtime)
  assert.throws(() => runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:a', childCanvasId: 'canvas:b', portalObjectId: 'portal:b',
  }, neo), /active canvas/)
  assert.throws(() => runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'wrong',
  }, neo), /not authorized/)
  runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a',
  }, neo)
  assert.throws(() => runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:a', childCanvasId: 'canvas:root', portalObjectId: 'anything',
  }, neo), /cycle/)
})

test('nested navigation fails closed when no topology authority is configured', () => {
  const runtime = new ObserverWorkspaceRegistry(clock())
  view(runtime)
  assert.throws(() => runtime.enterSubcanvas('view:neo', {
    parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a',
  }, neo), /topology authority/)
})

test('leave subcanvas pops only the active child and never leaves the root', () => {
  const runtime = new ObserverWorkspaceRegistry(clock(), topology())
  view(runtime)
  runtime.enterSubcanvas('view:neo', { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a' }, neo)
  runtime.enterSubcanvas('view:neo', { parentCanvasId: 'canvas:a', childCanvasId: 'canvas:b', portalObjectId: 'portal:b' }, neo)
  assert.equal(runtime.leaveSubcanvas('view:neo', neo).nestedCanvasContexts?.at(-1).canvasId, 'canvas:a')
  assert.equal(runtime.leaveSubcanvas('view:neo', neo).nestedCanvasContexts?.length, 0)
  assert.throws(() => runtime.leaveSubcanvas('view:neo', neo), /root canvas/)
})

test('durable recovery reconstructs nested contexts only with the same topology authority', () => {
  const store = new MemoryStore()
  const runtime = new DurableObserverWorkspaceRegistry(store, clock(), topology())
  view(runtime)
  runtime.enterSubcanvas('view:neo', { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a' }, neo)
  runtime.setNestedForegroundStack('view:neo', 'canvas:a', ['portal:child'], neo)
  runtime.setNestedVisibility('view:neo', 'canvas:a', 'hidden', neo)
  const recovered = new DurableObserverWorkspaceRegistry(store, clock(), topology())
  const restored = recovered.getPrivateView('view:neo', neo)
  assert.equal(restored.nestedCanvasContexts?.[0].visibility, 'hidden')
  assert.deepEqual(restored.nestedCanvasContexts?.[0].foregroundPortalIds, ['portal:child'])
  assert.throws(() => new DurableObserverWorkspaceRegistry(store, clock()), /topology authority/)
})

test('protocol commands enter nested canvas and expose resolved visibility without raw event access', async () => {
  const store = new MemoryStore()
  const workspace = new DurableObserverWorkspaceRegistry(store, clock(), topology())
  view(workspace)
  executeObserverProtocolCommand(workspace, {
    kind: 'enter_subcanvas',
    viewId: 'view:neo',
    input: { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a' },
  }, neo)
  executeObserverProtocolCommand(workspace, {
    kind: 'set_nested_visibility', viewId: 'view:neo', canvasId: 'canvas:a', visibility: 'hidden',
  }, neo)
  const gateway = new ObserverProtocolGateway({
    workspace,
    identityResolver: { resolveToken: () => neo },
  })
  const response = await gateway.dispatchMcpForTesting({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'observer.get_canvas_contexts', arguments: { viewId: 'view:neo' } },
  }, neo)
  assert.equal(response.result.structuredContent.ok, true)
  assert.equal(response.result.structuredContent.data[1].effectiveVisible, false)
  const resources = await gateway.dispatchMcpForTesting({ jsonrpc: '2.0', id: 2, method: 'resources/templates/list' }, neo)
  assert.ok(resources.result.resourceTemplates.some(item => item.uriTemplate.includes('/contexts')))
})


test('Canvas authority adapter requires child document and subcanvas portal to agree on both directions', () => {
  const canvases = new Map([
    ['canvas:root', { id: 'canvas:root' }],
    ['canvas:a', { id: 'canvas:a', parentCanvasId: 'canvas:root', parentObjectId: 'portal:a' }],
  ])
  const objects = new Map([
    ['portal:a', { id: 'portal:a', canvasId: 'canvas:root', type: 'subcanvas', content: { childCanvasId: 'canvas:a' } }],
  ])
  const resolver = new CanvasAuthorityTopologyResolver({
    getCanvas(id) {
      const value = canvases.get(id)
      if (!value) throw new Error('missing canvas')
      return value
    },
    getObject(id) {
      const value = objects.get(id)
      if (!value) throw new Error('missing object')
      return value
    },
  })
  assert.deepEqual(
    resolver.resolveSubcanvasLink({ parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a' }),
    { parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'portal:a' },
  )
  assert.equal(
    resolver.resolveSubcanvasLink({ parentCanvasId: 'canvas:root', childCanvasId: 'canvas:a', portalObjectId: 'wrong' }),
    null,
  )
})

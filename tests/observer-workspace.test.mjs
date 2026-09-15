import test from 'node:test'
import assert from 'node:assert/strict'
import { ObserverWorkspaceRegistry } from '../dist/packages/observer-workspace/src/index.js'

const neo = {
  principalId: 'principal:neo',
  role: 'owner',
  actor: { actorType: 'user', actorId: 'user:neo' },
}
const agentA = {
  principalId: 'principal:agent-a',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'agent:a' },
  semanticAgentId: 'agent:a',
}
const agentB = {
  principalId: 'principal:agent-b',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'agent:b' },
  semanticAgentId: 'agent:b',
}
const viewer = {
  principalId: 'principal:viewer',
  role: 'viewer',
  actor: { actorType: 'user', actorId: 'user:viewer' },
}

function registry() {
  let tick = 0
  return new ObserverWorkspaceRegistry(() => `2026-09-14T00:00:${String(tick++).padStart(2, '0')}Z`)
}

function createView(runtime, principal, viewId, canvasId = `${viewId}:canvas`) {
  return runtime.createPrivateView({ viewId, worldId: 'world:1', canvasId }, principal)
}

test('private observer view binds identity from authenticated principal', () => {
  const runtime = registry()
  const view = createView(runtime, agentA, 'view:a')
  assert.equal(view.observerPrincipalId, 'principal:agent-a')
  assert.equal(view.observerSemanticAgentId, 'agent:a')
  assert.equal(view.lifecycle, 'live')
  assert.deepEqual(view.foregroundPortalIds, [])
})

test('private views fail closed for another principal', () => {
  const runtime = registry()
  createView(runtime, agentA, 'view:a')
  assert.throws(() => runtime.getPrivateView('view:a', agentB), /private to another principal/)
  assert.throws(() => runtime.setForegroundStack('view:a', ['portal:x'], agentB), /private to another principal/)
})

test('foreground stack is observer-relative and deduplicated', () => {
  const runtime = registry()
  createView(runtime, neo, 'view:neo')
  const next = runtime.setForegroundStack('view:neo', ['portal:editor', 'portal:browser', 'portal:editor'], neo)
  assert.deepEqual(next.foregroundPortalIds, ['portal:editor', 'portal:browser'])
  assert.equal(next.revision, 1)
})

test('rendezvous requires explicit invitation before another principal can join', () => {
  const runtime = registry()
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  assert.throws(() => runtime.join('room:1', agentA), /not invited/)
  runtime.invite('room:1', agentA.principalId, neo)
  const joined = runtime.join('room:1', agentA)
  assert.deepEqual(joined.members.map(member => member.principalId), ['principal:neo', 'principal:agent-a'])
})

test('selective convergence projects a portal without transferring the private view', () => {
  const runtime = registry()
  createView(runtime, agentA, 'view:a')
  runtime.setForegroundStack('view:a', ['portal:research', 'portal:notes'], agentA)
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  runtime.invite('room:1', agentA.principalId, neo)
  runtime.join('room:1', agentA)
  const room = runtime.projectPortal('room:1', {
    projectionId: 'projection:research',
    sourceViewId: 'view:a',
    portalId: 'portal:research',
  }, agentA)
  assert.equal(room.projections.length, 1)
  assert.equal(room.projections[0].sourcePrincipalId, agentA.principalId)
  assert.equal(room.projections[0].interaction, 'inspect')
  assert.deepEqual(runtime.getPrivateView('view:a', agentA).foregroundPortalIds, ['portal:research', 'portal:notes'])
  assert.throws(() => runtime.getPrivateView('view:a', neo), /private to another principal/)
})

test('a principal cannot project another observer private view', () => {
  const runtime = registry()
  createView(runtime, agentA, 'view:a')
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  runtime.invite('room:1', agentB.principalId, neo)
  runtime.join('room:1', agentB)
  assert.throws(() => runtime.projectPortal('room:1', {
    projectionId: 'projection:forged',
    sourceViewId: 'view:a',
    portalId: 'portal:research',
  }, agentB), /private to another principal/)
})

test('non-member cannot inspect rendezvous and snapshot only exposes observer-visible state', () => {
  const runtime = registry()
  createView(runtime, agentA, 'view:a')
  createView(runtime, agentB, 'view:b')
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  runtime.invite('room:1', agentA.principalId, neo)
  runtime.join('room:1', agentA)
  assert.throws(() => runtime.getRendezvous('room:1', agentB), /not a rendezvous member/)
  const snapshotA = runtime.snapshotFor(agentA)
  assert.deepEqual(snapshotA.views.map(view => view.viewId), ['view:a'])
  assert.deepEqual(snapshotA.rendezvous.map(room => room.rendezvousId), ['room:1'])
  const snapshotB = runtime.snapshotFor(agentB)
  assert.deepEqual(snapshotB.views.map(view => view.viewId), ['view:b'])
  assert.deepEqual(snapshotB.rendezvous, [])
})

test('viewer may join an invited room to inspect but cannot create or project workspace state', () => {
  const runtime = registry()
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  runtime.invite('room:1', viewer.principalId, neo)
  const joined = runtime.join('room:1', viewer)
  assert.ok(joined.members.some(member => member.principalId === viewer.principalId))
  assert.throws(() => createView(runtime, viewer, 'view:viewer'), /viewer principal/)
})

test('closing a rendezvous is host-only and prevents later convergence', () => {
  const runtime = registry()
  createView(runtime, agentA, 'view:a')
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  runtime.invite('room:1', agentA.principalId, neo)
  runtime.join('room:1', agentA)
  assert.throws(() => runtime.closeRendezvous('room:1', agentA), /only rendezvous host/)
  const closed = runtime.closeRendezvous('room:1', neo)
  assert.equal(closed.state, 'closed')
  assert.throws(() => runtime.projectPortal('room:1', {
    projectionId: 'projection:late',
    sourceViewId: 'view:a',
    portalId: 'portal:late',
  }, agentA), /rendezvous is closed/)
})

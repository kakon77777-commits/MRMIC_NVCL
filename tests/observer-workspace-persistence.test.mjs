import test from 'node:test'
import assert from 'node:assert/strict'
import { rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DurableObserverWorkspaceRegistry } from '../dist/packages/observer-workspace/src/durable-registry.js'
import { SqliteObserverWorkspaceEventStore } from '../dist/packages/observer-workspace/src/durable-store.js'

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

function clock() {
  let tick = 0
  return () => `2026-09-14T01:00:${String(tick++).padStart(2, '0')}Z`
}

function tempDb(label) {
  return resolve(process.cwd(), `.mrmic-${label}-${process.pid}-${Date.now()}.sqlite`)
}

function cleanup(dbPath) {
  rmSync(dbPath, { force: true })
  rmSync(`${dbPath}-wal`, { force: true })
  rmSync(`${dbPath}-shm`, { force: true })
}

test('durable observer world recovers private view, membership and projections across registry restart', () => {
  const dbPath = tempDb('recover')
  try {
    let store = new SqliteObserverWorkspaceEventStore(dbPath)
    let runtime = new DurableObserverWorkspaceRegistry(store, clock())
    runtime.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
    runtime.setForegroundStack('view:a', ['portal:research', 'portal:notes'], agentA)
    runtime.setViewLifecycle('view:a', 'frozen', agentA)
    runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
    runtime.invite('room:1', agentA.principalId, neo)
    runtime.join('room:1', agentA)
    runtime.projectPortal('room:1', {
      projectionId: 'projection:research',
      sourceViewId: 'view:a',
      portalId: 'portal:research',
      interaction: 'inspect',
    }, agentA)
    assert.equal(store.count(), 7)
    store.close()

    store = new SqliteObserverWorkspaceEventStore(dbPath)
    runtime = new DurableObserverWorkspaceRegistry(store, clock())
    const restoredView = runtime.getPrivateView('view:a', agentA)
    assert.equal(restoredView.lifecycle, 'frozen')
    assert.deepEqual(restoredView.foregroundPortalIds, ['portal:research', 'portal:notes'])
    const room = runtime.getRendezvous('room:1', agentA)
    assert.deepEqual(room.members.map(member => member.principalId), ['principal:neo', 'principal:agent-a'])
    assert.equal(room.projections[0].portalId, 'portal:research')
    assert.equal(store.count(), 7)
    store.close()
  } finally {
    cleanup(dbPath)
  }
})

test('failed durable append rolls observer state back to the persisted stream', () => {
  const events = []
  let fail = false
  const store = {
    listObserverWorkspaceEvents() { return structuredClone(events) },
    appendObserverWorkspaceEvent(event) {
      if (fail) throw new Error('durable store unavailable')
      events.push(structuredClone(event))
    },
  }
  const runtime = new DurableObserverWorkspaceRegistry(store, clock())
  runtime.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
  fail = true
  assert.throws(() => runtime.setForegroundStack('view:a', ['portal:x'], agentA), /durable store unavailable/)
  assert.deepEqual(runtime.getPrivateView('view:a', agentA).foregroundPortalIds, [])
  assert.equal(events.length, 1)
})

test('tampered persisted observer state fails closed on recovery', () => {
  const dbPath = tempDb('tamper')
  try {
    let store = new SqliteObserverWorkspaceEventStore(dbPath)
    const runtime = new DurableObserverWorkspaceRegistry(store, clock())
    runtime.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
    store.close()

    const db = new DatabaseSync(dbPath)
    db.prepare("UPDATE observer_workspace_events SET state_json = ? WHERE entity_id = ?")
      .run('{"schema":"observer_view_v1","tampered":true}', 'view:a')
    db.close()

    store = new SqliteObserverWorkspaceEventStore(dbPath)
    assert.throws(() => new DurableObserverWorkspaceRegistry(store, clock()), /payload hash mismatch/)
    store.close()
  } finally {
    cleanup(dbPath)
  }
})

test('recovery rejects revision gaps even when event payloads are otherwise self-consistent', () => {
  const events = []
  const store = {
    listObserverWorkspaceEvents() { return structuredClone(events) },
    appendObserverWorkspaceEvent(event) { events.push(structuredClone(event)) },
  }
  const runtime = new DurableObserverWorkspaceRegistry(store, clock())
  runtime.createPrivateView({ viewId: 'view:a', worldId: 'world:1', canvasId: 'canvas:a' }, agentA)
  runtime.setForegroundStack('view:a', ['portal:x'], agentA)
  const broken = structuredClone(events)
  broken[1].revision = 3
  broken[1].state.revision = 3
  broken[1].eventId = 'observer_view:view:a:r3:view_foreground_set'
  const brokenStore = {
    listObserverWorkspaceEvents() { return broken },
    appendObserverWorkspaceEvent() {},
  }
  assert.throws(() => new DurableObserverWorkspaceRegistry(brokenStore, clock()), /revision gap/)
})

test('idempotent invite, join and close do not create duplicate durable revisions', () => {
  const events = []
  const store = {
    listObserverWorkspaceEvents() { return structuredClone(events) },
    appendObserverWorkspaceEvent(event) { events.push(structuredClone(event)) },
  }
  const runtime = new DurableObserverWorkspaceRegistry(store, clock())
  runtime.openRendezvous({ rendezvousId: 'room:1', worldId: 'world:1', canvasId: 'canvas:shared' }, neo)
  runtime.invite('room:1', agentA.principalId, neo)
  runtime.join('room:1', agentA)
  const countAfterJoin = events.length
  runtime.join('room:1', agentA)
  assert.equal(events.length, countAfterJoin)
  runtime.closeRendezvous('room:1', neo)
  const countAfterClose = events.length
  runtime.closeRendezvous('room:1', neo)
  assert.equal(events.length, countAfterClose)
})

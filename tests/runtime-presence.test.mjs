import test from 'node:test'
import assert from 'node:assert/strict'
import {
  RuntimePresenceRegistry,
  sanitizeRuntimePresenceInput,
} from '../dist/packages/runtime-presence/src/index.js'

const claude = {
  principalId: 'principal:claude',
  role: 'agent-direct',
  actor: { actorType: 'agent', actorId: 'mrmic:claude-binding' },
  semanticAgentId: 'agent:claude-main',
}

function runtime(overrides = {}) {
  return {
    provider: 'herdr',
    providerResourceId: 'terminal-claude',
    runtimeEpochId: 'epoch-1',
    status: 'working',
    revision: 10,
    sequence: 20,
    kind: 'claude',
    focused: false,
    interactiveReady: true,
    launchPending: false,
    coordinates: { workspaceId: 'ws-1', tabId: 'tab-1', paneId: 'pane-1' },
    ...overrides,
  }
}

test('runtime presence binds semantic identity from verified principal, not caller payload', () => {
  const registry = new RuntimePresenceRegistry()
  const result = registry.apply({
    ...runtime(),
    principalId: 'principal:forged',
    semanticAgentId: 'user:neo',
    actorId: 'user:neo',
  }, claude, 'bridge-claude')
  assert.equal(result.accepted, true)
  assert.equal(result.state.principalId, 'principal:claude')
  assert.equal(result.state.semanticAgentId, 'agent:claude-main')
  assert.equal('actorId' in result.state, false)
  assert.equal(result.state.identityStatus, 'verified')
})

test('runtime presence is ephemeral and removable by disconnected client', () => {
  const registry = new RuntimePresenceRegistry()
  registry.apply(runtime(), claude, 'bridge-claude')
  assert.equal(registry.snapshot().length, 1)
  const removed = registry.removeClient('bridge-claude')
  assert.equal(removed.length, 1)
  assert.equal(registry.snapshot().length, 0)
})

test('runtime presence rejects stale revision inside one provider epoch', () => {
  const registry = new RuntimePresenceRegistry()
  registry.apply(runtime({ revision: 10, sequence: 20, status: 'working' }), claude, 'bridge-claude')
  const stale = registry.apply(runtime({ revision: 9, sequence: 99, status: 'done' }), claude, 'bridge-claude')
  assert.equal(stale.accepted, false)
  assert.equal(stale.reason, 'stale_revision')
  assert.equal(stale.state.status, 'working')
})

test('runtime presence rejects lower sequence at equal revision', () => {
  const registry = new RuntimePresenceRegistry()
  registry.apply(runtime({ revision: 10, sequence: 20 }), claude, 'bridge-claude')
  const stale = registry.apply(runtime({ revision: 10, sequence: 19, status: 'blocked' }), claude, 'bridge-claude')
  assert.equal(stale.accepted, false)
  assert.equal(stale.reason, 'stale_sequence')
})

test('new runtime epoch accepts counter reset after provider restart or handoff', () => {
  const registry = new RuntimePresenceRegistry()
  registry.apply(runtime({ runtimeEpochId: 'old', revision: 100, sequence: 100, status: 'done' }), claude, 'bridge-claude')
  const restarted = registry.apply(runtime({ runtimeEpochId: 'new', revision: 1, sequence: 1, status: 'idle' }), claude, 'bridge-claude')
  assert.equal(restarted.accepted, true)
  assert.equal(restarted.state.runtimeEpochId, 'new')
  assert.equal(restarted.state.status, 'idle')
})

test('viewer principal cannot publish runtime truth', () => {
  const registry = new RuntimePresenceRegistry()
  assert.throws(() => registry.apply(runtime(), { ...claude, role: 'viewer' }, 'viewer-client'), /viewer principal/)
})

test('runtime sanitizer keeps a bounded provider payload and drops forged identity fields', () => {
  const sanitized = sanitizeRuntimePresenceInput({
    ...runtime(),
    principalId: 'forged',
    semanticAgentId: 'forged',
    extra: { secret: 'do not forward' },
  })
  assert.deepEqual(sanitized, runtime())
  assert.equal('principalId' in sanitized, false)
  assert.equal('extra' in sanitized, false)
})

test('malformed runtime monotonic fields fail closed', () => {
  assert.throws(() => sanitizeRuntimePresenceInput(runtime({ revision: -1 })), /revision/)
  assert.throws(() => sanitizeRuntimePresenceInput(runtime({ sequence: 1.5 })), /sequence/)
  assert.throws(() => sanitizeRuntimePresenceInput(runtime({ provider: '' })), /provider is required/)
})

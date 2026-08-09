import test from 'node:test'
import assert from 'node:assert/strict'
import { SqliteEventLedger } from '../dist/packages/event-ledger/src/index.js'

test('persists and reads append-only events', () => {
  const ledger = new SqliteEventLedger(':memory:')
  ledger.append({
    eventId: 'event-1', workspaceId: 'ws', canvasId: 'root', transactionId: 'tx',
    actor: { actorType: 'agent', actorId: 'a' }, eventType: 'transaction_committed',
    objectIds: ['o1'], intent: 'test', payload: { ok: true }, beforeHash: 'a', afterHash: 'b',
    createdAt: new Date().toISOString(),
  })
  assert.equal(ledger.count(), 1)
  assert.equal(ledger.list('ws')[0].eventId, 'event-1')
  ledger.close()
})

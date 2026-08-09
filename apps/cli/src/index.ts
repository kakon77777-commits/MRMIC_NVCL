import { resolve } from 'node:path'
import { CanvasStore } from '../../../packages/canvas-core/src/index.js'
import type { CanvasTransaction } from '../../../packages/canvas-schema/src/index.js'
import { SqliteEventLedger } from '../../../packages/event-ledger/src/index.js'
import { verifyCount, verifyMaxOverlap } from '../../../packages/verifier/src/index.js'
import { agent, createWorkspace, object, transactionId } from './fixtures.js'

const databasePath = resolve('data/local.db')
const ledger = new SqliteEventLedger(databasePath)
const { workspace, rootCanvas } = createWorkspace()
const store = new CanvasStore(workspace, rootCanvas, { eventSink: ledger })

const title = object('title', 'text', { x: 470, y: 210, width: 280, height: 80, zIndex: 10 }, { role: 'title' }, { text: 'Moon Friend' })
const character = object('character', 'ellipse', { x: 500, y: 250, width: 220, height: 300, zIndex: 5 }, { role: 'character' })
const moon = object('moon', 'ellipse', { x: 520, y: 60, width: 180, height: 180, zIndex: 2 }, { role: 'moon' })
const ground = object('ground', 'rectangle', { x: 100, y: 600, width: 1000, height: 120, zIndex: 1 }, { role: 'ground' })
const stars = [
  object('star-1', 'ellipse', { x: 280, y: 120, width: 24, height: 24, zIndex: 3 }, { role: 'star' }),
  object('star-2', 'ellipse', { x: 800, y: 150, width: 24, height: 24, zIndex: 3 }, { role: 'star' }),
  object('star-3', 'ellipse', { x: 950, y: 90, width: 24, height: 24, zIndex: 3 }, { role: 'star' }),
]

const createScene: CanvasTransaction = {
  id: transactionId(),
  canvasId: rootCanvas.id,
  actor: agent,
  intent: 'Create the Phase 0 standard scene',
  expectedOutcome: 'A title, character, moon, ground, and three stars exist',
  preconditions: [{ type: 'canvas_revision', targetId: rootCanvas.id, expected: 0 }],
  operations: [title, character, moon, ground, ...stars].map((item) => ({ op: 'create_object' as const, object: item })),
  mode: 'direct',
  createdAt: new Date().toISOString(),
  idempotencyKey: 'phase0-standard-scene',
}

const first = store.applyTransaction(createScene)
let objects = store.listObjects(rootCanvas.id)
let issues = [
  ...verifyCount(objects, (item) => item.metadata.role === 'star', 3, 'star_count'),
  ...verifyMaxOverlap(store.getObject('title'), store.getObject('character'), 0.10, 'title_character_overlap'),
]

console.log('Initial transaction:', first)
console.log('Initial verification issues:', issues)

if (issues.length > 0) {
  const currentTitle = store.getObject('title')
  const repair: CanvasTransaction = {
    id: transactionId(),
    canvasId: rootCanvas.id,
    actor: agent,
    intent: 'Move the title away from the character without redrawing the scene',
    expectedOutcome: 'Title overlap ratio is at most 0.10',
    preconditions: [{ type: 'object_revision', targetId: currentTitle.id, expected: currentTitle.revision }],
    operations: [{
      op: 'patch_object',
      objectId: currentTitle.id,
      expectedRevision: currentTitle.revision,
      patch: { transform: { x: 460, y: 10 } },
    }],
    mode: 'direct',
    createdAt: new Date().toISOString(),
  }
  console.log('Repair transaction:', store.applyTransaction(repair))
}

objects = store.listObjects(rootCanvas.id)
issues = [
  ...verifyCount(objects, (item) => item.metadata.role === 'star', 3, 'star_count'),
  ...verifyMaxOverlap(store.getObject('title'), store.getObject('character'), 0.10, 'title_character_overlap'),
]

console.log(JSON.stringify({
  workspaceId: workspace.id,
  canvasRevision: store.getCanvas(rootCanvas.id).revision,
  objectCount: objects.length,
  eventCount: ledger.count(),
  remainingIssues: issues,
  databasePath,
}, null, 2))

ledger.close()

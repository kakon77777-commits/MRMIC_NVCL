import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CanvasStore } from '../../../packages/canvas-core/src/index.js'
import { SqliteEventLedger } from '../../../packages/event-ledger/src/index.js'
import { SvgCanvasAdapter } from '../../../packages/adapter-svg/src/index.js'
import type { CanvasTransaction } from '../../../packages/canvas-schema/src/index.js'
import { agent, createWorkspace, transactionId } from '../../cli/src/fixtures.js'
import { createSeedTransaction } from '../../web/src/server.js'

const artifacts = resolve(process.cwd(), 'artifacts')
mkdirSync(artifacts, { recursive: true })

const { workspace, rootCanvas } = createWorkspace()
workspace.title = 'MRMIC NVCL Phase 1 Demo'
workspace.schemaVersion = '0.2.0'
const ledger = new SqliteEventLedger(':memory:')
const store = new CanvasStore(workspace, rootCanvas, { eventSink: ledger })
const adapter = new SvgCanvasAdapter(store)

const deltas: unknown[] = []
adapter.subscribe((delta) => deltas.push(delta))

await adapter.applyTransaction(createSeedTransaction(rootCanvas.id))
const before = await adapter.render({ canvasId: rootCanvas.id, includeGrid: true })
writeFileSync(resolve(artifacts, 'phase1-before.svg'), before.svg)

const title = store.getObject('title')
const repair: CanvasTransaction = {
  id: transactionId(),
  canvasId: rootCanvas.id,
  actor: agent,
  intent: 'Phase 1 local patch demonstration',
  expectedOutcome: 'Only the title moves above the character',
  preconditions: [
    { type: 'canvas_revision', targetId: rootCanvas.id, expected: store.getCanvas(rootCanvas.id).revision },
    { type: 'object_revision', targetId: title.id, expected: title.revision },
  ],
  operations: [{
    op: 'patch_object',
    objectId: title.id,
    expectedRevision: title.revision,
    patch: { transform: { y: 55 } },
  }],
  mode: 'direct',
  createdAt: new Date().toISOString(),
}
await adapter.applyTransaction(repair)
const after = await adapter.render({ canvasId: rootCanvas.id, includeGrid: true })
writeFileSync(resolve(artifacts, 'phase1-after.svg'), after.svg)

const report = {
  phase: 1,
  version: '0.2.0',
  canvasRevision: store.getCanvas(rootCanvas.id).revision,
  objectCount: store.listObjects(rootCanvas.id).length,
  eventCount: ledger.count(),
  deltaCount: deltas.length,
  changedObject: store.getObject('title'),
  beforeSvg: 'artifacts/phase1-before.svg',
  afterSvg: 'artifacts/phase1-after.svg',
}
writeFileSync(resolve(artifacts, 'phase1-demo-report.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
ledger.close()

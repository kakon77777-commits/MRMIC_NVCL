import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPhase6Server } from '../../web/src/server.js'
import { LocalMcpCanvasClient } from '../../../packages/nvcl-runtime/src/index.js'

const artifacts = resolve(process.cwd(), 'artifacts')
const dataDir = resolve(artifacts, 'phase6-persistence')
mkdirSync(artifacts, { recursive: true })
rmSync(dataDir, { recursive: true, force: true })
mkdirSync(dataDir, { recursive: true })
const databasePath = resolve(dataDir, 'events.sqlite')
const syncDatabasePath = resolve(dataDir, 'sync.sqlite')

const box = (id: string, canvasId: string, x: number) => ({
  id, type: 'rectangle', transform: { x, y: 80, width: 180, height: 120, zIndex: 1 },
  style: { fill: '#ddd6fe', stroke: '#6d28d9', strokeWidth: 3 }, metadata: { role: 'phase6-proof' }, canvasId,
})

let app = createPhase6Server({ port: 0, databasePath, syncDatabasePath })
await app.start()
const client = new LocalMcpCanvasClient(app.mcp, { actorId: 'phase6-evidence-agent', role: 'owner' })

await client.callTool('canvas.create_objects', { canvasId: app.rootCanvas.id, objects: [box('phase6-root-proof', app.rootCanvas.id, 120)] })
const opened = await client.callTool<Record<string, unknown>>('canvas.open_subcanvas', {
  canvasId: app.rootCanvas.id,
  create: { objectId: 'phase6-portal', childCanvasId: 'phase6-child', title: 'Phase 6 Child', transform: { x: 520, y: 380, width: 320, height: 160, zIndex: 10 } },
})
await client.callTool('canvas.create_objects', { canvasId: 'phase6-child', objects: [box('phase6-child-proof', 'phase6-child', 60)] })
const snapshot = await client.callTool<{ snapshotId: string }>('canvas.create_snapshot', { canvasId: app.rootCanvas.id })
const snapshotId = snapshot.data?.snapshotId as string
const target = app.store.getObject('phase6-root-proof')
await client.callTool('canvas.patch_objects', { canvasId: app.rootCanvas.id, patches: [{ objectId: target.id, expectedRevision: target.revision, patch: { transform: { x: 840 } } }] })
const replacementEvents: unknown[] = []
const unsubscribe = app.registry.roomFor(app.rootCanvas.id).subscribe(event => { if (event.update?.kind === 'state_replace') replacementEvents.push(event) })
await client.callTool('canvas.restore_snapshot', { snapshotId })
unsubscribe()
app.mcp.registerTrajectory('phase6-persistent-trajectory', { status: 'completed', rootCanvasId: app.rootCanvas.id, childCanvasId: 'phase6-child' })

const rootSvgBeforeRestart = (await app.adapter.render({ canvasId: app.rootCanvas.id, includeGrid: true })).svg
const childSvgBeforeRestart = (await app.adapter.render({ canvasId: 'phase6-child', includeGrid: true })).svg
const beforeRestart = {
  snapshotId,
  replacementEvents: replacementEvents.length,
  rootObjectX: app.store.getObject('phase6-root-proof').transform.x,
  rootRoom: { id: app.registry.roomFor(app.rootCanvas.id).roomId, vector: app.registry.roomFor(app.rootCanvas.id).stateVector(), handle: app.registry.syncHandle(app.rootCanvas.id) },
  childRoom: { id: app.registry.roomFor('phase6-child').roomId, vector: app.registry.roomFor('phase6-child').stateVector(), handle: app.registry.syncHandle('phase6-child') },
  snapshots: app.ledger.snapshotCount(app.workspace.id),
  trajectories: app.ledger.listTrajectories(app.workspace.id).length,
}
await app.close()

app = createPhase6Server({ port: 0, databasePath, syncDatabasePath })
await app.start()
const afterRestart = {
  recoveredSnapshotId: app.recoveredSnapshotId,
  rootObjectX: app.store.getObject('phase6-root-proof').transform.x,
  childCanvasParent: app.store.getCanvas('phase6-child').parentCanvasId,
  childObjectCanvas: app.store.getObject('phase6-child-proof').canvasId,
  trajectory: app.ledger.getTrajectory('phase6-persistent-trajectory')?.trajectory,
  snapshots: app.ledger.snapshotCount(app.workspace.id),
  rootStateVector: app.registry.roomFor(app.rootCanvas.id).stateVector(),
  childStateVector: app.registry.roomFor('phase6-child').stateVector(),
}
const rootSvgAfterRestart = (await app.adapter.render({ canvasId: app.rootCanvas.id, includeGrid: true })).svg
const childSvgAfterRestart = (await app.adapter.render({ canvasId: 'phase6-child', includeGrid: true })).svg
await app.close()

const report = {
  phase: 6,
  version: '0.7.0',
  status: 'completed',
  openedSubcanvasSyncHandle: opened.data?.syncHandle,
  beforeRestart,
  afterRestart,
  assertions: {
    synchronizedRestoreObserved: replacementEvents.length > 0,
    restoredXMatchesSnapshot: beforeRestart.rootObjectX === 120,
    restartRecovered: Boolean(afterRestart.recoveredSnapshotId),
    childWorldRecovered: afterRestart.childCanvasParent === 'canvas-root' && afterRestart.childObjectCanvas === 'phase6-child',
    trajectoryRecovered: (afterRestart.trajectory as { status?: string } | undefined)?.status === 'completed',
    independentRooms: beforeRestart.rootRoom.id !== beforeRestart.childRoom.id,
  },
}
writeFileSync(resolve(artifacts, 'phase6-demo-report.json'), JSON.stringify(report, null, 2))
writeFileSync(resolve(artifacts, 'phase6-root-before-restart.svg'), rootSvgBeforeRestart)
writeFileSync(resolve(artifacts, 'phase6-child-before-restart.svg'), childSvgBeforeRestart)
writeFileSync(resolve(artifacts, 'phase6-root-after-restart.svg'), rootSvgAfterRestart)
writeFileSync(resolve(artifacts, 'phase6-child-after-restart.svg'), childSvgAfterRestart)
console.log(JSON.stringify(report, null, 2))

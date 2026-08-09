import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPhase5Server } from '../../web/src/server.js'
import { DirectoryNvclTraceSink, HttpMcpCanvasClient } from '../../../packages/nvcl-runtime/src/index.js'
import {
  DirectoryRecursiveTraceSink,
  REFERENCE_DETAIL_CHECKS,
  RecursiveNvclRuntime,
  ReferenceDetailNvclAgent,
} from '../../../packages/recursive-nvcl-runtime/src/index.js'

async function main(): Promise<void> {
  const app = createPhase5Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  const runId = 'phase5-recursive-run'
  const artifactDir = resolve(process.cwd(), 'artifacts')
  const recursiveDir = resolve(artifactDir, 'phase5-runs', runId)
  rmSync(recursiveDir, { recursive: true, force: true })
  mkdirSync(recursiveDir, { recursive: true })
  const trace = new DirectoryRecursiveTraceSink(resolve(artifactDir, 'phase5-runs'), runId)
  const childTrace = new DirectoryNvclTraceSink(resolve(recursiveDir, 'child-runs'), `${runId}:child`)
  const client = new HttpMcpCanvasClient(`${started.url}/mcp`, { actorId: 'nvcl-phase5-recursive-agent', role: 'owner' })
  const runtime = new RecursiveNvclRuntime({ client, trace })

  try {
    const result = await runtime.run({
      runId,
      goal: 'Delegate a character-detail study into a child canvas, verify it, fold it, and write its result back to the parent portal.',
      parentCanvasId: app.rootCanvas.id,
      portal: {
        objectId: 'character-detail-portal',
        childCanvasId: 'canvas-character-detail',
        title: 'Character Detail',
        transform: { x: 820, y: 560, width: 320, height: 160, zIndex: 20 },
        style: { fill: '#faf5ff', stroke: '#7c3aed', strokeWidth: 3 },
      },
      childGoal: 'Create a face detail with exactly two eyes, a mouth, and a label that does not obscure the face.',
      childChecks: REFERENCE_DETAIL_CHECKS,
      childAgent: new ReferenceDetailNvclAgent(),
      childMaxIterations: 6,
      childTrace,
    })
    if (result.childResult) app.mcp.registerTrajectory(result.childResult.runId, result.childResult)
    const trajectoryUri = app.mcp.registerTrajectory(result.runId, result)
    const parentRender = await app.adapter.render({ canvasId: app.rootCanvas.id, includeGrid: true })
    const childRender = result.childCanvasId
      ? await app.adapter.render({ canvasId: result.childCanvasId, includeGrid: true })
      : undefined
    const portal = result.portalObjectId ? app.store.getObject(result.portalObjectId) : undefined
    const report = {
      ...result,
      trajectoryUri,
      parentRevision: app.store.getCanvas(app.rootCanvas.id).revision,
      parentObjectCount: app.store.listObjects(app.rootCanvas.id).length,
      childObjectCount: result.childCanvasId ? app.store.listObjects(result.childCanvasId).length : 0,
      portalText: portal?.content?.text,
      portalFoldState: portal?.metadata.foldState,
      eventCount: app.ledger.count(),
      syncUpdates: app.room.updateCount(),
    }
    writeFileSync(resolve(artifactDir, 'phase5-demo-report.json'), JSON.stringify(report, null, 2))
    writeFileSync(resolve(artifactDir, 'phase5-parent-final.svg'), parentRender.svg)
    if (childRender) writeFileSync(resolve(artifactDir, 'phase5-child-final.svg'), childRender.svg)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await client.close?.()
    await app.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

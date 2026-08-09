import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPhase4Server } from '../../web/src/server.js'
import {
  DirectoryNvclTraceSink,
  HttpMcpCanvasClient,
  NvclRuntime,
  ReferenceSceneNvclAgent,
} from '../../../packages/nvcl-runtime/src/index.js'

async function main(): Promise<void> {
  const app = createPhase4Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  const runId = 'phase4-reference-run'
  const artifactDir = resolve(process.cwd(), 'artifacts')
  mkdirSync(artifactDir, { recursive: true })
  const runDirectory = resolve(artifactDir, 'phase4-runs', runId)
  rmSync(runDirectory, { recursive: true, force: true })
  const trace = new DirectoryNvclTraceSink(resolve(artifactDir, 'phase4-runs'), runId)
  const client = new HttpMcpCanvasClient(`${started.url}/mcp`, { actorId: 'nvcl-phase4-agent', role: 'owner' })
  const runtime = new NvclRuntime({ client, agent: new ReferenceSceneNvclAgent(), trace })

  try {
    const result = await runtime.run({
      runId,
      goal: 'Create a title, character, moon, ground, and exactly three stars. Keep the title from obscuring the character and repair only the failing region.',
      canvasId: app.rootCanvas.id,
      maxIterations: 6,
      checks: [
        { type: 'count', role: 'star', expected: 3, rule: 'three_stars' },
        { type: 'max_overlap', foregroundId: 'title', backgroundId: 'character', maximum: 0.10 },
        { type: 'inside_bounds', objectId: 'title', bounds: { x: 0, y: 0, width: 1200, height: 800 } },
      ],
    })
    const trajectoryUri = app.mcp.registerTrajectory(result.runId, result)
    const render = await app.adapter.render({ canvasId: app.rootCanvas.id, includeGrid: true })
    const report = {
      ...result,
      objectCount: app.store.listObjects(app.rootCanvas.id).length,
      titleY: app.store.getObject('title').transform.y,
      starCount: app.store.listObjects(app.rootCanvas.id).filter(object => object.metadata.role === 'star').length,
      eventCount: app.ledger.count(),
      syncUpdates: app.room.updateCount(),
      traceDirectory: trace.root,
      trajectoryUri,
    }
    writeFileSync(resolve(artifactDir, 'phase4-demo-report.json'), JSON.stringify(report, null, 2))
    writeFileSync(resolve(artifactDir, 'phase4-final.svg'), render.svg)
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createPhase3Server } from '../../web/src/server.js'

interface RpcResponse { jsonrpc: '2.0'; id: number | string | null; result?: any; error?: any }

async function main() {
  const app = createPhase3Server({ port: 0, databasePath: ':memory:', syncDatabasePath: ':memory:' })
  const started = await app.start()
  let sessionId = ''
  let nextId = 1

  async function rpc(method: string, params: Record<string, unknown> = {}, headers: Record<string, string> = {}): Promise<RpcResponse> {
    const response = await fetch(`${started.url}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'Mcp-Session-Id': sessionId } : {}),
        ...headers,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    })
    const receivedSession = response.headers.get('mcp-session-id')
    if (receivedSession) sessionId = receivedSession
    return await response.json() as RpcResponse
  }

  try {
    const initialized = await rpc('initialize', {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase3-demo', version: '0.4.0' },
    }, { 'x-mrmic-role': 'owner', 'x-mrmic-actor-id': 'phase3-demo-agent' })

    await fetch(`${started.url}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'Mcp-Session-Id': sessionId },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    })

    const tools = await rpc('tools/list')
    const resources = await rpc('resources/list')
    const canvasId = app.rootCanvas.id
    const create = await rpc('tools/call', { name: 'canvas.create_objects', arguments: {
      canvasId, intent: 'Create Phase 3 MCP-native validation scene',
      objects: [
        { id: 'character', type: 'ellipse', transform: { x: 410, y: 220, width: 260, height: 350, zIndex: 5 }, style: { fill: '#f9a8d4', stroke: '#9d174d', strokeWidth: 3 }, metadata: { role: 'character' } },
        { id: 'moon', type: 'ellipse', transform: { x: 760, y: 90, width: 180, height: 180, zIndex: 2 }, style: { fill: '#fde68a', stroke: '#d97706', strokeWidth: 3 }, metadata: { role: 'moon' } },
        { id: 'title', type: 'text', transform: { x: 390, y: 230, width: 370, height: 70, zIndex: 12 }, style: { fill: '#312e81', fontSize: 38 }, content: { text: 'MCP Native Canvas' }, metadata: { role: 'title' } },
        { id: 'star-1', type: 'text', transform: { x: 170, y: 110, width: 50, height: 50, zIndex: 4 }, style: { fill: '#f59e0b', fontSize: 44 }, content: { text: '★' }, metadata: { role: 'star' } },
        { id: 'star-2', type: 'text', transform: { x: 290, y: 70, width: 50, height: 50, zIndex: 4 }, style: { fill: '#f59e0b', fontSize: 44 }, content: { text: '★' }, metadata: { role: 'star' } },
        { id: 'star-3', type: 'text', transform: { x: 1010, y: 190, width: 50, height: 50, zIndex: 4 }, style: { fill: '#f59e0b', fontSize: 44 }, content: { text: '★' }, metadata: { role: 'star' } },
      ],
    } })

    const beforeVerify = await rpc('tools/call', { name: 'canvas.verify', arguments: { canvasId, checks: [
      { type: 'count', role: 'star', expected: 3, rule: 'three_stars' },
      { type: 'max_overlap', foregroundId: 'title', backgroundId: 'character', maximum: 0.10 },
    ] } })

    const titleRevision = app.store.getObject('title').revision
    const patch = await rpc('tools/call', { name: 'canvas.patch_objects', arguments: {
      canvasId, intent: 'Move only the title above the character', expectedCanvasRevision: app.store.getCanvas(canvasId).revision,
      patches: [{ objectId: 'title', expectedRevision: titleRevision, patch: { transform: { y: 55 } } }],
    } })

    const afterVerify = await rpc('tools/call', { name: 'canvas.verify', arguments: { canvasId, checks: [
      { type: 'count', role: 'star', expected: 3, rule: 'three_stars' },
      { type: 'max_overlap', foregroundId: 'title', backgroundId: 'character', maximum: 0.10 },
    ] } })

    const snapshot = await rpc('tools/call', { name: 'canvas.create_snapshot', arguments: { canvasId } })
    const resourceUri = `canvas://workspace/${encodeURIComponent(app.workspace.id)}/canvas/${encodeURIComponent(canvasId)}/render/current.svg`
    const render = await rpc('resources/read', { uri: resourceUri })

    const report = {
      protocolVersion: initialized.result?.protocolVersion,
      sessionId,
      toolCount: tools.result?.tools?.length,
      resourceCount: resources.result?.resources?.length,
      createOk: create.result?.structuredContent?.ok,
      syncUpdates: app.room.updateCount(),
      beforeIssues: beforeVerify.result?.structuredContent?.data?.issues?.length,
      afterIssues: afterVerify.result?.structuredContent?.data?.issues?.length,
      titleY: app.store.getObject('title').transform.y,
      canvasRevision: app.store.getCanvas(canvasId).revision,
      eventCount: app.ledger.count(),
      snapshotId: snapshot.result?.structuredContent?.data?.snapshotId,
      renderMimeType: render.result?.contents?.[0]?.mimeType,
      patchTransactionId: patch.result?.structuredContent?.transactionId,
    }

    const artifactDir = resolve(process.cwd(), 'artifacts')
    mkdirSync(artifactDir, { recursive: true })
    writeFileSync(resolve(artifactDir, 'phase3-demo-report.json'), JSON.stringify(report, null, 2))
    writeFileSync(resolve(artifactDir, 'phase3-render.svg'), String(render.result?.contents?.[0]?.text ?? ''))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    await app.close()
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })

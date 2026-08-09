import test from 'node:test'
import assert from 'node:assert/strict'
import { createPhase3Server } from '../dist/apps/web/src/server.js'

test('Phase 7 web API preserves seed, render, and local repair compatibility', async () => {
  const app = createPhase3Server({ port: 0, databasePath: ':memory:' })
  const { url } = await app.start()
  try {
    let response = await fetch(`${url}/`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /互動式多模態畫布實驗室/)

    response = await fetch(`${url}/api/demo/seed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 200)

    response = await fetch(`${url}/api/state`)
    const seeded = await response.json()
    assert.equal(seeded.objects.length, 8)
    assert.equal(seeded.canvas.revision, 1)
    const beforeById = new Map(seeded.objects.map(object => [object.id, object]))
    assert.equal(beforeById.get('title').transform.y, 225)

    response = await fetch(`${url}/api/demo/repair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 200)

    response = await fetch(`${url}/api/state`)
    const repaired = await response.json()
    assert.equal(repaired.canvas.revision, 2)
    const afterById = new Map(repaired.objects.map(object => [object.id, object]))
    assert.equal(afterById.get('title').transform.y, 55)
    assert.deepEqual(afterById.get('moon'), beforeById.get('moon'))
    assert.equal(repaired.eventCount, 2)

    response = await fetch(`${url}/api/render.svg`)
    const svg = await response.text()
    assert.equal(response.headers.get('content-type').startsWith('image/svg+xml'), true)
    assert.match(svg, /Native Visual Canvas/)
    assert.match(svg, /data-object-id="moon"/)
  } finally {
    await app.close()
  }
})

test('Phase 6 web API creates a one-level subcanvas portal', async () => {
  const app = createPhase3Server({ port: 0, databasePath: ':memory:' })
  const { url } = await app.start()
  try {
    await fetch(`${url}/api/demo/seed`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const response = await fetch(`${url}/api/demo/subcanvas`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 200)
    const state = await (await fetch(`${url}/api/state`)).json()
    const portal = state.objects.find(object => object.id === 'subcanvas-portal')
    assert.equal(portal.type, 'subcanvas')
    assert.equal(portal.content.childCanvasId, 'canvas-detail')
  } finally {
    await app.close()
  }
})

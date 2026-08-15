import test from 'node:test'
import assert from 'node:assert/strict'
import { LiveSurfaceBudget, worldTransformToOverlayRect } from '../dist/packages/portal-overlay/src/index.js'

const viewport = { x: 100, y: 50, width: 1200, height: 800, zoom: 2 }
const client = { left: 10, top: 20, width: 1200, height: 800 }
const transform = { x: 130, y: 90, width: 200, height: 100, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 1 }

test('maps canvas world coordinates to live overlay screen geometry', () => {
  const rect = worldTransformToOverlayRect(transform, viewport, client)
  assert.deepEqual(rect, { left: 70, top: 100, width: 400, height: 200, visible: true })
})

test('overlay geometry reports offscreen portals without deleting them', () => {
  const rect = worldTransformToOverlayRect({ ...transform, x: -1000, y: -1000 }, viewport, client)
  assert.equal(rect.visible, false)
  assert.equal(rect.width, 400)
})

test('live surface budget evicts least-recently-used portals', () => {
  const budget = new LiveSurfaceBudget(2)
  assert.deepEqual(budget.activate('browser-a'), { active: ['browser-a'], evicted: [] })
  budget.activate('browser-b')
  budget.touch('browser-a')
  const third = budget.activate('browser-c')
  assert.deepEqual(third.evicted, ['browser-b'])
  assert.deepEqual(third.active, ['browser-c', 'browser-a'])
})

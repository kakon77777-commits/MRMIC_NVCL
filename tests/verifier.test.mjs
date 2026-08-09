import test from 'node:test'
import assert from 'node:assert/strict'
import { overlapRatio, verifyCount, verifyMaxOverlap } from '../dist/packages/verifier/src/index.js'

const actor = { actorType: 'agent', actorId: 'test' }
const now = new Date().toISOString()
function shape(id, x, y, width, height, role) {
  return {
    id, canvasId: 'root', type: 'rectangle',
    transform: { x, y, width, height, rotation: 0, scaleX: 1, scaleY: 1, zIndex: 0 },
    style: {}, childIds: [], bindings: [], metadata: { role }, createdBy: actor,
    createdAt: now, updatedAt: now, revision: 0,
  }
}

test('calculates overlap and emits deterministic issues', () => {
  const a = shape('a', 0, 0, 100, 100, 'title')
  const b = shape('b', 50, 0, 100, 100, 'character')
  assert.equal(overlapRatio(a, b), 0.5)
  assert.equal(verifyMaxOverlap(a, b, 0.1).length, 1)
})

test('verifies object counts', () => {
  const objects = [shape('s1', 0, 0, 10, 10, 'star'), shape('s2', 20, 0, 10, 10, 'star')]
  assert.equal(verifyCount(objects, (item) => item.metadata.role === 'star', 2).length, 0)
  assert.equal(verifyCount(objects, (item) => item.metadata.role === 'star', 3).length, 1)
})

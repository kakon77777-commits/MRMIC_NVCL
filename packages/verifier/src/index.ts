import { boundsOf, type Bounds, type CanvasObject } from '../../canvas-schema/src/index.js'

export interface VerificationIssue {
  id: string
  severity: 'info' | 'warning' | 'error'
  rule: string
  objectIds: string[]
  message: string
}

function intersectionArea(a: Bounds, b: Bounds): number {
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))
  return width * height
}

export function overlapRatio(a: CanvasObject, b: CanvasObject): number {
  const aBounds = boundsOf(a)
  const area = Math.max(1, aBounds.width * aBounds.height)
  return intersectionArea(aBounds, boundsOf(b)) / area
}

export function verifyCount(
  objects: CanvasObject[],
  predicate: (object: CanvasObject) => boolean,
  expected: number,
  rule = 'count',
): VerificationIssue[] {
  const matches = objects.filter(predicate)
  if (matches.length === expected) return []
  return [{
    id: `${rule}:${expected}:${matches.length}`,
    severity: 'error',
    rule,
    objectIds: matches.map((object) => object.id),
    message: `Expected ${expected} matching objects, found ${matches.length}`,
  }]
}

export function verifyMaxOverlap(
  foreground: CanvasObject,
  background: CanvasObject,
  maximum: number,
  rule = 'max_overlap',
): VerificationIssue[] {
  const ratio = overlapRatio(foreground, background)
  if (ratio <= maximum) return []
  return [{
    id: `${rule}:${foreground.id}:${background.id}`,
    severity: 'error',
    rule,
    objectIds: [foreground.id, background.id],
    message: `Overlap ratio ${ratio.toFixed(3)} exceeds ${maximum.toFixed(3)}`,
  }]
}

export function verifyInsideBounds(object: CanvasObject, bounds: Bounds): VerificationIssue[] {
  const value = boundsOf(object)
  const inside = value.x >= bounds.x
    && value.y >= bounds.y
    && value.x + value.width <= bounds.x + bounds.width
    && value.y + value.height <= bounds.y + bounds.height
  if (inside) return []
  return [{
    id: `inside_bounds:${object.id}`,
    severity: 'warning',
    rule: 'inside_bounds',
    objectIds: [object.id],
    message: `Object ${object.id} is outside the declared canvas bounds`,
  }]
}

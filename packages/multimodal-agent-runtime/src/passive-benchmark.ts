import { createHash } from 'node:crypto'
import type {
  GestureCoordinateSpace,
  LabObservation,
  MultimodalCanvasLab,
  PixelGesture,
} from '../../multimodal-lab/src/index.js'
import type { PassiveSceneEventDisposition } from './passive.js'
import { PassiveObservationScheduler } from './passive.js'

export type PassiveBenchmarkSeedClass = 'fixed' | 'held_out'

export interface PassiveSceneBenchmarkRunnerOptions {
  lab: MultimodalCanvasLab
  scheduler: PassiveObservationScheduler
  advanceTime?: (milliseconds: number) => void | Promise<void>
  actionSpacingMs?: number
  settleMs?: number
}

export interface PassiveSceneBenchmarkStep {
  index: number
  actionId: string
  gestureKind: PixelGesture['kind']
  coordinateSpace: GestureCoordinateSpace
  freshnessMs: number
  freshnessVerified: boolean
  transitionGuard: 'passed' | 'failed'
  verifiedChange: boolean
  beforeRenderSha256: string
  afterRenderSha256: string
  observedSceneEpoch: number
  observationDisposition: string
}

export interface PassiveSceneBenchmarkResult {
  protocolVersion: 'mrmic-passive-scene-timeline-v1'
  runId: string
  seed: number
  seedClass: PassiveBenchmarkSeedClass
  planSha256: string
  actionKinds: PixelGesture['kind'][]
  steps: PassiveSceneBenchmarkStep[]
  actions: number
  freshnessPassed: number
  transitionGuardsPassed: number
  samples: number
  sceneEpochs: number
  emittedEvents: number
  coalescedSamples: number
  providerDeliveriesAvoided: number
  eventCounts: Record<PassiveSceneEventDisposition, number>
  alwaysFullBytes: number
  deliveredBytes: number
  savedBytes: number
  savedPercent: number
  passed: boolean
}

interface PlannedGesture {
  kind: PixelGesture['kind']
  coordinateSpace: GestureCoordinateSpace
  gesture: PixelGesture
}

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function planFor(seed: number): PlannedGesture[] {
  const random = randomGenerator(seed)
  const moveDelta = 72 + Math.floor(random() * 35)
  const movedCenterX = 145 + moveDelta
  const resizeDelta = 28 + Math.floor(random() * 30)
  const pathOffset = Math.floor(random() * 36)
  const palette = [
    { fill: '#7c3aed', stroke: '#4c1d95', strokeWidth: 5 },
    { fill: '#db2777', stroke: '#831843', strokeWidth: 5 },
    { fill: '#0891b2', stroke: '#164e63', strokeWidth: 5 },
  ]
  const style = palette[Math.floor(random() * palette.length)]!
  return [
    {
      kind: 'drag',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'drag', from: { x: 145, y: 285 }, to: { x: movedCenterX, y: 285 } },
    },
    {
      kind: 'restyle',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'restyle', at: { x: movedCenterX, y: 285 }, style },
    },
    {
      kind: 'resize',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'resize',
        from: { x: 650, y: 360 },
        to: { x: 650 + resizeDelta, y: 360 + resizeDelta },
      },
    },
    {
      kind: 'type_text',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'type_text', at: { x: 100, y: 75 }, text: `Passive scene ${seed}` },
    },
    {
      kind: 'draw_path',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'draw_path',
        points: [
          { x: 760, y: 440 + pathOffset },
          { x: 810, y: 475 + pathOffset },
          { x: 865, y: 425 + pathOffset },
        ],
        style: { fill: 'none', stroke: '#0f766e', strokeWidth: 6 },
      },
    },
    {
      kind: 'delete',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'delete', at: { x: 527, y: 512 } },
    },
    {
      kind: 'pan',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'pan',
        from: { x: 600, y: 400 },
        to: { x: 648 + Math.floor(random() * 24), y: 428 + Math.floor(random() * 20) },
      },
    },
    {
      kind: 'zoom',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'zoom', at: { x: 600, y: 400 }, factor: 1.08 + random() * 0.12 },
    },
  ]
}

function planSha256(plan: PlannedGesture[]): string {
  return createHash('sha256').update(JSON.stringify(plan)).digest('hex')
}

export class PassiveSceneBenchmarkRunner {
  readonly #lab: MultimodalCanvasLab
  readonly #scheduler: PassiveObservationScheduler
  readonly #advanceTime: (milliseconds: number) => void | Promise<void>
  readonly #actionSpacingMs: number
  readonly #settleMs: number

  constructor(options: PassiveSceneBenchmarkRunnerOptions) {
    this.#lab = options.lab
    this.#scheduler = options.scheduler
    this.#advanceTime = options.advanceTime ?? (() => undefined)
    this.#actionSpacingMs = Math.max(1, Math.floor(options.actionSpacingMs ?? 40))
    this.#settleMs = Math.max(this.#actionSpacingMs, Math.floor(options.settleMs ?? 300))
  }

  async run(options: {
    runId?: string
    seed?: number
    seedClass?: PassiveBenchmarkSeedClass
  } = {}): Promise<PassiveSceneBenchmarkResult> {
    const seed = Math.floor(options.seed ?? 10) >>> 0
    const seedClass = options.seedClass ?? 'fixed'
    const runId = options.runId?.trim() || `phase10-passive-${seedClass}-${seed}`
    const plan = planFor(seed)
    const steps: PassiveSceneBenchmarkStep[] = []
    let alwaysFullBytes = 0

    const blank = await this.#lab.observe('pixel')
    const reset = await this.#lab.resetBenchmark(`${runId}:reset`, blank.frameId, 'pixel')
    const viewport = reset.observation.viewport
    if (
      viewport.x !== 0 ||
      viewport.y !== 0 ||
      viewport.zoom !== 1 ||
      viewport.width !== reset.observation.width ||
      viewport.height !== reset.observation.height
    ) {
      await this.#lab.execute({
        actionId: `${runId}:reset-viewport`,
        frameId: reset.observation.frameId,
        canvasId: reset.observation.canvasId,
        expectedCanvasRevision: reset.observation.canvasRevision,
        type: 'viewport',
        viewport: {
          x: 0,
          y: 0,
          zoom: 1,
          width: reset.observation.width,
          height: reset.observation.height,
        },
      }, 'pixel')
    }
    this.#scheduler.reset()
    let sampled = await this.#scheduler.sample()
    alwaysFullBytes += sampled.sample.governance.sourceByteLength
    let current: LabObservation = sampled.sample.observation

    for (const [index, item] of plan.entries()) {
      const actionId = `${runId}:gesture:${index + 1}`
      const result = await this.#lab.execute({
        actionId,
        frameId: current.frameId,
        canvasId: current.canvasId,
        expectedCanvasRevision: current.canvasRevision,
        type: 'gesture',
        coordinateSpace: item.coordinateSpace,
        gesture: structuredClone(item.gesture),
      }, 'pixel')
      await this.#advanceTime(this.#actionSpacingMs)
      sampled = await this.#scheduler.sample()
      alwaysFullBytes += sampled.sample.governance.sourceByteLength
      current = sampled.sample.observation
      steps.push({
        index: index + 1,
        actionId,
        gestureKind: item.kind,
        coordinateSpace: item.coordinateSpace,
        freshnessMs: result.evidence.freshnessMs,
        freshnessVerified: result.evidence.freshnessVerified,
        transitionGuard: result.evidence.transitionGuard,
        verifiedChange: result.evidence.verifiedChange,
        beforeRenderSha256: result.evidence.beforeRenderSha256,
        afterRenderSha256: result.evidence.afterRenderSha256,
        observedSceneEpoch: sampled.sample.sceneEpoch,
        observationDisposition: sampled.sample.governance.disposition,
      })
    }

    await this.#advanceTime(this.#settleMs)
    sampled = await this.#scheduler.sample()
    alwaysFullBytes += sampled.sample.governance.sourceByteLength
    await this.#advanceTime(this.#actionSpacingMs)
    sampled = await this.#scheduler.sample()
    alwaysFullBytes += sampled.sample.governance.sourceByteLength
    await this.#scheduler.flush()

    const stats = this.#scheduler.stats
    const eventCounts: Record<PassiveSceneEventDisposition, number> = { keyframe: 0, full_frame: 0, roi: 0 }
    for (const event of this.#scheduler.timeline) eventCounts[event.disposition] += 1
    const freshnessPassed = steps.filter(step => step.freshnessVerified).length
    const transitionGuardsPassed = steps.filter(step => step.transitionGuard === 'passed' && step.verifiedChange).length
    const deliveredBytes = stats.deliveredBytes
    const savedBytes = alwaysFullBytes - deliveredBytes
    const result: PassiveSceneBenchmarkResult = {
      protocolVersion: 'mrmic-passive-scene-timeline-v1',
      runId,
      seed,
      seedClass,
      planSha256: planSha256(plan),
      actionKinds: plan.map(item => item.kind),
      steps,
      actions: steps.length,
      freshnessPassed,
      transitionGuardsPassed,
      samples: stats.samples,
      sceneEpochs: stats.sceneEpoch,
      emittedEvents: stats.emittedEvents,
      coalescedSamples: stats.coalescedSamples,
      providerDeliveriesAvoided: Math.max(0, stats.samples - stats.emittedEvents),
      eventCounts,
      alwaysFullBytes,
      deliveredBytes,
      savedBytes,
      savedPercent: alwaysFullBytes ? savedBytes / alwaysFullBytes * 100 : 0,
      passed: freshnessPassed === steps.length
        && transitionGuardsPassed === steps.length
        && stats.emittedEvents < stats.samples,
    }
    if (JSON.stringify(result).includes('objectId')) {
      throw new Error('Passive benchmark result leaked a forbidden object identifier')
    }
    return result
  }
}

import type { LabObservation, MultimodalCanvasLab } from '../../multimodal-lab/src/index.js'
import { ObservationGovernor, type GovernedObservation, type ObservationDisposition } from './governor.js'

export interface SustainedObservationBenchmarkOptions {
  lab: MultimodalCanvasLab
  governor: ObservationGovernor
  runId?: string
  seed?: number
  staticFramesBefore?: number
  localMoves?: number
  staticFramesAfter?: number
}

export interface SustainedObservationBenchmarkStep {
  index: number
  event: 'initial' | 'static' | 'local_move' | 'global_pan'
  disposition: ObservationDisposition
  reason: string
  differenceScore: number
  changedFraction: number
  sourceByteLength: number
  deliveredByteLength: number
  crop?: { x: number; y: number; width: number; height: number }
}

export interface SustainedObservationBenchmarkResult {
  runId: string
  seed: number
  steps: SustainedObservationBenchmarkStep[]
  counts: Record<ObservationDisposition, number>
  alwaysFullBytes: number
  governedBytes: number
  savedBytes: number
  savedPercent: number
  providerCallsAvoided: number
}

function boundedCount(value: number | undefined, fallback: number): number {
  return Math.max(0, Math.min(20, Math.floor(value ?? fallback)))
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

export class SustainedObservationBenchmarkRunner {
  readonly #lab: MultimodalCanvasLab
  readonly #governor: ObservationGovernor

  constructor(options: Pick<SustainedObservationBenchmarkOptions, 'lab' | 'governor'>) {
    this.#lab = options.lab
    this.#governor = options.governor
  }

  async run(options: Omit<SustainedObservationBenchmarkOptions, 'lab' | 'governor'> = {}): Promise<SustainedObservationBenchmarkResult> {
    const runId = options.runId?.trim() || `phase9-governor-${Date.now()}`
    const seed = Math.floor(options.seed ?? 9) >>> 0
    const random = randomGenerator(seed)
    const staticFramesBefore = boundedCount(options.staticFramesBefore, 2)
    const localMoves = boundedCount(options.localMoves, 2)
    const staticFramesAfter = boundedCount(options.staticFramesAfter, 3)
    const steps: SustainedObservationBenchmarkStep[] = []
    this.#governor.reset()

    const initial = await this.#lab.observe('pixel')
    const reset = await this.#lab.resetBenchmark(`${runId}:reset`, initial.frameId, 'pixel')
    let current = reset.observation
    await this.#record(steps, 'initial', current)

    for (let index = 0; index < staticFramesBefore; index += 1) {
      current = await this.#lab.observe('pixel')
      await this.#record(steps, 'static', current)
    }

    let targetX = 145
    const targetY = 285
    for (let index = 0; index < localMoves; index += 1) {
      const delta = 45 + Math.floor(random() * 36)
      const result = await this.#lab.execute({
        actionId: `${runId}:move:${index}`,
        frameId: current.frameId,
        canvasId: current.canvasId,
        expectedCanvasRevision: current.canvasRevision,
        type: 'gesture',
        coordinateSpace: 'frame_pixel',
        gesture: { kind: 'drag', from: { x: targetX, y: targetY }, to: { x: targetX + delta, y: targetY } },
      }, 'pixel')
      targetX += delta
      current = result.observation
      await this.#record(steps, 'local_move', current)
    }

    const pan = await this.#lab.execute({
      actionId: `${runId}:pan`,
      frameId: current.frameId,
      canvasId: current.canvasId,
      expectedCanvasRevision: current.canvasRevision,
      type: 'gesture',
      coordinateSpace: 'normalized_frame',
      gesture: { kind: 'pan', from: { x: 0.5, y: 0.5 }, to: { x: 0.62, y: 0.56 } },
    }, 'pixel')
    current = pan.observation
    await this.#record(steps, 'global_pan', current)

    for (let index = 0; index < staticFramesAfter; index += 1) {
      current = await this.#lab.observe('pixel')
      await this.#record(steps, 'static', current)
    }

    const counts: Record<ObservationDisposition, number> = { keyframe: 0, full_frame: 0, roi: 0, skip: 0 }
    let alwaysFullBytes = 0
    let governedBytes = 0
    for (const step of steps) {
      counts[step.disposition] += 1
      alwaysFullBytes += step.sourceByteLength
      governedBytes += step.deliveredByteLength
    }
    const savedBytes = alwaysFullBytes - governedBytes
    return {
      runId,
      seed,
      steps,
      counts,
      alwaysFullBytes,
      governedBytes,
      savedBytes,
      savedPercent: alwaysFullBytes ? savedBytes / alwaysFullBytes * 100 : 0,
      providerCallsAvoided: counts.skip,
    }
  }

  async #record(
    steps: SustainedObservationBenchmarkStep[],
    event: SustainedObservationBenchmarkStep['event'],
    observation: LabObservation,
  ): Promise<void> {
    const decision: GovernedObservation = await this.#governor.observe(observation.frameId)
    steps.push({
      index: steps.length + 1,
      event,
      disposition: decision.disposition,
      reason: decision.reason,
      differenceScore: decision.differenceScore,
      changedFraction: decision.changedFraction,
      sourceByteLength: decision.sourceByteLength,
      deliveredByteLength: decision.raster?.observation.byteLength ?? 0,
      ...(decision.crop ? { crop: structuredClone(decision.crop) } : {}),
    })
  }
}

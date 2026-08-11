import { randomUUID } from 'node:crypto'
import type {
  LabObservation,
  LabRasterFrame,
  LabRasterObservation,
  MultimodalCanvasLab,
  RasterCrop,
} from '../../multimodal-lab/src/index.js'
import { ObservationGovernor, type GovernedObservation, type ObservationDisposition } from './governor.js'

export type PassiveSceneEventDisposition = Exclude<ObservationDisposition, 'skip'>

export interface PassiveObservationSchedulerOptions {
  lab: MultimodalCanvasLab
  governor: ObservationGovernor
  timelineId?: string
  coalesceWindowMs?: number
  maxCoalescedSamples?: number
  maxCoalescedRoiFraction?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
}

export interface PassiveObservationSample {
  sampleIndex: number
  sampledAt: string
  sceneEpoch: number
  sceneChanged: boolean
  observation: LabObservation
  governance: Omit<GovernedObservation, 'raster'>
}

export interface PassiveSceneEvent {
  timelineId: string
  eventIndex: number
  sceneEpochStart: number
  sceneEpochEnd: number
  sampleIndexStart: number
  sampleIndexEnd: number
  sampleCount: number
  observedAtStart: string
  observedAtEnd: string
  disposition: PassiveSceneEventDisposition
  reason: string
  reasons: string[]
  differenceScoreMax: number
  changedFractionMax: number
  resynchronization: boolean
  sourceFrameId: string
  sourceRasterSha256: string
  raster: LabRasterObservation
  crop?: RasterCrop
}

export interface PassiveObservationStats {
  timelineId: string
  samples: number
  sceneEpoch: number
  sceneChanges: number
  keyframes: number
  fullFrames: number
  roiFrames: number
  skippedFrames: number
  emittedEvents: number
  coalescedSamples: number
  deliveredBytes: number
  pendingSamples: number
  elapsedMs: number
}

export interface PassiveObservationResult {
  sample: PassiveObservationSample
  emitted: PassiveSceneEvent[]
  stats: PassiveObservationStats
}

export interface PassiveObservationRunRequest {
  maxSamples?: number
  sampleIntervalMs?: number
  signal?: AbortSignal
  onEvent?: (event: PassiveSceneEvent) => void | Promise<void>
}

export interface PassiveObservationRunResult {
  status: 'completed' | 'aborted'
  events: PassiveSceneEvent[]
  stats: PassiveObservationStats
}

interface PendingSample {
  sampledAtMs: number
  sample: PassiveObservationSample
  decision: GovernedObservation
}

function positiveInteger(value: number, fallback: number, label: string): number {
  const selected = Number.isFinite(value) ? Math.floor(value) : fallback
  if (selected < 1) throw new Error(`${label} must be a positive integer`)
  return selected
}

function nonNegative(value: number, fallback: number, label: string): number {
  const selected = Number.isFinite(value) ? value : fallback
  if (selected < 0) throw new Error(`${label} must be non-negative`)
  return selected
}

function ratio(value: number, fallback: number, label: string): number {
  const selected = Number.isFinite(value) ? value : fallback
  if (selected <= 0 || selected > 1) throw new Error(`${label} must stay within (0, 1]`)
  return selected
}

function unionCrops(crops: RasterCrop[], width: number, height: number): RasterCrop {
  const x = Math.max(0, Math.min(...crops.map(crop => crop.x)))
  const y = Math.max(0, Math.min(...crops.map(crop => crop.y)))
  const right = Math.min(width, Math.max(...crops.map(crop => crop.x + crop.width)))
  const bottom = Math.min(height, Math.max(...crops.map(crop => crop.y + crop.height)))
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) }
}

export class PassiveObservationScheduler {
  readonly #lab: MultimodalCanvasLab
  readonly #governor: ObservationGovernor
  readonly #timelineId: string
  readonly #coalesceWindowMs: number
  readonly #maxCoalescedSamples: number
  readonly #maxCoalescedRoiFraction: number
  readonly #now: () => number
  readonly #sleep: (milliseconds: number) => Promise<void>
  readonly #events: PassiveSceneEvent[] = []
  readonly #pending: PendingSample[] = []
  #startedAtMs: number
  #samples = 0
  #sceneEpoch = 0
  #sceneChanges = 0
  #keyframes = 0
  #fullFrames = 0
  #roiFrames = 0
  #skippedFrames = 0
  #coalescedSamples = 0
  #deliveredBytes = 0

  constructor(options: PassiveObservationSchedulerOptions) {
    this.#lab = options.lab
    this.#governor = options.governor
    this.#timelineId = options.timelineId?.trim() || `passive-${randomUUID()}`
    this.#coalesceWindowMs = nonNegative(options.coalesceWindowMs ?? 250, 250, 'coalesceWindowMs')
    this.#maxCoalescedSamples = positiveInteger(options.maxCoalescedSamples ?? 8, 8, 'maxCoalescedSamples')
    this.#maxCoalescedRoiFraction = ratio(options.maxCoalescedRoiFraction ?? 0.55, 0.55, 'maxCoalescedRoiFraction')
    this.#now = options.now ?? Date.now
    this.#sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)))
    this.#startedAtMs = this.#now()
  }

  get timelineId(): string {
    return this.#timelineId
  }

  get timeline(): PassiveSceneEvent[] {
    return structuredClone(this.#events)
  }

  get stats(): PassiveObservationStats {
    return {
      timelineId: this.#timelineId,
      samples: this.#samples,
      sceneEpoch: this.#sceneEpoch,
      sceneChanges: this.#sceneChanges,
      keyframes: this.#keyframes,
      fullFrames: this.#fullFrames,
      roiFrames: this.#roiFrames,
      skippedFrames: this.#skippedFrames,
      emittedEvents: this.#events.length,
      coalescedSamples: this.#coalescedSamples,
      deliveredBytes: this.#deliveredBytes,
      pendingSamples: this.#pending.length,
      elapsedMs: Math.max(0, this.#now() - this.#startedAtMs),
    }
  }

  reset(): void {
    this.#governor.reset()
    this.#events.length = 0
    this.#pending.length = 0
    this.#startedAtMs = this.#now()
    this.#samples = 0
    this.#sceneEpoch = 0
    this.#sceneChanges = 0
    this.#keyframes = 0
    this.#fullFrames = 0
    this.#roiFrames = 0
    this.#skippedFrames = 0
    this.#coalescedSamples = 0
    this.#deliveredBytes = 0
  }

  async sample(): Promise<PassiveObservationResult> {
    const sampledAtMs = this.#now()
    const observation = await this.#lab.observe('pixel')
    const decision = await this.#governor.observe(observation.frameId)
    this.#samples += 1
    if (decision.disposition === 'keyframe') this.#keyframes += 1
    else if (decision.disposition === 'full_frame') this.#fullFrames += 1
    else if (decision.disposition === 'roi') this.#roiFrames += 1
    else this.#skippedFrames += 1

    const sceneChanged = decision.sequence === 1
      || (decision.disposition !== 'skip' && (decision.differenceScore > 0 || decision.changedFraction > 0))
    if (sceneChanged) {
      this.#sceneEpoch += 1
      this.#sceneChanges += 1
    }
    const { raster: _raster, ...governance } = decision
    const sample: PassiveObservationSample = {
      sampleIndex: this.#samples,
      sampledAt: new Date(sampledAtMs).toISOString(),
      sceneEpoch: this.#sceneEpoch,
      sceneChanged,
      observation,
      governance,
    }
    const emitted: PassiveSceneEvent[] = []

    if (decision.disposition === 'keyframe') {
      this.#pending.push({ sampledAtMs, sample, decision })
      emitted.push(await this.#flushPending())
    } else if (decision.disposition === 'skip') {
      if (this.#pending.length && sampledAtMs - (this.#pending[0]?.sampledAtMs ?? sampledAtMs) >= this.#coalesceWindowMs) {
        emitted.push(await this.#flushPending())
      }
    } else {
      if (this.#pending.length && sampledAtMs - (this.#pending[0]?.sampledAtMs ?? sampledAtMs) >= this.#coalesceWindowMs) {
        emitted.push(await this.#flushPending())
      }
      this.#pending.push({ sampledAtMs, sample, decision })
      if (this.#pending.length >= this.#maxCoalescedSamples) emitted.push(await this.#flushPending())
    }

    return { sample: structuredClone(sample), emitted: structuredClone(emitted), stats: this.stats }
  }

  async flush(): Promise<PassiveSceneEvent[]> {
    if (!this.#pending.length) return []
    return [structuredClone(await this.#flushPending())]
  }

  async run(request: PassiveObservationRunRequest = {}): Promise<PassiveObservationRunResult> {
    const maxSamples = Math.min(10_000, positiveInteger(request.maxSamples ?? 20, 20, 'maxSamples'))
    const sampleIntervalMs = nonNegative(request.sampleIntervalMs ?? 250, 250, 'sampleIntervalMs')
    const emitted: PassiveSceneEvent[] = []
    let status: PassiveObservationRunResult['status'] = 'completed'
    for (let index = 0; index < maxSamples; index += 1) {
      if (request.signal?.aborted) {
        status = 'aborted'
        break
      }
      if (index > 0 && sampleIntervalMs > 0) await this.#sleep(sampleIntervalMs)
      const result = await this.sample()
      for (const event of result.emitted) {
        emitted.push(event)
        await request.onEvent?.(structuredClone(event))
      }
    }
    for (const event of await this.flush()) {
      emitted.push(event)
      await request.onEvent?.(structuredClone(event))
    }
    return { status, events: structuredClone(emitted), stats: this.stats }
  }

  async #flushPending(): Promise<PassiveSceneEvent> {
    const pending = this.#pending.splice(0)
    const first = pending[0]
    const latest = pending.at(-1)
    if (!first || !latest) throw new Error('Passive observation flush requires pending samples')
    const delivery = await this.#deliveryRaster(pending)
    const dispositions = new Set(pending.map(item => item.decision.disposition))
    const disposition: PassiveSceneEventDisposition = dispositions.has('keyframe')
      ? 'keyframe'
      : dispositions.has('full_frame') || !delivery.observation.crop
        ? 'full_frame'
        : 'roi'
    const reasons = [...new Set(pending.map(item => item.decision.reason))]
    const event: PassiveSceneEvent = {
      timelineId: this.#timelineId,
      eventIndex: this.#events.length + 1,
      sceneEpochStart: first.sample.sceneEpoch,
      sceneEpochEnd: latest.sample.sceneEpoch,
      sampleIndexStart: first.sample.sampleIndex,
      sampleIndexEnd: latest.sample.sampleIndex,
      sampleCount: pending.length,
      observedAtStart: first.sample.observation.observedAt,
      observedAtEnd: latest.sample.observation.observedAt,
      disposition,
      reason: pending.length > 1 ? 'coalesced_visual_burst' : latest.decision.reason,
      reasons,
      differenceScoreMax: Math.max(...pending.map(item => item.decision.differenceScore)),
      changedFractionMax: Math.max(...pending.map(item => item.decision.changedFraction)),
      resynchronization: dispositions.has('keyframe'),
      sourceFrameId: latest.sample.observation.frameId,
      sourceRasterSha256: latest.decision.sourceRasterSha256,
      raster: structuredClone(delivery.observation),
      ...(delivery.observation.crop ? { crop: structuredClone(delivery.observation.crop) } : {}),
    }
    this.#events.push(structuredClone(event))
    this.#coalescedSamples += Math.max(0, pending.length - 1)
    this.#deliveredBytes += delivery.observation.byteLength
    return event
  }

  async #deliveryRaster(pending: PendingSample[]): Promise<LabRasterFrame> {
    const latest = pending.at(-1)
    if (!latest) throw new Error('Passive observation delivery requires a latest sample')
    if (
      pending.some(
        item =>
          item.decision.disposition === 'keyframe' ||
          item.decision.disposition === 'full_frame',
      )
    ) {
      if (latest.decision.raster && latest.decision.raster.observation.crop === undefined) {
        return latest.decision.raster
      }
      return await this.#lab.rasterize(latest.sample.observation.frameId)
    }
    const crops = pending.map(item => item.decision.crop).filter((crop): crop is RasterCrop => Boolean(crop))
    if (crops.length !== pending.length) return await this.#lab.rasterize(latest.sample.observation.frameId)
    const crop = unionCrops(crops, latest.sample.observation.width, latest.sample.observation.height)
    const fraction = crop.width * crop.height / (latest.sample.observation.width * latest.sample.observation.height)
    if (fraction > this.#maxCoalescedRoiFraction) return await this.#lab.rasterize(latest.sample.observation.frameId)
    if (pending.length === 1 && latest.decision.raster) return latest.decision.raster
    return await this.#lab.rasterize(latest.sample.observation.frameId, crop)
  }
}

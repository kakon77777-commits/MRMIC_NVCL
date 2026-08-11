import { createHash } from 'node:crypto'
import type {
  GestureCoordinateSpace,
  LabObservation,
  LabRasterObservation,
  MultimodalCanvasLab,
  PixelGesture,
  RasterCrop,
  RasterPerceptualSignature,
} from '../../multimodal-lab/src/index.js'
import { ObservationGovernor } from './governor.js'
import { PassiveObservationScheduler, type PassiveSceneEvent } from './passive.js'

export type ObservationPolicyKind = 'always_full' | 'static_crop' | 'governor_roi' | 'passive_timeline' | 'hybrid_transient'

export interface ObservationPolicyBenchmarkOptions {
  lab: MultimodalCanvasLab
  policy: ObservationPolicyKind
  timelineId?: string
  staticCrop?: RasterCrop
  differenceThreshold?: number
  blockDifferenceThreshold?: number
  keyframeInterval?: number
  maxRoiFraction?: number
  roiPaddingPx?: number
  coalesceWindowMs?: number
  maxCoalescedRoiFraction?: number
  transientReturnDifferenceThreshold?: number
  transientPulseDifferenceThreshold?: number
  transientReversalRatio?: number
  actionSpacingMs?: number
  settleMs?: number
  now?: () => number
  advanceTime?: (milliseconds: number) => void | Promise<void>
}

export interface ObservationPolicyActionStep {
  index: number
  label: string
  actionId: string
  gestureKind: PixelGesture['kind']
  sampleIndex: number
  freshnessVerified: boolean
  transitionGuard: 'passed' | 'failed'
  verifiedChange: boolean
  beforeRenderSha256: string
  afterRenderSha256: string
  observationDisposition: string
  perceptualChangedBlocks: number
  eventRangeCovered: boolean
  perceptualDeliveryCoverage: number
  exactPostStateRetained: boolean
}

export interface ObservationPolicyDelivery {
  index: number
  sampleIndexStart: number
  sampleIndexEnd: number
  disposition: string
  reason: string
  sourceRenderSha256: string
  byteLength: number
  crop?: RasterCrop
}

export interface ObservationPolicyBenchmarkResult {
  protocolVersion: 'mrmic-observation-policy-ab-v1'
  runId: string
  seed: number
  seedClass: 'fixed' | 'held_out'
  policy: ObservationPolicyKind
  planSha256: string
  sourceTraceSha256: string
  actions: number
  freshnessPassed: number
  transitionGuardsPassed: number
  samples: number
  deliveries: number
  providerDeliveriesAvoided: number
  perceptualActions: number
  eventRangeCoveredActions: number
  perceptuallyDeliveredActions: number
  fullyCoveredPerceptualActions: number
  exactPostStatesRetained: number
  tinyMotionDetected: boolean
  transientStateRetained: boolean
  alwaysFullBytes: number
  deliveredBytes: number
  savedBytes: number
  savedPercent: number
  steps: ObservationPolicyActionStep[]
  deliveryTrace: ObservationPolicyDelivery[]
  passed: boolean
}

export interface ObservationPolicyScoreInput {
  policy: ObservationPolicyKind
  actions: number
  transitionGuardsPassed: number
  perceptualActions: number
  perceptuallyDeliveredActions: number
  exactPostStatesRetained: number
  transientStateRetained: boolean
  alwaysFullBytes: number
  deliveredBytes: number
}

export interface ObservationPolicyScoreCard extends ObservationPolicyScoreInput {
  byteEfficiency: number
  guardReliability: number
  perceptualCoverage: number
  exactRetention: number
  transientRetention: number
  score: number
  paretoOptimal: boolean
}

export interface ObservationPolicyRanking {
  protocolVersion: 'mrmic-observation-policy-ranking-v1'
  scoring: {
    byteEfficiency: number
    perceptualCoverage: number
    exactRetention: number
    transientRetention: number
    guardReliability: number
  }
  cards: ObservationPolicyScoreCard[]
  recommendedPolicy: ObservationPolicyKind
  boundary: string
}

interface PlannedGesture {
  label: string
  coordinateSpace: GestureCoordinateSpace
  gesture: PixelGesture
}

interface AuditSample {
  sampleIndex: number
  observation: LabObservation
  sourceByteLength: number
  sourceRasterSha256: string
  changedPoints: Array<{ x: number; y: number }>
  changedBlocks: number
}

interface PolicySample {
  observation: LabObservation
  disposition: string
  deliveries: ObservationPolicyDelivery[]
}

const DEFAULT_STATIC_CROP: RasterCrop = { x: 50, y: 140, width: 680, height: 300 }

function randomGenerator(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 0x1_0000_0000
  }
}

function createPlan(seed: number): PlannedGesture[] {
  const random = randomGenerator(seed)
  const moveDelta = 72 + Math.floor(random() * 35)
  const movedCenterX = 145 + moveDelta
  const tinyCenterX = movedCenterX + 3
  const resizeDelta = 28 + Math.floor(random() * 30)
  const pathOffset = Math.floor(random() * 36)
  const palette = [
    { fill: '#7c3aed', stroke: '#4c1d95', strokeWidth: 5 },
    { fill: '#db2777', stroke: '#831843', strokeWidth: 5 },
    { fill: '#0891b2', stroke: '#164e63', strokeWidth: 5 },
  ]
  const restoredStyle = palette[Math.floor(random() * palette.length)]!
  return [
    {
      label: 'persistent_drag',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'drag', from: { x: 145, y: 285 }, to: { x: movedCenterX, y: 285 } },
    },
    {
      label: 'persistent_restyle',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'restyle', at: { x: movedCenterX, y: 285 }, style: restoredStyle },
    },
    {
      label: 'resize_zone',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'resize',
        from: { x: 650, y: 360 },
        to: { x: 650 + resizeDelta, y: 360 + resizeDelta },
      },
    },
    {
      label: 'edit_title',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'type_text', at: { x: 100, y: 75 }, text: `Policy A/B scene ${seed}` },
    },
    {
      label: 'draw_path',
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
      label: 'delete_distractor',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'delete', at: { x: 527, y: 512 } },
    },
    {
      label: 'tiny_motion',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'drag', from: { x: movedCenterX, y: 285 }, to: { x: tinyCenterX, y: 285 } },
    },
    {
      label: 'transient_on',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'restyle',
        at: { x: tinyCenterX, y: 285 },
        style: { fill: '#f59e0b', stroke: '#92400e', strokeWidth: 7 },
      },
    },
    {
      label: 'transient_restore',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'restyle', at: { x: tinyCenterX, y: 285 }, style: restoredStyle },
    },
    {
      label: 'viewport_pan',
      coordinateSpace: 'frame_pixel',
      gesture: {
        kind: 'pan',
        from: { x: 600, y: 400 },
        to: { x: 648 + Math.floor(random() * 24), y: 428 + Math.floor(random() * 20) },
      },
    },
    {
      label: 'viewport_zoom',
      coordinateSpace: 'frame_pixel',
      gesture: { kind: 'zoom', at: { x: 600, y: 400 }, factor: 1.08 + random() * 0.12 },
    },
  ]
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function boundedRatio(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0
  return Math.max(0, Math.min(1, numerator / denominator))
}

export function rankObservationPolicies(inputs: ObservationPolicyScoreInput[]): ObservationPolicyRanking {
  if (!inputs.length) throw new Error('At least one observation policy result is required')
  const seen = new Set<ObservationPolicyKind>()
  const weights = {
    byteEfficiency: 0.25,
    perceptualCoverage: 0.25,
    exactRetention: 0.25,
    transientRetention: 0.1,
    guardReliability: 0.15,
  }
  const cards = inputs.map(input => {
    if (seen.has(input.policy)) throw new Error(`Duplicate observation policy ${input.policy}`)
    seen.add(input.policy)
    const numeric = [
      input.actions,
      input.transitionGuardsPassed,
      input.perceptualActions,
      input.perceptuallyDeliveredActions,
      input.exactPostStatesRetained,
      input.alwaysFullBytes,
      input.deliveredBytes,
    ]
    if (numeric.some(value => !Number.isFinite(value) || value < 0)) {
      throw new Error(`Observation policy ${input.policy} contains invalid negative or non-finite metrics`)
    }
    if ([
      input.actions,
      input.transitionGuardsPassed,
      input.perceptualActions,
      input.perceptuallyDeliveredActions,
      input.exactPostStatesRetained,
    ].some(value => !Number.isInteger(value))) {
      throw new Error(`Observation policy ${input.policy} contains non-integer counts`)
    }
    if (input.transitionGuardsPassed > input.actions
      || input.exactPostStatesRetained > input.actions
      || input.perceptuallyDeliveredActions > input.perceptualActions) {
      throw new Error(`Observation policy ${input.policy} contains internally inconsistent counts`)
    }
    const byteEfficiency = input.alwaysFullBytes > 0
      ? 1 - boundedRatio(input.deliveredBytes, input.alwaysFullBytes)
      : 0
    const guardReliability = boundedRatio(input.transitionGuardsPassed, input.actions)
    const perceptualCoverage = boundedRatio(input.perceptuallyDeliveredActions, input.perceptualActions)
    const exactRetention = boundedRatio(input.exactPostStatesRetained, input.actions)
    const transientRetention = input.transientStateRetained ? 1 : 0
    return {
      ...structuredClone(input),
      byteEfficiency,
      guardReliability,
      perceptualCoverage,
      exactRetention,
      transientRetention,
      score: byteEfficiency * weights.byteEfficiency
        + perceptualCoverage * weights.perceptualCoverage
        + exactRetention * weights.exactRetention
        + transientRetention * weights.transientRetention
        + guardReliability * weights.guardReliability,
      paretoOptimal: false,
    }
  })
  for (const card of cards) {
    card.paretoOptimal = !cards.some(other => other.policy !== card.policy
      && other.byteEfficiency >= card.byteEfficiency
      && other.perceptualCoverage >= card.perceptualCoverage
      && other.exactRetention >= card.exactRetention
      && other.transientRetention >= card.transientRetention
      && other.guardReliability >= card.guardReliability
      && (
        other.byteEfficiency > card.byteEfficiency
        || other.perceptualCoverage > card.perceptualCoverage
        || other.exactRetention > card.exactRetention
        || other.transientRetention > card.transientRetention
        || other.guardReliability > card.guardReliability
      ))
  }
  cards.sort((left, right) => right.score - left.score || left.policy.localeCompare(right.policy))
  return {
    protocolVersion: 'mrmic-observation-policy-ranking-v1',
    scoring: weights,
    cards,
    recommendedPolicy: cards[0]!.policy,
    boundary: 'Heuristic ranking of supplied controlled-benchmark evidence; it does not authorize actions or prove real Provider Token savings.',
  }
}

function changedPoints(
  previous: RasterPerceptualSignature | undefined,
  current: RasterPerceptualSignature,
  frameWidth: number,
  frameHeight: number,
  threshold: number,
): Array<{ x: number; y: number }> {
  if (!previous || previous.width !== current.width || previous.height !== current.height) {
    return Array.from({ length: current.width * current.height }, (_, index) => ({
      x: (index % current.width + 0.5) * frameWidth / current.width,
      y: (Math.floor(index / current.width) + 0.5) * frameHeight / current.height,
    }))
  }
  const points: Array<{ x: number; y: number }> = []
  for (let block = 0; block < current.width * current.height; block += 1) {
    const offset = block * 3
    const difference = (
      Math.abs((current.samples[offset] ?? 0) - (previous.samples[offset] ?? 0))
      + Math.abs((current.samples[offset + 1] ?? 0) - (previous.samples[offset + 1] ?? 0))
      + Math.abs((current.samples[offset + 2] ?? 0) - (previous.samples[offset + 2] ?? 0))
    ) / (255 * 3)
    if (difference < threshold) continue
    points.push({
      x: (block % current.width + 0.5) * frameWidth / current.width,
      y: (Math.floor(block / current.width) + 0.5) * frameHeight / current.height,
    })
  }
  return points
}

function cropCoverage(points: Array<{ x: number; y: number }>, crop?: RasterCrop): number {
  if (!points.length) return 0
  if (!crop) return 1
  const covered = points.filter(point =>
    point.x >= crop.x && point.x <= crop.x + crop.width
    && point.y >= crop.y && point.y <= crop.y + crop.height,
  ).length
  return covered / points.length
}

function deliveryFromRaster(
  index: number,
  sampleIndexStart: number,
  sampleIndexEnd: number,
  disposition: string,
  reason: string,
  raster: LabRasterObservation,
): ObservationPolicyDelivery {
  return {
    index,
    sampleIndexStart,
    sampleIndexEnd,
    disposition,
    reason,
    sourceRenderSha256: raster.sourceRenderSha256,
    byteLength: raster.byteLength,
    ...(raster.crop ? { crop: structuredClone(raster.crop) } : {}),
  }
}

export class ObservationPolicyBenchmarkRunner {
  readonly #lab: MultimodalCanvasLab
  readonly #policy: ObservationPolicyKind
  readonly #staticCrop: RasterCrop
  readonly #blockDifferenceThreshold: number
  readonly #actionSpacingMs: number
  readonly #settleMs: number
  readonly #advanceTime: (milliseconds: number) => void | Promise<void>
  readonly #governor?: ObservationGovernor
  readonly #passive?: PassiveObservationScheduler
  readonly #deliveryTrace: ObservationPolicyDelivery[] = []
  #samples = 0
  #previousAuditSignature?: RasterPerceptualSignature

  constructor(options: ObservationPolicyBenchmarkOptions) {
    this.#lab = options.lab
    this.#policy = options.policy
    this.#staticCrop = structuredClone(options.staticCrop ?? DEFAULT_STATIC_CROP)
    this.#blockDifferenceThreshold = options.blockDifferenceThreshold ?? 0.02
    this.#actionSpacingMs = Math.max(1, Math.floor(options.actionSpacingMs ?? 40))
    this.#settleMs = Math.max(this.#actionSpacingMs, Math.floor(options.settleMs ?? 300))
    this.#advanceTime = options.advanceTime ?? (() => undefined)
    if (options.policy === 'governor_roi' || options.policy === 'passive_timeline' || options.policy === 'hybrid_transient') {
      const governor = new ObservationGovernor({
        lab: options.lab,
        differenceThreshold: options.differenceThreshold ?? 0.0001,
        blockDifferenceThreshold: this.#blockDifferenceThreshold,
        keyframeInterval: options.keyframeInterval ?? 12,
        maxRoiFraction: options.maxRoiFraction ?? 0.35,
        roiPaddingPx: options.roiPaddingPx ?? 24,
      })
      if (options.policy === 'governor_roi') this.#governor = governor
      else {
        this.#passive = new PassiveObservationScheduler({
          lab: options.lab,
          governor,
          timelineId: options.timelineId,
          coalesceWindowMs: options.coalesceWindowMs ?? 200,
          maxCoalescedRoiFraction: options.maxCoalescedRoiFraction ?? 0.55,
          boundaryMode: options.policy === 'hybrid_transient' ? 'transient_preserving' : 'coalesce_only',
          transientReturnDifferenceThreshold: options.transientReturnDifferenceThreshold,
          transientPulseDifferenceThreshold: options.transientPulseDifferenceThreshold,
          transientReversalRatio: options.transientReversalRatio,
          now: options.now,
        })
      }
    }
  }

  async run(options: { runId?: string; seed?: number; seedClass?: 'fixed' | 'held_out' } = {}): Promise<ObservationPolicyBenchmarkResult> {
    const seed = Math.floor(options.seed ?? 11) >>> 0
    const seedClass = options.seedClass ?? 'fixed'
    const runId = options.runId?.trim() || `phase12-${this.#policy}-${seedClass}-${seed}`
    const plan = createPlan(seed)
    this.#samples = 0
    this.#deliveryTrace.length = 0
    this.#previousAuditSignature = undefined
    this.#governor?.reset()
    this.#passive?.reset()

    const blank = await this.#lab.observe('pixel')
    const reset = await this.#lab.resetBenchmark(`${runId}:reset`, blank.frameId, 'pixel')
    await this.#normalizeViewport(runId, reset.observation)

    const audits: AuditSample[] = []
    const rawSteps: Array<Omit<ObservationPolicyActionStep,
      'perceptualChangedBlocks' | 'eventRangeCovered' | 'perceptualDeliveryCoverage' | 'exactPostStateRetained'>> = []
    let sampled = await this.#sample(audits)
    let current = sampled.observation

    for (const [index, item] of plan.entries()) {
      const actionId = `${runId}:gesture:${index + 1}`
      const action = await this.#lab.execute({
        actionId,
        frameId: current.frameId,
        canvasId: current.canvasId,
        expectedCanvasRevision: current.canvasRevision,
        type: 'gesture',
        coordinateSpace: item.coordinateSpace,
        gesture: structuredClone(item.gesture),
      }, 'pixel')
      await this.#advanceTime(this.#actionSpacingMs)
      sampled = await this.#sample(audits)
      current = sampled.observation
      rawSteps.push({
        index: index + 1,
        label: item.label,
        actionId,
        gestureKind: item.gesture.kind,
        sampleIndex: this.#samples,
        freshnessVerified: action.evidence.freshnessVerified,
        transitionGuard: action.evidence.transitionGuard,
        verifiedChange: action.evidence.verifiedChange,
        beforeRenderSha256: action.evidence.beforeRenderSha256,
        afterRenderSha256: action.evidence.afterRenderSha256,
        observationDisposition: sampled.disposition,
      })
    }

    await this.#advanceTime(this.#settleMs)
    await this.#sample(audits)
    await this.#advanceTime(this.#actionSpacingMs)
    await this.#sample(audits)
    await this.#flushPassive()

    const steps: ObservationPolicyActionStep[] = rawSteps.map(step => {
      const audit = audits.find(item => item.sampleIndex === step.sampleIndex)
      const delivery = this.#deliveryTrace.find(item =>
        step.sampleIndex >= item.sampleIndexStart && step.sampleIndex <= item.sampleIndexEnd,
      )
      const coverage = audit && delivery ? cropCoverage(audit.changedPoints, delivery.crop) : 0
      return {
        ...step,
        perceptualChangedBlocks: audit?.changedBlocks ?? 0,
        eventRangeCovered: Boolean(delivery),
        perceptualDeliveryCoverage: coverage,
        exactPostStateRetained: Boolean(
          delivery
          && delivery.sourceRenderSha256 === step.afterRenderSha256
          && coverage > 0,
        ),
      }
    })

    const alwaysFullBytes = audits.reduce((sum, item) => sum + item.sourceByteLength, 0)
    const deliveredBytes = this.#deliveryTrace.reduce((sum, item) => sum + item.byteLength, 0)
    const perceptualSteps = steps.filter(step => step.perceptualChangedBlocks > 0)
    const freshnessPassed = steps.filter(step => step.freshnessVerified).length
    const transitionGuardsPassed = steps.filter(step => step.transitionGuard === 'passed' && step.verifiedChange).length
    const result: ObservationPolicyBenchmarkResult = {
      protocolVersion: 'mrmic-observation-policy-ab-v1',
      runId,
      seed,
      seedClass,
      policy: this.#policy,
      planSha256: sha256(plan),
      sourceTraceSha256: sha256(audits.map(audit => audit.sourceRasterSha256)),
      actions: steps.length,
      freshnessPassed,
      transitionGuardsPassed,
      samples: this.#samples,
      deliveries: this.#deliveryTrace.length,
      providerDeliveriesAvoided: Math.max(0, this.#samples - this.#deliveryTrace.length),
      perceptualActions: perceptualSteps.length,
      eventRangeCoveredActions: steps.filter(step => step.eventRangeCovered).length,
      perceptuallyDeliveredActions: perceptualSteps.filter(step => step.perceptualDeliveryCoverage > 0).length,
      fullyCoveredPerceptualActions: perceptualSteps.filter(step => step.perceptualDeliveryCoverage === 1).length,
      exactPostStatesRetained: steps.filter(step => step.exactPostStateRetained).length,
      tinyMotionDetected: Boolean(steps.find(step => step.label === 'tiny_motion')?.perceptualChangedBlocks),
      transientStateRetained: steps.find(step => step.label === 'transient_on')?.exactPostStateRetained ?? false,
      alwaysFullBytes,
      deliveredBytes,
      savedBytes: alwaysFullBytes - deliveredBytes,
      savedPercent: alwaysFullBytes ? (alwaysFullBytes - deliveredBytes) / alwaysFullBytes * 100 : 0,
      steps,
      deliveryTrace: structuredClone(this.#deliveryTrace),
      passed: freshnessPassed === steps.length && transitionGuardsPassed === steps.length,
    }
    if (JSON.stringify(result).includes('objectId')) {
      throw new Error('Observation policy benchmark leaked a forbidden object identifier')
    }
    return result
  }

  async #normalizeViewport(runId: string, observation: LabObservation): Promise<void> {
    const viewport = observation.viewport
    if (
      viewport.x === 0 && viewport.y === 0 && viewport.zoom === 1
      && viewport.width === observation.width && viewport.height === observation.height
    ) return
    await this.#lab.execute({
      actionId: `${runId}:reset-viewport`,
      frameId: observation.frameId,
      canvasId: observation.canvasId,
      expectedCanvasRevision: observation.canvasRevision,
      type: 'viewport',
      viewport: { x: 0, y: 0, zoom: 1, width: observation.width, height: observation.height },
    }, 'pixel')
  }

  async #sample(audits: AuditSample[]): Promise<PolicySample> {
    let sample: PolicySample
    if (this.#policy === 'passive_timeline' || this.#policy === 'hybrid_transient') {
      const result = await this.#passive!.sample()
      sample = {
        observation: result.sample.observation,
        disposition: result.sample.governance.disposition,
        deliveries: result.emitted.map(event => this.#passiveDelivery(event)),
      }
    } else {
      const observation = await this.#lab.observe('pixel')
      if (this.#policy === 'governor_roi') {
        const decision = await this.#governor!.observe(observation.frameId)
        sample = {
          observation,
          disposition: decision.disposition,
          deliveries: decision.raster
            ? [deliveryFromRaster(
                this.#deliveryTrace.length + 1,
                this.#samples + 1,
                this.#samples + 1,
                decision.disposition,
                decision.reason,
                decision.raster.observation,
              )]
            : [],
        }
      } else {
        const raster = await this.#lab.rasterize(
          observation.frameId,
          this.#policy === 'static_crop' ? this.#staticCrop : undefined,
        )
        sample = {
          observation,
          disposition: this.#policy,
          deliveries: [deliveryFromRaster(
            this.#deliveryTrace.length + 1,
            this.#samples + 1,
            this.#samples + 1,
            this.#policy,
            this.#policy === 'static_crop' ? 'fixed_frame_crop' : 'unconditional_full_frame',
            raster.observation,
          )],
        }
      }
    }
    this.#samples += 1
    for (const delivery of sample.deliveries) {
      delivery.index = this.#deliveryTrace.length + 1
      this.#deliveryTrace.push(delivery)
    }
    const auditRaster = await this.#lab.rasterize(sample.observation.frameId)
    const points = changedPoints(
      this.#previousAuditSignature,
      auditRaster.perceptualSignature,
      sample.observation.width,
      sample.observation.height,
      this.#blockDifferenceThreshold,
    )
    this.#previousAuditSignature = structuredClone(auditRaster.perceptualSignature)
    audits.push({
      sampleIndex: this.#samples,
      observation: sample.observation,
      sourceByteLength: auditRaster.observation.byteLength,
      sourceRasterSha256: auditRaster.observation.sha256,
      changedPoints: points,
      changedBlocks: points.length,
    })
    return sample
  }

  #passiveDelivery(event: PassiveSceneEvent): ObservationPolicyDelivery {
    return deliveryFromRaster(
      this.#deliveryTrace.length + 1,
      event.sampleIndexStart,
      event.sampleIndexEnd,
      event.disposition,
      event.reason,
      event.raster,
    )
  }

  async #flushPassive(): Promise<void> {
    if (!this.#passive) return
    for (const event of await this.#passive.flush()) {
      const delivery = this.#passiveDelivery(event)
      delivery.index = this.#deliveryTrace.length + 1
      this.#deliveryTrace.push(delivery)
    }
  }
}

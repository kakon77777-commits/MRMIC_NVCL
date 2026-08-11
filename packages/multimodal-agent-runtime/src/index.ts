import { createHash, randomUUID } from 'node:crypto'
import {
  MultimodalLabError,
  type ActionEvidence,
  type GestureCoordinateSpace,
  type LabObservation,
  type MultimodalCanvasLab,
  type PixelGesture,
  type RasterCrop,
} from '../../multimodal-lab/src/index.js'
import { ObservationGovernor, type ObservationDisposition } from './governor.js'

export {
  ObservationGovernor,
  type GovernedObservation,
  type ObservationDisposition,
  type ObservationGovernorOptions,
} from './governor.js'
export {
  SustainedObservationBenchmarkRunner,
  type SustainedObservationBenchmarkOptions,
  type SustainedObservationBenchmarkResult,
  type SustainedObservationBenchmarkStep,
} from './benchmark.js'
export {
  PassiveObservationScheduler,
  type PassiveObservationResult,
  type PassiveObservationRunRequest,
  type PassiveObservationRunResult,
  type PassiveObservationSample,
  type PassiveObservationSchedulerOptions,
  type PassiveObservationStats,
  type PassiveSceneEvent,
  type PassiveSceneEventDisposition,
} from './passive.js'
export {
  PassiveSceneBenchmarkRunner,
  type PassiveBenchmarkSeedClass,
  type PassiveSceneBenchmarkResult,
  type PassiveSceneBenchmarkRunnerOptions,
  type PassiveSceneBenchmarkStep,
} from './passive-benchmark.js'
export {
  ObservationPolicyBenchmarkRunner,
  rankObservationPolicies,
  type ObservationPolicyActionStep,
  type ObservationPolicyBenchmarkOptions,
  type ObservationPolicyBenchmarkResult,
  type ObservationPolicyDelivery,
  type ObservationPolicyKind,
  type ObservationPolicyRanking,
  type ObservationPolicyScoreCard,
  type ObservationPolicyScoreInput,
} from './policy-benchmark.js'
export {
  RealProviderABRunner,
  authorizeRealProviderAB,
  REAL_PROVIDER_AB_ACKNOWLEDGEMENT,
  validateVisualObservationResponse,
  type ProviderABLabSession,
  type RealProviderABArmResult,
  type RealProviderABAuthorization,
  type RealProviderABAuthorizationInput,
  type RealProviderABPolicy,
  type RealProviderABResult,
  type RealProviderABRunnerOptions,
  type RealProviderABStep,
  type VisualCircleState,
  type VisualObservationProvider,
  type VisualObservationRequest,
  type VisualObservationResponse,
} from './provider-ab.js'

export interface ProviderUsage {
  inputTokens?: number
  cachedInputTokens?: number
  outputTokens?: number
  reasoningOutputTokens?: number
  totalTokens?: number
}

export interface PixelProviderRequest {
  protocolVersion: 'mrmic-pixel-agent-v1'
  goal: string
  iteration: number
  maxIterations: number
  frame: {
    frameId: string
    mimeType: 'image/png'
    imageBase64: string
    imageSha256: string
    sourceRenderSha256: string
    width: number
    height: number
    crop?: RasterCrop
  }
  observationPolicy?: {
    disposition: ObservationDisposition
    sequence: number
    reason: string
    differenceScore: number
    changedFraction: number
  }
  previous?: PixelSafeFeedback
}

export interface PixelSafeFeedback {
  actionId: string
  actionType: 'gesture'
  gestureKind: PixelGesture['kind']
  freshnessVerified: boolean
  transitionGuard: ActionEvidence['transitionGuard']
  verifiedChange: boolean
  benchmarkPassed: boolean
}

export type MultimodalProviderDecision =
  | {
      type: 'gesture'
      coordinateSpace: GestureCoordinateSpace
      gesture: PixelGesture
      confidence: number
      summary: string
    }
  | {
      type: 'stop'
      success: boolean
      reason: string
    }

export interface MultimodalProviderResponse {
  decision: MultimodalProviderDecision
  model?: string
  usage?: ProviderUsage
}

export interface MultimodalProvider {
  readonly name: string
  generate(request: PixelProviderRequest): Promise<unknown>
}

export interface MultimodalEpisodeStep {
  iteration: number
  provider: string
  model?: string
  providerRequestSha256: string
  imageSha256: string
  decision: MultimodalProviderDecision
  usage: ProviderUsage
  observationLatencyMs: number
  providerLatencyMs: number
  actionLatencyMs: number
  observationDisposition: ObservationDisposition
  differenceScore: number
  changedFraction: number
  actionRejectedCode?: string
  evidence?: ActionEvidence
  benchmarkPassed: boolean
}

export interface MultimodalEpisodeMetrics {
  observations: number
  providerCalls: number
  actions: number
  corrections: number
  staleFrameRejections: number
  keyframes: number
  fullFrameObservations: number
  roiObservations: number
  skippedObservations: number
  tokenBudgetStops: number
  cumulativeDifferenceScore: number
  observationLatencyMs: number
  providerLatencyMs: number
  actionLatencyMs: number
  totalLatencyMs: number
  usage: Required<ProviderUsage>
}

export interface MultimodalEpisodeResult {
  runId: string
  status: 'completed' | 'failed' | 'stopped'
  success: boolean
  goal: string
  provider: string
  startedAt: string
  completedAt: string
  reason: string
  steps: MultimodalEpisodeStep[]
  metrics: MultimodalEpisodeMetrics
}

export interface MultimodalEpisodeRequest {
  runId?: string
  goal: string
  maxIterations?: number
  resetBenchmark?: boolean
  crop?: RasterCrop
  adaptiveObservation?: boolean
  maxTotalTokens?: number
}

export interface MultimodalAgentRuntimeOptions {
  lab: MultimodalCanvasLab
  provider: MultimodalProvider
  governor?: ObservationGovernor
  now?: () => number
}

const emptyUsage = (): Required<ProviderUsage> => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertNoObjectIdentifierKeys(value: unknown, label: string): void {
  const walk = (item: unknown, path: string): void => {
    if (Array.isArray(item)) {
      item.forEach((entry, index) => walk(entry, `${path}[${index}]`))
      return
    }
    if (!isRecord(item)) return
    for (const [key, child] of Object.entries(item)) {
      if (/object_?ids?/i.test(key) || /objectIds?/i.test(key)) throw new Error(`${label} contains forbidden identifier field ${path}.${key}`)
      walk(child, `${path}.${key}`)
    }
  }
  walk(value, label)
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`)
  return value
}

function string(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`)
  return value
}

function point(value: unknown, label: string): { x: number; y: number } {
  if (!isRecord(value)) throw new Error(`${label} must be an object`)
  return { x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`) }
}

function style(value: unknown): Record<string, string | number> {
  if (!isRecord(value)) throw new Error('gesture.style must be an object')
  const output: Record<string, string | number> = {}
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string' && (typeof item !== 'number' || !Number.isFinite(item))) throw new Error(`gesture.style.${key} is invalid`)
    output[key] = item
  }
  return output
}

function validateGesture(value: unknown): PixelGesture {
  if (!isRecord(value)) throw new Error('decision.gesture must be an object')
  const kind = string(value.kind, 'gesture.kind')
  if (kind === 'drag' || kind === 'resize' || kind === 'pan') {
    return { kind, from: point(value.from, 'gesture.from'), to: point(value.to, 'gesture.to') }
  }
  if (kind === 'delete') return { kind, at: point(value.at, 'gesture.at') }
  if (kind === 'restyle') return { kind, at: point(value.at, 'gesture.at'), style: style(value.style) }
  if (kind === 'type_text') return { kind, at: point(value.at, 'gesture.at'), text: string(value.text, 'gesture.text') }
  if (kind === 'draw_path') {
    if (!Array.isArray(value.points) || value.points.length < 2) throw new Error('gesture.points must contain at least two points')
    return { kind, points: value.points.map((item, index) => point(item, `gesture.points[${index}]`)), ...(value.style === undefined ? {} : { style: style(value.style) }) }
  }
  if (kind === 'zoom') return { kind, at: point(value.at, 'gesture.at'), factor: finite(value.factor, 'gesture.factor') }
  throw new Error(`Unsupported gesture kind ${kind}`)
}

export function validateProviderResponse(value: unknown): MultimodalProviderResponse {
  assertNoObjectIdentifierKeys(value, 'providerResponse')
  if (!isRecord(value)) throw new Error('Provider response must be an object')
  const rawDecision = isRecord(value.decision) ? value.decision : value
  const type = string(rawDecision.type, 'decision.type')
  let decision: MultimodalProviderDecision
  if (type === 'stop') {
    if (typeof rawDecision.success !== 'boolean') throw new Error('decision.success must be boolean')
    decision = { type, success: rawDecision.success, reason: string(rawDecision.reason, 'decision.reason') }
  } else if (type === 'gesture') {
    const coordinateSpace = string(rawDecision.coordinateSpace, 'decision.coordinateSpace')
    if (coordinateSpace !== 'normalized_frame' && coordinateSpace !== 'frame_pixel') throw new Error('decision.coordinateSpace is invalid')
    const confidence = finite(rawDecision.confidence, 'decision.confidence')
    if (confidence < 0 || confidence > 1) throw new Error('decision.confidence must be within [0, 1]')
    decision = {
      type,
      coordinateSpace,
      gesture: validateGesture(rawDecision.gesture),
      confidence,
      summary: string(rawDecision.summary, 'decision.summary'),
    }
  } else {
    throw new Error(`Unsupported decision type ${type}`)
  }
  const usage = value.usage === undefined ? undefined : validateUsage(value.usage)
  return {
    decision,
    ...(typeof value.model === 'string' && value.model ? { model: value.model } : {}),
    ...(usage ? { usage } : {}),
  }
}

function validateUsage(value: unknown): ProviderUsage {
  if (!isRecord(value)) throw new Error('usage must be an object')
  const output: ProviderUsage = {}
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'] as const) {
    if (value[key] === undefined) continue
    const count = finite(value[key], `usage.${key}`)
    if (!Number.isInteger(count) || count < 0) throw new Error(`usage.${key} must be a non-negative integer`)
    output[key] = count
  }
  return output
}

export function assertPixelSafeProviderRequest(request: PixelProviderRequest): void {
  assertNoObjectIdentifierKeys(request, 'pixelProviderRequest')
}

function requestHash(request: PixelProviderRequest): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex')
}

function elapsed(now: () => number, started: number): number {
  return Math.max(0, now() - started)
}

function addUsage(total: Required<ProviderUsage>, usage: ProviderUsage): void {
  total.inputTokens += usage.inputTokens ?? 0
  total.cachedInputTokens += usage.cachedInputTokens ?? 0
  total.outputTokens += usage.outputTokens ?? 0
  total.reasoningOutputTokens += usage.reasoningOutputTokens ?? 0
  total.totalTokens += usage.totalTokens ?? 0
}

function projectPointFromRaster(
  point: { x: number; y: number },
  coordinateSpace: GestureCoordinateSpace,
  observation: LabObservation,
  crop?: RasterCrop,
): { x: number; y: number } {
  if (!crop) return structuredClone(point)
  if (coordinateSpace === 'frame_pixel') return { x: crop.x + point.x, y: crop.y + point.y }
  return {
    x: (crop.x + point.x * crop.width) / observation.width,
    y: (crop.y + point.y * crop.height) / observation.height,
  }
}

export function projectGestureFromRaster(
  gesture: PixelGesture,
  coordinateSpace: GestureCoordinateSpace,
  observation: LabObservation,
  crop?: RasterCrop,
): PixelGesture {
  if (!crop) return structuredClone(gesture)
  const point = (value: { x: number; y: number }) => projectPointFromRaster(value, coordinateSpace, observation, crop)
  if (gesture.kind === 'drag' || gesture.kind === 'resize' || gesture.kind === 'pan') {
    return { ...gesture, from: point(gesture.from), to: point(gesture.to) }
  }
  if (gesture.kind === 'draw_path') return { ...gesture, points: gesture.points.map(point) }
  return { ...gesture, at: point(gesture.at) }
}

export class MultimodalAgentRuntime {
  readonly #lab: MultimodalCanvasLab
  readonly #provider: MultimodalProvider
  readonly #governor?: ObservationGovernor
  readonly #now: () => number

  constructor(options: MultimodalAgentRuntimeOptions) {
    this.#lab = options.lab
    this.#provider = options.provider
    this.#governor = options.governor
    this.#now = options.now ?? Date.now
  }

  async run(request: MultimodalEpisodeRequest): Promise<MultimodalEpisodeResult> {
    if (!request.goal.trim()) throw new Error('Multimodal episode goal is required')
    const runId = request.runId?.trim() || `phase10-${randomUUID()}`
    const maxIterations = Math.max(1, Math.min(50, Math.floor(request.maxIterations ?? 6)))
    const startedAtMs = this.#now()
    const startedAt = new Date(startedAtMs).toISOString()
    const steps: MultimodalEpisodeStep[] = []
    const metrics: MultimodalEpisodeMetrics = {
      observations: 0,
      providerCalls: 0,
      actions: 0,
      corrections: 0,
      staleFrameRejections: 0,
      keyframes: 0,
      fullFrameObservations: 0,
      roiObservations: 0,
      skippedObservations: 0,
      tokenBudgetStops: 0,
      cumulativeDifferenceScore: 0,
      observationLatencyMs: 0,
      providerLatencyMs: 0,
      actionLatencyMs: 0,
      totalLatencyMs: 0,
      usage: emptyUsage(),
    }

    let observation = await this.#pixelObservation(metrics)
    if (request.resetBenchmark !== false) {
      const reset = await this.#lab.resetBenchmark(`${runId}:reset`, observation.frameId, 'pixel')
      observation = reset.observation
    }
    const useGovernor = Boolean(this.#governor && request.adaptiveObservation !== false && !request.crop)
    if (useGovernor) this.#governor?.reset()
    const maxTotalTokens = request.maxTotalTokens === undefined
      ? undefined
      : Math.max(1, Math.floor(finite(request.maxTotalTokens, 'maxTotalTokens')))
    let previous: PixelSafeFeedback | undefined

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
      const observationStarted = this.#now()
      const governed = useGovernor ? await this.#governor?.observe(observation.frameId) : undefined
      const disposition: ObservationDisposition = governed?.disposition ?? (request.crop ? 'roi' : 'full_frame')
      const differenceScore = governed?.differenceScore ?? 1
      const changedFraction = governed?.changedFraction ?? 1
      metrics.observations += 1
      const observationLatencyMs = elapsed(this.#now, observationStarted)
      metrics.observationLatencyMs += observationLatencyMs
      metrics.cumulativeDifferenceScore += differenceScore
      if (disposition === 'keyframe') metrics.keyframes += 1
      else if (disposition === 'full_frame') metrics.fullFrameObservations += 1
      else if (disposition === 'roi') metrics.roiObservations += 1
      else metrics.skippedObservations += 1
      if (disposition === 'skip') {
        observation = await this.#pixelObservation(metrics, false)
        continue
      }
      const raster = governed?.raster ?? await this.#lab.rasterize(observation.frameId, request.crop)
      if (maxTotalTokens !== undefined && metrics.usage.totalTokens >= maxTotalTokens) {
        metrics.tokenBudgetStops += 1
        metrics.totalLatencyMs = elapsed(this.#now, startedAtMs)
        return this.#result(runId, request.goal, startedAt, steps, metrics, 'stopped', false, `Token budget ${maxTotalTokens} exhausted before another Provider call`)
      }
      const providerRequest: PixelProviderRequest = {
        protocolVersion: 'mrmic-pixel-agent-v1',
        goal: request.goal,
        iteration,
        maxIterations,
        frame: {
          frameId: observation.frameId,
          mimeType: 'image/png',
          imageBase64: Buffer.from(raster.png).toString('base64'),
          imageSha256: raster.observation.sha256,
          sourceRenderSha256: raster.observation.sourceRenderSha256,
          width: raster.observation.width,
          height: raster.observation.height,
          ...(raster.observation.crop ? { crop: raster.observation.crop } : {}),
        },
        observationPolicy: {
          disposition,
          sequence: governed?.sequence ?? iteration,
          reason: governed?.reason ?? (request.crop ? 'static_crop' : 'always_full_frame'),
          differenceScore,
          changedFraction,
        },
        ...(previous ? { previous } : {}),
      }
      assertPixelSafeProviderRequest(providerRequest)
      const providerStarted = this.#now()
      const generated = await this.#provider.generate(structuredClone(providerRequest))
      const providerLatencyMs = elapsed(this.#now, providerStarted)
      metrics.providerCalls += 1
      metrics.providerLatencyMs += providerLatencyMs
      const response = validateProviderResponse(generated)
      const usage = response.usage ?? {}
      addUsage(metrics.usage, usage)

      if (response.decision.type === 'stop') {
        steps.push({
          iteration,
          provider: this.#provider.name,
          ...(response.model ? { model: response.model } : {}),
          providerRequestSha256: requestHash(providerRequest),
          imageSha256: raster.observation.sha256,
          decision: response.decision,
          usage,
          observationLatencyMs,
          providerLatencyMs,
          actionLatencyMs: 0,
          observationDisposition: disposition,
          differenceScore,
          changedFraction,
          benchmarkPassed: response.decision.success,
        })
        metrics.totalLatencyMs = elapsed(this.#now, startedAtMs)
        return this.#result(runId, request.goal, startedAt, steps, metrics, response.decision.success ? 'completed' : 'stopped', response.decision.success, response.decision.reason)
      }

      const actionId = `${runId}:gesture:${iteration}:${randomUUID()}`
      const actionStarted = this.#now()
      let result
      try {
        const projectedGesture = projectGestureFromRaster(
          response.decision.gesture,
          response.decision.coordinateSpace,
          observation,
          raster.observation.crop,
        )
        result = await this.#lab.execute({
          actionId,
          frameId: observation.frameId,
          canvasId: observation.canvasId,
          expectedCanvasRevision: observation.canvasRevision,
          type: 'gesture',
          coordinateSpace: response.decision.coordinateSpace,
          gesture: projectedGesture,
          confidence: response.decision.confidence,
          actor: { actorType: 'agent', actorId: this.#provider.name, instanceId: runId },
        }, 'pixel')
      } catch (error) {
        if (error instanceof MultimodalLabError && ['STALE_FRAME', 'FRAME_NOT_FOUND', 'REVISION_CONFLICT'].includes(error.code)) {
          metrics.staleFrameRejections += 1
          metrics.corrections += 1
          const actionLatencyMs = elapsed(this.#now, actionStarted)
          metrics.actionLatencyMs += actionLatencyMs
          steps.push({
            iteration,
            provider: this.#provider.name,
            ...(response.model ? { model: response.model } : {}),
            providerRequestSha256: requestHash(providerRequest),
            imageSha256: raster.observation.sha256,
            decision: response.decision,
            usage,
            observationLatencyMs,
            providerLatencyMs,
            actionLatencyMs,
            observationDisposition: disposition,
            differenceScore,
            changedFraction,
            actionRejectedCode: error.code,
            benchmarkPassed: false,
          })
          this.#governor?.forceNextKeyframe('stale_frame_recovery')
          observation = await this.#pixelObservation(metrics, false)
          continue
        }
        throw error
      }
      const actionLatencyMs = elapsed(this.#now, actionStarted)
      metrics.actions += 1
      metrics.actionLatencyMs += actionLatencyMs
      const verification = this.#lab.verifyBenchmark()
      const step: MultimodalEpisodeStep = {
        iteration,
        provider: this.#provider.name,
        ...(response.model ? { model: response.model } : {}),
        providerRequestSha256: requestHash(providerRequest),
        imageSha256: raster.observation.sha256,
        decision: response.decision,
        usage,
        observationLatencyMs,
        providerLatencyMs,
        actionLatencyMs,
        observationDisposition: disposition,
        differenceScore,
        changedFraction,
        evidence: result.evidence,
        benchmarkPassed: verification.passed,
      }
      steps.push(step)
      previous = {
        actionId,
        actionType: 'gesture',
        gestureKind: response.decision.gesture.kind,
        freshnessVerified: result.evidence.freshnessVerified,
        transitionGuard: result.evidence.transitionGuard,
        verifiedChange: result.evidence.verifiedChange,
        benchmarkPassed: verification.passed,
      }
      if (verification.passed) {
        metrics.totalLatencyMs = elapsed(this.#now, startedAtMs)
        return this.#result(runId, request.goal, startedAt, steps, metrics, 'completed', true, 'Structured oracle verified the pixel-native task')
      }
      metrics.corrections += 1
      observation = result.observation
    }

    metrics.totalLatencyMs = elapsed(this.#now, startedAtMs)
    return this.#result(runId, request.goal, startedAt, steps, metrics, 'failed', false, `Iteration budget ${maxIterations} exhausted`)
  }

  async #pixelObservation(metrics: MultimodalEpisodeMetrics, count = true): Promise<LabObservation> {
    const started = this.#now()
    const observation = await this.#lab.observe('pixel')
    if (count) metrics.observations += 1
    metrics.observationLatencyMs += elapsed(this.#now, started)
    if (observation.objects !== undefined) throw new Error('Pixel observation leaked structured objects')
    return observation
  }

  #result(
    runId: string,
    goal: string,
    startedAt: string,
    steps: MultimodalEpisodeStep[],
    metrics: MultimodalEpisodeMetrics,
    status: MultimodalEpisodeResult['status'],
    success: boolean,
    reason: string,
  ): MultimodalEpisodeResult {
    return {
      runId,
      status,
      success,
      goal,
      provider: this.#provider.name,
      startedAt,
      completedAt: new Date(this.#now()).toISOString(),
      reason,
      steps: structuredClone(steps),
      metrics: structuredClone(metrics),
    }
  }
}

export class SequenceMultimodalProvider implements MultimodalProvider {
  readonly name: string
  readonly requests: PixelProviderRequest[] = []
  readonly #responses: unknown[]

  constructor(responses: unknown[], name = 'sequence-provider') {
    this.name = name
    this.#responses = [...responses]
  }

  async generate(request: PixelProviderRequest): Promise<unknown> {
    assertPixelSafeProviderRequest(request)
    this.requests.push(structuredClone(request))
    if (this.#responses.length === 0) throw new Error('Sequence provider has no remaining response')
    return structuredClone(this.#responses.shift())
  }
}

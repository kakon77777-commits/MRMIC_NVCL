import { createHash, randomUUID } from 'node:crypto'
import type {
  LabObservation,
  LabRasterFrame,
  MultimodalCanvasLab,
  RasterCrop,
} from '../../multimodal-lab/src/index.js'
import { ObservationGovernor, type ObservationDisposition } from './governor.js'
import type { ProviderUsage } from './index.js'

export type RealProviderABPolicy = 'always_full' | 'governor_roi'
export type VisualCircleState = 'red' | 'amber' | 'other' | 'not_visible'
export const REAL_PROVIDER_AB_ACKNOWLEDGEMENT = 'I_UNDERSTAND_THIS_USES_CODEX_ACCOUNT_CAPACITY'

export interface RealProviderABAuthorizationInput {
  acknowledgement?: string
  confirmed: boolean
  maxProviderCalls?: number
  maxTotalTokens?: number
}

export interface RealProviderABAuthorization {
  authorized: true
  maxProviderCalls: 8
  maxTotalTokens: number
}

export function authorizeRealProviderAB(input: RealProviderABAuthorizationInput): RealProviderABAuthorization {
  if (input.acknowledgement !== REAL_PROVIDER_AB_ACKNOWLEDGEMENT) throw new Error('Real Provider A/B acknowledgement is missing')
  if (!input.confirmed) throw new Error('Real Provider A/B confirmation flag is missing')
  if (input.maxProviderCalls !== 8) throw new Error('Real Provider A/B requires an exact eight-call budget')
  if (!Number.isInteger(input.maxTotalTokens) || (input.maxTotalTokens ?? 0) < 1) throw new Error('Real Provider A/B requires a positive Token budget')
  return { authorized: true, maxProviderCalls: 8, maxTotalTokens: input.maxTotalTokens! }
}

export interface VisualObservationRequest {
  protocolVersion: 'mrmic-visual-observation-v1'
  task: string
  frame: {
    mimeType: 'image/png'
    imageBase64: string
    imageSha256: string
    sourceRenderSha256: string
    width: number
    height: number
    crop?: RasterCrop
  }
  observationPolicy: {
    policy: RealProviderABPolicy
    disposition: ObservationDisposition
    sequence: number
    reason: string
  }
}

export interface VisualObservationResponse {
  circleColor: VisualCircleState
  targetVisible: boolean
  confidence: number
  summary: string
  model?: string
  usage?: ProviderUsage
}

export interface VisualObservationProvider {
  readonly name: string
  observeVisual(request: VisualObservationRequest): Promise<unknown>
}

export interface ProviderABLabSession {
  lab: MultimodalCanvasLab
  close(): void | Promise<void>
}

export interface RealProviderABRunnerOptions {
  createLab(policy: RealProviderABPolicy): ProviderABLabSession | Promise<ProviderABLabSession>
  provider: VisualObservationProvider
  maxProviderCalls: number
  maxTotalTokens: number
  requireUsage?: boolean
  now?: () => number
  onProgress?: (progress: RealProviderABProgress) => void | Promise<void>
}

export interface RealProviderABProgress {
  policy: RealProviderABPolicy
  step: RealProviderABStep
  totalProviderCalls: number
  totalUsage: Required<ProviderUsage>
}

export interface RealProviderABStep {
  sampleIndex: number
  label: string
  expectedCircleColor: 'red' | 'amber'
  sourceRasterSha256: string
  sourceRenderSha256: string
  sourceByteLength: number
  disposition: ObservationDisposition
  delivered: boolean
  deliveredByteLength: number
  providerLatencyMs: number
  semanticCorrect?: boolean
  response?: Omit<VisualObservationResponse, 'usage'>
  usage?: ProviderUsage
}

export interface RealProviderABArmResult {
  policy: RealProviderABPolicy
  sourceTraceSha256: string
  actionPlanSha256: string
  samples: number
  providerCalls: number
  providerCallsAvoided: number
  deliveredBytes: number
  sourceBytes: number
  semanticCorrect: number
  semanticEvaluated: number
  semanticAccuracy: number
  providerLatencyMs: number
  usage: Required<ProviderUsage>
  freshnessPassed: number
  transitionGuardsPassed: number
  steps: RealProviderABStep[]
}

export interface RealProviderABResult {
  protocolVersion: 'mrmic-real-provider-ab-v1'
  runId: string
  provider: string
  model?: string
  sourceTraceIdentical: boolean
  actionPlanIdentical: boolean
  callsSavedByGovernor: number
  inputTokensSavedByGovernor: number
  totalTokensSavedByGovernor: number
  arms: RealProviderABArmResult[]
  totalProviderCalls: number
  totalUsage: Required<ProviderUsage>
  boundary: string
}

const TASK = 'Inspect only the supplied pixels. Classify the visible solid circle fill as red, amber, other, or not_visible. Do not infer hidden state or emit object identifiers.'
const ACTION_PLAN = [
  { label: 'transient_on', color: 'amber', style: { fill: '#f59e0b', stroke: '#92400e', strokeWidth: 7 } },
  { label: 'transient_restore', color: 'red', style: { fill: '#ef4444', stroke: '#991b1b', strokeWidth: 4 } },
] as const

const emptyUsage = (): Required<ProviderUsage> => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
})

function addUsage(total: Required<ProviderUsage>, usage: ProviderUsage): void {
  total.inputTokens += usage.inputTokens ?? 0
  total.cachedInputTokens += usage.cachedInputTokens ?? 0
  total.outputTokens += usage.outputTokens ?? 0
  total.reasoningOutputTokens += usage.reasoningOutputTokens ?? 0
  total.totalTokens += usage.totalTokens ?? 0
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function validateUsage(value: unknown): ProviderUsage | undefined {
  if (value === undefined) return undefined
  const source = record(value)
  const output: ProviderUsage = {}
  for (const key of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'] as const) {
    const item = source[key]
    if (item === undefined) continue
    if (typeof item !== 'number' || !Number.isInteger(item) || item < 0) throw new Error(`visual response usage.${key} is invalid`)
    output[key] = item
  }
  return output
}

export function validateVisualObservationResponse(value: unknown): VisualObservationResponse {
  if (JSON.stringify(value).match(/object_?ids?/i)) throw new Error('Visual observation response contains a forbidden object identifier field')
  const source = record(value)
  const circleColor = source.circleColor
  if (!['red', 'amber', 'other', 'not_visible'].includes(String(circleColor))) {
    throw new Error('Visual observation response circleColor is invalid')
  }
  if (typeof source.targetVisible !== 'boolean') throw new Error('Visual observation response targetVisible must be boolean')
  if (typeof source.confidence !== 'number' || !Number.isFinite(source.confidence) || source.confidence < 0 || source.confidence > 1) {
    throw new Error('Visual observation response confidence must stay within [0, 1]')
  }
  if (typeof source.summary !== 'string' || !source.summary.trim()) throw new Error('Visual observation response summary is required')
  const usage = validateUsage(source.usage)
  return {
    circleColor: circleColor as VisualCircleState,
    targetVisible: source.targetVisible,
    confidence: source.confidence,
    summary: source.summary,
    ...(typeof source.model === 'string' && source.model ? { model: source.model } : {}),
    ...(usage ? { usage } : {}),
  }
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, now() - startedAt)
}

export class RealProviderABRunner {
  readonly #createLab: RealProviderABRunnerOptions['createLab']
  readonly #provider: VisualObservationProvider
  readonly #maxProviderCalls: number
  readonly #maxTotalTokens: number
  readonly #requireUsage: boolean
  readonly #now: () => number
  readonly #onProgress?: RealProviderABRunnerOptions['onProgress']
  readonly #totalUsage = emptyUsage()
  #totalCalls = 0

  constructor(options: RealProviderABRunnerOptions) {
    if (!Number.isInteger(options.maxProviderCalls) || options.maxProviderCalls < 1) throw new Error('maxProviderCalls must be a positive integer')
    if (!Number.isInteger(options.maxTotalTokens) || options.maxTotalTokens < 1) throw new Error('maxTotalTokens must be a positive integer')
    this.#createLab = options.createLab
    this.#provider = options.provider
    this.#maxProviderCalls = options.maxProviderCalls
    this.#maxTotalTokens = options.maxTotalTokens
    this.#requireUsage = options.requireUsage ?? true
    this.#now = options.now ?? Date.now
    this.#onProgress = options.onProgress
  }

  async run(runId = `phase12-real-provider-ab-${randomUUID()}`): Promise<RealProviderABResult> {
    this.#totalCalls = 0
    Object.assign(this.#totalUsage, emptyUsage())
    const arms: RealProviderABArmResult[] = []
    for (const policy of ['always_full', 'governor_roi'] as const) arms.push(await this.#runArm(runId, policy))
    const [always, governor] = arms
    if (!always || !governor) throw new Error('Real Provider A/B requires both policy arms')
    const models = new Set(arms.flatMap(arm => arm.steps.map(step => step.response?.model).filter((item): item is string => Boolean(item))))
    const result: RealProviderABResult = {
      protocolVersion: 'mrmic-real-provider-ab-v1',
      runId,
      provider: this.#provider.name,
      ...(models.size === 1 ? { model: [...models][0] } : {}),
      sourceTraceIdentical: always.sourceTraceSha256 === governor.sourceTraceSha256,
      actionPlanIdentical: always.actionPlanSha256 === governor.actionPlanSha256,
      callsSavedByGovernor: always.providerCalls - governor.providerCalls,
      inputTokensSavedByGovernor: always.usage.inputTokens - governor.usage.inputTokens,
      totalTokensSavedByGovernor: always.usage.totalTokens - governor.usage.totalTokens,
      arms,
      totalProviderCalls: this.#totalCalls,
      totalUsage: structuredClone(this.#totalUsage),
      boundary: 'Opt-in controlled synthetic observation A/B. Provider responses cannot authorize actions; PNG and Token results do not prove arbitrary video, game, or desktop generalization.',
    }
    if (!result.sourceTraceIdentical || !result.actionPlanIdentical) throw new Error('Provider A/B arms did not replay an identical source trace')
    if (JSON.stringify(result).match(/object_?ids?/i)) throw new Error('Provider A/B result leaked a forbidden object identifier field')
    return result
  }

  async #runArm(runId: string, policy: RealProviderABPolicy): Promise<RealProviderABArmResult> {
    const session = await this.#createLab(policy)
    const usage = emptyUsage()
    const steps: RealProviderABStep[] = []
    const sourceHashes: string[] = []
    let freshnessPassed = 0
    let transitionGuardsPassed = 0
    let current: LabObservation | undefined
    const governor = policy === 'governor_roi'
      ? new ObservationGovernor({
          lab: session.lab,
          differenceThreshold: 0.0001,
          blockDifferenceThreshold: 0.02,
          keyframeInterval: 50,
          maxRoiFraction: 0.35,
          roiPaddingPx: 24,
        })
      : undefined

    try {
      const blank = await session.lab.observe('pixel')
      const reset = await session.lab.resetBenchmark(`${runId}:${policy}:reset`, blank.frameId, 'pixel')
      current = reset.observation
      await this.#sample(session.lab, policy, governor, current, 'initial_red', 'red', steps, sourceHashes, usage)
      current = await session.lab.observe('pixel')
      await this.#sample(session.lab, policy, governor, current, 'static_red', 'red', steps, sourceHashes, usage)

      for (const [index, action] of ACTION_PLAN.entries()) {
        const executed = await session.lab.execute({
          actionId: `${runId}:${policy}:action:${index + 1}`,
          frameId: current.frameId,
          canvasId: current.canvasId,
          expectedCanvasRevision: current.canvasRevision,
          type: 'gesture',
          coordinateSpace: 'frame_pixel',
          gesture: { kind: 'restyle', at: { x: 145, y: 285 }, style: structuredClone(action.style) },
        }, 'pixel')
        if (executed.evidence.freshnessVerified) freshnessPassed += 1
        if (executed.evidence.transitionGuard === 'passed' && executed.evidence.verifiedChange) transitionGuardsPassed += 1
        current = executed.observation
        await this.#sample(session.lab, policy, governor, current, action.label, action.color, steps, sourceHashes, usage)
      }

      current = await session.lab.observe('pixel')
      await this.#sample(session.lab, policy, governor, current, 'settled_red', 'red', steps, sourceHashes, usage)
      const providerCalls = steps.filter(step => step.delivered).length
      const semanticEvaluated = steps.filter(step => step.semanticCorrect !== undefined).length
      const semanticCorrect = steps.filter(step => step.semanticCorrect).length
      return {
        policy,
        sourceTraceSha256: sha256(sourceHashes),
        actionPlanSha256: sha256(ACTION_PLAN),
        samples: steps.length,
        providerCalls,
        providerCallsAvoided: steps.length - providerCalls,
        deliveredBytes: steps.reduce((sum, step) => sum + step.deliveredByteLength, 0),
        sourceBytes: steps.reduce((sum, step) => sum + step.sourceByteLength, 0),
        semanticCorrect,
        semanticEvaluated,
        semanticAccuracy: semanticEvaluated ? semanticCorrect / semanticEvaluated : 0,
        providerLatencyMs: steps.reduce((sum, step) => sum + step.providerLatencyMs, 0),
        usage,
        freshnessPassed,
        transitionGuardsPassed,
        steps,
      }
    } finally {
      await session.close()
    }
  }

  async #sample(
    lab: MultimodalCanvasLab,
    policy: RealProviderABPolicy,
    governor: ObservationGovernor | undefined,
    observation: LabObservation,
    label: string,
    expectedCircleColor: 'red' | 'amber',
    steps: RealProviderABStep[],
    sourceHashes: string[],
    armUsage: Required<ProviderUsage>,
  ): Promise<void> {
    const source = await (governor ? this.#sourceAndGoverned(lab, governor, observation) : this.#sourceAlways(lab, observation))
    sourceHashes.push(source.audit.observation.sha256)
    const base: RealProviderABStep = {
      sampleIndex: steps.length + 1,
      label,
      expectedCircleColor,
      sourceRasterSha256: source.audit.observation.sha256,
      sourceRenderSha256: observation.renderSha256,
      sourceByteLength: source.audit.observation.byteLength,
      disposition: source.disposition,
      delivered: Boolean(source.delivery),
      deliveredByteLength: source.delivery?.observation.byteLength ?? 0,
      providerLatencyMs: 0,
    }
    if (!source.delivery) {
      steps.push(base)
      await this.#reportProgress(policy, base)
      return
    }
    if (this.#totalCalls >= this.#maxProviderCalls) throw new Error(`Provider call budget ${this.#maxProviderCalls} exhausted before another call`)
    if (this.#totalUsage.totalTokens >= this.#maxTotalTokens) throw new Error(`Provider Token budget ${this.#maxTotalTokens} exhausted before another call`)
    const request: VisualObservationRequest = {
      protocolVersion: 'mrmic-visual-observation-v1',
      task: TASK,
      frame: {
        mimeType: 'image/png',
        imageBase64: Buffer.from(source.delivery.png).toString('base64'),
        imageSha256: source.delivery.observation.sha256,
        sourceRenderSha256: source.delivery.observation.sourceRenderSha256,
        width: source.delivery.observation.width,
        height: source.delivery.observation.height,
        ...(source.delivery.observation.crop ? { crop: structuredClone(source.delivery.observation.crop) } : {}),
      },
      observationPolicy: {
        policy,
        disposition: source.disposition,
        sequence: steps.length + 1,
        reason: source.reason,
      },
    }
    if (JSON.stringify(request).match(/object_?ids?/i)) throw new Error('Visual Provider request leaked a forbidden object identifier field')
    const startedAt = this.#now()
    const response = validateVisualObservationResponse(await this.#provider.observeVisual(structuredClone(request)))
    const providerLatencyMs = elapsed(this.#now, startedAt)
    this.#totalCalls += 1
    if (this.#requireUsage && response.usage?.totalTokens === undefined) throw new Error('Real Provider A/B requires per-call Token telemetry')
    const responseUsage = response.usage ?? {}
    addUsage(armUsage, responseUsage)
    addUsage(this.#totalUsage, responseUsage)
    const { usage: _usage, ...safeResponse } = response
    const step: RealProviderABStep = {
      ...base,
      providerLatencyMs,
      semanticCorrect: response.circleColor === expectedCircleColor,
      response: safeResponse,
      ...(response.usage ? { usage: response.usage } : {}),
    }
    steps.push(step)
    await this.#reportProgress(policy, step)
  }

  async #reportProgress(policy: RealProviderABPolicy, step: RealProviderABStep): Promise<void> {
    await this.#onProgress?.({
      policy,
      step: structuredClone(step),
      totalProviderCalls: this.#totalCalls,
      totalUsage: structuredClone(this.#totalUsage),
    })
  }

  async #sourceAlways(lab: MultimodalCanvasLab, observation: LabObservation): Promise<{
    audit: LabRasterFrame
    delivery: LabRasterFrame
    disposition: ObservationDisposition
    reason: string
  }> {
    const audit = await lab.rasterize(observation.frameId)
    return { audit, delivery: audit, disposition: 'full_frame', reason: 'unconditional_full_frame' }
  }

  async #sourceAndGoverned(lab: MultimodalCanvasLab, governor: ObservationGovernor, observation: LabObservation): Promise<{
    audit: LabRasterFrame
    delivery?: LabRasterFrame
    disposition: ObservationDisposition
    reason: string
  }> {
    const governed = await governor.observe(observation.frameId)
    const audit = await lab.rasterize(observation.frameId)
    return { audit, ...(governed.raster ? { delivery: governed.raster } : {}), disposition: governed.disposition, reason: governed.reason }
  }
}

import type {
  LabRasterFrame,
  MultimodalCanvasLab,
  RasterCrop,
  RasterPerceptualSignature,
} from '../../multimodal-lab/src/index.js'

export type ObservationDisposition = 'keyframe' | 'full_frame' | 'roi' | 'skip'

export interface ObservationGovernorOptions {
  lab: MultimodalCanvasLab
  differenceThreshold?: number
  blockDifferenceThreshold?: number
  keyframeInterval?: number
  maxRoiFraction?: number
  roiPaddingPx?: number
  minimumRoiSize?: number
}

export interface GovernedObservation {
  sequence: number
  disposition: ObservationDisposition
  reason: string
  differenceScore: number
  changedFraction: number
  sourceRasterSha256: string
  sourceByteLength: number
  crop?: RasterCrop
  raster?: LabRasterFrame
}

interface SignatureState {
  signature: RasterPerceptualSignature
  frameWidth: number
  frameHeight: number
}

function ratio(value: number, fallback: number, label: string): number {
  const selected = Number.isFinite(value) ? value : fallback
  if (selected < 0 || selected > 1) throw new Error(`${label} must stay within [0, 1]`)
  return selected
}

function positiveInteger(value: number, fallback: number, label: string): number {
  const selected = Number.isFinite(value) ? Math.floor(value) : fallback
  if (selected < 1) throw new Error(`${label} must be a positive integer`)
  return selected
}

export class ObservationGovernor {
  readonly #lab: MultimodalCanvasLab
  readonly #differenceThreshold: number
  readonly #blockDifferenceThreshold: number
  readonly #keyframeInterval: number
  readonly #maxRoiFraction: number
  readonly #roiPaddingPx: number
  readonly #minimumRoiSize: number
  #previous?: SignatureState
  #sequence = 0
  #lastKeyframeSequence = 0
  #forcedReason?: string

  constructor(options: ObservationGovernorOptions) {
    this.#lab = options.lab
    this.#differenceThreshold = ratio(options.differenceThreshold ?? 0.006, 0.006, 'differenceThreshold')
    this.#blockDifferenceThreshold = ratio(options.blockDifferenceThreshold ?? 0.06, 0.06, 'blockDifferenceThreshold')
    this.#keyframeInterval = positiveInteger(options.keyframeInterval ?? 8, 8, 'keyframeInterval')
    this.#maxRoiFraction = ratio(options.maxRoiFraction ?? 0.55, 0.55, 'maxRoiFraction')
    this.#roiPaddingPx = Math.max(0, Math.floor(options.roiPaddingPx ?? 32))
    this.#minimumRoiSize = positiveInteger(options.minimumRoiSize ?? 96, 96, 'minimumRoiSize')
  }

  forceNextKeyframe(reason = 'forced_resynchronization'): void {
    this.#forcedReason = reason
  }

  reset(): void {
    this.#previous = undefined
    this.#sequence = 0
    this.#lastKeyframeSequence = 0
    this.#forcedReason = undefined
  }

  async observe(frameId: string): Promise<GovernedObservation> {
    const full = await this.#lab.rasterize(frameId)
    this.#sequence += 1
    const current: SignatureState = {
      signature: structuredClone(full.perceptualSignature),
      frameWidth: full.observation.width,
      frameHeight: full.observation.height,
    }
    const previous = this.#previous
    this.#previous = current

    if (!previous) return this.#keyframe(full, 'initial_keyframe', 0, 1)
    if (previous.frameWidth !== current.frameWidth || previous.frameHeight !== current.frameHeight
      || previous.signature.width !== current.signature.width || previous.signature.height !== current.signature.height) {
      return this.#keyframe(full, 'surface_geometry_changed', 1, 1)
    }
    if (this.#forcedReason) {
      const reason = this.#forcedReason
      this.#forcedReason = undefined
      return this.#keyframe(full, reason, 1, 1)
    }
    const change = this.#difference(previous.signature, current.signature)
    if (this.#sequence - this.#lastKeyframeSequence >= this.#keyframeInterval) {
      return this.#keyframe(full, 'periodic_resynchronization', change.score, change.changedFraction)
    }
    if (change.score < this.#differenceThreshold || change.changedBlocks === 0 || !change.bounds) {
      return {
        sequence: this.#sequence,
        disposition: 'skip',
        reason: 'below_perceptual_threshold',
        differenceScore: change.score,
        changedFraction: change.changedFraction,
        sourceRasterSha256: full.observation.sha256,
        sourceByteLength: full.observation.byteLength,
      }
    }

    const crop = this.#crop(change.bounds, current)
    const cropFraction = crop.width * crop.height / (current.frameWidth * current.frameHeight)
    if (cropFraction > this.#maxRoiFraction) {
      return {
        sequence: this.#sequence,
        disposition: 'full_frame',
        reason: 'change_region_exceeds_roi_budget',
        differenceScore: change.score,
        changedFraction: change.changedFraction,
        sourceRasterSha256: full.observation.sha256,
        sourceByteLength: full.observation.byteLength,
        raster: full,
      }
    }
    const raster = await this.#lab.rasterize(frameId, crop)
    return {
      sequence: this.#sequence,
      disposition: 'roi',
      reason: 'localized_perceptual_change',
      differenceScore: change.score,
      changedFraction: change.changedFraction,
      sourceRasterSha256: full.observation.sha256,
      sourceByteLength: full.observation.byteLength,
      crop,
      raster,
    }
  }

  #keyframe(full: LabRasterFrame, reason: string, differenceScore: number, changedFraction: number): GovernedObservation {
    this.#lastKeyframeSequence = this.#sequence
    this.#forcedReason = undefined
    return {
      sequence: this.#sequence,
      disposition: 'keyframe',
      reason,
      differenceScore,
      changedFraction,
      sourceRasterSha256: full.observation.sha256,
      sourceByteLength: full.observation.byteLength,
      raster: full,
    }
  }

  #difference(previous: RasterPerceptualSignature, current: RasterPerceptualSignature): {
    score: number
    changedBlocks: number
    changedFraction: number
    bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  } {
    const blocks = current.width * current.height
    let total = 0
    let changedBlocks = 0
    let minX = current.width
    let minY = current.height
    let maxX = -1
    let maxY = -1
    for (let block = 0; block < blocks; block += 1) {
      const offset = block * 3
      const blockDifference = (
        Math.abs((current.samples[offset] ?? 0) - (previous.samples[offset] ?? 0))
        + Math.abs((current.samples[offset + 1] ?? 0) - (previous.samples[offset + 1] ?? 0))
        + Math.abs((current.samples[offset + 2] ?? 0) - (previous.samples[offset + 2] ?? 0))
      ) / (255 * 3)
      total += blockDifference
      if (blockDifference < this.#blockDifferenceThreshold) continue
      changedBlocks += 1
      const x = block % current.width
      const y = Math.floor(block / current.width)
      minX = Math.min(minX, x)
      minY = Math.min(minY, y)
      maxX = Math.max(maxX, x)
      maxY = Math.max(maxY, y)
    }
    return {
      score: blocks ? total / blocks : 0,
      changedBlocks,
      changedFraction: blocks ? changedBlocks / blocks : 0,
      ...(changedBlocks ? { bounds: { minX, minY, maxX, maxY } } : {}),
    }
  }

  #crop(
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    state: SignatureState,
  ): RasterCrop {
    const blockWidth = state.frameWidth / state.signature.width
    const blockHeight = state.frameHeight / state.signature.height
    let x = Math.floor(bounds.minX * blockWidth) - this.#roiPaddingPx
    let y = Math.floor(bounds.minY * blockHeight) - this.#roiPaddingPx
    let right = Math.ceil((bounds.maxX + 1) * blockWidth) + this.#roiPaddingPx
    let bottom = Math.ceil((bounds.maxY + 1) * blockHeight) + this.#roiPaddingPx
    x = Math.max(0, x)
    y = Math.max(0, y)
    right = Math.min(state.frameWidth, right)
    bottom = Math.min(state.frameHeight, bottom)

    if (right - x < this.#minimumRoiSize) {
      const expansion = this.#minimumRoiSize - (right - x)
      x = Math.max(0, x - Math.ceil(expansion / 2))
      right = Math.min(state.frameWidth, x + this.#minimumRoiSize)
      x = Math.max(0, right - this.#minimumRoiSize)
    }
    if (bottom - y < this.#minimumRoiSize) {
      const expansion = this.#minimumRoiSize - (bottom - y)
      y = Math.max(0, y - Math.ceil(expansion / 2))
      bottom = Math.min(state.frameHeight, y + this.#minimumRoiSize)
      y = Math.max(0, bottom - this.#minimumRoiSize)
    }
    return { x, y, width: right - x, height: bottom - y }
  }
}

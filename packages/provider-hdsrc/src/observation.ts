import { resourcePortalDescriptor, type CanvasObject } from '../../canvas-schema/src/index.js'
import {
  assertMaterializationFresh,
  HdsrcProviderError,
  type HdsrcAccessContext,
  type HdsrcMaterializationV1,
  type HdsrcProviderClient,
  type HdsrcResourcePayload,
} from './index.js'

export type HdsrcReadOnlyObservation =
  | HdsrcHumanPreviewObservation
  | HdsrcStructuredManifestObservation
  | HdsrcMachineCarrierObservation

export interface HdsrcHumanPreviewObservation {
  mode: 'human_preview'
  resource: HdsrcResourcePayload
}

export interface HdsrcStructuredManifestObservation {
  mode: 'structured_manifest'
  materialization: HdsrcMaterializationV1
}

export interface HdsrcMachineCarrierObservation {
  mode: 'machine_carrier'
  resource: HdsrcResourcePayload
}

function materializationRef(portal: CanvasObject): string {
  const descriptor = resourcePortalDescriptor(portal)
  if (descriptor.provider !== 'external') {
    throw new HdsrcProviderError('INVALID_REQUEST', 'HDSRC portal provider must be external in integration v0.1')
  }
  if (descriptor.resourceKind !== 'artifact') {
    throw new HdsrcProviderError('INVALID_REQUEST', 'HDSRC portal resourceKind must be artifact in integration v0.1')
  }
  if (!descriptor.providerResourceId.startsWith('hdsrc://')) {
    throw new HdsrcProviderError('INVALID_REQUEST', 'HDSRC portal providerResourceId must be an hdsrc:// URI')
  }
  return descriptor.providerResourceId
}

function stateRef(materialization: HdsrcMaterializationV1): string {
  return `hdsrc://state/${materialization.stateId}`
}

function preauthorizeObservation(
  mode: 'human_preview' | 'structured_manifest' | 'machine_carrier',
  context: HdsrcAccessContext,
): void {
  if (!['human_preview', 'structured_manifest', 'machine_carrier'].includes(mode)) {
    throw new HdsrcProviderError('INVALID_REQUEST', `unsupported HDSRC observation mode: ${String(mode)}`)
  }
  if (mode === 'structured_manifest' && context.trustedStructured !== true) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'trusted structured HDSRC observation is not authorized')
  }
  if (mode === 'machine_carrier' && context.trustedMachine !== true) {
    throw new HdsrcProviderError('UNAUTHORIZED', 'trusted machine-carrier HDSRC observation is not authorized')
  }
}

export class HdsrcObservationBridge {
  readonly #provider: HdsrcProviderClient

  constructor(provider: HdsrcProviderClient) {
    this.#provider = provider
  }

  async observe(
    portal: CanvasObject,
    mode: 'human_preview' | 'structured_manifest' | 'machine_carrier',
    context: HdsrcAccessContext,
  ): Promise<HdsrcReadOnlyObservation> {
    preauthorizeObservation(mode, context)

    const ref = materializationRef(portal)
    const materialization = await this.#provider.materialization(ref, context)
    const state = await this.#provider.state(stateRef(materialization), context)
    assertMaterializationFresh(state, materialization)

    if (mode === 'human_preview') {
      const resource = await this.#provider.readResource(materialization.previewResourceUri, context)
      if (!resource.mimeType.startsWith('image/')) {
        throw new HdsrcProviderError('INTEGRITY_FAILURE', 'human preview resource must be an image')
      }
      return { mode: 'human_preview', resource }
    }

    if (mode === 'structured_manifest') {
      return { mode: 'structured_manifest', materialization: structuredClone(materialization) }
    }

    const resource = await this.#provider.readResource(materialization.machineResourceUri, context)
    if (resource.uri === materialization.previewResourceUri) {
      throw new HdsrcProviderError('INTEGRITY_FAILURE', 'machine carrier must not alias the human preview resource')
    }
    return { mode: 'machine_carrier', resource }
  }
}

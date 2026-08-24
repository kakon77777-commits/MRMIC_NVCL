export const MRMIC_CAPABILITIES_URI = 'mrmic://capabilities'

export interface MrmicCapabilitiesV1 {
  schema: 'mrmic-capabilities/v1'
  mrmicVersion: string
  canvasSchemaVersion: string
  mcpProtocolProfile: { protocolVersion: string; profile: string }
  projectionModes: string[]
  authModes: string[]
  resourcePortal: { supported: boolean; schemaVersion: string }
  runtimePresence: { supported: boolean; schemaVersion: string; durable: false }
  livePortalHost: { supported: boolean; stateVersion: string }
}

export const MRMIC_CAPABILITIES: MrmicCapabilitiesV1 = Object.freeze({
  schema: 'mrmic-capabilities/v1',
  mrmicVersion: '0.14.0',
  canvasSchemaVersion: 'mrmic-canvas/0.14',
  mcpProtocolProfile: { protocolVersion: '2025-11-25', profile: 'stateful-streamable-http-subset' },
  projectionModes: ['compat_frame_v0', 'native_resource_portal_v1'],
  authModes: ['legacy_local', 'bearer_principal_v1'],
  resourcePortal: { supported: true, schemaVersion: 'native_resource_portal_v1' },
  runtimePresence: { supported: true, schemaVersion: 'ephemeral_runtime_presence_v1', durable: false as const },
  livePortalHost: { supported: true, stateVersion: 'live_portal_host_v1' },
})

export function capabilityDocument(): MrmicCapabilitiesV1 {
  return structuredClone(MRMIC_CAPABILITIES)
}

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
  observerWorkspace: {
    supported: boolean
    viewSchemaVersion: string
    rendezvousSchemaVersion: string
    durableEventSchemaVersion: string
    durable: boolean
    authRequired: boolean
    nestedCanvas: {
      supported: boolean
      contextSchemaVersion: string
      visibilityModes: string[]
      maxDepth: number
      topologyAuthorityRequired: boolean
    }
    http: { snapshotPath: string; commandPath: string }
    mcp: { path: string; selfResourceUri: string; tools: string[] }
    referenceServer: { command: string; defaultPort: number }
  }
  windowsProvider: {
    supported: boolean
    providerId: 'windows'
    resourceKind: 'desktop_window'
    resourceSchemaVersion: 'windows_window_resource_v1'
    providerCapabilitySchemaVersion: 'windows_provider_capabilities_v1'
    adapterPackage: '@mrmic/provider-windows'
    adapterVersion: '0.15.4'
    nativeBridge: { required: true; referenceImplementation: false }
    capture: { api: 'windows_graphics_capture'; target: 'hwnd'; minimumBuild: 18362 }
    automation: {
      api: 'uia'
      semanticPatternsPreferred: true
      inputInjectionFallback: 'bridge-declared'
      interactiveDesktopRequiredForInjection: true
    }
  }
}

export const MRMIC_CAPABILITIES: MrmicCapabilitiesV1 = Object.freeze({
  schema: 'mrmic-capabilities/v1',
  mrmicVersion: '0.14.0',
  canvasSchemaVersion: 'mrmic-canvas/0.14',
  mcpProtocolProfile: { protocolVersion: '2025-11-25', profile: 'stateful-streamable-http-subset' },
  projectionModes: [
    'compat_frame_v0',
    'native_resource_portal_v1',
    'observer_relative_view_v1',
    'observer_nested_canvas_v1',
    'windows_desktop_window_v1',
  ],
  authModes: ['legacy_local', 'bearer_principal_v1'],
  resourcePortal: { supported: true, schemaVersion: 'native_resource_portal_v1' },
  runtimePresence: { supported: true, schemaVersion: 'ephemeral_runtime_presence_v1', durable: false as const },
  livePortalHost: { supported: true, stateVersion: 'live_portal_host_v1' },
  observerWorkspace: {
    supported: true,
    viewSchemaVersion: 'observer_view_v1',
    rendezvousSchemaVersion: 'shared_rendezvous_v1',
    durableEventSchemaVersion: 'observer_workspace_event_v1',
    durable: true,
    authRequired: true,
    nestedCanvas: {
      supported: true,
      contextSchemaVersion: 'observer_nested_canvas_v1',
      visibilityModes: ['inherit', 'hidden'],
      maxDepth: 64,
      topologyAuthorityRequired: true,
    },
    http: { snapshotPath: '/api/observer/snapshot', commandPath: '/api/observer/command' },
    mcp: {
      path: '/mcp/observer',
      selfResourceUri: 'mrmic://observer/self',
      tools: ['observer.get_snapshot', 'observer.get_canvas_contexts', 'observer.command'],
    },
    referenceServer: { command: 'npm run observer', defaultPort: 4180 },
  },
  windowsProvider: {
    supported: true,
    providerId: 'windows',
    resourceKind: 'desktop_window',
    resourceSchemaVersion: 'windows_window_resource_v1',
    providerCapabilitySchemaVersion: 'windows_provider_capabilities_v1',
    adapterPackage: '@mrmic/provider-windows',
    adapterVersion: '0.15.4',
    nativeBridge: { required: true, referenceImplementation: false },
    capture: { api: 'windows_graphics_capture', target: 'hwnd', minimumBuild: 18362 },
    automation: {
      api: 'uia',
      semanticPatternsPreferred: true,
      inputInjectionFallback: 'bridge-declared',
      interactiveDesktopRequiredForInjection: true,
    },
  } as const,
})

export function capabilityDocument(): MrmicCapabilitiesV1 {
  return structuredClone(MRMIC_CAPABILITIES)
}

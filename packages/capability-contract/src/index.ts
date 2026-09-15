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
  livePortalHost: {
    supported: boolean
    stateVersion: string
    controlLeaseSchemaVersion: 'live_portal_control_lease_v1'
    controlGenerationSupported: true
    atomicHandoffSupported: true
  }
  operationalRuntime: {
    supported: true
    runtimeVersion: 'provider_operational_runtime_v1'
    commandSchemaVersion: 'mrmic_operational_command_v1'
    effectReceiptSchemaVersion: 'mrmic_effect_receipt_v1'
    idempotencyScope: 'runtime_instance'
    maxCachedReceipts: 256
    providerAdapters: readonly ['windows']
    strongerProviderIdempotencyAllowed: true
    postActionVerificationRequired: false
    continuousPerceptionDecoupled: true
    effectReceiptClaimsWorldState: false
    mrmicHumanApprovalGateRequired: false
    conformanceHarnessRuntimeAuthority: false
  }
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
    nativeBridge: {
      required: true
      protocolVersion: 'mrmic-windows-native-bridge/v1'
      referenceImplementation: true
      referenceProject: 'native/windows-bridge-csharp'
      scope: 'observer_gated_snapshot_portal'
      discoveryImplemented: true
      captureSessionImplemented: true
      frameTransportImplemented: true
      captureImplemented: true
      automationInspectionImplemented: true
      automationImplemented: true
      rawInputInjectionImplemented: false
    }
    capture: {
      api: 'windows_graphics_capture'
      target: 'hwnd'
      minimumBuild: 18362
      sessionLifecycleSupported: true
      frameTransport: 'png_base64_snapshot_v1'
      portalProjection: 'ephemeral_render_copy_v1'
      observerGated: true
      canonicalPixelsDurable: false
      maxActiveMounts: 4
      frameQueueCapacity: 2
      maxSnapshotPixels: 8294400
      maxSnapshotBytes: 16777216
      refresh: {
        policySchemaVersion: 'observer_portal_refresh_policy_v1'
        liveRefreshMs: 250
        warmRefreshMs: 2000
        sharedRefreshMs: 500
        policyPollMs: 1000
        maxCachedFramesPerTarget: 4
        frozenRetainsLastFrame: true
        sleepingDropsFrame: true
        nonOverlapping: true
      }
    }
    interactiveValidation: {
      supported: true
      evidenceSchemaVersion: 'interactive_windows_e2e_v1'
      command: string
      targetSelectors: readonly ['title', 'hwnd']
      callerConfirmationRequired: true
      hostedCiAuthoritativeUserDesktop: false
      evidencePersistsPixelPayload: false
    }
    interactiveControlValidation: {
      supported: true
      evidenceSchemaVersion: 'interactive_windows_controlled_action_e2e_v1'
      command: string
      safeTargetOnly: true
      targetTitle: string
      rootAutomationId: string
      callerConfirmationRequired: true
      hostedCiAuthoritativeInteractiveAction: false
      supportedActions: readonly ['invoke', 'toggle', 'select', 'set_value']
      evidencePersistsPixelPayload: false
      evidencePersistsSetValuePayload: false
      rawInputUsed: false
    }
    operationalAdapter: {
      supported: true
      sharedRuntimeVersion: 'provider_operational_runtime_v1'
      commandSchemaVersion: 'windows_operational_command_v1'
      effectReceiptSchemaVersion: 'windows_effect_receipt_v1'
    }
    automation: {
      api: 'uia'
      inspectionSupported: true
      actionSupported: true
      snapshotSchemaVersion: 'windows_uia_snapshot_v1'
      actionResultSchemaVersion: 'windows_uia_controlled_action_v1'
      supportedActions: readonly ['invoke', 'toggle', 'select', 'set_value']
      controlOwnerRequired: true
      controlGenerationRequired: true
      freshInspectionRequired: true
      preNativeActionLeaseRecheck: true
      maxInspectionAgeMs: 2000
      actionValueMaxLength: 2048
      passwordValueWriteAllowed: false
      maxDepth: 8
      maxElements: 512
      maxPatternsPerElement: 32
      valueTextIncluded: false
      semanticPatternsPreferred: true
      inputInjectionFallback: 'disabled'
      rawInputInjectionImplemented: false
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
    'windows_snapshot_portal_v1',
    'observer_portal_refresh_v1',
    'windows_uia_inspection_v1',
    'windows_uia_controlled_action_v1',
    'windows_ai_native_operational_runtime_v1',
    'provider_neutral_operational_runtime_v1',
  ],
  authModes: ['legacy_local', 'bearer_principal_v1'],
  resourcePortal: { supported: true, schemaVersion: 'native_resource_portal_v1' },
  runtimePresence: { supported: true, schemaVersion: 'ephemeral_runtime_presence_v1', durable: false as const },
  livePortalHost: {
    supported: true,
    stateVersion: 'live_portal_host_v1',
    controlLeaseSchemaVersion: 'live_portal_control_lease_v1',
    controlGenerationSupported: true,
    atomicHandoffSupported: true,
  } as const,
  operationalRuntime: {
    supported: true,
    runtimeVersion: 'provider_operational_runtime_v1',
    commandSchemaVersion: 'mrmic_operational_command_v1',
    effectReceiptSchemaVersion: 'mrmic_effect_receipt_v1',
    idempotencyScope: 'runtime_instance',
    maxCachedReceipts: 256,
    providerAdapters: ['windows'],
    strongerProviderIdempotencyAllowed: true,
    postActionVerificationRequired: false,
    continuousPerceptionDecoupled: true,
    effectReceiptClaimsWorldState: false,
    mrmicHumanApprovalGateRequired: false,
    conformanceHarnessRuntimeAuthority: false,
  } as const,
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
    nativeBridge: {
      required: true,
      protocolVersion: 'mrmic-windows-native-bridge/v1',
      referenceImplementation: true,
      referenceProject: 'native/windows-bridge-csharp',
      scope: 'observer_gated_snapshot_portal',
      discoveryImplemented: true,
      captureSessionImplemented: true,
      frameTransportImplemented: true,
      captureImplemented: true,
      automationInspectionImplemented: true,
      automationImplemented: true,
      rawInputInjectionImplemented: false,
    },
    capture: {
      api: 'windows_graphics_capture',
      target: 'hwnd',
      minimumBuild: 18362,
      sessionLifecycleSupported: true,
      frameTransport: 'png_base64_snapshot_v1',
      portalProjection: 'ephemeral_render_copy_v1',
      observerGated: true,
      canonicalPixelsDurable: false as const,
      maxActiveMounts: 4,
      frameQueueCapacity: 2,
      maxSnapshotPixels: 8294400,
      maxSnapshotBytes: 16777216,
      refresh: {
        policySchemaVersion: 'observer_portal_refresh_policy_v1',
        liveRefreshMs: 250,
        warmRefreshMs: 2000,
        sharedRefreshMs: 500,
        policyPollMs: 1000,
        maxCachedFramesPerTarget: 4,
        frozenRetainsLastFrame: true,
        sleepingDropsFrame: true,
        nonOverlapping: true,
      },
    },
    interactiveValidation: {
      supported: true,
      evidenceSchemaVersion: 'interactive_windows_e2e_v1',
      command: 'npm run windows:e2e --',
      targetSelectors: ['title', 'hwnd'],
      callerConfirmationRequired: true,
      hostedCiAuthoritativeUserDesktop: false,
      evidencePersistsPixelPayload: false,
    },
    interactiveControlValidation: {
      supported: true,
      evidenceSchemaVersion: 'interactive_windows_controlled_action_e2e_v1',
      command: 'npm run windows:control-e2e --',
      safeTargetOnly: true,
      targetTitle: 'MRMIC Phase 15.13 Controlled Action Target',
      rootAutomationId: 'MrmicControlledActionTargetRoot',
      callerConfirmationRequired: true,
      hostedCiAuthoritativeInteractiveAction: false,
      supportedActions: ['invoke', 'toggle', 'select', 'set_value'],
      evidencePersistsPixelPayload: false,
      evidencePersistsSetValuePayload: false,
      rawInputUsed: false,
    },
    operationalAdapter: {
      supported: true,
      sharedRuntimeVersion: 'provider_operational_runtime_v1',
      commandSchemaVersion: 'windows_operational_command_v1',
      effectReceiptSchemaVersion: 'windows_effect_receipt_v1',
    },
    automation: {
      api: 'uia',
      inspectionSupported: true,
      actionSupported: true,
      snapshotSchemaVersion: 'windows_uia_snapshot_v1',
      actionResultSchemaVersion: 'windows_uia_controlled_action_v1',
      supportedActions: ['invoke', 'toggle', 'select', 'set_value'],
      controlOwnerRequired: true,
      controlGenerationRequired: true,
      freshInspectionRequired: true,
      preNativeActionLeaseRecheck: true,
      maxInspectionAgeMs: 2000,
      actionValueMaxLength: 2048,
      passwordValueWriteAllowed: false,
      maxDepth: 8,
      maxElements: 512,
      maxPatternsPerElement: 32,
      valueTextIncluded: false,
      semanticPatternsPreferred: true,
      inputInjectionFallback: 'disabled',
      rawInputInjectionImplemented: false,
      interactiveDesktopRequiredForInjection: true,
    },
  } as const,
})

export function capabilityDocument(): MrmicCapabilitiesV1 {
  return structuredClone(MRMIC_CAPABILITIES)
}

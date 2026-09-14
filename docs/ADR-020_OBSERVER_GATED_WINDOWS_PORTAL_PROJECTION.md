# ADR-020 — Windows Visual Frames Enter Canvas Only as Observer-Gated Ephemeral Render Copies

Status: Accepted  
Phase: 15.8

## Context

Phase 15.7 can move a bounded, integrity-checked PNG snapshot across the Windows native process boundary. That is still not sufficient to make the pixels part of the MRMIC shared visual world.

MRMIC has three independent authorities that must not collapse into one another:

1. the provider owns the live Windows resource and capture session;
2. the observer workspace owns who may see a private view or a selectively converged rendezvous projection;
3. canonical Canvas owns durable geometry/resource identity, but not provider-local pixels or runtime liveness.

Writing a data URI or raw frame bytes into the canonical `resource_portal` object would blur those authorities and would also make high-churn pixel state durable. Conversely, rendering a provider snapshot without consulting observer-relative visibility would leak a private AI workspace into another observer's projection.

## Decision

Phase 15.8 introduces a provider-neutral `live_portal_visual_frame_v1` and an observer-gated ephemeral render-copy path.

### Provider / LivePortalHost boundary

`LivePortalHost` gains an optional `snapshot(handle)` operation. The returned frame is bound to:

- canonical `portalObjectId`;
- provider id;
- provider-owned resource id;
- monotonic provider frame sequence;
- capture timestamp and dimensions;
- MIME / transport metadata;
- SHA-256 and bounded Base64 bytes.

`WindowsSnapshotLivePortalHost` is the Phase 15.8 Windows reference host. It keeps the existing mount/update/unmount lifecycle and converts the already validated `windows_capture_snapshot_v1` into `live_portal_visual_frame_v1`.

The provider host does not decide whether an observer may see the frame.

### Observer visibility boundary

`observerAllowsPortalVisual` consumes only a principal-filtered `ObserverSnapshot`.

For a private observer view, a visual frame is eligible only when:

- the requested view belongs to that filtered snapshot;
- the view is not sleeping;
- the active Canvas context is effectively visible;
- the semantic `portalId` is in that active context's observer-relative foreground stack.

For a rendezvous, a visual frame is eligible only when:

- the room is present in the principal-filtered snapshot;
- the room is active;
- the semantic `portalId` has an explicit `SharedResourceProjection`.

Membership alone does not reveal another observer's private portal pixels.

### Portal id versus object id

Phase 15.8 explicitly keeps two identities separate:

- `portalId`: observer/rendezvous semantic resource-surface identity;
- `portalObjectId`: canonical Canvas object identity used by the live host/runtime.

Observer policy gates semantic `portalId`. Provider projection validates `portalObjectId + provider + providerResourceId`. Both checks must succeed before a frame is rendered.

### Ephemeral render copy

`snapshotPortalVisualFrame` reads a provider frame through the existing `LivePortalHostRegistry`.

`projectPortalVisualFrame` then creates a structured clone of the canonical Canvas object and replaces only the clone's `content.previewUri` with a `data:image/png;base64,...` URI.

The original Canvas object remains unchanged. The frame does not enter the durable event ledger, Canvas metadata, observer durable event stream or provider resource identity.

The existing SVG adapter already renders `data:` preview URIs as `<image>` elements, so no second Canvas renderer is introduced.

### Capability semantics

The reference stack may now report:

- `capture.supported=true` in the Windows native capability;
- global `captureImplemented=true`;
- `portalProjection=ephemeral_render_copy_v1`;
- `observerGated=true`;
- `canonicalPixelsDurable=false`.

This means a bounded Windows visual snapshot can be projected into an authorized MRMIC portal. It does not mean high-FPS streaming, zero-copy GPU sharing, UI Automation or arbitrary input injection is complete.

## Consequences

A real Windows resource can now be represented visually inside an observer-relative MRMIC world without turning Windows into the world authority and without persisting frame bytes as canonical state.

Private AI workspaces remain private by default. A visual becomes visible in a shared rendezvous only after explicit selective convergence.

The reference rendering path is correctness-first and snapshot-backed. Later slices may replace the transport/render mechanism with a higher-throughput surface while preserving the same observer and canonical-state boundaries.

## Non-goals

Phase 15.8 does not claim:

- continuous high-FPS rendering;
- zero-copy GPU texture sharing into a production compositor;
- UI Automation or semantic Windows actions;
- keyboard/pointer injection;
- UAC or secure-desktop bypass;
- durable storage of Windows pixels;
- automatic sharing of a private observer foreground into a rendezvous;
- completed HDUS integration.

# Phase 15.8 — Windows Observer-Gated Portal Projection

Status: implementation baseline complete on the Phase 15 feature branch; high-throughput live compositor integration remains a later slice.

Phase 15.8 connects the Phase 15.7 bounded Windows capture snapshot to the existing MRMIC `resource_portal`, `LivePortalHost`, observer-relative workspace and SVG rendering path without persisting provider pixels into canonical Canvas state.

## Delivered

- `live_portal_visual_frame_v1` provider-neutral visual frame contract.
- Optional `LivePortalHost.snapshot(handle)` visual-read surface.
- `WindowsSnapshotLivePortalHost` reference Windows host over the Phase 15.7 native snapshot bridge.
- `snapshotPortalVisualFrame` identity-checks a visual frame against canonical portal object/provider/resource identity.
- `projectPortalVisualFrame` injects a data URI only into an ephemeral structured clone of the Canvas object.
- `stripPortalVisualPreview` provides an explicit no-pixels render copy for denied observer projections.
- `observerAllowsPortalVisual` applies private-view and rendezvous visibility policy to semantic `portalId`.
- `projectPortalForObserver` composes the reference path so observer authorization occurs **before** provider `snapshot()` I/O; denied views do not read frame bytes from the provider.
- Private view visual access requires the portal in the active effectively-visible foreground stack.
- Rendezvous visual access requires an explicit `SharedResourceProjection`; room membership alone is insufficient.
- Hidden nested Canvas contexts cannot leak their foreground portal visuals.
- Existing SVG adapter renders the projected data URI without a new renderer.
- Native Windows capability reports snapshot-backed capture support; global capability reports `captureImplemented=true`, `observerGated=true`, `portalProjection=ephemeral_render_copy_v1`, and `canonicalPixelsDurable=false`.

## End-to-end reference behavior

The Phase 15.8 E2E exercises one Windows portal under three observer projections:

1. Agent A owns a private view and places the Windows semantic portal in its foreground stack — the observer gate passes, the provider is read, and the render copy includes the PNG snapshot.
2. Agent B owns a different private view — the gate fails before provider snapshot I/O and the render copy contains no pixels.
3. Agent A and Agent B join a rendezvous — membership alone still does not read or expose the frame. Agent A must explicitly `projectPortal()`; only then may Agent B's shared-room projection read and render the snapshot.

The canonical portal retains its provider URI and never stores the data URI.

## Explicit boundaries

Phase 15.8 does not provide:

- high-FPS or zero-copy live compositor transport;
- UI Automation or Windows semantic actions;
- unrestricted keyboard/pointer injection;
- secure-desktop/UAC bypass;
- durable frame storage;
- implicit private-to-shared visual propagation;
- real user-desktop interactive WGC E2E evidence beyond the current Windows helper smoke/build validation.

## Next slice

Phase 15.9 should add a bounded refresh/compositor loop over the same observer-gated projection contract, then validate real interactive Windows desktop capture. UI Automation should remain a separate authority slice after the visual projection path is stable.

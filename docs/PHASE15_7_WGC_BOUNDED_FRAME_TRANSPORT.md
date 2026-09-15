# Phase 15.7 — WGC Bounded Frame Transport

Status: implementation baseline complete on the Phase 15 feature branch; portal rendering integration remains a later slice.

Phase 15.7 extends the Phase 15.6 HWND-bound Windows Graphics Capture session with a bounded reference pixel transport across the native helper process boundary.

## Delivered

- `BoundedPngFrameTransport` receives checked-out WGC frames from `FrameArrived` without performing synchronous readback or encoding in the callback.
- Each mount has a bounded queue of **2** frames. Saturation drops older pending frames instead of allowing unbounded growth.
- The background transport worker uses `SoftwareBitmap.CreateCopyFromSurfaceAsync`, then PNG `BitmapEncoder`, to create a deep-copied encoded snapshot.
- Only the latest encoded snapshot is retained.
- Per-mount bounds: **8,294,400 pixels** and **16 MiB encoded PNG**.
- Global native capture bound remains **4 active mounts**.
- Resize handling drains transport-owned frames before `Direct3D11CaptureFramePool.Recreate`.
- Native JSONL protocol adds `capture.snapshot`.
- Snapshot result contract is `windows_capture_snapshot_v1` with mount/resource identity, frame sequence, timestamp, dimensions, PNG bytes, byte count, SHA-256 and transport identifier.
- `WindowsJsonlNativeBridge.snapshotCapture` revalidates identity, dimensions, pixel count, encoded byte count, Base64 decoded length, SHA-256, MIME and transport before accepting a native snapshot.
- `windows-capture-snapshot-v1.schema.json` formalizes the wire payload.
- Capability discovery advertises `frameTransportImplemented=true` and `frameTransport=png_base64_snapshot_v1` while retaining `captureImplemented=false`.

## Authority boundary

The transport is provider-owned runtime state. The snapshot bytes do not become canonical Canvas state, do not own observer identity, and do not alter `controlOwner`.

Phase 15.7 intentionally does **not** wire the PNG snapshot into `WindowsLivePortalHost` or a browser/live Canvas surface. Therefore global MRMIC capability still reports the Windows capture integration as incomplete even though bounded native frame transport now exists.

## Validation target

The portable job validates TypeScript contracts, snapshot integrity checks and the full repository regression suite. The Windows-native job compiles the CsWinRT/WGC helper and runs the native helper smoke path. Interactive desktop capture E2E remains a separate environment-specific validation because GitHub-hosted Windows runners are not treated as authoritative interactive desktop capture targets.

## Next slice

Phase 15.8 should project the bounded snapshot transport into the existing MRMIC resource-portal/live-host path, preserving observer-relative visibility and existing `controlOwner` authority. Higher-throughput or zero-copy live transport should remain a later optimization after the correctness path is closed.

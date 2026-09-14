# ADR-019 — Windows WGC Frames Cross the Native Boundary as Bounded Latest-Only PNG Snapshots

Status: Accepted  
Phase: 15.7

## Context

Phase 15.6 established an HWND-bound Windows Graphics Capture session lifecycle but deliberately stopped before pixel transport. A WGC `Direct3D11CaptureFrame` owns a GPU-backed surface whose useful lifetime is tied to the checked-out frame. Encoding or copying that surface synchronously inside `FrameArrived` would couple capture callback latency to GPU readback and image encoding, while an unbounded queue would allow a fast producer to exhaust memory when the consumer is slower.

MRMIC also needs the native helper to remain a provider-owned resource boundary rather than becoming a second Canvas authority. The first transport therefore needs bounded memory, explicit frame identity/integrity, stale-frame tolerance and no assumption that every captured frame must be delivered.

## Decision

Phase 15.7 introduces `png_base64_snapshot_v1` as the first reference frame transport.

### Callback / worker separation

`FrameArrived` only obtains the next `Direct3D11CaptureFrame`, records bounded session facts and transfers frame ownership to `BoundedPngFrameTransport`. Pixel conversion and PNG encoding occur in a background worker.

The worker performs:

1. `SoftwareBitmap.CreateCopyFromSurfaceAsync` to deep-copy the GPU surface;
2. PNG encoding through `BitmapEncoder`;
3. SHA-256 over the encoded bytes;
4. replacement of the previous latest snapshot.

### Bounds

The reference implementation fixes the following conservative limits:

- maximum active Windows capture mounts: **4**;
- frame queue capacity per mount: **2**;
- maximum snapshot pixels: **8,294,400** (4K UHD pixel count);
- maximum encoded PNG bytes: **16 MiB**;
- only the latest encoded snapshot is retained per mount.

When the queue is saturated, older pending frames are dropped and disposed rather than allowing unbounded growth. This is intentional: MRMIC needs fresh observer evidence, not lossless video recording.

### Resize discipline

A changed WGC content size does not call `FramePool.Recreate` while transport-owned frames may still be outstanding. New frames are temporarily dropped, pending frames are drained, the worker reaches idle, and only then is the frame pool recreated. Oversized replacement dimensions close the capture instead of broadening the resource budget.

### Native protocol

`mrmic-windows-native-bridge/v1` adds:

- `capture.snapshot`

A successful result uses `windows_capture_snapshot_v1` and contains mount/resource identity, monotonic frame sequence, capture timestamp, dimensions, PNG byte count, SHA-256, Base64 payload and transport identifier.

### Trust boundary

`WindowsJsonlNativeBridge.snapshotCapture` does not trust native JSON blindly. It independently verifies:

- requested mount and provider-resource identity;
- positive bounded dimensions and pixel count;
- encoded byte-count bound;
- Base64 decoded length;
- SHA-256 syntax and digest equality;
- MIME and transport identifiers.

Any mismatch fails closed.

### Capability semantics

`frameTransportImplemented=true` means a bounded reference snapshot transport exists across the native process boundary. It does **not** mean the Windows provider is a completed Canvas live surface.

Therefore Phase 15.7 keeps:

- `captureImplemented=false` in the global MRMIC capability;
- provider-level `capture.supported=false`;
- UI Automation unimplemented.

The next portal-integration slice may promote snapshot bytes into an observer-relative Canvas projection without changing Windows resource ownership.

## Consequences

MRMIC can now move real WGC pixels across its Windows native process boundary without an unbounded video pipeline. The reference path favors freshness and bounded resource use over frame completeness. Base64 PNG is intentionally a correctness/reference transport, not the final high-throughput live-video transport.

## Non-goals

Phase 15.7 does not claim:

- continuous high-FPS Canvas rendering;
- zero-copy GPU sharing across the process boundary;
- video encoding or archival recording;
- HDR/color-management completeness;
- UI Automation or input injection;
- UAC/secure-desktop capture bypass;
- real interactive WGC capture E2E evidence on a user desktop.

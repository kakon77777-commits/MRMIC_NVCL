# ADR-022 — Interactive Windows E2E Evidence Must Be User-Session Executed and Pixel-Minimal

Status: Accepted  
Phase: 15.10

## Context

Phases 15.5–15.9 established a complete reference chain from Win32 discovery through HWND-bound Windows Graphics Capture, bounded PNG transport, observer-gated resource-portal projection and lifecycle-aware refresh. GitHub-hosted Windows CI can compile and launch the helper for capability and enumeration smoke tests, but that environment is not authoritative evidence for a real user-interactive desktop capture path.

MRMIC therefore needs a reproducible way to validate the same production path against an actual top-level window in the caller's Windows session without introducing a separate test-only capture implementation or persisting screenshots as validation artifacts.

## Decision

Phase 15.10 adds a local interactive validation harness that reuses the production authorities:

```text
real top-level HWND
  -> WindowsJsonlNativeBridge
  -> WindowsProviderCatalog
  -> WindowsSnapshotLivePortalHost
  -> CanvasLivePortalCoordinator
  -> ObserverWorkspaceRegistry
  -> ObserverPortalCompositor / RefreshLoop
  -> SVG resource_portal render copy
  -> interactive_windows_e2e_v1 evidence
```

### Explicit caller confirmation

The CLI requires `--confirm-interactive`, and the PowerShell wrapper supplies it only when explicitly invoked by the user. This is a human assertion that the command is being run from the intended interactive Windows session; MRMIC does not infer such authority from hosted CI or a generic Windows process.

### Target selection

A run must select exactly one discoverable top-level window by either:

- title substring; or
- normalized HWND.

Zero matches and ambiguous title matches fail closed. Minimized targets are rejected by the harness before capture validation.

### Evidence contract

Successful evidence uses `interactive_windows_e2e_v1` and records:

- provider epoch/resource identity;
- HWND, PID and title;
- portal/canvas/view identities;
- requested sample count;
- frame sequence and capture timestamp;
- independently recomputed PNG SHA-256;
- encoded byte length and PNG dimensions;
- proof that the existing SVG resource-portal renderer consumed the projected image;
- frozen and sleeping lifecycle zero-I/O assertions;
- proof that canonical Canvas retained the provider URI instead of a data URI.

The evidence **does not** contain Base64 image bytes, data URIs or other captured pixel payloads. Validation evidence must not become a durable screenshot channel.

### Production path only

The harness does not implement another capture stack. It uses the same native helper, TypeScript trust boundary, live portal host, observer gate and compositor that normal MRMIC execution uses.

### Hosted CI boundary

GitHub Windows CI may:

- build the native helper;
- run the existing capability/window-enumeration smoke;
- parse the interactive PowerShell harness for syntax validity;
- run portable fake-bridge tests for the evidence contract.

Hosted CI is explicitly **not** authoritative user-desktop WGC E2E evidence.

### Lifecycle validation

After collecting valid live samples, the harness verifies:

- `frozen`: retains the latest observer-scoped render frame while performing zero provider snapshot reads;
- `sleeping`: performs zero provider snapshot reads and clears the observer compositor's pixel cache.

This ensures the real-path validation covers the lifecycle semantics introduced in Phase 15.9 rather than validating capture in isolation.

## Consequences

A developer or operator can now create machine-readable proof that a selected real Windows application traversed the entire MRMIC visual pipeline in an interactive user session. The proof remains small, reviewable and non-pixel-bearing.

The repository can distinguish three evidence levels instead of collapsing them:

1. portable contract/unit tests;
2. hosted Windows helper build/smoke;
3. caller-executed interactive user-session evidence.

## Non-goals

Phase 15.10 does not claim:

- that GitHub-hosted runners represent the user's desktop;
- high-FPS or zero-copy compositor performance;
- UI Automation inspection or control;
- keyboard/pointer injection;
- secure-desktop/UAC bypass;
- screenshot archival;
- automatic validation of every arbitrary third-party window;
- completed HDUS integration.

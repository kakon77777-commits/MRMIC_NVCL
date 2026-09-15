# Phase 15.10 — Interactive Windows User-Session E2E Validation Harness

Status: executable validation baseline complete on the Phase 15 feature branch; a repository-hosted run is not treated as proof of a caller's desktop session.

Phase 15.10 turns the Phase 15.5–15.9 Windows visual stack into a caller-executable validation workflow for a real top-level window in an interactive Windows session.

## Delivered

- `runInteractiveWindowsE2E()` reuses the production Windows provider, native bridge, live portal host, observer workspace and refresh/compositor authorities.
- CLI: `apps/windows-interactive-e2e/src/index.ts`.
- PowerShell runner: `scripts/windows-interactive-e2e.ps1`.
- Root command: `npm run windows:e2e --`.
- Target selection by exactly one title substring or normalized HWND.
- Explicit `--confirm-interactive` requirement before provider access.
- Evidence schema: `interactive_windows_e2e_v1`.
- Evidence records resource identity, frame sequence/timestamp, independently recomputed PNG SHA-256, byte length, dimensions and SVG projection proof.
- Evidence omits Base64/data URI/pixel payloads.
- Successful run additionally proves Phase 15.9 lifecycle behavior: frozen retains the last visual with no new provider read; sleeping clears the pixel cache with no provider read.
- Canonical portal must retain its `windows://` preview/provider URI and never persist the projected data URI.
- Hosted Windows CI parses the PowerShell harness but does not run it as a user-desktop claim.

## Local Windows usage

Choose a visible, non-minimized top-level application window whose title identifies it unambiguously.

PowerShell from the repository root:

```powershell
npm run windows:e2e -- -Title "Notepad"
```

Or select a specific HWND:

```powershell
npm run windows:e2e -- -Hwnd "0x123456"
```

Optional controls:

```powershell
npm run windows:e2e -- -Title "Notepad" -Samples 5 -TimeoutMs 30000 -Output ".\artifacts\windows-interactive-e2e\notepad.json"
```

The wrapper builds both the .NET/CsWinRT helper and TypeScript runtime before launching the production-path harness.

## Successful evidence means

A successful `interactive_windows_e2e_v1` artifact proves that, for the selected window and that particular run:

1. the native helper discovered the real top-level window;
2. MRMIC bound it to the current provider epoch/resource identity;
3. HWND-bound WGC mounted successfully;
4. bounded PNG frames crossed the native process boundary;
5. observer authorization permitted the private foreground visual;
6. the lifecycle-aware refresh/compositor path read and projected the frame;
7. the existing SVG resource-portal renderer consumed the projected data URI;
8. PNG hashes/dimensions were independently re-derived from the render copy;
9. frozen and sleeping lifecycle behavior performed zero additional provider pixel reads;
10. no pixel payload was stored in the validation evidence or canonical Canvas portal.

## What hosted CI proves

Hosted CI continues to prove:

- portable TypeScript/contracts/tests;
- native Windows/CsWinRT compilation;
- real helper capability/window-enumeration smoke;
- PowerShell harness syntax validity.

It does **not** prove a real user-interactive application was captured and rendered. That third evidence layer must come from a caller-executed local Windows run.

## Failure semantics

The interactive harness fails closed when:

- caller confirmation is absent;
- platform is not Windows;
- no target or more than one title target matches;
- target is minimized;
- live capture is not advertised;
- WGC cannot mount or produce a frame before timeout;
- projected output is not a valid PNG data URI;
- frame sequence regresses;
- existing SVG rendering does not consume the projected image;
- frozen or sleeping lifecycle behavior causes unexpected provider I/O;
- canonical portal state contains captured data URI bytes.

## Explicit boundaries

Phase 15.10 still does not provide UI Automation, semantic Windows actions, input injection, UAC/secure-desktop bypass, zero-copy GPU sharing or high-FPS compositor transport.

## Next slice

After collecting at least one real local interactive evidence artifact, the next clean authority slice is read-only UI Automation inspection. Semantic UIA actions should remain behind the existing `controlOwner` authority and should not be combined with unrestricted input injection.

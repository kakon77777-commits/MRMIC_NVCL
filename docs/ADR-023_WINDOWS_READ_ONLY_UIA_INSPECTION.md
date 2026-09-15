# ADR-023 — Bounded Read-Only Windows UI Automation Inspection

Status: Accepted for Phase 15.11.

## Context

Phase 15.4–15.10 established a Windows provider identity, executable Win32 discovery, HWND-bound Windows Graphics Capture, bounded frame transport, observer-gated portal rendering, lifecycle-aware refresh, and a caller-executed interactive validation harness.

Those slices allow an observer to see a Windows application without making Windows pixels canonical MRMIC state. They do not yet give MRMIC a structured semantic description of the controls inside that application.

Windows UI Automation (UIA) is the appropriate structured-observation lane for supported desktop applications, but inspection and control must remain separate authorities. Adding UIA inspection must not silently add click, invoke, text entry, input injection, or ownership semantics.

## Decision

Phase 15.11 adds a bounded **read-only** UI Automation inspection lane.

The native reference helper uses Windows Desktop UI Automation:

- `AutomationElement.FromHandle(HWND)` to bind the semantic root to the already-known Windows resource;
- `TreeWalker.ControlViewWalker` to walk the UIA control view;
- `GetSupportedPatterns()` to report bounded pattern capability names without invoking those patterns.

The native root is revalidated against the same provider identity used by the visual lane:

```text
providerEpoch + processId + HWND -> providerResourceId
```

A stale epoch, invalid/reused HWND, PID mismatch, or provider-resource mismatch fails closed before the semantic tree is returned.

## Bounded snapshot contract

The semantic snapshot schema is `windows_uia_snapshot_v1`.

Reference bounds are fixed to:

- maximum traversal depth: **8**;
- maximum descendants: **512**;
- maximum supported-pattern names per element: **32**;
- maximum ordinary string field length: **2048** characters.

The returned metadata may include:

- UIA runtime id;
- parent runtime id and depth;
- `Name`;
- `AutomationId`;
- class name;
- control type and localized control type;
- process id and native window handle;
- enabled/offscreen/keyboard-focusable state;
- `IsPassword` as a boolean;
- bounding rectangle;
- supported UIA pattern names.

The tree is live provider state. Descendants that disappear while the bounded walk is executing may be omitted. `truncated=true` reports that the configured depth/element bound prevented a complete traversal.

## Content-minimization rule

Phase 15.11 intentionally does **not** read or export control value/text payloads through:

- `ValuePattern.Current.Value`;
- `TextPattern.DocumentRange`;
- equivalent semantic action/value APIs.

Password values are never read. Only the `IsPassword` boolean metadata may be exposed.

This does not claim that every allowed UIA `Name` is non-sensitive; `Name` remains ordinary bounded semantic metadata and consumers must treat UIA snapshots as ephemeral provider observations rather than public/durable documents.

## Two trust boundaries

The native helper performs Windows identity validation and bounded UIA traversal.

MRMIC then independently validates the returned object through `parseWindowsUiaSnapshot()`:

- exact schema id;
- expected provider-resource identity;
- timestamp validity;
- exact configured bounds;
- root depth/topology;
- unique runtime ids;
- descendant parent references;
- finite/non-negative bounds;
- supported-pattern count and uniqueness;
- whitelisted output fields only.

`WindowsUiaReadOnlyAccess` also checks `WindowsAccessAuthority.canInspect(...)` **before** provider `inspectUi()` I/O.

## Inspection is not control

The Phase 15.11 reference semantic lane exposes only:

```text
WindowsUiaReadOnlyAccess.inspect(...)
```

It has no semantic-action method.

At the native protocol boundary:

```text
uia.inspect -> implemented
uia.action  -> UIA_ACTION_NOT_IMPLEMENTED
```

Global capability therefore distinguishes:

```text
automationInspectionImplemented = true
automationImplemented = false
inspectionSupported = true
actionSupported = false
inputInjectionFallback = disabled
```

Existing `controlOwner` remains authoritative and unchanged. Visibility/inspection permission is not control permission.

## Persistence and world authority

`windows_uia_snapshot_v1` is ephemeral provider/runtime observation.

It is not:

- canonical Canvas topology;
- durable observer intent;
- resource ownership;
- proof that the HWND remains alive after the read;
- a control lease;
- a durable UI event/history ledger.

Windows remains the native UI authority.

## Local validation

The repository exposes a Windows-only read command:

```powershell
npm run windows:uia -- -Title "Notepad"
```

or:

```powershell
npm run windows:uia -- -Hwnd "0x123456"
```

The PowerShell runner builds the native helper and TypeScript runtime, then writes a bounded `windows_uia_snapshot_v1` artifact. The CLI requires explicit `--confirm-readonly` internally before provider access.

Hosted Windows CI compiles the real UIAutomationClient reference code, runs capability/window smoke, and parses the PowerShell harness. Hosted CI is not treated as proof that a caller-owned desktop application's UIA tree was inspected successfully.

## Consequences

Phase 15 now has two complementary observation lanes for a Windows resource:

```text
visual evidence  -> WGC / bounded observer-gated portal
semantic evidence -> bounded read-only UIA snapshot
```

Neither lane grants control.

Semantic UIA actions remain a later slice and must be designed behind the existing control authority rather than inferred from supported pattern names.

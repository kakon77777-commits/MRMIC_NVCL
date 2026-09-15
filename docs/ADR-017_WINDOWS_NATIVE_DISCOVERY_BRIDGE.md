# ADR-017 — Windows Native Discovery Bridge Is a Bounded Process Authority

Status: Accepted  
Phase: 15.5

## Context

Phase 15.4 established a first-class `windows / desktop_window` provider contract, but the provider still depended on an abstract native bridge. MRMIC therefore knew how a Windows window should be represented and projected without yet owning an executable implementation that could enumerate native windows.

The first native implementation must not collapse the OS desktop into the MRMIC world authority, and it must not make unsupported capture or automation claims merely because one native helper now exists.

## Decision

Phase 15.5 adds a reference Windows-native discovery bridge under:

```text
native/windows-bridge-csharp/
```

The helper is a separate .NET 8 process and communicates with the TypeScript provider through the versioned JSONL protocol:

```text
mrmic-windows-native-bridge/v1
```

The process boundary is intentional. Native Windows API failures, malformed output, process termination, and timeouts remain provider/transport failures instead of becoming in-process corruption of the Canvas or observer authorities.

## Implemented Native Scope

The Phase 15.5 reference helper implements discovery only.

Its native enumeration path uses Win32/DWM facts including:

- top-level `EnumWindows` enumeration;
- window visibility;
- DWM cloaking state;
- minimized state;
- process ID;
- thread ID;
- window title;
- window class;
- HWND identity represented as a normalized hexadecimal handle.

The provider continues to derive MRMIC resource identity from:

```text
providerEpoch + processId + hwndHex
```

HWND alone is not durable identity and must not survive a provider epoch boundary as proof of object continuity.

## Explicitly Unimplemented Scope

Phase 15.5 does not implement the reference native code for:

- Windows Graphics Capture frame acquisition;
- D3D frame transport;
- UI Automation tree inspection;
- UIA semantic actions;
- raw mouse/keyboard injection.

The native helper returns typed unsupported/not-implemented failures for unimplemented operations. The TypeScript bridge must propagate those failures rather than fabricate a fallback success.

Capability discovery therefore records all of the following at the same time:

```text
referenceImplementation = true
scope = discovery_only
discoveryImplemented = true
captureImplemented = false
automationImplemented = false
```

`referenceImplementation=true` is not a claim that the complete Windows bridge exists.

## Process Protocol

The TypeScript side owns a JSONL process client that:

- assigns request IDs;
- correlates concurrent responses by request ID;
- rejects malformed JSON or malformed envelopes;
- fails pending requests when the helper exits unexpectedly;
- treats request timeout as a terminal process-boundary failure;
- does not automatically replay ambiguous native operations across a failed process boundary.

This keeps process lifecycle separate from durable observer state and from Canvas resource ownership.

## Authority Boundary

The native helper is a provider fact source only.

It does not own:

- Canvas geometry;
- observer private views;
- rendezvous membership;
- canonical recursive Canvas topology;
- `controlOwner`;
- semantic AI identity;
- durable liveness claims.

Window discovery may refresh provider-local runtime facts, but it cannot turn those facts into durable world truth without going through the existing MRMIC resource/portal authorities.

## Validation Boundary

Repository CI validates the discovery bridge at two levels:

1. the C# project is compiled under .NET 8 with warnings treated as errors;
2. the TypeScript JSONL client is exercised against deterministic fake child processes for concurrency, typed remote failure, malformed stdout, timeout, and unexpected exit behavior.

Linux CI compilation proves the reference helper source is buildable. It does **not** prove that Win32/DWM calls have executed successfully on a real Windows desktop.

Real-host Windows validation remains a later acceptance gate.

## Consequences

Positive:

- MRMIC now contains an executable native discovery reference instead of only an abstract Windows bridge interface;
- native process failure cannot silently become durable observer or Canvas state;
- capability negotiation can accurately distinguish implemented discovery from planned capture/automation;
- future WGC and UIA implementations can extend the same process protocol without changing the observer-world model.

Trade-offs:

- a real Windows host is still required before claiming native discovery E2E evidence;
- capture and automation remain unavailable in the reference bridge;
- provider restart creates a new epoch and invalidates assumptions based on prior HWND identity.

## Next Boundary

The next Windows-native slice should implement and validate one bounded capability at a time, preferably:

1. real Windows-host discovery E2E;
2. HWND-bound Windows Graphics Capture frame acquisition;
3. read-only UIA inspection;
4. semantic UIA mutation behind existing `controlOwner` authority.

No later slice should weaken the single-world authority or provider-epoch identity rules established here.

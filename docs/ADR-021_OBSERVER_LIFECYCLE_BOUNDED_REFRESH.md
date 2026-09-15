# ADR-021 — Observer Lifecycle Controls a Bounded Non-Overlapping Portal Refresh Loop

Status: Accepted  
Phase: 15.9

## Context

Phase 15.8 closed the correctness path from a validated Windows WGC snapshot to an observer-authorized ephemeral `resource_portal` render copy. That path was intentionally single-shot. A useful multi-observer workspace now needs repeated refresh without turning snapshots into durable world state, reading private pixels for unauthorized observers, or allowing slow provider work to create overlapping/unbounded refresh operations.

The observer workspace already has durable lifecycle intent: `live`, `warm`, `frozen`, and `sleeping`. Phase 15.9 makes that lifecycle operational for visual refresh while keeping provider liveness and pixels ephemeral.

## Decision

MRMIC adds `observer_portal_refresh_policy_v1` and a reference `ObserverPortalCompositor` / `ObserverPortalRefreshLoop`.

### Reference cadence

The reference policy is deliberately conservative:

- `live`: refresh at most every **250 ms**;
- `warm`: refresh at most every **2000 ms**;
- explicitly projected rendezvous portal: refresh at most every **500 ms**;
- lifecycle/policy polling when no provider refresh is scheduled: **1000 ms**.

These values are correctness defaults, not a promise of a fixed frame rate. Provider latency may make effective cadence slower.

### Frozen and sleeping semantics

`frozen`:

- performs no provider snapshot I/O;
- may retain the most recent observer-scoped ephemeral render copy;
- if no cached frame exists, returns a no-pixels render copy.

`sleeping`:

- performs no provider snapshot I/O;
- evicts observer-scoped cached pixels;
- returns a no-pixels render copy.

Changing durable lifecycle intent therefore affects ephemeral rendering behavior without making the frame cache durable.

### Observer gate remains first

Every refresh still passes through the Phase 15.8 observer visibility rule before provider snapshot I/O. Private views require the semantic portal in the active effectively-visible foreground. Rendezvous membership alone is insufficient; an explicit `SharedResourceProjection` remains required.

A denied target clears its cached frame and never calls the provider.

### Bounded compositor cache

The reference compositor retains at most **4** observer-target/portal render copies. Overflow uses least-recently-used eviction. This bound aligns with the reference Windows native maximum of four active mounts, but it remains an MRMIC-side cache limit rather than native ownership.

### Non-overlapping loop

`ObserverPortalRefreshLoop` schedules the next tick only after the previous sequence finishes:

1. resolve the current observer snapshot and lifecycle policy;
2. optionally read a provider snapshot;
3. build the ephemeral render projection;
4. invoke the consumer callback;
5. schedule the next tick.

The reference loop never intentionally runs two refreshes for the same loop concurrently. This prevents a slow provider or renderer from building an unbounded backlog.

### Monotonic frame boundary

For one observer-target/portal cache entry, a positive provider `frameSequence` lower than the cached sequence is treated as a regression. The stale cached pixels are evicted and the operation fails closed to a no-pixels render copy.

The lower provider-neutral visual-frame contract still rejects invalid or non-positive sequence numbers before they reach this monotonic comparison.

### Failure behavior

A provider/read/projection failure:

- does not persist frame bytes;
- evicts the relevant cached frame;
- returns a no-pixels render copy plus bounded error information;
- allows the loop to re-evaluate policy/provider state on a later tick.

## Authority consequences

Durable authority remains with observer lifecycle, workspace membership/projection, and canonical Canvas/resource identity.

Ephemeral authority remains with HWND/WGC liveness, provider snapshots, compositor cache entries, refresh timers, and rendered pixel copies.

The refresh loop does not grant control, does not change `controlOwner`, and does not create a second visibility authority.

## Non-goals

Phase 15.9 does not claim:

- a 60 FPS or real-time video compositor;
- zero-copy cross-process GPU presentation;
- durable frame history or recording;
- adaptive network/video codecs;
- UI Automation or input injection;
- UAC/secure-desktop bypass;
- authoritative interactive user-desktop WGC E2E validation.

## Consequence for later work

The visual correctness path now has bounded sustained refresh. The next Windows milestone should validate the full capture/refresh/render path on an interactive Windows desktop target before increasing throughput or adding control semantics.

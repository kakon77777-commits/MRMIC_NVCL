# Phase 15.9 — Observer-Gated Bounded Refresh / Compositor Loop

Status: implementation baseline complete on the Phase 15 feature branch; interactive Windows-desktop validation remains a later slice.

Phase 15.9 turns the Phase 15.8 one-shot Windows snapshot projection into sustained, bounded observer-relative refresh while preserving the same privacy and durability boundaries.

## Delivered

- `observer_portal_refresh_policy_v1` formalizes the reference lifecycle/cadence policy.
- `ObserverPortalCompositor` keeps observer-target/portal render copies ephemeral and LRU-bounded.
- Reference cache bound: **4 frames/portal-target entries per compositor**.
- `live` private views refresh no faster than **250 ms**.
- `warm` private views refresh no faster than **2000 ms**.
- Explicitly projected rendezvous visuals refresh no faster than **500 ms**.
- `frozen` keeps the most recent cached render copy but performs **zero provider snapshot I/O**.
- `sleeping` performs zero provider snapshot I/O and drops cached pixels.
- Denied/hidden/private-not-foreground states clear the relevant cached pixels and do not read the provider.
- Provider frame-sequence regression fails closed and evicts stale pixels.
- Provider/projection failures clear cached pixels and return a no-pixels render copy.
- `ObserverPortalRefreshLoop` is non-overlapping: the next tick is scheduled only after the prior observer gate, provider read and projection callback finish.
- When no visual refresh is scheduled, the loop uses a **1000 ms** policy poll so lifecycle/visibility changes can be noticed without provider pixel reads.

## Lifecycle semantics

```text
live
  -> 250 ms reference refresh cadence

warm
  -> 2000 ms reference refresh cadence

frozen
  -> keep last observer-scoped frame
  -> no provider snapshot I/O

sleeping
  -> clear observer-scoped frame cache
  -> no provider snapshot I/O

rendezvous + explicit SharedResourceProjection
  -> 500 ms reference refresh cadence
```

Cadence is an upper-bound request rate, not a guaranteed frame rate. Slow provider/render work naturally lowers the effective rate because refresh operations do not overlap.

## Authority boundary

The Phase 15.8 rule remains unchanged:

```text
observer authorization
  -> provider visual read
  -> ephemeral render copy
```

The compositor never writes Base64 PNG data, frame sequence or refresh timers into canonical Canvas state or the durable observer event stream.

The Windows provider proves frame/resource identity. The observer snapshot proves visual eligibility. `controlOwner` remains independent and unchanged.

## Validation baseline

The Phase 15.9 tests exercise:

- live/warm throttling and no redundant provider reads;
- frozen retention with zero provider I/O;
- sleeping cache eviction with zero provider I/O;
- rendezvous membership vs explicit selective projection;
- valid positive frame-sequence regression (`2 -> 1`) fail-closed behavior;
- lifecycle policy resolution without provider access;
- non-overlapping refresh-loop scheduling.

## Explicit non-goals

Phase 15.9 is not:

- a high-FPS compositor;
- a zero-copy GPU transport;
- a frame-history recorder;
- a guarantee that GitHub-hosted runners reproduce an interactive user desktop;
- UI Automation or semantic input control;
- HDUS completion.

## Next slice

The next Windows slice should validate real interactive desktop discovery + WGC capture + bounded refresh + observer-gated portal rendering on a user-session Windows host. After that evidence is stable, read-only UI Automation can be added as a separate semantic-observation authority before any semantic mutation path.

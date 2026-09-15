# ADR-026 — Multi-Observer Control Handoff Uses Generation-Bound Live Leases

Status: Accepted for Phase 15.14

## Context

Phase 15.12 made `CanvasLivePortalCoordinator.controlOwner` the authority required before semantic Windows UI Automation actions. Phase 15.13 proved the controlled action path against a dedicated safe Windows target.

A remaining race exists if ownership changes while a fresh UIA inspection is in flight:

```text
A owns portal
  -> A passes controlOwner check
  -> A starts fresh UIA inspection
  -> control moves to B
  -> inspection returns
  -> A could otherwise continue into native action
```

Checking only the owner string after inspection is also insufficient because of an ABA transition:

```text
A -> B -> A
```

The final owner again appears to be A even though the original control lease was interrupted.

A second problem is the historical `WindowsProviderAccess.performUiAction()` API. It predates the Phase 15.12 controlled gateway and only knows provider policy, not the live MRMIC control lease. Leaving it operational creates a parallel action path.

## Decision

### 1. Live portal control has a generation

`CanvasLivePortalCoordinator` owns a per-portal monotonic control generation.

The externally readable ephemeral contract is:

```text
live_portal_control_lease_v1
```

with:

```text
portalObjectId
controlOwner
control generation
mounted
visible
```

Generation starts at `0` while no owner transition has occurred.

Every actual owner transition advances generation exactly once:

```text
null -> A
A -> null
A -> B
B -> A
```

Non-owner state changes do not advance the control generation.

Implicit control revocation caused by offscreen/unmount/provider replacement also advances the generation when it changes a non-null owner to null.

### 2. Handoff is an atomic coordinator operation

Phase 15.14 adds:

```text
handoffControl(portalObjectId, fromPrincipalId, toPrincipalId)
```

The operation requires:

- mounted portal;
- visible portal;
- current owner exactly equals `fromPrincipalId`;
- non-empty principals;
- distinct source and destination principals.

The owner changes directly from A to B and generation advances once.

This avoids requiring an intermediate ownerless state when the caller intends a direct transfer.

Release/reacquire remains valid and advances generation for both owner transitions.

### 3. Controlled semantic action is bound to one generation

`WindowsUiaControlledAccess.perform()` now captures the current lease before UIA provider I/O.

The action preparation path is:

```text
mounted + visible
  -> owner == principal
  -> capture control generation G
  -> canControl
  -> fresh read-authorized UIA inspection
  -> freshness / target / pattern checks
  -> re-read live control lease
  -> owner still == principal
  -> generation still == G
  -> re-check canControl + canInspect
  -> native semantic action
```

If generation changed at any point during inspection, native action I/O does not occur.

This detects both ordinary handoff and ABA handoff.

### 4. Action result records the generation

`windows_uia_controlled_action_v1` now includes:

```text
controlGeneration
```

The value identifies the ephemeral live lease generation under which the semantic action was authorized.

It is evidence about runtime authority, not durable ownership history.

### 5. Legacy direct provider action is disabled

`WindowsProviderAccess` remains available for compatibility read-only UI inspection.

Its historical `performUiAction()` method now fails closed and directs callers to:

```text
WindowsUiaControlledAccess
```

There is one reference MRMIC semantic action path, not two competing control authorities.

## Authority boundary

Control generation belongs to `CanvasLivePortalCoordinator`, not the Windows native helper.

The native helper still owns only Windows resource/UIA execution facts:

```text
providerEpoch + PID + HWND + providerResourceId
runtimeId + expected element facts
UIA pattern execution
```

It does not know MRMIC principals, observer membership or control lease generations.

## Durability boundary

Control leases and generations are ephemeral runtime authority.

They are intentionally not written into:

- canonical Canvas state;
- durable observer event history;
- provider resource identity;
- recovered cross-conversation ownership state.

A process restart does not claim that an old control generation remains live.

Durable observer continuity and ephemeral control liveness remain separate.

## Security consequences

Phase 15.14 closes:

- old-owner action after A-to-B handoff;
- ABA owner-string race during fresh inspection;
- action after release/reacquire under an interrupted old lease;
- the legacy `WindowsProviderAccess.performUiAction()` bypass.

It does not create:

- raw keyboard/pointer authority;
- durable control ownership;
- automatic control acquisition from visibility;
- rendezvous-derived control rights;
- native-helper ownership authority.

## Failure behavior

The system fails closed when:

- handoff source is not current owner;
- source/destination principal is blank;
- source and destination are identical;
- portal is not mounted/visible;
- owner changes during action preparation;
- generation changes during action preparation;
- control or inspect policy is revoked before native action I/O.

## Validation

Phase 15.14 tests cover:

- generation 0 before first control acquisition;
- acquisition advancing to generation 1;
- atomic A-to-B handoff advancing exactly once;
- old A rejected before provider I/O after handoff;
- B action succeeding under the new generation;
- release/reacquire producing a new generation;
- A-to-B-to-A ABA during fresh inspection rejected before native action I/O;
- wrong-owner and same-principal handoff rejection;
- schema/capability publication;
- legacy direct action surface failing closed.

## Consequence

MRMIC now treats control ownership as a **live generation-bound lease**, not merely an owner label.

The core invariant is:

```text
same principal != same control lease
```

when a handoff/revoke/reacquire occurred between two observations.

# Phase 15.14 — Multi-Observer Control Handoff

Status: generation-bound live control lease baseline.

Phase 15.14 closes the control-transfer race left after Phase 15.12/15.13 semantic UIA control.

The central rule is:

```text
Control owner identity is not enough.
Authorized action requires the same live control generation.
```

## Delivered

### Generation-bound control lease

`CanvasLivePortalCoordinator` now exposes:

```text
live_portal_control_lease_v1
```

with:

- `portalObjectId`
- `controlOwner`
- monotonic `generation`
- `mounted`
- `visible`

The lease is ephemeral runtime authority.

### Generation semantics

For one live coordinator process:

```text
initial no-owner state -> generation 0
null -> A             -> generation 1
A -> B                -> generation 2
B -> null             -> generation 3
null -> A             -> generation 4
```

Generation changes only when the owner changes.

Offscreen/unmount/provider replacement also advances generation when it revokes a live non-null owner.

### Atomic handoff

New coordinator API:

```text
handoffControl(portalObjectId, fromPrincipalId, toPrincipalId)
```

Requirements:

- portal mounted;
- portal visible;
- current owner exactly equals source principal;
- source/destination are non-empty and distinct.

A direct A-to-B transfer advances generation once.

### Semantic action TOCTOU closure

Before fresh UIA inspection, `WindowsUiaControlledAccess` captures the current generation-bound lease.

Immediately before native action I/O it rechecks:

- portal still mounted;
- portal still visible;
- same principal still owns control;
- generation is unchanged;
- `canControl` still allows action;
- `canInspect` still allows semantic access.

Thus a control transfer during the asynchronous inspection window invalidates the prepared action.

### ABA protection

The following transition is explicitly tested:

```text
A owns generation 1
A begins fresh UIA inspect
A -> B, generation 2
B -> A, generation 3
inspection returns
```

Although owner is again A, generation differs from the captured lease.

Result:

```text
native semantic action I/O = 0
```

### Controlled action evidence

`windows_uia_controlled_action_v1` now includes:

```text
controlGeneration
```

The generation identifies which live lease authorized that action.

It does not become durable Canvas/observer truth.

### Legacy action bypass closed

`WindowsProviderAccess.inspectUi()` remains a compatibility inspection surface.

`WindowsProviderAccess.performUiAction()` now fails closed.

All authorized semantic actions must use:

```text
WindowsUiaControlledAccess
```

This prevents policy-only provider access from bypassing live `controlOwner`/generation authority.

## Machine-readable capability

Global capability now reports:

```text
livePortalHost.controlLeaseSchemaVersion = live_portal_control_lease_v1
livePortalHost.controlGenerationSupported = true
livePortalHost.atomicHandoffSupported = true

windowsProvider.automation.controlGenerationRequired = true
windowsProvider.automation.preNativeActionLeaseRecheck = true
```

## What remains unchanged

Phase 15.14 does not alter:

- Windows provider resource identity;
- WGC capture semantics;
- observer visual visibility;
- UIA inspection bounds;
- the four semantic action kinds;
- raw input policy.

Raw keyboard/pointer injection remains disabled.

## Non-goals

Phase 15.14 does not claim:

- durable control leases across process restart;
- control inheritance from rendezvous membership;
- automatic owner selection;
- distributed consensus across multiple coordinator processes;
- raw input control;
- interactive multi-agent handoff evidence on a caller-owned desktop;
- completed HDUS integration.

## Validation target

The required deterministic sequence is:

```text
A acquire
  -> A action succeeds under generation G
  -> A handoff to B
  -> old A action rejected before provider I/O
  -> B action succeeds under generation G+1
```

The race sequence is:

```text
A acquire
  -> A begins fresh inspect
  -> A -> B -> A while inspect is in flight
  -> generation changes
  -> A native action rejected before action I/O
```

This is the first Phase 15 slice where multi-observer control is protected against both ordinary ownership transfer and ABA control-lease races.

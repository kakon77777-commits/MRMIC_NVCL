# Phase 15.12 — Windows Semantic UIA Actions Behind `controlOwner`

Status: implementation baseline complete pending final squashed-head validation.

Phase 15.12 extends the Phase 15.11 read-only semantic observation lane with a deliberately small UI Automation control surface. It does not add raw keyboard/mouse injection and does not create a second ownership model.

## Reference action surface

Supported semantic actions:

```text
invoke
  -> InvokePattern.Invoke()

toggle
  -> TogglePattern.Toggle()

select
  -> SelectionItemPattern.Select()

set_value
  -> ValuePattern.SetValue()
```

`set_value` is limited to 2048 characters and is denied for UIA elements whose fresh inspection reports `IsPassword=true`.

## MRMIC authorization sequence

`WindowsUiaControlledAccess` is the Phase 15.12 reference entry point.

Before native action I/O it requires:

1. a live portal state for the requested `portalObjectId`;
2. `mounted=true`;
3. `visible=true`;
4. `controlOwner === principalId`;
5. `WindowsAccessAuthority.canControl(...) === true`.

It then performs a fresh `WindowsUiaReadOnlyAccess.inspect()` call. That path independently requires `canInspect(...)` before provider UIA inspection I/O.

Thus semantic control does not bypass the read-only inspection authority introduced in Phase 15.11.

## Freshness and element binding

Every action gets a new bounded `windows_uia_snapshot_v1` immediately before execution.

Reference maximum inspection age:

```text
2000 ms
```

The target runtime id must still appear in the fresh tree and must advertise the pattern required by the requested action.

The gateway binds fresh element facts into the native request:

```text
expected.processId
expected.nativeWindowHandle
expected.automationId? 
expected.controlType?
```

The native helper resolves the runtime id again and rechecks those facts before action execution.

There is no fuzzy retargeting if the element disappears or changes identity.

## Native resource identity

`WindowsUiaActionExecutor` independently validates:

```text
providerEpoch + processId + HWND + providerResourceId
```

before searching for the UIA target element.

The runtime-id search uses the same bounded Control View envelope as the inspector:

- maximum depth: 8;
- maximum visited descendants: 512.

## Action result privacy

Native action success uses `windows_uia_action_result_v1` internally.

For `set_value`, the native result replaces the value with:

```text
[redacted]
```

The public MRMIC-facing result is `windows_uia_controlled_action_v1`. It contains the action kind and runtime id, but has no value field at all.

The caller-supplied `set_value` content is transient action input and is not written to canonical Canvas state, durable observer events or the controlled action result.

## Capability surface

Phase 15.12 global capability distinguishes semantic UIA control from raw input:

```text
automationInspectionImplemented = true
automationImplemented = true
rawInputInjectionImplemented = false

automation.inspectionSupported = true
automation.actionSupported = true
automation.supportedActions = [invoke, toggle, select, set_value]
automation.controlOwnerRequired = true
automation.freshInspectionRequired = true
automation.maxInspectionAgeMs = 2000
automation.actionValueMaxLength = 2048
automation.passwordValueWriteAllowed = false
automation.inputInjectionFallback = disabled
automation.rawInputInjectionImplemented = false
```

`automationImplemented=true` therefore means only the bounded semantic UIA action lane described here.

## No standalone action CLI

Phase 15.12 intentionally does not expose an `npm run windows:uia-action` convenience command.

A standalone native action CLI could become a second control path that lacks the active `CanvasLivePortalCoordinator.controlOwner` state. The reference action path therefore remains inside MRMIC's coordinator-backed runtime.

A later interactive action harness may be added only if it constructs and verifies the actual MRMIC control lease as part of the test.

## Explicit non-goals

Phase 15.12 does not implement:

- raw keyboard input;
- raw pointer input;
- `SendInput`;
- coordinate clicking;
- drag gestures;
- clipboard injection;
- UAC or secure-desktop bypass;
- password value writes;
- arbitrary UIA pattern invocation;
- stale snapshot action replay;
- durable UI action payload/value history;
- implicit control acquisition from observer visibility or rendezvous membership.

## Validation targets

Portable tests cover:

- actual `controlOwner` enforcement before provider I/O;
- `canControl` denial before provider I/O;
- fresh inspection requirement;
- stale inspection rejection;
- pattern mismatch rejection;
- password set-value rejection;
- 2048-character set-value bound;
- no set-value content in the controlled result;
- expected element identity facts passed to the native boundary.

Windows-native CI covers:

- .NET 8 / Windows Desktop UI Automation compilation;
- `InvokePattern`, `TogglePattern`, `SelectionItemPattern`, `ValuePattern` reference implementation compilation;
- capability smoke declaring the bounded semantic action set;
- continued absence of raw input fallback.

## Next boundary

The next useful validation slice is an interactive controlled-action E2E harness that acquires a real MRMIC `controlOwner` lease, performs one safe semantic action on a dedicated test application, and verifies the post-action state through fresh UIA and/or WGC observation.

That should remain separate from any future raw-input work.

# ADR-024 — Windows Semantic UIA Actions Behind `controlOwner`

Status: Accepted for MRMIC/NVCL Phase 15.12.

## Context

Phase 15.11 introduced a bounded read-only Windows UI Automation lane. It can inspect a live UI tree after provider identity and inspection authority checks, but it deliberately cannot mutate the target application.

Phase 15.12 needs a minimal semantic control surface without collapsing structured UI control into unrestricted desktop input. The existing MRMIC portal runtime already has a single-owner interaction authority: `CanvasLivePortalCoordinator.controlOwner`.

The key requirement is therefore not merely "UIA can invoke controls". The requirement is:

> A semantic UI action may execute only while the requesting principal is the current MRMIC `controlOwner`, remains authorized by policy, and the target UIA element has been freshly re-observed and identity-bound immediately before the native operation.

## Decision

The Phase 15.12 reference path is `WindowsUiaControlledAccess`.

The action path is ordered and fail-closed:

```text
mounted + visible portal
  -> controlOwner == principalId
  -> canControl policy
  -> fresh WindowsUiaReadOnlyAccess.inspect()
       -> canInspect policy before provider I/O
       -> bounded windows_uia_snapshot_v1 validation
  -> inspection age <= 2000 ms
  -> runtimeId still present in the fresh bounded tree
  -> element enabled
  -> semantic pattern advertised by that element
  -> password set_value denied
  -> expected element facts bound into native request
  -> native window identity revalidation
  -> bounded runtimeId search
  -> expected element fact revalidation
  -> UIA pattern action
```

A failed gate does not fall back to coordinate clicking, raw keyboard input, fuzzy element matching or a stale cached element.

## Supported semantic actions

The reference action set is intentionally small:

- `invoke` -> `InvokePattern.Invoke()`
- `toggle` -> `TogglePattern.Toggle()`
- `select` -> `SelectionItemPattern.Select()`
- `set_value` -> `ValuePattern.SetValue()`

No other UIA patterns are executable in Phase 15.12.

## Fresh inspection rule

An action never operates directly from an arbitrary older UIA snapshot.

`WindowsUiaControlledAccess` performs a new bounded inspection immediately before each action. The snapshot must be no more than 2000 ms old at the action gateway.

The target `runtimeId` must still exist in that snapshot and advertise the required pattern. Runtime-id disappearance, disabled state or pattern mismatch fails before the native action call.

## Native expected-element binding

The native `uia.action` request does not accept a bare runtime id as sufficient identity.

The MRMIC action gateway binds fresh inspection facts into `action.expected`:

- `processId`
- `nativeWindowHandle`
- `automationId` when available
- `controlType` when available

`WindowsUiaActionExecutor` resolves the runtime id again inside the same bounded Control View search limits used by the inspector, then compares those expected facts against the live element before executing the pattern.

This does not make a UIA runtime id durable identity. It is a short-lived action binding against the immediately preceding semantic observation.

## Window/resource identity remains provider-owned

Before element resolution, the native executor independently revalidates:

```text
providerEpoch + processId + HWND + providerResourceId
```

A stale provider epoch, dead/reused HWND, changed PID or rewritten provider resource id fails closed.

## `set_value` boundary

`set_value` is bounded to 2048 UTF-16/.NET string characters at the native reference layer and the TypeScript gateway applies the same bound.

Phase 15.12 refuses `set_value` when the fresh UIA element reports `IsPassword=true`.

The native success result does not echo the requested value. Its action payload returns `value: "[redacted]"`; the MRMIC `windows_uia_controlled_action_v1` result omits the value field entirely.

The transient request value still necessarily crosses the trusted MRMIC-to-native action boundary in order for `ValuePattern.SetValue()` to operate. It must not be persisted into canonical Canvas state, durable observer events or ordinary action evidence.

## `controlOwner` is mandatory

`canControl` is not a substitute for `controlOwner`.

The reference gateway requires both:

```text
coordinator.state(portalObjectId).controlOwner == principalId
AND
WindowsAccessAuthority.canControl(...) == true
```

The portal must also remain mounted and visible.

Acquiring control continues to use the existing `CanvasLivePortalCoordinator.acquireControl()` authority. Phase 15.12 does not create a second Windows-specific owner field.

## Inspection permission remains separate

The fresh-inspection step runs through `WindowsUiaReadOnlyAccess`, so `canInspect` is checked before native UIA inspection I/O.

Therefore successful control requires both the control policy and the inspection policy to permit the principal. This preserves the Phase 15.11 observation boundary rather than silently bypassing it for controllers.

## Native helper versus MRMIC authority

The Windows helper owns native resource and UIA element validation. It does not own MRMIC principal identity or portal `controlOwner` state.

The supported Phase 15.12 MRMIC reference entry point is `WindowsUiaControlledAccess`. Direct use of the lower-level native JSONL process is a provider/debug boundary and is not equivalent to an authorized MRMIC semantic action.

## No raw input fallback

Phase 15.12 does not implement or call:

- `SendInput`
- `mouse_event`
- `keybd_event`
- synthetic pointer coordinates
- arbitrary keystroke injection
- clipboard-based text injection

Capability discovery therefore separates:

```text
automationImplemented = true
rawInputInjectionImplemented = false
inputInjectionFallback = disabled
```

`automationImplemented=true` means the four bounded UIA semantic actions exist. It does not mean unrestricted Windows automation exists.

## Security boundaries

Phase 15.12 does not:

- cross UAC or secure-desktop boundaries;
- extract passwords or password values;
- write values to elements marked as password fields;
- execute arbitrary UIA patterns;
- fuzzy-match a replacement control when a runtime id disappears;
- persist UIA values into canonical Canvas state;
- make action results durable world truth;
- transfer provider ownership;
- weaken observer visibility, rendezvous or Canvas topology authority.

## Result contract

The MRMIC-facing result is `windows_uia_controlled_action_v1`.

It contains only:

- success flag;
- portal object id;
- provider resource id;
- principal id;
- action kind and runtime id;
- fresh inspection timestamp;
- native completion timestamp.

For `set_value`, the requested value is intentionally absent from this result.

## Consequences

MRMIC now has two structured Windows UI lanes:

```text
UIA inspection -> semantic observation
UIA controlled action -> semantic control under controlOwner
```

They remain separate from the visual WGC lane and from any future raw-input lane.

A future phase may add richer pattern actions or interactive action E2E evidence, but only by preserving the same ownership, freshness and provider-identity boundaries.

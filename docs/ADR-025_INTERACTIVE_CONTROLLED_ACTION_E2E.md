# ADR-025 — Interactive Controlled-Action E2E Uses a Dedicated Safe Windows Target

Status: accepted for Phase 15.13 staging.

## Context

Phase 15.12 implements four semantic Windows UI Automation actions behind the existing MRMIC `controlOwner` authority:

- `invoke`
- `toggle`
- `select`
- `set_value`

The reference code and Windows-hosted build prove that those UIA patterns compile, but hosted CI is not an authoritative interactive desktop and compilation does not prove that the complete runtime path can mutate a live UI and observe the result.

Testing the next step directly against arbitrary user applications would create the wrong boundary: a validation harness should not become a convenience automation interface for unrelated desktop programs.

## Decision

Phase 15.13 adds one caller-executed interactive E2E path that launches a repository-owned WPF application specifically designed as a safe semantic-action target.

The target has a fixed title and root UIA identity:

```text
window title      = MRMIC Phase 15.13 Controlled Action Target
root AutomationId = MrmicControlledActionTargetRoot
```

The local runner builds and launches that application itself and passes only its process id to the TypeScript E2E harness. The public local command does not accept arbitrary application title/HWND selectors.

## Safe target surface

The dedicated WPF target exposes one control for each Phase 15.12 semantic action:

```text
MrmicInvokeButton     -> InvokePattern
MrmicToggleCheckBox   -> TogglePattern
MrmicSelectItemBeta   -> SelectionItemPattern
MrmicValueTextBox     -> ValuePattern
MrmicStatusText       -> read-only semantic postcondition
```

The status text is deliberately synthetic and bounded:

```text
invoke=<n>;toggle=<on|off>;selection=<alpha|beta>;valueLength=<n>
```

It does not echo the `set_value` text.

## Authorized action path

The E2E does not call native `uia.action` directly. It constructs the normal Windows resource portal and uses `WindowsUiaControlledAccess`:

```text
create Windows resource portal
  -> activate live host
  -> create observer private view
  -> acquire CanvasLivePortalCoordinator.controlOwner
  -> WindowsUiaControlledAccess.perform()
       -> controlOwner gate
       -> canControl
       -> fresh canInspect UIA snapshot
       -> freshness/pattern/password checks
       -> native semantic UIA action
```

The E2E authority accepts only the generated portal/resource pair and the fixed E2E principal.

## Dual postcondition

Every semantic action must pass two independent observations after the action:

1. **Fresh UIA semantic postcondition**
   - the dedicated `MrmicStatusText` Name must contain the expected state token;
2. **Fresh WGC visual postcondition**
   - the observer-authorized portal image SHA-256 must differ from the pre-action frame.

This yields:

```text
semantic action
  -> fresh UIA state changed
  AND
  -> fresh visual frame changed
```

A native success response alone is not accepted as end-to-end success.

## Action sequence

The reference E2E performs all four Phase 15.12 actions in a fixed sequence:

1. `invoke` -> `invoke=1`
2. `toggle` -> `toggle=on`
3. `select` -> `selection=beta`
4. `set_value` with the fixed non-secret fixture value `MRMIC-PHASE-15.13` -> `valueLength=17`

The fixture value exists only to exercise `ValuePattern.SetValue()`. Evidence stores only its SHA-256, never the plaintext.

## Evidence contract

Successful caller-executed evidence uses:

```text
interactive_windows_controlled_action_e2e_v1
```

Evidence may contain:

- Windows resource identity;
- target PID/HWND/title;
- fixed root AutomationId;
- MRMIC portal/view/control-owner identity;
- UIA inspection/action timestamps;
- fixed target AutomationIds;
- bounded synthetic status Name;
- pre/post WGC SHA-256 values;
- PNG dimensions/byte count for the baseline frame;
- boolean UIA/WGC postcondition results.

Evidence must not contain:

- PNG/Base64 frame bytes;
- data URIs;
- `set_value` plaintext;
- arbitrary user application content;
- raw input coordinates or keystrokes.

## Hosted CI boundary

Hosted Windows CI:

- builds the native Windows bridge;
- builds the dedicated WPF target;
- runs native capability/window smoke;
- parses the local PowerShell harness.

Hosted CI does **not** launch the target and does not claim an interactive action pass.

Machine-readable capability therefore fixes:

```text
safeTargetOnly = true
hostedCiAuthoritativeInteractiveAction = false
evidencePersistsPixelPayload = false
evidencePersistsSetValuePayload = false
rawInputUsed = false
```

## Security consequences

Phase 15.13 does not add a general-purpose semantic action CLI. The local runner can exercise only the repository-owned safe target.

The phase also does not add:

- `SendInput`;
- keyboard/pointer injection;
- coordinate click/drag;
- clipboard injection;
- UAC/secure-desktop bypass;
- password value writes;
- arbitrary UIA pattern execution;
- durable action-value history.

## Consequences

Phase 15.13 can truthfully claim that the repository contains an executable, authority-preserving interactive semantic-control validation path. It cannot claim that GitHub hosted CI has executed UIA actions in an authoritative user desktop, nor that arbitrary real applications have been validated.

# Phase 15.13 — Interactive Controlled-Action E2E

Status: staging validation in progress.

## Goal

Prove the complete Phase 15 Windows semantic-control chain against a repository-owned interactive Windows application without turning the validation tool into arbitrary desktop automation.

## Dedicated target

Phase 15.13 adds:

```text
native/windows-controlled-action-target/
```

The WPF application has fixed identity:

```text
Title              = MRMIC Phase 15.13 Controlled Action Target
Root AutomationId  = MrmicControlledActionTargetRoot
```

It exposes exactly the four semantic patterns implemented in Phase 15.12 plus one synthetic status surface.

## Local command

From repository root on an interactive Windows desktop:

```powershell
npm run windows:control-e2e --
```

Optional:

```powershell
npm run windows:control-e2e -- -TimeoutMs 30000 -Output ".\artifacts\windows-controlled-action-e2e\evidence.json"
```

The PowerShell runner:

1. builds `MRMIC.WindowsBridge`;
2. builds the dedicated WPF target;
3. builds the TypeScript runtime;
4. launches the dedicated target itself;
5. waits for a real top-level HWND;
6. invokes the controlled-action E2E CLI with that PID;
7. terminates the target on completion/failure.

There is no arbitrary title/HWND parameter.

## Runtime closure

The TypeScript harness selects exactly one discovered resource whose PID matches the launched target process and whose title matches the fixed Phase 15.13 target title.

It then constructs the normal production path:

```text
WindowsProviderCatalog
  -> windows/desktop_window resource
  -> resource_portal
  -> WindowsSnapshotLivePortalHost
  -> CanvasLivePortalCoordinator.activate
  -> ObserverWorkspace private foreground
  -> acquireControl
  -> WindowsUiaControlledAccess
```

The root UIA snapshot must additionally report:

```text
AutomationId = MrmicControlledActionTargetRoot
```

## Fixed action sequence

The reference harness executes:

```text
invoke    -> MrmicInvokeButton
            expected status: invoke=1

toggle    -> MrmicToggleCheckBox
            expected status: toggle=on

select    -> MrmicSelectItemBeta
            expected status: selection=beta

set_value -> MrmicValueTextBox
            fixed fixture value: MRMIC-PHASE-15.13
            expected status: valueLength=17
```

The status string never displays the value itself.

## Dual verification

For each action, success requires both:

```text
fresh UIA inspection satisfies expected status token
AND
fresh observer-authorized WGC frame SHA-256 differs from the pre-action frame
```

This prevents a native `ok=true` response from being treated as sufficient evidence.

## Evidence

Schema:

```text
interactive_windows_controlled_action_e2e_v1
```

Evidence contains identities, timestamps, status facts and frame hashes/dimensions only.

It intentionally excludes:

- screenshot bytes;
- PNG Base64;
- data URIs;
- the plaintext `set_value` fixture;
- raw input coordinates/keystrokes.

For the fixed `set_value` fixture, evidence stores only its SHA-256.

## CI boundary

Portable CI verifies the complete controlled-action harness with a deterministic fake Windows bridge.

Windows hosted CI builds both:

```text
native/windows-bridge-csharp/MRMIC.WindowsBridge.csproj
native/windows-controlled-action-target/MRMIC.WindowsControlledActionTarget.csproj
```

It also runs the existing native smoke and parses the new PowerShell runner.

Hosted CI does not execute the interactive target/action sequence and remains non-authoritative for real interactive action evidence.

## Scope boundary

Phase 15.13 does not add:

- a general action CLI;
- arbitrary application selectors;
- raw keyboard/pointer injection;
- coordinate click/drag;
- clipboard injection;
- UAC/secure-desktop bypass;
- password writes;
- arbitrary UIA patterns;
- durable screenshot/action-value storage.

A successful local artifact proves the reference chain only for the dedicated safe target and the caller's interactive Windows session.

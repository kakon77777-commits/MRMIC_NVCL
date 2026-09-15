# Phase 15.11 — Bounded Read-Only Windows UI Automation Inspection

Status: implementation baseline complete on the Phase 15 feature branch; semantic actions remain intentionally unimplemented.

Phase 15.11 adds a structured Windows observation lane next to the existing observer-gated WGC visual lane. It uses real Windows UI Automation while preserving provider identity, inspection authority, `controlOwner`, Canvas durability, and action boundaries.

## Delivered

### Native Windows inspection

`native/windows-bridge-csharp/WindowsUiaInspector.cs`:

- binds UIA to the existing HWND using `AutomationElement.FromHandle`;
- traverses `TreeWalker.ControlViewWalker`;
- revalidates provider epoch, PID, HWND and exact provider-resource identity before reading the tree;
- returns `windows_uia_snapshot_v1`;
- bounds traversal to depth **8**, descendants **512**, patterns **32** per element;
- reports UIA runtime topology and bounded metadata;
- tolerates live descendants disappearing while walking without weakening root identity checks.

The .NET project enables the Windows Desktop assemblies with `<UseWPF>true</UseWPF>` so the reference helper uses the real `System.Windows.Automation` implementation.

### Metadata surface

The reference snapshot may expose:

- runtime id / parent runtime id / depth;
- `Name`, `AutomationId`, class name;
- control type / localized control type;
- process id / native HWND;
- enabled, offscreen and keyboard-focusable state;
- password flag;
- bounding rectangle;
- supported pattern names.

It deliberately does not read UI value/text payloads through `ValuePattern.Current.Value` or `TextPattern.DocumentRange`. Password values are not read.

### MRMIC trust boundary

`packages/provider-windows/src/uia.ts` adds:

- `parseWindowsUiaSnapshot()`;
- `WindowsUiaReadOnlyAccess`;
- stable UIA bounds/constants and typed element/snapshot contracts.

The parser independently checks provider-resource identity, bounds, runtime-id uniqueness, parent references, root topology and whitelisted metadata.

`WindowsUiaReadOnlyAccess.inspect()` checks `canInspect` before native provider I/O. The reference class has no action method.

### Protocol and capabilities

Native protocol behavior:

```text
uia.inspect -> implemented
uia.action  -> UIA_ACTION_NOT_IMPLEMENTED
```

Global capability advertises:

```text
windows_uia_inspection_v1
automationInspectionImplemented = true
automationImplemented = false
snapshotSchemaVersion = windows_uia_snapshot_v1
maxDepth = 8
maxElements = 512
maxPatternsPerElement = 32
valueTextIncluded = false
inputInjectionFallback = disabled
```

The provider capability likewise reports inspection support while semantic actions remain false.

## Local Windows command

By title substring:

```powershell
npm run windows:uia -- -Title "Notepad"
```

By HWND:

```powershell
npm run windows:uia -- -Hwnd "0x123456"
```

Optional output path:

```powershell
npm run windows:uia -- -Title "Notepad" -Output ".\artifacts\windows-uia-inspection\notepad.json"
```

The runner builds both the .NET helper and TypeScript runtime and writes a bounded `windows_uia_snapshot_v1` JSON document.

## Authority boundary

Phase 15.11 does not change `controlOwner`.

Inspection permission means only that the principal may request the bounded semantic snapshot. It does not imply:

- InvokePattern execution;
- selection changes;
- text entry;
- keyboard or pointer injection;
- focus takeover;
- application ownership;
- secure-desktop/UAC access.

The UIA tree remains ephemeral provider state and is not copied into canonical Canvas or durable observer events.

## Validation

Repository regression covers:

- inspect authority before provider access;
- resource identity mismatch rejection;
- duplicate runtime-id rejection;
- invalid parent topology rejection;
- bounded tree/pattern contracts;
- omission of value-like overreach at the TypeScript trust boundary;
- source guards proving native UIA primitives and explicit action refusal;
- capability/schema separation between inspection and action.

Windows CI compiles the real UIAutomationClient path, runs native bridge smoke and parses both local Windows PowerShell harnesses.

## Explicit non-goals

Phase 15.11 does not provide:

- semantic UIA actions;
- input injection fallback;
- UI value/text extraction;
- password extraction;
- a durable UIA event stream;
- event subscriptions or continuous UIA tree watching;
- an assertion that every Windows application exposes a useful UIA tree;
- UAC/secure-desktop bypass.

## Next slice

A later Phase 15.12 may add a very small set of semantic UIA actions only after revalidating fresh resource/element identity and only behind existing control authority. Supported-pattern metadata alone must never authorize an action.

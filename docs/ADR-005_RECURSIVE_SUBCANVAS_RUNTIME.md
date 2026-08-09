# ADR-005：Recursive Subcanvas Runtime

## Status

Accepted for MVP Phase 5.

## Decision

Recursive work is orchestrated by a dedicated `RecursiveNvclRuntime`. It does not grant a child Agent direct access to `CanvasStore`; both parent and child operations continue to use MCP Tools.

The runtime creates a complete parent snapshot before delegation. A child task executes through the existing `NvclRuntime`. Only a completed and verified child may be folded into the parent portal. Failure or cancellation restores the pre-delegation parent snapshot.

## Folding contract

`canvas.fold_subcanvas` patches only the portal object and writes:

- human-readable summary;
- child canvas reopen handle;
- child run provenance;
- status and issue count;
- child revision and object count;
- preview resource URI;
- fold timestamp.

## Consequences

- Parent-child delegation is replayable and auditable.
- Child failure cannot leave an orphaned portal in the parent.
- Folded state is compact while the complete child world remains reopenable.
- Phase 5 does not yet implement independent child CRDT documents or unlimited depth.

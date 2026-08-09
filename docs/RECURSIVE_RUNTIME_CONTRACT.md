# Recursive NVCL Runtime Contract

## Input

```ts
interface RecursiveNvclRunRequest {
  goal: string
  parentCanvasId: string
  portal: RecursivePortalSpec
  childGoal: string
  childChecks: NvclVerificationCheck[]
  childAgent: NvclAgent
}
```

## Required sequence

```text
create_snapshot(parent)
open_subcanvas(parent, portal)
run NvclRuntime(child)
if child completed:
  get_state(child)
  fold_subcanvas(portal, summary, provenance)
  get_lineage(child)
else:
  restore_snapshot(parent)
```

## Invariants

1. Child actions must use `canvas.*` MCP Tools.
2. The portal must retain `childCanvasId` after folding.
3. Folding is forbidden before the child run reports `completed`.
4. Root-to-child lineage must begin at the requested parent and end at the child.
5. Failure or cancellation restores the complete parent snapshot.
6. The folded summary must not replace or delete the child world.

## Phase 5 result

```ts
interface RecursiveNvclRunResult {
  status: 'completed' | 'failed' | 'cancelled'
  parentCanvasId: string
  portalObjectId?: string
  childCanvasId?: string
  childResult?: NvclRunResult
  fold?: FoldedSubcanvasSummary
  lineage: string[]
  restoredParentSnapshot: boolean
}
```

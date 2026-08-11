# Multimodal Canvas Lab Contract

Version: 0.12.0

## 1. Observation modes

| Mode | Actor receives | Verifier may use |
|---|---|---|
| `pixel` | Immutable frame metadata plus SVG and PNG URIs | Nothing beyond requested public evidence |
| `structured` | Frame plus complete `CanvasObject[]` | Complete state |
| `hybrid` | Immutable frame without object IDs | Complete state after action |

`pixel` and `hybrid` observations must not contain an `objects` field.

## 2. Frame lease

Every observation creates an immutable frame:

```json
{
  "frameId": "uuid",
  "canvasId": "canvas-root",
  "canvasRevision": 2,
  "stateHash": "sha256",
  "renderSha256": "sha256",
  "renderUri": "/api/lab/frame/{frameId}.svg",
  "rasterUri": "/api/lab/frame/{frameId}.png",
  "observedAt": "ISO-8601",
  "expiresAt": "ISO-8601",
  "mode": "pixel",
  "viewport": {},
  "objectCount": 5
}
```

An action fails closed when:

- the frame cannot be found;
- the lease is expired;
- the frame belongs to a different canvas;
- the current revision differs from the observed revision;
- the current state hash differs from the observed state hash.
- the current viewport tuple (`x`, `y`, `width`, `height`, `zoom`) differs from the observed viewport.

## 3. Action invariant

```text
LabMutation ⇒ action_id ≠ ∅
LabMutation ⇒ fresh(frame_id)
LabMutation ⇒ expected_revision = current_revision
```

Supported action types:

```text
create
move
resize
delete
restyle
set_text
viewport
```

The Runtime rejects reuse of an `actionId` with different input. Exact replay returns the recorded result without applying the action again.

## 4. Transition evidence

Each successful action records:

```json
{
  "actionId": "...",
  "actionType": "move",
  "inputFrameId": "...",
  "beforeFrameId": "...",
  "afterFrameId": "...",
  "beforeRevision": 1,
  "afterRevision": 2,
  "beforeStateHash": "...",
  "afterStateHash": "...",
  "beforeRenderSha256": "...",
  "afterRenderSha256": "...",
  "freshnessMs": 39,
  "freshnessVerified": true,
  "transitionGuard": "passed",
  "verifiedChange": true,
  "affectedObjectIds": ["benchmark-red-circle"]
}
```

For object mutations, state or render hash change proves the transition. For viewport actions, the state hash may remain equal while the immutable render hash changes.

## 5. Reversibility

Object mutations and benchmark reset store complete before/after states in bounded in-process history. Undo and Redo use the existing synchronized state-replacement path so peers observe the transition.

Viewport-only actions are recorded but are not added to object-state Undo history.

## 6. Deterministic benchmark

Benchmark ID: `drag-red-circle`

Goal:

```text
Move benchmark-red-circle completely inside benchmark-blue-zone.
```

The verifier checks containment using authoritative geometry and reports center distance for failed attempts. It does not tell a pixel-mode actor where either object is located.

## 7. MCP mapping

| MCP tool | Purpose |
|---|---|
| `lab.observe` | Create a frame lease |
| `lab.observe_adaptive` | Create a frame and apply a session-local keyframe/ROI/skip policy |
| `lab.rasterize` | Create an immutable full or cropped PNG |
| `lab.act` | Execute guarded Action IR |
| `lab.undo` | Restore previous state |
| `lab.redo` | Reapply undone state |
| `lab.reset_benchmark` | Load deterministic task |
| `lab.verify_benchmark` | Run structured oracle |
| `lab.get_trajectory` | Read evidence trajectory |

Exact observed SVG content is available as `lab://frame/{frameId}`. PNG content is available as `lab://frame/{frameId}.png` and `lab://raster/{rasterId}`.

## 8. Epistemic boundary

Feedback is not automatically learning. Phase 9 records trajectories, corrections, rejected stale decisions, observation dispositions and Provider telemetry. A later experiment may compare policies trained or adapted from those trajectories, but v0.10 does not claim policy improvement.

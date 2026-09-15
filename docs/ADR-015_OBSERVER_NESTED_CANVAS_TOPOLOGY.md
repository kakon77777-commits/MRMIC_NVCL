# ADR-015 — Observer Nested Canvas Uses Canonical Canvas Topology

Status: Accepted  
Phase: 15.3

## Context

Phase 15.0–15.2 established private observer views, shared rendezvous, durable recovery and authenticated re-entry. The next requirement is layered/nested observer work: a human or AI may work at a root Canvas, enter one or more existing subcanvases, keep a separate foreground stack at each depth, and later return to the parent.

MRMIC already has canonical recursive topology:

- `CanvasDocument.parentCanvasId`
- `CanvasDocument.parentObjectId`
- parent `subcanvas` objects with `content.childCanvasId`

Creating another observer-owned parent/child tree would introduce split authority and make cross-conversation recovery ambiguous.

## Decision

Observer nested navigation is a projection over canonical Canvas topology, never a topology authority.

An observer may enter a child only when a configured `ObserverCanvasTopologyResolver` confirms the exact triple:

```text
parentCanvasId + childCanvasId + portalObjectId
```

The reference `CanvasAuthorityTopologyResolver` requires agreement in both directions:

1. child Canvas points to the supplied parent Canvas and parent object;
2. parent object is a `subcanvas` on that parent Canvas and points to the same child Canvas.

No resolver means no nested entry. This is intentionally fail-closed.

## Observer State

A private `observer_view_v1` may optionally carry ordered `observer_nested_canvas_v1` contexts. The root Canvas remains `view.canvasId`; nested entries form a stack from the root to the active child.

Each nested context owns only observer-relative projection state:

- the authoritative parent/child/portal reference;
- visibility policy;
- an independent foreground portal stack;
- the time the observer entered that context.

It does not own the child Canvas document, provider resource, or portal resource.

The nested context field is optional so Phase 15.0–15.2 durable events remain replay-compatible until nesting is actually used.

## Visibility Inheritance

Phase 15.3 deliberately implements only two nested visibility modes:

- `inherit`
- `hidden`

Resolved visibility is monotonic downward:

```text
effective(child) = effective(parent) AND child.visibility != hidden
```

A descendant therefore cannot broaden visibility beyond a hidden ancestor. There is no `force_visible` override in this phase.

The root context is always present in the observer context path. Maximum nested depth is 64.

## Durability and Replay

Entering/leaving a subcanvas, changing nested visibility, and changing a nested foreground stack are durable observer-view events.

Histories containing nested navigation require the same topology authority during deterministic recovery. If topology is unavailable or no longer validates the recorded lineage, recovery fails closed instead of inventing a relationship.

This does not make provider liveness durable. As before, process existence, focus, runtime presence and `controlOwner` remain separate runtime facts.

## Protocol Exposure

The authenticated observer protocol may:

- execute explicit nested navigation commands;
- return principal-owned resolved Canvas context paths;
- expose effective visibility and per-depth foreground stacks.

It does not expose raw private observer event history and does not permit callers to submit identity.

## Consequences

Positive:

- one canonical world topology remains authoritative;
- cross-conversation nested navigation is replayable without duplicating Canvas ownership;
- child workspaces can maintain independent foreground stacks;
- visibility cannot be widened accidentally beneath a hidden ancestor;
- the same contract can later host Windows/provider resources and HDUS projections.

Trade-offs:

- the standalone observer reference server cannot enter nested Canvas contexts unless a topology resolver is injected;
- a topology-breaking Canvas migration must be reconciled before nested observer history can replay;
- Phase 15.3 does not define arbitrary graph jumps, sibling teleportation, or visibility escalation.

# ADR-013 — Durable Observer Workspace Event Stream

Status: accepted for Phase 15.1.

## Context

Phase 15.0 introduced private observer views, independent foreground stacks, shared rendezvous rooms and selective portal projection. The first slice intentionally kept those registries process-local. That is insufficient for cross-conversation or cross-process continuity: a new process would know the canonical Canvas and provider resources but would forget who owned a private view, which portals were foreground, who had joined a rendezvous, and which projections had been deliberately shared.

Runtime presence remains a different class of truth. Focus, process liveness, runtime epoch, temporary coordinates and interactive readiness describe the current provider process and must not be resurrected from durable history.

## Decision

Phase 15.1 adds an append-only `observer_workspace_events` stream through `SqliteObserverWorkspaceEventStore`. It uses the same SQLite durable database authority as the existing Canvas event ledger can use, but remains a sibling observer stream rather than coercing observer transitions into `CanvasEvent` semantics.

Each `observer_workspace_event_v1` records:

- event and aggregate identity;
- world and Canvas coordinates;
- a sanitized reference to the authenticated principal responsible for the transition;
- aggregate revision;
- the deterministic replay command;
- the complete resulting `observer_view_v1` or `shared_rendezvous_v1` state;
- a SHA-256 hash binding the persisted principal, command and resulting state payload.

`DurableObserverWorkspaceRegistry` delegates authorization and transition semantics to the existing `ObserverWorkspaceRegistry`, then appends the resulting transition. If the durable append fails, it rebuilds memory from durable history before surfacing the error, so transient in-memory mutation does not become authoritative. Recovery replays the ordered stream and fails closed on payload-hash mismatch, duplicate event IDs, non-contiguous revisions, command/event-type mismatches, entity-kind mismatches, or replay divergence.

## Authority boundary

Durable in Phase 15.1:

- observer view identity and owner binding;
- world/Canvas binding;
- foreground portal stack;
- view lifecycle intent (`live`, `warm`, `frozen`, `sleeping`);
- rendezvous host, invitations and membership;
- selective shared projections and room closure.

Still ephemeral:

- provider process liveness;
- focus and actual mounted/visible surface state;
- runtime epoch, sequence and revision counters owned by runtime presence;
- current `controlOwner` lease and provider-side authorization facts.

A recovered `live` observer view is therefore a durable workspace intention, not proof that all provider processes are currently alive. Provider/runtime truth must be re-established through runtime presence and resource portals.

## Privacy and read boundary

The observer event stream contains private coordination state. Raw event enumeration is an internal persistence API and must not be exposed as an unauthenticated public read surface. User-facing state remains principal-filtered through `snapshotFor()` or later authenticated protocol surfaces.

No bearer token or credential is written into observer events. Persisted identity is a sanitized principal reference sufficient for deterministic authorization replay and audit.

## Consequences

Cross-conversation clients can reconstruct the same private/shared spatial state by opening the same durable database with the same authenticated principal. They do not need to serialize whole Windows desktops or duplicate provider resources.

Windows capture/UI Automation, MCP/HTTP observer endpoints, lifecycle scheduling and HDUS bridging remain separate later slices.

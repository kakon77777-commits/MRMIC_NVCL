# ADR-007: Interactive Multimodal Canvas Laboratory

Status: Accepted
Version: 0.8.0

## Context

Phase 0–6 proved a persistent, recursive and MCP-addressable canvas world, but the browser was primarily a projection. It did not provide a controlled environment for repeatedly testing real visual interaction.

Using a game as the first multimodal test environment mixes too many variables: legacy window behavior, operating-system privilege boundaries, uncontrolled world state, irreversible actions and shared-desktop interference.

## Decision

Phase 7 makes the existing SVG canvas the first multimodal interaction laboratory.

The authoritative `CanvasStore` and provider-neutral `CanvasAdapter` remain unchanged. The new `MultimodalCanvasLab` sits above them and supplies:

- immutable freshness-bound frame leases;
- pixel, structured and hybrid observation modes;
- guarded Action IR with mandatory action provenance;
- before/after state and render hashes;
- synchronized Undo and Redo;
- a deterministic visual benchmark and oracle verifier;
- MCP tools and frame Resources for local AI clients.

The actor never receives structured objects in pixel mode. Hybrid mode also withholds objects from the observation response; the verifier may still inspect authoritative state after the action.

## Why the existing SVG adapter remains first

The goal is to test MRMIC／NVCL semantics, not to bind the architecture to a third-party editor SDK. The current SVG renderer already provides stable IDs, deterministic geometry, pan, zoom and an inspectable visual projection.

Excalidraw, tldraw, Fabric or Konva may later be implemented as additional `CanvasAdapter` targets. They are not required for the Phase 7 laboratory.

## Consequences

Positive:

- the same task can be run through structured, visual-only and hybrid lanes;
- vision, planning, motor execution and transition verification can be isolated;
- every experiment is deterministic, resettable and reversible;
- games become later transfer benchmarks rather than foundational infrastructure.

Costs and limits:

- browser rendering still consumes structured state internally;
- SVG is not yet rasterized to a server-side PNG observation;
- the oracle proves task state, not visual-model competence;
- trajectory feedback is recorded but no policy is updated automatically.

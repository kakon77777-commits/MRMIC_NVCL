# ADR-012: Transient-Preserving Hybrid and Opt-In Provider A/B

Status: Accepted for Phase 12
Version: `0.13.0`

## Context

Phase 11 showed two distinct gaps: Passive Timeline coalescing could erase A→B→A pulses, and synthetic PNG-byte measurements could not establish real Provider Token or latency savings.

## Decision

1. Add an opt-in three-signature reversal boundary to the existing Passive scheduler instead of changing default coalescing.
2. Treat the hybrid as an observation policy only; it has no action-authority path.
3. Add a separate real Provider A/B runner for `always_full` and `governor_roi` using isolated worlds and an independent full-PNG audit trace.
4. Keep expected semantic labels in the trusted evaluator and prohibit object IDs recursively at the Provider boundary.
5. Require exact dual opt-in, an eight-call cap and a measured Token continuation threshold.
6. Keep real inference out of automated tests and MCP.
7. Persist per-sample progress atomically so budget aborts retain bounded evidence.

## Consequences

- Hybrid preserves the tested transient at Passive's eight-delivery count, but exact retention remains 6/21.
- Governor remains preferred when exact intermediate-state retention matters.
- The real run establishes a 5→3 call, 44.3885% total-Token and 53.0503% latency reduction on the bounded fixture with 8/8 correct delivered classifications.
- Local signature computation cost increases and is not represented by Provider-delivery bytes.
- The Token threshold cannot be a strict final cap without a trustworthy pre-call cost bound; the interface and reports must call it a continuation threshold.
- The App Server adapter remains experimental and capability-probed.

# Next Phase

Phase 11 v0.12 establishes a pixel-identical four-policy A/B harness and shows the central tradeoff directly: Passive Timeline minimizes delivery count but loses transient and exact intermediate states, while Governor ROI preserves the tested transitions at higher delivery cost.

Recommended Phase 12 order:

1. Add an opt-in real Provider A/B for `always_full` versus `governor_roi`, measuring input/output Token, latency, cache behavior, semantic answer quality and verified outcome.
2. Prototype a transient-preserving hybrid: immediately emit high-salience or direction-reversing changes while still coalescing ordinary bursts.
3. Compare denser signatures, multiscale pyramids and motion-aware sampling on the existing tiny-motion fixture before changing defaults.
4. Add a separate semantic event classifier that consumes immutable observation events but cannot authorize actions.
5. Calibrate Provider confidence, semantic salience and SCL/action authorization as separate signals.
6. Add timestamped synthetic audio and opt-in narration scheduling only after visual event retention is explicit; preserve copyright-safe evidence defaults.
7. Persist bounded timeline metadata with retention/deletion controls and no raw copyrighted frames by default.
8. Implement a separate MCP `2026-07-28` stateless adapter and conformance suite while retaining the legacy endpoint.
9. Reuse the contract in MSSP game/desktop experiments only after controlled Provider A/B and transient-preserving policy tests pass.

Productization remains separate: authentication, rate limits, multi-tenant isolation, deterministic fonts, data retention policy, official SDK integration and independent security review.

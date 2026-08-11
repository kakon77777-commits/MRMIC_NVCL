# Next Phase

Phase 10 v0.11 establishes persistent pixel sampling, scene epochs, bounded burst coalescing, periodic resynchronization, generated held-out multi-action timelines and a session-local MCP control surface. Phase 11 should test semantic usefulness and real Provider cost without expanding to uncontrolled desktops or games yet.

Recommended order:

1. Build identical multi-step tasks for always-full, static crop, Governor ROI and Passive Timeline policies.
2. Run an opt-in real Provider A/B with measured input/output Token, latency, cache behavior and verified task outcome.
3. Add tiny-motion and transient-event fixtures, then compare denser signatures, image pyramids and motion-aware sampling.
4. Introduce a separate semantic event classifier that consumes Passive Scene Events but cannot authorize actions.
5. Add timestamped synthetic audio observations and optional narration scheduling; retain opt-in audio and copyright-safe evidence boundaries.
6. Persist bounded timeline metadata with explicit retention and deletion controls; do not persist raw copyrighted frames by default.
7. Calibrate Provider confidence separately from SCL/action authorization.
8. Implement a separate MCP `2026-07-28` stateless adapter and conformance suite while retaining the legacy endpoint.
9. Only after the controlled canvas A/B is stable, reuse the same event contract in MSSP game/desktop experiments.

Productization remains separate: authentication, rate limits, multi-tenant isolation, deterministic fonts, data retention policy, official SDK integration and independent security review.

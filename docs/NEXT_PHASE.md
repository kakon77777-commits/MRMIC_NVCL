# Next Phase

Phase 8 v0.9 establishes the first real pixel-native model loop. Phase 9 should optimize sustained multimodality rather than immediately transferring to an uncontrolled game.

Recommended order:

1. Add an observation governor: keyframes, perceptual-difference thresholds, region-of-interest crops and periodic full-frame resynchronization.
2. Build generated tasks for selection, drag, resize, drawing, text, occlusion, pan and zoom with fixed seeds and held-out seeds.
3. Compare full frame, crop, image pyramid and event-triggered observation policies under identical Token and latency budgets.
4. Add stale-frame recovery that records the rejected attempt, re-observes, and never replays a coordinate against a newer frame.
5. Separate Provider planning confidence from action authorization; calibrate confidence against verified outcomes.
6. Add audio as a timestamped observation lane without forcing the user to speak.
7. Implement a separate MCP `2026-07-28` stateless adapter and conformance suite while retaining a legacy `2025-11-25` compatibility endpoint.
8. Only after controlled benchmark stability, reuse the Gesture IR in MSSP for desktop and game experiments.

Productization remains separate: authentication, rate limits, multi-tenant isolation, bundled deterministic fonts, retention policy, official SDK integration, and independent security review.

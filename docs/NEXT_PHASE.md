# Next Phase

Phase 9 v0.10 establishes adaptive keyframes, perceptual skip, ROI delivery, periodic resynchronization, stale regeneration and measured Token-budget stopping. Phase 10 should test whether these mechanics remain useful in longer semantic tasks.

Recommended order:

1. Build generated tasks for selection, drag, resize, drawing, text, occlusion, pan and zoom with fixed and held-out seeds.
2. Compare always-full, static crop, Governor ROI, image pyramid and event-triggered policies under identical real Provider Token/latency budgets.
3. Add a passive scheduler that samples over wall-clock time, coalesces bursts and records scene epochs without requiring user prompts.
4. Separate Provider planning confidence from action authorization; calibrate confidence against verified outcomes.
5. Add timestamped audio observations and optional AI narration without requiring the user to speak.
6. Evaluate signatures that preserve tiny motion and transient events while keeping periodic full resynchronization.
7. Implement a separate MCP `2026-07-28` stateless adapter and conformance suite while retaining the legacy `2025-11-25` endpoint.
8. Only after controlled benchmark stability, reuse the Gesture IR and observation policy in MSSP game/desktop experiments.

Productization remains separate: authentication, rate limits, multi-tenant isolation, bundled deterministic fonts, retention policy, official SDK integration, and independent security review.

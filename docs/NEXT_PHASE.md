# Next Phase

Phase 13 v0.14 establishes the secure PMW integration seam: capability negotiation, native portals, authenticated mutation ingress, provider-neutral client contracts, ephemeral runtime truth and revocable live-host control.

Recommended Phase 14 order:

1. Build a Python PMW adapter solely from the public Phase 13 JSON schemas and run cross-repository reconnect/session tests.
2. Implement one concrete HTML/Electron portal host while keeping WebView state outside SVG and durable Canvas state.
3. Add provider portal discovery/listing and explicit provider-resource lifecycle signals without transferring ownership to Canvas.
4. Add OAuth, rate limits, retention controls and multi-tenant isolation before any untrusted network deployment.
5. Implement a separate MCP `2026-07-28` stateless adapter and conformance suite while retaining the advertised legacy profile.
6. Extend multimodal experiments only through separate opt-in runs; keep paid Provider calls outside normal CI and release acceptance.
7. Resume game/desktop experiments only with isolated, reversible and explicitly authorized machine-test handoffs.

The Phase 12 observation roadmap remains useful—multiscale salience, cost estimation, semantic events, audio timing and local CPU/memory telemetry—but it no longer blocks PMW integration work.

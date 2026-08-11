# Notice

MRMIC／NVCL MVP Phase 8 v0.9

This release contains an executable local reference implementation of a guarded pixel-native multimodal canvas agent loop and the earlier MCP-native recursive NVCL stack.

Phase 8 adds PNG rasterization, cropped observations, coordinate-only Gesture IR, runtime hit-testing, a provider-neutral episode runner, a bounded Codex Account Provider, and real Token/latency/freshness/transition evidence.

The implementation intentionally keeps the structured canvas oracle behind the action boundary. Pixel Providers receive PNG bytes and frame metadata, not canvas object identities.

Known limitations and protocol boundaries are documented in `docs/PHASE8_COMPLETION_REPORT.md`, `docs/MCP_COMPATIBILITY.md`, and `docs/MVP_ACCEPTANCE_MATRIX.md`.

Third-party software notices are listed in `THIRD_PARTY_NOTICES.md`.

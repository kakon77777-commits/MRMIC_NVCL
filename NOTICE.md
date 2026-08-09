# Notice

MRMIC／NVCL MVP Phase 6 v0.7

This release contains an executable reference implementation of an MCP-native recursive multimodal canvas and Native Visual Construction Loop.

Phase 6 adds:

- SQLite-backed whole-workspace checkpoints and trajectory persistence;
- restart hydration for root and child canvases;
- synchronized state-replacement snapshot restore;
- independent state-vector rooms and WebSocket handles for each canvas;
- Phase 0–6 acceptance evidence and repeatable hardening demo.

The implementation intentionally uses a replaceable SVG canvas adapter and a custom reference synchronization engine. It does not bundle tldraw, Yjs, or the official MCP TypeScript SDK.

Known limitations are documented in `docs/PHASE6_COMPLETION_REPORT.md` and `docs/MVP_ACCEPTANCE_MATRIX.md`.

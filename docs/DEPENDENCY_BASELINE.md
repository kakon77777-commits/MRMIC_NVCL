# Dependency Baseline

## Runtime baseline

- Node.js `>=22.5`
- TypeScript `^5.8.3`
- Node built-in `node:sqlite`
- Browser native `WebSocket`, `EventSource`, SVG, Fetch API

## Phase 2 dependency policy

The executable Phase 2 path has zero third-party runtime dependencies. This makes the synchronization semantics reproducible inside the delivery environment.

## Planned adapters

- Yjs `13.6.x` stable line for production CRDT integration
- y-websocket or a provider with equivalent auth and persistence hooks
- MCP TypeScript SDK v1.x for Phase 3
- tldraw only as an optional canvas adapter subject to its production licensing terms

Version numbers must be reverified at installation time.

## Phase 3 dependency policy

The executable Phase 3 path still has zero third-party runtime dependencies. The MCP endpoint is a documented `2025-11-25` compatible subset reference implementation, not the official SDK.

Official production migration target:

- `@modelcontextprotocol/sdk` v1.x while it remains the recommended production line;
- or the split v2 server packages after stable release and conformance verification.

The replacement boundary is the MCP protocol adapter; Canvas Tools, Resource URIs, CanvasTransaction, synchronization, and event schemas remain unchanged.

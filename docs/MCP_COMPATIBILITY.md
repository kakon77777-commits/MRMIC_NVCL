# MCP Compatibility

Server version: `0.9.0`

## Protocol boundary

The current server implements a handwritten, stateful reference subset based on protocol revision `2025-11-25`. The finalized MCP `2026-07-28` specification uses a stateless core and is not implemented by this endpoint. Version `0.9.0` therefore does not claim latest-spec or formal conformance.

| Capability | Status | Notes |
|---|---|---|
| `initialize` | Implemented | Negotiates the legacy `2025-11-25` baseline |
| Stateful session ID | Implemented | One runtime session per client |
| `ping` | Implemented | Empty result |
| `tools/list` | Implemented | 23 Canvas and Lab tools |
| `tools/call` | Implemented | Typed transaction, raster and lab-action bridge |
| `resources/list` | Implemented | Stable canvas resources |
| `resources/templates/list` | Implemented | Canvas, viewport, render, object, snapshot, SVG frame, PNG frame and raster templates |
| `resources/read` | Implemented | JSON/SVG text and PNG base64 blobs |
| `resources/subscribe` | Implemented | Exact URI subscription |
| Streamable HTTP POST | Implemented subset | One JSON-RPC request per POST |
| GET SSE | Implemented subset | Server notifications |
| DELETE session | Implemented | Closes streams and session |
| JSON-RPC batch | Not implemented | Legacy endpoint limitation |
| resumability | Not implemented | No Last-Event-ID replay |
| OAuth | Not implemented | Local role header only |
| official SDK | Not integrated | Reference implementation remains handwritten |
| formal conformance suite | Not run | No conformance claim |
| MCP `2026-07-28` stateless core | Not implemented | Planned as a separate compatibility adapter |

## Application extensions

Phase 8 exposes eight `lab.*` tools:

```text
lab.observe
lab.rasterize
lab.act
lab.undo
lab.redo
lab.reset_benchmark
lab.verify_benchmark
lab.get_trajectory
```

Raster Resources:

```text
lab://frame/{frameId}
lab://frame/{frameId}.png
lab://raster/{rasterId}
```

These are MRMIC application semantics carried over MCP; they do not modify the MCP protocol.

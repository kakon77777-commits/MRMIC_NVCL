# MCP Compatibility

Server version: `0.13.0`

## Protocol boundary

The current server implements a handwritten, stateful reference subset based on protocol revision `2025-11-25`. The finalized MCP `2026-07-28` specification uses a stateless core and is not implemented by this endpoint. Version `0.13.0` therefore does not claim latest-spec or formal conformance.

| Capability | Status | Notes |
|---|---|---|
| `initialize` | Implemented | Negotiates the legacy `2025-11-25` baseline |
| Stateful session ID | Implemented | One runtime session per client |
| `ping` | Implemented | Empty result |
| `tools/list` | Implemented | 26 Canvas and Lab tools |
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

Phase 12 exposes eleven `lab.*` tools:

```text
lab.observe
lab.observe_adaptive
lab.observe_passive
lab.rank_observation_policies
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

`lab.observe_adaptive` keeps perceptual history inside one MCP session and one `governorId`. It is read-only with respect to canvas state, but it may create immutable frame/raster cache entries. Governor state is not shared across sessions and is discarded when the session closes.

`lab.observe_passive` keeps a Passive Scene Timeline inside one MCP session and one `timelineId`. It supports sample, flush and reset. Phase 12 callers may opt into `boundaryMode: transient_preserving` plus bounded reversal thresholds. Returned events contain pixel/raster metadata, optional `return_to_recent_visual_state` boundary evidence and resource links but no object identifiers. Scheduler state is in-memory, session-local and discarded when the session closes.

`lab.rank_observation_policies` is a pure application-level evaluator. It ranks one to five caller-supplied metric summaries with fixed documented weights. It does not inspect Lab state, create observations, call a Provider, mutate the canvas or grant action authority.

The real Provider A/B runner is deliberately not an MCP tool. Account-backed inference remains behind an explicit local CLI acknowledgement, confirmation flag, call cap and Token continuation threshold.

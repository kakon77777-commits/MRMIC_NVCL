# MCP Compatibility

Protocol baseline: `2025-11-25` compatible reference subset
Server version: `0.8.0`

| Capability | Status | Notes |
|---|---|---|
| `initialize` | Implemented | Negotiates `2025-11-25` |
| Session ID | Implemented | One runtime session per client |
| initialized notification | Implemented | POST notification returns 202 |
| `ping` | Implemented | Empty result |
| `tools/list` | Implemented | 22 Canvas and Lab tools |
| `tools/call` | Implemented | Typed transaction and lab-action bridge |
| resource-link content | Implemented | Tool output includes Resource URIs |
| `resources/list` | Implemented | Five stable canvas resources |
| `resources/templates/list` | Implemented | Canvas, viewport, render, object, snapshot and lab frame templates |
| `resources/read` | Implemented | JSON and SVG text resources |
| `resources/subscribe` | Implemented | Exact URI subscription |
| resource updated notification | Implemented | SSE `notifications/resources/updated` |
| Streamable HTTP POST | Implemented subset | One JSON-RPC request per POST |
| GET SSE | Implemented subset | Server notifications |
| DELETE session | Implemented | Closes streams and session |
| JSON-RPC batch | Not implemented | Future official SDK adapter |
| resumability | Not implemented | No Last-Event-ID replay |
| OAuth | Not implemented | Local header role only |
| Prompts / Sampling / Elicitation | Not implemented | Outside current experiment |
| Tasks | Application-defined | NVCL run remains an application trajectory |
| stdio | Not implemented | HTTP is the reference transport |
| official SDK | Not integrated | Reference subset remains handwritten |
| conformance suite | Not run | Do not claim formal conformance |

## Application extensions

Phase 4 added trajectory Resources. Phase 5 added recursive fold and lineage tools. Phase 6 made snapshots, trajectories and state replacement restart-safe.

Phase 7 adds seven application-domain tools:

```text
lab.observe
lab.act
lab.undo
lab.redo
lab.reset_benchmark
lab.verify_benchmark
lab.get_trajectory
```

It also adds the Resource template:

```text
lab://frame/{frameId}
```

These are MRMIC application semantics carried over MCP. They do not change the MCP protocol itself.

`lab.reset_benchmark` is marked destructive/high-risk because it replaces the current experiment state, even though the laboratory records a reversible history entry.

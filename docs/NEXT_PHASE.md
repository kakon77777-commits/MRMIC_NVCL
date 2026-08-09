# Next Phase

Phase 7 v0.8 completes the controlled interactive multimodal laboratory.

Recommended experimental order:

1. Add a real multimodal provider that receives only `lab.observe(mode=pixel)` frames.
2. Build a generated benchmark suite covering selection, drag, resize, drawing, text, occlusion, pan and zoom.
3. Compare structured, pixel and hybrid lanes with identical tasks and budgets.
4. Add server-side PNG rasterization and cropped high-detail observations.
5. Measure Token use, observation latency, action latency, stale-frame rate and correction count.
6. Compare open-loop generation, flat NVCL and recursive NVCL.
7. Only after controlled performance is stable, transfer the same Action IR to MSSP and games.

Productization remains a separate track:

- official MCP TypeScript SDK and conformance tests;
- true Yjs provider and subdocuments;
- authenticated multi-user deployment;
- retention, compaction and event-replay recovery;
- production security and rate limits.

Feedback trajectories must not be described as learning until a policy update and independent post-update evaluation are implemented.

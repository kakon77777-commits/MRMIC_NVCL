# Phase 12 Status Report

Date: 2026-08-12
Version: `0.13.0`
Status: `COMPLETED_AND_MERGED`

## Delivered

- opt-in `hybrid_transient` A→B→A boundary with configurable thresholds;
- five-policy identical-source benchmark and ranking integration;
- session-local MCP `lab.observe_passive` hybrid controls;
- schema-bound read-only `observeVisual` Codex Account Provider path;
- isolated real `always_full` versus `governor_roi` A/B runner;
- exact dual opt-in and measured continuation-budget gate;
- per-sample atomic RUNNING/ABORTED/COMPLETED evidence;
- Phase 12 web/runtime identity and v0.13 workspace versions;
- GitHub Actions checkout/setup-node v5 migration.

## Validation

```text
TypeScript check: passed
Automated tests: 75 / 75 passed
Phase 12 synthetic runs: 10 / 10 completed
Freshness per policy: 22 / 22
Transition Guard per policy: 22 / 22
Hybrid tested transient: retained
Real Provider calls: 8 / 8 completed
Real semantic classifications: 8 / 8 correct
Real Freshness: 4 / 4
Real Transition Guard: 4 / 4
Source trace identity: passed
Action plan identity: passed
Browser drag / undo / redo: passed
Browser warnings / errors: 0 / 0
```

## Hybrid result

`hybrid_transient` emitted 8 deliveries and 301,745 bytes, avoided 20 deliveries, retained the tested A→B→A pulse and used 79.7390% fewer delivered bytes than always-full. It retained 6/21 exact post-states, equal in count to Passive Timeline.

## Real Provider result

Governor reduced the fixture from 5 to 3 Provider calls, 104,313 to 58,010 total Tokens, and 62.978 to 29.568 seconds while maintaining 100% delivered-frame semantic accuracy. Total usage across both arms was 162,323 Tokens.

The first 50,000-threshold attempt safely stopped but revealed missing partial evidence. That defect was corrected before the completed run. The completed run also confirms `max-total-tokens` is a pre-call continuation threshold, not a strict post-call total cap.

## Release disposition

- Source commit: `4ffcd92670befc0f79dc950f5ff699150350122d`
- Pull request: `#5`
- CI: two GitHub Actions `test` runs passed
- Merge commit: `e6ec7fbd82ce553a46a3a57e0074eca0d10ecd3e`
- Remote branch: `main`

## Evidence

- `artifacts/phase12-hybrid-benchmark.json`
- `artifacts/phase12-real-provider-ab-readiness.json`
- `artifacts/phase12-real-provider-ab-attempt1.json`
- `artifacts/phase12-real-provider-ab.json`
- `artifacts/phase12-browser-acceptance.json`

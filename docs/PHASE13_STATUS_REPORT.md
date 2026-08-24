# Phase 13 Status Report

Date: 2026-08-24

Version: `0.14.0`

Status: current-main convergence release candidate

## Outcome

The historical Phase 13 stack was not directly merged. Its effective code and tests were audited and ported path-by-path onto `main@da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9`, preserving the current canonical theory, index, manifest policy and Unicode-safe workspace audit.

The candidate now exposes machine-readable capability negotiation, native resource portals, secure principal binding across HTTP/WebSocket/MCP mutations, provider-neutral PMW JSON contracts, ephemeral runtime presence and explicit live portal focus/control ownership.

## Local acceptance

```text
TypeScript check: passed
Automated tests: 174 / 174 passed
Phase 12 offline deterministic demo: passed
Real Provider calls in this convergence: 0
```

The full test suite includes invalid portal, forged identity, unauthenticated agent/system presence, cross-principal MCP session, stale runtime revision/sequence and duplicate idempotency controls.

## Authority boundaries

- Canvas owns geometry and projection; providers own native browser/terminal/thread resources.
- Secure-mode caller identity is claimed data until resolved from bearer session binding.
- Runtime presence is ephemeral and cannot become durable Canvas truth.
- Auth tokens are excluded from broadcasts, objects, event ledgers and public examples.
- `legacy_local` remains an explicitly advertised compatibility mode when no resolver is configured.

## Release gate still pending at this document revision

- One canonical GitHub pull request targeting current `main`.
- GitHub CI on the exact PR head.
- Expected-head merge and formal local/origin `main` synchronization.

The final commit and CI/merge receipts must be reported separately; this document does not pre-claim them.

## Not proven

See `PHASE13_PMW_COVERAGE_MATRIX.md`. In particular, contract-level tests are not evidence of an external Python PMW adapter E2E, production Electron/WebView host integration, latest MCP conformance or new real Provider behavior.

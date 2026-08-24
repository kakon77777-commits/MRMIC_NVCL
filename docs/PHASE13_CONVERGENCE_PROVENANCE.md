# Phase 13 Current-Main Convergence Provenance

Date: 2026-08-24

## Baselines

- Current main base: `da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9`
- Historical Phase 13 base: `6606b54532c0f327206e7c021120370044b6e0ff`
- Historical Phase 13 final: `07da8848314d5e0ca50e3e956c6b7af1883d0d83`
- Historical Phase 13 commits: 30
- Port method: audited final-state path import, not merge or rebase

## Historical stack tips

1. `30209e573cf000f6a147bea6d816815aaba1b293` — canvas-first PMW
2. `b0d9685c8292ea00bab1eb8dfc86bdb9cb16cb26` — secure MCP and Tandem portal
3. `16332fd1009d66fffb602e69462801a6d81ffcb1` — live portal runtime
4. `10e5a5aebb2b6d9eff1208622680d20e36b3b35a` — Herdr agent projection
5. `b42bbdfb4adc29240cec5e5c450cbc23675c2984` — AI Board and CTCL providers
6. `c74fc140bb77196383039f030d21f67a341a2d92` — secure Canvas client
7. `07da8848314d5e0ca50e3e956c6b7af1883d0d83` — ephemeral runtime ingress

## Included

- Phase 13 provider-neutral portal, identity, sync, client, runtime presence and provider packages
- Phase 13 modifications to Canvas schema, SVG adapter, state-vector sync, sync registry and WebSocket sync
- Phase 13 unit, integration and real local WebSocket tests
- Phase 13 architecture note

## Excluded from historical tree

- historical `README.md`
- historical `MANIFEST.json` and `SHA256SUMS.txt`
- historical `scripts/release-manifest.mjs`
- four mojibake theory aliases

Current-main `docs/INDEX.md`, theory provenance, Unicode-safe audit, consolidation spec/plan and `tests/workspace-layout.test.mjs` remain authoritative.

Old PR #7–#13 are provenance records only. This convergence branch is the sole current-main implementation candidate.

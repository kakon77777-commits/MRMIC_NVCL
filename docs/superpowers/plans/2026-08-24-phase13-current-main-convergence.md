# MRMIC／NVCL Phase 13 Current-Main Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. This plan is explicitly Single-topology; do not dispatch subagents.

**Goal:** Port and complete Phase 13 on current main as one secure, versioned, PMW-consumable implementation PR.

**Architecture:** Import the validated final-state Phase 13 code/tests by path while excluding stale release/theory files. Add missing versioned contracts, shared auth integration, provider-neutral JSON surfaces, and live portal control state through TDD. Regenerate release evidence only after all runtime tests pass.

**Tech Stack:** Node.js 22+, npm, TypeScript, Node test runner, JSON Schema, HTTP, MCP 2025-11-25 stateful subset, WebSocket state-vector sync.

**Spec:** `docs/superpowers/specs/2026-08-24-phase13-current-main-convergence-design.md`

## Global Constraints

- Base is `da1ec4fcc32e9c2e01ff727492e1a9fd35a174a9`.
- Source final is `07da8848314d5e0ca50e3e956c6b7af1883d0d83`.
- Single topology; zero subagents.
- Preserve canonical theory and workspace-layout test.
- Do not import stale README, MANIFEST, SHA sums, release-manifest or mojibake aliases.
- No real Provider A/B.
- No old stacked PR merge.

---

### Task 1: Port validated Phase 13 final-state code and tests

**Files:** Port only Phase 13 `packages/`, modified sync/schema packages, `docs/PHASE13_CANVAS_FIRST_PMW.md`, and Phase 13 tests listed by the coverage audit. Create `docs/PHASE13_CONVERGENCE_PROVENANCE.md`.

- [ ] Verify 76/76 current-main baseline and 269-entry manifest.
- [ ] Restore the approved path set from source final `07da884`.
- [ ] Run `npm install --package-lock-only` if workspace lock metadata changes.
- [ ] Run `npm run check` and all ported tests.
- [ ] Confirm canonical theory hashes and `tests/workspace-layout.test.mjs` remain.
- [ ] Commit `feat: port Phase 13 stack onto current main`.

### Task 2: Add versioned capability and portal migration contracts

**Files:**
- Create `packages/capability-contract/src/index.ts`
- Create `packages/capability-contract/package.json`
- Create `contracts/phase13/mrmic-capabilities-v1.schema.json`
- Create `contracts/phase13/native-resource-portal-v1.schema.json`
- Create migration fixtures and note
- Modify `packages/resource-portal/src/index.ts`
- Modify `apps/web/src/server.ts`
- Modify `packages/mcp-reference-server/src/index.ts`
- Test `tests/phase13-capability-contract.test.mjs`
- Test `tests/phase13-portal-migration.test.mjs`

- [ ] Write failing tests proving HTTP/MCP capability equality and deterministic compat migration.
- [ ] Verify RED because interfaces do not exist.
- [ ] Implement `MRMIC_CAPABILITIES`, `migrateCompatFrameV0()`, HTTP endpoint and MCP resource.
- [ ] Verify malformed migration input fails closed and schemas/examples parse.
- [ ] Run focused tests and commit `feat: add Phase 13 capability and portal migration contracts`.

### Task 3: Secure every required mutation surface

**Files:**
- Modify `packages/identity-auth/src/index.ts`
- Modify `packages/mcp-auth-gateway/src/index.ts`
- Modify `apps/web/src/server.ts`
- Test `tests/phase13-http-auth-integration.test.mjs`
- Test `tests/phase13-mcp-auth-integration.test.mjs`

- [ ] Write failing real-server tests for unauthenticated HTTP, viewer mutation, forged actor overwrite, MCP gateway integration and cross-principal session rejection.
- [ ] Verify RED against the ported server.
- [ ] Build one request-principal resolver and role policy reused by HTTP/MCP/WebSocket.
- [ ] Bind `/api/transaction` and `/api/sync/update` actors from verified principals.
- [ ] Route `/mcp` through `AuthenticatedMcpGateway` in secure mode.
- [ ] Verify token/identity fields do not enter events or broadcast payloads.
- [ ] Run focused and legacy tests; commit `feat: bind all Phase 13 mutation surfaces to verified principals`.

### Task 4: Publish provider-neutral secure client contracts

**Files:** Create JSON schemas/examples under `contracts/phase13/`; modify `secure-canvas-client` only when contract parity requires it; test `tests/phase13-pmw-json-contract.test.mjs`.

- [ ] Write failing tests loading every JSON example and checking required schema fields.
- [ ] Verify RED because contracts are missing.
- [ ] Add hello/ack/update/presence/runtime/rejection/removal/error schemas and examples.
- [ ] Prove identity-free caller payloads and verified server identity.
- [ ] Prove no token appears outside hello/auth transport fixture.
- [ ] Commit `feat: publish provider-neutral PMW secure client contracts`.

### Task 5: Complete live portal focus and control ownership

**Files:** Modify `packages/portal-overlay/src/runtime.ts`; extend `tests/portal-runtime.test.mjs`; add provider-neutral host state example/schema.

- [ ] Write failing tests for mounted/visible/focused/controlOwner separation, acquire/release/revoke and eviction cleanup.
- [ ] Verify RED because focused/controlOwner APIs do not exist.
- [ ] Implement explicit state transitions without copying provider runtime into Canvas objects.
- [ ] Verify offscreen projection does not destroy provider resource.
- [ ] Commit `feat: add explicit Phase 13 portal focus and control ownership`.

### Task 6: Final Phase 13 acceptance and one canonical PR

**Files:** Update `VERSION`, `package.json`, `package-lock.json`, `README.md`, Phase 13 docs, `scripts/release-manifest.mjs`; regenerate `MANIFEST.json` and `SHA256SUMS.txt`.

- [ ] Set version `0.14.0`, phase `13`, and truthful capability/schema identifiers.
- [ ] Run `npm ci`, `npm run check`, full tests and Phase 12 offline demo.
- [ ] Run secret scan and negative-control matrix.
- [ ] Regenerate and verify Phase 13 manifest last.
- [ ] Run FCAO deterministic Twin audit; CHALLENGE any missing requirement.
- [ ] Push one branch and open one main-target PR with exact coverage matrix and not_proven.
- [ ] Wait for fixed-head CI; merge only with existing user authority and exact tested SHA.
- [ ] Fast-forward formal local main and verify release evidence.

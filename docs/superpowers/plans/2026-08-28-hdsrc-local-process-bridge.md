# HDSRC Local Process Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Do not dispatch subagents; this integration intentionally remains single-topology. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed local JSONL process bridge that lets MRMIC use the real HDSRC v0.10 HPCM2/HMR1/HMBT1 runtime without moving canonical HDSRC policy or state into TypeScript.

**Architecture:** `LocalProcessHdsrcProvider` owns a persistent Python child process and translates the existing read-only `HdsrcProviderClient` calls into `hdsrc-process/0.1` JSONL requests. The Python host loads static HDS1 registry entries and the frozen v0.10 predictor/calibrator/policy bundle, performs HPCM2 planning, invokes HMR1 only on fallback, persists only selected HMBT1 materializations, and revalidates freshness/integrity on later reads.

**Tech Stack:** Node.js 22.5+, npm 10+, TypeScript strict mode, Node test runner, Python 3.11+, JSONL stdio, HDSRC v0.10 Python modules, HDS1, HMBT1/BigTIFF.

**Spec:** `docs/superpowers/specs/2026-08-28-hdsrc-local-process-bridge-design.md`

## Global Constraints

- Base implementation branch: `integration/hdsrc-local-process-bridge-v0.2` from `main@6549d7cb5b191cbf463d4f525e696a180c2a8569`.
- Process protocol id is exactly `hdsrc-process/0.1`.
- HDSRC canonical state remains read-only; no state register/patch/write method exists in the process protocol.
- TypeScript does not import or reimplement HDSRC HMSP1/HPCM1/HPCM2/HMR1 logic.
- HDSRC authorization remains independent from MRMIC authorization.
- Fast-path HPCM2 planning must not materialize all candidate TIFFs.
- Oracle fallback is a valid provider decision, not an integrity failure.
- Canvas provider/resource enums and the pixel-only multimodal Provider contract remain unchanged.
- Materialization digest is SHA-256 of selected HMBT1 bytes.
- Any timeout, child exit, malformed protocol output, stale state, or digest mismatch fails closed.
- CI may use a contract fixture `hdsrc_exp` package only for transport/host conformance. Real HDSRC semantic evidence comes from a separate local v0.10 validation run.

---

### Task 1: Fail-closed JSONL process client

**Files:**
- Create: `packages/provider-hdsrc/src/process-client.ts`
- Create: `tests/fixtures/hdsrc-jsonl-fixture.py`
- Create: `tests/hdsrc-process-client.test.mjs`

**Interfaces:**
- Produces: `HdsrcJsonlProcessClient`.
- Constructor:
  `new HdsrcJsonlProcessClient({ executable, args, env?, cwd?, timeoutMs?, protocol? })`.
- Method:
  `request(method: string, params: Record<string, unknown>, timeoutMs?: number): Promise<unknown>`.
- Method:
  `close(): void`.
- Fatal transport errors reject all pending requests and permanently close that client instance.

- [ ] **Step 1: Write RED tests for request correlation and fail-closed lifecycle**

```js
const client = new HdsrcJsonlProcessClient({
  executable: python,
  args: [fixture, 'echo'],
  timeoutMs: 1000,
})
const [a, b] = await Promise.all([
  client.request('echo', { value: 'a' }),
  client.request('echo', { value: 'b' }),
])
assert.equal(a.value, 'a')
assert.equal(b.value, 'b')
```

Add separate tests where the fixture emits malformed JSON, exits before replying, and sleeps past a 50 ms timeout. Each must reject and a subsequent `request(...)` on the same client must reject as closed.

- [ ] **Step 2: Push RED test commit and verify GitHub Actions fails only because `process-client.ts` does not exist**

Run through CI:

```text
npm run check
npm test
```

Expected new-test failure: module import for `process-client.js` cannot resolve. Existing Phase 14 tests remain green.

- [ ] **Step 3: Implement minimal process client**

Required process creation:

```ts
spawn(executable, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  shell: false,
  windowsHide: true,
  cwd,
  env,
})
```

Required wire message:

```ts
{ protocol: 'hdsrc-process/0.1', id, method, params }
```

Protocol rules:

- one UTF-8 JSON object per stdout line;
- matching `protocol` and numeric `id` required;
- exactly one of `result` or `error` required;
- malformed JSON/protocol is fatal;
- timeout kills child and fails all pending requests;
- stderr is retained only as a bounded last-error diagnostic and never parsed as protocol.

- [ ] **Step 4: Push GREEN implementation and verify focused/full CI**

Expected focused result: all `hdsrc-process-client` tests pass.

- [ ] **Step 5: Commit checkpoint**

Commit message:

```text
feat: add fail-closed HDSRC JSONL process client
```

---

### Task 2: Production Python host — handshake, registry, capabilities, independent authorization

**Files:**
- Create: `scripts/hdsrc_process_host.py`
- Create: `contracts/hdsrc-integration/hdsrc-local-registry-v1.schema.json`
- Create: `tests/fixtures/hdsrc-stub-runtime/hdsrc_exp/__init__.py`
- Create: `tests/fixtures/hdsrc-stub-runtime/hdsrc_exp/bridge_api.py`
- Create: `tests/fixtures/hdsrc-local-registry.json`
- Create: `tests/hdsrc-process-host.test.mjs`

**Interfaces:**
- Host argv:
  `python scripts/hdsrc_process_host.py --registry <json> --profile-root <dir> --materialization-root <dir>`.
- Host methods implemented in this task: `initialize`, `capabilities`, `state`, `shutdown`.
- Stub runtime exposes the same adapter-facing functions as the real HDSRC adapter module expected by the host; it returns deterministic values and records no canonical writes.

- [ ] **Step 1: Write RED host tests**

Tests must spawn the production host script with:

```js
env: {
  ...process.env,
  PYTHONPATH: stubRuntimeRoot,
}
```

Assertions:

```js
const init = await client.request('initialize', { client: 'mrmic-nvcl', version: '0.14.0' })
assert.equal(init.protocol, 'hdsrc-process/0.1')
assert.equal(init.readOnly, true)
```

`state` with principal `principal:allowed` succeeds. The same state with `principal:denied` returns error code `UNAUTHORIZED`, even if MRMIC-side test context would otherwise allow read.

- [ ] **Step 2: Push RED and verify missing host script is the only new blocker**

Expected failure: child process exits because `scripts/hdsrc_process_host.py` is absent.

- [ ] **Step 3: Implement registry and base host**

Registry schema fields:

```json
{
  "schema": "hdsrc-local-registry/v1",
  "states": [
    {
      "stateId": "state:fixture",
      "stateRevision": 3,
      "hds1Path": "/absolute/path/fixture.hds1",
      "readPrincipals": ["principal:allowed"]
    }
  ]
}
```

Host state response computes:

```python
state_digest = 'sha256:' + hashlib.sha256(hds1_bytes).hexdigest()
```

and returns existing `hdsrc-state-ref/v1` shape with `authority='hdsrc'` and real decoded dimension.

Host authorization is:

```python
if principal_id not in entry['readPrincipals']:
    raise ProviderError('UNAUTHORIZED', 'HDSRC read access denied', False)
```

No MRMIC role or `allowHdsrcRead` boolean is accepted as an HDSRC authorization substitute.

- [ ] **Step 4: Verify host tests and full CI GREEN**

Also assert the host method dispatch table has no names containing `write`, `patch`, `mutate`, `register`, or `commit_state`.

- [ ] **Step 5: Commit checkpoint**

Commit message:

```text
feat: add read-only HDSRC local process host
```

---

### Task 3: HPCM2 planning, HMR1 fallback, selected HMBT1 persistence

**Files:**
- Create: `packages/provider-hdsrc/src/local-process.ts`
- Modify: `packages/provider-hdsrc/src/index.ts`
- Extend: `scripts/hdsrc_process_host.py`
- Extend: `tests/fixtures/hdsrc-stub-runtime/hdsrc_exp/bridge_api.py`
- Create: `tests/hdsrc-local-process-provider.test.mjs`

**Interfaces:**
- Produces: `LocalProcessHdsrcProvider implements HdsrcProviderClient`.
- Existing method `materialize(request, context)` maps to process `plan_materialization` and returns `HdsrcMaterializationDecisionV1` without persisting carrier bytes.
- New method:

```ts
materializeResolved(
  request: HdsrcMaterializationRequestV1,
  context: HdsrcAccessContext,
): Promise<{
  decision: HdsrcMaterializationDecisionV1
  materializationRef: string
  materialization: HdsrcMaterializationV1
  oracleUsed: boolean
}>
```

- New process method `materialize` returns the same result envelope.

- [ ] **Step 1: Write RED provider tests for fast path and oracle fallback**

Fast fixture case:

```js
const planned = await provider.materialize(requestFast, context)
assert.equal(planned.decision, 'fast_path')
assert.equal(fixtureTelemetry.candidateMaterializations, 0)
```

Resolved fast case:

```js
const resolved = await provider.materializeResolved(requestFast, context)
assert.equal(resolved.oracleUsed, false)
assert.equal(resolved.materialization.carrierProfile, 'HMBT1')
```

Fallback fixture case must report `decision='oracle_fallback'`, `oracleUsed=true`, and telemetry showing HMR1 was invoked before one selected carrier was persisted.

- [ ] **Step 2: Push RED and verify missing `local-process.ts` / host methods are the only new failures**

- [ ] **Step 3: Implement real host adapter flow**

Production HDSRC adapter path inside Python host:

```python
state = decode_hds1(hds1_bytes)
workload = MultiScaleRelationWorkload(
    query_span=request['workload']['expectedSpan'],
    expected_reuse=request['workload'].get('expectedReuse', 1),
)
plan = compile_multiscale_spatialization(state)
candidates = extract_candidate_features(state, workload, plan)
decision = select_uncertainty_aware_view(
    candidates,
    expected_reuse=workload.expected_reuse,
    model=model,
    calibrator=uncertainty,
    confidence_policy=confidence,
)
```

Fast materialization:

```python
selected_view = plan.view_for(decision.selected_block_size)
carrier = encode_hmbt1_from_state(
    state,
    block_size=decision.selected_block_size,
    node_order=selected_view.plan.physical_to_canonical,
    spatialization_id=selected_view.plan.selected_algorithm,
)
```

Fallback:

```python
bank = materialize_multiscale_view_bank(state, temp_dir)
oracle = evaluate_workload_on_materialized_bank(state, workload, bank)
selected_carrier_path = bank.view_for(oracle.selected_block_size).path
```

Copy only the selected final carrier into persistent materialization root. Temporary candidate bank is deleted after fallback.

- [ ] **Step 4: Implement deterministic manifest/URI persistence**

Workload digest:

```python
sha256(canonical_json(workload)).hexdigest()
```

Materialization digest:

```python
sha256(carrier_bytes).hexdigest()
```

Persist:

```text
{materializationRoot}/{materializationId}/manifest.json
{materializationRoot}/{materializationId}/machine.hmbt1.tif
{materializationRoot}/{materializationId}/preview.svg
```

- [ ] **Step 5: Verify focused/full CI GREEN**

Expected: previous 194 tests plus new process/provider tests pass, with one pre-existing skip only.

- [ ] **Step 6: Commit checkpoint**

Commit message:

```text
feat: bridge HPCM2 decisions to HMBT1 materialization
```

---

### Task 4: Restart freshness, integrity, partial reads, and transport failure gates

**Files:**
- Extend: `packages/provider-hdsrc/src/local-process.ts`
- Extend: `scripts/hdsrc_process_host.py`
- Extend: `tests/hdsrc-local-process-provider.test.mjs`
- Extend: `tests/hdsrc-process-client.test.mjs`

**Interfaces:**
- Process methods: `materialization`, `read_resource`, `read_partial_relation_block_row`.
- TypeScript helpers:

```ts
readPartialRelationBlockRow(
  materializationRef: string,
  blockRow: number,
  context: HdsrcAccessContext,
): Promise<unknown>
```

- [ ] **Step 1: Add RED restart/integrity tests**

Test sequence:

1. materialize resolved;
2. close provider process;
3. create a new provider instance with same registry/cache;
4. fetch `materialization(ref)` and machine resource successfully;
5. mutate fixture HDS1 bytes and verify old materialization returns `STALE_STATE`;
6. restore state, mutate persisted machine bytes and verify `INTEGRITY_FAILURE`.

- [ ] **Step 2: Add RED partial-read test**

```js
const partial = await provider.readPartialRelationBlockRow(ref, 0, trustedContext)
assert.equal(partial.schema, 'hdsrc-partial-relation-block-row/v1')
assert.equal(partial.blockRow, 0)
assert.ok(Array.isArray(partial.relations))
```

- [ ] **Step 3: Implement revalidation and partial read**

Every `materialization` / machine `read_resource` call must recompute current state HDS1 digest and persisted carrier SHA-256 before returning current truth.

Partial read must call HDSRC `read_hmbt1_relation_block_row(...)` through the Python adapter and return exact relation tuples plus touched tile metadata.

- [ ] **Step 4: Add/verify timeout, crash, malformed-output negative controls**

The generic JSONL client tests from Task 1 remain authoritative. Add one `LocalProcessHdsrcProvider` test proving a dead child is surfaced as `HdsrcProviderError` code `PROVIDER_UNAVAILABLE`, not a raw Node child-process exception.

- [ ] **Step 5: Push GREEN checkpoint and verify full CI**

- [ ] **Step 6: Commit checkpoint**

Commit message:

```text
test: harden HDSRC process freshness and failure gates
```

---

### Task 5: Real HDSRC v0.10 local validation

**Files:**
- Create: `scripts/validate_hdsrc_v010_bridge.py`
- Create: `docs/HDSRC_LOCAL_PROCESS_BRIDGE_VALIDATION_v0.2.md`

**Interfaces:**
- Validation script accepts:

```text
--hdsrc-root <extracted v0.10 root>
--state <hds1 path>
--profile-root <artifacts_image_v010 path>
--work-root <temporary/output path>
```

It launches the same production `scripts/hdsrc_process_host.py`; it does not call HDSRC functions directly for the measured bridge operations.

- [ ] **Step 1: Run validation against actual v0.10 source package**

Canonical package evidence:

```text
ZIP SHA-256 = 583659487a25cd76a7a3a32a35fda373074e630c3f7f60e47c618358bbb1c217
```

Use a real HDS1 state from the v0.10 package or a state compiled by the same v0.10 compiler.

- [ ] **Step 2: Record actual bridge evidence**

Report must include:

```text
stateId
stateRevision
stateDigest
node_count
dimension
relation_count
HPCM2 decision
requires_oracle
oracle_used
selected_block_size
selected_spatialization
materializationDigest
machine_carrier_bytes
process restart manifest read = PASS/FAIL
machine digest revalidation = PASS/FAIL
partial relation block row = PASS/FAIL
```

- [ ] **Step 3: Run a corruption negative control**

Copy the materialization cache, alter one byte of `machine.hmbt1.tif`, restart the host, and record the expected `INTEGRITY_FAILURE`.

- [ ] **Step 4: Commit validation report and reusable runner**

Commit message:

```text
docs: record real HDSRC v0.10 process bridge validation
```

---

### Task 6: Documentation closure, PR, merge, post-merge verification

**Files:**
- Modify: `docs/HDSRC_MRMIC_NVCL_INTEGRATION_STATUS_v0.1.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/superpowers/plans/2026-08-28-hdsrc-local-process-bridge.md`

**Interfaces:** none; evidence/closure only.

- [ ] **Step 1: Update status without rewriting v0.1 authority claims**

Add a Slice 4 section distinguishing:

```text
CI transport/conformance evidence
!=
real external HDSRC v0.10 local semantic validation
```

Explicitly keep canonical writeback, online-calibrator persistence, remote transport, and production security as not implemented.

- [ ] **Step 2: Run final branch-head verification**

Required GitHub Actions commands:

```text
npm install
npm run check
npm test
```

Expected: zero failures and only the pre-existing intentionally skipped capability probe unless the repository baseline changes independently.

- [ ] **Step 3: Audit branch diff against `main`**

Required findings:

- no public Canvas enum changes;
- no changes to pixel-only Provider contract;
- no HDSRC canonical mutation method;
- no credential-bearing fixture;
- no vendored HDSRC v0.10 runtime source inside TypeScript packages;
- process host remains a thin adapter.

- [ ] **Step 4: Open one PR to `main`**

PR title:

```text
Phase 14: add real local HDSRC process bridge
```

PR body must list RED/GREEN CI ids for Tasks 1–4 and the real v0.10 validation evidence separately.

- [ ] **Step 5: Review all PR threads and merge only from a verified immutable head SHA**

Use squash merge with `expected_head_sha`.

- [ ] **Step 6: Verify post-merge `main` CI**

Do not mark Slice 4 complete until the merge commit's `main` workflow is `completed/success`.

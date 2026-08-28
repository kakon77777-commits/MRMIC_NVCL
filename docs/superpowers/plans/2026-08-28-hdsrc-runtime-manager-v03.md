# HDSRC Runtime Discovery, Lifecycle, and NVCL Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let MRMIC/NVCL deterministically discover a configured local HDSRC v0.10 runtime, supervise its read-only process lifecycle, and route NVCL observation intent into verified HDSRC materializations without caller-supplied process paths.

**Architecture:** Add three HDSRC-scoped units around the existing v0.2 bridge: `runtime-discovery.ts` parses a deployment-only binding into an immutable descriptor; `runtime-manager.ts` owns lazy process start, runtime epochs, failure-origin-aware one-shot restart, and stop; `observation-router.ts` validates an NVCL-facing intent and maps it to the existing HDSRC workload/materialization contract. The Python host receives one bootstrap-only refactor so the configured `profileRoot/src` is the actual `hdsrc_exp` module authority rather than an ambient `PYTHONPATH` package.

**Tech Stack:** TypeScript/Node.js 22, Node `fs/path/os`, Python 3.13-compatible stdlib, existing `hdsrc-process/0.1`, HDSRC v0.10 Python runtime, Node test runner, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-28-hdsrc-runtime-manager-v03-design.md`

## Global Constraints

- Base implementation line is `main@8a51073b14dffaf6e88d46be89efa0086b2f5191` plus this branch's approved design documentation.
- Preserve `S_HDSRC != S_Canvas`, `Auth_MRMIC !=> Auth_HDSRC`, and `Materialize(S,W) !=> CanonicalMutation(S)`.
- `DeploymentBinding != CanonicalState`, `RuntimeEpoch != HDSRC StateRevision`, and `ProcessRestart != StateRevision`.
- Discovery precedence is exactly explicit binding path -> `HDSRC_RUNTIME_BINDING` -> deterministic user-local binding -> `PROVIDER_UNAVAILABLE`; a selected higher-precedence source never falls through after missing/unreadable/malformed content.
- No disk scan, arbitrary Git search, PATH-based HDSRC inference, network install/fetch, credential lookup, or binding-file mutation.
- `profileRoot/src/hdsrc_exp` is the configured Python module authority; production runtime-manager launches must not honor `HDSRC_TEST_STUB_RUNTIME`.
- Only transport-origin failures are eligible for automatic restart. Contract failures do not auto-restart. Remote HDSRC domain failures leave the manager ready.
- One manager operation may perform at most one automatic transport restart/retry cycle.
- `materializeResolved` is never automatically replayed after a fatal transport failure.
- `partialRelationBlockRow` is valid only for `machine_carrier` + `queryDirection='block'`.
- MRMIC-side authorization/trusted-lane gates occur before discovery, child-process start, HDSRC registry/state access, or resource access.
- TypeScript must not select HDSRC block size, spatialization algorithm, HPCM2 confidence policy, HMR1 oracle policy, or carrier encoding parameters.
- No new Canvas provider/resource enum, no widening of the existing pixel-only multimodal Provider contract, and no HDSRC canonical write method.

---

### Task 1: Runtime Binding Contract and Deterministic Discovery

**Files:**
- Create: `contracts/hdsrc-integration/hdsrc-runtime-binding-v1.schema.json`
- Create: `packages/provider-hdsrc/src/runtime-discovery.ts`
- Test: `tests/hdsrc-runtime-discovery.test.mjs`

**Interfaces:**
- Consumes: existing `HdsrcProviderError`, `HDSRC_PROCESS_PROTOCOL='hdsrc-process/0.1'`.
- Produces:
  - `HdsrcRuntimeBindingV1`
  - `HdsrcRuntimeDescriptor`
  - `HdsrcRuntimeDiscoveryOptions`
  - `discoverHdsrcRuntime(options): Promise<HdsrcRuntimeDescriptor>`
  - `userLocalHdsrcBindingPath(options): string | undefined`

- [x] **Step 1: Write the failing discovery contract tests**

Add focused tests that create temporary binding files and assert exact precedence and path normalization:

```js
const descriptor = await discoverHdsrcRuntime({
  explicitBindingPath: explicit,
  env: { HDSRC_RUNTIME_BINDING: environment },
  platform: 'linux',
  homeDir: home,
})
assert.equal(descriptor.source, 'explicit')
assert.equal(descriptor.bindingPath, resolve(explicit))
assert.equal(descriptor.registry, resolve(dirname(explicit), 'registry.json'))
```

Also assert:

```js
await assert.rejects(
  discoverHdsrcRuntime({ explicitBindingPath: malformed, env: { HDSRC_RUNTIME_BINDING: validLower } }),
  error => error.code === 'INTEGRITY_FAILURE',
)
```

Cover Windows `LOCALAPPDATA`, POSIX `XDG_CONFIG_HOME`, POSIX `HOME`, absent binding, unknown protocol, relative path resolution, and no fallback from a selected malformed/missing source.

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build && node --test tests/hdsrc-runtime-discovery.test.mjs
```

Expected: FAIL because `runtime-discovery.js` and the binding schema do not exist.

- [x] **Step 3: Add the binding JSON Schema**

The schema must require exactly:

```json
{
  "schema": "hdsrc-runtime-binding/v1",
  "runtimeId": "non-empty string",
  "protocol": "hdsrc-process/0.1",
  "executable": "non-empty string",
  "hostScript": "non-empty string",
  "registry": "non-empty string",
  "profileRoot": "non-empty string",
  "materializationRoot": "non-empty string"
}
```

Optional `cwd`, `timeoutMs`, and `maxResourceBytes` must follow the approved spec; `additionalProperties` is false.

- [x] **Step 4: Implement `runtime-discovery.ts` minimally**

Use Node filesystem/path APIs only. The public descriptor shape is:

```ts
export interface HdsrcRuntimeDescriptor {
  schema: 'hdsrc-runtime-descriptor/v1'
  runtimeId: string
  source: 'explicit' | 'environment' | 'user_local'
  bindingPath: string
  protocol: 'hdsrc-process/0.1'
  executable: string
  hostScript: string
  registry: string
  profileRoot: string
  materializationRoot: string
  cwd?: string
  timeoutMs?: number
  maxResourceBytes?: number
}
```

Selected-source behavior must be explicit:

```ts
if (options.explicitBindingPath !== undefined) {
  return readSelected('explicit', options.explicitBindingPath)
}
const envBinding = options.env?.HDSRC_RUNTIME_BINDING
if (envBinding?.trim()) return readSelected('environment', envBinding)
const userLocal = userLocalHdsrcBindingPath(options)
if (!userLocal) throw unavailable('no configured HDSRC runtime binding')
return readSelected('user_local', userLocal)
```

Relative binding values resolve once against `dirname(bindingPath)`. Freeze the returned descriptor.

Error mapping:

```text
selected file missing/unreadable -> PROVIDER_UNAVAILABLE
invalid JSON/schema/field -> INTEGRITY_FAILURE
unsupported protocol -> UNSUPPORTED_PROFILE
no configured source -> PROVIDER_UNAVAILABLE
```

- [x] **Step 5: Run focused discovery tests to GREEN**

Run:

```bash
npm run build && node --test tests/hdsrc-runtime-discovery.test.mjs
```

Expected: PASS.

- [x] **Step 6: Run full regression and commit**

Run:

```bash
npm run check && npm test
```

Expected: all prior 216 tests plus the new discovery tests pass, with only the existing Codex capability skip.

Commit:

```bash
git add contracts/hdsrc-integration/hdsrc-runtime-binding-v1.schema.json packages/provider-hdsrc/src/runtime-discovery.ts tests/hdsrc-runtime-discovery.test.mjs
git commit -m "feat: add deterministic HDSRC runtime discovery"
```

---

### Task 2: Bind the Python Host to the Configured HDSRC Module Root

**Files:**
- Modify: `scripts/hdsrc_process_host.py`
- Modify: `packages/provider-hdsrc/src/local-process.ts`
- Test: `tests/hdsrc-runtime-profile-root.test.mjs`
- Reuse fixtures: `tests/fixtures/hdsrc-stub-runtime/`

**Interfaces:**
- Consumes: `LocalProcessHdsrcProviderOptions.profileRoot` and `hdsrc-process/0.1` host CLI.
- Produces: host bootstrap that imports `hdsrc_exp` only after binding `<profileRoot>/src`, plus verification that the resolved package lives below that root.

- [x] **Step 1: Write failing profile-root authority tests**

Create tests with two module roots: a configured fixture root and a conflicting ambient same-name `hdsrc_exp`. Assert the configured root wins and that a missing configured `src/hdsrc_exp` fails closed.

The normal local-process provider invocation must no longer require external `PYTHONPATH` to locate its configured runtime.

- [x] **Step 2: Run focused test to verify RED**

```bash
npm run build && node --test tests/hdsrc-runtime-profile-root.test.mjs
```

Expected: FAIL because the v0.2 host imports `hdsrc_exp.codec` before `--profile-root` is applied.

- [x] **Step 3: Refactor host bootstrap without changing HDSRC semantics**

Remove top-level canonical HDSRC imports from `hdsrc_process_host.py`. Parse `--profile-root`, then bind:

```py
module_root = profile_root.resolve() / 'src'
package_root = module_root / 'hdsrc_exp'
if not package_root.is_dir():
    raise ProviderError('PROVIDER_UNAVAILABLE', 'configured HDSRC module root is missing')
sys.path.insert(0, str(module_root))
from hdsrc_exp.codec import decode_hds1
```

Verify the loaded package location:

```py
import hdsrc_exp
loaded = Path(hdsrc_exp.__file__).resolve()
if module_root not in loaded.parents:
    raise ProviderError('INTEGRITY_FAILURE', 'loaded hdsrc_exp is outside configured profileRoot')
```

Pass the delayed codec function into host/config state instead of depending on a pre-imported global.

- [x] **Step 4: Sanitize production manager/provider environment boundary**

Add a small helper usable by the later manager:

```ts
export function productionHdsrcProcessEnv(base = process.env): Record<string, string | undefined> {
  return { ...base, HDSRC_TEST_STUB_RUNTIME: undefined, PYTHONPATH: undefined }
}
```

Do not change explicit v0.2 test fixtures that directly construct `LocalProcessHdsrcProvider` with a test env; the helper is for discovered production launches.

- [x] **Step 5: Run focused and existing process-host tests**

```bash
npm run build && node --test tests/hdsrc-runtime-profile-root.test.mjs tests/hdsrc-process-host.test.mjs tests/hdsrc-local-process-provider.test.mjs
```

Expected: PASS.

- [x] **Step 6: Run full regression and commit**

```bash
npm run check && npm test
```

Commit:

```bash
git add scripts/hdsrc_process_host.py packages/provider-hdsrc/src/local-process.ts tests/hdsrc-runtime-profile-root.test.mjs
git commit -m "fix: bind HDSRC host to configured profile root"
```

---

### Task 3: Preserve Local Process Failure Origin for Lifecycle Decisions

**Files:**
- Modify: `packages/provider-hdsrc/src/process-client.ts`
- Modify: `packages/provider-hdsrc/src/local-process.ts`
- Test: `tests/hdsrc-runtime-failure-origin.test.mjs`

**Interfaces:**
- Produces:
  - `HdsrcProcessClientError` with `origin: 'transport' | 'contract'`
  - `HdsrcLocalProcessProviderError extends HdsrcProviderError` with `origin: 'transport' | 'contract' | 'remote_domain'`
- Keeps the public `HdsrcProviderClient` interface and provider error codes unchanged.

- [x] **Step 1: Write failure-origin RED tests**

Exercise one case from each class:

```js
await assert.rejects(timeoutCall, error => error.origin === 'transport')
await assert.rejects(protocolMismatchCall, error => error.origin === 'contract')
await assert.rejects(remoteStaleCall, error => error.origin === 'remote_domain' && error.code === 'STALE_STATE')
```

Also assert a remote `PROVIDER_UNAVAILABLE` envelope is still `remote_domain`, not transport.

- [x] **Step 2: Run focused test to RED**

```bash
npm run build && node --test tests/hdsrc-runtime-failure-origin.test.mjs
```

Expected: FAIL because v0.2 collapses generic local failures to provider unavailable without origin metadata.

- [x] **Step 3: Add typed client failure classification**

Use:

```ts
export type HdsrcProcessFailureOrigin = 'transport' | 'contract'
export class HdsrcProcessClientError extends Error {
  constructor(message: string, readonly origin: HdsrcProcessFailureOrigin) {
    super(message)
    this.name = 'HdsrcProcessClientError'
  }
}
```

Classify spawn/stdio/exit/timeout/write as `transport`; malformed JSON, protocol mismatch, bad response id/envelope, and unknown response id as `contract`.

- [x] **Step 4: Preserve origin through `LocalProcessHdsrcProvider`**

Add:

```ts
export type HdsrcLocalProcessFailureOrigin = 'transport' | 'contract' | 'remote_domain'
export class HdsrcLocalProcessProviderError extends HdsrcProviderError {
  constructor(code, message, retryable, readonly origin: HdsrcLocalProcessFailureOrigin) {
    super(code, message, retryable)
  }
}
```

Handshake mutation/method/schema violations are `contract`. `HdsrcProcessRemoteError` maps to `remote_domain`. `HdsrcProcessClientError` preserves its origin.

- [x] **Step 5: Run focused tests to GREEN**

```bash
npm run build && node --test tests/hdsrc-runtime-failure-origin.test.mjs tests/hdsrc-process-client.test.mjs tests/hdsrc-local-process-provider.test.mjs
```

Expected: PASS.

- [x] **Step 6: Full regression and commit**

```bash
npm run check && npm test
```

Commit:

```bash
git add packages/provider-hdsrc/src/process-client.ts packages/provider-hdsrc/src/local-process.ts tests/hdsrc-runtime-failure-origin.test.mjs
git commit -m "feat: preserve HDSRC process failure origin"
```

---

### Task 4: HDSRC Runtime Manager with Lazy Start and Bounded Restart

**Files:**
- Create: `packages/provider-hdsrc/src/runtime-manager.ts`
- Test: `tests/hdsrc-runtime-manager.test.mjs`

**Interfaces:**
- Consumes: `HdsrcRuntimeDescriptor`, `discoverHdsrcRuntime`, `LocalProcessHdsrcProvider`, `HdsrcLocalProcessProviderError`.
- Produces:
  - `HdsrcRuntimeManagerState = 'undiscovered' | 'discovered' | 'starting' | 'ready' | 'degraded' | 'stopped'`
  - `HdsrcRuntimeManagerStatus`
  - `HdsrcRuntimeManager`

- [x] **Step 1: Write manager state/lifecycle RED tests**

Inject a provider factory so tests count process/provider constructions without real OS processes:

```js
const manager = new HdsrcRuntimeManager({
  discovery: { explicitBindingPath: binding },
  providerFactory: descriptor => fakeFactory.create(descriptor),
})
assert.equal(manager.status().state, 'undiscovered')
await manager.discover()
assert.equal(fakeFactory.created, 0)
assert.equal(manager.status().state, 'discovered')
```

Cover concurrent first operations:

```js
await Promise.all([
  manager.state(ref, context),
  manager.state(ref, context),
])
assert.equal(fakeFactory.created, 1)
assert.equal(manager.status().runtimeEpoch, 1)
```

Cover transport -> degraded -> one-shot safe retry -> epoch 2; contract failure with no restart; remote stale/integrity/unauthorized while manager remains ready; unsafe `materializeResolved` transport failure with no automatic replay; explicit second call starts a fresh provider; and terminal stop.

- [x] **Step 2: Run focused test to RED**

```bash
npm run build && node --test tests/hdsrc-runtime-manager.test.mjs
```

Expected: FAIL because `runtime-manager.js` does not exist.

- [x] **Step 3: Implement manager state machine and single-flight start**

The manager constructor accepts:

```ts
export interface HdsrcRuntimeManagerOptions {
  discovery: HdsrcRuntimeDiscoveryOptions
  providerFactory?: (descriptor: HdsrcRuntimeDescriptor) => LocalProcessHdsrcProvider
}
```

Default provider creation uses descriptor fields plus `productionHdsrcProcessEnv()`.

Start semantics:

```ts
async #start(): Promise<LocalProcessHdsrcProvider> {
  if (this.#startPromise) return this.#startPromise
  this.#state = 'starting'
  this.#startPromise = this.#createAndHandshake()
  try {
    const provider = await this.#startPromise
    this.#provider = provider
    this.#runtimeEpoch += 1
    this.#state = 'ready'
    return provider
  } finally {
    this.#startPromise = undefined
  }
}
```

Handshake uses `provider.capabilities()` so `ready` is impossible before the v0.2 read-only checks pass.

- [x] **Step 4: Implement operation wrappers and retry policy**

Preauthorize every context-bearing operation before `discover()` or `#start()`.

Safe wrapper logic must be one-shot:

```ts
try {
  return await invoke(await this.#providerForOperation())
} catch (error) {
  const origin = localOrigin(error)
  if (origin === 'remote_domain') throw error
  this.#degradeAndClose()
  if (origin !== 'transport' || !safeRetry) throw error
  const replacement = await this.#start()
  try { return await invoke(replacement) }
  catch (retryError) { this.#classifyAfterRetry(retryError); throw retryError }
}
```

Do not recurse into the wrapper for the retry.

- [x] **Step 5: Run manager tests to GREEN**

```bash
npm run build && node --test tests/hdsrc-runtime-manager.test.mjs
```

Expected: PASS.

- [x] **Step 6: Full regression and commit**

```bash
npm run check && npm test
```

Commit:

```bash
git add packages/provider-hdsrc/src/runtime-manager.ts tests/hdsrc-runtime-manager.test.mjs
git commit -m "feat: add bounded HDSRC runtime manager"
```

---

### Task 5: NVCL Observation Intent Contract and Router

**Files:**
- Create: `contracts/hdsrc-integration/hdsrc-observation-intent-v1.schema.json`
- Create: `packages/provider-hdsrc/src/observation-router.ts`
- Test: `tests/hdsrc-observation-router.test.mjs`

**Interfaces:**
- Consumes: `HdsrcRuntimeManager`, existing `HdsrcAccessContext`, `HdsrcMaterializationRequestV1`, `ResolvedHdsrcMaterialization`, and partial relation type.
- Produces:
  - `HdsrcObservationIntentV1`
  - `assertHdsrcObservationIntent(value)`
  - `intentToMaterializationRequest(intent)`
  - `routeHdsrcObservation(intent, context, manager)`
  - discriminated result union for `human_preview`, `structured_manifest`, `machine_carrier`, and `partial_relation_block_row`.

- [x] **Step 1: Write intent/router RED tests**

Intent validation must reject illegal partial combinations:

```js
assert.throws(() => assertHdsrcObservationIntent({
  schema: 'hdsrc-observation-intent/v1',
  stateRef: 'hdsrc://state/state:demo',
  goalClass: 'relation_inspection',
  observationMode: 'human_preview',
  queryDirection: 'block',
  partialRelationBlockRow: 0,
}))
```

Assert exact workload mapping and prove no HDSRC policy field is added.

Use a spy manager to assert unauthorized/trust failures make **zero manager calls**. For the partial route assert `materializeResolved` + `readPartialRelationBlockRow` are used and `readResource` is never called.

- [x] **Step 2: Run focused test to RED**

```bash
npm run build && node --test tests/hdsrc-observation-router.test.mjs
```

Expected: FAIL because intent/router modules do not exist.

- [x] **Step 3: Add intent schema and validator**

Schema fields follow the approved spec exactly. The TypeScript validator must enforce semantic cross-field legality for `partialRelationBlockRow` even if JSON Schema validation is not executed at runtime.

- [x] **Step 4: Implement deterministic request mapping**

The mapping is only:

```ts
return {
  schema: 'hdsrc-materialization-request/v1',
  stateRef: intent.stateRef,
  workload: {
    schema: 'hdsrc-workload-hint/v1',
    goalClass: intent.goalClass,
    observationMode: intent.observationMode,
    ...(intent.queryDirection ? { queryDirection: intent.queryDirection } : {}),
    ...(intent.expectedSpan !== undefined ? { expectedSpan: intent.expectedSpan } : {}),
    ...(intent.expectedReuse !== undefined ? { expectedReuse: intent.expectedReuse } : {}),
    ...(intent.latencyClass ? { latencyClass: intent.latencyClass } : {}),
  },
}
```

No carrier/block/spatialization fields are introduced.

- [x] **Step 5: Implement authorization-first routing**

Order:

```ts
const checked = assertHdsrcObservationIntent(intent)
preauthorizeObservation(checked, context) // no manager access before this line passes
const request = intentToMaterializationRequest(checked)
const resolved = await manager.materializeResolved(request, context)
```

Then route:

```text
human_preview -> manager.readResource(previewResourceUri)
structured_manifest -> return resolved.materialization
machine_carrier no partial -> manager.readResource(machineResourceUri)
machine_carrier partial -> manager.readPartialRelationBlockRow(materializationRef, row)
```

Return bounded `runtimeEpoch` and HDSRC decision evidence, never descriptor paths, registry content, principal id, or opposite-lane payloads.

- [x] **Step 6: Run router tests to GREEN**

```bash
npm run build && node --test tests/hdsrc-observation-router.test.mjs
```

Expected: PASS.

- [x] **Step 7: Full regression and commit**

```bash
npm run check && npm test
```

Commit:

```bash
git add contracts/hdsrc-integration/hdsrc-observation-intent-v1.schema.json packages/provider-hdsrc/src/observation-router.ts tests/hdsrc-observation-router.test.mjs
git commit -m "feat: route NVCL observation intent through HDSRC"
```

---

### Task 6: Real HDSRC v0.10 Runtime-Manager Validation and Release Closure

**Files:**
- Create: `scripts/validate_hdsrc_v010_runtime_manager.mjs`
- Create: `artifacts/hdsrc-runtime-manager-v0.3/real-v010-validation.json`
- Create: `docs/HDSRC_RUNTIME_MANAGER_VALIDATION_v0.3.md`
- Create: `docs/HDSRC_RUNTIME_MANAGER_STATUS_v0.3.md`
- Modify: `docs/INDEX.md`
- Modify: `docs/superpowers/plans/2026-08-28-hdsrc-runtime-manager-v03.md` only to mark executed checkboxes/status; do not rewrite historical RED/GREEN evidence.

**Interfaces:**
- Consumes: the built TypeScript runtime manager/router, production Python host, exact HDSRC v0.10 source/profile lineage, and existing v0.2 validation helpers/evidence.
- Produces: deterministic real-runtime evidence proving discovery, lifecycle, routing, partial I/O, and authority invariants.

- [x] **Step 1: Write the real validation script before generating evidence**

The Node validator must create a temporary runtime binding and registry, then invoke the **discovered** runtime manager/router rather than constructing `LocalProcessHdsrcProvider` paths directly.

It may spawn Python once to generate the same deterministic 64-node/64D calibration state used by v0.2 validation. It must also use the canonical v0.10 `artifacts/codes/dim_4096.hds1`.

Required assertions:

```text
binding source = explicit (and one separate env-binding probe)
runtimeEpoch begins at 1 after first real start
64D intent -> real HPCM2 fast_path
4096D intent -> real HPCM2 oracle_fallback -> HMR1 HMBT1
partial machine relation observation reads less compressed data than carrier size
forced child death + safe state read -> bounded restart -> runtimeEpoch increments exactly once
state id/revision/digest remain unchanged across restart
valid changed HDS1 -> STALE_STATE
malformed HDS1 -> INTEGRITY_FAILURE
v0.2 full-rebinding structural fail-closed still passes
canonicalMutation = false
HDSRC_TEST_STUB_RUNTIME is absent from the production child
```

- [x] **Step 2: Run real validation against the exact local HDSRC v0.10 source**

Run from a clean branch source export/build with the known local HDSRC root:

```bash
node scripts/validate_hdsrc_v010_runtime_manager.mjs \
  --hdsrc-root /mnt/data/hdsrc_v010_src \
  --python "$(command -v python)" \
  --output /mnt/data/hdsrc-runtime-manager-v03-validation.json
```

Expected: exit 0 with `testStubRuntimeUsed=false` and all assertions true.

- [x] **Step 3: Replay real validation for determinism**

Run the same command a second time to a second output and compare normalized evidence byte-for-byte. Any deliberately volatile field must be excluded from the canonical evidence schema rather than post-processed away.

Expected: identical SHA-256.

- [x] **Step 4: Store raw evidence and write validation/status docs**

The report must distinguish:

```text
GitHub CI -> TypeScript/host contracts + deterministic fixtures
external real validation -> discovered manager/router + production host + real HDSRC v0.10
```

Retain negative findings; do not claim generic provider discovery, remote transport, multi-tenant security, or canonical writeback.

- [ ] **Step 5: Run final branch regression**

```bash
npm install
npm run check
npm test
```

Expected: zero failures and only the existing Codex capability skip.

- [ ] **Step 6: Audit the final diff against authority boundaries**

The final branch diff must contain no unexpected changes under:

```text
packages/canvas-schema/
packages/mcp-contract/
packages/multimodal-agent-runtime/
.github/workflows/
```

No HDSRC process method matching `write|patch|mutat|register|replace|commit` may appear.

- [ ] **Step 7: Open PR, run final merge-head CI, review, and merge with expected head SHA**

PR evidence must include focused RED/GREEN runs, final test totals, real-runtime evidence SHA, and explicit non-goals. Do not merge until merge-head CI is green and review threads/comments contain no blocker.

- [ ] **Step 8: Verify post-merge `main` CI**

After squash merge, verify the `main` commit itself runs `npm install`, `npm run check`, and the complete test suite successfully. Record the exact merge SHA and Actions run in the final report.

## Execution Evidence Through Real-Runtime Validation

- Task 1 RED `33172019574`; GREEN `33172342769`.
- Task 2 RED `33172549219`; final clean GREEN `33173012053` (`229 / 228 PASS / 0 FAIL / 1 existing SKIP`).
- Task 3 RED `33173139671`; final clean GREEN `33173395676` (`233 / 232 PASS / 0 FAIL / 1 existing SKIP`).
- Task 4 RED `33173596307`; final clean GREEN `33174081729` (`242 / 241 PASS / 0 FAIL / 1 existing SKIP`).
- Task 5 RED `33174205525`; core GREEN `33174461081`; clean schema-inventory closure `33175052024` (`252 / 251 PASS / 0 FAIL / 1 existing SKIP`).
- Task 6 exact-source export run `33175331352`, integration source `85797f524ecb79546280065fa4b7f0f44e426ccf`, artifact ZIP SHA-256 `e821659a5b4cf39a73a841d9d537078c4c80122f1b678dd6561b7fc26e0c521c`.
- Task 6 real HDSRC v0.10 evidence replayed twice byte-for-byte; evidence SHA-256 `7f810af72aee6d165eb702a863542b871bca2883791e11e0ffd88105e5e990d7`.

Steps 5–8 remain intentionally unchecked until final branch regression, authority audit, PR/merge, and post-merge `main` CI actually complete.

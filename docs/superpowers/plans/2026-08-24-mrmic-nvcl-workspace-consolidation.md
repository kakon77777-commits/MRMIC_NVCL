# MRMIC／NVCL Workspace Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `D:\Ai\work together\MRMIC_NVCL` the single clean local checkout, retain one canonical UTF-8 theory set, remove four byte-identical mojibake aliases, add durable navigation/provenance checks, and synchronize the verified result to GitHub.

**Architecture:** Start from the approved Phase 12 `main` baseline and preserve code behavior. Treat `docs/theory/canonical/` as the only theory body authority, enforce its filenames and SHA-256 values with one repository test, and keep research archives outside Git. Regenerate release metadata only after the tree is final, then integrate through an expected-head GitHub PR and fast-forward the formal local `main`.

**Tech Stack:** Node.js 22.5+, npm 10, TypeScript 5.8, Node built-in test runner, PowerShell 7, Git, GitHub CLI.

**Spec:** `docs/superpowers/specs/2026-08-24-mrmic-nvcl-workspace-consolidation-design.md`

## Global Constraints

- Formal local repository root is exactly `D:\Ai\work together\MRMIC_NVCL`.
- Starting source baseline is GitHub `main` commit `6606b54532c0f327206e7c021120370044b6e0ff`; the committed spec `d3f15a45c1b8b6fff2db2b1061789819a7a4869a` must travel with the implementation.
- External research sources, Phase 0–7 ZIP files, `.release-verification`, Provider credentials, local runtime state, `node_modules/`, and `dist/` are not imported.
- The five canonical theory bodies and their exact hashes are fixed by the spec.
- The four root-level mojibake Markdown aliases may be deleted only after their hashes match the canonical set.
- The fifth canonical paper, `視之基底系列_10_視之一般算子論_差異的場化位格化與回饋化_v1.0.md`, must remain.
- Unmerged Phase 13 branches are not adopted, merged, rebased, or rewritten.
- No real Provider A/B command is run; verification stays offline except Git/GitHub transport and CI.
- No force-push, direct `main` mutation, or manual hash editing is permitted.

---

### Task 1: Establish a green execution baseline

**Files:**
- Read: `package.json`
- Read: `scripts/verify-release.mjs`
- Read: `MANIFEST.json`

**Interfaces:**
- Consumes: approved spec commit `d3f15a45c1b8b6fff2db2b1061789819a7a4869a`
- Produces: a clean isolated implementation branch rooted in the spec commit, installed locked dependencies, and baseline command evidence

- [ ] **Step 1: Enter an isolated implementation worktree**

Use `superpowers:using-git-worktrees`. Create branch `agent/consolidate-workspace` from `agent/consolidation-spec`; do not branch from `main`, because the spec commit must be included.

- [ ] **Step 2: Confirm the exact ancestry and clean state**

Run:

```powershell
git merge-base --is-ancestor 6606b54532c0f327206e7c021120370044b6e0ff HEAD
if ($LASTEXITCODE -ne 0) { throw 'Phase 12 baseline is not an ancestor' }
git merge-base --is-ancestor d3f15a45c1b8b6fff2db2b1061789819a7a4869a HEAD
if ($LASTEXITCODE -ne 0) { throw 'approved spec is not an ancestor' }
git status --short --branch
```

Expected: both ancestry checks exit 0 and the worktree is clean.

- [ ] **Step 3: Install only locked dependencies**

Run:

```powershell
npm ci
```

Expected: installation succeeds from `package-lock.json`; no package file changes.

- [ ] **Step 4: Run the untouched baseline gates**

Run:

```powershell
npm run check
npm test
npm run release:verify
```

Expected: TypeScript check passes, 75/75 baseline tests pass, and the existing 267-entry Phase 12 manifest verifies.

---

### Task 2: Enforce and implement the canonical theory layout

**Files:**
- Create: `tests/workspace-layout.test.mjs`
- Create: `docs/INDEX.md`
- Create: `docs/theory/README.md`
- Create: `docs/provenance/THEORY_SOURCE_MAP.md`
- Modify: `README.md`
- Delete: the four root-level `docs/theory/0[1-4]_*.md` mojibake aliases after hash verification

**Interfaces:**
- Consumes: the five filenames and SHA-256 values from the approved spec
- Produces: one durable Node test named `canonical theory layout and documentation links remain valid`, one canonical theory body location, and three discoverable documentation entry points

- [ ] **Step 1: Write the failing layout test**

Create `tests/workspace-layout.test.mjs` with exactly this content:

```javascript
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const theoryRoot = resolve(root, 'docs/theory')
const canonicalRoot = resolve(theoryRoot, 'canonical')

const expectedTheory = new Map([
  ['原生符號繪圖假說_命題猜想論文_v1.0.md', 'b753b1c6594f47f8ea2acfc14f49fd086a2fb3d41461d413160ac7d2900e3be9'],
  ['原生視覺建構迴路_NVCL_命題猜想論文_v1.0.md', 'fc3883bb0d775422b4ffc9a00417edb3e0d9f6db13060f2503604530441ab045'],
  ['MCP原生遞歸多模態無限畫布_MRMIC_架構命題論文_v1.0.md', 'e572b7e1c912242acf8f23b83c4a082ee5a81a266ac0cf38a262a1666c97d8e5'],
  ['MRMIC_NVCL_MVP技術白皮書_v0.1.md', '7cdbebffa010497502b69c5661bf7e894451d261d41ee40c8d5fc641f5db2451'],
  ['視之基底系列_10_視之一般算子論_差異的場化位格化與回饋化_v1.0.md', '4fc1356435bda6a7ef4d5ca89585ed026b9319cbefc621c9ddbb36f21a7704d9'],
])

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

const assertLocalLinksExist = documentPath => {
  const markdown = readFileSync(documentPath, 'utf8')
  for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const href = match[1].trim().replace(/^<|>$/g, '')
    if (!href || href.startsWith('#') || /^[a-z]+:/i.test(href)) continue
    const path = href.split('#', 1)[0]
    assert.ok(existsSync(resolve(dirname(documentPath), path)), `${documentPath}: missing ${href}`)
  }
}

test('canonical theory layout and documentation links remain valid', () => {
  const canonicalMarkdown = new Set(
    readdirSync(canonicalRoot, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
      .map(entry => entry.name),
  )
  assert.deepEqual(canonicalMarkdown, new Set([...expectedTheory.keys(), 'README.md']))

  for (const [name, expectedHash] of expectedTheory) {
    assert.equal(sha256(resolve(canonicalRoot, name)), expectedHash, name)
  }

  const theoryRootMarkdown = readdirSync(theoryRoot, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
    .map(entry => entry.name)
    .sort()
  assert.deepEqual(theoryRootMarkdown, ['README.md'])

  for (const relative of [
    'README.md',
    'docs/INDEX.md',
    'docs/theory/README.md',
    'docs/theory/canonical/README.md',
    'docs/provenance/THEORY_SOURCE_MAP.md',
  ]) {
    const documentPath = resolve(root, relative)
    assert.ok(existsSync(documentPath), relative)
    assertLocalLinksExist(documentPath)
  }
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node --test tests/workspace-layout.test.mjs
```

Expected: FAIL because `docs/INDEX.md`, `docs/theory/README.md`, and `docs/provenance/THEORY_SOURCE_MAP.md` do not exist and the four root-level aliases remain.

- [ ] **Step 3: Reconfirm the four author-source files without modifying them**

Run:

```powershell
$sourceRoot = 'D:\我的研究\正在推進中\MRMIC／NVCL'
$expectedSource = @{
  '原生符號繪圖假說_命題猜想論文_v1.0.md' = 'b753b1c6594f47f8ea2acfc14f49fd086a2fb3d41461d413160ac7d2900e3be9'
  '原生視覺建構迴路_NVCL_命題猜想論文_v1.0.md' = 'fc3883bb0d775422b4ffc9a00417edb3e0d9f6db13060f2503604530441ab045'
  'MCP原生遞歸多模態無限畫布_MRMIC_架構命題論文_v1.0.md' = 'e572b7e1c912242acf8f23b83c4a082ee5a81a266ac0cf38a262a1666c97d8e5'
  'MRMIC_NVCL_MVP技術白皮書_v0.1.md' = '7cdbebffa010497502b69c5661bf7e894451d261d41ee40c8d5fc641f5db2451'
}
foreach ($entry in $expectedSource.GetEnumerator()) {
  $sourcePath = Join-Path $sourceRoot $entry.Key
  $canonicalPath = Join-Path 'docs/theory/canonical' $entry.Key
  $sourceHash = (Get-FileHash -LiteralPath $sourcePath -Algorithm SHA256).Hash.ToLowerInvariant()
  $canonicalHash = (Get-FileHash -LiteralPath $canonicalPath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $entry.Value -or $canonicalHash -ne $entry.Value) {
    throw "theory source drift: $($entry.Key) source=$sourceHash canonical=$canonicalHash"
  }
  Write-Output "$sourceHash  $($entry.Key)"
}
```

Expected: four filename/hash pairs match both locations. This command is read-only for the author-source directory.

- [ ] **Step 4: Prove aliases are byte-identical before deletion**

Run:

```powershell
$expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
@(
  'b753b1c6594f47f8ea2acfc14f49fd086a2fb3d41461d413160ac7d2900e3be9',
  'fc3883bb0d775422b4ffc9a00417edb3e0d9f6db13060f2503604530441ab045',
  'e572b7e1c912242acf8f23b83c4a082ee5a81a266ac0cf38a262a1666c97d8e5',
  '7cdbebffa010497502b69c5661bf7e894451d261d41ee40c8d5fc641f5db2451'
) | ForEach-Object { [void]$expected.Add($_) }
$legacy = @(Get-ChildItem -LiteralPath 'docs/theory' -File -Filter '*.md' | Where-Object Name -Match '^0[1-4]_')
if ($legacy.Count -ne 4) { throw "expected four legacy theory aliases, found $($legacy.Count)" }
foreach ($file in $legacy) {
  $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $expected.Contains($hash)) { throw "noncanonical legacy hash: $($file.Name) $hash" }
  Write-Output "$hash  $($file.Name)"
}
```

Expected: exactly four paths, each with one approved canonical hash.

- [ ] **Step 5: Remove only the verified aliases**

Run in the same PowerShell process after Step 3 verification:

```powershell
$rootPath = (Get-Location).Path
foreach ($file in $legacy) {
  $relative = $file.FullName.Substring($rootPath.Length + 1)
  git rm -- $relative
  if ($LASTEXITCODE -ne 0) { throw "git rm failed: $relative" }
}
```

Expected: four staged deletions; every file under `docs/theory/canonical/` remains unchanged.

- [ ] **Step 6: Create the documentation index**

Create `docs/INDEX.md`:

```markdown
# MRMIC／NVCL 文件索引

## 理論權威

- [Canonical theory sources](theory/README.md)
- [Theory source map](provenance/THEORY_SOURCE_MAP.md)

## 架構與契約

- [Architecture](ARCHITECTURE.md)
- [Multimodal Lab contract](MULTIMODAL_LAB_CONTRACT.md)
- [NVCL Runtime contract](NVCL_RUNTIME_CONTRACT.md)
- [Recursive Runtime contract](RECURSIVE_RUNTIME_CONTRACT.md)
- [MCP compatibility](MCP_COMPATIBILITY.md)

## Phase 12 目前狀態

- [Phase 12 status report](PHASE12_STATUS_REPORT.md)
- [Hybrid transient policy](HYBRID_TRANSIENT_POLICY.md)
- [Real Provider A/B](REAL_PROVIDER_AB.md)
- [Next phase boundary](NEXT_PHASE.md)

## 設計決策

ADR-001 至 ADR-012 位於本目錄，依編號記錄 SVG adapter、同步、MCP、NVCL、遞歸畫布、恢復、Lab、像素原生代理、Governor、Passive Timeline、Policy A/B 與 Phase 12 hybrid／Provider A/B。

## 驗收與證據

- [MVP acceptance matrix](MVP_ACCEPTANCE_MATRIX.md)
- 發布 manifest：[`../MANIFEST.json`](../MANIFEST.json)
- 發布雜湊：[`../SHA256SUMS.txt`](../SHA256SUMS.txt)
- 有界實驗證據位於 [`../artifacts/`](../artifacts/)
```

- [ ] **Step 7: Create the canonical theory guide**

Create `docs/theory/README.md`:

```markdown
# MRMIC／NVCL 理論入口

`canonical/` 是正式工作樹中唯一的理論全文權威位置。根目錄不保留亂碼檔名、byte-identical 相容複本；舊路徑仍可由 Git 歷史追溯。

建議閱讀順序：

1. [原生符號繪圖假說](canonical/原生符號繪圖假說_命題猜想論文_v1.0.md)
2. [原生視覺建構迴路](canonical/原生視覺建構迴路_NVCL_命題猜想論文_v1.0.md)
3. [MCP 原生遞歸多模態無限畫布](canonical/MCP原生遞歸多模態無限畫布_MRMIC_架構命題論文_v1.0.md)
4. [MRMIC／NVCL MVP 技術白皮書](canonical/MRMIC_NVCL_MVP技術白皮書_v0.1.md)
5. [視之一般算子論](canonical/視之基底系列_10_視之一般算子論_差異的場化位格化與回饋化_v1.0.md)

理論文件提出可檢驗命題與架構方向；目前 Runtime 能力、測試結果與非宣稱邊界以 [`../PHASE12_STATUS_REPORT.md`](../PHASE12_STATUS_REPORT.md) 和 [`../NEXT_PHASE.md`](../NEXT_PHASE.md) 為準。理論敘述不會自動成為已實作或已驗證的產品能力。
```

- [ ] **Step 8: Create the public provenance map**

Create `docs/provenance/THEORY_SOURCE_MAP.md`:

```markdown
# Canonical Theory Source Map

日期：2026-08-24

外部作者研究母本在正式 Git checkout 之外保持唯讀。本儲存庫只保存下列 canonical UTF-8 全文；不公開私人絕對路徑，也不匯入 Phase ZIP 或驗證暫存。

| Canonical file | SHA-256 | Verification |
| --- | --- | --- |
| `原生符號繪圖假說_命題猜想論文_v1.0.md` | `b753b1c6594f47f8ea2acfc14f49fd086a2fb3d41461d413160ac7d2900e3be9` | byte-identical to author source |
| `原生視覺建構迴路_NVCL_命題猜想論文_v1.0.md` | `fc3883bb0d775422b4ffc9a00417edb3e0d9f6db13060f2503604530441ab045` | byte-identical to author source |
| `MCP原生遞歸多模態無限畫布_MRMIC_架構命題論文_v1.0.md` | `e572b7e1c912242acf8f23b83c4a082ee5a81a266ac0cf38a262a1666c97d8e5` | byte-identical to author source |
| `MRMIC_NVCL_MVP技術白皮書_v0.1.md` | `7cdbebffa010497502b69c5661bf7e894451d261d41ee40c8d5fc641f5db2451` | byte-identical to author source |
| `視之基底系列_10_視之一般算子論_差異的場化位格化與回饋化_v1.0.md` | `4fc1356435bda6a7ef4d5ca89585ed026b9319cbefc621c9ddbb36f21a7704d9` | retained canonical source |

四個舊亂碼檔名檔案與前四篇 canonical 全文 byte-identical，已從當前工作樹移除。Git 歷史保留其來源；`MANIFEST.json` 與 `SHA256SUMS.txt` 描述整理後的目前樹。
```

- [ ] **Step 9: Add the formal workspace entry to the root README**

Insert this section after the Phase 0–11 preservation paragraph in `README.md`:

```markdown
## 正式工作區與文件入口

正式本機 checkout 是 `D:\Ai\work together\MRMIC_NVCL`；GitHub `main` 是程式碼與工程文件的同步權威。外部研究母本與 Phase ZIP 不會鏡像進儲存庫。

- [文件總索引](docs/INDEX.md)
- [Canonical 理論入口](docs/theory/README.md)
- [理論來源與 SHA-256](docs/provenance/THEORY_SOURCE_MAP.md)

`docs/theory/canonical/` 保存唯一正式理論全文。未合併的 Phase 13 遠端分支是候選資料，不代表目前 `main` 或已驗收能力。
```

- [ ] **Step 10: Run the focused test and verify GREEN**

Run:

```powershell
node --test tests/workspace-layout.test.mjs
```

Expected: one test passes, all five hashes match, only `docs/theory/README.md` remains at the theory root, and all local Markdown links resolve.

- [ ] **Step 11: Run the full code gates**

Run:

```powershell
npm run check
npm test
```

Expected: TypeScript check passes and the complete suite reports 76/76 tests.

- [ ] **Step 12: Commit the canonical workspace layout**

Run:

```powershell
git add README.md docs tests/workspace-layout.test.mjs
git commit -m "docs: consolidate canonical theory workspace"
```

---

### Task 3: Refresh release metadata against the organized tree

**Files:**
- Modify: `scripts/release-manifest.mjs`
- Modify: `README.md`
- Regenerate: `MANIFEST.json`
- Regenerate: `SHA256SUMS.txt`

**Interfaces:**
- Consumes: the Task 2 tree and its 76-test acceptance result
- Produces: a self-consistent Phase 12 release manifest and SHA list with no removed legacy paths

- [ ] **Step 1: Update current test-count claims**

In `scripts/release-manifest.mjs`, replace:

```javascript
automatedTests: { total: 75, passed: 75, failed: 0 },
```

with:

```javascript
automatedTests: { total: 76, passed: 76, failed: 0 },
```

In the root `README.md` current acceptance summary, replace `75/75` with `76/76`. Do not rewrite historical Phase reports.

- [ ] **Step 2: Prove the suite count before publishing it**

Run:

```powershell
npm test
```

Expected: summary reports 76 tests, 76 passed, 0 failed.

- [ ] **Step 3: Run the offline Phase 12 demo**

Run:

```powershell
npm run phase12:demo
```

Expected: demo exits 0 and does not request `MRMIC_REAL_PROVIDER_AB`, credentials, or a confirmation flag.

- [ ] **Step 4: Regenerate release metadata last**

Run:

```powershell
npm run release:manifest
npm run release:verify
```

Expected: manifest generation reports its new file count, then verification passes for every entry.

- [ ] **Step 5: Verify removed aliases cannot leak into release metadata**

Run:

```powershell
$legacy = @(git -c core.quotepath=false ls-files 'docs/theory/*.md' | Where-Object { $_ -match '/0[1-4]_' })
if ($legacy.Count -ne 0) { throw "legacy theory aliases remain: $($legacy -join ', ')" }
$manifestLegacy = @(Select-String -LiteralPath MANIFEST.json,SHA256SUMS.txt -Pattern 'docs/theory/0[1-4]_' -AllMatches)
if ($manifestLegacy.Count -ne 0) { throw 'legacy theory aliases remain in release metadata' }
$manifest = Get-Content -LiteralPath MANIFEST.json -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.fileCount -ne $manifest.files.Count) { throw 'manifest fileCount mismatch' }
Write-Output "verified_manifest_entries=$($manifest.fileCount)"
```

Expected: no legacy path output and `fileCount === files.length`.

- [ ] **Step 6: Commit the refreshed release evidence**

Run:

```powershell
git add README.md scripts/release-manifest.mjs MANIFEST.json SHA256SUMS.txt
git commit -m "chore: refresh organized Phase 12 manifest"
```

---

### Task 4: Run final acceptance and FCAO deterministic closure audit

**Files:**
- Verify: complete repository tree
- Verify: `docs/superpowers/specs/2026-08-24-mrmic-nvcl-workspace-consolidation-design.md`
- Verify: `docs/superpowers/plans/2026-08-24-mrmic-nvcl-workspace-consolidation.md`

**Interfaces:**
- Consumes: Task 2 and Task 3 commits
- Produces: exact-head local acceptance, APR evidence sufficiency, and a deterministic FCAO Twin decision before GitHub integration

- [ ] **Step 1: Run all required local gates on the exact HEAD**

Run:

```powershell
npm ci
npm run check
npm test
npm run phase12:demo
npm run release:verify
git diff --check
git status --short --branch
```

Expected: every command exits 0; 76/76 tests pass; worktree is clean and only ahead of its upstream.

- [ ] **Step 2: Recompute all canonical theory hashes independently**

Run:

```powershell
Get-ChildItem -LiteralPath 'docs/theory/canonical' -File -Filter '*.md' |
  Where-Object Name -ne 'README.md' |
  Sort-Object Name |
  ForEach-Object {
    "$((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())  $($_.Name)"
  }
```

Expected: the five filename/hash pairs match the spec exactly.

- [ ] **Step 3: Run the FCAO deterministic Twin and APR evidence audit**

Do not spawn a reviewer Agent. Verify the exact change surface and fail closed:

```powershell
$base = '6606b54532c0f327206e7c021120370044b6e0ff'
$changed = @(git -c core.quotepath=false diff --name-only "$base..HEAD")
$allowed = @(
  'README.md',
  'MANIFEST.json',
  'SHA256SUMS.txt',
  'scripts/release-manifest.mjs',
  'tests/workspace-layout.test.mjs'
)
$unexpected = @($changed | Where-Object {
  $_ -notin $allowed -and
  $_ -notlike 'docs/*'
})
if ($unexpected.Count) { throw "unexpected change surface: $($unexpected -join ', ')" }
$forbidden = @($changed | Where-Object {
  $_ -match '(^|/)(node_modules|dist|\.release-verification)(/|$)' -or $_ -match '\.zip$'
})
if ($forbidden.Count) { throw "forbidden imported paths: $($forbidden -join ', ')" }
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) { throw 'origin/main is not an ancestor of audited HEAD' }
Write-Output "fcao_twin_change_surface=pass files=$($changed.Count)"
Write-Output 'apr_evidence_gate=pass tests=76 manifest=verified theory_hashes=5/5'
Write-Output 'fcao_twin_decision=CONCUR reason=all-mandatory-evidence-satisfied'
```

Append the exact audit evidence and `CONCUR` decision to the existing local FCAO world database. If any command fails, append `CHALLENGE`, keep closure open, and return to the failing task without GitHub integration.

---

### Task 5: Synchronize GitHub and the formal local main

**Files:**
- Integrate: `agent/consolidate-workspace` into GitHub `main`
- Final local state: `D:\Ai\work together\MRMIC_NVCL` on clean `main`

**Interfaces:**
- Consumes: independently reviewed exact-head branch from Task 4
- Produces: merged GitHub PR, green CI, local `main === origin/main`, and a clean formal checkout

- [ ] **Step 1: Fetch and reject unexpected main drift**

Run:

```powershell
git fetch origin main
$base = git merge-base HEAD origin/main
git merge-base --is-ancestor origin/main HEAD
if ($LASTEXITCODE -ne 0) {
  Write-Output "merge_base=$base"
  throw 'origin/main advanced outside this branch; inspect before integration'
}
```

Expected: current `origin/main` remains an ancestor. If not, stop and inspect; never force-push.

- [ ] **Step 2: Push the implementation branch and create a Draft PR**

Run:

```powershell
git push -u origin agent/consolidate-workspace
$headSha = git rev-parse HEAD
$prBody = @"
## Summary
- establish the formal MRMIC/NVCL workspace and canonical theory authority
- remove four verified byte-identical mojibake aliases
- add durable theory layout and documentation-link validation
- refresh Phase 12 release manifest and SHA sums

## Verification
- canonical theory hashes: verified against the approved five-file map
- tests: 76/76
- TypeScript check: passed
- Phase 12 offline demo: passed
- release manifest: verified
- FCAO deterministic Twin closure audit: CONCUR

## Exclusions
No Phase ZIP, external verification scratch, credentials, real Provider calls, or unmerged Phase 13 content was imported.

Reviewed head: $headSha
"@
$prUrl = gh pr create --draft --base main --head agent/consolidate-workspace --title "Consolidate the formal MRMIC NVCL workspace" --body $prBody
Write-Output $prUrl
```

The PR body must list the five canonical hashes, four deleted aliases, actual test count, manifest file count, Phase 12 demo result, release verification result, exclusions, and FCAO deterministic Twin audit outcome.

- [ ] **Step 3: Wait for GitHub CI and merge only the tested head**

Run:

```powershell
$pr = gh pr view agent/consolidate-workspace --json number,headRefOid,state | ConvertFrom-Json
if ($pr.headRefOid -ne (git rev-parse HEAD)) { throw 'remote PR head does not match reviewed local HEAD' }
gh pr checks $pr.number --watch --interval 10
if ($LASTEXITCODE -ne 0) { throw 'GitHub CI failed' }
gh pr ready $pr.number
gh pr merge $pr.number --merge --match-head-commit $pr.headRefOid
```

Expected: CI is green and the merge command accepts the exact reviewed head SHA.

- [ ] **Step 4: Fast-forward the formal local checkout**

From `D:\Ai\work together\MRMIC_NVCL` after leaving/removing the implementation worktree safely:

```powershell
git switch main
git fetch origin main
git merge --ff-only origin/main
npm run release:verify
git status --short --branch
```

Expected: local `main` and `origin/main` are the same commit, release verification passes, and status is clean.

- [ ] **Step 5: Report exact completion evidence**

Report:

- local and remote final merge commit
- GitHub PR URL
- 76/76 test result
- Phase 12 demo result
- release manifest file count and verification result
- five canonical SHA-256 values
- confirmation that four mojibake aliases, ZIPs, `.release-verification`, credentials, and Phase 13 candidates were not imported

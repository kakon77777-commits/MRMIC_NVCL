# Opt-In Real Provider A/B

Status: Completed controlled acceptance
Version: `0.13.0`
Provider: local Codex Account App Server
Model selected by capability probe: `gpt-5.6-sol`

## Question

For the same five-frame synthetic visual trace, does `governor_roi` reduce real account-backed Provider calls, Token telemetry and latency without reducing the tested circle-color classification accuracy?

## Protocol

Each policy runs in an isolated in-memory Lab and receives the same source sequence:

```text
initial red
static red
transient amber
restored red
settled red
```

An independent full-PNG audit lane hashes every source sample. The expected color is kept in the trusted evaluator and is never sent to the Provider. Provider input contains only delivered PNG pixels, dimensions and a bounded classification task. Provider output is restricted to color enum, visibility, confidence and summary; object identifier fields fail closed.

The Provider cannot authorize actions. Two reversible restyles are executed by the trusted runner and require Freshness and Transition Guard evidence.

## Authorization

Real inference is absent from normal tests and MCP. The CLI requires all of:

1. exact environment acknowledgement `I_UNDERSTAND_THIS_USES_CODEX_ACCOUNT_CAPACITY`;
2. `--confirm-real-provider-ab`;
3. exact `--max-provider-calls=8`;
4. a positive `--max-total-tokens` continuation threshold.

The Token threshold is checked before each subsequent call. Because the cost of the next call is not known beforehand, it is not a strict final-total cap. A completed call may move the cumulative total above the threshold; no later call will then be sent.

## Result

The completed run used no API key or API-credit path.

| Metric | always_full | governor_roi | Difference |
|---|---:|---:|---:|
| samples | 5 | 5 | 0 |
| Provider calls | 5 | 3 | -2 |
| semantic accuracy | 5/5 | 3/3 | both 100% |
| delivered PNG bytes | 278,526 | 63,490 | -77.2050% |
| input Tokens | 103,009 | 57,556 | -45,453 (-44.1253%) |
| cached input Tokens | 0 | 15,104 | +15,104 |
| total Tokens | 104,313 | 58,010 | -46,303 (-44.3885%) |
| Provider latency | 62,978 ms | 29,568 ms | -33,410 ms (-53.0503%) |
| Freshness | 2/2 | 2/2 | pass |
| Transition Guard | 2/2 | 2/2 | pass |

Source-trace SHA and action-plan SHA matched across arms. Total run usage was 162,323 Tokens across 8 calls. The authorized continuation threshold was 150,000; the eighth call began below that threshold and completed above it, demonstrating the boundary described above.

Canonical evidence: `artifacts/phase12-real-provider-ab.json`.

## First-attempt finding

The first run used a 50,000 continuation threshold and stopped before another call. It exposed that the CLI previously wrote evidence only after both arms completed. Phase 12 therefore added per-sample atomic checkpoints and ABORTED artifacts before rerunning. The first attempt's exact partial telemetry cannot be reconstructed and is not claimed.

Evidence: `artifacts/phase12-real-provider-ab-attempt1.json`.

## Reproduction

Probe only, zero inference:

```powershell
npm run phase12:probe
```

Explicit real run:

```powershell
$env:MRMIC_REAL_PROVIDER_AB='I_UNDERSTAND_THIS_USES_CODEX_ACCOUNT_CAPACITY'
npm run phase12:codex-ab -- --confirm-real-provider-ab --max-provider-calls=8 --max-total-tokens=200000
Remove-Item Env:MRMIC_REAL_PROVIDER_AB
```

The 200,000 example is based only on this observed eight-call fixture and is not a universal cost estimate.

## Non-claims

The result does not prove arbitrary image/video understanding, game-play competence, cross-model equivalence, stable future model pricing, or production security. App Server protocol and account model availability remain local-version capabilities and are probed instead of hardcoded.

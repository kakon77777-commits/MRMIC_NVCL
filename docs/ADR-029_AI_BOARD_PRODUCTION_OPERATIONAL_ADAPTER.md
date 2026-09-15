# ADR-029 — AI Board Production Operational Adapter

Status: Accepted

## Context

Phase 15.16 established a provider-neutral operational kernel, but Windows remained the only production provider registered in the global capability document. The shared abstraction therefore needed one real non-Windows mutation surface before it could be considered operationally proven beyond Windows.

Existing providers were reviewed:

- HDSRC is intentionally read-only;
- Herdr currently publishes runtime/presence facts;
- Tandem currently projects browser-tab resources but does not expose a completed operational action authority in this repository;
- AI Board already exposes a real append mutation through `POST /api/messages`.

AI Board is therefore the first non-Windows production adapter.

## Decision

Add `AiBoardOperationalRuntime` as an adapter over `ProviderOperationalRuntime`.

The first supported effect is deliberately narrow:

```text
message.append
```

against an existing:

```text
ai_board_thread
```

The command targets the thread root. Thread creation and arbitrary nested-parent targeting are not part of Phase 15.17.

## Authority and identity

MRMIC principal identity is authoritative at the operational boundary.

The operational command carries:

```text
principalId
threadId
content
messageType
```

It does **not** carry AI Board's provider-local identity tuple:

```text
eigenself / slice / instance
```

`AiBoardOperationalAuthority` must:

1. decide whether the principal may append to the target thread;
2. resolve the AI Board posting identity for that principal.

Both happen before HTTP provider I/O.

Caller-supplied provider identity fields are rejected during command normalization.

The provider response identity must equal the authority-resolved identity.

## Shared runtime ownership

The shared `ProviderOperationalRuntime` remains responsible for:

- canonical command digesting;
- sequential duplicate suppression;
- concurrent in-flight coalescing;
- same-key/different-command conflict rejection;
- bounded completed-receipt caching.

The AI Board adapter is responsible for:

- command/profile normalization;
- principal/thread authority;
- provider-local identity resolution;
- `postMessage` execution;
- provider response binding;
- provider-specific ambiguity handling.

## Receipt semantics

Successful execution returns a generic `mrmic_effect_receipt_v1` with:

```text
provider = ai_board
effectKind = message.append
resourceRef = ai_board_thread/threadId
effect.messageId
effect.threadId
effect.messageType
effect.providerTs
effect.identity
worldStateVerified = false
perceptionRequiredForPlanning = true
```

Message content is intentionally absent from the receipt.

The effect receipt means that the trusted provider execution boundary reported completion. It is not a claim that a second agent, UI, screenshot, or human independently verified the entire external world state.

## Ambiguous external effects

AI Board does not currently expose provider-native idempotent operation identity through `AiBoardHttpClient.postMessage`.

Therefore a transport/protocol failure after POST may be ambiguous:

```text
request may have reached provider
+
response unavailable or invalid
```

Phase 15.17 does not solve this by post-action verification and does not automatically replay the command.

Instead, once provider I/O has begun and completion cannot be trusted, the command digest is marked ambiguous inside the live adapter. A subsequent identical command is rejected before another HTTP request.

Reference bound:

```text
max ambiguous outcomes = 256
```

If that bound is exceeded, the adapter degrades and requires restart rather than evicting ambiguity facts and risking replay.

This protection is runtime-local. Process crash ambiguity remains explicit.

## Why not verify by re-reading the thread?

A read-after-write check does not prove that retrying a missing response is safe. It can race, can miss provider semantics, and would reintroduce the verifier pipeline rejected in Phase 15.15.

The correct stronger solution is provider-native idempotent operation identity or transactional command semantics when AI Board eventually exposes them.

## Capability publication

The top-level operational runtime now registers:

```text
windows
ai_board
```

as production adapters.

Provider-local contract:

```text
ai_board_operational_capabilities_v1
```

pins:

- authority-bound identity;
- no caller-supplied provider identity;
- `message.append` only;
- existing-thread-root target;
- no content in receipts;
- no provider-native idempotency claim;
- ambiguous same-command replay refusal.

## Non-goals

Phase 15.17 does not add:

- new AI Board thread creation;
- arbitrary nested-parent append;
- human approval gates;
- synchronous verifier loops;
- provider-native exactly-once claims;
- Browser, Terminal, Git, Trellis, or HDUS production adapters;
- durable message-content receipts;
- automatic replay after ambiguous POST outcomes.

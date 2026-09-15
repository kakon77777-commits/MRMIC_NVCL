# ADR-027 — AI-Native Operational Runtime Uses Effect Receipts, Not Synchronous Post-Action Verification

Status: Accepted for Phase 15.15 stacked PR.

## Context

Phase 15.13 added a useful conformance harness that executes a semantic Windows UIA action and then proves two development-time postconditions: a fresh UIA semantic state and a changed WGC visual frame. That harness is valuable for testing the implementation, but it is the wrong production runtime model for autonomous AI.

A production agent must not stop after every action to run a separate verifier pipeline, ask another AI to approve the action, or require a human to confirm ordinary runtime progress. UIA and WGC are already perception channels. They should feed the next planning cycle continuously rather than be promoted into a mandatory synchronous judge after every effect.

Trellis provides the relevant architectural pattern: authority and command acceptance produce authoritative receipts/events, while projections are read models. Correctness is primarily enforced by authority, atomic/idempotent transition semantics where possible, canonical identity, and receipts—not by repeatedly asking presentation surfaces to certify each write.

Windows UI effects differ from a Trellis database event: an external UIA action cannot currently be atomically committed with a durable MRMIC receipt. Phase 15.15 therefore adopts the same *shape* without overclaiming exactly-once guarantees across crashes.

## Decision

The production reference path is:

```text
AI Intent
  -> Authority / capability
  -> generation-bound live control lease
  -> semantic command
  -> provider effect
  -> effect receipt
  -> continuous UIA / WGC perception
  -> next AI decision
```

The production path is **not**:

```text
semantic action
  -> UIA postcondition verifier
  -> WGC postcondition verifier
  -> verifier approval
  -> continue
```

### Command contract

`windows_operational_command_v1` carries:

- command id;
- idempotency key;
- portal/resource/principal identity;
- one bounded semantic UIA action.

The command value for `set_value` is transient execution input. It is included in the command digest but is not copied into effect receipts.

### Effect receipt contract

`windows_effect_receipt_v1` records:

- completed provider effect;
- command/idempotency identity and SHA-256 command digest;
- portal/resource/principal identity;
- exact control generation;
- bounded action identity;
- provider completion timestamp;
- whether the receipt was returned from runtime-local deduplication.

The receipt explicitly carries:

```text
worldStateVerified = false
perceptionRequiredForPlanning = true
```

A receipt means: **the authorized provider effect completed according to the trusted execution boundary**.

It does not mean: **a second observer proved the whole external world now satisfies an intended semantic goal**.

### Perception remains independent

UIA and WGC continue to run as semantic and visual perception channels. An agent may naturally observe the result on its next perception/planning cycle and react to unexpected state. This is normal agent operation, not a mandatory verifier gate.

### Runtime-local idempotency

`WindowsOperationalRuntime` deduplicates sequential and concurrent commands by `idempotencyKey + commandDigest` within one live runtime instance.

- same key + same digest: one provider effect, repeat callers receive the same effect receipt;
- same key + different digest: fail closed before another provider effect;
- failed provider effect: no completed receipt is cached.

The reference receipt cache is bounded to 256 entries.

This is **not crash-safe exactly-once** for external Windows UI effects. A process crash after the native effect but before the receipt is cached leaves an ambiguity that cannot be solved by inventing a post-action verifier. Future stronger guarantees require a provider-level transactional/idempotent operation identity, not more screenshot checks.

### Human participation

MRMIC does not add a human approval/login gate to ordinary AI-native command execution. External applications may independently require MFA, user presence, legal consent, or other authority; those are external policy constraints, not a generic MRMIC verification stage.

### Conformance harness boundary

Phase 15.13 remains valuable for development, conformance, regression and provider debugging. It has **no runtime authority** and is not called by `WindowsOperationalRuntime`.

## Consequences

Positive:

- agent loop remains autonomous and continuous;
- perception is not confused with execution authority;
- command retry semantics improve without redoing non-idempotent UIA actions in one live runtime;
- effect evidence is small and value-minimized;
- Trellis-style command/receipt semantics become reusable across providers.

Trade-offs:

- effect receipts do not prove high-level task success;
- crash ambiguity remains for external effects without provider transaction support;
- agent planning must handle reality diverging from prediction through normal future perception.

## Non-goals

Phase 15.15 does not add:

- another verifier AI;
- mandatory UIA+WGC post-action checks;
- human confirmation for ordinary commands;
- crash-safe exactly-once external effects;
- raw keyboard/pointer injection;
- durable screenshot or UIA value history;
- HDUS-complete operational semantics.

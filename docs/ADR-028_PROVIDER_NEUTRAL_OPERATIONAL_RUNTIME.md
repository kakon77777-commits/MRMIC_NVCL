# ADR-028 — Provider-Neutral Operational Runtime

Status: Accepted for Phase 15.16

## Context

Phase 15.15 corrected MRMIC away from synchronous post-action verifier pipelines and introduced the first AI-native command/effect loop for Windows:

```text
Intent
-> Authority
-> generation-bound control lease
-> semantic command
-> provider effect
-> effect receipt
-> continuous perception
-> next decision
```

That first implementation intentionally lived in `@mrmic/provider-windows` so the architectural correction could be proven without prematurely generalizing every provider.

The idempotency machinery inside that implementation, however, is not a Windows concern. Canonical command digesting, same-key conflict detection, concurrent in-flight coalescing, bounded completed-receipt caching and retry-after-failure behavior are provider-neutral operational semantics.

Leaving those mechanics inside each provider would produce divergent command semantics for Browser, Terminal, Git, Trellis, HDUS and future resource types.

## Decision

Phase 15.16 introduces a provider-neutral module at:

```text
packages/operational-runtime/src/index.ts
```

The shared core owns only:

- deterministic canonical command digesting;
- runtime-instance idempotency;
- same-key/different-command conflict rejection;
- concurrent duplicate coalescing;
- failed-effect retry semantics;
- bounded LRU completed-receipt caching.

Providers own:

- command normalization;
- authority and resource-specific preconditions;
- effect execution;
- provider-specific receipt details;
- any stronger transactional/idempotent guarantees they can actually provide.

The shared core deliberately imports no Windows, UIA, WGC, Canvas renderer, observer compositor or verifier surface.

## Contracts

Phase 15.16 adds generic envelope contracts:

```text
mrmic_operational_command_v1
mrmic_effect_receipt_v1
```

These contracts define the common AI-native command/effect vocabulary for future adapters. Provider-specific contracts may remain stricter supersets/adapters when they need resource-specific fields.

`mrmic_effect_receipt_v1` preserves the Phase 15.15 epistemic boundary:

```text
worldStateVerified = false
perceptionRequiredForPlanning = true
```

An effect receipt records trusted execution completion. It does not claim that presentation/perception layers synchronously proved the entire external world satisfies a higher-level task goal.

## Windows migration

`WindowsOperationalRuntime` becomes an adapter over `ProviderOperationalRuntime`.

Windows keeps:

- `windows_operational_command_v1`;
- `windows_effect_receipt_v1`;
- UIA semantic action normalization;
- generation-bound `WindowsUiaControlledAccess` execution;
- Windows-specific receipt fields.

Windows no longer owns a separate completed-receipt map, pending-command map or canonical digest implementation.

## Provider-neutral proof

The conformance suite includes a synthetic `terminal` provider that uses no Windows/UIA/WGC code and proves:

- sequential deduplication;
- concurrent in-flight deduplication;
- idempotency conflict rejection;
- failed-effect retry;
- bounded LRU receipt caching;
- canonical digest stability.

This prevents the abstraction from being a renamed Windows implementation.

## Idempotency boundary

The shared runtime guarantee remains:

```text
scope = live runtime instance
```

It does not claim crash-safe exactly-once semantics for external side effects.

A provider may advertise a stronger guarantee only if it owns a real transactional or durable idempotent operation protocol. Trellis-like canonical transaction semantics are therefore compatible with this layer, but are not fabricated by it.

## Perception boundary

Perception remains independent from operational execution:

```text
Provider effect receipt
!=
world-state proof
```

UIA, WGC, DOM, terminal output, Git state, API reads, or future HDUS observations feed the agent's next planning cycle. They are not automatically inserted as synchronous approval gates after every effect.

## Consequences

Positive:

- all future providers can share one idempotency model;
- provider adapters stay small and domain-specific;
- AI-native command/effect semantics stop being Windows-shaped;
- operational runtime remains separate from perception and validation harnesses;
- stronger provider-native transaction semantics can be layered without changing the common loop.

Tradeoffs:

- generic envelopes intentionally cannot encode every provider-specific invariant;
- crash ambiguity still exists for providers without durable idempotent effects;
- providers must implement adapter normalization and receipt construction correctly.

## Non-goals

Phase 15.16 does not add:

- Browser/Terminal/Git production adapters;
- a generic verifier agent;
- synchronous post-action perception checks;
- human approval gates;
- distributed exactly-once consensus;
- raw keyboard/pointer injection;
- durable world-state certification.

# Phase 15.16 — Provider-Neutral Operational Runtime

Status: staging implementation.

## Goal

Move AI-native command/effect mechanics out of the Windows provider and into a provider-neutral MRMIC operational layer.

The production loop remains:

```text
AI Intent
-> Authority / capability
-> provider/resource authority
-> operational command
-> provider effect
-> effect receipt
-> continuous perception
-> next AI decision
```

No verifier agent, screenshot confirmation, human approval, or synchronous perception gate is inserted into the common runtime.

## Provider-neutral module

Phase 15.16 adds:

```text
packages/operational-runtime/src/index.ts
```

`ProviderOperationalRuntime<TCommand,TReceipt>` owns only common execution mechanics:

- canonical command digest;
- runtime-instance idempotency;
- sequential deduplication;
- concurrent in-flight coalescing;
- same-key/different-command conflict rejection;
- failed-effect retry;
- bounded LRU completed-receipt cache.

Reference cache limit remains 256 and adapters may choose a lower bound.

## Provider adapter contract

Each provider supplies:

```text
normalize(command)
digestValue(command)
execute(command, commandDigest)
markDeduplicated(receipt)
```

The adapter therefore remains authoritative for provider-specific:

- command shape;
- resource binding;
- authorization/control preconditions;
- actual external effect;
- receipt detail.

The common runtime never guesses provider semantics.

## Generic envelopes

New provider-neutral contracts:

```text
mrmic_operational_command_v1
mrmic_effect_receipt_v1
```

The generic command envelope carries:

```text
commandId
idempotencyKey
provider
effectKind
principalId
resourceRef
payload
```

The generic effect receipt carries:

```text
provider
effectKind
command identity + digest
principalId
resourceRef
effect summary
completedAt
deduplicated
worldStateVerified=false
perceptionRequiredForPlanning=true
```

These are common vocabulary, not a demand that every provider discard stricter provider-specific schemas.

## Windows adapter

`WindowsOperationalRuntime` now delegates its idempotency engine to `ProviderOperationalRuntime`.

Windows still owns:

```text
windows_operational_command_v1
windows_effect_receipt_v1
UIA semantic action validation
WindowsUiaControlledAccess
generation-bound control authority
Windows-specific effect receipt fields
```

It no longer owns duplicated maps/digest/cache logic.

## Non-Windows proof

A synthetic `terminal` adapter is part of the portable conformance suite.

It proves the shared runtime can execute and deduplicate effects without importing or constructing:

- Windows resources;
- HWND;
- UI Automation;
- Windows.Graphics.Capture;
- observer compositor;
- renderer/verifier surfaces.

This makes provider-neutrality an executable property rather than a naming claim.

## Perception remains independent

The shared runtime does not perform post-action observation.

For future providers:

```text
Browser: DOM / accessibility / visual observation
Terminal: stdout/stderr/process state
Git: repository/ref/index state
Trellis: canonical event/read model
Windows: UIA/WGC
HDUS: future world-state observation
```

all remain perception/read channels consumed by the AI's next decision cycle.

## Idempotency strength

Default guarantee:

```text
runtime-instance deduplication
```

This prevents duplicate effects caused by repeated/concurrent commands handled by one live MRMIC runtime.

It does not survive a crash unless the provider itself offers stronger durable idempotency or transactional effect semantics.

A future Trellis adapter can therefore expose stronger operation identity because Trellis owns canonical command/event transaction semantics. A GUI provider cannot honestly claim the same guarantee merely because MRMIC cached a receipt.

## Security / authority

Provider-neutralization does not weaken provider authority.

The generic runtime does not acquire control leases, authorize principals, resolve UI elements, open browser sessions, or mutate repositories itself. Those checks remain inside adapters before the effect boundary.

## Phase boundary

Phase 15.16 intentionally does not implement real Browser, Terminal, Git, Trellis, or HDUS adapters yet.

The purpose of this slice is to make the common operational kernel exist once, prove it works with at least two provider shapes (Windows + synthetic terminal), and prevent future providers from cloning Windows-specific runtime machinery.

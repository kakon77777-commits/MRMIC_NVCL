# Phase 15.15 — AI-Native Operational Runtime

Status: stacked PR on top of Phase 15.14.

## Goal

Move the production Windows control path away from synchronous post-action verification and into an AI-native command/effect/perception loop.

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

UIA and WGC remain perception channels. They are not mandatory post-action verifiers.

## Delivered contracts

### `windows_operational_command_v1`

A bounded runtime command containing:

- `commandId`;
- `idempotencyKey`;
- `portalObjectId`;
- `providerResourceId`;
- `principalId`;
- one semantic UIA action (`invoke | toggle | select | set_value`).

### `windows_effect_receipt_v1`

A completed provider-effect receipt containing:

- command/idempotency identity;
- SHA-256 command digest;
- portal/resource/principal identity;
- exact `controlGeneration`;
- action kind/runtime id;
- provider completion timestamp;
- `deduplicated` flag;
- `worldStateVerified=false`;
- `perceptionRequiredForPlanning=true`.

The receipt deliberately has no `set_value` text field.

## Reference runtime

`WindowsOperationalRuntime` wraps the existing generation-bound `WindowsUiaControlledAccess` executor.

It does not import WGC snapshot/compositor/render paths and does not trigger Phase 15.13 postconditions.

### Runtime-local idempotency

Within one live runtime instance:

```text
same idempotency key + same command digest
-> one provider effect
-> repeated caller receives cached/deduplicated receipt
```

```text
same idempotency key + different command digest
-> fail closed
-> no second provider effect
```

Concurrent duplicate calls share one in-flight provider effect.

Completed receipts are cached in an LRU-like bounded map with a reference limit of 256 entries.

A failed provider effect is not cached as completed.

## What the effect receipt means

A receipt means:

> The trusted, authority-gated provider execution path reported that this semantic operation completed under this control generation.

A receipt does **not** mean:

> Another AI, UIA tree, screenshot, or human has proved the entire external world now satisfies a high-level goal.

The next AI perception cycle naturally observes the evolving world and may re-plan if reality differs from prediction.

## Phase 15.13 reinterpretation

`interactive_windows_controlled_action_e2e_v1` remains a development/conformance harness.

It is useful for:

- regression testing;
- provider implementation debugging;
- proving the stack can affect the repository-owned safe target;
- CI/local engineering evidence.

It is not:

- a production runtime gate;
- an execution authority;
- a required step after each AI action;
- a human approval mechanism.

Machine-readable capability therefore states:

```text
postActionVerificationRequired = false
continuousPerceptionDecoupled = true
effectReceiptClaimsWorldState = false
mrmicHumanApprovalGateRequired = false
conformanceHarnessRuntimeAuthority = false
```

## Trellis alignment

The design intentionally follows the direction already used in Trellis:

```text
Authority
-> Command
-> accepted transition/effect
-> Receipt
-> projection/perception
```

MRMIC cannot yet make external Windows UI effects transactionally atomic with a durable receipt, so Phase 15.15 explicitly limits idempotency to one live runtime instance rather than pretending to provide crash-safe exactly-once execution.

## Explicit non-goals

- synchronous UIA + WGC verification after every production action;
- verifier-agent approval loops;
- generic human login/approval gates;
- durable effect-receipt authority across process crashes;
- exactly-once semantics for arbitrary external GUI effects;
- raw mouse/keyboard injection;
- HDUS-complete operation semantics.

## Next direction

The next work should expand the AI-native command/effect abstraction across providers and agent scheduling, not add more post-action validators.

Potential slices:

1. provider-neutral operational command/effect interface;
2. command routing from agent intent/work queues;
3. effect receipt stream for short-lived runtime planning context;
4. provider-supported durable idempotency where a provider can genuinely guarantee it;
5. continuous perception fusion without synchronous verifier gates;
6. later HDUS bridge once operational semantics stabilize.

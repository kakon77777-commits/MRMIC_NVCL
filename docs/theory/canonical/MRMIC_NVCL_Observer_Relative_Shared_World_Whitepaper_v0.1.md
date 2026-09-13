# MRMIC/NVCL Observer-Relative Shared World
## Multi-Observer Infinite Canvas Technical Whitepaper v0.1

**Project:** MRMIC/NVCL  
**Phase:** 15  
**Status:** Canonical technical design source for the Phase 15 observer-relative workspace line  
**Encoding:** UTF-8  

## Abstract

MRMIC/NVCL already treats the Canvas as a visual-world authority while provider resources retain their native ownership and runtime authority. Phase 15 extends that architecture from a single shared visual state to an observer-relative shared world.

The central requirement is simple: a human and multiple AI actors may inhabit one computational world without being forced to share one screen, one foreground stack, or one attention state. Each authenticated principal receives a private projection of the world. Collaboration occurs by selectively projecting resources into an explicitly shared rendezvous space. The source resource remains under its original provider and control authority.

This yields the architectural rule:

$$
\text{Shared World} \neq \text{Shared Screen}
$$

and the operational form:

$$
\text{MRMIC Phase 15}
=
\text{Shared World}
+
\text{Private Views}
+
\text{Selective Convergence}.
$$

The same abstraction can later host Windows application portals, cross-conversation AI workspaces, and a bridge toward HDUS without making MRMIC depend on any one operating system or provider.

## 1. Problem statement

Traditional desktop systems implicitly bind a user session to one dominant visual ordering. Applications compete for a common focus, z-order and input path. This model becomes inefficient when several autonomous AI actors work concurrently with a human.

The desired environment has different semantics:

- Neo.K can use a foreground application without displacing AI workspaces.
- AI actors can maintain their own active or suspended views.
- Private AI work should not automatically become visible to every participant.
- A participant can bring one resource into a shared place without moving the original workspace.
- Shared visibility must not imply shared ownership or unrestricted control.
- Nested Canvas structures must remain legal so a workspace can contain subordinate workspaces or portals.

The system therefore needs observer-relative projection rather than another global desktop.

## 2. World and observer model

Let the shared computational world be:

$$
W = \{R_1,R_2,\ldots,R_n\},
$$

where each $R_i$ is a resource or world object whose authority may belong to MRMIC or to an external provider.

For each authenticated observer $a$, define a projection:

$$
\Pi_a : W \rightarrow V_a.
$$

The views need not be equal:

$$
V_{\mathrm{Neo.K}}
\neq
V_{\mathrm{AI}_1}
\neq
V_{\mathrm{AI}_2}.
$$

They may nevertheless refer to resources in the same world $W$.

An observer-relative foreground ordering is therefore local to the observer:

$$
Z_a = [P_1,P_2,\ldots,P_k],
$$

where each $P_i$ is a portal reference visible to that observer. No global requirement forces $Z_a=Z_b$ for two different observers.

## 3. Shared rendezvous

A rendezvous is a shared Canvas projection with explicit membership. For a participant set $G$:

$$
G = \{a_1,a_2,\ldots,a_m\},
$$

MRMIC exposes a shared projection:

$$
\Pi_G : W_G \rightarrow V_G^{\mathrm{shared}},
$$

where $W_G$ is the subset of resources deliberately projected by members of $G$.

The key operation is projection, not transfer:

$$
R \in V_a^{\mathrm{private}}
\quad\Longrightarrow\quad
\operatorname{project}(R,V_G^{\mathrm{shared}}),
$$

while the source remains present in $V_a^{\mathrm{private}}$ and retains the same provider authority.

Closing a rendezvous removes the shared coordination surface. It does not imply destruction of source resources.

## 4. Nested spatial model

MRMIC already supports recursive Canvas work. Phase 15 treats nesting as a normal property of the spatial model:

$$
C_0 \supset P_1 \supset C_1 \supset P_2 \supset C_2.
$$

This nesting may represent spatial, attention, resource and permission boundaries. Phase 15 does not require every nested Canvas to share the same observer set.

A future visibility inheritance rule may therefore be expressed as a policy function:

$$
\mathcal{V}(C_i,a,p) \rightarrow \{\mathrm{allow},\mathrm{deny}\},
$$

where $a$ is an authenticated observer and $p$ is the parent visibility context.

## 5. Identity and authorization

Observer identity is not supplied by an arbitrary client payload. It is bound from the authenticated principal established by the existing identity authority.

The minimum security rule is:

$$
\operatorname{ObserverIdentity}
:=
\operatorname{VerifiedPrincipal}.
$$

Phase 15 therefore rejects any design in which a client can create a view while claiming another principal or semantic-agent identity.

Private views are private by default. A second principal cannot inspect or mutate a private view merely because it knows the view identifier.

Rendezvous membership is explicit:

$$
\operatorname{join}(a,G)
\Rightarrow
\operatorname{invited}(a,G)
\land
\operatorname{authenticated}(a).
$$

Viewer principals may be invited to observe shared rooms, but they cannot publish private observer state or shared resource projections.

## 6. Visibility is not control

A shared projection is only a visibility and coordination relation. It does not replace provider authorization or the existing resource-portal control contract.

Therefore:

$$
\operatorname{visible}(R,a)
\not\Rightarrow
\operatorname{controllable}(R,a).
$$

Likewise:

$$
\operatorname{interactionMode}=\mathrm{interact}
$$

is a requested interaction posture, not proof that the principal owns the underlying provider resource. Actual control must continue through the Phase 13 `controlOwner`, provider-specific authorization, and secure principal binding.

## 7. Lifecycle and on-demand allocation

Observer views use a lifecycle independent of resource destruction:

$$
\mathrm{live}
\rightarrow
\mathrm{warm}
\rightarrow
\mathrm{frozen}
\rightarrow
\mathrm{sleeping}.
$$

The lifecycle describes how actively MRMIC maintains an observer projection. It is not a universal statement about the provider resource itself.

This allows the system to avoid rendering or streaming every AI workspace continuously. A future scheduler can allocate compute, capture bandwidth and attention according to current demand.

## 8. Windows integration boundary

Phase 15 is intentionally not a Windows replacement. The target architecture is:

```text
Windows / provider runtimes
        |
        v
MRMIC resource adapters and native_resource_portal_v1
        |
        v
Observer-relative workspace layer
        |
        +-- Neo.K private view
        +-- AI-A private view
        +-- AI-B private view
        +-- shared rendezvous spaces
```

A later Windows adapter may use structured interfaces first and visual capture only when required. The intended priority is:

$$
\mathrm{Semantic\ Native}
>
\mathrm{Structured\ UI}
>
\mathrm{Visual\ GUI}.
$$

Possible providers include MCP/API resources, terminal/PTY sessions, browser DOM, Windows UI Automation, application-specific extensions, and Windows Graphics Capture. These providers are outside the Phase 15.0 implementation claim.

## 9. Cross-conversation AI continuity

Cross-conversation AI collaboration requires a distinction between actor identity, workspace state, runtime presence and conversation transport.

The long-term model is:

$$
\operatorname{AIContinuity}
=
\operatorname{PrincipalIdentity}
+
\operatorname{DurableWorkspaceState}
+
\operatorname{ResourceReferences}
+
\operatorname{EphemeralPresence}.
$$

A chat thread is therefore one possible interaction surface, not the canonical world state.

Phase 15.0 establishes the observer and rendezvous semantics needed for this model, but it does not claim cross-process durability yet. Persistence and recovery must be connected to the existing Canvas/event authority in a later implementation slice.

## 10. HDUS bridge

MRMIC and HDUS should remain layered rather than collapsed into one implementation.

MRMIC supplies a practical spatial and resource-projection substrate. HDUS may later supply a richer computational-world ontology. A future bridge can map MRMIC world and observer concepts into HDUS without requiring MRMIC clients to understand the full HDUS model.

The compatibility direction is:

$$
\text{Windows / Providers}
\rightarrow
\text{MRMIC}
\rightarrow
\text{Observer-Relative Shared World}
\rightarrow
\text{HDUS Bridge}.
$$

The bridge is a future contract, not a Phase 15.0 completion claim.

## 11. Phase 15.0 contracts

### 11.1 `observer_view_v1`

An observer view contains:

- opaque view, world and Canvas identifiers;
- an observer principal bound from authenticated identity;
- optional verified semantic-agent identity;
- a local foreground portal stack;
- lifecycle state;
- monotonic local revision metadata.

### 11.2 `shared_rendezvous_v1`

A rendezvous contains:

- host principal;
- invitation set;
- joined authenticated members;
- shared resource projections;
- active/closed lifecycle;
- monotonic local revision metadata.

### 11.3 `shared_resource_projection_v1`

A shared projection records:

- an opaque projection identifier;
- source private view identifier;
- source principal;
- portal identifier;
- requested `inspect` or `interact` posture;
- creation timestamp.

It does not duplicate provider ownership metadata and does not contain bearer tokens.

## 12. Phase 15 invariants

**P15-01 Private by default.** Creating an observer view never makes it globally visible.

**P15-02 Verified observer identity.** Observer identity comes from an authenticated principal rather than a caller-selected identity field.

**P15-03 Observer-relative foreground.** Foreground portal ordering is local to one observer view.

**P15-04 Explicit convergence.** A resource becomes visible in a rendezvous only through an explicit projection operation.

**P15-05 No ownership transfer.** Projection does not change provider resource ownership or source workspace ownership.

**P15-06 Membership gate.** A principal must be an authenticated joined member to inspect a rendezvous.

**P15-07 Invitation gate.** A non-host principal must be invited before joining.

**P15-08 Source-owner projection.** A principal may project only from a private view it owns.

**P15-09 Viewer non-mutation.** Viewer principals cannot create private views or publish shared projections.

**P15-10 World consistency.** A source private view and destination rendezvous must belong to the same MRMIC world for direct projection.

**P15-11 Visibility-control separation.** Shared visibility never bypasses `controlOwner` or provider authorization.

**P15-12 Close without destroy.** Closing a rendezvous terminates the shared coordination surface without destroying source resources.

**P15-13 Nested compatibility.** Observer-relative semantics must remain compatible with recursive Canvas/subcanvas structures.

**P15-14 Presence separation.** Ephemeral runtime presence remains separate from durable observer/world semantics.

**P15-15 OS neutrality.** Windows integration is a provider path, not a requirement of the observer-relative model.

**P15-16 Honest persistence boundary.** Phase 15.0 does not claim cross-process persistence until recovery is connected to a durable authority.

## 13. Implementation sequence

The recommended sequence is:

1. land the observer view and rendezvous runtime contracts;
2. connect them to capability discovery;
3. connect durable recovery to existing event/Canvas authority;
4. expose authenticated MCP/HTTP operations;
5. add nested visibility policies;
6. add Windows/provider adapters;
7. add lifecycle scheduling and resource budgets;
8. add the HDUS bridge after the MRMIC semantics stabilize.

This ordering keeps operating-system integration replaceable while protecting the world, identity and ownership boundaries that cross-conversation AI collaboration depends on.

## 14. Conclusion

MRMIC does not need to turn every participant into a user of one shared desktop. It can instead provide one shared computational world with observer-relative private projections and explicit shared rendezvous spaces.

The architectural objective is therefore:

$$
\boxed{
\text{Shared World}
+
\text{Private Views}
+
\text{Selective Convergence}
}
$$

This model is practical enough to implement above existing operating systems, general enough to support cross-conversation AI collaboration, and layered enough to serve as infrastructure for a later HDUS world model.

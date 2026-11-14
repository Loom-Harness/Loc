# D-PROJECTION-IMPLICIT-SUB — an `on(Event)` handler subscribes in-process whether or not a channel carries the event

**Status:** PINNED — **APPLIED** (2026-09-14, wave C2 packet 2f).

**Question.** Does a `projection … { on(e: E) { … } }` whose `E` is carried by no
declared `channel` fold, or not? (Today node folds it; python, java, .NET and
elixir never subscribe. This is register/ledger row B20 /
`G2646-open-projection-on-event-no-channel`.)

**Options.** (a) it folds — a channel is TRANSPORT, the `on` declaration is the
subscription; (b) it does not, and node's leniency becomes a refusal; (c) a
diagnostic requires the channel.

**Decision.** (a) — **implicit in-process subscription on every backend.**

**Rationale.**

- **(b) removes a working behaviour from a shipping backend to reach parity** —
  the shape D-WHEN-GATE-DOMAIN already rejected for the same reason.
- **`on(e: E)` reads as the subscription.** Nothing in the projection's own
  syntax mentions transport, and requiring a `channel` makes a read model's
  correctness depend on a declaration in a different block whose stated purpose
  (`docs/channels.md`) is cross-deployable delivery and durability.
- **The mechanism is one early return.** `deriveEventSubscriptions` opens with
  `if (!channels || channels.length === 0) return []`
  (`src/ir/enrich/enrichments.ts:1303`) and then keeps only events some channel
  `carries:`, so python emits no `app/dispatch.py` at all and java/.NET/elixir
  emit no fold, while `src/generator/typescript/emit/routes.ts` folds off the
  projection directly. The divergence is not a considered position on four
  backends; it is a guard nobody revisited.
- **Scope, stated so it is not re-litigated per handler kind.** The same
  derivation feeds workflow reactors (`on` and `create … by`), so the rule is
  written once for both: *an in-process handler in a deployable that also hosts
  the emitter subscribes implicitly.* A `channel` remains required for delivery
  ACROSS deployables and for durability (`retention:`) — which is what it is for.

**Consequences.** The early return is replaced by an implicit subscription
carrying no channel, and every backend's dispatcher builder learns the
channel-less subscription (python must emit `dispatch.py` in that case). No
diagnostic is needed on either side: the losing behaviour disappears rather than
being refused. A corpus fixture carrying a projection with NO channel — the shape
the audit had to construct by deleting a block from `projection.ddd` — enters the
fixture set in the same wave (rule 13), because a compile gate over a corpus that
lacks the shape proves nothing.

**Unblocks.** `G2646-open-projection-on-event-no-channel` (B20) → closed in wave
**C2 packet 2f** (2b measured the dotnet arm as a no-op and 2c measured the node
arm as "not a node arm"; both were right — it was one change on the shared IR,
plus the two emitter-side copies of the same carriage filter, in elixir's
`resolveProjectionSubs` and node's `buildProjectionsFile`).

**As built.** `deriveEventSubscriptions` (`src/ir/enrich/enrichments.ts`) drops
both filters and yields a subscription per consumer, with `channel: undefined`
when nothing carries the event (`EventSubscriptionIR.channel` is now optional; no
emitter read the field). BOTH warnings go, not just the projection one — this
decision's own scope paragraph writes the rule once for both consumer kinds, so
`loom.reactor-event-uncarried` had become exactly as false as
`loom.projection-event-uncarried`. Corpus fixture
`test/fixtures/corpus/projection-implicit-sub.ddd` (backends: ALL) carries an
uncarried projection fold AND an uncarried workflow reactor;
`test/generator/projection-implicit-sub.test.ts` names the emitted fold and
reactor symbol per backend.

**Sources.** [`behavioral-parity-bugs-2026-07.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/behavioral-parity-bugs-2026-07.md)
B20; [`language-gaps-2026-08.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/language-gaps-2026-08.md) (the
"needs a semantics decision" row); `src/ir/enrich/enrichments.ts:1284-1340`;
`src/generator/typescript/emit/routes.ts`.

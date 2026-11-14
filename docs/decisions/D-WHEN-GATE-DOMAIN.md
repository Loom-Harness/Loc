# D-WHEN-GATE-DOMAIN — the `when` state gate is a domain-method property, not an HTTP-edge one

**Status:** PINNED.

**Problem.** `operation cancel() when <pred>` (criterion.md use site 2, the
canCommand state gate) used to be emitted at the **route / command-handler layer
only**. Every other caller of the domain method walked straight past it — a
workflow step, a saga cascade, an `extern` command handler, the LiveView action
seam all call `aggregate.cancel()` directly. The declared rule then silently did
not run on the paths that reach the aggregate from *inside* the system: no
`DisallowedError`, no 409, the write landed. It is the absence of a refusal, so
no wire-shape differential can see it — the request that should have been refused
is never made over HTTP at all.

Two coherent answers were open ([`new-plan/T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.38):

1. **Domain-layer gate** — the predicate is asserted by the aggregate's own
   method, so every caller is gated.
2. **Route-layer by design** — `when` stays an API-edge gate and the language
   says so, leaving in-system callers deliberately ungated because the workflow
   *is* the authority.

**Decision.** (1). The `when` predicate renders as the first line of the
generated operation method on all five backends. The route keeps its own
post-load check so the HTTP answer (409 + the RFC 7807 envelope) is still
produced before the aggregate is touched and the wire contract is unchanged;
the two checks are the same predicate and the same message.

**Rationale.**

- `when` is written *on the aggregate*, in terms of the aggregate's own state,
  and reads as a statement about when the operation is meaningful — not about
  who may call it over HTTP. Answer 2 asks the reader to hold a rule whose
  enforcement depends on the caller's transport, which nothing in the syntax
  hints at.
- It makes the gate uniform with `precondition` / `invariant`, which have always
  been domain-method properties. `requires` stays the deliberate exception —
  its leading run is hoisted to the calling handler (`ir/util/op-gates.ts`)
  because authorization needs a principal the domain layer does not carry.
- Phoenix was already doing this (its gate has always lived inside the context
  function the workflow starter calls), so answer 2 would have meant *removing*
  enforcement from a shipping backend to reach parity.
- Cost is bounded: one line per gated operation in five domain emitters, and no
  wire change — the route-layer check is retained precisely so no status,
  envelope, or ordering moves.

**Affects.** `generator/typescript/emit/aggregate.ts`,
`generator/dotnet/emit/entity.ts`, `generator/java/emit/entity.ts`,
`generator/python/emit/aggregate.ts` (elixir's
`vanilla/context-emit.ts` already conformed); the route-layer checks in
`platform/hono/v4/routes-builder.ts`, `generator/dotnet/cqrs/commands.ts`,
`generator/java/emit/service.ts`, `generator/python/routes-builder.ts` are
unchanged. Pinned by `test/generator/when-gate-domain-entry.test.ts`;
documented in [`language-reference/06-behavior-and-statements.md`](../language-reference/06-behavior-and-statements.md).

---

# Wave C0.6 — the fifteen rulings batch (drafted 2026-09-10)

The fifteen entries below were batched by packet **C0.6** of Wave C0 in
[`new-plan/completion-waves-2026-09.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/completion-waves-2026-09.md)
(the table that used to live in that plan's Wave C5 now points here). They are
drafted so the owner can sign the batch off in one sitting: each carries the
question in one sentence, the options that were on the table, a **default**, its
reason grounded in the code as it stands on `main` @ `bc7ed8f`, what it unblocks
(mission id + wave packet), and Sources.

**How the defaults work.** Every entry is `proposed`. Thirteen carry *default
applies 48 h after merge unless overridden* — an absent owner does not stall the
fleet. **Two are `owner-only, no default`** and nothing may proceed on them
without a signature: **D-HANDLE-REMOVAL** (it deletes surface syntax) and
**D-NUMERIC-INGRESS-STRICT** (it is a breaking narrowing on a shipping wire).
When a default is taken, flip that entry's Status to `PINNED` and date it; when
the owner overrides, rewrite the Decision rather than adding a second one beside
it.

| # | tag | default in one line |
|---|---|---|
| 1 | `D-ENVELOPE-RATIFY` | `X envelope` = a single-row find; the `{id, ts, body}` carrier is dropped |
| 2 | `D-HANDLE-REMOVAL` | remove workflow `handle`; `commandHandler` is the named command entry — APPLIED (owner-signed) |
| 3 | `D-FOR-IN-DOMAIN` | `for` in a domain body = honest gap + named successor; `if let` = permanent refusal; statement `match` legal in effect bodies, refused in pure folds / functions (amended by D-FAILURE-MODEL) |
| 4 | `D-NUMERIC-INGRESS-STRICT` | strict on both real narrowings — **owner-only** |
| 5 | `D-DECIMAL-EXACT-MOMENT` | one PR: node + python + all 54 goldens re-captured; mint **RS-35** |
| 6 | `D-WRITE-TX` | state + outbox + audit + provenance in one tx; dispatch after commit |
| 7 | `D-CROSSTENANT-ACK` | `policy { deny on X }` is the acknowledgment; `allow global` stays refused |
| 8 | `D-READ-SURFACE-ORDER` | re-verify, then projection masking, then the two small gates, then system reads |
| 9 | `D-LONG-AVG-DEFAULTS` | declared 2^53 ceiling for `long`; projection `avg` over money retypes to `money` |
| 10 | `D-DAPPER-ALTER` | build the ALTER path in phase ⑨; the widened refusal lands first |
| 11 | `D-PROJECTION-IMPLICIT-SUB` | an `on(Event)` subscribes in-process with or without a channel |
| 12 | `D-FIRST-ON-EMPTY` | `first` is partial and fails on empty; `firstOrNull` is total; **RS-36** minted — APPLIED (packet 2n) |
| 13 | `D-ABSENT-JOIN-DATETIME-WIRE` | absent join value = wire `null` everywhere (RS-34 ratified); datetimes ship milliseconds; mint **RS-38** (was RS-37 — Wave C5 5a minted decimal-exact as RS-37 first, the registry forbids gaps) |
| 14 | `D-FLUTTER-BEARER` | Flutter native = bearer, Flutter web = cookie (a RULE 2 amendment) |
| 15 | `D-MISC-C0` | four small rulings: the .NET entry-point boundary, `connection:` semantics, per-op OpenAPI tags, `scopeId` |
| 16 | `D-PAGE-BODY-EXPRESSION` | a page body is an expression tree; the statement `if` stays refused, owner **M-T1.20** |
| 17 | `D-SENSITIVE-INSPECT-ONLY` | `sensitive(...)` is inspect-only today; wire masking is `mask unless`; phases 2–4 stay **M-T3.8** |
| 18 | `D-POLYMORPHIC-ID-REPRESENTATION` | a `<Base> id` to a TPC base is a plain id column — no FK, no discriminator; owner **M-T5.7** |

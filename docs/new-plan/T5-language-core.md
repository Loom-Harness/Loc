# T5 — Language core & type system

> **Completed missions for this track live in [`archive/T5-done.md`](archive/T5-done.md)** (6 closed as of 2026-09-02). This file lists only the live missions.

*The expression language is deliberately small; these missions finish the in-flight type-system families (errors-as-data, criteria, payloads), close audited correctness bugs, and keep the surface honest.*

## M-T5.1 — Exception-less completion (A4/A5/A6 + VO→422) — `partial` · **L** · P1 ⚠ coordinated
The remaining errors-as-data arc: **A4** re-shape `Repo.getById` from `: X` to `X or NotFound` (`: X?` → `X option`) — THE coordinated single-PR fixture re-baseline across all backends; **A5** parse-intrinsic/external-api results as `or`; **A6** `validate for X` → `X or ValidationError[]`; VO-construction `invariant` → 422 routing with RFC-7807 `errors[]` (failure-taxonomy's highest-leverage piece); variant-`match` with scrutinee + variant-pattern binding (real prerequisite — `match` is boolean-guard-only today). The `?` propagation operator stays DROPPED — do not reintroduce.
Sources: [exception-less](../old/proposals/exception-less.md), [failure-taxonomy](../old/proposals/failure-taxonomy.md), [implementation-plan](../old/proposals/implementation-plan.md) decision table.

## M-T5.2 — Backend failure-sink contract — `open` · **M** · P2
Uniform problem+json envelope + `traceId` as a cross-backend wire contract; `errors {}` policy override (backend half of M-T1.8); `expose`/public-contract error translation at api blocks (failure-taxonomy OQ4).
Sources: [error-handling-and-failure-sink](../old/proposals/error-handling-and-failure-sink.md), [failure-taxonomy](../old/proposals/failure-taxonomy.md).

## M-T5.3 — Payload tail: P3 nested carriers, P5, `option` — `partial` · **M** · P2
Nested carriers `P<Q<T>>` (gated `loom.generic-arg-not-carrier`); `validate for X` / `authorize for X` (no surface); the `option` carrier end-to-end (unblocks [partial-update](../old/proposals/partial-update.md) three-state PATCH and M-T1.6's "leave unchanged"); page-aware React hooks.
Sources: [payload-transport-layer](../old/proposals/payload-transport-layer.md) P3/P5, [partial-update](../old/proposals/partial-update.md).

## M-T5.4 — Criterion & retrieval tails — `partial` · **L** · P2
(a) `from <Criterion>(args)` on params/command fields (input validation + UI dropdown + OpenAPI constraints — also unblocks domain-service param criteria); (b) findAll `sort:`/`loads:` + single-result `Repo.find(<Criterion>)`; (c) `private workflow` / workflow-calls-workflow (Crit5); (d) reified-criteria phases: `Criterion<T>` object reification (incl. principal constructor-arg), retire `usesUser` threading, **add criteria reification on Phoenix** (it has none), `isSatisfiedBy` duality, Java `Specification<T>` fallout; (e) explicit `loads:` plans or the autoload inference direction (retrieval Phase 6 / load-specifications v2) — pick one, gate the other honestly.
Sources: [criterion](../old/proposals/criterion.md), [reified-criteria](../old/proposals/reified-criteria.md), [retrieval](../old/proposals/retrieval.md), [load-specifications](../old/proposals/load-specifications.md), DEBT-24/28.

## M-T5.5 — Stdlib tail — `partial` · **S** · P2
A4 reductions verified complete 2026-07-13 (`src/util/collection-ops.ts:18-34` — count/sum/min/max/avg all registered). Remaining: block-form top-level functions (`loom.function-toplevel-block`), storable `duration`/PG interval columns, externalising the prelude to `std/*.ddd`.
Sources: [stdlib plan](../old/plans/stdlib.md), completeness-audit Tier 1.

## M-T5.7 — Inheritance tail — `partial` · **M** · P3
I4 per-concrete storage override / mixed strategy (gated; UNION-ALL variant was dropped — re-justify before building); `<Concrete>Id → <Base>Id` threading across ~49 .NET application-layer sites (mechanical, `/warnaserror`-gated); polymorphic `<Base> id` refs.
Sources: [aggregate-inheritance](../old/proposals/aggregate-inheritance.md), [dotnet-tph-emission](../old/proposals/dotnet-tph-emission.md) follow-on.

## M-T5.8 — Lifecycle operations phases 3–5 — `partial` · **M** · P3
Backend route emission per action kind + action-param walking in API generators; `crudish` reframing (`createOp`/`destroyOp` factories); scaffold macros emit noun-named ops by default (+ fixture re-baseline).
Sources: [lifecycle-operations](../old/proposals/lifecycle-operations.md).

## M-T5.9 — Surface hygiene: signposting + with/implements — `open` · **S–M** · P2
(a) `loom.reserved-not-emitted` diagnostic routed through every parse-but-no-emit surface (old S1 — additive, self-emptying); (b) the `with`/`implements` keyword-kind split + fix-it + codemod (old S4). S2 redundancy cuts are DONE (#1795).
Sources: [reserved-surface-signposting](../old/proposals/reserved-surface-signposting.md), [with-implements-split](../old/proposals/with-implements-split.md).

## M-T5.10 — API derivation completion — `partial` · **M→L** · P2 ⚠ verify-first
`commandHandler`/`queryHandler`/`route` shipped on all 5 (+scaffold A3.2/A3.3). **Verified 2026-07-14 (state audit): the "full response-DTO projection + `[FromBody]` request records" item is STALE — already shipped** (`<Handler>Body`/`@RequestBody`/Pydantic request records on 4/5 backends; response projection via repo `toWire`/`projectToResponse`). The genuine gap was **Layer 2 (contract)** — no `scaffoldResponse`/`command`/`query` records existed; handlers took flat scalars + returned bare aggregates.
- **PR1 (contract-record layer) landed** (#1900) — `scaffoldHandlers` now splices source-visible literal `response`/`command`/`query` `PayloadDecl` records (`src/macros/api/factories.ts` `payload`/`response`/`command`/`query` + `apiReadFields` = AST twin of `forApiRead(wireShape)`; `src/macros/stdlib/scaffold/_contracts-shared.ts`). Macro-layer only, additive + **inert** (byte-identical generation, proven). `unfold` ejects the contract as real `.ddd`.
- **PR2–PR6 (response-DTO read-rewire) landed — all 5 backends** (#1905 .NET, #1909 Hono, #1910 Python, #1911 Java, #1912 Elixir). Each backend's response-DTO/schema emitter now READS the declared `<Agg>Response` record (override-by-name on `ctx.payloads`) instead of re-deriving from `wireShape`: .NET record params, Hono zod schema, Python Pydantic model, Java record + `from()` mapper, Elixir OpenApiSpex schema. The `id` row (grammar-reserved, omitted) is re-prepended and containment fields (already `<Part>Response`) map via an `isResponsePayloadName` guard (no `<Part>ResponseResponse` double-suffix). Each PR is **byte-identity + divergence gated** (scaffolded record ≡ wireShape baseline; a hand-declared divergent record emits differently). PR2 also threaded `env` into `lowerPayload`/`lowerField` (macro-spliced refs skip the Langium Linker). The DTO's source of truth now moves from enrichment-stamped `wireShape` to the declared contract.
- **PR7 (handler-param rewrite) landed — all 5 backends** (branch `claude/handler-param-record-rewrite-atf3cj`). The scaffold + all 5 explicit-handler emitters now consume a single `command`/`query` **record param** (bodies reference `cmd.<field>`/`query.<field>`) instead of flat scalars, and the read handlers (getById/find) declare `<Agg>Response`/`<Agg>Response[]` returns. Path-param ids stay separate handler params (a route `{id}` can't live in a body record); query records assemble from path+query-string; empty command records (cancel-no-params, destroy) are omitted → `(orderId: Order id)`. Wire-preserving return contract: create keeps `<Agg> id`, operation/destroy stay void, reads declare their `<Agg>Response` (transport already projects entities to it, so the request/response wire is **byte-identical**). Grammar/IR-shape unchanged — payload-param member access reuses the workflow-`handle` machinery (`memberOnPayload`). Two shared helpers in `src/ir/util/handler-contracts.ts` — `requestRecordFor` (identify a record param) + `normalizeHandlerReturn` (map `<X>Response` → entity X for the internal type + projection trigger). Each backend keeps its transport idiom: Hono materialises the record from per-field wire sources (+ fixed a latent single-entity-only projection bug: find arrays now `r.map(x => repo.toWire(x))`); .NET/Java/Python/Elixir FLATTEN the record into their existing Mediator record / `@RequestBody` / Pydantic `Body` / string-keyed map (byte-identical to the flat form), rendering `cmd.<field>` as the flat field via a `recordParams` set threaded into each `render-expr`. Compile-gated on every backend (new `scaffold-handlers` fixtures: Hono `tsc`+`tsup`, .NET `/warnaserror`, Java `gradle bootJar`, Python `ruff`+`mypy --strict`, Elixir `mix --warnings-as-errors`). Hono 200 `z.unknown()`→`<Agg>Response` tightening is the separate #1917 tail. **M-T5.10 input+output axes now complete; only the spun-off `wireShape` retirement remains.**
- **Spun off:** the `wireShape` retirement (proposal steps 6–8) — 179 refs / 49+45 files, gated on the contract layer + entangled with the still-active auto-derivation mainstream; XL, deserves its own mission (not this M). Extern handler LSP/scaffold polish is a separate tail.
Sources: [unfoldable-api-derivation](../old/proposals/unfoldable-api-derivation.md) + [coordination note](../old/proposals/unfoldable-api-derivation-coordination-note.md).

## M-T5.12 — Typed-capabilities tail — `partial` · **M** · P3
Phase 5 remainder: LSP tooling (go-to-capability, find-implementors, completion) + marker-interface emission `I<Capability>`; then the [capability-emission-dedup](../old/proposals/capability-emission-dedup.md) stamp-dedup ladder (deferred until a second stamping capability exists). Also the persist-time auditing simulations (node awaiting §7 sign-off; Java §5-vs-§6-ALT fork).
Sources: [typed-capabilities-implementation](../old/plans/typed-capabilities-implementation.md) Phase 5, [node-persist-time-auditing-simulation](../old/plans/node-persist-time-auditing-simulation.md), [capability-stamp-dedup-simulation](../old/plans/capability-stamp-dedup-simulation.md).

## M-T5.13 — Multi-file & composition tails — `partial` · **M** · P3
Stage B cross-context `X id` identity refs via `uses`/`export`; zero-system synthesis decision; `ui with scaffold` cross-file gate test. (Stages C+ stay deferred indefinitely.)
Sources: [multi-file-source](../old/plans/multi-file-source.md), [implicit-system-composition](../old/proposals/implicit-system-composition.md).

## M-T5.14 — Domain-services Shape B — `open` · **M** · P3
The coordinator shape (Phase 2); Shape C stays deferred. Plus shipped-tier refinements (read-port shape, `audited` on service ops).
Sources: [domain-services](../old/proposals/domain-services.md).

## M-T5.16 — Compiler-internal fragility guards — `open` · **M** · P2
From the weak-spot review §7: (a) exhaustiveness-check the type-system's parallel walkers (`stepInto` + `typeAfterSuffix`) so a new bindable type can't silently miss one; (b) revisit the `unknown`-cascade suppression (a placeholder type silently disables ALL downstream operand checks) — at minimum a lint that counts suppressed sites; (c) full-code-review #22: macro expansion under LSP incremental rebuilds (C5).
Sources: [weak-spots §7](../audits/architecture-weak-spots-2026-07.md), `experience_gathered.md` §unknown, full-code-review #22.

## M-T5.19 — Test-placement & test-authoring DSL — `partial` (placement largely shipped; authoring unbuilt) · **M–L** · P2
The back-fill of a feature that shipped **three phases with no mission tracking it** — flagged as a coverage bug in [`coverage.md`](coverage.md) on 2026-07-21 and resolved here 2026-07-30. Two source proposals: [`test-placement.md`](../old/proposals/test-placement.md) (where a `test` block may live) and [`test-authoring-language.md`](../old/proposals/test-authoring-language.md) (what may be written inside one).

**Shipped — placement (re-verified on fresh `main` 2026-07-30, not taken from the proposal):**
- **Phase 1** — `test … for <Aggregate>` hoisted out of its aggregate to `ContextMember` / `ModelMember` (so tests can live in their own `tests/*.ddd`), attached to `AggregateIR.tests`, re-lowered byte-compatibly (#2163).
- **Phase 2 (partial)** — the extra unit anchors: `valueobject` and `domainService` host `test` blocks (`ddd.langium` `TestBlock` in both member unions; `checkTestPlacement`'s `isAggregate || isValueObject || isDomainService`) (#2179).
- **Phase 3 — the context-integration rung, on ALL FIVE backends.** `test "…"` nested in a `context` lowers to `BoundedContextIR.tests` and emits an in-process integration test against live repositories, no HTTP (`INTEGRATION_BACKENDS = {node, python, dotnet, java, elixir}` in `src/language/validators/test-placement.ts`; the `loom.context-test-unsupported` warning now suppresses for every backend) (#2188 + the per-backend follow-ons). *Note: `coverage.md` said "Phase 1+2 shipped" — Phase 3 had landed too, on all five.*

**Open (a) — the `workflow` unit anchor.** Phase 2 named `valueobject` / `workflow` / `domainService`; only two landed. `WorkflowMember` (`ddd.langium:1390`) has no `TestBlock` arm, so a workflow's orchestration has no unit-tier home — it is reachable only through the api/e2e tier or a context integration test. Size **S**: one grammar arm, one `checkTestPlacement` predicate, lower into `WorkflowIR.tests`, route to the existing unit emitters (the pattern the VO/domainService anchors already set).

**Open (b) — the authoring language, unbuilt.** `test-authoring-language.md` is on paper (2026-07-18); none of its surface parses today (`suite` / `background` / `setup` / `cleanup` / `isolation:` / `unique` / `factory` / `make` are absent from the grammar). Its Phase 1 (context `as`/`user`/`system`, grouping + lifecycle, data factories, api-tier retry) is what unblocks the `tenancy-hierarchy` fixture and the three async fixtures currently written by hand; Phase 2 is the test clock (`at`/`advance`) plus its per-backend seam. Land Phase 1 as its own slice stack — it is the larger half of this mission.

**Ordering:** (a) before (b) — the anchor is a one-PR completion of a shipped phase, while the authoring surface is a new grammar family that should not land half-built across five backends.

Sources: [`test-placement.md`](../old/proposals/test-placement.md) (incl. its runtime-grounded Phase 3 design), [`test-authoring-language.md`](../old/proposals/test-authoring-language.md), PRs #2163 / #2179 / #2188. Related: M-T9.3 (per-PR boot gates — the integration rung runs there), `docs/testing.md` (tier placement guide).
## M-T5.21 — Callable unification: one production for "a named body runs here" — `open` · **L** · P2 ⭐ cost-of-growth
**Fifteen grammar rules mean the same thing.** `Operation`, `Create`, `Destroy`, `Apply`, `FunctionDecl`, `CommandHandler`, `QueryHandler`, `DomainServiceOperation`, `WorkflowCreateDecl`, `HandleDecl`, `OnDecl`, `ActionDecl`, `UiFunction`, `Component`, `Criterion` — each is "a name, params, an optional return type, a body", forked by *where it lives* and carrying an arbitrary modifier subset. The grammar records the arbitrariness itself: `DomainServiceOperation` "does NOT carry `private`/`extern`/`audited`/`when` — those are aggregate-operation-only" (no reason given, because it is where the rule was forked), and workflow `function` is validator-restricted to the expression form one layer away from the grammar that states it. `extern` has **four** spellings (prefix on handlers, infix on `operation`, suffix-with-path on `component`, and *as the body* on ui `function`); `function` means three different things depending on scope.

The fork leaks downstream: the duplicate diagnostic pairs (`loom.workflow-emitted-event-no-applier` ↔ `loom.emitted-event-no-applier`, and five more) are one rule stated twice because the carrier was stated twice — plus a `lower/` branch, a mandatory `print-structural.ts` arm, and per-backend emitter arms each.

**The work:** one `Callable` production; the per-site differences become a declared legality table (`CALLABLE_SITES`) that a single validator reads, so an excluded modifier reports *why* instead of failing as an unexplained parse error. A standing constraint the design doc derives: the `unfold` contract ("the unfolded output re-parses to a working program") means **every macro-emitted carrier must stay author-writable**, so "make it internal" is not a disposition available to any construct a stdlib macro emits. Source-compatible in Phase 1, gated on **byte-identical emitted output** across all eleven targets — the pattern already used for `_expr/target.ts` (#843) and the walker extraction (#607–#627), applied to the one layer that never got it. **This is explicitly NOT a cut to customization depth** — no rung of `customization-gradient.md` is removed and no capability is lost; the mission separates *carrier count* (the cost) from *depth* (the moat). Under the no-permanent-skips policy each modeled carrier is a permanent eleven-target obligation, which is what makes the duplication expensive.

Design: [`M-T5.21-callable-unification-design.md`](missions/M-T5.21-callable-unification-design.md).

Sources: language-size review 2026-08-04. `src/language/ddd.langium` (the fifteen rules, line numbers in the design doc), [`docs/customization-gradient.md`](../customization-gradient.md), [`surface-redundancy-cuts.md`](../old/proposals/surface-redundancy-cuts.md) (same "one spelling per concept" principle, previously applied only to trivia). Relates to M-T5.17 (modifier zoo, one layer up), M-T5.18 (soft-keyword sprawl).

## M-T5.22 — Decimal arithmetic has no governing rule: `0.1 + 0.2` diverges on the wire AND in storage — `blocked(D-DECIMAL-EXACT-MOMENT)` · **L** · P1 ⭐ ruling GIVEN 2026-09-07: exact

Found 2026-08-23 by the numeric-types audit ([F11](../audits/numeric-types-audit-2026-08-23.md)). RS-24 pins how a `decimal` *serializes* (a JSON number through a float64) but nothing pins how it *computes*: node/python run float64 arithmetic, .NET/Java/Elixir run exact decimal (System.Decimal / DECIMAL128 / Decimal-context-28). A `derived x: decimal = 0.1 + 0.2` ships — and **persists into the shared unbounded `DECIMAL` column** — `0.30000000000000004` from two backends and `0.3` from three. Single divisions agree only coincidentally (double division is correctly rounded), which is why `7/3` never exposed it.

**Why every existing gate is green.** Zero corpus coverage of float-error-visible decimal arithmetic — and the witness cannot be added first, because it alone turns three backends red against the node oracle. The ruling comes first.

**THE RULING — given by the owner 2026-09-07. `decimal` arithmetic is EXACT.** `0.1 + 0.2` answers `0.3` on every backend, on the wire and in storage. .NET/Java/Elixir already conform; **node and python change to match them**.

This **supersedes the audit's proposed float64/node-oracle default**, which is struck rather than left standing beside it — the rationale for the override: `decimal` exists precisely to avoid binary-float error, so a decimal type that answers `0.30000000000000004` is broken by its own definition. Do not re-open this as "the audit suggested otherwise".

**The cost, accepted knowingly.** This is a WIRE-VISIBLE change on node and python: their API responses and newly-persisted values change. Existing rows are NOT rewritten, so historical rows may disagree with new ones — an implementing PR should say so in its body and consider whether a migration note belongs in `docs/migrations.md`. And the node oracle that the wire-golden and behavioural tiers compare every other backend against MOVES with this change, so those goldens are re-captured as part of this mission (`LOOM_WIRE_UPDATE=1`), reviewed diff-by-diff — never as a drive-by rebaseline.

**Scope the implementation FIRST, before writing any of it.** Python already has `Decimal` in play on the column side (M-T6.45 landed that), so its gap may be narrow. The Hono/node backend is the unknown: it likely needs a decimal library threaded through the domain layer and the derived-field evaluator, and that cost — not the ruling — decides how this mission is sliced. Report the finding before implementing.

**Not at stake, so nobody re-litigates it:** `money` is a fixed-scale-4 string, already exact and identical on all five backends. This ruling concerns plain `decimal` only.

Mint the RS rule per the registry's own claim-the-number protocol (`docs/conformance-semantics.md`). Then add the corpus witness and bring node/python into compliance.

**Also carried here** (same ruling's blast radius, from the register annex): node money arithmetic runs at decimal.js default 20-significant-digit precision (no `Decimal.set` emitted) vs 28+ elsewhere; the inbound `decimal` precision-acceptance skew (Java unlimited vs .NET 28–29 vs double-clamped — a Java-written 30-digit value can `OverflowException` a .NET reader of the same column); and the numeric doc drift (`docs/language.md` host-type table predates #2575 and mislabels Java; the stdlib catalog signature `sum → decimal` in `src/util/collection-ops.ts` disagrees with `type-system.ts`'s body-type rule — fix the catalog, regen `docs:stdlib`).

**This is a COORDINATED MOMENT — one PR, nothing else in it.** Measured
2026-09-10: `jq -r .oracle test/behavioral/wire-golden/*.json | sort | uniq -c`
answers **54 node**, and SEVEN behavioural legs diff against those goldens
(`behavioral`, `-mikroorm`, `-dotnet`, `-dapper`, `-python`, `-java`,
`-elixir`). So the instant node goes exact, all seven are red until all 54 are
re-captured — node, python and the goldens have to land **together, alone**.
Landing it as one row inside a multi-row cross-backend packet is the failure
mode to avoid: there, any other row being wrong is indistinguishable from the
oracle move, and a conflict on the goldens blocks the whole packet. Treat it as
a fourth coordinated moment alongside the three in
[completion-waves-2026-09](completion-waves-2026-09.md) (A4 `getById`,
`denyByDefault`, `organizationContext`). Note the move is more visible than it
was before [#2807](https://github.com/lemmit/Loc/pull/2807): the differential
now compares number FORMATS as well as values, so an oracle shift diverges on
spelling too, not only on magnitude.

**Verification when it lands.** The new corpus case green on all five behavioral legs; the RS entry in the registry; mutation-proved by reverting one exact-side backend. **Every leg is locally runnable** — including elixir, whose toolchain lifts out of the `hexpm/elixir` image onto the host (`docs/tools.md` → "Running `mix` on the HOST"); verified 2026-09-10 by running `node run-elixir.mjs core-domain` that way (`2 passed, 0 failed`, 0 divergences), which corrects [#2807](https://github.com/lemmit/Loc/pull/2807)'s body where it claims the elixir leg does not run on a sandbox host. It does. Re-capture the goldens against a leg you have RUN, never against CI alone.

Sources: [numeric-types-audit-2026-08-23](../audits/numeric-types-audit-2026-08-23.md) F11 + annex, plan.json N7. Relates to M-T6.46/M-T6.47 (the response-narrowing halves), RS-24.

## M-T5.23 — `long` has no contract: silent corruption past 2^53 on node/python, 3-way divergent overflow — `blocked(D-LONG-AVG-DEFAULTS)` · **M** · P2

Found 2026-08-23 by the numeric-types audit ([F13](../audits/numeric-types-audit-2026-08-23.md)). Node stores `long` as a JS `number` (`bigint(col, {mode: "number"})`, `src/generator/typescript/emit/schema.ts`; mikroorm `ts: "number"`) and python's aggregate arm routes declared int/long sums through `float()` — both silently corrupt past 2^53 while .NET/Java/Elixir carry int64 exactly. Aggregate int-overflow behavior is three-way divergent for the same `.ddd`: Java `((Number) x).intValue()` **wraps silently**, .NET's `(int)` cast **throws** (500), the rest pass the too-big value through. No validator, no doc caveat anywhere.

**The work (proposed default, overridable):** document + validator-enforce a 2^53 safe-integer ceiling for `long` on the affected paths now — an honest `loom.*` diagnostic instead of silent corruption; a representation upgrade (BigInt / string wire) becomes a named follow-up mission only if the ceiling pinches. Route python's declared-int/long aggregates through `int()`. Unify overflow behavior (proposed: Java's wraparound becomes an error like .NET's).

**Verification when it lands.** Validator tests; a >2^53 witness proving the exact backends carry it; python aggregate int test; each mutation-proved.

Sources: [numeric-types-audit-2026-08-23](../audits/numeric-types-audit-2026-08-23.md) F13 + annex, plan.json N8.

## M-T5.24 — Projection `avg` over money is typed `decimal`: the mean of exact money leaves as a lossy double — `blocked(D-LONG-AVG-DEFAULTS)` · **S** · P2

Found 2026-08-23 by the numeric-types audit ([F14](../audits/numeric-types-audit-2026-08-23.md)). `src/ir/lower/lower-projection.ts` stamps query-time `avg → decimal` even over a money column, so the mean of exact money crosses the wire as a float64 JSON number — while the **in-memory** `avg` of the same field types `money?` (`type-system.ts`) and ships the 4-dp string. Same word, two semantics, no gate.

**The work (proposed default, overridable):** retype projection `avg` over a money column to `money` — `aggregateCoercion`'s `isMoney` arm (`src/ir/util/projection-aggregate.ts`) already knows how to format it on all five backends; update the wire-golden capture with the retype.

**Verification when it lands.** A lowering test plus a behavioral golden for an avg-over-money projection; mutation-proved through the coercion.

Sources: [numeric-types-audit-2026-08-23](../audits/numeric-types-audit-2026-08-23.md) F14, plan.json N9. Relates to RS-12, #2560.

## M-T5.25 — `ignoring` after `group by` parses and is then silently dropped — clause order is load-bearing and nothing says so — `open` · **S** · P1

Found 2026-08-30 re-verifying the [08-24 generator review](../audits/generator-code-review-2026-08-24.md)'s follow-up register (row 13); **reproduced on `main` @ `aa236ae`**, no ledger row, no other owner.

`ProjectionQueryClauses` fixes the bypass clause in the `where` position — `('where' filter=Expression)? IgnoringClause? (joins+=ProjectionJoin)* ('group' 'by' …)?` (`src/language/ddd.langium:1581-1586`). But a `group by` operand is an ordinary `Expression`, and `PostfixChain` admits its own trailing `IgnoringClause` (`:2322`, added so an inline `Repo.findAll(…) ignoring softDeletable` parses). So `group by o.status ignoring softDeletable` **parses clean**, binds the clause to the grouping expression, and lowering drops it — the author asked to see soft-deleted rows and silently keeps getting the filtered count.

Reproduced from `test/fixtures/corpus/projection-groupby.ddd` + `softDeletable` on `Order`, generated to node:

```
group by o.status ignoring softDeletable   → .where(and(eq(status,"Confirmed"), not(eq(isDeleted,true))))
where Confirmed / ignoring softDeletable   → .where(eq(status,"Confirmed"))
```

Same model, same intent, opposite data — decided by where in the clause list the word sits.

**The fix (proposed, overridable):** refuse it. A `bypass`/`bypassAll` that survives on a `groupBys` (or `selects`, or a `join`'s `on`) expression after lowering is authoring error, not a feature — raise a `loom.*` code naming the legal position, from the phase-④ validator where the CST still carries the offending span. Moving the grammar instead (hoisting `IgnoringClause` to accept a trailing position too) is the wrong shape: the clause means "bypass the SOURCE's capability filters", which has no per-expression reading. Audit the sibling positions while in here — the same `PostfixChain` trailing clause is admissible anywhere an `Expression` is, including `where`-position sub-expressions and `select` bodies.

**Verification when it lands.** A negative parse/validate test per admissible-but-illegal position; mutation-proved by deleting the gate and watching the fixture above go quiet again. Add the legal-position witness to the projection fixture so the *working* spelling is pinned too.

Sources: [generator-code-review-2026-08-24](../audits/generator-code-review-2026-08-24.md) §Follow-up register (2026-08-30) row 13. Relates to M-T4.2 (query-time projections), `named-filter-bypass.md` §11.

## M-T5.28 — `variant-match` off a page crashes all five backends; `for`/`if let` off a workflow emits `this.<unknown>()` — neither is gated — `blocked(D-FOR-IN-DOMAIN)` · **M** · P1 ⚠ verify-first, carries a design fork

Found 2026-09-03 by the language-docs audit ([F1](../audits/2026-09-03-language-docs-audit-findings.md), [F4](../audits/2026-09-03-language-docs-audit-findings.md), both P0). A `match` over a union in a domain body reports `0 error(s)` and then throws `variant-match statement is frontend-only; it must not reach the <X> backend` from `src/generator/_stmt/target.ts:160` on node, dotnet, java, python and elixir alike — no IR check covers `variant-match` outside a page (`src/ir/validate/checks/store-checks.ts` handles only the page case), and non-exhaustive arms are unchecked too. Symmetrically, `src/ir/lower/lower-stmt.ts` has no arm for `ForStmt`/`IfLetStmt` outside a workflow and no validator rejects them: `operation touch() { for n in notes { owner := n } }` reports `0 error(s), 0 warning(s)` and emits `this.<unknown>();`.

**Resolve the fork before coding.** Each shape can be *gated* or *lowered*. The default is **gate** — both are frontend/workflow-only by design per the source comments, and a gate is S where lowering is L. If the design pass concludes lowering is right, that is a `language-feature-developer` mission: split it out and say so rather than widening this one. Mints codes in `src/diagnostics/messages.ts` — the only Wave-3 packet that may.

**Verification when it lands.** Both shapes raise a `loom.*` code with the offending span; each gate mutation-proved by file-copy revert, reading *which* assertion fails.

**Also carries M-T5.27's residue (re-homed 2026-09-10, Wave C0.4).** [#2789](https://github.com/Loom-Harness/Loc/pull/2789) minted `loom.locator-matcher-receiver` in `src/language/validators/match.ts:151`, deliberately re-deriving the ui-e2e renderer's handle rule at the AST layer because `src/ir/validate/checks/**` was another packet's tree. Its proper home is `validateE2ETest` (`src/ir/validate/checks/test-checks.ts:132`), which already walks these statements with the resolved IR and today has no `locator` handling at all. Consolidate it here while in the file. The mutation proof makes the case that gate and renderer are genuinely independent: under the *renderer* mutation the validator still passed the source and the renderer crashed, so neither alone covers F6.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F1/F4 + "Cross-cutting reading" §2, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.1**; M-T5.27's `loom.locator-matcher-receiver` consolidation.

## M-T5.31 — A `retrieval` reaches the repository and stops there: no HTTP route on any backend, and no `requires` clause — `open` · **L** · P1

Found 2026-09-10 by the tracker dev-experience run (#2861, "Not fixed here"). Re-verified on `main` @ `4865581` with a four-declaration model (`aggregate` + `criterion` + `retrieval` + `repository`, `platform: node`):

```
out/api/domain/repository-ports.ts     runAvailableProducts(page?): Promise<Product[]>   ← emitted
out/api/db/repositories/…-repository.ts  the implementation                              ← emitted
out/api/http/product.routes.ts         GET /{id}, GET /                                  ← the retrieval is ABSENT
```

The read is fully lowered, typed and implemented, and then has no caller. A page cannot reach a repository, so a `retrieval` is unreachable from the generated frontend — and `find`, the one construct that *does* produce a route, is what `loom.repository-find-deprecated` tells the author to migrate away from. Following the validator's advice removes your read API. #2874 narrowed that warning to contexts that already declare a criterion or retrieval, which stops the tool contradicting its own scaffold; it does not give the migrated spelling anywhere to go, and its PR says so.

The second half is the gate. `Retrieval` (`ddd.langium:1678`) has no `requires` slot — compare `FindDecl:1405`, which does. So the spelling the compiler recommends is also the one that cannot be gated, which blocks M-T3.19's story for the list read and leaves `scaffoldPaged` with `of:` and nothing else.

**The fix, in the order the slices must land:**

1. `Retrieval` gains `('requires' gate=Expression)?`, lowered to the same `ExprIR` position `FindDecl.gate` already occupies, so the five backends' existing gate renderers apply unchanged.
2. A route per retrieval on all five backends, parameters bound from the retrieval's own `params` — the same threading `projection` reads now use after #2861 slice 1 (`src/platform/hono/v4/projection-query-routes-builder.ts` is the worked reference; the .NET/python/java/elixir twins are named in that commit).
3. `scaffoldPaged` / `scaffoldPagedApi` retire: their reason to exist is that a retrieval had no route. #2877 explicitly declines to bolt a second gate parameter onto them for this reason.
4. The interim narrowing in #2874 is deleted in the same PR that lands slice 2 — a waiver ratchets, so the fix removes it rather than leaving both rules standing.

**Verification when it lands.** Per-backend route-emission cases (the five-case shape of `test/system/projection-param-threading.test.ts`), a gated-retrieval 403 case, and the generated node project booted against Postgres so the route is proved to answer a filtered read, not merely to exist. Mutation-proof each gate by file-copy revert.

Claimed by the #2861 author; #2874 and #2877 both defer to this mission by name.

## M-T5.32 — A declared `create`'s parameter list is not the request contract, and `loom.create-params-not-wire` only says so — `open` · **M** · P1 · blocked(#2882)

The honest gate shipped in #2861 slice 4. It is a diagnostic standing in for a missing capability, so it is not a terminal state: this mission is what deletes it.

Today `POST /<plural>` always takes the **field-derived** create input. A narrowed parameter list on a declared `create` shapes nothing, so an author who writes `create(title: string)` against a five-field aggregate gets a client for a contract they did not declare — the generated `test e2e` suite failed at runtime with a 422 naming a field the create does not accept. `loom.lifecycle-body-dropped` does not cover it: the ubiquitous `field := <same-named param>` idiom is exempt there, and that is exactly the shape that misleads.

**The fix:** the declared parameter list becomes the create input — wire schema, route binding, and the frontend `CreateForm`'s field set all derive from it rather than from the aggregate's fields.

**Why blocked.** Narrowing the input widens an existing bug: a `managed`/`internal` field's declared default is currently discarded by the create input and replaced with the type's zero value (`tier: int managed = 7` arrives as `0`), which #2882 is fixing. Narrowing first would make every field dropped from the input silently zero rather than defaulted. Land #2882, then this.

**Verification when it lands.** A create-with-narrowed-params case per backend asserting the emitted wire schema has exactly the declared fields; a defaulted `managed` field asserted to arrive at its declared value, not the zero value; and `loom.create-params-not-wire` deleted in the same PR, with its `FIRING_FIXTURES` entry and docs anchor removed (`test/system/diagnostic-firing-census.test.ts` fails on an orphan, which is the ratchet that keeps this mission honest).

## M-T5.33 — A page-body lambda parameter has no type, so every member off it resolves as `string` — `open` · **M** · P1

`src/ir/lower/lower-expr.ts:1214` lowers a bare lambda with a hard-coded placeholder element type:

```ts
if (isLambda(expr)) {
  // A bare lambda outside a collection-op call site has no known param
  // type — the string placeholder matches the legacy behaviour.
  return lowerLambda(expr, env, { kind: "primitive", name: "string" });
}
```

The collection-op path two hundred lines up does it correctly (`collElem && isLambda(a.value) ? lowerLambda(a.value, env, collElem) : …`), so the element type is available — it is simply not threaded to the bare-lambda site. Every `receiverType` / `memberType` derived inside such a lambda is therefore wrong, which defeats the IR's central promise that backends never re-resolve.

This is the enabling change for the formatter work: a per-type formatter table cannot route `Text`'s child while every page-body field types as `string`. #2871's D4 is downstream of it.

**The fix:** thread the known element type to the bare-lambda call site the way `applySuffixToRecv` already does, and make the no-known-type case a diagnostic rather than a silent `string`.

**Verification when it lands.** IR-level cases asserting `memberType` on a member access inside a page-body lambda over a non-string collection; the `string` placeholder removed rather than left beside the fix.

Claimed by the #2861 author, offered to #2871 first as the enabling half of their D4.

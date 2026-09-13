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

## M-T5.28 — `variant-match` off a page crashes all five backends; `for`/`if let` off a workflow emits `this.<unknown>()` — neither is gated — `done` (2026-09-11, Wave C1 packet 1b) · **M** · P1

Found 2026-09-03 by the language-docs audit ([F1](../audits/2026-09-03-language-docs-audit-findings.md), [F4](../audits/2026-09-03-language-docs-audit-findings.md), both P0). A `match` over a union in a domain body reports `0 error(s)` and then throws `variant-match statement is frontend-only; it must not reach the <X> backend` from `src/generator/_stmt/target.ts:160` on node, dotnet, java, python and elixir alike — no IR check covers `variant-match` outside a page (`src/ir/validate/checks/store-checks.ts` handles only the page case), and non-exhaustive arms are unchecked too. Symmetrically, `src/ir/lower/lower-stmt.ts` has no arm for `ForStmt`/`IfLetStmt` outside a workflow and no validator rejects them: `operation touch() { for n in notes { owner := n } }` reports `0 error(s), 0 warning(s)` and emits `this.<unknown>();`.

**Resolve the fork before coding.** Each shape can be *gated* or *lowered*. The default is **gate** — both are frontend/workflow-only by design per the source comments, and a gate is S where lowering is L. If the design pass concludes lowering is right, that is a `language-feature-developer` mission: split it out and say so rather than widening this one. Mints codes in `src/diagnostics/messages.ts` — the only Wave-3 packet that may.

**Verification when it lands.** Both shapes raise a `loom.*` code with the offending span; each gate mutation-proved by file-copy revert, reading *which* assertion fails.

**Also carries M-T5.27's residue (re-homed 2026-09-10, Wave C0.4).** [#2789](https://github.com/Loom-Harness/Loc/pull/2789) minted `loom.locator-matcher-receiver` in `src/language/validators/match.ts:151`, deliberately re-deriving the ui-e2e renderer's handle rule at the AST layer because `src/ir/validate/checks/**` was another packet's tree. Its proper home is `validateE2ETest` (`src/ir/validate/checks/test-checks.ts:132`), which already walks these statements with the resolved IR and today has no `locator` handling at all. Consolidate it here while in the file. The mutation proof makes the case that gate and renderer are genuinely independent: under the *renderer* mutation the validator still passed the source and the renderer crashed, so neither alone covers F6.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F1/F4 + "Cross-cutting reading" §2, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.1**; M-T5.27's `loom.locator-matcher-receiver` consolidation.

**Landed 2026-09-11 (Wave C1 packet 1b).** All three shapes **re-verified on this head before building** — the `match` still threw on all five backends (`variant-match statement is frontend-only; it must not reach the {TS,.NET,vanilla Elixir,Java,Python} backend`), and `for` / `if let` still emitted the `<unknown>` sentinel: `this.<unknown>()` on node/.NET/Java, `self._<unknown>()` on python, `_ = <unknown>(record)` on elixir. The fork resolved as **gate on all three**, per ruling D-FOR-IN-DOMAIN ([completion-waves-2026-09](completion-waves-2026-09.md) §5 #3), with the honest-gap/permanent-refusal split the ruling asks for: `loom.variant-match-placement` and `loom.if-let-placement` say "permanent placement rule", `loom.for-placement` says "a GAP, not a design rule" and names **M-T5.30** as its successor.

The gate is **phase ④**, not phase ⑦, and that was the one real design call: `for` / `if let` outside a workflow have **no IR node at all** — `lower-stmt.ts`'s fallback has already replaced them with the `<unknown>` call sentinel before an IR check leaf could look — so an IR-level gate could only match on the sentinel, a proxy for the defect rather than the defect. Containment alone decides all three answers, so the check needs nothing lowering would add. One new leaf, `src/language/validators/stmt-placement.ts` (a single `streamAllContents` pass classifying each statement's body owner as frontend / workflow / domain); the `src/generator/_stmt/target.ts` throw survives as an internal-invariant assertion for a caller that generates without validating, with a `default:` arm keeping the `StmtIR.kind` switch exhaustive.

Refusal fixtures live at `test/language/validators/fixtures/stmt-placement-*.ddd` beside their gate, **not** in `test/fixtures/corpus/`: that corpus is a positive matrix (`corpus-coverage.test.ts` requires every `<id>.ddd` to GENERATE on each declared backend) and carries no `expectDiagnostics`-style key in `manifest.ts` or its harnesses, so an expected-diagnostic fixture has no row shape there. A fourth fixture, `stmt-placement-allowed.ddd`, is the over-fire guard — all six legal sites (workflow `create` + `commandHandler` × `for`/`if let`, plus a page `action`'s `match await`) in one source. Four mutation proofs by file copy, each naming its failing assertion, in the hand-off note.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F1/F4 + "Cross-cutting reading" §2, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.1**, hand-off [`waves/handoffs/wave-c1-1b-placement-fork.md`](waves/handoffs/wave-c1-1b-placement-fork.md).

## M-T5.29 — Two `system` blocks with no top-level members pass validation — `open` · **S** · P2 ⚠ verify-first

Found 2026-09-03 by the language-docs audit ([F36](../audits/2026-09-03-language-docs-audit-findings.md), P3). `composition.ts:120-137` only fires when a top-level member must fold into a system, so a source declaring two member-less `system` blocks validates clean; `generate system` then writes only the root artefacts. There is no direct "exactly one `system`" gate.

**The fix:** a direct arity check in `src/language/validators/composition.ts`, independent of whether anything needs folding.

**Verification when it lands.** A negative validator test for the two-system source; mutation-proved by file-copy revert of the check.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F36, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W3.2**. Relates to M-T5.13 (the zero-system synthesis decision — the other end of the same arity question).

## M-T5.30 — `for … in …` in a domain body: lower it, or make the refusal permanent — `open` · **M** · P3

Minted 2026-09-11 by **M-T5.28** as the named successor its `loom.for-placement` message points at — the honest-gap half of ruling D-FOR-IN-DOMAIN ([completion-waves-2026-09](completion-waves-2026-09.md) §5 #3). `for x in xs { … }` is lowered only by `lowerWorkflowStatement` (workflow `create` / `handle` / `on`, plus top-level `commandHandler` / `queryHandler`); in an aggregate `operation` / `create` / `destroy` / `apply`, a `function`, a domain-service operation or a projection `on` fold it is now REFUSED rather than lowered to the `<unknown>` call sentinel. Nothing about a loop is workflow-specific — only the **per-iteration repository save** the workflow lowering owns is, and a domain body has no repository to save through.

**The question this mission answers:** is a domain-body `for` meaningful over a *containment* or a *value array* (`for l in lines { l.markVoid() }`), where no repository save is involved and the loop is pure in-aggregate mutation? If yes, it is a `StmtIR` kind + one arm in each of the five `StmtTarget` leaf tables (`src/generator/{typescript,dotnet,elixir,java,python}/render-stmt.ts`) and the `_stmt/target.ts` spine, which already owns one nesting recursion (`if`). If no — because the collection ops (`.sum` / `.any` / `.count` / `.filter`) already express every reachable use and a mutating loop over a containment has no defined save semantics — then `loom.for-placement`'s message loses its "GAP, not a design rule" clause and becomes the third permanent placement rule beside its two siblings. Either end closes it; silence does not.

**Verification when it lands.** If lowered: a corpus fixture whose `for` runs in a domain body, generating and COMPILING on all five backends (rule 13 — the fixture is extended until every emitter arm a mutation names goes red). If declined: the message change plus the assertion in `test/language/validators/stmt-placement.test.ts` that currently pins `M-T5.30` in the text, flipped to pin "permanent placement rule" instead.

Sources: [M-T5.28](#m-t528--variant-match-off-a-page-crashes-all-five-backends-forif-let-off-a-workflow-emits-thisunknown--neither-is-gated--done-2026-09-11-wave-c1-packet-1b--m--p1) and its hand-off [`waves/handoffs/wave-c1-1b-placement-fork.md`](waves/handoffs/wave-c1-1b-placement-fork.md); [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F4.

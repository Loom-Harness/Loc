# T5 — Language core & type system

> **Completed missions for this track live in [`archive/T5-done.md`](archive/T5-done.md)** (6 closed as of 2026-09-02). This file lists only the live missions.

*The expression language is deliberately small; these missions finish the in-flight type-system families (errors-as-data, criteria, payloads), close audited correctness bugs, and keep the surface honest.*

## M-T5.1 — Exception-less completion (A4/A5/A6 + VO→422) — `partial` (VO→422 `done`, A4's consumer half + load-path parity `done`, A6 superseded; A4's `getById` retype awaits an owner ruling, A5 blocked on the effect-form `match` — Wave C5 moment 5c, 2026-09-28) · **L** · P1 ⚠ coordinated
The remaining errors-as-data arc: **A4** re-shape `Repo.getById` from `: X` to `X or NotFound` (`: X?` → `X option`) — THE coordinated single-PR fixture re-baseline across all backends; **A5** parse-intrinsic/external-api results as `or`; **A6** `validate for X` → `X or ValidationError[]`; VO-construction `invariant` → 422 routing with RFC-7807 `errors[]` (failure-taxonomy's highest-leverage piece); variant-`match` with scrutinee + variant-pattern binding (real prerequisite — `match` is boolean-guard-only today). The `?` propagation operator stays DROPPED — do not reintroduce.
Sources: [exception-less](../old/proposals/exception-less.md), [failure-taxonomy](../old/proposals/failure-taxonomy.md), [implementation-plan](../old/proposals/implementation-plan.md) decision table.

**Moment 5c (2026-09-28) — measured first, then built; full record in [`waves/handoffs/wave-c5-5c-exceptionless.md`](waves/handoffs/wave-c5-5c-exceptionless.md).** The premise "`match` is boolean-guard-only" is stale: the **value** form (`match r { Order o => o.code, NotFound => … }`) ships on all five backends over union finds and `or`-returning ops (a presence check for the absence shape); only the **effect** form (arms that run statements) is frontend-only (`loom.variant-match-placement`).
- **VO→422 — `done`.** A value object BUILT by a body (`qty := Qty { value: n }`) and refused by its constructor answers the domain floor plus one `errors[]` entry `{pointer: "", message, code?}` on all five (was: bare domain floor on four, and elixir did not check the value at all — `resize(0)` → 204). Corpus fixture + wire golden `vo-invariant-in-body`; runtime-proven on node, python, elixir; RS-9 carries the rule.
- **A4 — the consumer half `done`, the retype NOT done (owner ruling wanted).** `loom.union-read-undiscriminated` refuses reading a union straight through (`r.code`, `r.touch()`) — it was an unguarded dereference on all five (TS18047 / CS8602 / NPE / AttributeError / KeyError). The `getById` miss answers the declared 404 on the GET route, an operation route and a workflow step alike (elixir's workflow miss said "Resource not found"; fixed). Retyping `getById` itself to `X or NotFound` is NOT built: with `?` dropped and no effect-form `match`, every `let o = Repo.getById(id); o.op()` in the corpus would become a type error, and failure-taxonomy (which revisits exception-less) classifies not-found-on-load as a **policy** ("declarative, auto-mapped, never named") and softens A4 "from law to default + `: X?` opt-out" — which is what ships: a find opts into the union by declaring `X or NotFound` / `X option`. The owner decides whether A4's letter stands (see the hand-off note §5).
- **A6 — superseded.** `validate for X` was never grammar; failure-taxonomy calls it "a hallucination in an earlier draft" and routes validation to the VO `invariant` — the VO→422 row above.
- **A5 — blocked on the effect-form `match`.** No parse intrinsic exists to re-shape; the typed in-system api call (M-T4.8) is the external-call site, and making it `T or ApiError` is only consumable once a workflow can ACT in a `match` arm. **Remaining (sized, L):** the effect-form variant `match` in domain + workflow bodies — a new `WorkflowStmtIR` kind, five `StmtTarget` leaves (the `_stmt/target.ts` throw), four `WorkflowStmtTarget` leaves plus the elixir `with`-chain branch, `walk.ts` + census, and flipping `loom.variant-match-placement` from permanent to lifted for those owners.

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
I4 per-concrete storage override / mixed strategy (gated; UNION-ALL variant was dropped — re-justify before building); polymorphic `<Base> id` refs (→ `loom.polymorphic-id-ref-unsupported`, wave C2 packet 2f).
Sources: [aggregate-inheritance](../old/proposals/aggregate-inheritance.md), [dotnet-tph-emission](../old/proposals/dotnet-tph-emission.md) follow-on.

- **`<Concrete>Id → <Base>Id` threading — DONE** (wave C2 packet 2b). Two findings, because the mission's "~49 application-layer sites" had already split in two by the time it was picked up.
  - The sites it NAMES — the concrete handled by its OWN id — were already threaded on fresh `main`: `src/generator/dotnet/emit/repository.ts`, the Mediator command/query records, the controller route param and the response DTO all say `PartyId` for a `Customer` (verified by generating `test/e2e/fixtures/dotnet-build/tph.ddd`: two `CustomerId` occurrences in 71 files, both the id class's own declaration). Pinned by `test/generator/dotnet/dotnet-tph.test.ts:55`/`:75`.
  - The residue it did NOT name was the identity that LEAVES the hierarchy: a cross-aggregate `customer: Customer id`. Each emitter renders a referenced id as `${targetName}Id` from the IR's own `targetName`, independently, in ~20 places, so the field / event record / commands / EF value-converter said `CustomerId` while `ICustomerRepository.GetByIdAsync` said `PartyId`. The two only MEET where generated code passes one to the other, so it needed a third construct to surface: a reactor's `Customers.getById(e.customer)` emitted `CS1503: cannot convert from 'CustomerId' to 'PartyId'` with `ddd parse` reporting 0 errors. Fixed at the root rather than per emitter: a TPH concrete's `Domain/Ids/<Concrete>Id.cs` is now a `global using` ALIAS for `<Root>Id` (`renderTphConcreteIdAlias`, `src/generator/dotnet/emit/ids.ts:7`), so all ~20 spellings name one CLR type by construction and the DSL-level name survives in signatures. Corpus fixture `test/e2e/fixtures/dotnet-build/tph-crossref.ddd` (TPH × cross-aggregate ref × a handler that loads through it — the crossing no existing fixture reached), gated by `dotnet build /warnaserror`.

## M-T5.8 — Lifecycle operations phases 3–5 — `partial` · **M** · P3
Backend route emission per action kind + action-param walking in API generators; `crudish` reframing (`createOp`/`destroyOp` factories); scaffold macros emit noun-named ops by default (+ fixture re-baseline).
Sources: [lifecycle-operations](../old/proposals/lifecycle-operations.md).

## M-T5.9 — Surface hygiene: signposting + with/implements — `open` · **S–M** · P2 ⚠ (b) is BLOCKED on its own two open questions (measured 2026-09-22, wave C4 packet 4f)
(a) `loom.reserved-not-emitted` diagnostic routed through every parse-but-no-emit surface (old S1 — additive, self-emptying); (b) the `with`/`implements` keyword-kind split + fix-it + codemod (old S4). S2 redundancy cuts are DONE (#1795).

**Measured on the folded C4 tree (packet 4f); neither half taken, both with the reason:**

- **(a) the MECHANISM has landed; the DENOMINATOR has not.** `src/ir/validate/checks/reserved-surfaces.ts` is the single registry (`RESERVED_SURFACES`) behind one meta-diagnostic, with wording in `messages.ts`, a live `code-docs.ts` anchor, a firing fixture, and a no-stale-rows reachability test (`test/ir/reserved-not-emitted.test.ts`). It carries **3 rows** — `timer-source-timezone`, `timer-source-overlap`, `storage-connection`. **The DENOMINATOR now exists** — `test/system/inert-ir-field-census.test.ts` (wave C4 packet 4f): an IR field declared in `loom-ir.ts` and referenced by NO file under `src/generator/**`, `src/system/**` or `src/platform/**` is a candidate parse-but-no-emit surface. **Measured: 27 of 330 declared fields**, on a shrink-only exact baseline with an anti-slack arm, so a NEW unread field fails until it is given a reader, dispositioned, or given a `RESERVED_SURFACES` row. Mutation-proved by seeding an unread field onto `WorkflowIR`. The baseline is deliberately not zero: the scan over-approximates in one direction (IR-internal plumbing like `loadPlan`/`resourceInterfaces`, reads through a destructure, and fields the `ddd verify` / CLI surfaces consume instead of an emitter).

**Three CONFIRMED by hand, each owed a `RESERVED_SURFACES` row — that work is `src/ir/validate/checks/**` (packet 4c's fence), so it is handed off, not taken:**
- `uiBindings` + `sourceDeployableName` — written by `src/ir/lower/lower-deployment.ts:139,142,185` from a `uiCompose { … }` clause and read by **nothing**. The clause parses, lowers, and vanishes.
- `accessSource` — stamped beside `access` (`lower-members.ts:141`, `enrich/enrichments.ts:1890,1909`, values `declared`/`default`/`stamp`). `access` IS read downstream; the provenance half is not.

What remains on (a) is therefore the rows, not the measurement: one `RESERVED_SURFACES` row per confirmed find (each deleting its name from the census baseline in the same PR), plus a disposition pass over the other 24 candidates. Size **S**.
- **(b) BLOCKED on the proposal's own §Open questions, and one is an owner call.** [`with-implements-split.md`](../old/proposals/with-implements-split.md) §OQ1 says plainly it is "not a soft 'open' item": the headline ergonomics (`aggregate Build with crudish implements versioned { … }`) put `implements` in HEADER position, and the grammar admits it only as a MEMBER (`ImplementsDecl`), so the split needs a grammar extension plus a Langium-ambiguity check on `with … implements …` before the `{` — and if that is ambiguous the proposal falls back to a different shape entirely. §OQ2 is a product decision: hard cutover (codemod + validator error), or a release where `with <capability>` warns before it errors. Packet 4f declined to force either, particularly right after packet 4d reshaped the callable grammar into three shared fragments. Size once unblocked: **L** (grammar + regenerate + a `print-structural` arm + the validator + fix-it + a `scripts/` codemod with a test + a byte-identical proof across eleven targets).
Sources: [reserved-surface-signposting](../old/proposals/reserved-surface-signposting.md), [with-implements-split](../old/proposals/with-implements-split.md).

## M-T5.10 — API derivation completion — `partial` · **M→L** · P2 ⚠ verify-first
`commandHandler`/`queryHandler`/`route` shipped on all 5 (+scaffold A3.2/A3.3). **Verified 2026-07-14 (state audit): the "full response-DTO projection + `[FromBody]` request records" item is STALE — already shipped** (`<Handler>Body`/`@RequestBody`/Pydantic request records on 4/5 backends; response projection via repo `toWire`/`projectToResponse`). The genuine gap was **Layer 2 (contract)** — no `scaffoldResponse`/`command`/`query` records existed; handlers took flat scalars + returned bare aggregates.
- **PR1 (contract-record layer) landed** (#1900) — `scaffoldHandlers` now splices source-visible literal `response`/`command`/`query` `PayloadDecl` records (`src/macros/api/factories.ts` `payload`/`response`/`command`/`query` + `apiReadFields` = AST twin of `forApiRead(wireShape)`; `src/macros/stdlib/scaffold/_contracts-shared.ts`). Macro-layer only, additive + **inert** (byte-identical generation, proven). `unfold` ejects the contract as real `.ddd`.
- **PR2–PR6 (response-DTO read-rewire) landed — all 5 backends** (#1905 .NET, #1909 Hono, #1910 Python, #1911 Java, #1912 Elixir). Each backend's response-DTO/schema emitter now READS the declared `<Agg>Response` record (override-by-name on `ctx.payloads`) instead of re-deriving from `wireShape`: .NET record params, Hono zod schema, Python Pydantic model, Java record + `from()` mapper, Elixir OpenApiSpex schema. The `id` row (grammar-reserved, omitted) is re-prepended and containment fields (already `<Part>Response`) map via an `isResponsePayloadName` guard (no `<Part>ResponseResponse` double-suffix). Each PR is **byte-identity + divergence gated** (scaffolded record ≡ wireShape baseline; a hand-declared divergent record emits differently). PR2 also threaded `env` into `lowerPayload`/`lowerField` (macro-spliced refs skip the Langium Linker). The DTO's source of truth now moves from enrichment-stamped `wireShape` to the declared contract.
- **PR7 (handler-param rewrite) landed — all 5 backends** (branch `claude/handler-param-record-rewrite-atf3cj`). The scaffold + all 5 explicit-handler emitters now consume a single `command`/`query` **record param** (bodies reference `cmd.<field>`/`query.<field>`) instead of flat scalars, and the read handlers (getById/find) declare `<Agg>Response`/`<Agg>Response[]` returns. Path-param ids stay separate handler params (a route `{id}` can't live in a body record); query records assemble from path+query-string; empty command records (cancel-no-params, destroy) are omitted → `(orderId: Order id)`. Wire-preserving return contract: create keeps `<Agg> id`, operation/destroy stay void, reads declare their `<Agg>Response` (transport already projects entities to it, so the request/response wire is **byte-identical**). Grammar/IR-shape unchanged — payload-param member access reuses the workflow-`handle` machinery (`memberOnPayload`). Two shared helpers in `src/ir/util/handler-contracts.ts` — `requestRecordFor` (identify a record param) + `normalizeHandlerReturn` (map `<X>Response` → entity X for the internal type + projection trigger). Each backend keeps its transport idiom: Hono materialises the record from per-field wire sources (+ fixed a latent single-entity-only projection bug: find arrays now `r.map(x => repo.toWire(x))`); .NET/Java/Python/Elixir FLATTEN the record into their existing Mediator record / `@RequestBody` / Pydantic `Body` / string-keyed map (byte-identical to the flat form), rendering `cmd.<field>` as the flat field via a `recordParams` set threaded into each `render-expr`. Compile-gated on every backend (new `scaffold-handlers` fixtures: Hono `tsc`+`tsup`, .NET `/warnaserror`, Java `gradle bootJar`, Python `ruff`+`mypy --strict`, Elixir `mix --warnings-as-errors`). Hono 200 `z.unknown()`→`<Agg>Response` tightening is the separate #1917 tail. **M-T5.10 input+output axes now complete; only the spun-off `wireShape` retirement remains.**
- **Spun off — re-measured and re-scoped by wave C4 packet 4e (2026-09-22), and the spin-off text below was STALE.** "the `wireShape` retirement (proposal steps 6–8) — 179 refs / 49+45 files, XL" counted the wrong thing: **steps 6 and 7 already shipped** (#1920 Phase 1, #1937 Phase 2 — the phase-⑥ stamp and `wireShapeFor` are gone, `EnrichedEntityPartIR`/`EnrichedValueObjectIR` alias their base types), so the 179 refs are call sites of the PURE RECOMPUTE helpers in `src/ir/enrich/wire-projection.ts`, which is what "derive, don't stamp" asks for — not readers of a denormalised field. What actually remains is the OPPOSITE direction and is now **M-T5.40**: the declared `<Agg>Response` records PR2–PR7 pointed every response-DTO emitter at do not reproduce the derived shape (25 of 126 contracted corpus nodes diverge), and three of those classes are live emission defects. Step 8 (`.loom/wire-spec.json` retirement) is declined: [`D-WIRESHAPE-KEEP`](../decisions.md).
- **Still open on THIS mission:** the extern-handler LSP / scaffold polish tail (unsized, P3) — the only reason it is still `partial`.
Sources: [unfoldable-api-derivation](../old/proposals/unfoldable-api-derivation.md) + [coordination note](../old/proposals/unfoldable-api-derivation-coordination-note.md).

## M-T5.12 — Typed-capabilities tail — `partial` · **M** · P3
Phase 5 remainder: LSP tooling (go-to-capability, find-implementors, completion) + marker-interface emission `I<Capability>`; then the [capability-emission-dedup](../old/proposals/capability-emission-dedup.md) stamp-dedup ladder (deferred until a second stamping capability exists). Also the persist-time auditing simulations (node awaiting §7 sign-off; Java §5-vs-§6-ALT fork).
Sources: [typed-capabilities-implementation](../old/plans/typed-capabilities-implementation.md) Phase 5, [node-persist-time-auditing-simulation](../old/plans/node-persist-time-auditing-simulation.md), [capability-stamp-dedup-simulation](../old/plans/capability-stamp-dedup-simulation.md).

## M-T5.13 — Multi-file & composition tails — `partial` · **M** · P3
Stage B cross-context `X id` identity refs via `uses`/`export`; zero-system synthesis decision; `ui with scaffold` cross-file gate test. (Stages C+ stay deferred indefinitely.)
Sources: [multi-file-source](../old/plans/multi-file-source.md), [implicit-system-composition](../old/proposals/implicit-system-composition.md).

## M-T5.14 — Domain-services Shape B — `open` · **M** · P3
The coordinator shape (Phase 2); Shape C stays deferred. Plus shipped-tier refinements (read-port shape, `audited` on service ops).

**Read-port shape — the explicit-handler caller.** A `reading`-tier operation declares one read-port repository parameter per repository it reads, and the ORCHESTRATOR supplies the handle. A `workflow` is not the only orchestrator: an explicit `commandHandler`/`queryHandler` can call one too, and no backend's handler emitter threaded it (ledger `M-T5.14-reading-service-readport-not-threaded`, issue #2649). **node** closed in improvement wave 1 (packet 1c); **python** closed in completion wave C2 (packet 2e) — `src/generator/python/explicit-handlers-emit.ts` builds its render context with `readPortArgs: pyReadPortResolver(ctx)`, folds `collectServiceReadPorts(h.statements, ctx)` into the repo set it constructs, and emits the `app.domain.services.*` import line the module had never had at all; both helpers are the workflow builder's, exported rather than copied, over the shared `readPortsForOperation` (`src/ir/util/domain-service-read-ports.ts`). Gate: `test/generator/python/handler-domain-service-read-port.test.ts`. **dotnet, java and elixir closed in completion wave C2 (packet 2f)** — and the handle's shape is what made them three separate fixes rather than one: on **.NET** and **java** a `reading` service is an injected OBJECT holding its own repositories, so the handler constructor-injects the SERVICE (`src/generator/dotnet/explicit-handlers-emit.ts` folds `workflowReadingServiceCallResolver(ctx)` into its `renderArg` and adds the `<ns>.Domain.Services` using; `src/generator/java/explicit-handlers-emit.ts` threads `serviceReading` into the render context and injects the `@Service` bean); on **elixir** there is no handle at all — a reading op is a CONTEXT FUNCTION with the ambient `Repo` — so `src/generator/elixir/vanilla/explicit-handlers-emit.ts` threads `domainServiceTier` + `readingServiceModule` and the call becomes `Context.is_holder_free(holder)` instead of a module (`D.Domain.Services.Registration`) that is only emitted for PURE ops. A **second defect** rode along on java and .NET: the PURE call had no import/using either, so `FeeQuote.forAmount(amount)` was "cannot find symbol" / CS0103 in a handler while the identical call compiled in a workflow. The "which services does this body call, and at which tier" walk now lives once in `src/ir/util/domain-service-read-ports.ts` (`domainServicesCalled` / `isReadingServiceOp`) beside `readPortsForOperation`, instead of a fourth per-backend copy. Cross-backend gate: `test/generator/handler-domain-service-read-port-parity.test.ts` (node as the control); corpus shape: `handler-triad.ddd`, compiled on all five.

**Read-port shape, the other narrowing — a read in MEMBER-RECEIVER position.** `loom.domain-service-read-unsupported` refuses `Accounts.byHolder(h).balance` in a `reading` body: `matchRepoRead` requires the read to be the WHOLE expression (`suffixes.length === 1`), so a read under a member access never becomes a `repo-read`, the operation is classified `pure`, no port is threaded, and every backend emits the bare repository name (TS2304 / CS0103 / "cannot find symbol" / F821, and invalid Elixir). The author's rewrite is to bind it first (`let x = …`), which the diagnostic says. Retiring it means widening the detector and re-applying the trailing suffixes in `lower-domain-service.ts` — a refinement of THIS mission's tier, so the register row points here (wave C2 packet 2f gave it the owner it lacked). A related, narrower gap was closed on the way: `inferExprType` had no repo-read probe at all for a service body, so even the SUPPORTED bound spelling mis-typed (`src/ir/lower/lower-expr.ts`).

Sources: [domain-services](../old/proposals/domain-services.md).

## M-T5.36 — the binding vocabulary for declared finds that are optional or plural — `open` · **M** · P3
Three register `scope` rows, one mechanism. A workflow / handler / domain-service body may bind a repository read with `let`, but only when the read yields a SINGLE NON-NULLABLE aggregate:

- `loom.workflow-load-array-unsupported` — `let xs = Orders.byCode(c)` where the declared find returns `Order[]`
- `loom.workflow-load-nullable-unsupported` — the same where it returns `Order?`
- `loom.handler-load-nullable-unsupported` (+ its `#domain-service` slug) — the nullable case in a `commandHandler` / `queryHandler` / `domainService` body

The two statement forms that WOULD express them already exist and already render — `if let x = …` and `for x in …` — but their sources are pinned one notch narrower than the `let` they would replace: `loom.iflet-bad-source` accepts only `Repo.find(<Criterion>)` and `loom.workflow-foreach-source` only a `Repo.run(...)` result (measured 2026-09-14 on a declared `find byCode(c: string): Order?` / `: Order[]` — both spellings are refused today). So the successor is not a new construct: it is widening those two sources to any declared find of the matching shape, and giving the handler / domain-service bodies the `if let` arm the workflow body already has (`checkStatementPlacement` currently confines `if let` and `for` to the `workflow` zone).

**Why it is honest today rather than silent.** Each of the three replaced an unguarded dereference of a binding that can be null — TS18047 on node, CS8602 under `/warnaserror` on .NET, an NPE on java, `AttributeError` on python, a `KeyError` on nil in elixir — i.e. output that does not compile or does not run. The current advice (`use getById`, which throws → 404) is a real rewrite for the by-key case and no rewrite at all for "find it if it exists".

**Acceptance.** The three codes are deleted from `src/diagnostics/unsupported-register.ts` and `MAX_OPEN_GAPS`/the scope roster move in the same PR; `if let` over a declared optional find and `for` over a declared array find render on all five backends with a corpus fixture that COMPILES on each; the handler and domain-service bodies accept `if let`; the `#domain-service` message slug goes with its parent.

Sources: [domain-services](../old/proposals/domain-services.md), [workflow-and-applier](../old/proposals/workflow-and-applier.md); `src/ir/validate/checks/workflow-checks.ts`, `src/ir/validate/checks/api-checks.ts`.

## M-T5.16 — Compiler-internal fragility guards — `partial` ((a) and (c) LANDED, (b) MEASURED — wave C4 packet 4f, 2026-09-22) · **S** · P2

**(a) LANDED — and there were THREE parallel walkers, not two.** `typeAfterSuffix`, `stepInto` and `stepIntoNode` (`src/language/type-system.ts`) all answer "what does `recv.member` denote?" and all three were `if (t.kind === …)` chains falling through to a silent `T.unknown` / `undefined`. Each is now a `switch (t.kind)` covering every `DddType` member with a `const _exhaustive: never` default (the `src/ir/util/walk.ts` idiom), arm-for-arm behaviour-preserving. The divergence was already real and recorded nowhere — **`userclaim`, `id`, `array` and `primitive` resolve members on `typeAfterSuffix` and resolve to `unknown` on `stepInto`** — and is now declared data (`MEMBER_RESOLVING_KINDS`), asserted by `test/language/type-system/walker-exhaustiveness.test.ts`. Mutation-proved by file copy: adding a `{ kind: "probe" }` arm to `DddType` fails `tsc -b` at all three sites at once (`type-system.ts(1209,13)/(1845,13)/(2261,13)`, TS2322 "not assignable to type 'never'") and fails the runtime pin three times naming `probe`. Byte-identical on the 395-cell corpus snapshot.

**(b) MEASURED, not narrowed — and the number is the finding.** `test/system/unknown-cascade-census.test.ts` pins the **21 suppression sites across 6 files** on an exact shrink-only baseline (adding one to a clean file fails, naming it — mutation-proved by seeding one into `validators/repository.ts`), and measures what stands behind the stop sign: **28 333 of 46 492 corpus expression nodes — 60.9 % — type as `unknown`** under the shared `envForNode` env, overwhelmingly `NameRef` (13 886) and `PostfixChain` (11 773). Read it as an UPPER BOUND on what the validators suppress (`envForNode` types `let` bindings as `unknown` by its own admission, and a validator building its env inline sees fewer) — but that is the SECOND finding, not a caveat: every LSP hover / go-to-definition / completion consumer reads the same env. **Still open, and both halves are `src/language/**` behaviour changes outside packet 4f's fence:** narrowing each of the 21 sites from "suppress every downstream check" to "suppress the one that would cascade", and giving `envForNode` real `let`-binding types. Recipe in [`waves/handoffs/wave-c4-4f-hygiene.md`](waves/handoffs/wave-c4-4f-hygiene.md).

**(c) LANDED as a pin, with a measurement that says #22 does not reproduce today.** `test/macro/expansion-rebuild-idempotence.test.ts` drives the real `DocumentBuilder` through the three rebuild shapes an editor produces — host re-edited, SIBLING edited with the host untouched, sibling removed and restored — and asserts the spliced member count is stable. Measured on Langium 4: a sibling-triggered rebuild REPLACES the host's AST object (a re-parse), so the doubling C5 feared cannot occur; the test records which regime it observed in its own failure message, so the claim stays honest if a future Langium reuses the AST. Mutation-proved by seeding BOTH defenses off at once — a second `expandModel` call in the listener AND `mergeScopedMembers`'s override-by-name dedup disabled — pages 8 to 24. **That there are TWO independent defenses, neither written down, is itself the finding.**
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
## M-T5.21 — Callable unification: one production for "a named body runs here" — `partial` · **L** · P2 ⭐ cost-of-growth

**Phase 1 LANDED (wave C4 packet 4d).** The grammar's callable surface is one production — three shared fragments (`CallableLeadModifiers` / `CallableSigModifiers` / `CallableGates` in `ddd.langium`) included by all twelve callable rules — and the per-site differences are declared data: `CALLABLE_SITES` (`src/language/callable-sites.ts`) read by ONE validator (`src/language/validators/callable-sites.ts`), so an excluded modifier reports **why** (`loom.callable-modifier-not-allowed-here`, one catalog arm per site kind) instead of failing as an unexplained parse error. The `lower/` half of the finding is drained too: the seven copies of the callable parameter binder are one leaf (`src/ir/lower/callable-params.ts`), with the one real divergence — whether a `param: T = <expr>` default is lowered — a parameter of the helper rather than a fork of it. Gated **byte-identical on all eleven targets** — the corpus snapshot (395 cells / 26 424 emitted files, five backends) plus a matching frontend snapshot over `examples/` + `web/src/examples/` (70 sources / 6 439 files, all six frontends), because every corpus fixture is backend-only and the widening reaches `ActionDecl` — with `print-completeness` + `print-structural-roundtrip` green and three mutation proofs. **Phases 2–4 remain open** — the six duplicate `loom.workflow-*` diagnostic pairs, the one `extern` spelling, and re-deriving the exclusions row by row; the hand-off ([`waves/handoffs/wave-c4-4d-callable.md`](waves/handoffs/wave-c4-4d-callable.md)) carries the recipe and the measured remainder.
**Fifteen grammar rules mean the same thing.** `Operation`, `Create`, `Destroy`, `Apply`, `FunctionDecl`, `CommandHandler`, `QueryHandler`, `DomainServiceOperation`, `WorkflowCreateDecl`, `HandleDecl`, `OnDecl`, `ActionDecl`, `UiFunction`, `Component`, `Criterion` — each is "a name, params, an optional return type, a body", forked by *where it lives* and carrying an arbitrary modifier subset. The grammar records the arbitrariness itself: `DomainServiceOperation` "does NOT carry `private`/`extern`/`audited`/`when` — those are aggregate-operation-only" (no reason given, because it is where the rule was forked), and workflow `function` is validator-restricted to the expression form one layer away from the grammar that states it. `extern` has **four** spellings (prefix on handlers, infix on `operation`, suffix-with-path on `component`, and *as the body* on ui `function`); `function` means three different things depending on scope.

The fork leaks downstream: the duplicate diagnostic pairs (`loom.workflow-emitted-event-no-applier` ↔ `loom.emitted-event-no-applier`, and five more) are one rule stated twice because the carrier was stated twice — plus a `lower/` branch, a mandatory `print-structural.ts` arm, and per-backend emitter arms each.

**The work:** one `Callable` production; the per-site differences become a declared legality table (`CALLABLE_SITES`) that a single validator reads, so an excluded modifier reports *why* instead of failing as an unexplained parse error. A standing constraint the design doc derives: the `unfold` contract ("the unfolded output re-parses to a working program") means **every macro-emitted carrier must stay author-writable**, so "make it internal" is not a disposition available to any construct a stdlib macro emits. Source-compatible in Phase 1, gated on **byte-identical emitted output** across all eleven targets — the pattern already used for `_expr/target.ts` (#843) and the walker extraction (#607–#627), applied to the one layer that never got it. **This is explicitly NOT a cut to customization depth** — no rung of `customization-gradient.md` is removed and no capability is lost; the mission separates *carrier count* (the cost) from *depth* (the moat). Under the no-permanent-skips policy each modeled carrier is a permanent eleven-target obligation, which is what makes the duplication expensive.

Design: [`M-T5.21-callable-unification-design.md`](missions/M-T5.21-callable-unification-design.md).

Sources: language-size review 2026-08-04. `src/language/ddd.langium` (the fifteen rules, line numbers in the design doc), [`docs/customization-gradient.md`](../customization-gradient.md), [`surface-redundancy-cuts.md`](../old/proposals/surface-redundancy-cuts.md) (same "one spelling per concept" principle, previously applied only to trivia). Relates to M-T5.17 (modifier zoo, one layer up), M-T5.18 (soft-keyword sprawl).

## M-T5.30 — `for … in …` in a domain body: lower it, or make the refusal permanent — `open` · **M** · P3

Minted 2026-09-11 by **M-T5.28** as the named successor its `loom.for-placement` message points at — the honest-gap half of ruling D-FOR-IN-DOMAIN ([completion-waves-2026-09](completion-waves-2026-09.md) §5 #3). `for x in xs { … }` is lowered only by `lowerWorkflowStatement` (workflow `create` / `handle` / `on`, plus top-level `commandHandler` / `queryHandler`); in an aggregate `operation` / `create` / `destroy` / `apply`, a `function`, a domain-service operation or a projection `on` fold it is now REFUSED rather than lowered to the `<unknown>` call sentinel. Nothing about a loop is workflow-specific — only the **per-iteration repository save** the workflow lowering owns is, and a domain body has no repository to save through.

**The question this mission answers:** is a domain-body `for` meaningful over a *containment* or a *value array* (`for l in lines { l.markVoid() }`), where no repository save is involved and the loop is pure in-aggregate mutation? If yes, it is a `StmtIR` kind + one arm in each of the five `StmtTarget` leaf tables (`src/generator/{typescript,dotnet,elixir,java,python}/render-stmt.ts`) and the `_stmt/target.ts` spine, which already owns one nesting recursion (`if`). If no — because the collection ops (`.sum` / `.any` / `.count` / `.filter`) already express every reachable use and a mutating loop over a containment has no defined save semantics — then `loom.for-placement`'s message loses its "GAP, not a design rule" clause and becomes the third permanent placement rule beside its two siblings. Either end closes it; silence does not.

**Verification when it lands.** If lowered: a corpus fixture whose `for` runs in a domain body, generating and COMPILING on all five backends (rule 13 — the fixture is extended until every emitter arm a mutation names goes red). If declined: the message change plus the assertion in `test/language/validators/stmt-placement.test.ts` that currently pins `M-T5.30` in the text, flipped to pin "permanent placement rule" instead.

Sources: [M-T5.28](archive/T5-done.md#m-t528--variant-match-off-a-page-crashes-all-five-backends-forif-let-off-a-workflow-emits-thisunknown--neither-is-gated--done-2026-09-11-wave-c1-packet-1b--m--p1) and its hand-off [`waves/handoffs/wave-c1-1b-placement-fork.md`](waves/handoffs/wave-c1-1b-placement-fork.md); [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F4.

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

**Slices added 2026-09-29 (evaluation-closure review; both wait on slice 2 above):**

- **5. The scaffold list filter bar reads retrievals** (eval-closure item **#45**, eshop D7a). `filterFindsForAggregate` (`src/macros/stdlib/scaffold/_body-builders.ts:1190`) iterates `m.finds` only, so a `find bySku(sku)` gets a filter bar and a parameterised `criterion` + `retrieval` gets none. There is no endpoint to bind a bar to until slice 2 lands; after it, scan parameterised retrievals too. Pin with a `scaffold-body-builders` case. (The index-hint half of D7 is already fixed.) **S**
- **6. Accept a retrieval run inside a paged `queryHandler`** (eval-closure item **#7** follow-up; Clinica F-009). A routed paged `queryHandler` whose body is `let r = Repo.run(<Retrieval>(args)); return r` crashed `generate system` on all five backends with `internal: … Please file a bug.`; eval-closure agent A5 (#3084) turns that into an honest refusal. Supporting the shape is this slice: once a retrieval has a route (slice 2), the handler can reuse its paging and delete the refusal. **M**

## M-T5.32 — A declared `create`'s parameter list is not the request contract, and `loom.create-params-not-wire` only says so — `open` (unblocked: [#2882](https://github.com/Loom-Harness/Loc/pull/2882) merged `1f25ff0c`; verified 2026-09-29, wave L0) · **M** · P1

The honest gate shipped in #2861 slice 4. It is a diagnostic standing in for a missing capability, so it is not a terminal state: this mission is what deletes it.

Today `POST /<plural>` always takes the **field-derived** create input. A narrowed parameter list on a declared `create` shapes nothing, so an author who writes `create(title: string)` against a five-field aggregate gets a client for a contract they did not declare — the generated `test e2e` suite failed at runtime with a 422 naming a field the create does not accept. `loom.lifecycle-body-dropped` does not cover it: the ubiquitous `field := <same-named param>` idiom is exempt there, and that is exactly the shape that misleads.

**The fix:** the declared parameter list becomes the create input — wire schema, route binding, and the frontend `CreateForm`'s field set all derive from it rather than from the aggregate's fields.

**Why it was blocked (now cleared).** Narrowing the input widens an existing bug: a `managed`/`internal` field's declared default is currently discarded by the create input and replaced with the type's zero value (`tier: int managed = 7` arrives as `0`), which #2882 is fixing. Narrowing first would make every field dropped from the input silently zero rather than defaulted. Land #2882, then this.

**Verification when it lands.** A create-with-narrowed-params case per backend asserting the emitted wire schema has exactly the declared fields; a defaulted `managed` field asserted to arrive at its declared value, not the zero value; and `loom.create-params-not-wire` deleted in the same PR, with its `FIRING_FIXTURES` entry and docs anchor removed (`test/system/diagnostic-firing-census.test.ts` fails on an orphan, which is the ratchet that keeps this mission honest).

## M-T5.33 — A page-body lambda parameter has no type, so every member off it resolves as `string` — `partial` (#3050 landed the `of:`-form half) · **M** · P1

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

**The fix:** thread the known element type to the bare-lambda call site the way `applySuffixToRecv` already does, and make the no-known-type case a diagnostic rather than a silent `string`. **The first half landed with #3050 for the `of:` forms the page DSL documents; the remainder this mission now covers is the second half** — the placeholder itself.

**Verification when it lands.** IR-level cases asserting `memberType` on a member access inside a page-body lambda over a non-string collection; the `string` placeholder removed rather than left beside the fix.

Claimed by the #2861 author, offered to #2871 first as the enabling half of their D4.  **That claim went stale** — both merged without it — and #3050 picked it up on 2026-09-27, cutting the QUERYVIEW-OVER-A-PROJECTION half: `ofReadResultType` recognised only `<handle>.<Aggregate>.<verb>`, so the fifth documented `of:` form (`<apiHandle>.<Projection>`, `page-metamodel.md` §9.3) reached `queryDataType` as `undefined` and the `data:` lambda fell to the placeholder.  Two shipped defects came off that erasure: a projection money field rendered raw into a React text slot (TS2322, invisible to #2871's D4 gate, which resolves its row through `wireFieldsForAggregate`) and `money.round(n)` emitting decimal.js's zero-argument `.round(n)` (TS2554).

**Still open after #3050:** the `lower-expr.ts` bare-lambda site keeps its `string` placeholder for the cases nothing supplies a type to (`env.rowElem ?? { kind: "primitive", name: "string" }`), and the mission's "make the no-known-type case a diagnostic rather than a silent `string`" half is untouched.  #3050 removes the erasure for the `of:` forms the page DSL documents; it does not remove the fallback.

*Wave L1-V2 (leftover-waves-2026-09-28), item **V12**:* the remainder is the block-lambda form — a typo'd field off an untyped page-body lambda param is still emitted verbatim, and Phoenix answers a `KeyError` (`type-system.ts:2043`, #2911).

## M-T5.38 — the IR's TWO SPELLINGS of a `this` property read, normalised at lowering — `open` · **M** · P2 ⚠ not byte-identical on three backends

`this.<prop>` lowers to a `member` node whose receiver is `this`; the BARE `<prop>` spelling of the same field lowers to a `ref` with `refKind: "this-prop"` / `"this-derived"`. Two IR shapes for one source meaning, and every consumer that special-cases one of them silently misses the other. (Wave C2 packet 2a closed the CALL half — `this.<fn>(…)` now lowers to the bare form's `call` node — and left the READ half; packet 2f censused it on all five and recommended its own mission. This is it.)

**The divergence is cosmetic at the RENDER site and dangerous at the DECISION sites.** Measured on one aggregate carrying `derived bare: int = total + 1` beside `derived dotted: int = this.total + 1`, all five compile:

| backend | bare spelling | dotted spelling |
|---|---|---|
| node | `this._total + 1` (backing field) | `this.total + 1` (getter) |
| python | `self._total + 1` | `self.total + 1` |
| java | `this.total + 1` (field) | `this.total() + 1` (accessor) |
| dotnet | `this.Total + 1` | `this.Total + 1` — identical |
| elixir | `record.total + 1` | `record.total + 1` — identical |

The damage is elsewhere, and packet 2a demonstrated it twice: elixir's `wire-serialize` `derivedRenderable` declined every `member` on a `this` receiver, so a `this.<derived>`-spelled field was **silently off the wire**; and the `loom.vanilla-op-call-position` scan could not see the dotted call. Those were found; the census below is the list of walkers that could still be wrong the same way.

**The census (packet 2f) — every walker that special-cases `this-prop` and would miss `member(this, …)`:**

```
src/generator/zod-refine.ts:427
src/generator/elixir/vanilla/changeset-invariant-emit.ts:52
src/generator/elixir/vanilla/inspect-emit.ts:61,75
src/generator/elixir/vanilla/provenance-emit.ts:264,366,420
src/generator/elixir/vanilla/workflow-eventsourced-emit.ts:351
src/generator/elixir/vanilla/wire-serialize.ts:87,127
src/generator/elixir/dispatch-emit.ts:463
src/generator/elixir/domain/predicates.ts:92
src/generator/java/emit/dispatch.ts:109,582
src/generator/java/render-jpql.ts:333
```

**Why it is a mission and not a packet row.** Normalising at LOWERING is the right fix — one spelling reaches every consumer, and the census list stops being a list. But it is **not byte-identical**: the node / python / java rows in the table above move (a getter becomes a backing field, an accessor becomes a field). So it needs the per-backend justified-diff gate the completion plan reserves for exactly this, plus the compile legs on the three that move — which is a coordinated moment, not a sweep.

**Build order.** (1) Decide the normal form — the BARE `ref` is the recommendation: it is what the type system already resolves to, it is the spelling the majority of consumers special-case, and `this` receivers carry no extra information. (2) Normalise in `lower-expr.ts` so `this.<prop>` produces the `ref`. (3) Delete the `member`-on-`this` arms the census names, one per consumer, each one now unreachable. (4) Run the diff gate per backend and JUSTIFY every moved byte in the PR body (the three rows above are expected; anything else is a finding). (5) Compile legs on node / python / java at minimum.

**Until it lands, the packet-2a rule stands:** every walker that special-cases `this-prop` must also accept `member(this, …)`.

Sources: wave C2 hand-offs [`wave-c2-2a-elixir.md`](waves/handoffs/wave-c2-2a-elixir.md) (the two demonstrated defects) and [`wave-c2-2f-ir.md`](waves/handoffs/wave-c2-2f-ir.md) §5.4 (the five-backend measurement and the census above); `src/ir/lower/lower-expr.ts`; `src/ir/types/loom-ir.ts` (`RefKind`).


## M-T5.39 — there is no `date` (or `time`) scalar, so every calendar field is a `datetime` — `open` · **L** · P1 ⚠ five-backend wire-contract change

Found 2026-09-27 by the claims-system dev-experience run (`F-110`). `policy.startsOn`, `policy.endsOn`, `claim.incidentOn`, a due date, a date of birth — every one of them is a *calendar* value, and the scalar menu has no way to say so:

```
bool, datetime, decimal, File, guid, int, json, long, money, string
```

The diagnostic is honest (it prints the whole list, so nothing is hidden), and the only workaround is `datetime` — which re-introduces exactly the class of bug a `date` type exists to prevent. A policy that ends `2026-01-01T00:00:00Z` ends on **December 31** for every principal west of UTC, and the generated `Table` column, the `zod` schema, the Postgres column and the five backends' parsers all agree with each other and are all wrong together. That is the worst shape a defect can have here: cross-backend consistency makes it invisible to the differential gates.

**This is not merely absent — it is half-present.** The i18n layer already ships `{at, date}` as an interpolation format spec, so the *rendering* side of the concept exists while the *type* side does not. `docs/language.md` never mentions `date`, not even as unsupported, so an author gets no signal that the omission was considered.

**Why L, and why it needs a mission rather than a packet.** A new scalar is not one grammar token. `datetime` appears in **136 files under `src/`, 103 of them under `src/generator/` + `src/platform/`** — the type-mapping tables of five backends and six frontends, the SQL column renderer, the migration differ, the wire codecs, the filter-param kinds, the intrinsic receiver table (`src/util/intrinsics.ts`), the zod/refine emitters and the walker's field primitives. Every one of those is a place where "which SQL type / which wire form / which parser" must be answered again for the new scalar, and a missed arm degrades silently to a string.

**Build order (proposed, owner may re-cut).**
1. **Ruling first:** one scalar (`date`) or two (`date` + `time`)? The finding names only `date` from real use; `time` is symmetry, not demand. A `time` with no `date` has no defined ordering across DST and is the weaker half — recommend shipping `date` alone and leaving `time` explicitly declined in the message, so the decision is recorded rather than re-litigated.
2. **Wire form:** ISO-8601 calendar date (`"2026-01-01"`), no offset, no time component — the one spelling every target's stdlib parses and the one Postgres `date` round-trips exactly.
3. **Grammar + type system:** the `name=(…)` alternation at `src/language/ddd.langium:2048`, then the lowering type table and `src/util/filter-param-kinds.ts`.
4. **Per-target type maps**, one arm each, with the SQL column (`date`) and the migration differ's `datetime → date` narrowing treated as a **destructive** change (it drops the time component) so it lands behind `--allow-destructive`.
5. **Intrinsics:** what `date` supports (comparison, difference in days, `.year`/`.month`/`.day`, conversion to/from `datetime` at an explicit zone) — each one is an `ExprTarget` leaf on five backends, so keep the v1 set deliberately small.
6. **Frontend:** the field primitive (a date picker, not a datetime picker) and the `{at, date}` catalog entry that already exists.

**Verification when it lands.** A corpus fixture carrying a `date` field through create / read / filter / migration, compiling on all five backends (rule 13 — extended until every emitter arm a mutation names goes red), plus a runtime leg that writes `2026-01-01` from a client at UTC−5 and reads back `2026-01-01`. The timezone assertion is the whole point: a fixture that only checks the column type would have passed before this mission too.

**Until it lands,** `datetime` is the honest answer and the docs should say so: `docs/language-reference/04-type-system.md` gains one line naming `date` as a known omission with this mission id, which is the difference between a gap and a silence.

Sources: dev-experience run 2026-09-27 (`F-110`); `src/language/ddd.langium:2048`; `src/util/intrinsics.ts`; `docs/new-plan/archive/T1-done.md` § M-T1.11 (the i18n `{at, date}` format spec that already exists).

## M-T5.40 — the declared response record does not describe the wire it claims to — `open` · **L** · P1 ⚠ three live emission defects
The inverse of what M-T5.10 spun off. M-T5.10's PR2–PR7 pointed every backend's response-DTO and schema emitter at the source-visible `<Agg>Response` contract record (override-by-name on `ctx.payloads`), on PR1's claim that the spliced record is "additive and fully INERT". The repository serializer / `.loom/wire-spec.json` / every frontend model still read the DERIVED shape (`forApiRead(wireFieldsFor*(node))`). Wave C4 packet 4e measured the two against each other and they do not agree, so the two halves of one HTTP response disagree.

**The census** (`test/system/wire-contract-divergence.test.ts`, exact shrink-only baseline — `with scaffoldHandlers` injected into all 79 corpus fixtures, 126 contracted nodes, **25 diverging**):

| class | rows | what differs | live defect? |
|---|---|---|---|
| **A1** capability-injected fields | 7 | `softDeletable`'s `deletedAt`, `auditable`'s `createdAt`/`updatedAt`, `tenantRegistry`'s `parent`/`dataKey` reach the derived walk, not `apiReadFields` | **yes** |
| **A2** inherited base fields | 8 | enrichment merges the `extends` chain into the concrete; the record's AST walk does not | **yes** |
| **B3** `provenanced<T>` | 1 | `wireTypeForField` wraps the carrier for the wire; the record declares bare `T` | **yes** |
| **B1** containment element | 7 | the record names `<Part>Response` (context scope cannot reference a raw part), the derived walk names the part | no — offset, un-suffixed by `isResponsePayloadName` |
| **B2** optional containment | 1 | optionality in the TYPE (`optional<MemoResponse>`) vs the `optional` FLAG | no — representation |
| **C** field ORDER | 1 | `versioned`'s `version` is a property (before containments) in the derived walk, appended after in the record | **yes on positional DTOs** (.NET/Java/F# records) |

**Reproduce A1/A2 in two minutes** (`platform: node`, `with scaffoldHandlers` on the context):

```
aggregate Order with softDeletable { code: string  status: string = "new"  create(code: string) { code := code } }
```
```ts
// api/db/repositories/order-repository.ts
toWire(root: Order): unknown { return { id: …, code: …, status: …, deletedAt: …, version: … }; }
// api/http/order.routes.ts   ← `deletedAt` is NOT here
export const OrderResponse = z.object({ id: z.string(), code: z.string(), status: z.string(), version: z.number().int() });
```
and `return c.json(repo.toWire(found) as z.infer<typeof OrderResponse>, 200)` — the cast is why `tsc` never sees it. `aggregate Customer extends Party` is worse: `CustomerResponse` is `{id, tier, version}` while `toWire` emits `{id, name, email, tier, version}`, so every inherited field is missing from the OpenAPI schema and from any client generated off it. **The failure mode differs per backend:** on the record-based backends the projection mapper is generated FROM the record, so on `platform: java` `public record CustomerResponse(UUID id, String tier, int version)` with `from(Customer value)` returning only those three means `name`/`email` are **never serialised at all** — the API silently truncates, rather than merely mis-declaring.

**Why it is only visible under the macro.** `with scaffoldHandlers` is the ONLY thing that splices the records, and exactly five tracked `.ddd` use it (the per-backend `scaffold-handlers` compile fixtures), none of which declares a capability or an `extends`. 0 of 117 corpus aggregates carry a record, so the whole shipped surface runs the derived path and nothing ever compared them. That is also why the `scaffold-handlers` compile gates are green: they compile, they are just not the shapes that diverge.

**Order of work.** (1) A1 — make `apiReadFields` (`src/macros/api/factories.ts`, consumed by `src/macros/stdlib/scaffold/_contracts-shared.ts`) see the prelude-injected fields; this is a macro-ORDERING question (the capability mixin vs `scaffoldHandlers`), not a filter question. (2) A2 — walk the `extends` chain at record-build time; this is the coordination note's item 3 (`aggregate-inheritance.md` I2, "the chain walk has two consumers"), now measured rather than predicted. (3) B3 — apply `wireTypeForField`'s carrier wrap. (4) C — align the record's walk order with `id → properties → containments → derived`. (5) B1/B2 stay as declared offsets, documented, with the un-suffixing rule stated once. Each row deleted from the census baseline in the PR that closes it. Add a corpus fixture that USES `scaffoldHandlers` over a capability-bearing, inheriting aggregate — the missing fixture is why the class survived seven PRs.

**Not in scope, by decision.** Moving any consumer off the derived shape onto the records, and retiring `.loom/wire-spec.json` (proposal steps 6–8's remainder): [`D-WIRESHAPE-KEEP`](../decisions.md) — the derived shape stays the source of truth until the records reproduce it AND the implicit `api … from …` form expands through the scaffold, so the records exist for the paths that ship.

Sources: [unfoldable-api-derivation](../old/proposals/unfoldable-api-derivation.md) steps 6–8 + [coordination note](../old/proposals/unfoldable-api-derivation-coordination-note.md) items 1–3; [`D-WIRESHAPE-KEEP`](../decisions.md); wave C4 hand-off [`wave-c4-4e-wireshape.md`](waves/handoffs/wave-c4-4e-wireshape.md); `test/system/wire-contract-divergence.test.ts`.

## M-T5.41 — Unit `test` bodies are never validated (F-105) — `open` · **M–L** · P1

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L1-V1 (leftover-waves-2026-09-28).**

Item **V1** (#3031). A wrong-typed `toBe`, an unknown operation and an unknown field inside a unit `test "…" { … }` block all validate `0 error(s)`; the defect reaches the generated test file and fails there (or passes vacuously). `src/language/validators/structural.ts` never dispatches `TestBlock`, so none of the body checks the domain bodies get ever run on a test body.

**The fix:** dispatch `TestBlock` bodies through the same expression/statement checks, with the test-only surface (`expect(…)`, the matcher catalogue from M-T5.37) typed. **Expect corpus breakage** — the repo's own fixtures have never been checked — and fix it in the same PR.

**Verification.** A negative validator case per shape (wrong-typed matcher, unknown op, unknown field); the corpus still validating after the repairs; mutation-proved by removing the dispatch.

## M-T5.42 — The validator batch: silent shapes that validate clean and break codegen — `open` · **M** (a batch of S items + one M) · P1

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L1-V2 (leftover-waves-2026-09-28).**

One tree-fenced packet (`src/ir/validate/checks/`, `src/language/validators/`, `src/diagnostics/messages.ts`, grammar). Sequence after #3040 (domainService param binding) and #2949 (F-040 primitive member read); **#3063 may close V13** — re-check first.

| id | Item | Evidence | Sz |
|---|---|---|---|
| V2 | Param **defaults silently dropped** on `domainService` ops and workflow `handle`/`create` (`defaults: false`). Refuse them for now | `src/ir/lower/lower-domain-service.ts:62`, `lower-workflow.ts:271,347,398` (#3011 4d) | S |
| V3 | An inline repo call inside a **`commandHandler`** is dropped (`Orders` unbound); the gate only runs for workflows | repro, `workflow-checks.ts:179` (#2916) | S |
| V4 | A local/param **shadowing a field of another type**: `name := name` → TS2322 | repro (#3000) | S |
| V5 | **Unknown collection op** in a page body (`rows.bogusOp(...)`) is emitted verbatim | repro, not covered by #2949 (#2865) | S |
| V6 | .NET **entity-member collision**: a field named `assertInvariants`/`create`/`id` vs the generated method → CS0102; only type names are gated. The emitter half, if any, is [M-T6.75](T6-backend-parity.md#m-t675)'s | repro, `backend-syntax-checks.ts:282-345` (#2923) | S |
| V7 | A VO-typed field in a `Text` slot → TS2322; only money has a gate | `messages.ts` (#2871) | S |
| V8 | `Button { icon: "nope" }` gives no warning (`Icon` does). Move the icon set to `src/util/` | repro (#2996) | S |
| V9 | `storage { type: nats \| meilisearch }` binds to no kind, 0 warnings | repro (#2924) | S |
| V10 | Folded-projection e2e reads (`byKey`/`list`) have no response-field check | `e2e-route-checks.ts:1134` (#3002) | S |
| V11 | The e2e payload gate's blind spots: find/list/projection args, explicit `null`, `ui.` forms, `extends` subtypes (the sweep's population is in `docs/audits/2026-09-14-p3-e2e-payload-sweep.md`) | header of `e2e-route-checks.ts` (#2958) | M |
| V13 | Grammar: a param named `from` is declarable but unreadable; `operation deny()/state()/money()` gives a hintless parse error | repro (#2865, #2883) | S |
| V15 | `loom.locator-matcher-receiver` is re-derived in the AST validator; move it onto the resolved IR | `validators/match.ts:161` (#2789) | S |

**Verification.** One negative validator test per row, every message in the catalog, each gate mutation-proved; the corpus still validating. V11 re-measures its denominator against the P3 sweep's 777 body keys rather than trusting the widening.

## M-T5.43 — The variant-`match` STATEMENT keeps a `string` `subjectType`, so the four shape gates never run on it (F56) — `open` · **M** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L1-V2 (after M-T5.42) (leftover-waves-2026-09-28).**

Item **V14** (#2838). The expression form of a variant `match` carries its resolved union type; the statement form lowers with `subjectType` left as `string`, so the four shape gates keyed on the subject type (exhaustiveness, unknown variant, binding arity, the error-variant binding) are skipped for it. Pinned as a known gap at `test/ir/variant-match-subject-type.test.ts:70`.

**The fix:** resolve the statement's subject through the same path as the expression form; flip the pinned `it.fails` in the same PR.

**Verification.** The pinned case flips; one negative case per gate on the statement form.

## M-T5.44 — Only one `resource` per (context, kind), even for `api` / `objectStore` / `mailer` / `queue` — `open` · **M** · P3 (design first)

*Minted 2026-09-29 by wave B7 (docs sweep) of the 2026-09-28 evaluation-closure review, from its mission-only list: owner ruling **D12** or a plan item no wave builds. Every item was re-proved on `main` @ `cbda91658` by an adversarial re-verification (minimal repro, `parse` + `generate system`, generated `path:line`). Re-verify on fresh `main` before building.*

Item **#42a** (Clearline F-042). Two `kind: api` resources on one context (`ocr`, `fraud`) are refused: `Deployable 'd' has two dataSources for (Sales, kind: api): 'ocr' and 'fraud'. Pick exactly one per (context, kind).` (`loom.datasource-duplicate`, `src/language/validators/deployable.ts:572-586`). The refusal is honest and documented, so this is not a defect. But the rule is right only for the persistence kinds (`state`, `eventLog`, `snapshot`, `cache`, `replica`). The verb-addressed kinds are called by resource name, and the emitters already emit one client per resource name, so two external APIs on one context is a reasonable model the language refuses.

**The fix, once ruled:** keep the duplicate key for the persistence kinds; allow several `api` / `objectStore` / `mailer` / `queue` resources per context. Verify on all five backends that two same-kind resources get distinct clients and distinct env vars.

**Verification.** A compile-tier corpus fixture with two `api` and two `objectStore` resources on one context, on all five backends; the persistence-kind refusal keeps its negative case.

## M-T5.45 — No event, value-object-equality or navigation matcher in `test` / `test e2e` — `open` · **M** · P2 (design first)

*Minted 2026-09-29 by wave B7 (docs sweep) of the 2026-09-28 evaluation-closure review, from its mission-only list: owner ruling **D12** or a plan item no wave builds. Every item was re-proved on `main` @ `cbda91658` by an adversarial re-verification (minimal repro, `parse` + `generate system`, generated `path:line`). Re-verify on fresh `main` before building.*

Item **#43** (testability audit F7-r / F11-r). `src/util/intrinsic-matchers.ts` has 13 matchers (`toBe`, the four comparisons, `toBeSameInstant`, `toHaveText`, `toHaveCount`, `toBeVisible`, `toContain`, `toBeNull`, `toBeAbsent`, `toThrow`). There is no way to assert that an operation **emitted** an event, that two value objects are **equal**, or that a UI action did **not navigate** (`not.` exists for locator matchers only; a ui `toThrow` is refused with `loom.e2e-ui-throw-invalid`). `expect(n).toEmit(Renamed)` and `expect(n).toEqual(n)` are refused at parse ("expect requires a matcher"), which is honest.

The silent half of #43 — `expect(n.events).toContain(Renamed)` and `expect(n.bogus).toBe(1)` validate clean and emit TS2339 / TS2304 — is [M-T5.41](#m-t541)'s (unit `test` bodies are never validated); do not duplicate it here.

**The design:** `expect(x).toEmit(Event)` at the unit tier through the aggregate's `pullEvents()`; `toEqual` for value objects (structural, the wire's equality); a `toHaveURL` / not-navigated locator matcher for `test e2e` against a ui.

**Verification.** A type-system test per matcher; the generated unit-test compile tier on all five backends; one ui e2e case per locator matcher.

## M-T5.46 — ICU `plural` / `select` in backend domain code: render it, not drop it — `open` · **M** · P3

*Minted 2026-09-29 by wave B7 (docs sweep) of the 2026-09-28 evaluation-closure review, from its mission-only list: owner ruling **D12** or a plan item no wave builds. Every item was re-proved on `main` @ `cbda91658` by an adversarial re-verification (minimal repro, `parse` + `generate system`, generated `path:line`). Re-verify on fresh `main` before building.*

Follow-up of owner ruling **D8** (eval-closure item **#38**; Clinica F-006, Meridian F-002). An interpolated string in a backend `derived` or operation body drops an ICU `plural` / `select` hole's branch text: `"{n, plural, one {# item} other {# items}}"` emits just the number. The drop of the *format* on the backend is recorded as deliberate (`archive/T1-done.md` §M-T1.11), and wave C6 of the review adds the warning `loom.interp-format-dropped-in-domain` now. This mission is the rendering D8 deferred: the branch text is authored content, and losing it is a wrong string, not a formatting nicety.

**The fix:** a small ICU `plural`/`select` evaluator per backend (or one shared helper in each runtime kernel) over the already-parsed interpolation IR; `number`/`date` formats may stay dropped by the M-T1.11 decision. Once it lands, delete the D8 warning in the same PR.

**Verification.** A wire-golden case whose `derived` returns a `plural` and a `select` string, byte-identical on all five backends.

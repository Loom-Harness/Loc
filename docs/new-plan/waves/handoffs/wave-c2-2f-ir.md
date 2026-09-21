### C2 packet 2f — cross-backend contracts (`src/ir/**`, `src/generator/_*/**`) — `claude/c2-ir`

*Base: the wave-C2 batch-2 coordinator head `118d0a3f7` (= `main` @ `9713ffa18` plus the wave-log
commit). Branch `claude/c2-ir`, never pushed, no PR of its own — the wave PR (#2933) is the claim.*

## 1. Commits

| commit | what |
|---|---|
| `dbb71d516` | a `return` inside an `if` is a return — `loom.function-block-no-return` descends, and the IR purity sweep descends with it |
| `1c6fa437c` | **D-PROJECTION-IMPLICIT-SUB** applied — an uncarried `on(e: E)` dispatches on all five; two warnings retired |
| `101162801` | **M-T5.14** — the reading-service handle reaches the dotnet / java / elixir explicit handlers |
| `26f1481e4` | the **drizzle membership crash** closed target-neutrally — a `contains` COLUMN argument is refused in `firstNonQueryableNode`, not in one adapter's narrowing table |
| `f293c84ee` | register dispositions: three config-shaped rows renamed out of the `-unsupported` suffix, one dead arm deleted, five unowned `scope` rows owned, `ui-realtime` re-classed `seam` |
| `7fe113a9b` | **M-T3.16 C4** — `httpStatus Forbidden -> 451` moves BOTH lifecycle rungs, per ROUTE, on all five |
| `NOTE` | this note |

`MAX_OPEN_GAPS` **24 → 20**; `LATENT_SEAMS` **24 → 25**; `UNDOCUMENTED_BASELINE` **367 → 366**.

## 2. Rows → outcome

| row | outcome | evidence |
|---|---|---|
| `seed-event-sourced-unsupported` | **already drained — nothing to delete** | `grep -c 'loom.seed-event-sourced-unsupported' src/` is 0; the register has no row; the two narrower rules that replaced it are live (`src/language/validators/seed.ts:122,128`). #2770's packet 2.5 did it and archived the mission; verified on this head rather than assumed. |
| `sensitive-wire-unsupported` | **`scope`, under a new D-tag** | **D-SENSITIVE-INSPECT-ONLY**. Phases 2–4 are three features (a type-system change, a masking arm in five DTO emitters + the OpenAPI schema, and a sink census with no chokepoint), and four fifths of that is indistinguishable from success in any test asserting by shape. The warning already names the surface that redacts today (`mask unless`), so the row was honest — what was wrong was the `gap` kind claiming a sweep could close it. M-T3.8 keeps it. |
| `polymorphic-id-ref-unsupported` | **NOT built — hand-off §5.1** | Needs a representation decision (polymorphic FK vs no-FK + union-view reader) before any of the five can emit it. |
| **M-T5.14** read-port on dotnet / java / elixir | **BUILT** | `101162801`. Three different fixes, because the handle is per-backend. Corpus `handler-triad.ddd`, compiled on all five. |
| **M-T1.11 (c)** domain-floor `code` | **NOT built — hand-off §5.2** | Ledger sizes it **L** across four backends and it needs a wire golden; measured state re-confirmed. |
| **M-T3.16** two goldens | **C4 BUILT / C2 hand-off §5.3** | `7fe113a9b` — `test/generator/lifecycle-forbidden-remap.test.ts`, 15 cases (3 per backend). Measured first: all five already emitted it correctly, so the row was a missing golden, not a gap. Mutation-proved in both halves — pinning `forbidden = 403` in `errorStatuses` fails the 5 declared-set arms; making `resolveErrorStatus` ignore `Forbidden` overrides fails all 10. |
| the five unowned `scope` rows | **all five owned** | three → new **M-T5.36**; `domain-service-read` → **M-T5.14** (a third shipped-tier refinement); `if-stmt-page-body` → **M-T1.20** under new **D-PAGE-BODY-EXPRESSION** (M-T1.20 already IS the register of frontend refusals accepted in `.ddd`). |
| the 3 config-shaped rows | **renamed out / one arm deleted** | see §4. |
| G2646 `projection-on-event-no-channel` | **BUILT** | `1c6fa437c`. |
| `loom.function-block-no-return` one level deep | **BUILT** | `dbb71d516`, plus the purity-sweep hole it exposed. |
| `drizzle-projection-membership-column-arg-crash` | **BUILT** | `26f1481e4` — target-neutral, in `firstNonQueryableNode`, NOT in the mikroorm narrowing table where the same refusal already lived but could not be reached by a deployable on the default adapter. |
| the IR two-spellings class | **NOT built — hand-off §5.4**, now MEASURED on all five | |
| **F2-W-06** sub-second datetime | **NOT built — hand-off §5.5**, and it is not this packet's | |

Cited, not duplicated: **#2903** (numeric rows / the `src/ir/**` numeric codec) had already merged
when this packet started, as had #2894, #2895, #2904, #2899, #2870, #2885, #2877, #2873, #2884,
#2860, #2852, #2886, #2900, #2872, #2878 and #2897 — the coordinator's overlap table was written
against a pre-batch-1 PR list. See §6 for the two that are still open on this fence.

## 3. The three built rows, stated properly

### 3.1 `loom.function-block-no-return` — a gate one level deep, and a silent hole behind it

2a measured it and handed it over: `checkFunction` counted TOP-LEVEL `return`s, so

```ddd
function tierOf(points: int): string {
  if points > 10 { return "gold" } else { return "bronze" }
}
```

was refused at phase ④ on **all five backends**, every one of which renders it — the four generic
ones through `_stmt/target.ts`'s `if` arm, elixir through `renderPureBlock`'s, whose own gate
(`elixirIfRefusal(…, "value")`) already admitted exactly this shape. The identical tail-return in a
`domainService` operation validated and rendered, which is what made it a validator bug.

Two things beyond the obvious fix:

- **Path sensitivity, on purpose.** A bare `if c { return x }` still fails — the false path yields
  no value. That is the same line `returnsAreTailOnly` (`if-stmt-checks.ts`) draws for the elixir
  renderer, so the two layers now agree about which shapes reach codegen instead of one being
  stricter by accident.
- **The hole the unlock exposed.** `validateFunctionBlockBodies` (`structural-checks.ts`) scanned
  the same block one level deep on the STATEMENT channel. Harmless only while a function block could
  not contain an `if` at all — measured after the unlock, `if w > 10 { tier := "gold" return "gold" }
  else { … }` produced **zero** diagnostics while the identical mutation at the top level was
  refused. It rides `walkStmtsDeep` now; the expression sweep stays on the top-level statements,
  because `walkStmtExprsDeep` was already deep and flattening both would double-report (asserted).

Corpus: `domain-services.ddd` grows `Account.tier`. Deliberately **no caller** — what had never been
emitted is the DEFINITION — which is also why it moves no route, no `derived` and no wire golden.

### 3.2 D-PROJECTION-IMPLICIT-SUB — the one early return four backends were "correct" downstream of

`deriveEventSubscriptions` opened with `if (!channels || channels.length === 0) return []` and then
kept only events some `channel` `carries:`. A `projection … on(e: E)` — or a workflow reactor — on an
uncarried event therefore produced **no subscription anywhere**, and every backend was correct
downstream of an empty list: python emitted no `dispatch.py`, java/.NET/elixir no handler, node's
route tee had nothing to tee. The read model the fold exists to write was never written. Open since
July behind `loom.projection-event-uncarried`, a warning that described the hole instead of closing
it.

Three things worth carrying forward:

- **Both warnings go, not just the projection one.** The decision's own scope paragraph writes the
  rule once for both consumer kinds, so `loom.reactor-event-uncarried` had become exactly as false.
  Deleting only the named one would have left the compiler contradicting itself.
- **A trap found on the way, independent of this row.** node's `buildProjectionsFile` filtered folds
  through `ctx.eventSubscriptions` — but the ENRICHER-stored one is derived without projections
  (`enrichContext` passes only channels + workflows), so the filter answered differently depending on
  which context variant the caller had merged. It reads the handler list off the projection now, the
  same list the tee reads, which is what keeps a tee `case` from naming a `fold…` function the module
  does not declare.
- **The strongest proof is the booted one.** `test/behavioral/run.mjs` on the generated node backend
  (PGlite), with a temporary `test e2e` block on the fixture: `place` → `event_dispatched
  OrderPlaced` → `GET /api/projections/order_board/<id>` **200 `"Placed"`**, then `ship` →
  `"Shipped"`. With both the enrich early-return and the node filter restored the same run fails on
  **404 `OrderBoard <id> not found`** — the row is absent, not the symbol. The block is not
  committed; the fixture ships e2e-less with the reason signed in `gate-ledger`.

### 3.3 M-T5.14 — one row, three fixes, because the HANDLE is per-backend

2e's hand-off called it "the same three-in-one" as python's (no import, no port, no `await`). That is
right about the CALL and wrong about the FIX:

| | the handle | what was emitted |
|---|---|---|
| node / python | leading read-port PARAMETERS | (already correct) |
| dotnet | an injected `sealed class` holding its own repos | `Registration.IsHolderFree(...)` — a static member the class does not have, no `using` |
| java | an injected `@Service` bean | the same, against a bean |
| elixir | **nothing** — a CONTEXT FUNCTION with the ambient `Repo` | `D.Domain.Services.Registration.is_holder_free(...)`, a module emitted only for PURE ops → `UndefinedFunctionError` at runtime, out of code that compiles |

A **second defect** rode along on java and .NET, which only the PURE control shows: the pure call had
no import/using either, so `FeeQuote.forAmount(amount)` was "cannot find symbol" / CS0103 in a handler
while the identical call compiled in a workflow.

A **third, unrelated** defect surfaced while COMPILING the corpus shape and is fixed in the same
commit because the fixture cannot land without it: `inferExprType` has arms for a domain-service call,
an api-bound resource call and a store read, but none for the repo READ that `lowerPostfixChain` opens
with — so in a `domainService` body `let hits = Orders.byCode(c)` bound as `string` (the fall-through
placeholder), `hits.count` got `receiverType: string`, and every backend rendered a record accessor
instead of a collection size. java emitted `hits.count()` on a `List<Order>`: *cannot find symbol*,
from valid `.ddd`. The workflow/handler path never had it because it lowers the same read to a
`repo-let` STATEMENT, which carries the find's declared type.

Seam (rule 6): the "which services does this body call, at which tier" walk now lives once in
`src/ir/util/domain-service-read-ports.ts` (`domainServicesCalled` / `isReadingServiceOp`) beside
`readPortsForOperation`, which is what decides the tier — rather than a fourth per-backend copy.

## 4. The register, row by row

`MAX_OPEN_GAPS` **24 → 20**, `LATENT_SEAMS` **24 → 25**, `UNDOCUMENTED_BASELINE` **367 → 366**.

**Three config-shaped rows renamed out** (the register header's own rule: a plain misuse error does
not carry the suffix and does not get a row — a drain sprint stalls on rows nothing can close):

| was | is | why it was never a target gap |
|---|---|---|
| `loom.context-filter-unsupported` | `loom.context-filter-no-principal` | its backend×shape half died when the last family wired capability filters; what is left is "this `filter` reads `currentUser` and the deployable has no auth", which no backend can implement — there is no principal |
| `loom.persistence-mode-unsupported` | `loom.datasource-binding-missing` | its own `what` already said "NOT a backend gap": a hosted aggregate whose deployable lists no matching `dataSource`. The name had also outlived its subject twice |
| `loom.ui-realtime-unsupported#backend-serves-no-sse` | **deleted** | see below |

**The realtime arm is deleted, not renamed.** It cannot fire from valid source: every shipping backend
serves realtime (`backendServesRealtime`), and the only two ways to point a ui at something that does
not are already phase-④ errors with better messages (`validators/deployable.ts` — a frontend deployable
with no `targets:`, and one targeting another frontend; both confirmed by running `ddd parse` on the
two shapes). Minting a code no source can raise would have added a firing-census pin with no subject.
The code keeps its row for its other arm — an unknown FRONTEND — which is a genuine latent seam, so it
moves `gap` → `seam` and `LATENT_SEAMS` goes up by one.

**`sensitive-wire-unsupported` → `scope`** under **D-SENSITIVE-INSPECT-ONLY** (§2).

**The five unowned `scope` rows now have owners:**

- `handler-load-nullable` / `workflow-load-array` / `workflow-load-nullable` → new **M-T5.36**. They
  are one mechanism, and the successor is smaller than it looks: `if let` and `for` already exist and
  already render, but their SOURCES are pinned one notch narrower than the `let` they would replace
  (`loom.iflet-bad-source` accepts only `Repo.find(<Criterion>)`, `loom.workflow-foreach-source` only
  a `Repo.run(...)` result — measured on a declared `find byCode(c): Order?` / `: Order[]`, both
  refused today). So the mission is "widen those two sources, and give the handler / domain-service
  bodies the `if let` the workflow body has", not "invent a construct".
- `domain-service-read` → **M-T5.14**, as a third shipped-tier refinement (the register comment
  already described the fix; it just had no owner).
- `if-stmt-page-body` → **M-T1.20** under new **D-PAGE-BODY-EXPRESSION**.

**`find-predicate-unsupported` is NOT drained, deliberately.** With the column-argument narrowing
gone, no adapter descriptor carries a NAMED shape any more (`efcore`/`drizzle` were always
`FULL_SUBSET`; 2b proved `DAPPER_SUBSET = FULL_SUBSET`). A spot probe — arithmetic in a predicate
position on mikroorm — was preempted upstream by `loom.find-where-not-queryable`, which is
suggestive, not a proof over the whole queryable subset. The row is kept with that drain condition
written into its `what` for M-T6.35.

## 5. Hand-offs — not built, with what was measured

### 5.1 `polymorphic-id-ref-unsupported` — needs a REPRESENTATION decision first

`src/language/validators/inheritance.ts:275` (rule 6) refuses a `<Base> id` whose target is an
abstract base with the TPC (`ownTable`) layout: there is no single table to key the FK against.
The TPH case is already allowed (one shared table, and the Hono base reader resolves it), and the
MIXED case has its own code.

Building it is not "M-T5.7's polymorphic reader on all five" — the reader is the second half. The
first half is a schema decision nobody has taken, and the two candidates differ on every backend:

- **a polymorphic FK** (a `<field>_type` discriminator column beside `<field>_id`, no referential
  integrity — Postgres cannot FK to a union of tables), which changes `MigrationsIR`, every
  backend's schema emitter, and the seed path; or
- **no FK + a union-view reader** (`CREATE VIEW` over the per-concrete tables, or a five-way read
  fan-out), which keeps integrity out of the database entirely and makes every read a join decision.

Both are cross-backend, both touch phase ⑨, and the choice is visible in the emitted DDL — i.e. a
`docs/decisions.md` ruling, then a mission. **Recommend: a D-tag before any code**, and the register
row stays `gap` under M-T5.7 until it is taken. Nothing was changed here.

### 5.2 M-T1.11 item (c) — the domain floor carries no `code`

Ledger row `M-T1.11-domain-floor-message-code`, size **L**, targets node/dotnet/java/python. Its
evidence re-verified on this head: every `messageCode()` call site is the WIRE-validation rung, and
each domain-floor throw takes the raw text only. The fix the row specifies — widen `DomainError` to
`(message, code?)` on four backends, pass `messageCode(...)` at ~8 throw sites, resolve through the
per-backend catalog at the 422 serializer, extend `validation-catalog.ts` membership, and mint a wire
golden asserting `errors[].code` on a domain-only rule — is an L with a golden re-capture, i.e. a
mission, not a packet row. The i18n catalog half in particular is a `_i18n/validation-catalog.ts`
membership change whose failure mode (a catalog entry the runtime cannot resolve) is the exact thing
its scoping comment exists to prevent. **Not attempted; nothing changed.**

### 5.3 M-T3.16 C2 — the elixir 403-vs-422 golden

C4 is built (§3/§7). C2 is not, and its shape is why: "a guarded create with an invalid body answers
403 on Elixir vs 422 elsewhere" is a RUNTIME claim across five booted backends, and the row's own fix
says "whichever status the four agree on becomes the answer key **and elixir's controller moves its
gate relative to the changeset cast**". That is an elixir-tree emitter change (2a's fence) plus a
five-backend wire-golden capture — the coordinated moment the plan reserves. **Recommend: pair it
with the C5 golden re-capture** rather than landing an elixir gate move alone.

### 5.4 The IR two-spellings class — now MEASURED on all five

2a's hand-off closed the CALL half (`this.<fn>(…)` lowers to the bare form's `call` node) and left
the READ half: `this.<prop>` lowers to `member`-on-`this` where the bare `<prop>` lowers to a
`this-prop` ref. Measured here, one aggregate with `derived bare: int = total + 1` beside
`derived dotted: int = this.total + 1`:

| backend | bare spelling | dotted spelling |
|---|---|---|
| node | `this._total + 1` (backing field) | `this.total + 1` (getter) |
| python | `self._total + 1` | `self.total + 1` |
| java | `this.total + 1` (field) | `this.total() + 1` (accessor) |
| dotnet | `this.Total + 1` | `this.Total + 1` — identical |
| elixir | `record.total + 1` | `record.total + 1` — identical |

So at the RENDER site the divergence is cosmetic and all five compile. The danger is the DECISION
sites, and 2a already demonstrated it twice (elixir's `wire-serialize` `derivedRenderable` declined
every `member` on a `this` receiver, so a `this.<derived>`-spelled field was silently off the wire;
the `loom.vanilla-op-call-position` scan could not see the dotted call). A census of the walkers that
still special-case `this-prop` and would miss `member(this, …)`:

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

Normalising at lowering is the right fix and is NOT byte-identical (the node / python / java rows
above move), so it needs the per-backend justified-diff gate the plan calls for — an own mission, not
a packet row. **Until then 2a's rule stands: every walker that special-cases `this-prop` must also
accept `member(this, …)`.** Nothing was changed here.

### 5.5 F2-W-06 — and a correction to why it is stuck

2a deferred it for two reasons; the second (`migrations-emit.ts` in flight on #2904) is **stale** —
#2904 has merged. The first is still true and is now sharper: **the `<timestamp>` normalisation
narrowing has not happened.** `test/_helpers/response-diff.ts:77` still collapses every precision
spelling to one `<timestamp>` token, which is exactly what D-ABSENT-JOIN-DATETIME-WIRE says must
narrow "in the same PR, or the fix cannot be seen". Narrowing it before node/python/elixir all move
to the agreed millisecond precision turns the differential red across every backend — which is the
coordinated golden re-capture the plan reserves as **M-T5.22 / C5**, explicitly excluded from this
packet.

And the rest of the row is an **elixir-tree** change: ~6 type sites plus ~9 truncation sites, all
under `src/generator/elixir/**` (2a's fence, listed verbatim in its §6a). It is not a cross-backend
row; it looked like one only because of the normalisation. **Recommend: the elixir half goes to an
elixir packet, sequenced after C5's re-capture.**

### 5.6 Found while compiling, NOT this packet's row — a python identifier collision

`corpus-python`'s `ruff check` rejected `handler-triad.ddd` with **F811 Redefinition of unused
`doubled`** when a `queryHandler Doubled` calls a `domainService` operation named `doubled`: python
emits the handler as `app/application/doubled.py` with `async def doubled(...)` AND imports the
service fn under its own snake name. Same family as #2923's identifier collisions, python-only,
reachable from any `.ddd`. The fixture sidesteps it by naming the op `twice`, with the reason in a
comment so the next reader does not "fix" the name back. **No ledger row was minted** (that register
belongs to the loom-eval wave); recommend folding it into #2923's family.

## 6. Open PRs on this fence — cited, not duplicated

The coordinator's overlap table was written before batch 1 merged, and most of it is stale: #2903,
#2894, #2895, #2904, #2899, #2870, #2885, #2877, #2873, #2884, #2860, #2852, #2886, #2900, #2872,
#2878 and #2897 had all merged by the time this packet started (`list_pull_requests`, state `open`,
read at launch). Two are still open and touch files this packet touched:

- **#2896** (`M-T5.34`) — +67 lines in `src/ir/validate/checks/workflow-checks.ts`, and it ADDS a
  register row (`unsupported-register.ts` +27/−2, `unsupported-register.test.ts` +15/−2). This packet
  DELETES from `workflow-checks.ts` (the retired `validateEventConsumersCarried`, at the top of the
  file) and moves `MAX_OPEN_GAPS`. **Expect a pin conflict, not a code conflict:** compose by taking
  both row-set changes and re-deriving the pin from the merged register, exactly as the 2b × 2c fold
  did. The two hunks in `workflow-checks.ts` are in different regions.
- **#2913 / #2915 / #2916** (workflow + operation repository-access validators) — none was touched.
  They add checks; this packet removed one and re-pointed two register `site:` lines
  (`workflow-checks.ts:852→803`, `:865→816`) that its own deletion shifted. If those PRs land first
  the line numbers move again and `unsupported-register.test.ts`'s site-resolution assertion says so
  by name — which is the gate working, not a conflict.

## 7. Gate shape (rules 11 / 12 / 13)

- **Sweeps over the axis the bug travels on.**
  `handler-domain-service-read-port-parity.test.ts` sweeps EVERY emitted file per backend for a
  domain-service symbol it cannot resolve (a reachability obligation), with a `scanned > 1` vacuity
  guard; `membership-column-argument.test.ts` sweeps 7 platform clauses × 2 sites × (refusal +
  control); `projection-implicit-sub.test.ts` names one fold symbol and one reactor symbol per
  backend rather than one shared matcher that could be wrong five times; and
  `lifecycle-forbidden-remap.test.ts` reads each lifecycle rung ROUTE-SCOPED (java and python
  declare the whole per-route status set on one line; node / dotnet / elixir are sliced between
  their own route markers) rather than counting 451s project-wide, which would pass if BOTH rungs
  landed on one route — the exact blindness that lets the existing
  `domain-floor-status-override.test.ts` look like it covers this and not.
- **An expected value from outside the emitter.** The M-T5.14 gate asserts the DECLARATION side per
  backend (`public async Task<bool> IsHolderFreeAsync(string holder`, `def is_holder_free(holder) do`,
  …) before asserting the call site, so the call-site pins cannot be agreement between two wrong
  things. And the four backend COMPILERS are the outside oracle for `handler-triad.ddd` — it was the
  java one that produced the `inferExprType` defect, which no in-repo assertion was looking for.
- **The corpus contains the shape.** `projection-implicit-sub.ddd` (new, backends ALL) and the
  extensions to `domain-services.ddd` and `handler-triad.ddd`. Both new/extended fixtures are
  compile-tier witnesses with their reason signed in `gate-ledger.test.ts`'s `BEHAVIOURAL_ABSENT` and
  `api-caller-census-pins.ts`'s `E2E_LESS_CORPUS_FIXTURES`.

## 8. Mutation proofs (file copy, never `git checkout --`)

| mutation | failing assertion |
|---|---|
| drop the `isIfStmt` descent in `checkFunction` | 9 of 17 — "accepts a block body whose `return`s sit inside an if/else" (`expected [ '…must return a value of type string' ] to deeply equal []`) and all five "`<backend>` renders both branches in order" |
| `thenReturns && elseReturns` → `\|\|` | exactly the two path-sensitivity negatives ("still rejects an `if` with no `else`", "… `else if` chain with no terminal `else`") |
| purity sweep back to `[...fn.body.stmts]` | the four new IR cases, incl. "reports an impure call nested two `if`s deep exactly once" (expected 1, got 0) |
| restore the `deriveEventSubscriptions` early return | all five "`<backend>` emits the uncarried projection fold and workflow reactor" |
| restore elixir's `carried` filter in `resolveProjectionSubs` | `vanilla` alone — "projection fold not emitted" |
| both of the above, on the BOOTED node app | `GET /api/projections/order_board/<id> → 404 "OrderBoard <id> not found"` |
| elixir: drop `domainServiceTier`/`readingServiceModule` | "the reading call is not in its backend's shape: expected … to contain `Context.is_holder_free(holder)`", its two-port twin, and the elixir sweep (`D.Domain.Services.Registration (reading op — no such module)`) |
| java: drop `serviceReading` | the one- and two-port calls |
| java: drop the domain-service imports | "the handler cannot reach the service: missing `import com.loom.d.domain.services.Registration;`", "the pure class is named but unreachable", and the java sweep (3 offenders) |
| dotnet: drop the reading-call resolver | the one- and two-port calls |
| dotnet: drop the `using D.Domain.Services;` | the reach + pure assertions and the sweep |
| revert the `contains` argument check to `firstNonQueryableNode(e.args[0]!)` | 15 of 23 — all fourteen refusal cases across 7 platforms × 2 sites, plus "the diagnostic names the argument, not the membership"; and 3 of the rewritten `find-predicate-capability` pins, which assert the MOVE (null at the adapter AND named at the neutral gate) rather than the deletion |
| C4: pin `forbidden = 403` in `errorStatuses` (ignore the `httpStatus` map) | the five `<backend>: with the override BOTH rungs declare 451, route-scoped` arms |
| C4: make `resolveErrorStatus` ignore overrides for `Forbidden` | all ten — the five declared-set arms AND the five `the runtime arm follows the override` arms |

## 9. Compile / boot proofs

- `handler-triad.ddd` (extended) COMPILED on all five: **dotnet** `dotnet restore` + `dotnet build
  /warnaserror` in `mcr.microsoft.com/dotnet/sdk:10.0`; **java** `gradle --no-daemon testClasses
  bootJar` in `gradle:9-jdk25`; **elixir** `mix deps.get && mix compile --warnings-as-errors` in
  `hexpm/elixir` with `LOOM_HEX_MIRROR=1`; **node** `LOOM_TS_BUILD=1 LOOM_CORPUS_TSC_CASE=handler-triad`;
  **python** `LOOM_PYTHON_BUILD=1 LOOM_CORPUS_PYTHON_CASE=handler-triad` (`uv sync` + `ruff check` +
  `mypy --strict`). Two of those five FAILED first and are the reason the fixture is worth having
  (the java `inferExprType` defect, §3.3; the python F811 collision, §5.6).
- The booted node proof for D-PROJECTION-IMPLICIT-SUB, both directions (§3.2).
- **M-T3.16 C4 was MEASURED before it was pinned.** The guarded-lifecycle system was generated on
  all five with and without `httpStatus Forbidden -> 451`, and each route's declared status set plus
  the runtime handler arm read by hand, BEFORE any assertion was written. All five already emitted it
  correctly — so the row was a missing golden rather than a gap, which is what the ledger said. A
  test written first would have been indistinguishable from one written against whatever the emitters
  happened to do.
- `domain-services.ddd` and `projection-implicit-sub.ddd` were verified by GENERATION on all five
  (the corpus generation gate plus the per-backend symbol assertions); neither adds a runtime shape
  its carried twin does not already boot.

## 10. Local gates on the merged tree

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `181 files, 469 errors, src/ clean` — unchanged baseline |
| `npm run lint` (`biome ci .`) | clean |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `npm test` | **GREEN** — `2062 passed \| 89 skipped (2151)` files, `24248 passed \| 7 expected fail \| 1150 skipped (25405)` tests, 1871s (the box carried two sibling packets throughout, load 9-15) |
| per-backend compile legs | §9 — all five, on the one corpus case this packet extended |
| behavioral node leg | §3.2 — booted, both directions |

**Four suites the last two commits' REMOVALS left asserting a rule that had moved** — all found by
the full run and re-pointed in `537b05795`, none of them a regression in behaviour:

| suite | what it asserted | what it asserts now |
|---|---|---|
| `test/ir/ui-realtime-support.test.ts` | the DELETED `#backend-serves-no-sse` arm, on `react -> static` and `flutter -> static` | the phase-④ "cannot target another frontend" error that makes the shape unreachable, AND the IR check's silence on it. It only ever reached the arm because this file parses with `validate: false` — which is the whole reason the arm went |
| `test/adapters/node-mikroorm-query-projections.test.ts` | `loom.find-predicate-unsupported` on mikroorm and CLEAN on drizzle | one loop over BOTH adapters: the neutral `loom.projection-where-not-queryable` names the projection and the `<column>`, and the adapter code fires on neither. The old split WAS the defect — drizzle was clean because the gate keys on `dep.persistence`, and then crashed codegen |
| `test/platform/allowlist-ratchet.test.ts` | `BEHAVIOURAL_ABSENT` at most 21 | 22, with the raise reasoned inline for `projection-implicit-sub` (the one entry on that list whose runtime half was actually BOOTED first; the block is not committed because the behavioural leg drives ONE backend and would freeze a node-only golden for an all-five contract) |
| `test/system/generate-helper-gate.test.ts` | the old `loom.persistence-mode-unsupported` spelling | the renamed `loom.datasource-binding-missing` |

**Two failures that are NOT this packet's and fail in ANY git worktree:**
`packaging-split-fs-discovery` and `packaging-split-core-pkg` need
`node_modules/@loom/backend-hono-v{4,5}` workspace symlinks, which only the main checkout has.
Confirmed by creating the two symlinks by hand, after which all 10 cases pass; 2b's hand-off recorded
the same thing. Nothing in the repo changes, and the green run above was taken with the symlinks in
place (they are gitignored).

**A process note worth passing on.** The first full `npm test` of this packet was run while the tree
was still being edited, and its verdict had to be thrown away — some of the six failing files were
real (the four above) and some were artifacts of the overlap, and nothing in the output distinguishes
them. Editing during a suite run does not merely add noise, it makes the run UNUSABLE, and on this box
that costs half an hour: 1871s for the "fast" suite under a load average of 9–15 from two sibling
packets, against the ~6 minutes the README quotes for an idle 4-core.

## 11. Decisions this packet took (all three in `docs/decisions.md`)

| tag | ruling |
|---|---|
| **D-PAGE-BODY-EXPRESSION** | a page body is an expression tree; the statement `if` stays refused on every frontend; the ternary / value-`match` are the forms. Owner **M-T1.20**. |
| **D-SENSITIVE-INSPECT-ONLY** | `sensitive(...)` is inspect-only today; wire masking is `mask unless`; phases 2–4 stay a commissioned **M-T3.8** rather than a drain row. |
| **D-PROJECTION-IMPLICIT-SUB** | not new — RULED before this packet, **APPLIED** here. Its status line moves `proposed` → `PINNED — APPLIED`, and an "As built" paragraph records the two things the ruling did not anticipate (that the reactor twin warning had to go with the projection one, and that node's fold filter was reading an enricher-stored subscription set derived without projections). |

## 12. Decisions still wanted from the owner

1. **`polymorphic-id-ref-unsupported` needs a representation ruling** (§5.1) before any backend can
   emit it: polymorphic FK (discriminator column, no referential integrity) vs no-FK + union-view
   reader. It is visible in the emitted DDL, so it is a D-tag, not an implementation choice.
2. **`loom.find-predicate-unsupported` may now be unreachable** (§4). Someone has to either prove the
   descriptors cannot fire over the whole queryable subset, or delete them — a `gap` row that nothing
   can trip is the same stall the three renamed rows were.
3. **M-T5.36's scope**, if it is picked up: widening `if let` / `for` sources is a language-surface
   change (which declared finds may be bound how), so it may want a ruling of its own rather than
   inheriting the three register rows' framing.

### C2 packet 2n — backend adapters + cross-backend residue (batch 3) — `claude/c2-backends-3`

*Base: the wave-C2 batch-3 coordinator head `f90e5d78f` (= `main` @ `5049b6fea` plus the wave-log
commit), then `origin/main` merged mid-packet at the coordinator's instruction (four PRs: #2906,
#2962, #2959, #2914). Branch `claude/c2-backends-3`, never pushed, no PR of its own — the wave PR
(#2970) is the claim.*

> **Interrupted and resumed TWICE.** Terminated by an Opus rate limit on 2026-09-14 mid-deletion
> (resumed 2026-09-20 from an intact worktree with nine dirty files and no commit landed — the
> `origin/main` merge above happened on that resume, before any further edit), and again on
> 2026-09-20 ~17:00Z while the full suite and the behavioral leg were running (resumed 2026-09-21
> from a clean tree at `46e5bfa69`; the container restart took both runs, dockerd and the
> `loom-pg-c2` Postgres container with it). §10a and §9 report the FINAL, uninterrupted runs.

## 1. Commits

| commit | what |
|---|---|
| `e6486a043` | **`loom.find-predicate-unsupported` drained** — the predicate POSITION, not four adapter subsets |
| `c88ef286f` | **D-FIRST-ON-EMPTY applied** — `.first` is PARTIAL on all five, `firstOrNull` total; **RS-36** minted |
| `46e5bfa69` | **D-POLYMORPHIC-ID-REPRESENTATION** (proposed), **M-T5.37** minted, the **M-T2.17** measurement |
| `NOTE` | the two reference docs that still described the deleted gate, and this note |

`MAX_OPEN_GAPS` **20 → 19**; `LATENT_SEAMS` **25** (unchanged); `UNDOCUMENTED_BASELINE` **366 → 365**.
Ledger: `F2-EXPR-7` `open → done` (open 123 → 122, done 166 → 167), counts regenerated.

## 2. Rows → outcome

| row | outcome | evidence |
|---|---|---|
| `loom.find-predicate-unsupported` (M-T6.35) | **DRAINED — built, not deleted on a claim** | §3.1. The row was NOT unreachable: it fired on five shapes, four of which ALSO crashed drizzle codegen from source that validated `0 error(s)`. Closed target-neutrally + two real emitter builds + one Dapper defect the census found. |
| `loom.dapper-unsupported` / `loom.mikroorm-unsupported` (M-T6.35 / M-T6.23, **M-T2.17**) | **NOT built — hand-off §5.1**, with three measurements that shrink it | The L does not fit alongside the rest, and there is **no shared phase-⑨ half left to land** — it is already done (§5.1). Both register rows kept; `dapper-no-schema-evolution` stays open. |
| `loom.polymorphic-id-ref-unsupported` (M-T5.7) | **RULED, not built — `D-POLYMORPHIC-ID-REPRESENTATION` + a measured recipe** | §3.3. The ruling DIVERGES from the plan's proposed default, on measurement. The remaining build is two identity types, not a schema. |
| `loom.workflow-handle-unsupported` (M-T6.58) | **verified accurate, unchanged — owner decision re-measured** | §5.2. Not built, not deleted, per the OWNER-ONLY instruction. |
| ledger `F2-EXPR-7` (P3, M) | **BUILT** | `c88ef286f`. node + elixir stopped degrading; RS-36 minted. |
| ledger `M-T1.11-domain-floor-message-code` (P2, L) | **NOT built — hand-off §5.3** | Re-confirmed as an L with a wire-golden re-capture; it collides with the C5 decimal re-capture exactly as the launch note feared. |
| ledger `F2-W-09` / `F2-W-08` / `F2-W-12` / `F2-W-14` | **NOT built — re-dispositioned as ONE coordinated moment, §5.4** | All four are OpenAPI component/nullability divergences. Individually S/M; together they are a single 5-way OpenAPI parity re-capture, and building one alone moves `conformance-parity.yml` for a diff nobody reviewed. |
| ledger `M-T5.7-inheritance-tail` (P3, M) | **one third of it now RULED** | Its first item IS `polymorphic-id-ref-unsupported` (§3.3). The other two (`tph-backend-unsupported`, `tph-own-override-unsupported`) untouched. |
| ledger `M-T3.15-E2-getbyid-no-gate-surface` (P3, S) | **verified, and it is WIDER than the row says — §5.5** | Not just "no gate surface": `findAll` is reserved on **java only**, so the shadowing trick the row names as the working alternative works on four backends and is refused on the fifth. |
| ledger `M-T5.19-a-workflow-test-anchor` (P3, S) | **verified accurate, not built — §5.6** | Grammar line unchanged on this head; the "S" is a grammar edit plus five test emitters. |
| ledger `M-T5.5-stdlib-tail` (P3, S) | **verified accurate, not built** | Three independent unbuilt things behind one row; nothing to drain, see §5.6. |
| ledger `workflow-projection-rename-unexpressible` (P3, M) | **not built** — §5.6 | |
| the IR two-spellings class | **MISSION MINTED — M-T5.37** | `46e5bfa69`. 2f's five-backend measurement and 13-site census are its body. Numbered `.37` because `.36` was already taken by 2f's own dispositions — **check before minting**. |

## 3. The built rows, stated properly

### 3.1 `loom.find-predicate-unsupported` — the position, not the adapter

The row's own drain condition (M-T6.35) was "show the descriptors cannot fire, or delete them".
Packet 2f suspected unreachability. **It was reachable**, on five shapes — measured by probing each
`ExprIR` kind in predicate position against the mikroorm descriptor:

```ddd
find f1(): Order[] where this.flags.active     // a bool VALUE-OBJECT sub-property
find f2(): Order[] where !this.flags.active
find f3(f: bool): Order[] where f              // a bool PARAMETER
find f4(): Order[] where currentUser.isAdmin   // a bool CLAIM
find f5(): Order[] where true                  // a literal
```

and four of those five ALSO **crashed drizzle codegen** from source that validated `0 error(s)`:

```
QueryEmissionRefusal: drizzle-predicate: where-clause for find 'f1' on 'Order' is outside the
declared query-emission vocabulary — the IR validator should have rejected this filter before
codegen reached it.
```

So it was never an adapter narrowing. `firstNonQueryableNode` is position-BLIND — it asks "could
this node reach SQL at all", which is the right question for a comparison OPERAND and the wrong one
for the predicate itself, because every relational lowerer's output vocabulary is
`<fn>(<column>, <value>)`: no left-hand value position and no bare-value position. A predicate with
no column in it is admitted and then has nowhere to go, and the five targets disagree four ways:
drizzle throws at generate time, MikroORM refuses per-adapter, EF Core / JPA / SQLAlchemy each emit
a host-language boolean into a `WHERE` (`.Where(x => true)`, `select(...).where(f)`), which is a
different query from the one that was written. **Four outcomes for one source, none of them a
diagnostic** — the same shape as the `contains(<column>)` crash packet 2f closed, and closed the
same way.

Three things beyond the obvious fix:

- **`firstNonQueryablePredicate` is a SECOND gate, not a replacement.** It walks predicate positions
  (`&&` / `||` / `!` / parens) and requires every leaf to TEST a column; everything INSIDE a leaf is
  still judged by `firstNonQueryableNode`, which stays the value oracle and keeps its parity test.
  Wired at the four predicate call sites (find, retrieval, capability `filter`, query-time
  projection `where`). The criterion-emission call sites in `dotnet/criteria-emit.ts` and
  `java/emit/criteria.ts` were deliberately NOT moved: they ask "can I compile this to SQL", the
  narrower question, and answering it more strictly would silently stop emitting compiled criteria.
- **One diagnostic genuinely collides with another, and the full suite is what found it.** An
  undeclared `this.isDeleted` lowers with `memberType: primitive string` — **byte-identical to a real
  `string` column** (measured on a repository find with a real aggregate, not just on the
  context-filter path). So the shape gate cannot tell "this column does not exist" from "this column
  is not a boolean", and two existing pins want opposite answers:
  `context-filter-selectability.test.ts` wants *unknown field* for `filter !this.isDeleted`, while
  `validation.test.ts` wants *collection op `.any`* for `where this.lines.any(l => …)` — and
  `firstUnknownColumnRef` calls a CONTAINMENT "unknown" too. Reordering the two checks satisfies
  exactly one of them, and the first attempt at this packet did that (and broke the second, which
  only the full `npm test` caught — the targeted suites were green).
  The resolution is narrower than an ordering: the shape gate **DEFERS exactly one shape** — a
  `this`-rooted column reached as a plain member / bare ref, standing alone — and the call sites run
  `firstNonQueryablePredicate` → `firstUnknownColumnRef` → `bareColumnPredicateLeaf`. So the gate's
  own verdicts (`collection op '.any'`, `lambda`, arithmetic, a comparison with no column) stay
  authoritative, a missing column is named as missing, and `where this.code` over a column that DOES
  exist is still refused. The deferral is deliberately NOT `isColumnRef`: that predicate also admits
  a queryable intrinsic over a column, and `this.code.startsWith("A")` is a whole predicate, not a
  bare leaf — deferring it refused a legitimate shape, which the census caught on all four adapters.
- **A context-level `filter` is lowered with NO aggregate to resolve `this` against.** Measured:
  `filter !this.isDeleted` over a *declared* `isDeleted: bool` lowers with
  `memberType: { kind: "primitive", name: "string" }` — a fall-through, not the column's type. So
  that one call site passes `{ thisTypesUnresolved: true }` and the gate checks STRUCTURE only.
  **This is a real IR defect, not a quirk to route around** — see §5.7, and it is the same
  placeholder that makes the collision in the bullet above unavoidable at the find site.

Two emitter builds and one found defect:

| target | before | after |
|---|---|---|
| drizzle | `booleanColumnRef` matched only `this.<field>`, so a bool VO sub-property crashed codegen | delegates to `renderColumnRef`, reaching the flattened `<field>_<sub>` column its COMPARISON path already targeted |
| mikroorm | `booleanColumnName` likewise; the shape emitted `throw new Error("mikroorm v1: this find's predicate is not yet supported")` as the method BODY | delegates to `thisFieldColumn`, same column |
| **dapper** | **not `FULL_SUBSET` as the register claimed** — `whereToSql` had no VO-flattened arm AT ALL, so `this.flags.label == "x"` as much as the bare bool became `throw new NotImplementedException("Dapper v1 does not support this find's predicate.")` | one `member` arm, `<vo>_<sub>` |

The Dapper defect is the census earning its keep: it is a COMPARISON, not a bare boolean, so no
amount of reasoning about "the bare-predicate position" would have found it.

With no narrowing left that the neutral gate does not already refuse,
`src/ir/util/find-predicate-capability.ts` (220 lines), `validateFindPredicateAdapterSupport`, the
`loom.find-predicate-unsupported` message, its register row and its two dedicated test files are
deleted. `orm-adapter-checks.ts` keeps a block comment at the foot recording why, so the next reader
does not re-mint the idea.

### 3.2 D-FIRST-ON-EMPTY — and the assertion that actually catches it

Ledger `F2-EXPR-7`. Built exactly as ruled; two things the ruling did not anticipate:

- **The node guard cannot be a ternary.** `recv.length > 0 ? recv[0] : …` emits the whole receiver
  CHAIN twice, and `_expr/js-collection-ops.ts` is shared with the four JS frontend walkers, where a
  receiver can contain hook calls. It is an arrow IIFE taking the receiver as a parameter, and
  "names the receiver exactly once" is itself pinned.
- **"`first` raises" is the wrong gate.** elixir's defect was that `first` and `firstOrNull` were
  *literally the same snippet* (`List.first/1`) — which reads as a plausible implementation of
  either op and satisfies no raise-shaped assertion. The test that catches it is
  **"`first` and `firstOrNull` render DIFFERENTLY"**, per backend.

The FRONTEND half the decision's Consequences mention is **vacuous today** and is recorded as such
in RS-36 rather than claimed: `loom.frontend-collection-op-unsupported` refuses every stdlib
collection op in a page body, so the shared table's guard is backend-reachable only.

### 3.3 D-POLYMORPHIC-ID-REPRESENTATION — the ruling diverges from the plan's default, on measurement

The launch instruction said: take the default, "no FK + a discriminator column pair `(kind, id)`".
**Measured with rule 6 bypassed, the discriminator is unnecessary and the schema needs no change at
all.** The ruling is a PLAIN id column — no FK, no discriminator:

- **The FK is already dropped**, by a rule that predates the question: `migrations-builder.ts` keeps
  a foreign key only when its target table exists in the same schema (the M-T4.4 cross-context
  rule). A TPC base OWNS NO TABLE, so its FK fails that test automatically. node emits exactly the
  intended DDL with **no code change**: `"payment_id" UUID NOT NULL` +
  `CREATE INDEX "receipts_payment_id_idx"`, no `REFERENCES`.
- **The discriminator buys nothing**: `lower.ts:1673` makes every aggregate id a guid, so ids cannot
  collide across the concrete tables — and the reader that would consume a discriminator does not
  want one. `buildDelegatingBaseReaderFile` resolves `findById` by trying each concrete repository
  in turn, which is what loads each aggregate's FULL tree through its own capability filters; a
  discriminator-directed single query would not.
- **A union view is strictly worse here**: it can only project the columns the concretes share, so
  it reads flat scalars and silently drops contained parts and `X id[]` — the trade the TPC reader's
  own comment records rejecting.

Generated on all five with the gate bypassed, `ddd generate` reports `0 error(s)` everywhere and the
reference column is correct everywhere. The whole remaining gap is **two identity types**:

| target | with the gate bypassed |
|---|---|
| node | correct — `payment_id uuid` + index, no FK; `Ids.PaymentId` exists |
| python | correct — `PaymentId = NewType("PaymentId", str)` exists |
| elixir | correct — `field :payment_id, :binary_id`; no identity type needed |
| **java** | **breaks** — `Receipt.java` declares `@Embedded PaymentId paymentId`, but `src/generator/java/index.ts` skips `<Base>Id` for an abstract TPC base (`if (agg.isAbstract && !isTphBase(agg, ctx.aggregates)) continue;`), so no `PaymentId.java` is emitted → `cannot find symbol` |
| **dotnet** | **breaks** — `ReceiptConfiguration.cs` calls `new PaymentId(v)`; same skip at `src/generator/dotnet/context-scaffolding-emit.ts:61` → no `Domain/Ids/PaymentId.cs` |

Both skips carry the comment *"an abstract TPC base keeps no identity (each concrete owns a typed
id)"*, which was true **exactly while this reference was refused**. Nothing was changed — the
bypass was an experiment, reverted by file copy.

## 4. The register, row by row

`MAX_OPEN_GAPS` **20 → 19** (one row deleted), `LATENT_SEAMS` unchanged at **25**,
`UNDOCUMENTED_BASELINE` **366 → 365**.

- **`loom.find-predicate-unsupported` — DELETED**, with its message, its descriptor module, its two
  dedicated test files, and its entries in `diagnostic-firing-census.data.ts` and
  `diagnostic-docs-undocumented.ts`. Replaced by
  `test/ir/find-predicate-position-census.test.ts`, which asserts what the deletion RESTS ON rather
  than what it removed (§7).
- **`loom.polymorphic-id-ref-unsupported` — `what` rewritten** to carry the measurement and the
  drain condition: emit `<Base>Id` on java + dotnet, narrow the sibling
  `loom.polymorphic-id-ref-mixed-strategy` (which fires on a PURE TPC hierarchy once the `ownTable`
  arm goes — every concrete reads as an "override"), and settle the id-FOLLOW path. Still `gap`,
  still M-T5.7.
- **`loom.dapper-unsupported` / `loom.mikroorm-unsupported` — unchanged.** Their drain is M-T2.17's
  green e2e leg, per D-DAPPER-ALTER; nothing this packet did moves that.
- **`loom.workflow-handle-unsupported` — unchanged**, deliberately (§5.2).

## 5. Hand-offs — not built, with what was measured

### 5.1 M-T2.17 — three measurements that shrink it, and one that says "do not start here"

Recorded in the mission body (`docs/new-plan/T2-data-evolution.md`), repeated here for the fold:

1. **There is no shared phase-⑨ half left to land.** The launch note's fallback ("land the shared
   phase-⑨ half + one adapter") assumes one exists; it does not. `assignMigrationsOwner`
   (`src/ir/enrich/enrichments.ts:388`) picks the owner off `PlatformSurface.needsDb` and is
   **adapter-blind**, so a `persistence: dapper` / `persistence: mikroorm` deployable already IS a
   legitimate `migrationsOwner` and `system.migrations` is already populated for it. The chain is
   computed and then thrown away at the two `hasMigrations` guards
   (`src/platform/hono/v4/emit.ts:1163`, the dapper twin in `src/generator/dotnet/index.ts`). What
   is missing is entirely the per-adapter APPLIER, twice — which is why the "shared half" fallback
   was not taken.
2. **Do not invent a second ledger.** **#2946** is open on this fence and adds
   `src/system/migration-ledger.ts` (+273) plus `migration-artifacts.ts` changes, for the
   silent-re-baseline defect. That is the `__loom_migrations` concept slice (c) needs. This packet
   touched neither file.
3. **mikroorm cannot reuse drizzle's runtime migrator** (`drizzle-orm/node-postgres/migrator` is not
   a dependency of that project), so it needs its own `db/migrate.ts` applying the emitted `.sql`
   set through `em.getConnection().execute`, with `orm.schema.updateSchema()` REMOVED in the same
   change — the two fight over the same schema.

**Recommendation:** sequence after #2946 merges, then do mikroorm first (TypeScript, and its
behavioral leg is the cheapest of the two to boot), and hand dapper off with the same recipe.

### 5.2 `loom.workflow-handle-unsupported` — verified, and the removal blast radius re-measured

Per the OWNER-ONLY instruction: **not built, not deleted.** The row still reflects the code —
`validateWorkflowHandlers` (`src/ir/validate/checks/workflow-checks.ts:384`) errors on every
`handle`, and no backend emits one. `wf.handlers` is read at exactly five sites, all
DEPENDENCY-COLLECTION, none emission: `java/emit/workflow.ts:255,260` (repos used by reactor
bodies), `java/capability-filter.ts:133,260`, `python/repository-builder.ts:733`.

**What removal would touch**, so the owner's decision is one paragraph: **12 `src/` files / 44
references** (excluding `src/language/generated/`) — `ddd.langium` (`HandleDecl` at :1499 and its
`WorkflowMember` arm at :1475), `print/print-structural.ts` (pinned by `print-completeness`),
`lower-workflow.ts` (`lowerHandle`, :124/:145/:174), `loom-ir.ts` (`HandleIR`, `WorkflowIR.handlers`
:1320), `ddd-scope.ts`, `type-system.ts`, `lsp/member-refs.ts`, `ir/util/model-exprs.ts`, and four
`language/validators/` files — plus the five consumer sites above, **7 test files** and **3 docs**
(`docs/workflow.md`, `T5-language-core.md`, `T6-backend-parity.md`). A grammar removal, so
`langium:generate` + committed output.

### 5.3 M-T1.11 item (c) — re-confirmed, and the collision the launch note feared is real

Ledger `M-T1.11-domain-floor-message-code`, size **L**, node/dotnet/java/python. Re-verified: every
`messageCode()` call site is still the WIRE rung and every domain-floor throw still takes raw text.
The fix needs a wire golden asserting `errors[].code` on a domain-only rule — **and that is the same
capture C5's decimal re-baseline owns.** Landing it here would have re-captured the goldens for a
reason unrelated to C5 and then been re-captured again. **Not attempted; nothing changed.**
Recommendation: fold item (c) INTO the C5 re-capture as one golden moment, rather than sequencing it
before or after.

### 5.4 The `F2-W-*` family — four rows, one coordinated moment

`F2-W-09` (a `File` field: inline anonymous object on node/elixir vs a named `FileRef` component on
dotnet/java/python), `F2-W-08` (a value-object field: ONE shared component on node/python/elixir,
`<VO>Request` + `<VO>Response` on dotnet/java), `F2-W-12` (java publishes a non-nullable schema for
fields it serializes as `null`), `F2-W-14` (dotnet publishes an empty schema for a union-returning
200 body — no `UseOneOfForPolymorphism`). All four re-verified as accurate.

They are individually S/M and were listed as four rows, but **each one moves the served OpenAPI
document**, which is what `conformance-parity.yml` diffs across the five backends in STRICT mode
(`LOOM_E2E_STRICT_PARITY=1`). Building one alone turns that gate red for a diff nobody reviewed, and
building `F2-W-12` in particular (the "S") means threading a `nullable` set through
`buildJavaOpenApiContract`'s `Contract` the way `required` already is — the same plumbing
`F2-W-09`/`F2-W-08` need for `propertyTypes` / `schemaNames`. **Recommendation: re-disposition the
four as ONE mission ("the OpenAPI component contract is the same on five backends"), sequenced with
the C5 capture, rather than four independently-pickable rows** — which is also why none was built
here.

### 5.5 `M-T3.15-E2` — the row is accurate and NARROWER than the defect

The row says the by-id read has no author gate surface, because `loom.find-reserved-name` refuses a
find named `getById`, and offers `find all` shadowing as the working alternative. Both halves
verified — and the alternative is **not cross-backend**:

```
dotnet  reservedRepositoryFindNames = { saveAsync, getByIdAsync }
node    = { save, findById, getById, delete }
python  = { save, findById, getById, delete }
java    = { save, findById, getById, delete, findAll }      <-- findAll, java only
elixir  = { get, read, create, update, destroy }
```

The set is a UNION across all platform descriptors (`unionReservedFindNames`), so java's extra
`findAll` makes the shadowing trick the row recommends **refused for every project**, on behalf of
one backend. Whoever picks this up should decide both questions together: open `getById` for
shadowing, and whether java's `findAll` reservation is a real collision or a naming accident.

### 5.6 The three remaining P3 rows — verified, not built, with the reason

- **`M-T5.19-a-workflow-test-anchor`** (S). Accurate on this head: `WorkflowMember` at
  `ddd.langium:1475` still lists `WorkflowCreateDecl | Apply | OnDecl | HandleDecl | Property |
  FunctionDecl` with no `TestBlock`, and `checkTestPlacement` still gates on
  `isAggregate || isValueObject || isDomainService` (`test-placement.ts:59`). The "S" is the grammar
  arm; what follows it is a test EMITTER on five backends, which is not S. Note the entanglement
  with §5.2: `HandleDecl` sits in the same production, so a `handle` removal and this addition touch
  the same line.
- **`M-T5.5-stdlib-tail`** (S). Accurate, and it is three independent unbuilt things behind one row
  (block-form top-level functions honestly refused; `duration` not a storable column type; the
  prelude still built in code rather than `std/*.ddd`). Nothing to drain — it should be SPLIT before
  it is picked up, not sized.
- **`workflow-projection-rename-unexpressible`** (M). Accurate; the grammar's `TableRename` still
  types its live side `[Aggregate:ID]`, so a workflow/projection table cannot be named. Untouched —
  it lands in `migrations-builder` territory, which **#2946** is rewriting.

### 5.7 Found on the way, NOT this packet's row — a context-level `filter` has no types

`filter !this.isDeleted` at CONTEXT level, over a field declared `isDeleted: bool`, lowers to
`member` with `receiverType` AND `memberType` both `{ kind: "primitive", name: "string" }` — a
fall-through placeholder, because the predicate is lowered once for the context with no aggregate to
resolve `this` against, then propagated to each aggregate by the enricher. Every consumer that reads
a context-filter's member TYPE is therefore reading a lie. Nothing downstream happened to depend on
it (the SQL renderers key on the column name), which is why it has survived, and the new predicate
gate routes around it explicitly (`thisTypesUnresolved`) rather than silently.

**Recommendation:** fold into **M-T5.37** — it is the same family (an IR shape that carries less
than it claims), and the fix is in the same file. No ledger row minted; that register belongs to the
loom-eval wave.

## 6. Open PRs on this fence — cited, not duplicated

Read at launch and re-read after the `origin/main` merge:

- **#2946** (migration silent re-baseline) — `src/system/migration-artifacts.ts` +
  `src/system/migration-ledger.ts` (new, +273). **Directly relevant to M-T2.17** and the reason
  slice (c) must not write its own ledger (§5.1). Neither file touched here.
- **#2940** (query-time projection `select` resolution) — touches the projection read path. This
  packet changed `projection-checks.ts`'s `where` gate ONLY (one call swapped to
  `firstNonQueryablePredicate`); the `select` resolution is a different region.
- **#2945** (`currentUser` in a read filter, three backends' predicate lowering) — **the closest
  overlap.** It changes how a principal reference LOWERS; this packet changes which predicate SHAPES
  are admitted, and one of the five shapes drained here is `where currentUser.isAdmin` standing
  ALONE as the whole predicate. If #2945 lands first, re-run
  `test/ir/find-predicate-position-census.test.ts` — its "currentUser claim in predicate position"
  row is the one that would move.
- **#2947** (four codegen defects, incl. `== null` in a criterion) — criterion path; the criterion
  emitters were deliberately left on `firstNonQueryableNode` (§3.1), so no overlap.
- **#2939** (emitted TypeScript imports / binder gate) — the node guard added by `c88ef286f`
  introduces no import.
- **#2957 / #2958 / #2962** (testability fleet) — `src/generator/**` test emitters; #2962 merged
  into this branch with `origin/main`.
- **#2949**, **#2943**, **#2944**, **#2938** — no file in common.

Nothing was duplicated. The one hunk another PR is likely to touch is
`src/ir/validate/checks/query-checks.ts` (#2945's territory): this packet's change there is
**four lines** — three call swaps and one reorder — and is described in §3.1 so the coordinator can
compose it by hand if it conflicts.

## 7. Gate shape (rules 11 / 12 / 13)

- **The census asserts what the deletion RESTS ON, not what it removed.**
  `find-predicate-position-census.test.ts` is 17 shapes × 4 adapters: part 1 asserts every adapter
  gives every shape the SAME verdict (which is the property the per-adapter descriptors broke), and
  part 2 asserts every ADMITTED shape emits a REAL query on all four. A deleted-code test would have
  gone stale the moment the code went.
- **A gate that did not reach what it named, caught in the act.** Part 2's first draft checked only
  that each find's NAME appeared somewhere in the emitted tree. It **PASSED with the MikroORM fix
  reverted** — because the stub *carries the name*: `async b3() { throw new Error("mikroorm v1: this
  find's predicate is not yet supported"); }`. Strengthening it to fail on a stub SENTINEL is what
  then found the Dapper defect nobody was looking for. This is §59/§63 exactly, and it is the reason
  the mutation proofs below are listed per-assertion.
- **An expected value from outside the emitter.** `collection-op-first-partial.test.ts` takes each
  backend's expected raising form from **D-FIRST-ON-EMPTY's own text** (dotnet `.First()`, java
  `.get(0)`, python `[0]`, elixir `hd(`), not from what the table happens to say — so the pins
  cannot be agreement between two wrong things. It also carries a vacuity guard asserting the
  catalogue still declares `first: T`, since the whole rule rests on that.
- **The corpus.** No new corpus fixture: neither built row adds a SHAPE the corpus lacks — the
  find-predicate work makes previously-crashing shapes emit (and the census drives all four adapters
  itself, which the corpus cannot), and `.first` is already exercised. Stated rather than skipped
  silently.

## 8. Mutation proofs (file copy, never `git checkout --`)

| mutation | failing assertion |
|---|---|
| `firstNonQueryablePredicate` → a passthrough to `firstNonQueryableNode` | 5 of 21 — "drizzle must REFUSE 'literal in predicate position' through the target-neutral gate" and its four siblings (bool parameter / currentUser claim / non-bool column / comparison with no column) |
| drizzle `booleanColumnRef` back to `this.<field>` only | "drizzle emits a real query for every admitted predicate" → `QueryEmissionRefusal: drizzle-predicate: where-clause for find 'b3' on 'Order'` |
| MikroORM `booleanColumnName` back to `this.<field>` only | "mikroorm emitted an unsupported-predicate STUB for one of the 11 admitted shapes" — **and note: this mutation PASSED against the census's first draft** (§7) |
| the Dapper `member`-on-`member` arm removed | "dapper emitted an unsupported-predicate STUB …" |
| elixir `first` back to `List.first(...)` | 2 — "elixir: `first` renders a form that FAILS on an empty receiver" and "elixir: `first` and `firstOrNull` are DIFFERENT renderings" |
| node `first` back to `${recv}[0]` | 2 — "node: `first` renders a form that FAILS on an empty receiver" and "the failure message names the total form" |
| delete the `bareColumnPredicateLeaf` fallback at the find site | 1 — "all four adapters agree on: non-bool column in predicate position" (the deferred shape stops being refused at all) |
| defer on `isColumnRef` instead of `isBareColumnLeaf` | 4 — every "emits a real query" arm, on `this.code.startsWith("A")`: a bool-returning intrinsic over a column is a whole predicate, not a bare leaf (this was a real bug in the first draft of the deferral, caught by the census) |

## 9. Compile / boot proofs

**Stated plainly: no Docker compile leg and no boot proof was run for this packet, and neither row
needed one.**

- The find-predicate row's oracle IS the generator: drizzle `refuseOutOfVocabulary` throws at
  generate time and MikroORM / Dapper emit a stub body, so "does it emit a real query" is decided at
  generation, which the census drives for all four adapters on every admitted shape. The row changes
  no runtime SEMANTICS — every shape it now admits was already emitted correctly by EF Core, JPA and
  SQLAlchemy, verified by reading the emitted `Where(x => x.Flags.Active)` /
  `select(OrderRow).where(OrderRow.flags_active)` by hand before any assertion was written.
- D-FIRST-ON-EMPTY changes a LEAF snippet on two backends; its runtime behaviour (`hd([])` raises
  `ArgumentError`, a `throw` throws) is the host language's, not Loom's.
- The polymorphic-id work generated all five targets and read the output; it landed no code.
- **The node BEHAVIORAL leg was run** (`test/behavioral/run.mjs`, PGlite, docker-free) because this
  packet changed node runtime on two paths (the drizzle predicate lowering and the `.first` guard):
  **128 passed, 0 failed, 14 skipped**, and the **wire differential reports 59 cases compared to
  golden, 0 divergences** — so neither change moved the wire.
- **What this leaves open, honestly:** nobody has booted a backend and confirmed that
  `where this.flags.active` returns the right ROWS. The predicate is a one-line SQL fragment on each
  adapter and the emitted spelling is pinned, but the row is closed on a GENERATION proof plus the
  node behavioral leg, not on a per-adapter runtime one. Docker's daemon and the `loom-pg-c2`
  container did not survive either session restart, and rebuilding them for a one-fragment assertion
  on mikroorm / dapper was judged not worth the runner time; if the wave wants it, the cheapest
  carrier is a `where`-shaped case on the existing `behavioral-e2e-mikroorm` / `-dapper` legs.

## 10. Local gates on the merged tree

**A note for the fold: these commits are NOT SIGNED, and it is not for want of the flag.**
Every commit was made with `git -c commit.gpgsign=true`, and the repo config is right
(`gpg.format=ssh`, `user.signingkey=/home/claude/.ssh/commit_signing_key.pub`,
`commit.gpgsign=true`) — but **that key file is 0 bytes and the private half is absent in this
container**, so signing produces nothing and exits 0. `git log --format='%G?'` reads `N` for
all of them (and `E` for the upstream merges, whose signatures this container cannot verify
either — no `gpg.ssh.allowedSignersFile`). Verified with an empty probe commit, which was also
unsigned and has been removed. Nothing in the packet can fix this; the coordinator should
re-sign at the fold if the wave PR needs signed commits.

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | `181 files, 469 errors, src/ clean` — unchanged baseline |
| `npm run lint` (`biome ci .`) | **red, and NOT from this packet — see below** |
| `node scripts/mission-counts.mjs --check` | up to date |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `npm test` | see §10a |

**`npm run lint` is red on `origin/main` as merged, independently of this packet.** Every offending
file is one this branch never touches, and `src/generator/angular/form-validators.ts` (an unused
`humanize` import, `noUnusedImports`) is **byte-identical to `origin/main`** — confirmed with
`git show origin/main:<path>`, and its last commit is `de454ff0c`, not mine. The full list, all
pre-existing: `angular/form-validators.ts`, `dotnet/dto-mapping.ts`, `elixir/auth-emit.ts`,
`elixir/domain/predicates.ts`, `flutter/index.ts`, `java/emit/{dto,service,workflow}.ts`,
`python/routes-builder.ts`, `ir/types/loom-ir.ts`, `ir/util/workflow-own-state.ts`,
`ir/validate/checks/{backend-syntax,projection-backend,ui,ui-collection-display}-checks.ts`,
`language/model-patch.ts`, `macros/stdlib/auto-paged-table.ts`,
`platform/hono/v4/routes-builder.ts`, plus four test files. **Every file this packet edited is
biome-clean** (verified per-file). The coordinator should know before folding: the fold will be
lint-red, and it was lint-red before the fold.

### 10a `npm test`

Redirected to a file with the exit code appended (`npm test > npm-test.log 2>&1`; never piped, per
batch 2's lesson that a piped run cannot fail).

```
Test Files  4 failed | 2102 passed | 89 skipped (2195)
Tests       6 failed | 24710 passed | 7 expected fail | 1159 skipped (25882)
Duration    2128.90s
NPM_TEST_EXIT=1
```

Six failures, in three groups, **all accounted for**:

| failure | verdict |
|---|---|
| `validation.test.ts > rejects find with non-queryable where (lambda)` | **REAL, and this packet's** — the diagnostic collision in §3.1. Fixed by the deferral; the targeted suites had been green, so only the full run found it. |
| `test/cli/migrations-destructive.test.ts` (1) | **starvation** — `Test timed out in 30000ms` while the box carried two sibling packets at load ~20 on 4 cores. **Re-run ALONE: passes in 6.85s.** It spawns `ddd generate system` twice as a subprocess; nothing in this packet touches `migrations-builder.ts` or the destructive gate. |
| `packaging-split-fs-discovery` (3) + `packaging-split-core-pkg` (1) | **worktree-only, pre-existing** — they need `node_modules/@loom/backend-hono-v{4,5}` workspace symlinks that only the main checkout has. 2b's and 2f's hand-offs record the same four. |

After the §3.1 fix the affected suites were re-run together —
`find-predicate-position-census` + `test/ir/capabilities` + `validation.test.ts` +
`generator/dotnet/capability.test.ts`: **298 passed, 0 failed.** The full suite was NOT re-run end
to end after that fix (a second 35-minute run on a box at load 20, for a change whose blast radius is
four suites that were re-run together and mutation-proved); that is the one gap in this row, and it
is named rather than papered over.

## 11. Decisions this packet took

| tag | ruling |
|---|---|
| **D-POLYMORPHIC-ID-REPRESENTATION** | *proposed* — a `<Base> id` to a TPC base is a plain id column: no FK, no discriminator, read through the delegating base reader. **Diverges from the completion plan's proposed default** (a `(kind, id)` pair), on the measurement in §3.3. Owner **M-T5.7**. |
| **D-FIRST-ON-EMPTY** | not new — ruled before this packet, **APPLIED** here. `proposed` → `PINNED — APPLIED`, with an "As built" paragraph for the two things the ruling did not anticipate (§3.2). RS-36 minted. |

## 12. Decisions still wanted from the owner

1. **`loom.workflow-handle-unsupported` — build the multi-command saga continuation, or remove
   `handle` from the grammar?** Unchanged and OWNER-ONLY, per instruction. The removal blast radius
   is re-measured in §5.2 (12 `src/` files / 44 references, 7 test files, 3 docs, a grammar
   regeneration) so the decision is one paragraph. Note the entanglement with
   `M-T5.19-a-workflow-test-anchor` (§5.6): both edit the same `WorkflowMember` production.
2. **Re-disposition the `F2-W-*` family as one mission?** (§5.4.) Four rows that each move the
   5-way OpenAPI parity diff are not four independently-pickable rows; keeping them separate
   guarantees that whoever picks the first one turns `conformance-parity.yml` red.
3. **Does M-T1.11 item (c) fold INTO the C5 golden re-capture?** (§5.3.) It needs the same capture;
   sequencing it separately means capturing twice.

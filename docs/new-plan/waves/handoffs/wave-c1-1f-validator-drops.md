# Wave C1 — packet 1f (validator silent drops) hand-off

*Branch: `claude/c1-1f-validator-drops`. Commits `a9ff0dc0` (M-T6.54 F18 + the two
verified flips), `587e725c` (M-T6.55 + the M-T6.50 narrowing), `ef77f11c` (this
note) and `d8837bef` (the new code's docs anchor + the reference line M-T6.55
outdated).*

## Headline

**Two of the six rows were already fixed and only needed running; two were real and
are fixed here; one was verified and belongs to packet 1b; one was half-done and is
narrowed.** Along the way the two new corpus fixtures found **four more defects** —
two fixed here because they are the same file, two handed off.

The pattern worth carrying: every row in this packet was a *comment that outlived
its code*. `capability-filter.ts` said principal bypass "is handled there by
omitting the conjunct (exactly like node)" — it was not. `operation-returns-emit.ts`
said a private-op call has "no callable target" — the target was six lines away.
`changeset-invariant-emit.ts`'s docblock said a messaged rule routes here when it is
"a recognized single-field shape" — for a guarded rule that branch could never be
reached. Reading the prose would have told you all three were fine.

## Row table

| row | outcome | proof: the assertion that fails when reverted | notes |
|---|---|---|---|
| **M-T5.25** `ignoring` after `group by` | **already-done-verified**, flipped + archived (`a9ff0dc0`) | Ran the mission's own repro: `projection … group by o.status ignoring softDeletable` now exits **1** with `loom.ignoring-clause-placement` ("…sits in a position that DROPS it. A capability-filter bypass has three homes: …"). Gate: `src/language/validators/bypass-placement.ts`. | Fixed by **#2699**; the heading had read `open` since. The proposed fix is what shipped — a phase-④ refusal, not a grammar move. The "audit the sibling positions" ask is covered by construction: the rule is positional, not per-clause-kind. → `archive/T5-done.md`. |
| **M-T6.51** node document finds ignore `ignoring` | **already-done-verified**, flipped + archived (`a9ff0dc0`) | Generated the mission's own shape (`shape: document` + `softDeletable`): `visibleRows` → `all.filter((x) => (!x.isDeleted))`, `allRows()` (`ignoring softDeletable`) → `all`, `everything()` (`ignoring *`) → `all`. | Fixed by **#2705**: `documentFindMethod` recomputes per find through `allContextFilterEntries`, so drizzle / mikroorm / embedded answer `ignoring` from one rule. Gated by `test/generator/typescript/nonrelational-filter-bypass.test.ts` (absence-asserting, as the mission required). → `archive/T6-done.md`. |
| **M-T6.61** `match` error-variant binding | **verified fixed, NOT flipped** — packet 1b's | Read `dotnet/render-expr.ts`'s `matchVariant` on this base: every arm renders its `<Union>_<Tag>` carrier pattern, error variants included, with the misfire (an arity guess that collapsed "one non-error + error" to `_ =>`) documented at the site and `subjectShape: "absence"` named as the genuine optional-twin path. | Fixed by #2857. The heading in `T6-backend-parity.md:394` still reads `open` at this branch's tip — **1b owns the flip**; recorded here only so the coordinator does not read the stale heading as work. |
| **M-T6.54 F18** java `ignoring` on two read surfaces | **fixed** (`a9ff0dc0`), archived | 3 mutations, §Mutation proofs below. | Both surfaces, plus a **fail-open second defect** and a **third surface partially closed**. Details below. |
| **M-T6.54 F19** guarded invariant on the wire | **already-done-verified** | Generated `invariant note.length > 0 when taxRate > 0` → `if (!(!(taxRate > 0) || (((int) note.codePoints().count()) > 0))) errors.rejectValue("note", "loom.invariant", …)` in both `CreateInvoiceValidator` and `UpdateInvoiceValidator`. | Fixed by #2857 (`java/emit/validator.ts` `buildChecks`), which also collects imports + regex literals from BOTH halves. Verified, not rebuilt, as the packet said. |
| **M-T6.55** Phoenix × 3 | **fixed** (`587e725c`), archived | 5 mutations, §Mutation proofs below. | All three reproduced first. Fork resolved as directed: EMIT. `persistPutBodies` fixed as the second half. One narrow crossing refused honestly instead (`loom.vanilla-op-call-actor`). |
| **M-T6.50 residue** | **(1)+(3) verified done**, heading narrowed to `partial` (`587e725c`); **(2) untouched** | (1) `dispatch-builder.ts:21` imports `domainServiceImportLinesForWorkflow`, `:452` splices it into the saga-handler import block. (3) `collectStmtExprImports` (`python/emit/domain-service.ts:252-254`) is two lines over `walkStmtExprsDeep`. `test/system/ir-walk-census.test.ts` green with **no waiver for either file**, which is the ratchet that keeps them closed. | Landed by #2752. Site (2) — own-state on an uncorrelated command workflow — is #2850 + packet 1a's validator ruling; **not duplicated here**. |
| **M-T6.18 gap #3** | **not in this packet's row list** | — | The wave table (§4) lists it under 1f; the packet brief I was given enumerates six rows and it is not among them. Untouched, unclaimed — flagging so it does not fall between the two readings. |

## What M-T6.54 F18 actually was

Java installs a NON-principal capability filter as a bypassable Hibernate named
`@Filter`, and that triage worked. A PRINCIPAL filter (`with tenantOwned`) has no
static form, so it is AND-ed into each read at request time — and **neither** place
that does so looked at the read's own `ignoring` clause:

```
find anyTenant(c: string): Order? where this.code == c ignoring tenantOwned

before  @Query("select e from Order e where (e.code = :c) and (e.tenantId = :#{@currentUserAccessor.user()?.tenantId()})")
after   @Query("select e from Order e where e.code = :c")
```

and on the document side every declared find streamed off the SHARED `findAll()`,
whose in-app predicate carried the principal conjunct with no per-read bypass.

The correct rule already existed in this backend — `emit/query-projection-reads.ts`'s
`aggregationScope` skips a principal predicate whose `contextFilterOrigins[i]` the
read bypasses and keeps a BARE `currentUser` filter (undefined origin) always. Both
fixes are that rule, reused.

**The second defect, and it is the fail-OPEN one.** The document emitter hoisted
every PROMOTED capability out of `findAll()`/`findById()` and re-applied it per
find. `findAll()` is the root LIST route's only source and carries no `ignoring`
clause, so a soft-deleted row became readable through `GET /<plural>` **and by id**
the moment any UNRELATED find said `ignoring softDeletable`:

```
before  public List<Ledger> findAll() { … for (var data : rows) out.add(fromJson(data)); … }
after   private List<Ledger> rehydrateAll() { …raw… }
        public  List<Ledger> findAll() { return rehydrateAll().stream().filter(x -> (!x.isDeleted())).toList(); }
```

The rehydrate is split out and every read — `findAll()` included — conjoins the
capabilities it does not bypass. Emitted only when some read on the aggregate
actually bypasses something, so the no-bypass majority is byte-identical.

**A third principal read surface, PARTIALLY closed.** A reified retrieval reads
through `<Agg>Criteria.tenantScope(...)`, one factory over all principal predicates.
A retrieval whose `ignoring` drops EVERY principal capability now omits it; a
PARTIAL drop keeps the whole scope (over-restricts, never widens). Splitting the
factory per capability is `emit/criteria.ts` work — outside the fence, §Hand-offs.

## What M-T6.55 actually was

All three reproduced on this base first. The fork was resolved as the plan
directed — EMIT, do not mint a platform-specific refusal for a construct the other
four backends have shipped for months.

**F14** — the part's `changeset/2` is what `cast_embed`/`cast_assoc` runs, so a part
rule enforced nowhere else is enforced nowhere at all. It now carries the same
two-carrier split the aggregate changeset uses.

**F15** — one question asked in the wrong place. `singleFieldConstraints` returns
null for ANY guarded rule (correct for the NATIVE path, which has nowhere to put an
implication) and the residual carrier asked that same classifier, so both doors
shut. `structRenderableShape` now asks it with the guard lifted.

**F24** — the `_ = nil  # … (no callable target); record unchanged` sentinel is
gone. The call renders `record = __op_<name>(record, …)` against a `defp
__op_<name>/n` PURE struct transform, not the public `<op>_<agg>/2` context fn —
that one persists and would commit a partial write inside the caller's
optimistic-lock window. Emitted into all three hosts that render op bodies (context
facade, pure domain core, document path), only for private ops actually called.
`persistPutBodies` unions the callee's write set transitively (riding
`walkStmtsDeep`), which is the second half: emitting the call alone computes the
mutation and drops it at `Repo.update`.

**One crossing is refused rather than emitted, and it is new.** A private operation
whose body reads `currentUser`: the helper is `defp`-local and takes no actor, and
the caller binds `current_user` only when its OWN body reads the principal, so the
callee's reference would be unbound and `mix compile` would fail. Threading it means
making every actor-arg site in the elixir emitter transitive over the private-op
call graph — **14 sites across 8 files**, each with a caller on the other side
(controller, LiveView, generated tests). `loom.vanilla-op-call-actor` says so
instead, beside its sibling `loom.vanilla-op-call-position`, with a firing fixture
in the diagnostic census. *Before this it was part of the same silent drop* — the
old sentinel dropped the guard along with the mutation.

## Fixtures added (rule 13)

| fixture | shape it contains that nothing else did | tier |
|---|---|---|
| `test/fixtures/corpus/find-bypass.ddd` | `find … ignoring <Cap>` / `ignoring *` over a PRINCIPAL and a NON-principal capability, on a RELATIONAL and a `shape: document` aggregate. `projection-agg-filters` witnesses `ignoring` on a query-time PROJECTION; the tenancy fixtures witness the filters with no bypass anywhere. The row-shaped `find … ignoring` over a principal filter had no fixture at all. | compile-only, `E2E_LESS` — the assertion it wants ("does the OTHER tenant's row appear?") needs the two-principal harness `projection-agg-filters` already waits on. Under one principal both spellings return the same set, i.e. a behavioural block would be **green over the retained conjunct the fixture exists to catch**. |
| `test/fixtures/corpus/part-rules-private-op.ddd` | all three M-T6.55 rules in one aggregate, with `Invoice.total` assigned ONLY by the private operation so a HALF-fix still fails. | UNIT-tier (the `numeric-operands` shape): a domain `test` block, no `test e2e`. The domain test IS the runtime oracle for the private-op write, on all five, with no database. |

Both generate cleanly on all five backends and **compile on all five**, run locally:

| leg | how | find-bypass | part-rules-private-op |
|---|---|---|---|
| elixir | `mix compile --warnings-as-errors`, `hexpm/elixir:1.18.4` via `LOOM_ELIXIR_BUILD=1 LOOM_HEX_MIRROR=1 LOOM_CORPUS_ELIXIR_CASE=<id>` | ✅ (red first — see defect 4) | ✅ |
| java | `gradle --no-daemon testClasses bootJar` in `gradle:9-jdk25` (the host has JDK 21, which cannot build the emitted Java 25 toolchain) | ✅ | ✅ (red first — see hand-off 2) |
| node | `LOOM_TS_BUILD=1 … -t <id>` | ✅ | ✅ |
| python | `LOOM_PYTHON_BUILD=1 … -t <id>` (ruff + mypy + pytest) | ✅ | ✅ |
| dotnet | `dotnet build /warnaserror` in `mcr.microsoft.com/dotnet/sdk:10.0` | ✅ | ✅ |

## Mutation proofs

Every one by **file copy aside → mutate → run → copy back** (never `git checkout --`).

| # | mutation | assertions that failed |
|---|---|---|
| 1 | `jpqlWhere` ignores the read's bypass (the pre-fix relational rule) | `generator-java-find-bypass-principal.test.ts` — "`ignoring tenantOwned` drops the tenant conjunct and keeps the find's own filter" and "`ignoring *` drops the tenant conjunct too", both on `expected 'select e from Order e where (e.code =…' not to contain 'tenantId'` |
| 2 | `survives()` returns true unconditionally (the pre-fix "principal filters are always-on, never bypassable" comment, made literal) | same file — "`ignoring tenantOwned` drops ONLY the tenant conjunct" and "`ignoring *` drops both conjuncts", on `expected ' anyTenantNote(String b) {…' not to contain 'tenantId'` |
| 3 | `capRec`/`capX` computed with `{bypassAll: true}` (the pre-fix hoist out of the root reads) | same file — "findAll() applies BOTH conjuncts even though two finds bypass them" and "findById() applies BOTH conjuncts", on `expected ' findAll() {…' to contain 'Objects.equals(x.tenantId(), currentU…'` |
| A | the part's validate block emptied | `part-rules-private-op.test.ts` — "`check qty > 0` becomes a native validate_number on the PART changeset" and "the part's own `invariant sku.length > 2`…", on `expected 'def changeset(struct, attrs) do…' to contain 'validate_number(:qty, greater_than_or…'` |
| B | `structRenderableShape` asking the guarded question again | same file — "the message-less guarded rule is enforced, guard and all" on `to contain 'length(String.to_charlist(data.note))…'`, and the no-double-emit case on `expected +0 to be 1` |
| C | the call arm restored to the `_ = nil` sentinel | same file — "the call is emitted as a real transform, not a discarding no-op" and "the pure domain core carries the same helper", on `to contain 'record = __op_recompute(record)'` |
| D | `persistPutBodies` walking only `op.statements` | same file — "the CALLER's persist tail writes the column the CALLEE assigned", on `to contain 'Ecto.Changeset.force_change(:total, r…'` |
| E | the actor param un-underscored | `find-bypass-actor-param.test.ts` — "`ignoring tenantOwned` drops the conjunct AND underscores the now-unread actor" and its `ignoring *` twin, on `to contain 'def any_tenant(c, _current_user \\ ni…'` |

**Mutation 3 is the one worth reading.** It is the only proof for the fail-OPEN
half, and it fails on a *presence* assertion where every other proof here fails on
an *absence* one — because the two defects point in opposite directions. A suite
written with only one polarity would have caught one of them.

## Defects the fixtures found that are FIXED here

**4. Elixir: a bypassing relational find bound an actor it no longer reads.**
`vanillaCapabilityFilter` is recomputed per find, so `find … ignoring tenantOwned`
emits a `where:` with no `current_user` in it — while the head still bound
`current_user \\ nil`. An unread binding is a warning, and the corpus elixir leg
compiles with `--warnings-as-errors`:

```
warning: variable "current_user" is unused …
  └─ lib/d/orders/order_repository.ex:88:21: D.Orders.OrderRepository.any_tenant/2
Compilation failed due to warnings while using the --warnings-as-errors option
```

The head is now derived from the rendered body — same ARITY (callers pass the actor
positionally regardless), underscored NAME when nothing reads it. The document
repository already did this; the relational path did not, and **no fixture crossed
`ignoring` with a principal filter on a row read until this one**. Gated by
`test/generator/elixir/find-bypass-actor-param.test.ts`, mutation E.

## Hand-offs

### 1. .NET document store ignores `ignoring` entirely — the F18 shape on another backend

Out of fence (`src/generator/dotnet/**` is packet 2b). Reproduce with the new
fixture: `corpusSourceFor("find-bypass", "dotnet")`, or generate
`test/fixtures/corpus/find-bypass.ddd` with `platform: dotnet`.

`Infrastructure/Repositories/NoteRepository.cs` — all three finds are identical:

```csharp
private static bool _CapabilityVisible(Note x) =>
    (x.TenantId == RequestContext.Current!.CurrentUser!.TenantId) && (!x.IsDeleted);

public async Task<Note?> ScopedNote(string b, …)      { var __all = (…).Where(_CapabilityVisible); … }
public async Task<Note?> AnyTenantNote(string b, …)   { var __all = (…).Where(_CapabilityVisible); … }  // ignoring tenantOwned
public async Task<Note?> UnfilteredNote(string b, …)  { var __all = (…).Where(_CapabilityVisible); … }  // ignoring *
```

Its RELATIONAL twin is correct (`IgnoreQueryFilters(["TenantIdFilter"])` /
`IgnoreQueryFilters()`), so this is a missed surface, not an undesigned feature —
the same diagnosis F18 got on java. The fix has the same shape as the java one:
`_CapabilityVisible` is a single static over the whole aggregate, so a per-read
bypass needs it parameterised (or one predicate per bypass set) and `FindAllAsync`
/ `GetByIdAsync` kept on the full set. **Fail direction is OPEN or CLOSED depending
on the cap** — over-restricting for `ignoring`, and no leak — so it is a wrong-rows
bug, not a security one.

### 2. Java: `crudish` + a relational entity part does not compile

Out of fence (`src/generator/java/emit/{dto,service}.ts`). Minimal repro, four
lines, none of this packet's features:

```
aggregate Invoice with crudish {
  note: string
  entity Line { sku: string }
  lines: Line[]
}
```

```
/src/src/main/java/com/loom/d/features/invoices/InvoiceService.java:68: error:
  incompatible types: List<LineResponse> cannot be converted to List<Line>
        aggregate.update(note, taxRate, total, lines);
```

`UpdateInvoiceRequest` types the containment as `List<LineResponse>` (the wire DTO)
while `Invoice.update` takes `List<Line>` (the domain part). It generates `0
error(s), 0 warning(s)` and dies at `javac` — the silent class this wave exists for,
and **older than this packet**: no corpus fixture crosses `crudish` with a
relational entity part, which is why `JAVA_COMPILE_SKIP` is empty and nothing
noticed. I removed `crudish` from `part-rules-private-op.ddd` rather than pin a
compile skip, because a skip entry would have credited the gap to this fixture and
grown a register the wave is trying to drain to zero. **The fix should land the
crossing back into the corpus** — either into that fixture or its own.

### 3. Java: a reified retrieval's principal bypass is all-or-nothing

Out of fence (`src/generator/java/emit/criteria.ts`). `<Agg>Criteria.tenantScope(User)`
is ONE static factory over every principal predicate the aggregate has, so a
retrieval can only take it whole or leave it whole. `tenantScopeAndFor` (added here)
omits it when the retrieval's `ignoring` drops EVERY principal capability; a PARTIAL
drop (two principal capabilities, `ignoring` naming one) keeps the whole scope and
therefore over-restricts. Reason is recorded inline at the site. The fix is one
factory per principal capability origin plus composition at the call site.

### 4. Node: a document find that bypasses everything still binds `currentUser`

Cosmetic today, one line. `repository-document-builder.ts` emits
`const currentUser = requireCurrentUser();` whenever the aggregate has a principal
filter, including on a find whose predicate no longer reads it:

```ts
async unfilteredNote(b: string): Promise<Note | null> {
  const currentUser = requireCurrentUser();          // unused
  …
  const result = all.find((x) => x.body === b) ?? null;
```

Harmless now — the generated `tsconfig.json` sets no `noUnusedLocals`, and the tsc
corpus leg is green — but it is the *identical* shape that failed the elixir leg
(defect 4 above), and it would become a build failure the day that flag is turned on.
Python already drops the binding; elixir now underscores it.

### 5. The actor-threading feature behind `loom.vanilla-op-call-actor`

Making `opUsesCurrentUser` transitive over the private-op call graph, so a private
operation that reads the principal can be called. 14 call sites across 8 files
(`context-emit.ts` ×3, `domain-core-emit.ts`, `eventsourced-emit.ts` ×3,
`operation-returns-emit.ts` ×2, `tests-emit.ts`, `document-emit.ts` ×2,
`api-emit.ts`, `liveview-emit.ts`), each with a caller on the other side that must
agree about the arity. The new code is the register row that names it.

## Local gates run + results

- `npx tsc -b` — clean.
- `node scripts/test-typecheck.mjs` — OK, 182 files / 470 errors (baseline **unchanged**; this packet added three test files and shrank nothing, which is what shrink-only permits).
- `npm run lint` (`biome ci .`) — clean (22 pre-existing warnings, 4 infos, **0 errors**).
- `node docs/build.mjs` — clean.
- `npx vitest run test/generator/elixir/` — **175 files / 1118 tests**, all pass.
- `npx vitest run test/generator/java/` — **96 files / 575 tests**, all pass.
- `npx vitest run test/language/ test/ir/` — **449 files / 4893 tests**, all pass (3 skipped).
- `npx vitest run test/generator/{python,typescript,dotnet}/` — **287 files / 1812 tests**, all pass.
- `npx vitest run test/system/` — **90 files / 1926 tests**, all pass (1 file skipped, 30 tests skipped).
- `npx vitest run test/conformance/corpus-coverage.test.ts test/platform/allowlist-ratchet.test.ts test/ir/api-caller-census.test.ts` — all pass.
- The ten compile legs in the fixture table above.

**`npm test` was NOT run** (four cores shared by five agents, per the protocol); the
suites this packet touches were run in full instead.

## Registers this packet moved

| register | before | after | why |
|---|---|---|---|
| `E2E_LESS_CORPUS_FIXTURES` | 13 | 14 | `find-bypass` — a NEW fixture, not a drained one regressing. `part-rules-private-op` is also listed but is **unit-tier, not gate-less**: it carries a domain `test` block, so the runners do run it and the gate ledger scores its cells `behavioural`. |
| `BEHAVIOURAL_ABSENT` (`gate-ledger.test.ts`) | 12 | 13 | `find-bypass` only. Its `max` in `allowlist-ratchet.test.ts` is raised with the reason inline, which is the reviewed line that ratchet asks for. |
| `MAX_OPEN_GAPS` / the unsupported register | — | unchanged | `loom.vanilla-op-call-actor` is a `*-unsupported`-shaped refusal but not a register row, matching its sibling `loom.vanilla-op-call-position`. One `site:` line number in `unsupported-register.ts` was re-pointed (`backend-syntax-checks.ts:246 → :287`) because the new gate shifted it — caught by that file's own "site resolves to its own code" check, which is the ratchet working. |
| `JAVA_COMPILE_SKIP` | 0 | **0** | deliberately not grown — see hand-off 2. |

### 6. One doc line the new code corrected, recorded because it is the packet's own lesson

`docs/language-reference/06-behavior-and-statements.md` carried the F24 sentinel in a
worked Elixir example AND, beneath it, the sentence "**Honest gap:** … the private
body does not run on Phoenix." Both are now what ships. It is the fourth instance in
this packet of prose that outlived its code — and the one that would have MISLED a
reader into believing the gap was a reviewed decision. `diagnostic-docs-anchors.test.ts`
is what forced the visit (rule 14: a minted code carries its anchor in the same PR),
which is an argument for that ratchet doing more than bookkeeping.

## Notes for the coordinator

1. **Commit `a9ff0dc0` alone is red on `allowlist-ratchet`.** The `BEHAVIOURAL_ABSENT`
   `max` raise its fixture needs landed one commit later, in `587e725c`. The branch
   HEAD is green; only a bisect to the intermediate commit would see it.
2. **M-T6.61's heading is still `open`** at this branch tip (`T6-backend-parity.md`).
   Verified fixed here; 1b owns the flip. If 1b's branch does not carry it, it needs
   flipping at fold time.
3. **`scripts/mission-counts.mjs` does not exist on this base.** The packet brief says
   to run it after a track-file flip; it is presumably wave C0.4's. Track files were
   edited by hand and `docs/build.mjs` re-run; `unsupported-register.test.ts` and
   `coverage-guarantee.test.ts` (the two gates that read mission headings) are green.
4. **M-T6.18 gap #3** is listed under packet 1f in the plan's §4 table but not in the
   packet brief's row list. Untouched and unclaimed by me.
5. Two files in the java fence moved: `emit/repository.ts` (the `jpqlWhere` /
   `principalJpqlClause` hunks, plus two optional params on `inMemoryRetrievalLines`
   and the `tenantScopeAndFor` rename) and `emit/document-store.ts`. The brief warned
   that **#2852 edits `findReturn` in `emit/repository.ts`** — `findReturn` is at
   `:258` and untouched; my hunks are at `:124-170`, `:362-400` and `:600-680`.

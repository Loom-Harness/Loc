All three re-verified as LIVE, root-caused, and checked against the open PR set.

---

# Fix plan — node/Hono emitter cluster (F-013 · F-014 · F-015)

Base: `/tmp/loom-main` @ `9a8f2fe0`. Nothing in `/tmp/loom-main` or `/home/user/Loc` was modified; all scratch in `/tmp/agentA/`.

## 1. Verification table

| Finding | Status | Claimed? | Evidence |
|---|---|---|---|
| **F-013** `!=` in a projection `where` emits `ne(...)` un-imported | **LIVE** | **UNCLAIMED** | `node bin/cli.js generate system /tmp/repro/ne-import-missing.ddd -o /tmp/agentA/out-ne` → `0 error(s), 0 warning(s).` then `npx tsc --noEmit` → `db/repositories/ticket-repository.ts(99,72): error TS2304: Cannot find name 'ne'.` Import line is `import { and, asc, count, desc, eq, inArray } from "drizzle-orm";` |
| **F-014** find comparing an FK to a NULLABLE claim emits uncompilable Drizzle | **LIVE** | **UNCLAIMED** | `…generate system /tmp/repro/nullable-claim-find.ddd` → `0 error(s), 1 warning(s).`; `npx tsc --noEmit` → `db/repositories/workOrder-repository.ts(99,75): error TS2769: No overload matches this call.` … `Argument of type 'TechnicianId \| null' is not assignable to parameter of type 'string \| SQLWrapper'.` |
| **F-015** workflow calling an aggregate `function` calls a `private` method | **LIVE** | **UNCLAIMED** | `…generate system /tmp/repro/workflow-calls-function.ddd` → `0 error(s), 0 warning(s).`; `npx tsc --noEmit` → `http/workflows.ts(56,17): error TS2341: Property 'hasSkill' is private and only accessible within class 'Tech'.` |

### Claim check (Step 2), one line each

- **#2884** (`currentUser.<undeclared-claim>`) — adds `loom.unknown-user-claim` for a claim **not declared** in `user { }`. F-014's claim *is* declared (it's `Technician id?`); disjoint. Diff confirmed: touches `type-system.ts` / `validators/types.ts`, not `repository-find-predicate.ts`.
- **#2869 (merged)** / **#2900 (open)** — the `X id?` and `X id` claim's **type/import/dev-stub-value** halves in `auth/*`. Neither touches the Drizzle find-predicate emission. F-014 is the *use site*, they are the *declaration site*.
- **#2874**, **#2871**, **#2894**, **#2877** — read-path validator honesty, page-body/gate holes, enum-`Schema` in `workflow-builder.ts`, `crudish(requires:)`. None names these three.
- **#2861** — its slice 1 edits `src/generator/typescript/projection-finds.ts` (parameterised projections drop their param). It does **not** touch `repository-builder.ts`; my F-013 fix site is untouched. Adjacent-but-not-overlapping; see "Merge adjacency" below.
- **#2864 / #2865 / #2862 / #2861** draft defect registers — read in full. F-013, F-014 and F-015 appear in none of them. (#2864's D4 is the *workflow route* emitter's missing `<Enum>Schema`, a different symptom in a different file.)

---

## 2. F-013 — projection-synthesised finds are invisible to the Drizzle import narrower

### Root cause

`src/generator/typescript/repository-builder.ts:79-90` walks `allFilters` to seed the `drizzleOps` candidate set — and `allFilters` contains only `repo?.finds` plus `nonPrincipalContextFilters(agg)`. The projection-synthesised finds are computed **71 lines later**, at `repository-builder.ts:160`:

```ts
const projectionFinds: FindIR[] = synthProjectionFinds(agg.name, ctx);
```

and are rendered at line 180 (`viewFindMs`) without ever contributing to `drizzleOps`. The narrower at line 241-244 then filters the candidate set against the emitted body — a used-but-uncandidated op is simply never imported. Seeded defaults are `["eq", "and", "inArray"]` (line 68), which is why only these three survive.

`src/generator/typescript/repository-embedded-builder.ts:119` has the identical shape (`for (const f of repo?.finds ?? [])`, synth finds joined at line 182).

**This is not `ne`-specific — it is the whole non-default operator class.** Measured on fresh main:

```
# /tmp/agentA/ne-ops.ddd — projection `where t.n > 5 || t.n < 1`
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
    const rootRows = await this.db.select().from(schema.tickets).where(or(gt(schema.tickets.n, 5), lt(schema.tickets.n, 1)));
```
→ three undefined names (`or`, `gt`, `lt`) from one clause.

A **criterion** in the projection `where` reproduces it too (`/tmp/agentA/ne-crit.ddd`, `where NotClosed()` → same missing `ne`): `synthProjectionFinds` sets no `criterionRef`, so the criterion inlines rather than reifying, and the `reifyingRefs` walk (lines 105-129) never sees it.

Control proving the narrowing is otherwise correct — the *same* predicate written as a declared find:
```
# /tmp/agentA/ne-find.ddd — `find open(): Ticket[] ... where this.st != Closed`
import { and, asc, count, desc, eq, inArray, ne } from "drizzle-orm";
```

**Why no gate caught it:** every projection `where` in the corpus is `==`. `grep -n 'criterion' test/fixtures/corpus/projection*.ddd` returns only `o.status == OrderStatus.Confirmed`, three times — and `eq` is one of the three always-seeded ops. The corpus is structurally blind to this.

### Scope (measured, not assumed)

| Builder | Exposed? |
|---|---|
| `repository-builder.ts` (relational, drizzle) | **yes** — the repro |
| `repository-embedded-builder.ts` (`shape: embedded`) | **yes** — `/tmp/agentA/ne-embedded.ddd` → `import { and, eq, inArray }` + `ne(schema.tickets.st, "Closed")` at line 78 |
| `repository-document-builder.ts` (`shape: document`) | **no** — a document-shape projection is honestly refused (`loom.projection-columnless-source`), and a *declared* document find filters in JS (`all.filter((x) => x.st !== St.Closed)`), needing no Drizzle op. Its hardcoded import at line 261-263 is safe. |

### The change

In `repository-builder.ts`, move the synth call above the op walk and fold it into `allFilters`:

```ts
const projectionFinds: FindIR[] = synthProjectionFinds(agg.name, ctx);   // hoist from :160
const allFilters = [
  ...(repo?.finds ?? []).map((f) => f.filter).filter(…),
  ...projectionFinds.map((f) => f.filter).filter(…),                      // NEW
  ...nonPrincipalContextFilters(agg),
];
```
and add `...projectionFinds.map((f) => f.criterionRef)` to `reifyingRefs` (line 113) so a criterion-shaped projection `where` reifies on the same terms as a find's. Mirror the two-line change in `repository-embedded-builder.ts:119`.

Use `repoTableName(agg, ctx)` rather than the walk's current `lowerFirst(plural(agg.name))` for consistency with the render site (`repository-find-predicate.ts:677`); it doesn't change output today but the two spellings diverge under TPH.

**Byte-identity:** zero risk. The set at line 241 is only a *candidate* list, regex-narrowed against the emitted body, so a candidate that isn't called is dropped. Models whose projection `where` is `==`-only stay byte-identical.

### Test to add

`test/generator/typescript/query-projection-find-drizzle-imports.test.ts` (sibling of the existing `query-projection-capability-filters.test.ts` / `query-projection-document-source.test.ts`). Assert, for the relational **and** embedded builders, that a projection `where` using `!=`, `>`/`<` and `||` emits every referenced Drizzle symbol in the `from "drizzle-orm"` line — not a hand-listed set, but the honest invariant: **every identifier called as `X(` in the file's body is either imported or locally defined.** That formulation catches the next operator too.

Plus one corpus fixture, since the "systemic point" of #2864 applies exactly here: `test/fixtures/corpus/projection-operator-filters.ddd` — a query-time projection whose `where` uses `!=` and a comparison, registered in `test/fixtures/corpus/manifest.ts` so `corpus-tsc-build` compiles it. That is the gate that would have caught this without anyone writing a unit test.

### Mutation proof

Revert the `allFilters` edit **by file copy** (`cp repository-builder.ts{,.bak}`, mutate, `cp` back — never `git checkout --`, per CLAUDE.md). Expected: the unit test fails naming `ne` (and `or`/`gt`/`lt` on the second case) as referenced-but-unimported, and `LOOM_CORPUS_TSC_CASE=projection-operator-filters npm run test:tsc-corpus` fails with `error TS2304: Cannot find name 'ne'.` Repeat the revert for the embedded half independently — the two builders must each fail on their own assertion, or the test isn't reaching both.

### Blast radius across the other four backends

**None.** This is a TypeScript-import-narrowing mechanism with no analogue elsewhere: .NET/Java use LINQ/JPQL operators (no imports), Python builds SQLAlchemy expressions from already-imported operators, Elixir uses `Ecto.Query` macros. Verified the emitted predicate is correct on all four for the same model — only node needs the symbol in scope.

### Effort: **S** (two files, ~6 lines; one test file + one corpus fixture + three registry rows).

### Merge adjacency

#2861 rewrites `projection-finds.ts` to thread parameters into the synthesised find. My change consumes `synthProjectionFinds`'s output and doesn't edit that file, so the two compose — but whichever lands second should re-run the new import test, because a parameterised projection's predicate gains a `param` ref that the narrower must still see.

---

## 3. F-014 — an optional user claim is bound straight into `eq(...)`

### Root cause

`src/generator/typescript/repository-find-predicate.ts:517`:

```ts
if (e.kind === "member" && e.receiver.kind === "ref" && e.receiver.refKind === "current-user") {
  return `${principal}.${e.member}`;
}
```

The comment three lines above asserts the invariant that is false:

> `// the User field's plain type is structurally assignable.`

It isn't, when the claim is declared `T?`. `src/ir/lower/lower-expr.ts:2599` types the member honestly —

```ts
const f = env.user.fields.find((f) => f.name === name);
if (f) return f.optional ? { kind: "optional", inner: f.type } : f.type;
```

— and `auth-emit` emits the matching `technicianId: Ids.TechnicianId | null;` (`api/auth/user-types.ts:11`). Drizzle's `eq` right operand is `string | SQLWrapper`. The emitter simply never consults `e.memberType`.

**Column nullability is irrelevant** — verified: with `technicianId: Technician id` (no `?`) on the aggregate and the claim still optional, the identical TS2769 fires, `notNull: true` and all (`/tmp/agentA/out-nc-notnullcol`).

### The other four backends emit the same *semantics*, and compile

Generated from the same model (`/tmp/agentA/nc-{dotnet,python,java,elixir}.ddd`):

```
dotnet  Repositories/WorkOrderRepository.cs:86   x.TechnicianId == currentUser.TechnicianId
python  db/repositories/work_order_repository.py:52  WorkOrderRow.technician_id == current_user.technician_id
java    WorkOrderJpaRepository.java:22  @Query("... where e.technicianId = :#{@currentUserAccessor.user()?.technicianId()}")
elixir  c/work_order_repository.ex:79   where: record.technician_id == current_user.technician_id
```

All four bind a possibly-null value into `= NULL`, which in SQL matches no row. **Node is the only backend whose type system rejects it** — and the correct node emission is the one that *reproduces* that four-backend behaviour. That settles the semantic question without a design debate.

### The change — reuse the existing ternary discipline in the same file

`repository-find-predicate.ts` already has the exact prior art, twice: the `authz-filter` `deny` arm (lines 180-185) and the tenancy `guidFromStringSelfScope` arm (lines 236-247) both emit a JS ternary whose false branch is the self-contained always-false term `and(isNull(<id>), isNotNull(<id>))` — needing no import beyond `isNull`/`isNotNull`, which the narrower already handles.

Extend the `binary` arm (after `orientComparison`, around line 290-295) with a guard: when `oriented.value` is a `member` on a `current-user` ref whose `memberType.kind === "optional"`, wrap:

```ts
(currentUser.technicianId === null
  ? and(isNull(schema.workOrders.id), isNotNull(schema.workOrders.id))
  : eq(schema.workOrders.technicianId, currentUser.technicianId))
```

TS narrows the claim to non-null inside the false branch, so `eq` type-checks; the true branch answers the same empty read the other four backends give. Applies uniformly to `ne` (`x <> NULL` is also NULL in SQL), so one guard covers every `COMPARE_OP_TO_DRIZZLE` entry. Because the guard is keyed on `memberType` being `optional`, a non-optional claim stays **byte-identical** — every existing tenancy/`find`/capability-filter emission is untouched.

This lands the fix at the one site both find predicates *and* capability filters flow through, so `filter this.x == currentUser.y` gets it free.

`docs/tenancy.md:150-160` documents the parse-to-null discipline for the *tenant* claim; this is the generalisation the doc's own reasoning implies — add a row there, because the doc currently describes it as tenancy-specific.

### Test to add

`test/generator/typescript/nullable-claim-find-predicate.test.ts`, beside the existing `find-predicate-operand-order.test.ts` and `context-filter-emit.test.ts`. Three cases:
1. optional claim + `==` → the ternary guard, and `currentUser.<claim>` never appears as a bare `eq` argument;
2. optional claim + `!=` → same guard around `ne`;
3. **non-optional claim → byte-identical to today** (this is the assertion that stops the fix from being a blanket rewrite).

And a corpus fixture `test/fixtures/corpus/auth-optional-claim-find.ddd` registered for the node leg of `corpus-tsc-build` — the gate that actually reproduces TS2769. (Name it clear of `auth-id-claim` / `auth-id-claim-stub`, which #2869 and #2900 own.)

### Mutation proof

Revert the guard by file copy. Expected: case 1 and 2 fail naming the bare `eq(..., currentUser.technicianId)`, and `LOOM_CORPUS_TSC_CASE=auth-optional-claim-find npm run test:tsc-corpus` fails with the measured `error TS2769 … Argument of type 'TechnicianId | null' is not assignable to parameter of type 'string | SQLWrapper'.` Case 3 must stay green under the mutation — if it goes red, the guard is over-broad.

### Blast radius across the other four backends

**None required.** All four emit a compiling, semantically-equivalent `= NULL`. The fix makes node *agree* with them rather than diverging. Worth noting for whoever owns runtime parity: none of the five currently gives an author a way to say "a principal with no claim sees nothing" vs "sees the unassigned rows" — all five pick the former. That's a language question, not a defect, and I am not opening it here.

### Effort: **S** (one arm in one file; one test file, one corpus fixture, one doc row).

---

## 4. F-015 — a cross-instance call to an aggregate `function` has no correct form on any backend

### The shared decision, stated first

`src/generator/typescript/emit/aggregate.ts:487` hard-codes `private`:

```ts
const head = `  private ${lowerFirst(fn.name)}(${params}): ${renderTsType(fn.returnType)}`;
```

but **the node emitter is not where this belongs**, because every backend is wrong and each is wrong differently. Generated from the same `.ddd`:

| Backend | Declaration | Call site | Verdict |
|---|---|---|---|
| node | `domain/tech.ts:26` `private hasSkill(s: string): boolean` | `http/workflows.ts:56` `t.hasSkill(skill)` | `TS2341` (measured) |
| dotnet | `Domain/Teches/Tech.cs:31` `private bool HasSkill(string s)` | `Application/Workflows/GiveHandler.cs:37` `t.HasSkill(command.Skill)` | inaccessible-member compile error |
| java | `Tech.java:59` `private boolean hasSkill(String s)` | `CWorkflows.java:36` `t.hasSkill(skill)` | inaccessible-member compile error |
| python | `app/domain/tech.py:39` `def _has_skill(self, s)` | `workflows_routes.py:41` `t.has_skill(skill)` | **name mismatch** — `AttributeError`; ruff F821-class |
| elixir | `lib/api/c.ex:32` `def has_skill(%Api.C.Tech{} = record, s)` — *public*, on the context module | `c/workflows/give.ex:51` `t.has_skill(skill)` | struct-field access, not a module call — wrong form |

And the language docs say `function` is aggregate-local: `docs/language.md:430` — *"callable from any expression in the same aggregate"*; `docs/language-reference/05-expressions.md:332` — *"A call to a sibling `function` … lowers to `this.recompute()`"*. There is no documented cross-instance form. So this is a **silent gap**, and the two honest terminal states are:

- **(A) Refuse it** — a new `loom.*` code, exactly symmetric to a gate that **already exists**. `operation` has one; `function` does not:
  ```
  $ node bin/cli.js parse /tmp/agentA/wf-privop.ddd
  loom.workflow-private-operation C/give: workflow 'give': 'Tech.bump' is private.  Workflows can only call public operations.
  ```
  That check is `src/ir/validate/checks/workflow-checks.ts:1093-1104`. It fires on the **`op-call` StmtIR arm** (line 1063) — a statement `j.assign()`. `precondition t.hasSkill(skill)` is an *expression* (`method-call` on a let-bound aggregate), so it never reaches that arm. The parallel hole is also already closed for unknown members — `t.notAThing(skill)` correctly errors `'notAThing' is not a member of 'Tech'`. Only *visibility of a known function* is unguarded.

- **(B) Make it legal** — emit `function` as a public pure query on all five. Defensible: a `function` is validator-guaranteed pure (no mutation, no `emit`, no repository / operation / domain-service / extern call — `docs/language.md:431`), so exposing it is the same safety posture as `derived`, which already emits as a public getter.

**My default is (A), refuse it**, and I would take it unless the maintainer says otherwise. Three reasons: it is the smaller, reversible change; (B) contradicts three pinned tests that treat the private spelling as the contract (`test/generator/operation-self-call.test.ts:11`, `test/generator/python/render-expr-kinds.test.ts:388`, `test/generator/python/python-aggregate.test.ts:71`) and would need the python name and the elixir call form fixed anyway; and a `loom.*` code converts four different broken compiles into one sentence at `ddd parse`, which is the thing an author actually needs today. (A) does not foreclose (B) — if the capability is later wanted, the mission deletes its own gate, which is the ratchet `diagnostic-firing-census` already enforces.

### It is not workflow-specific — measured

A `domainService` reproduces it identically, with no workflow involved:

```
# /tmp/agentA/fn-ds.ddd — domainService Match { operation ok(t: Tech, s: string): bool { return t.hasSkill(s) } }
0 error(s), 0 warning(s).
api/domain/tech.ts:26:  private hasSkill(s: string): boolean { ... }
api/domain/services.ts:7:      return t.hasSkill(s);
```

So the check must **not** be bolted onto `workflow-checks.ts`. It belongs as its own leaf under `src/ir/validate/checks/` — say `aggregate-function-visibility.ts` — judging every `ExprIR` of kind `method-call` whose `receiverType` is `{kind:"entity"}`, whose receiver is *not* `this`, and whose `member` names a `function` on that aggregate. Per CLAUDE.md's "No hand-rolled IR walks", it must ride `walkExprDeep` / `walkStmtExprsDeep` / `walkWorkflowStmtExprsDeep` from `src/ir/util/walk.ts`, not a bespoke switch — otherwise `test/system/ir-walk-census.test.ts` will (correctly) reject it, and the check would miss the receiver hidden in a `match` arm or an `if-let` branch, which is the exact `#2720/#2705` defect class.

Message should name the fix, not just the refusal: *"`Tech.hasSkill` is a `function` — a helper callable only from inside `Tech`. Inline the expression here, or expose it as a `derived` member on `Tech`."*

### Node half (what I own)

If (A) lands, `aggregate.ts:487` **does not change** — the emitter becomes unreachable for this shape and stays byte-identical. That is the whole node-side work: verify no node output moves.

If (B) is chosen instead, the node change is `private` → (nothing) at `aggregate.ts:487`, plus a check that the Biome generated-code gate doesn't flag a now-public, internally-only-used member.

### Test to add (for (A))

- `test/ir/workflow-function-visibility.test.ts` — the workflow case, beside the existing `test/ir/workflow-function.test.ts`.
- A second case in the same file (or `test/ir/domain-service-function-visibility.test.ts`) for the `domainService` receiver, so the check is pinned as *general*, not workflow-shaped.
- A fixture row in `test/system/diagnostic-firing-census.data.ts` — mandatory for any new `loom.*` code, and the thing that stops the gate outliving its purpose.

### Mutation proof

Seed the defect back: revert the new check leaf by file copy and assert both tests fail naming the missing diagnostic. Then the stronger proof, because a validator that never reaches the code it names is the recurring failure shape here (`experience_gathered.md` §59/§63): with the check **in place**, regenerate `/tmp/repro/workflow-calls-function.ddd` and `/tmp/agentA/fn-ds.ddd` and confirm `ddd parse` exits non-zero on both — i.e. the gate catches the *original repro*, not just a hand-built unit fixture. Read which assertion failed, not merely that one did.

### Effort: **M** for the shared check (one new validate leaf + walk wiring + message catalog entry + census fixture + two test files); **S** for the node half under (A) — a no-op with a byte-identity assertion.

---

## 5. What I'd hand to other agents

**F-015's root cause spans all five backends and the decision is not node's to make.** Handing over:

1. **The ruling.** (A) refuse via a new `loom.*` code, or (B) make `function` a public pure query. I recommend (A) and will take it as the default. Whoever owns the .NET/Java/Python halves should not start emitting changes until this is settled — under (A) **no emitter changes at all**, on any backend.
2. **The check does not live in `workflow-checks.ts`.** A `domainService` reproduces it with no workflow (`/tmp/agentA/fn-ds.ddd`, output at `api/domain/services.ts:7`). It needs its own leaf under `src/ir/validate/checks/`, riding `src/ir/util/walk.ts`.
3. **Two defects that survive either ruling, and are theirs:**
   - **python name mismatch** — the declaration is `def _has_skill` (`app/domain/tech.py:39`) while the call site emits `t.has_skill(skill)` (`workflows_routes.py:41`). Under (A) this becomes unreachable; under (B) it is a real bug in the python emitter, independent of visibility.
   - **elixir call form** — the function IS public (`def has_skill(%Api.C.Tech{} = record, s)` at `lib/api/c.ex:32`) but the call site emits `t.has_skill(skill)` (`c/workflows/give.ex:51`), which is Elixir struct-field access, not `Api.C.has_skill(t, skill)`. Elixir is the one backend where (B) is *nearly* already implemented and the call site is what's wrong.
4. **The existing symmetric gate to model the new one on:** `loom.workflow-private-operation`, `src/ir/validate/checks/workflow-checks.ts:1093-1104`, message at `src/diagnostics/messages.ts:3408`.

F-013 and F-014 are node-local; nothing to hand off. F-014 does carry one cross-backend *observation* worth recording rather than acting on: all five backends silently answer "a principal with a null claim sees nothing", and no author can currently express the alternative. That's a language question for `docs/new-plan/`, not a defect.
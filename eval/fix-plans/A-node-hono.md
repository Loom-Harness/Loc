# Agent A — node / Hono emitter (F-013, F-014, F-015)
Base: fresh main `9a8f2fe0`.

## Verification
| Finding | Status | Claimed? | Evidence |
|---|---|---|---|
| F-013 `!=` in a projection `where` emits `ne(...)` un-imported | **LIVE** | UNCLAIMED | generate → `0 error(s), 0 warning(s).`; `tsc --noEmit` → `ticket-repository.ts(99,72): error TS2304: Cannot find name 'ne'.` Import line: `import { and, asc, count, desc, eq, inArray } from "drizzle-orm";` |
| F-014 FK vs NULLABLE claim | **LIVE** | UNCLAIMED | `workOrder-repository.ts(99,75): error TS2769 … Argument of type 'TechnicianId \| null' is not assignable to parameter of type 'string \| SQLWrapper'.` |
| F-015 workflow calls a `private` aggregate `function` | **LIVE** | UNCLAIMED | `http/workflows.ts(56,17): error TS2341: Property 'hasSkill' is private …` |

Claim check: #2884 is the *undeclared* claim (disjoint — F-014's claim IS declared). #2869(merged)/#2900
are the declaration site in `auth/*`; F-014 is the **use** site. #2861 slice 1 edits
`projection-finds.ts`, not `repository-builder.ts` — adjacent, not overlapping. None of the four draft
defect registers list these three.

## F-013 — root cause is broader than `ne`
`src/generator/typescript/repository-builder.ts:79-90` seeds the `drizzleOps` candidate set from
`allFilters` = `repo?.finds` + `nonPrincipalContextFilters(agg)`. Projection-synthesised finds are
computed **71 lines later** (`:160 synthProjectionFinds`) and rendered at `:180` without ever feeding
the candidate set. The narrower at `:241-244` then drops any op not in the set. Seeded defaults are
`["eq","and","inArray"]` — which is exactly why only those three ever survive.
`repository-embedded-builder.ts:119` has the identical shape.

**The whole non-default operator class is exposed**, measured: a projection `where t.n > 5 || t.n < 1`
emits `or(gt(...), lt(...))` against the same 6-symbol import → three undefined names from one clause.
A criterion in a projection `where` reproduces it too (`synthProjectionFinds` sets no `criterionRef`,
so it inlines and the `reifyingRefs` walk never sees it).
**Control** — the same predicate as a *declared* find imports `ne` correctly.
**Why no gate caught it:** every projection `where` in the corpus is `==`, and `eq` is always seeded.

Scope: relational ✅ exposed · embedded ✅ exposed · document ❌ not (honestly refused by
`loom.projection-columnless-source`; declared finds there filter in JS).

**Change:** hoist `synthProjectionFinds` above the op walk, fold into `allFilters`, and add its
`criterionRef`s to `reifyingRefs`. Mirror in the embedded builder. Byte-identical for `==`-only models
(the set is only a *candidate* list, regex-narrowed against the body).
**Test:** `test/generator/typescript/query-projection-find-drizzle-imports.test.ts` — assert the honest
invariant (*every identifier called as `X(` is imported or locally defined*), not a hand-listed set,
for both builders. Plus corpus fixture `projection-operator-filters.ddd` registered for `corpus-tsc-build`.
**Mutation proof:** revert by file copy; unit test must name `ne`/`or`/`gt`/`lt`, and the corpus leg
must fail `TS2304`. Revert each builder independently — both must fail on their own assertion.
**Blast radius:** none — import narrowing has no analogue on the other four backends (verified: all
four emit the correct predicate).
**Effort: S.** Adjacency: #2861 rewrites `projection-finds.ts`; composes, but whoever lands second
re-runs the new import test.

## F-014 — an optional claim bound straight into `eq(...)`
`src/generator/typescript/repository-find-predicate.ts:517` returns `${principal}.${e.member}` under a
comment asserting *"the User field's plain type is structurally assignable"* — false when the claim is
`T?`. `lower-expr.ts:2599` types the member honestly as optional; `auth-emit` emits
`technicianId: Ids.TechnicianId | null`. The emitter never consults `e.memberType`.
Column nullability is irrelevant — verified with a non-optional column, same TS2769.

**The other four backends emit the same semantics and compile**:
`dotnet x.TechnicianId == currentUser.TechnicianId` · `python WorkOrderRow.technician_id == current_user.technician_id` ·
`java @Query("… = :#{@currentUserAccessor.user()?.technicianId()}")` · `elixir where: record.technician_id == current_user.technician_id`.
All bind a possibly-null value into `= NULL`, which matches no row. **Node is the only backend whose
type system rejects it**, so the correct node emission is the one that reproduces the other four.

**Change:** reuse the ternary discipline already in the same file (the `authz-filter` deny arm at
`:180-185` and the tenancy self-scope arm at `:236-247` both emit
`and(isNull(id), isNotNull(id))` as a self-contained always-false term). Guard the `binary` arm on
`memberType.kind === "optional"`. TS narrows inside the false branch so `eq` type-checks; covers `ne`
too. Non-optional claims stay **byte-identical**. Lands at the one site find predicates *and*
capability filters share, so `filter this.x == currentUser.y` gets it free.
`docs/tenancy.md:150-160` documents this discipline as tenancy-specific — add a row generalising it.
**Test:** `test/generator/typescript/nullable-claim-find-predicate.test.ts`, 3 cases — optional+`==`,
optional+`!=`, **non-optional → byte-identical** (the assertion that stops the fix being a blanket
rewrite). Corpus fixture `auth-optional-claim-find.ddd` (named clear of #2869/#2900's fixtures).
**Mutation proof:** revert by file copy; cases 1–2 fail naming the bare `eq(…, currentUser.x)`; case 3
must stay green — if it reddens, the guard is over-broad.
**Effort: S.**

## F-015 — no correct cross-instance form on ANY backend; needs a language ruling
`src/generator/typescript/emit/aggregate.ts:487` hard-codes `private`. But every backend is wrong,
differently:
| Backend | Declaration | Call site | Verdict |
|---|---|---|---|
| node | `private hasSkill(...)` | `t.hasSkill(skill)` | TS2341 |
| dotnet | `private bool HasSkill(...)` | `t.HasSkill(...)` | inaccessible-member |
| java | `private boolean hasSkill(...)` | `t.hasSkill(skill)` | inaccessible-member |
| python | `def _has_skill(self, s)` | `t.has_skill(skill)` | **name mismatch** → AttributeError |
| elixir | `def has_skill(...)` on the context module (**public**) | `t.has_skill(skill)` | struct-field access, wrong form |

Docs say `function` is aggregate-local (`docs/language.md:430`, `language-reference/05-expressions.md:332`)
— there is no documented cross-instance form. Two honest terminal states:
- **(A) Refuse** with a new `loom.*`, symmetric to one that **already exists**:
  `loom.workflow-private-operation` (`src/ir/validate/checks/workflow-checks.ts:1093-1104`) fires on the
  **`op-call` StmtIR arm**; `precondition t.hasSkill(skill)` is an *expression* (`method-call`), so it
  never reaches it. Unknown members are already caught; only **visibility of a known function** is unguarded.
- **(B) Make it legal** — `function` is validator-guaranteed pure, so exposing it matches `derived`.

**Recommendation: (A).** Smaller, reversible; (B) contradicts three pinned tests
(`operation-self-call.test.ts:11`, python `render-expr-kinds.test.ts:388`, `python-aggregate.test.ts:71`)
and still needs the python name and elixir call form fixed. (A) doesn't foreclose (B).

**Not workflow-specific** — a `domainService` reproduces it with no workflow
(`0 error(s)`, then `api/domain/services.ts:7 return t.hasSkill(s);`). So the check must NOT bolt onto
`workflow-checks.ts`; it needs its own leaf (`src/ir/validate/checks/aggregate-function-visibility.ts`)
riding `walkExprDeep`/`walkStmtExprsDeep`/`walkWorkflowStmtExprsDeep` per the "No hand-rolled IR walks"
rule — otherwise `ir-walk-census.test.ts` rejects it and it misses receivers inside `match` arms / `if-let`
branches (the #2720/#2705 class).
Under (A) **no emitter changes on any backend**; node's `aggregate.ts:487` stays, with a byte-identity assertion.
**Mutation proof:** revert the leaf; both tests fail. Then the stronger proof — with the check in place,
`ddd parse` must exit non-zero on the **original repros**, not just a hand-built fixture (§59/§63).
**Effort: M** shared check; **S** node half.

## Handed to other agents
1. **The F-015 ruling is not node's to make** — (A) vs (B). Under (A), no emitter work anywhere.
2. **The check does not live in `workflow-checks.ts`** — `domainService` reproduces it.
3. **Two defects that survive either ruling:** python `_has_skill` vs `has_skill` name mismatch;
   elixir emits struct-field access `t.has_skill(skill)` instead of `Api.C.has_skill(t, skill)` —
   elixir is the one backend where (B) is nearly implemented and the *call site* is what's wrong.
4. Model the new gate on `loom.workflow-private-operation` (message at `src/diagnostics/messages.ts:3408`).

Observation, not a defect: all five backends silently answer "a principal with a null claim sees
nothing"; no author can express the alternative. A language question for `docs/new-plan/`.

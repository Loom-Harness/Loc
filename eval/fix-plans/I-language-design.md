# Agent I — language / design limits (F-002, F-003, F-008, F-009, F-010, F-036, F-044)
Base: fresh main `9a8f2fe0`.

## Verification
| # | Status | Claimed? | Evidence |
|---|---|---|---|
| F-002 `let` in a `for` body | LIVE | UNCLAIMED | `loom.workflow-foreach-unknown-binding … references unknown binding 'p'`; controls -a/-c/-f all `0 error(s)` |
| F-003 `this.id` in a criterion | LIVE | UNCLAIMED | `loom.retrieval-where-unknown-field … unknown field 'this.id' on aggregate 'Part'`; sibling `loom.find-where-unknown-field` too |
| F-008 crudish ⊥ denyByDefault | LIVE | **CLAIMED BY #2877** (open, NOT merged; `main`'s message is still the un-macro-aware one) | 3 × `loom.default-deny-ungated` |
| F-009 cross-context repository | **LIVE — materially worse than filed** | UNCLAIMED | see below |
| F-010 deny-by-default vs find deprecation | LIVE | **PARTIALLY** #2874; **residual UNCLAIMED** | #2874's guard is *context*-scoped, no `find all` exemption |
| F-036 `string`→`enum` | LIVE | UNCLAIMED | regenerate → `unchanged: 32`, no new migration; a **fresh** enum column is `TEXT NOT NULL`, no CHECK |
| F-044 i18n | LIVE | UNCLAIMED | `check --strict` → `de: ok` exit 0; `generate` emits only `en.json` |

#2895 (**merged**, `4f817479`, add-column defaults) is **adjacent to F-036, not a claim** — it is the
*template* for the fix. #2896's four codes are disjoint but it is **the correct vehicle** for new codes
(the repo's one-packet-per-wave convention; its own body explains that parallel `messages.ts` edits
conflict on every merge).

## F-002 — (a) DEFECT. The emitters are already complete.
**Proof:** patched *only* the validator in a scratch copy to register inner `repo-let`/`factory-let` the
way the `if-let` arm already does → **all five backends emit correct code**: repo injected, let rendered,
per-iteration save emitted (node `const p = await parts.getById(l.partId)` … `await parts.save(p)`;
.NET `?? throw new AggregateNotFoundException`; java; python; elixir `Enum.reduce_while` + `with`).
**Root cause** `src/ir/validate/checks/workflow-checks.ts`: the `if-let` arm (~:1020) already carries the
fix *with a comment explaining it* — *"the emitters already walk into the branch bodies … without it the
validator refused a form every backend emits."* The `for-each` arm (~:907) never got the same treatment;
it walks `st.body` looking only at `op-call`.
**Critical trap found:** a naive register-and-never-delete patch made a **leak** legal —
`for i in xs { let t = … }` then `t.bump()` after the loop → emitted `t.bump();` after the block
declaring `const t`, a fresh TS2304. The fix must mirror `branchLocal` and `delete` the names after the loop.
**Plan:** hoist the `if-let` arm's logic into one shared helper (no second hand-rolled traversal —
`ir-walk-census.test.ts` bites); keep the diagnostic text (it becomes true again); tests in
`test/ir/workflow-dataflow-checks.test.ts` incl. **the leak case must be refused**; two mutations, each
failing only its own assertion. **Add a corpus fixture** — no `.ddd` in the repo exercises a `repo-let`
inside a `for`, which is why five working emitters sat behind a validator that refused them.
**~15 lines. Highest value-per-line in the cluster.**

## F-003 — (a) DEFECT. The flag exists and is set at 1 of 3 sites.
`firstUnknownColumnRef` (`checks/shared.ts:26`) already takes `opts.allowSelfId`; only the
capability-filter loop (`query-checks.ts:123`) sets it. Its doc comment justifies the strictness by *"a
workflow-instance read-model source has no `id` column"* — **but that justification is not load-bearing
at either strict site**: both resolve `agg` from `ctx.aggregates` (`:35`, `:220`), and a retrieval over a
workflow-instance view gets `agg === undefined` and skips the check entirely. **No live call site passes
such a pseudo-source.**
Patching `allowSelfId` at the retrieval site → correct SQL on all five
(`eq(schema.parts.id, i)` · `candidate.Id == i` · `cb.equal(root.get("id"), i)` · `PartRow.id == i` ·
`where: record.id == ^i`).
**Plan:** replace the boolean with a positive predicate (admit `this.id` when the source is a real
`AggregateIR`), apply to **both** strict sites, gate on `memberType.kind === "id"` so a user field named
`id` is unaffected.
**→ F-002 and F-003 must land as a PAIR.** `if let`/`Repo.run` require a criterion; with F-003 fixed,
`criterion ById(i: Part id) of Part = this.id == i` becomes expressible, so "the row with this FK" stops
forcing a natural-key lookup. Either alone leaves the author in a different corner of the same trap.

## F-009 — (b) deliberate, WRONG diagnostic — **plus a new silent (a) defect that is strictly worse**
**The restriction is deliberate and already ruled on — in the wrong document.**
`docs/domain-services.md:130`: *"The `loom.domain-service-cross-context-read` gate is **permanent by
design** … both sit in the **application layer (workflows / handlers), which is where cross-context
orchestration belongs**"*. So the one passage that rules on this tells the reader **workflows are where
you cross**, while the workflow surface silently refuses it.
**NEW — the read-only form is silent and breaks all five backends.** A cross-context read whose result is
used only as a *value* never trips `loom.workflow-unknown-binding`:
```
$ node bin/cli.js parse wf-cross-read-only.ddd   →  0 error(s), 0 warning(s).  OK
```
then: node `const x = Foos.getById(f);` (TS2304, not even `await`ed) · .NET CS0103 · java cannot find
symbol · python NameError/F821 · elixir undefined variable `foos`.
**Root cause** `src/ir/lower/lower-workflow.ts:96-103` builds `reposByName` from `ctx.members` alone, so
`matchRepoCall` misses and the statement falls through to `expr-let`.
**Plan:** mint `loom.workflow-cross-context-read` (error), modelled on the existing
`loom.domain-service-cross-context-read`; **reuse `foreignRepositoryOwners(ctx, allCtxs)`** from
`domain-service-checks.ts` (already written, already excludes same-name local repos, already yields the
owning context for the message). Key on a bare `ref` with `refKind:"unknown"` naming a foreign repo —
catches **both** the op-call and the silent read-only form. Ride `walkWorkflowStmtExprsDeep`. Extend to
`handle`/`on`/`commandHandler`. **Docs are the buyer-facing half:** add the rule to `docs/workflow.md`
with a *Cross-context orchestration* section stating plainly that neither sanctioned crossing is
transactional, and amend `docs/domain-services.md:138` so it stops pointing the wrong way.
Route through **#2896's packet**.

## F-010 residual — (b) one-clause fix, must STACK on #2874
`docs/auth.md:39-43` makes the construct **mandatory**; `validators/repository.ts:64` warns on every
author-declared collection find with no name exemption. #2874's `replacementInReach()` is **context**-scoped:
in any mature model (one that has adopted criteria) the guard passes and the warning survives. Repro built
to satisfy #2874's guard exactly (context declares both a criterion and a retrieval) still warns on
`find all(): Project[] requires currentUser.role == "manager"` — the exact spelling `auth.md` mandates.
**Neither replacement it names can carry the gate**: the route being gated is the compiler-synthesised
list route, which no criterion or retrieval owns.
**Plan:** one clause beside #2874's guard — a find named `all`, no params, returning `T[]`, **carrying a
gate**, is exempt. Derive "is this the list-route gate" from the shared `src/ir/util/read-gates.ts`
derivation `auth.md` itself names, **not** a second `name === "all"` check (that would drift).
Branch from #2874 or wait for it — a parallel edit to `repository.ts` conflicts.

## F-036 — split verdict
**(c) CORRECT, document it:** emitting no migration. `mapTypeToColumn` (`migrations-builder.ts:2720`) is
`case "enum": return { type: { kind: "text" } }` — both are TEXT, the diff is genuinely empty, and a
needless `ALTER TABLE` on every enum introduction would be worse.
**(a) DEFECT:** the wire contract is asserted but never enforced, at either end.
- The DB has no constraint and **cannot have one**: `ColumnType` (`migrations-ir.ts:16-35`) has no enum
  member and `ColumnShape` has no check field. **There is no representation for an enum constraint in
  `MigrationsIR` at all** — the gap is not "the diff missed it".
- The read path **casts** rather than parses: `return c.json(repo.toWire(found) as z.infer<typeof WorkOrderResponse>, 200)`.
  So a legacy `CHF` row serialises against a published schema declaring `EUR|USD|GBP`.
**Three tiers; ship tier 1 alone if one PR is wanted.**
1. **Honest warning** at the diff site when a column's source type goes `string` → `enum E` while the
   column stays `text`. No `MigrationsIR` change — the builder already has both field types there.
2. **CHECK constraint**, following #2895 file-for-file (`ColumnShape.check?`, snapshot handling — note
   #2895's precedent that a *source*-describing field is stripped from the snapshot and this one must
   **not** be, since a check is real schema; `mapTypeToColumn` emits it; `diffTable` treats member
   **removal** as destructive and **addition** as safe — the same asymmetry `docs/migrations.md:161-169`
   already reasons about for decimal precision; five renderers; a `migration-evolution` e2e leg —
   **the only tier that can prove itself**, needing a real `postgres:17` with a seeded `CHF` row).
   State the adoption cost plainly: adding the CHECK to a table with out-of-enum rows **fails at apply time**.
3. **Declarative remedy** — `migration "…" { WorkOrder.currency: "CHF" -> USD }` lowering to `UPDATE … WHERE NOT IN (…)`
   **before** `ADD CONSTRAINT`, the direct analogue of the NOT-NULL backfill. Without it tier 2 is a gate
   with no opening mechanism.
**Do NOT** fix by making the response path `.parse()` — that converts a data problem into a 500 on read
and costs a zod parse per row on the hot path. The constraint belongs in the database.

## F-044 — (a) unfinished + (b) the generated file mis-instructs the user
**The intended design is written in the code and is the opposite of what ships.**
`src/generator/typescript/emit/messages.ts:18-22`: *"**ADDING A LOCALE is a REGENERATION, not a
hand-edit:** `ddd i18n sync` owns the per-locale files … and **codegen bakes them in here. Today only the
source language is emitted**"*. The generated shim says: *"To add a locale, drop a
`src/locales/<locale>.json` file, **import it below**, and register it in `catalogs`"* — an instruction to
hand-edit a generated file, inside the generated file, against the project's own documented plan.
**The seam already exists.** `src/system/` is browser-safe by contract, and `GenerateSystemOptions`
already solves exactly this once, for source maps (`system/index.ts:115-128`: *"the CLI/playground supply
the text; a mapped file with no entry here is skipped … never guessed"*).
**Plan:** add `GenerateSystemOptions.locales?: ReadonlyMap<string, Record<string,string>>` in the same
idiom; CLI reads `<model-dir>/locales/*.json` (skipping `.loom/`); `_frontend/i18n-runtime.ts` emits one
import + `catalogs` entry per locale — **one edit covers react/vue/svelte/angular**, plus one arm each for
feliz/flutter. **Rewrite the shim's header comment** (the (b) fix, and the part a buyer feels). Backend
`renderMessagesModule` is the same one-line change and its own comment says it is waiting for this.
Test: locale present → imported+registered; **no locale files → byte-identical to today** (keeps every
frontend golden green).

## THE RULING — only ONE of these seven is an architectural limit
**Limit 1 (inherent — document, do not fix): there is no transactional consistency across a bounded
context, and there never will be.** Both sanctioned crossings are HTTP or async; `commandHandler` is
single-aggregate by validation. Orthodox DDD, ruled on in writing, correct. **The adoption consequence is
real: context boundaries are transaction boundaries you cannot renegotiate later** — getting them wrong is
a re-architecture, not a refactor. What is broken is only how it is *communicated*, badly enough to be a
defect in its own right.
**Limit 2 (a sequenced transition, not a bug): the read path has two spellings, not at parity.** `find`
has a route/hook/filter bar; `criterion`+`retrieval` is the better successor and today emits a repository
method and nothing else. Write `find` today, expect a mechanical migration. Has a dated exit.
**Limit 3 (inherent to the storage model): a Loom `enum` is a write-time constraint, not a stored one.**
Enums are TEXT — deliberate and defensible. The consequence *is* structural: the DB holds whatever
predates the enum, and a team must treat data cleanup as their own responsibility. The enforcement half is
fixable; the model isn't changing.
**NOT structural, though they read that way in a defect log:** F-002 (one validator arm that forgot what
its sibling already does — all five backends emit correct code today), F-003 (a flag set at 1 of 3 sites,
whose stated justification doesn't apply at the other two), F-044 (design written down, expensive half
built, seam already in use for source maps).
> The pattern across all three: **a validator stricter than the emitters, or a pipeline stage left one
> option short — and in each case the diagnostic told the author it was their fault.** F-002 and F-009 are
> the same defect class from two sides; one is a 15-line fix, the other a permanent architectural boundary
> with a broken sign on it. **That distinction is the main output of this cluster.**

Both protected trees verified clean (`/tmp/loom-main` at `9a8f2fe0`, no modifications; all experiments in `/tmp/agentI/lab`).

---

# FIX PLAN — structural / language-design limits

## 1. Verification table

| # | Status | Claim | Evidence (fresh `main` `9a8f2fe0`) |
|---|---|---|---|
| **F-002** `let` in a `for` body | **LIVE** | **UNCLAIMED** | `loom.workflow-foreach-unknown-binding C/finishB: workflow 'finishB': in 'for l', 'p.consume(...)' references unknown binding 'p'.` — 1 error. Controls: `-a` (no inner let) `0 error(s)`, `-c` (hoisted) `0 error(s)`, `-f` (`if let`) `0 error(s)`. |
| **F-003** `this.id` in a `criterion` | **LIVE** | **UNCLAIMED** | `loom.retrieval-where-unknown-field C/retrieval findAllByById: retrieval 'findAllByById': where-clause references unknown field 'this.id' on aggregate 'Part'.` Sibling site confirmed: `loom.find-where-unknown-field C/Parts.self: … unknown field 'this.id' on aggregate 'Part'.` |
| **F-008** `crudish` vs `denyByDefault` | **LIVE** | **CLAIMED BY #2877** | 3 × `loom.default-deny-ungated Project/update|create|destroy`. #2877 is **open, non-draft, NOT merged** (head `f53a4889`, base `50f4ec39`). Diagnostic wording on `main` is still the un-macro-aware one, confirming it has not landed. |
| **F-009** cross-context repository | **LIVE — materially worse than reported** | **UNCLAIMED** | Reported form: `loom.workflow-unknown-binding B/touchFoo: 'x.bump(...)' references unknown let-binding 'x'`. **New:** the read-only form validates `0 error(s), 0 warning(s).` and emits a dangling receiver on **all five** backends. |
| **F-010** deny-by-default vs `find` deprecation | **LIVE** | **PARTIALLY CLAIMED BY #2874**; residual **UNCLAIMED** | #2874 open, non-draft, NOT merged (head `69b47a7b`). Its rule gates on "context declares a criterion or retrieval" — it does **not** exempt the auth-mandated `find all`. Residual repro still warns. |
| **F-036** `string` → `enum` widening | **LIVE** | **UNCLAIMED** | Regenerating over the baseline: `Wrote 8 file(s) …, unchanged: 32` — migration dir still holds only `20260101000000_s_initial.sql`. Even a **fresh** enum column is `"currency" TEXT NOT NULL` with no CHECK. |
| **F-044** i18n translator ↮ runtime | **LIVE** | **UNCLAIMED** | `Created …/locales/de.json — 119 key(s) to translate`; `i18n check --strict` → `de: ok`, exit 0. `generate system` → only `web_app/src/locales/en.json`. |

### Claim audit (Step 2), each justified

| PR | State | Verdict |
|---|---|---|
| **#2877** crudish gate | open, not merged | **CLAIMS F-008 fully.** Adds `with crudish(requires: Policy)` + the same param on `softDelete`, splices `requires <Policy>()` first in each macro-emitted `create`/`update`/`destroy`, and rewords `loom.default-deny-ungated` to name the macro. Verified emission on all five backends in its body. **Defer entirely.** One deliberate carve-out it names: `scaffoldPaged` keeps no gate (retires under G2). |
| **#2874** read-path validators | open, not merged | **CLAIMS the general half of F-010.** File-level diff read: `replacementInReach()` in `src/language/validators/repository.ts` suppresses the warning in a context with no `criterion`/`retrieval`. **Does not exempt `find all`** — no name check anywhere in the patch. Residual is a separate, unclaimed finding. |
| **#2873** grammar (commas, `this.` lvalue) | open, not merged | **Not related to this cluster.** Touches `Aggregate`/`ValueObject`/`EntityPart`/`UserBlock`/`LValue`. |
| **#2896** diagnostics packet | open, `mergeable_state: dirty` | **Claims nothing here.** Its four codes are `workflow-handle-unsupported`, `entity-part-param-unsupported`, `reactor-without-starter`, `correlation-unsupplied`. **But it is the correct vehicle** for the new codes F-002/F-009 need — it is the repo's "one code-minting packet per wave" convention, and its own body states the reason (four PRs editing `messages.ts` conflict on every merge). |
| **#2895** migration add-column default | **MERGED** (`4f817479`) | **Adjacent to F-036, not a claim.** Diff: `ColumnShape.addColumnDefault`, `sql-renderable-expr.ts`, builder, snapshot, elixir emitter, a `migration-evolution` e2e leg. It is the *template* for F-036's fix, not the fix. |
| **#2864 / #2865 / #2862 / #2861** defect logs | open | **None claims any of this cluster.** #2864's body explicitly lists **"the i18n workflow"** under *what worked* — F-044 is not logged anywhere. Its D1–D7 + G1–G4 rows are disjoint from all seven findings. |

---

## 2. Rulings and plans (LIVE + UNCLAIMED)

### F-002 — `let` inside a `for` body → **(a) DEFECT.** One validator arm; the emitters are already complete.

**Proof it is not a design limit.** I patched only the validator (in a scratch copy) to register inner `repo-let`/`factory-let` the way the `if-let` arm already does, then generated. All five backends emit correct, complete code — repository injected, let rendered, per-iteration save emitted:

```ts
const lines = new LineRepository(tx, events);
const parts = new PartRepository(tx, events);        // ← injected
const ls = await lines.runFindAllByLinesOf(orderId);
for (const l of ls) {
  const p = await parts.getById(l.partId);           // ← the let
  p.consume(l.qty);
  await parts.save(p);                               // ← the save
}
```
```csharp
foreach (var l in ls) {
    var p = await _parts.GetByIdAsync(l.PartId, cancellationToken)
        ?? throw new AggregateNotFoundException($"Part {l.PartId} not found");
    p.Consume(l.Qty);
    await _parts.SaveAsync(p, cancellationToken);
}
```
```java
for (var l : ls) { var p = partsRepository.getById(l.partId()); p.consume(l.qty()); partsRepository.save(p); }
```
```python
for l in ls:
    p = await parts.get_by_id(l.part_id)
    p.consume(l.qty)
    await parts.save(p)
```
```elixir
{:ok, _} <- Enum.reduce_while(ls, {:ok, nil}, fn l, _acc ->
  with {:ok, p} <- Context.get_part(l.part_id),
       {:ok, loop_updated} <- Context.consume_part(p, %{"qty" => l.qty}) do
```

Mixed `expr-let` + `repo-let` also emits correctly (`const q = l.qty + 1;` then `const p = await parts.getById(...)`).

**Root cause**, `src/ir/validate/checks/workflow-checks.ts` — the `if-let` arm (≈ line 1020) already carries the fix *with a comment saying why*:

> *"A `let` declared INSIDE the branch binds for the rest of that branch. Registering it here is what makes … legal — the emitters already walk into the branch bodies and inject the repository for exactly this shape … without it the validator refused a form every backend emits."*

The `for-each` arm (≈ line 907) never got the same treatment. It walks `st.body` looking only at `op-call`, never registering `repo-let` / `factory-let`.

**Plan**
1. In the `for-each` arm, hoist the `if-let` arm's `checkBranchOpCalls` logic into one shared local helper used by both. Do **not** hand-roll a second traversal — CLAUDE.md's *No hand-rolled IR walks* rule and `test/system/ir-walk-census.test.ts` both bite here.
2. **Critical trap — scope the binding, do not leak it.** My naive one-line patch (register, never delete) made this pass with 0 errors:
   ```ddd
   for i in xs { let t = Things.getById(id0)  t.bump() }
   t.bump()                 // must NOT be legal
   ```
   and emitted `t.bump();` *after* the closing brace of the block declaring `const t` — a fresh TS2304/block-scope defect. The fix must mirror `branchLocal`: collect names registered in the body, `bindingAgg.delete(n)` after the loop.
3. `loom.workflow-foreach-unknown-binding` keeps its message — once the fix lands, the accusation is true again (the name really is unbound).
4. **Tests** (`test/ir/workflow-dataflow-checks.test.ts`, which already pins this code): repo-let-in-for passes; expr-let+repo-let mixed passes; **leak case is refused**; `if-let` cases unchanged.
5. **Mutation proof** (by file copy, per §84): revert the registration → the `for` cases fail; revert the scoped delete → the leak case fails. Two mutations, each failing only its own assertion.
6. **Also add a corpus fixture.** No `.ddd` in the repo exercises a `repo-let` inside a `for` body — that is why five working emitters sat behind a validator that refused them.

**Size:** ~15 lines + tests. Highest value-per-line in the cluster.

---

### F-003 — `this.id` in a `criterion` → **(a) DEFECT.** The flag already exists and is set at only one of three sites.

**Proof.** `firstUnknownColumnRef` (`src/ir/validate/checks/shared.ts:26`) already takes `opts.allowSelfId`. Exactly one caller sets it — the capability-filter loop (`query-checks.ts:123`). Its own doc comment concedes the semantics:

> *"a filter predicate is always AGGREGATE-rooted, where `id` is a real stored column on every backend … Find / retrieval `where`s keep the strict field-list check (**a workflow-instance read-model source has no `id` column**, so admitting it there would emit SQL against a missing column)."*

That justification is **not load-bearing at either strict site.** Both pass `agg` resolved from `ctx.aggregates` (`query-checks.ts:35` and `:220`); a retrieval over a workflow-instance view gets `agg === undefined` and skips the check entirely. There is no live call site that passes a `{fields: wf.stateFields, …}` pseudo-source.

Patching only `allowSelfId: true` at the retrieval site, every backend emits correct SQL:

```ts
const byIdCriterion = (i: Ids.PartId) => eq(schema.parts.id, i);
```
```csharp
public override bool IsSatisfiedBy(Part candidate) => candidate.Id == i;
public Expression<Func<Part, bool>> ToExpression() => candidate => candidate.Id == i;
```
```java
public static Specification<Part> ById(PartId i) { return (root, query, cb) -> cb.equal(root.<PartId>get("id"), i); }
```
```python
query = select(PartRow).where((PartRow.id == i))
```
```elixir
query = from(record in Api.C.Part, where: record.id == ^i)
```

**Plan**
1. Replace the boolean `allowSelfId` with a positive predicate at the helper: admit `this.id` when the column source is a real `AggregateIR` (has an `id` column), refuse it when it is a workflow-instance projection. Then all three call sites become uniform and the comment's caveat is *enforced* rather than approximated by "don't pass the flag".
2. Apply to **both** strict sites — `validateRetrievals` (`:234`) and `validateQueryableWheres` (`:57`). They fail identically today (`loom.find-where-unknown-field` on `this.id`); fixing only one leaves the asymmetry the buyer will hit next.
3. Gate on `memberType.kind === "id"` (already how the capability site does it), so a user-declared field literally named `id` is unaffected.
4. **Tests:** `this.id == p` in a criterion, in a retrieval `where`, in a `find … where`, each generating the correct column on all five backends; `this.ghost` still refused; the capability-filter self-scope case unchanged.
5. **Mutation proof:** revert the predicate → the three new cases fail with the exact `unknown field 'this.id'` text.

**This unblocks F-002's workaround chain.** `if let` and `Repo.run` require a criterion; with F-003 fixed, `criterion ById(i: Part id) of Part = this.id == i` becomes expressible, so "the row with this FK" no longer forces a natural-key lookup. F-002 and F-003 should land as a **pair** — either alone leaves the author in a different corner of the same trap.

---

### F-009 — cross-context repository → **(b) deliberate design, wrong diagnostic — plus an unreported (a) silent defect that is strictly worse.**

**The restriction is deliberate and already ruled on — in the wrong document.** `docs/domain-services.md:130`, *"Cross-context data, in DDD terms (a decision, not a TODO)"*:

> *"The `loom.domain-service-cross-context-read` gate is **permanent by design**, not an interim … A bounded context is a language boundary … Loom already models both sanctioned crossings, and both sit in the **application layer (workflows / handlers), which is where cross-context orchestration belongs**"*

So a reader of the one passage that rules on this is told **workflows are where you cross** — while the workflow surface silently refuses the crossing. That is worse than an undocumented rule; it is a documented one pointing the wrong way. `docs/workflow.md` states the analogous rule for events ("Event must be declared in the same context") and says nothing about repositories.

**The new finding — the read-only form is silent and breaks all five backends.** A cross-context repository read whose result is used only as a *value* (not as an op-call receiver) never trips `loom.workflow-unknown-binding`:

```ddd
workflow touchBar { create(f: Foo id, b: Bar id) {
  let x = Foos.getById(f)   // Foos lives in context A; this workflow is in context B
  let y = Bars.getById(b)
  y.setm(x.n) } }
```
```
$ node bin/cli.js parse wf-cross-read-only.ddd
0 error(s), 0 warning(s).
OK: …
```

Every backend then emits a dangling receiver — the *identical* five-way signature that `domain-service-checks.ts:255` documents as its own reason to exist:

| backend | emitted | |
|---|---|---|
| node | `const x = Foos.getById(f);` | TS2304 — `Foos` is in none of the file's 10 imports, and it is not even `await`ed |
| .NET | `var x = Foos.GetById(command.F);` | CS0103 |
| java | `var x = Foos.getById(f);` | cannot find symbol |
| python | `x = Foos.get_by_id(f)` | NameError / F821 |
| elixir | `with x <- (foos.get_by_id(f)),` | undefined variable `foos` |

**Root cause:** `lowerWorkflow` (`src/ir/lower/lower-workflow.ts:96-103`) builds `reposByName` from `ctx.members` alone, so `matchRepoCall` misses and the statement falls through to `expr-let` — verbatim the mechanism the domain-service header note describes.

**Plan — mint the workflow twin of a gate that already exists.**
1. New code `loom.workflow-cross-context-read`, **error**, message modelled on `loom.domain-service-cross-context-read` (which already names both sanctioned crossings and the "move it" escape). Reuse `foreignRepositoryOwners(ctx, allCtxs)` from `domain-service-checks.ts` — it is already written, already excludes locally-declared same-name repos, and already yields the owning context name for the message.
2. **Key on the same signal:** a bare `ref` with `refKind: "unknown"` naming a repository declared in another context. This catches **both** forms — the reported op-call one and the silent read-only one — and never flags a param/local that shadows the name.
3. Ride `walkWorkflowStmtExprsDeep` (`src/ir/util/walk.ts:310`), **not** a hand-rolled switch, or `ir-walk-census.test.ts` refuses it — and a hand-rolled walk would miss a cross-context read nested in a `for` or `if-let` body, which is exactly this defect class recurring.
4. Extend to `handle` / `on` bodies and `commandHandler`, not just `create` — same lowering path, same hole.
5. **Docs** — this is the (c) half, and it is where the buyer-facing value is:
   - `docs/workflow.md`: a rule row ("a workflow may name only its own context's repositories") plus a short *Cross-context orchestration* section naming the two sanctioned crossings and **stating plainly that neither is transactional**. The current text is silent, and the one place that does rule implies the opposite.
   - `docs/domain-services.md:138`: amend "which is where cross-context orchestration belongs" to say the workflow orchestrates the *published surfaces* (`resource { kind: api }` / channel-fed projection), never another context's repository directly.
6. **Mutation proof + `FIRING_FIXTURES` entry** (the repo's ratchet for a new code). Both repro shapes; a same-context control that must stay silent.
7. **Route through #2896's packet** rather than a fresh catalog PR — that PR's own body documents why (`messages.ts` conflicts on every merge). It is currently `mergeable_state: dirty`, so it will rebase anyway.

---

### F-010 residual — **(b) deliberate design, incorrect diagnostic.** The general case is #2874's; the auth case is not.

`docs/auth.md:39-43` is unambiguous that the construct is *mandatory*:

> *"The auto-injected `find all` list route is the one exception: it is compiler-synthesized with no author source line, so it is out of default-deny scope. **Declaring an explicit `find all(): T[] requires <expr>` gates that route**, and does so on all five backends"*

`src/language/validators/repository.ts:64` then warns on every author-declared collection find with no name exemption. #2874 adds `replacementInReach()` — a **context**-scoped guard. In any context that has adopted criteria (i.e. any mature model; the audit's own baseline had 10 such warnings), the guard passes and the warning survives. Repro, built to satisfy #2874's guard exactly:

```
$ node bin/cli.js parse f010-residual.ddd
f010-residual.ddd:14:12 warning: repository find 'all' is a wire-shaped list query — pass a criterion
  to 'run' (Repo.run(<Criterion>(args))) or name a 'retrieval' instead of accreting a bespoke list
  finder on the repository. …
0 error(s), 1 warning(s).
```

The context declares both a `criterion` and a `retrieval`. The find is `find all(): Project[] requires currentUser.role == "manager"` — the exact spelling `auth.md` mandates, and the exact spelling the linter deprecates. Neither replacement it names can carry the gate: the route being gated is the compiler-synthesized list route, which no criterion or retrieval owns.

**Ruling: (b).** Both behaviours are individually correct. Their intersection is a contradiction the compiler states to the user's face, and the diagnostic is wrong because its recommended migration cannot be performed.

**Plan — stack on #2874, do not race it.**
1. Add one clause to `checkRepositoryFinds`, beside #2874's `replacementInReach` guard: a find named `all`, taking no parameters, returning `T[]`, and **carrying a `gate`**, is exempt. Narrow on purpose — it exempts the auth-mandated shape only, not a hand-rolled `find all` with no gate.
2. Derive "is this the list-route gate declaration" from the shared `src/ir/util/read-gates.ts` derivation that `auth.md` itself names as the single source all five backends resolve the list read through. Do **not** re-detect `name === "all"` in the validator — that is a second source of truth for the same fact, and it will drift.
3. **Docs:** one sentence in `docs/auth.md` § Find gates and in `docs/criterion.md`'s advisories table — the gated `find all` is exempt from the deprecation *by construction*, because it declares a gate, not a query.
4. **Mutation proof:** remove the exemption → the residual repro warns again. Keep #2874's four scope tests green in both states so the assertion reaches the exact difference.
5. **Sequencing:** #2874 is open and non-draft with a clean mergeable state. Branch from it, or wait for it — a parallel edit to `repository.ts` conflicts.

---

### F-036 — `string` → `enum` widening → **(a) DEFECT in the honesty of the wire contract; the schema decision is (c) correct.**

Split the finding precisely, because the two halves have opposite verdicts.

**Correct and should be documented, not changed:** emitting no migration. `mapTypeToColumn` (`src/system/migrations-builder.ts:2720`) is `case "enum": return { type: { kind: "text" } };`. Both `string` and `Currency` are TEXT, so the diff is genuinely empty. That is right — a needless `ALTER TABLE` on every enum introduction would be worse.

**Defective:** the wire contract is asserted but never enforced, at either end.

- The DB has no constraint, and **cannot have one**: `ColumnType` (`src/ir/types/migrations-ir.ts:16-35`) has no enum member and `ColumnShape` has no check field. A *fresh* enum column is `"currency" TEXT NOT NULL` — no CHECK, no PG enum type. The gap is not "the diff missed it"; there is **no representation for an enum constraint in `MigrationsIR` at all**.
- The read path casts rather than parses:
  ```ts
  const CurrencySchema = z.enum(["EUR", "USD", "GBP"]).openapi("Currency");
  …
  return c.json(repo.toWire(found) as z.infer<typeof WorkOrderResponse>, 200);
  ```
  `as`, not `.parse(...)`. So a legacy `CHF` row serialises as `"currency": "CHF"` against a published OpenAPI schema declaring `EUR|USD|GBP`. Every generated client that trusts the schema is now wrong, silently.

The contrast the finding draws is exactly right and is the design precedent: a NULL→NOT-NULL flip is classified destructive, blocked without `--allow-destructive`, and has a declarative `migration { Field = value }` backfill (`docs/migrations.md:211-217`). A domain-narrowing that is *equally* capable of leaving unsatisfiable rows has neither gate nor backfill.

**Plan — three tiers. Ship tier 1 alone if the council wants one PR.**

**Tier 1 — the honest warning (small, ships now).** In the migration diff, when a column's source type changes `primitive string` → `enum E` while the column type stays `text`, raise a **warning**: the domain narrowed, the schema did not, existing rows are not validated, and reads are not filtered. Name the enum members and point at `migration { … }`. This requires no `MigrationsIR` change — the builder already has both the baseline and `next` field types at the diff site. It converts a silent data-integrity hole into a named, owned one, which is the trade `#2896` makes explicitly for the `*-unsupported` register.

**Tier 2 — the CHECK constraint (mission-sized; follow #2895's shape exactly).** #2895 (merged, `4f817479`) is the template, file for file:
- `ColumnShape.check?: string` (a rendered Postgres predicate) + `serializeSnapshot`/`schemaVersion` handling — note #2895's precedent that a field describing the *source* is stripped from the snapshot, and this one is **not** (a check is real schema, read back from the baseline, so it must be written out — contrast its `addColumnDefault` note).
- `mapTypeToColumn`'s enum arm emits `check: currency IN ('EUR','USD','GBP')`.
- `diffTable` compares it → an enum member **removal** is a narrowing and must be **destructive** (`--allow-destructive`), a member **addition** is a widening and is safe. This is the same asymmetry `docs/migrations.md:161-169` already reasons about for decimal precision.
- Five renderers: `sql-pg.ts` + the Ecto emitter (#2895 touched `src/generator/elixir/migrations-emit.ts` for precisely this reason) + EF/Drizzle/SQLAlchemy.
- A `test/e2e/migration-evolution` leg with a `…-base.ddd` / `…-evolved.ddd` pair, mirroring #2895's `field-default-base/evolved`. **This is the only tier that can prove itself** — it needs a real `postgres:17` and a pre-seeded `CHF` row.
- **Adoption cost, state it plainly in the PR:** adding the CHECK to an existing table with out-of-enum rows *fails at apply time*. That is correct, and it is why tier 3 exists.

**Tier 3 — the declarative remedy.** Extend `migration "…" { … }` to accept a value remap for the widening (`WorkOrder.currency: "CHF" -> USD`), lowering to `UPDATE … WHERE currency NOT IN (…)` **before** the `ADD CONSTRAINT` in the same migration. This is the direct analogue of the NOT-NULL backfill sequence at `docs/migrations.md:172-178`, and without it tier 2 is a gate with no gate-opening mechanism.

**Do not** "fix" this by making the response path `.parse()` instead of cast — that turns a data problem into a 500 on read, and it costs a zod parse on every serialised row on the hot path. The constraint belongs in the database.

---

### F-044 — i18n translator ↮ runtime → **(a) UNFINISHED, with a (b) generated file that mis-instructs the user.** Not a design limit at all; the design is already written down.

**The intended design is stated in the code, and it is the opposite of what ships.** `src/generator/typescript/emit/messages.ts:18-22`:

> *"**ADDING A LOCALE is a REGENERATION, not a hand-edit:** `ddd i18n sync` owns the per-locale files at the SYSTEM level (`locales/<locale>.json`), and **codegen bakes them in here. Today only the source language is emitted**, so every request resolves to the authored English."*

The generated frontend shim contradicts that instruction, in a file whose first line is `// Generated translation runtime (Loom i18n).`:

> *"To add a locale, drop a `src/locales/<locale>.json` file, **import it below**, and register it in `catalogs`."*

That is an instruction to hand-edit a generated file, inside the generated file, against the project's own documented plan. It survives exactly until the next `generate system`.

**Measured end to end:** `extract` → 119 messages; `init de` → `locales/de.json` + `locales/.loom/source.lock.json`; fully translated; `i18n check --strict` → `de: ok`, **exit 0** (a real CI gate, passing); `generate system` → `web_app/src/locales/en.json` and nothing else. `de.json` is never opened.

**The architectural seam already exists.** `src/system/` is browser-safe by contract, so codegen cannot read `locales/*.json` itself. `GenerateSystemOptions` already solves this exact problem once, for source maps (`src/system/index.ts:115-128`):

> *"`src/system/` stays browser-safe (no `fs`), so the CLI/playground supply the text; a mapped file with no entry here is skipped (no sidecar), never guessed."*

**Plan**
1. `GenerateSystemOptions.locales?: ReadonlyMap<string, Record<string, string>>` — locale tag → catalog. Documented in the same idiom as `sourceTexts`: **supplied by the caller, never read from disk by `system/`; a locale with no entry is absent, never guessed.**
2. CLI (`src/cli/main.ts`) reads `<model-dir>/locales/*.json`, skipping `.loom/`, and populates it. The playground wires its VFS the same way, exactly as it already does for snapshots and `sourceTexts`.
3. `src/generator/_frontend/i18n-runtime.ts` emits one `import <tag> from "./locales/<tag>.json";` per supplied locale and registers each in `catalogs`. This is shared by react/vue/svelte/angular, so **one edit covers four frontends**. Feliz (`feliz/i18n.ts`) and Flutter (`flutter/i18n.ts`) build a compiled `Map`/`const Map` from the same catalog — same input, one extra arm each.
4. **Rewrite the shim's header comment.** It must say locales come from `ddd i18n sync` + regeneration, and that hand-edits are overwritten. This is the (b) fix and it is the part a buyer actually feels.
5. **`activeLocale()` needs a second look under the same PR** — today it reads `navigator.language` and silently falls back to `en`. With real catalogs present, that becomes the *first* place a shipped translation fails to appear. Keep the behaviour, but a one-line comment naming it as the override point is cheap.
6. **Backend half is the same one-line change** in `renderMessagesModule` — its own comment says it is waiting for exactly this. Consider it in scope; the validation catalog is the half a translator cannot reach at all today.
7. **Tests:** a fixture model with `locales/de.json` beside it → generated `i18n.ts` imports and registers `de`; no locale files → byte-identical to today's output (this keeps every existing frontend golden green, which is what makes the change safe).
8. **Mutation proof:** drop the option threading → the de-import assertion fails; drop the CLI read → the generated `catalogs` has only `en`.

**Cost:** roughly one option, one CLI read, one shared emitter arm, two self-hosting arms. The expensive half — extraction, content-hash keying, the three-way merge, the CI gate — is built, good, and demonstrably working.

---

## 3. The three structural limits a buyer must design around

Decisively: **of these seven, exactly one is an architectural limit.** Two more are real constraints but of a different, softer kind. Everything else is unfinished work that looks structural only because the diagnostics describe it badly.

### Limit 1 — **There is no transactional consistency across a bounded context. There never will be.** *(inherent — document it, do not fix it)*

This is the only finding in the cluster that a buyer must genuinely design around, and it is the one that most deserves to be stated as a feature.

A workflow can only reach its own context's repositories. The two sanctioned crossings — a `resource { kind: api }` call to the other context's published surface, or a channel-fed local projection — are **HTTP and async respectively**. `commandHandler` is single-aggregate by validation. So a use case spanning two contexts is *eventually* consistent, full stop, and the team must design compensations rather than expect a rollback.

This is not a gap; it is orthodox DDD, it is ruled on in writing (`docs/domain-services.md:130`, "permanent by design"), and it is the correct call. Co-hosting two contexts on one deployable does not loosen it — *"the model decides, deployment realizes."*

**The adoption consequence is real:** context boundaries in Loom are **transaction boundaries you cannot renegotiate later.** Getting them wrong is not a refactor, it is a re-architecture. A team should expect to spend its first week on context boundaries and treat that as load-bearing design work, not modelling ceremony.

**What is broken is only how this is communicated** — and badly enough to constitute a defect in its own right. The one document that rules on it says cross-context orchestration *belongs in workflows*, which reads as permission. The workflow surface refuses it with a diagnostic that blames a `let`. And the read-only spelling refuses nothing at all — it ships five non-compiling backends from a model that parses `0 error(s), 0 warning(s)`. **Fix the diagnostic and the docs; keep the limit.**

### Limit 2 — **The read path has two spellings and they are not at parity.** *(inherent for now — a sequenced transition, not a bug)*

`find` has a route, a client hook and a scaffolded filter bar. `criterion` + `retrieval` is the intended successor, is architecturally better, and today emits a repository method and nothing else. The compiler currently deprecates the working spelling in favour of the incomplete one, and under `denyByDefault` it deprecates a construct `auth.md` makes **mandatory**.

#2874 narrows the nag honestly and says so at the call site: *"when a `retrieval` carries its own route (audit G2), you delete the single `replacementInReach` guard and the warning returns at full strength."* That is the right shape for an interim.

**The adoption consequence:** a buyer should write `find` today and expect a mechanical migration later — and should read any `repository-find-deprecated` warning as "a better spelling is coming", not "you did it wrong". This one has a dated exit, so it is a constraint with a shelf life, not a permanent shape. The residual auth collision is a one-clause fix and should not be left standing, because it is the case where the compiler contradicts its own security documentation.

### Limit 3 — **A Loom `enum` is a write-time constraint, not a stored one.** *(inherent to the storage model — must be documented; the enforcement gap is fixable)*

Enums map to `TEXT`. That is a deliberate, defensible schema decision — it avoids PG enum types, whose `ALTER TYPE` semantics are genuinely painful, and it keeps five backends on one column family. It is not going to change.

What follows from it **is structural and must be designed around**: the database will hold whatever was written before the enum existed, and today nothing on the read path, in the ORM, or in the schema disagrees. A team migrating an existing column into an enum must treat data cleanup as their own responsibility and must not assume the generated OpenAPI is a guarantee about stored values.

The *enforcement* half — a CHECK constraint, a destructive classification for member removal, a declarative remap — is fixable and should be fixed. But even fully fixed, "enum = TEXT + CHECK" remains the model, and the buyer should know that before their first data migration, not after.

### And what is NOT structural — three things that merely look it

Worth being blunt, because these read as language-design limits in a defect log and are not:

- **F-002** (`let` in a `for` body) — one validator arm that forgot what its sibling arm already does. All five backends emit correct code today. Zero design content.
- **F-003** (`this.id` in a criterion) — a flag that exists, is set at one of three call sites, and whose stated justification does not apply at the other two. All five backends emit correct SQL today. Zero design content.
- **F-044** (i18n last mile) — the design is written down in the repo, the expensive half is built and working, the seam to finish it already exists and is already used by source maps. Unfinished, not limited.

The pattern across all three: **a validator that is stricter than the emitters, or a pipeline stage that was left one option short — and in each case the diagnostic (or the generated comment) told the author it was their fault.** F-002 and F-009 are the same defect class viewed from two sides — a workflow-body name that the validator cannot resolve — and both were reported as language limits. One is a 15-line fix; the other is a permanent architectural boundary with a broken sign on it. An architecture council should read the distinction between those two as the main output of this cluster.
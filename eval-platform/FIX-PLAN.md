# Fix plan — evaluation findings F-1…F-6

**Date:** 2026-09-22 · **Base:** `main` @ `4ce48afd` (rebased; 19 commits of drift absorbed)
**Inputs:** [`FINDINGS.md`](FINDINGS.md) · repros under `eval-platform/repro/`

Everything below is grounded in code I read and claims I re-ran, not in the findings
write-up alone. Two conclusions changed as a result — one finding is **already owned by
an open PR**, and one is **a deliberate trade-off rather than a defect**.

---

## 1. Claim check — what is already owned

Per CLAUDE.md ("check the open drafts before you claim"), all 24 open PRs were listed and
the three plausible overlaps read in full.

| finding | claim status | evidence |
|---|---|---|
| **F-1a** primitive member access | **OWNED by #2949** (draft, `claude/fix-primitive-member-access`) | Built that branch in a worktree and ran **my own repros through it**: `money.amount` and `label.bogusThing` are both refused at `file:line:col`. Its claim holds — verified, not trusted. **Do not duplicate.** |
| **F-1b** elixir drops invariants | **unclaimed** | Same worktree: my `elixir-invariant-drop` repro still validates `0 error(s), 0 warning(s)` on #2949's branch. The gap survives that PR entirely. |
| **F-2** .NET `Task` collision | **unclaimed** | #3017 (`loom-sweep-wave5`) touches .NET, but for `#line` path determinism — not type-name collision. Nothing else in the open set mentions it. |
| **F-3** inferred rename | **unclaimed**, and reframed | No `loom.migration-rename-*` code exists for the inferred case. M-T2.1 covers *explicit* rename intent only; no mission covers announcing the guess. |
| **F-4** flutter `design:` | **unclaimed** | No open PR touches `platform-rules.ts`. |
| **F-5** stale template text | **unclaimed** | — |
| **F-6** breakpoints line granularity | **unclaimed** | — |

**Net: six findings, five to build.** F-1a is dropped from this plan.

---

## 2. Grouping principle — why these five PRs

The constraint is `pr-gate`: it fails if **any workflow that triggers on the head SHA**
fails, and workflows are **path-scoped** — a path-skipped workflow never appears on the
SHA and is therefore free. So a PR's CI cost is a function of *which paths it touches*,
and the way to not kill CI is:

1. **One backend's paths per PR.** Touching `src/generator/elixir/**` and
   `src/generator/dotnet/**` in one PR triggers *both* backends' docker-booting legs.
   Splitting them halves the runner load per entry and keeps a revert surgical.
2. **Keep language/validator changes small and separate.** A change under
   `src/language/**` or `src/diagnostics/**` triggers the broad fast tier on every PR
   that carries it — cheap on its own, expensive when bundled with a heavy backend PR
   that will need several pushes to go green.
3. **Group only within a tier.** Two S3 fixes that both live in the fast tier and share a
   theme cost the same as one.
4. **Remember the merge queue re-runs 22 gates on the combined tree** — so "green on my
   head" is not the finish line, and smaller entries are cheaper to eject and re-land.

| PR | theme | paths | heavy legs triggered | size |
|---|---|---|---|---|
| **PR-1** | Elixir stops dropping invariants (F-1b) | `src/generator/elixir/vanilla/**` | elixir only | M–L |
| **PR-2** | .NET BCL type-name collision (F-2) | `src/generator/dotnet/**`, corpus fixture | dotnet only | M |
| **PR-3** | Announce the inferred rename (F-3) | `src/system/migrations-builder.ts`, `src/diagnostics/**`, `docs/migrations.md` | migration + schema-load | S–M |
| **PR-4** | Two "the compiler says something untrue" fixes (F-4 + F-5) | `src/language/validators/**`, `src/cli/new-templates.ts` | none (fast tier) | S |
| **PR-5** | `ddd breakpoints` line granularity (F-6) | `src/generator/_trace/**`, `src/trace/**` | none (fast tier) | M |

**Why F-4 + F-5 group:** both are one-line-ish, both are the compiler asserting something
false (a design pack that does nothing; a template documenting a limitation that shipped),
both land in the fast tier, neither can mask the other's failure.

**Why nothing else groups:** PR-1 and PR-2 are different backends (rule 1). PR-3 touches
the shared migration builder — the one file where a bad merge is most expensive — and
deserves an isolated blast radius and its own revert. PR-5 is unrelated and lowest value.

**Sequencing.** PR-4 first (cheapest, lands in an hour, proves the branch/CI loop).
PR-1 and PR-2 in parallel — disjoint paths, disjoint CI legs, no shared files. PR-3 after
PR-1/PR-2 have merged, so it rebases onto a settled tree. PR-5 last. **No stacking is
required:** no two PRs share a file. PR-1 is independent of #2949 (my repro uses only
legal invariants), so it need not wait for it.

---

## 3. Per-PR implementation plan

### PR-1 — Elixir: an invariant it cannot render must not vanish (F-1b) · **S1, highest value**

**Problem.** `changeset-emit.ts` renders single-field natives; `changeset-invariant-emit.ts`
renders cross-field scalar comparisons gated by `structEvaluable()`. An invariant matching
neither path is dropped with no diagnostic. Measured: 3 of 5 legal invariants absent on
Elixir, 5 of 5 present on the other four backends.

**Design decision to settle first (this is the fork worth a human call):**

- **(a) Close the hole — widen the renderer.** Emit the unsupported shapes through the
  existing vanilla `renderExpr` into a custom Ecto validator over `apply_changes/1`.
  Method calls (`sku.trim().length`) and derived getters (`isBig`) are renderable —
  `render-expr.ts` already handles them for operation/derived bodies, which is where the
  header comment's "machinery a changeset validator can't host" is *over-stated* for
  these two shapes. Collection walks (`lines.count`) are genuinely harder: the changeset
  does not have the children loaded.
- **(b) Close the honesty gap — refuse or warn.** Emit a `loom.elixir-invariant-unsupported`
  diagnostic naming the aggregate, the invariant source text, and the reason, so the
  author learns at build time that this rule will not be enforced on this backend.

**Recommendation: (b) first, then (a) for the shapes that are cheap.** (b) is small,
strictly honest, and independently valuable — it converts a silent S1 into a visible S3
for *every* shape including ones not yet enumerated. (a) is the real fix but is
shape-by-shape and will not reach collection walks without preloading work.
Landing (b) first also gives (a) a ratchet: each shape (a) implements deletes its own
waiver, which is exactly the repo's stated waiver discipline.

**Files.** `src/generator/elixir/vanilla/changeset-invariant-emit.ts` (the fall-through
site), `changeset-emit.ts` (the native path's `null` return), `src/diagnostics/messages.ts`
(+ `code-docs.ts`), a new `test/generator/elixir/invariant-coverage.test.ts`,
`docs/generators.md` (the per-backend matrix row).

**Mutation proof (required by CLAUDE.md, and the thing that makes this a gate).** Revert
the diagnostic **by file copy, never `git checkout --`** → the new coverage test must fail
naming the three dropped invariants. Restore → green. Additionally pin the *positive*
direction: an aggregate whose invariants are all single-field must emit byte-identical
output to today, so the 80 `elixir-vanilla-build` fixtures do not churn.

**Verification beyond `npm test`.** `mix compile --warnings-as-errors` on the repro and on
`examples/showcase.ddd` in the `hexpm/elixir` container; a before/after tree diff over
`test/e2e/fixtures/elixir-vanilla-build/` asserting only the intended files move.

---

### PR-2 — .NET: a domain type named `Task` must compile (F-2) · **S2**

**Problem.** `ddd new --template crud --platform dotnet` emits an aggregate `Task`, which
collides with `System.Threading.Tasks.Task` → 17 errors (`CS0104` ambiguous reference,
`CS0535`/`CS0738` interface failures). Mutation-proved: renaming to `Job` alone yields
`Build succeeded. 0 Warning(s)`.

**Measured constraint that rules out the obvious fix.** I counted the generated C#: **42
uses of generic `Task<…>` and non-generic `Task` used as a bare return type**
(`Task SaveAsync(...)`, `Task DeleteAsync(...)`, `Task InvokeAsync(...)`). So the cheap
trick `using Task = Api.Domain.Tasks.Task;` is **wrong** — a C# alias is arity-blind for
the bare form, so every `async Task Foo()` would resolve to the domain type. The emitter
also uses **no `using X = …` aliases anywhere today**, so this is new machinery either way.

**Three options, with a recommendation:**

| option | mechanism | cost |
|---|---|---|
| **(i) alias the BCL side, conditionally** | when a colliding aggregate name is detected, emit `using SysTask = System.Threading.Tasks.Task;` in affected files and render async returns through it | contained, but touches the .NET type renderer's hot path |
| **(ii) fully-qualify the BCL always** | render `System.Threading.Tasks.Task<T>` unconditionally | simple and always correct, but rewrites **every** generated .NET file → fixture churn and a determinism-gate diff |
| **(iii) reject at validation** | `loom.dotnet-reserved-type-name` | cheapest, but tells the user they may not call an aggregate `Task` — a very common domain noun, **and one Loom's own starter template uses** |

**Recommendation: (i), with (iii) as the fallback** if (i) proves to reach too much of the
renderer. (ii) is rejected on fixture churn; (iii) is rejected as user-hostile — a DDD tool
refusing the name `Task` is a bad trade, and it would force the starter template to change
to dodge its own compiler.

**Scope the collision set properly.** `Task` is one instance. The real input is "BCL types
the .NET emitter imports": at minimum `Task`, `ValueTask`, `Type`, `Exception`, `Action`,
`Func`, `File`, `Path`, `Stream`, `Timer`, `Queue`, `Random`, `Version`, `Attribute`,
`Enum`, `Array`, `List`, `Dictionary`, `Convert`, `Math`, `Environment`, `Console`. Derive
it from the emitter's own `using` set rather than hand-listing, so it cannot drift.

**Files.** `src/generator/dotnet/` (type renderer + file-header emitter), a new
`test/fixtures/corpus/dotnet-bcl-collision.ddd` (the sibling of the existing
`java-reserved-words.ddd`), `test/generator/dotnet/**`.

**Mutation proof.** Seed the fixture with `aggregate Task`; revert the alias emission by
file copy → `dotnet build /warnaserror` must fail with `CS0104`. Restore → `Build
succeeded`. Run in the `mcr.microsoft.com/dotnet/sdk:10.0` container.

**Also decide (small, separate commit in the same PR):** whether the starter template
should keep `Task`. It should — once (i) lands, the template becomes the regression test
that the collision stays fixed.

---

### PR-3 — Announce the inferred column rename (F-3) · **S1 → S3**

**Reframed.** `migrations-builder.ts` ~1329 carries an explicit, well-argued rationale for
the one-drop-one-add collapse, names F-018, and shows its backfill-discard half was
already fixed (three contrary signals implemented). The collapse is a **documented guess**,
not an oversight. Changing it would break real renames.

**So the fix is not the heuristic — it is the silence.** Today the inference emits
`0 error(s), 0 warning(s)`.

**Change.** Emit `loom.migration-rename-inferred` (**warning**, not error) whenever the
collapse fires, naming the table, both column names, and the one-line way to make it
explicit or to deny it:

```
warning: migration for module "S": inferred a RENAME of c.products.title -> description
  (one dropped column, one added column, same type and nullability, no backfill and no
  default). If these are unrelated columns, the old column's data will land under the new
  name. Declare the intent either way:
    migration "rename-title" { Product.title -> description }   // yes, a rename
    migration "backfill-desc" { Product.description = "" }      // no — a new column
```

**Why a warning and not an error:** an error breaks every existing model that relies on
the inference, and the maintainers' rationale for the inference is sound. A warning costs
nothing and removes the "silent" that makes the residual dangerous.

**Files.** `src/system/migrations-builder.ts` (at the collapse site, where
`renameFor.set(...)` happens), `src/diagnostics/messages.ts`, `code-docs.ts`,
`docs/migrations.md` (state the inference and its contrary signals in the doc, which today
documents only the explicit block), `test/ir/migrations-builder.test.ts`.

**Mutation proof.** Revert the warning by file copy → the new test asserting the warning
fires on a drop+add pair must fail. Also assert the **negative**: a model with a declared
backfill emits drop+add and *no* rename warning (proving the warning tracks the collapse,
not the diff shape).

**Open question for the maintainers, surfaced not decided:** should `--allow-destructive`
gain a sibling `--allow-inferred-rename` so CI can refuse the guess outright? I would not
build it in this PR.

---

### PR-4 — Two honesty fixes: Flutter `design:` and the stale starter text (F-4 + F-5) · **S3**

**F-4.** `expectedPackFormatFor()` (`src/language/validators/data/platform-rules.ts:133`)
returns `undefined` for `flutter`, so `checkDeployableDesignPack` skips the pack check
entirely. Result: `design: mantine` on a Flutter deployable is accepted — a pack every
other framework *rejects* — and generates byte-identical output to `design: shadcn`
(verified by diff). The author believes they chose a design; nothing happened.

Flutter has no `.hbs` pack pipeline (it self-hosts), so the fix is **not** to invent a
pack format. It is to say so: add a `flutter` arm to `checkDeployableDesignPack` that
reports `design:` on a Flutter deployable as having no effect — mirroring the existing
Case-3 "value is ignored at generation" warning that already exists for non-UI deployables.
Decide error-vs-warning: **warning**, consistent with the existing Case-3 precedent in the
same function.

**F-5.** `src/cli/new-templates.ts:273` ships, in every scaffolded `main.ddd`:
> "hand-write those three on any aggregate you want gated until `crudish(requires: <Policy>)` lands."

It landed (`src/macros/stdlib/crudish.macro.ts:85`), the validator's own diagnostic tells
you to use it, and I used it successfully in this evaluation. Delete the stale clause and
replace it with the working spelling. **This is the highest-leverage doc fix in the repo**
— it is the first file every new adopter reads.

**Files.** `src/language/validators/data/platform-rules.ts` or `deployable.ts`,
`src/cli/new-templates.ts`, `src/diagnostics/messages.ts`, `test/language/validators/**`,
`test/cli/**`.

**Mutation proof.** F-4: revert → the test asserting a warning on `design:` + flutter
fails. F-5: a test asserting the scaffolded template contains no "until … lands" string
and that the emitted starter still parses `0 error(s)`.

---

### PR-5 — `ddd breakpoints` line granularity (F-6) · **S3, lowest priority**

**Measured.** `--sourcemap` + `ddd breakpoints --line N` resolves the correct generated
**files** for every construct tried, but reports line `:1` for most of them — a field, an
invariant and a repository `find` all map to `<file>:1`; only one probe (a `requires`
gate) resolved to a real line (`order.ts:60`).

**Investigate before designing.** The cause is not yet established, and I will not guess:
either the recorder (`src/generator/_trace/sourcemap.ts`) is not being fed a line for most
emission sites, or the resolver (`src/trace/resolve.ts`) is collapsing to the file's first
line. **First deliverable of this PR is a diagnosis, not a patch** — if the recorder is
simply not called at most emit sites, this is a much larger job than it looks and should
be re-scoped into a `docs/new-plan/` mission rather than forced into one PR.

**Honest framing for the PR body:** the feature is documented as resolving a `.ddd` line to
`file:line(s)`; today it reliably resolves *files*. Either the implementation or the doc
should move; the doc fix is a one-liner and can land immediately if the implementation is
deep.

---

## 4. What I would not do

- **Do not rebuild F-1a.** #2949 is complete, verified against my own repros, and awaiting
  green. If it stalls, the right move is to help it land, not to re-cut it.
- **Do not "fix" the rename heuristic** (PR-3). The inference is load-bearing for real
  renames and its rationale is sound; only the silence is wrong.
- **Do not bundle PR-1 and PR-2.** Two backends in one PR doubles the heavy CI legs and
  makes a revert non-surgical, for zero review benefit.
- **Do not push to see CI's verdict.** Every gate here runs locally; CLAUDE.md is explicit
  that pushing to check burns the shared ~20-slot pool. Each PR's local gate is named in
  its section above.

## 5. Suggested order

1. **PR-4** (F-4 + F-5) — fast tier, ~1h, proves the loop.
2. **PR-1** (F-1b) and **PR-2** (F-2) in parallel — the two S1/S2 defects, disjoint paths.
3. **PR-3** (F-3) — after 1 and 2 settle, isolated blast radius on the migration builder.
4. **PR-5** (F-6) — diagnosis first; re-scope to a mission if the cause is structural.

# Fix plan — draining the Clinica evaluation register

Source register: [`FINDINGS.md`](FINDINGS.md) — 21 defects (7 S1 · 8 S2 · 6 S3),
**14 SILENT · 4 HONEST · 3 docs/structural**. Every S1/S2 has a repro in
[`repro/`](repro/); `bash eval-clinica/tools/verify-repros.sh` re-runs them all.

Written in the repo's existing wave convention
(`docs/audits/*.waves.json` → packets with **disjoint `fileTrees`**, rows carrying
`size`/`confidence`/`P`, plus an explicit `sequencing` list of "X before Y" + reason).
Machine-readable twin: [`FIX-PLAN.waves.json`](FIX-PLAN.waves.json).

---

## 0. The sentence that shapes the whole plan

Sixteen of the twenty-one defects share one property: **`ddd generate system` printed
`0 error(s), 0 warning(s)` and then emitted a project that does not compile, crashes, or
is silently wrong.** Fixing them one at a time leaves the *mechanism* that let them ship
intact — which is the maintainers' own diagnosis:

> "five of the six severe defects survived because no corpus fixture exercises the shape"
> — `docs/audits/2026-09-09-verification-fleet-plan.md`

So **wave 0 is not a bug fix.** It is the corpus fixture + compile gate that would have
caught eleven of the sixteen before they were written, and it must land first so every
later packet can be mutation-proved against a gate that actually reaches the defect.

---

## 1. Root-cause grouping

The 21 findings collapse to **11 root causes**. This is what makes the plan parallelisable:

| Root cause | Findings | Shape |
|---|---|---|
| **RC-1** Aggregate `function` emitted `private`, called from outside | F-004, F-016 | 4 emitters hardcode `private`; python additionally *renames* (`_has_skill` def vs `has_skill` call) |
| **RC-2** A repository read escapes its legal context | F-002, F-009 | no validator gate; emitters improvise. Overlaps maintainer PRs **#2913/#2915/#2916** |
| **RC-3** A user-chosen name collides with an emitter-owned name | F-013 (`state`), F-019 (`…Exception`) | no reserved-name gate, no mangling |
| **RC-4** ICU format suffix is a pass-through on the backends | F-006 | 5 × `i18nFormat: (inner) => inner`; python's arm additionally *throws* |
| **RC-5** Frontend degradation is not uniform | F-022 | React degrades honestly; Angular emits a type error |
| **RC-6** Unbounded recursion in a containment walk | F-018 | `nestedContainLoads` + 3 peers |
| **RC-7** The read path's replacement doesn't reach the wire | F-008 | `retrieval` has no route; `find` is deprecated anyway |
| **RC-8** Schema differ is blind to representation-preserving type change | F-010 | `string`→`enum` is TEXT→TEXT |
| **RC-9** i18n last mile | F-017 | `locales/*.json` produced by the CLI, never read by `generate` |
| **RC-10** Security defaults fail open + comment asserts otherwise | F-020 | audience conditional; realm has no claim mappers; 403 leaks the predicate |
| **RC-11** Docs/DX truthfulness | F-001, F-003, F-005, F-007, F-012 (doc half), F-023, F-006 (doc half) | dead links, raw parser dumps, prose that contradicts the grammar |
| — | F-014 (java `Objects` import), F-015 (elixir `__`-vars) | isolated one-file emitter bugs; ride the per-backend packets |

---

## 2. Packets (disjoint file trees — the unit an agent claims)

Each packet is one agent, one draft PR, one `fileTrees` claim. Packets in the same wave
have **no tree overlap** and can run fully in parallel.

| # | Packet | `fileTrees` | Rows | Size |
|---|---|---|---|---|
| **P0** | `corpus-compile-gate` | `test/fixtures/corpus/**`, `test/system/generated-compiles.test.ts`, `scripts/**` | the gate + a realistic corpus app | **L** |
| **P1** | `validator-gates` | `src/ir/validate/checks/**`, `src/diagnostics/messages.ts`, `src/language/validators/**` | RC-2, RC-3 (gate half), RC-6 (gate half) | L |
| **P2** | `node-ts` | `src/generator/typescript/**`, `src/platform/hono/**` | RC-1 (node), RC-6 (node), RC-10 (node audience) | M |
| **P3** | `dotnet` | `src/generator/dotnet/**` | RC-1, RC-3 (mangle `State`, suppress CA1711), RC-6, RC-10 | M |
| **P4** | `java` | `src/generator/java/**` | RC-1, **F-014** (`java.util.Objects` import), RC-6, RC-10 | M |
| **P5** | `python` | `src/generator/python/**` | RC-1 (+ the `_`-rename mismatch), RC-4 (the **throw**), RC-6, RC-10 | M |
| **P6** | `elixir` | `src/generator/elixir/**` | **F-015** (`__`-prefixed bindings), RC-6, RC-10 | S |
| **P7** | `expr-icu` | `src/generator/_expr/**`, each backend's `render-expr.ts` leaf line only | RC-4 (the 5 leaves) | M |
| **P8** | `angular-forms` | `src/generator/angular/**` | RC-5 | S |
| **P9** | `read-path-routing` | `src/ir/enrich/**`, `src/generator/_frontend/**` route derivation, `src/system/index.ts` | RC-7 | L |
| **P10** | `migrations-type-narrowing` | `src/system/migrations-builder.ts`, `src/generator/sql-pg.ts` | RC-8 | M |
| **P11** | `i18n-locales` | `src/generator/_frontend/i18n-runtime.ts`, `src/cli/i18n/**`, each frontend `index.ts` locale line | RC-9 | M |
| **P12** | `auth-defaults` | `src/generator/*/auth*.ts`, `src/platform/hono/*/auth-emit.ts`, `src/generator/*/keycloak*` | RC-10 (shared decision + realm mappers) | M |
| **P13** | `docs-truth` | `docs/**`, `README.md`, `src/cli/main.ts` help strings | RC-11 | M |

> **Tree-overlap note.** P7 and P2–P6 both touch `src/generator/<backend>/render-expr.ts`.
> P7 owns **only** the `i18nFormat:` leaf line in each; P2–P6 own everything else in their
> tree. If that is too fine a boundary for the fleet, fold P7's five leaf edits into
> P2–P6 and keep P7 for `_expr/target.ts` + the contract only.

---

## 3. Waves

### Wave 0 — the gate that makes the rest provable (must land alone)

**P0 · `corpus-compile-gate` · L · blocks everything**

Two deliverables:

1. **A realistic corpus application.** Not a feature fixture — an *app*, in the shape the
   register was found with: 8–12 aggregates, tenancy + auth + `mask unless`, a workflow
   calling an aggregate `function`, a `state`-named field, a `string[]`, a `datetime`
   operation parameter, an ICU-formatted `derived`, a `retrieval`, an `Encounter`-style
   PHI aggregate. `eval-clinica/clinica/main.ddd` is a ready-made candidate — it is already the
   thing that found eleven of these.
2. **`test/system/generated-compiles.test.ts`** — for each corpus app × each target,
   generate and run the target's real compiler. This is the check that converts the SILENT
   class into the HONEST class wholesale.

**Mutation proof for P0** (required before any other packet merges): revert each of
F-004, F-013, F-014, F-016, F-018, F-022 in a scratch copy and show the gate goes red for
each, naming the right target. A gate that passes on first run proves nothing.

> **Cost note.** Compiling five backends × the corpus is minutes, not seconds. Run the
> full matrix in the merge queue / nightly; run the **node + one statically-typed backend**
> per PR. That is enough to catch RC-1, RC-3, RC-6 and the import class at PR time.

---

### Wave 1 — the compile blockers (7 packets, fully parallel)

Everything here is an S1 that stops a target compiling. All seven have disjoint trees and
proven repros.

| Packet | Rows | Repro |
|---|---|---|
| P2 `node-ts` | RC-1 node arm | `r06`, `r16` |
| P3 `dotnet` | RC-1 dotnet arm · **F-013** mangle the nested `State` type · **F-019** suppress CA1711 alongside the CA rules the `.csproj` already suppresses | `r14`, `r06` |
| P4 `java` | RC-1 java arm · **F-014** emit `import java.util.Objects` | `r15`, `r16` |
| P5 `python` | RC-1 python arm — **and the `_has_skill` def vs `has_skill` call mismatch, which is an `AttributeError` at request time, not a convention issue** | `r16` |
| P6 `elixir` | **F-015** name the datetime-coercion bindings without the leading `__` | `r13` |
| P8 `angular-forms` | **F-022** — `initFor` returns `"null"` for a collection; return `"[]"`. The same function's comment already records this exact class being fixed for `X id` fields (`FormControl(null)` typed `FormControl<null>` failed `ng build` TS2345/2322) | `r22` |
| P7 `expr-icu` | **F-006** — decide the contract (below), then implement or refuse | `r07` |

**RC-1 is one semantic decision, not four fixes.** An aggregate `function` reachable from a
`when` guard, a `can_<op>` route, a route handler, or a workflow body must not be emitted
`private`. Land the four arms together behind one IR-side predicate
(`isReachableFromOutsideAggregate(fn)`) so the backends stay consistent; the four emitter
lines are `typescript/emit/aggregate.ts:487`, `dotnet/emit/entity.ts:426`,
`java/emit/entity.ts:586`, `python/emit/aggregate.ts` (`_<snake>`).

**RC-4 needs a decision before code.** `docs/new-plan/T1` states the backend pass-through
is deliberate ("a backend `derived` stays byte-identical … format dropped"). So P7 is a
fork:
- **(a)** implement the formats on the backends (`Intl.DateTimeFormat` / `ToString(fmt)` /
  `strftime` / `NumberFormat`) — the honest-to-the-docs option; **or**
- **(b)** keep the pass-through and add `loom.interp-format-backend-only` refusing a
  format spec in a **backend-reachable** `derived` — the cheap option.

Either way **the python arm is not optional**: `"on " + self._start_at` is a `TypeError`
on every read of the aggregate, and the same generated file already writes
`self._start_at.isoformat()` for `inspect`. Fix that in P5 regardless of the fork.
Either way, `docs/language.md` must stop presenting ICU suffixes as general expression
syntax with a backend TypeScript example (→ P13).

---

### Wave 2 — the silent-semantics gates (needs P0 and the wave-1 trees settled)

**P1 · `validator-gates` · L**

| Row | Fix |
|---|---|
| **F-002** | `loom.repository-read-in-invariant` — refuse a repository read in an `invariant` / `derived` / `check`. Today it emits an undefined identifier wrapped around a **tautology** (`this._practitioner === this._practitioner`), and elixir drops the rule entirely. |
| **F-009** | Promote the emitter's `Error: internal: … Please file a bug` to a validator refusal: `Repo.run(<Retrieval>)` in a paged `queryHandler` is not a supported shape. |
| **F-018** | `loom.containment-cycle` — a self-recursive `entity` part currently validates clean and blows the JS stack on 4 of 5 backends. |
| **F-013 / F-019 gate half** | A reserved-name check so a colliding field name is refused at the model, not discovered at `dotnet build`. |

**Coordinate with the maintainer's open PRs before starting.** #2913 ("a plain `operation`
reaching a repository validates clean and breaks codegen"), #2915 and #2916 are the same
family as F-002. P1 should **extend** whichever of those lands first, not duplicate it —
per the repo's own draft-PR claim protocol.

Mutation proof: each new code must be shown to fire on its `eval-clinica/repro/` file and to go
quiet when the model is corrected.

---

### Wave 3 — correctness and completeness (parallel, independent)

| Packet | Row | Note |
|---|---|---|
| P10 | **F-010** `string`→`enum` | The differ sees TEXT→TEXT and emits nothing. Emit a `CHECK` constraint (or a validation backfill step), or refuse like the destructive gate does. Today the API serves `"requiredSkill":"massage"` against its own published enum, which its own generated zod client rejects. |
| P9 | **F-008** `retrieval` has no route | Either auto-expose a declared `retrieval` the way `findAll` is exposed, or stop `loom.repository-find-deprecated` from pointing at a construct that cannot reach the wire. Today the compiler warns you toward a dead end that costs four extra declarations and an `api {}` block. |
| P11 | **F-017** locales never emitted | The CLI half (extract/init/**three-way sync**/check) is built and good — it kept my hand translations across a model change. Only the last mile is missing: emit every `locales/*.json` next to the `.ddd` into each frontend and register them in the generated `catalogs` map instead of telling the user to hand-edit `src/i18n.ts`. |
| P12 | **F-020** auth defaults | Default `audience` to `clientId`, or emit `loom.auth-audience-unset` (error under `denyByDefault`). Make the generated comment conditional on what was emitted. Ship protocol mappers for the declared `user {}` claims in `keycloak/realm.json`. Add a flag to stop 403 bodies echoing the predicate source. |

---

### Wave 4 — truthfulness (1 packet, can start any time, merge last)

**P13 · `docs-truth` · M**

| Row | Fix |
|---|---|
| **F-023** | The README's "Live site", playground and hosted docs are **404**; 5 `lemmit.github.io` + 6 `github.com/lemmit/Loc` URLs are dead after the org move. Either redeploy or rewrite. This is the first thing an evaluator hits. |
| **F-001** | CLI `--help` points `patch`/`trace`/`breakpoints` at `docs/old/proposals/**`, which the README itself calls archived and un-deployed. Point at `docs/debugging.md` / `docs/api-toolkit.md`. |
| **F-007** | `create { }` is documented as valid ("omitting the parens keeps it quiet") and is a parse error; `destroy { }` works. Fix the doc or the grammar. |
| **F-003 / F-005** | Two diagnostics leak compiler internals: `Could not resolve reference to NamedDecl named 'strng'` (no "did you mean", though the same facility exists for field names) and `Unexpected 'from'. Expected one of: … (+111 more)`. |
| **F-006 doc half** | Say that ICU format suffixes are frontend-only (if P7 takes fork (b)). |
| **F-020 doc half** | `audience:` exists in the grammar (`ddd.langium:182`) and **nowhere in `docs/auth.md`**. |
| **F-012 doc half** | Decide and state the ownership model — see below. |

---

### Not a wave — the one that needs a product decision, not an agent

**F-012 · hand-edits are silently overwritten; `.loomignore` freezes the file**

This is the only structural finding in the register, and it is **not an agent-sized fix**.
A hand-edit is deleted on regenerate with no warning (`Wrote 1 file(s)`); pin it and the
next model change leaves it stale and produces 11 `tsc` errors. Three coherent exits:

1. **Own the compiler framing.** Rewrite the README's "The keys to the codebase" / "All the
   source you'd write by hand" to say the generated tree is build output and must not be
   edited; emit a `.gitignore` that reflects it (keeping `.loom/snapshots/` — deleting it
   correctly refuses with *"Restore the snapshot from version control"*). **Cheapest, and
   it is what the product already is.**
2. **Warn on clobber.** Hash each emitted file at write time; on the next generate, if a
   file differs from what was last emitted, refuse (or warn) instead of overwriting. Small,
   and removes the *silent* half without promising a merge.
3. **Build a real escape hatch** — protected regions or a per-file three-way merge.
   Expensive, and in tension with "derive, don't stamp".

Option 2 is the highest value-per-unit-of-work and can be a packet
(`src/cli/main.ts` write plan + `--dry-run` already has the reporting surface).
Option 1 is free and should happen regardless.

---

## 4. Sequencing constraints

```
P0 (corpus + compile gate)
   └── before every other packet
       "Eleven of these were invisible because no gate reached the shape. A packet that
        lands before the gate cannot be mutation-proved and will be re-litigated."

P1 (validator gates)
   └── after P0, and after maintainer PRs #2913/#2915/#2916 land or are claimed
       "Same family (a repository read escaping its legal context). Extend, don't duplicate
        — the repo's own draft-PR claim protocol."

RC-1 four arms (inside P2/P3/P4/P5)
   └── land together, behind one IR predicate
       "Four emitters independently hardcode `private`. Fixing three leaves the fourth
        divergent, which is how the class survived this long."

P7 (expr-icu) fork decision
   └── before P7 code, and before P13's ICU doc row
       "docs/new-plan/T1 says the backend pass-through is deliberate. Implement or refuse —
        but the docs must match whichever is chosen."

P8 (angular-forms)
   └── independent; ship early
       "One function, one branch. The fix is already described in its own comment for the
        neighbouring `X id` case."

P3 F-019 (CA1711)
   └── after P0's dotnet leg runs `-warnaserror`
       "Otherwise the suppression cannot be shown to be load-bearing."

P13 (docs-truth)
   └── merge last
       "Its ICU and ownership rows depend on decisions taken in P7 and the F-012 fork."
```

---

## 5. Expected effect on the verdict

The evaluation's recommendation was **"Pilot on a non-critical project only"**, with five
named conditions. This plan maps onto them:

| Condition (from the report) | Closed by |
|---|---|
| 1. `generate` proves the output compiles | **P0** |
| 2. The SILENT class is empty, gated by a *realistic* corpus | **P0 + waves 1–3** |
| 3. A stated answer for hand-written code | **the F-012 decision** (option 1 free, option 2 small) |
| 4. Versioning exists (zero releases today) | outside this plan — a release process, not a packet |
| 5. Bus factor above one | outside this plan |

Waves 0–3 would close conditions 1–3 and move the verdict to **"Adopt with conditions"**.
Conditions 4 and 5 are organisational and no amount of agent throughput touches them —
worth saying plainly, because the register's bug count is *not* what is holding the
verdict down on its own.

---

## 6. Fleet execution notes

- **13 packets, max parallelism 7** (wave 1). Wave 0 is a hard serialisation point.
- Every packet opens a **draft PR first** naming its `fileTrees`, per the repo convention —
  the collision protocol matters more than usual here because P7's leaf lines sit inside
  P2–P6's trees.
- **Every packet re-verifies on fresh `main` before building.** Four of these findings
  overlap in-flight maintainer work (#2911, #2913, #2915, #2916); at this commit cadence
  (~62/day in the window I measured) a day-old base is a stale base.
- **Every packet states its mutation proof in the PR body** — revert the fix *by file copy*,
  show the gate red, restore. A green first run proves nothing.
- **Do not batch the S3s into the S1 packets.** F-015 and F-019 are cosmetic-but-gating; if
  they ride a large packet they will be dropped when it runs long.

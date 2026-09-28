# Commons evaluation register audit (key: commons)

Checked on `main` @ d2a0bc02, 2026-09-28. The `out/` build was **stale** (dated 2026-09-21; `src/` newer). I re-ran `npm run build` before any repro, because the stale build still showed F-005's crash.

**Scope.** The register of record is `docs/audits/2026-09-13-commons-dev-experience.md`, which has the only status column. `eval/FINDINGS.md` holds F-001..F-022 with no statuses and no F-023. `eval/EVALUATION-REPORT.md` and `eval/EVAL-LOG.md` are pre-fix snapshots.

Despite their location, `eval/evidence/` and `eval/matrix/` belong to the **FieldOps** audit (`eval/fieldops-audit/`), not Commons (see Top problems #6). `eval/fieldops/` has only `.ddd` files and no register.

Repro outputs are under `scratchpad/review/tmp-commons/`.

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-001 | S1 | #2925 merged | FIXED-VERIFIED | Regenerated a two-context model across 5 backends × react/vue/svelte/angular (`f1all.ddd`). `MoneyResponse` is emitted in both .NET namespaces. Each frontend `beta.ts` declares its own `MoneySchema`/`MoneyResponse`. Node imports `Money`, and Java has `update(Money price)`, which also covers the subdomain `indexMembers` root cause. Test: `test/generator/cross-context-value-object.test.ts`. | Feliz and flutter were never checked for this row. |
| F-002 | S2 | ceiling | DECLINED | Home feed is an expressiveness ceiling, adjudicated in the audit. | — |
| F-003 | S1 | #2927 merged | FIXED-VERIFIED | `src/ir/validate/checks/e2e-route-checks.ts` adds `loom.e2e-unrouted-verb#create`. Test: `test/ir/e2e-route-contract.test.ts`. | — |
| F-004 | S3 | #2927 merged | FIXED-VERIFIED | `test/system/generated-vitest-projects-self-contained.test.ts`; baseline `e2e/vitest.config.ts`. | — |
| F-005 | S1 | "claimed by #2871" | FIXED-VERIFIED (crash turned into an honest refusal); register status stale | #2871 merged (3ff21f7b). `find all(): T[] requires CanManage()` with any of react/vue/svelte/angular now gives `loom.page-gate-not-client-evaluable`, exit 1, no throw. The inline `currentUser.permissions.contains(permissions.manage)` form now generates on all four. Test: `test/ir/page-gate-client-evaluable.test.ts`. | The register still says "claimed", not merged. The named-policy page gate stays unsupported, but it is refused honestly. `docs/scaffold-macros.md` §282 still leads with the named-policy spelling. |
| F-006 | S2 | open (posture) | DECLINED (weakly adjudicated) | `docs/auth.md:52` documents the carve-out. The F006 repro gives 0 errors. Only `loom.default-deny-by-id-ungated` warnings fire, for by-id reads. | 1. No decision record exists; the only adjudication is a one-line cell in the audit. 2. `denyByDefault` became the **language default** on 2026-09-28 (T3-done, wave C5 5d), so this carve-out now applies by default. 3. The by-id route gets a warning while the injected `findAll` gets **nothing**. Worth a mission or at least a warning parallel to by-id. |
| F-007 | S3 | #2924 merged | FIXED-VERIFIED (docs) | README §License (L397-410) now says `generate` deliberately writes no LICENSE and the grant lives in the licence FAQ. | Fixed by correcting the claim, not by emitting a LICENSE file. |
| F-008 | S2 | open (design) | OPEN-UNTRACKED (partly mitigated) | `src/cli/main.ts:971` now names locally modified files ("pinnable via .loomignore"; the hash manifest from the #2948 plan). Ignored paths are still only counted (`skippedByIgnore`). There is no staleness check for pinned files, and no mission in `docs/new-plan`. | The audit wording "clobbered without warning" is now outdated. The stale-pin detector (the F-008 core) was never missioned. |
| F-009 | S2 | open (feature) | OPEN-UNTRACKED | No `SET SCHEMA` or context-move support in `docs/migrations.md` or `migrations-builder`. No mission. | Called a "feature", but no feature mission exists. |
| F-010 | S3 | #2924 merged | FIXED-VERIFIED (docs) | `docs/resources.md:119-137`, `docs/architecture.md:89`, `docs/language.md:247` now say "parse but bind to nothing". | The search capability itself is still absent (a ceiling). |
| F-011 | S3 | #2924 merged (+#2873) | FIXED-VERIFIED | `user { id: string, role: string }` parses OK. `language.md:332` now documents that the retrieval clauses take no commas. No `carries: [` left in docs. | — |
| F-012 | S2 | ceiling | DECLINED | Adjudicated as a ceiling. The related `exists <Aggregate>` quantifier (T3 item 5) is "deferred, not started". | — |
| F-013 | S1 | #2926 merged | FIXED-VERIFIED | The inline form is now refused: `loom.workflow-foreach-source`, `loom.workflow-inline-repository-call`. The let-bound form generates on elixir (`Enum.reduce_while` in `on_post_published.ex`) and on node/java/python/dotnet. Test: `test/ir/workflow-reactor-body-validated.test.ts`. | The `dispatch-emit.ts:1136` raw throw is still present as the default arm, now unreachable for `for-each`. |
| F-014 | S1 | #2923 merged | FIXED-VERIFIED | `Money`/`Card`/`Table`/`Badge`/`Stat` all raise "missing required field: currency". Test: `construction-primitive-name-collision.test.ts`. | The amplifier (the generated node Dockerfile never runs `tsc --noEmit`; eval condition C5) is **still true**: the Dockerfile runs only `npm run build` (tsup). It is untracked; see extra rows. |
| F-015 | S1 | #2923 merged | FIXED-VERIFIED (holder only) | `public sealed class __State` in `Thing.cs`. Test: `state-field-holder-collision.test.ts`. | Sibling collision still open; see D-2. |
| F-016 | S1 | #2927 merged | FIXED-VERIFIED | Emits `tags: new FormControl<string[]>([], …)`. Test: `ref-collection-form-control.test.ts`. | — |
| F-017 | S3 | #2924 merged | FIXED-VERIFIED | `src/cli/main.ts:1464-1490`: missing evidence fails by default (`--allow-missing` to opt out), and `--from-vitest` was added. Tests: `test/cli/verify-cli.test.ts`, `test/verify/from-vitest.test.ts`. | — |
| F-018 | S3 | open | OPEN-UNTRACKED | Generated `tsup.config.ts` has `sourcemap: true`, but the Dockerfile runs `node dist/index.js` without `--enable-source-maps`. `src/trace` has no bundle-map resolution (only the diagnostic at `main.ts:1605`). No mission. | coverage.md calls it "the only genuinely open row" but gives it no mission id. |
| F-019 | S2 | "docs" | OPEN-UNTRACKED | README L10 "No drift between layers" and L217 "Identical API contracts" are still unqualified. No README qualification mission. | The status "docs" implies it was dispositioned; nothing changed. |
| F-020 | S1 | #2925 merged | FIXED-VERIFIED | `PersonResponse.java` imports `java.util.Objects`. Test: `test/generator/java/field-mask-java.test.ts`. | — |
| F-021 | S1 | #2926 merged | FIXED-VERIFIED | Inline form refused (as F-013). Let-bound form: Java injects `NoteRepository` and emits `for (var f : fs)`. | The feliz half is covered by F-023 and F-022. |
| F-022 | S1 | #2923 merged | FIXED-VERIFIED (F# only) | `` ``member``: string `` in `App.fs`; `` ``yield`` `` also escaped. Test: `fs-keyword-field-names.test.ts`. | The root cause the audit names (no per-target reserved-word map) is fixed only for F#; see R-1. |
| F-023 | S1 | #2923 merged | FIXED-VERIFIED | Test: `test/generator/feliz/workflow-instance-model-fields.test.ts`. | Missing from `eval/FINDINGS.md` and from the audit header tallies. |
| D-1 (deferred: `crudish, auditable` → Java `UserId`) | — | "deferred, wants own issue" | FIXED-VERIFIED; register stale | #2960 (7ad0acd0, 2026-09-14). The repro now gives `loom.stamp-principal-without-auth` without `user {}`, and `String createdBy` with it. | The audit still lists it as not fixed. |
| D-2 (deferred: other .NET entity-member collisions) | — | deferred | OPEN-UNTRACKED | Field `assertInvariants: string` → generate 0 errors → `Thing.cs:16` property `AssertInvariants` plus `:47` method `AssertInvariants()` in the same class (CS0102). `create`/`version` are refused. `loom.dotnet-name-collision` does not cover it. No mission. | Low likelihood, but a silent defect. |
| D-3 (deferred: workflow-only cross-context VO on java/elixir) | — | deferred ("known gap in #2925") | Java: not reproduced (`BillingState` has `@Embedded Money`, shared `domain/valueobjects`). Elixir: OPEN-UNTRACKED and broader than filed | `wfvo.ddd` and same-context `wfvo2.ddd`: `billing_state.ex` has `field :total, :string`, but the migration creates `total_amount`/`total_currency` columns. The schema/table mismatch appears even with the VO in the **same** context. | Static evidence only (no mix/boot). Not cross-context specific: an elixir workflow state with a VO field is miswired. |
| D-4 (deferred: `workflow-foreach-unknown-binding` false positive) | — | deferred | FIXED-VERIFIED | b383852a (2026-09-20, FieldOps wave 4). Loop-body `let n = Note.create(...)` validates clean. | Fixed under another register's F-002; the audit was not updated. |
| D-5 (VO captured the walker primitive in lowering) | — | fixed in #2925 | FIXED-VERIFIED | Stated fixed in #2925; consistent with the F-014 probes. | — |
| R-1 (root cause: target-language reserved words) | — | "highest-leverage fix" | OPEN-UNTRACKED | `kw.ddd` fields `lambda`/`def`/`pass` → generate 0 errors → `py_compile`: `app/http/thing_routes.py:25 def: str — SyntaxError` (5 files for `pass`). Elixir emits `record.end` (unverified). | Only F# (F-022) and the .NET holder (F-015) were fixed. Open draft #3063 widens *Loom*-keyword field names, which makes more target-keyword names reachable, and does not add target escaping. |
| X-1 (F-014 amplifier / eval C5) | — | not in register | OPEN-UNTRACKED | Generated `api_node/Dockerfile` runs `npm run build` (tsup, `dts: false`) with no `typecheck` step. | Eval top-10 fix #3; never missioned. |

## Tally / claim problems

- **Audit header is out of date.** It says "22 findings, S1 ×10 … SILENT 12". The register table has **23 rows** (F-023, S1, SILENT), so S1 should be 11.
- **Class labels disagree.** The table labels F-007 and F-011 as SILENT (15 SILENT rows), while the header counts them as "docs-vs-reality 2".
- **coverage.md:235 is also off.** It says "23 findings — S1 x10"; that should be S1 x11.
- **"F-018 is the only genuinely open row" is false.** F-008, F-009 and F-019 are open with no mission. F-006's "posture" ruling now bites harder under the new `denyByDefault` language default.
- **Stale statuses.** F-005 ("claimed by #2871"; merged). D-1 is fixed by #2960 and D-4 by b383852a, but the "deliberately NOT fixed" table still lists both as unfixed.
- **Broken references.**
  - `eval/FINDINGS.md` (7 references) and `EVALUATION-REPORT.md` cite `eval/commons/`, `eval/probe/`, `eval/adversarial/`, `eval/evo/` and `eval/phase0/readme-quick.ddd`, none of which exist.
  - `eval/evidence/README.md` belongs to FieldOps. It uses FieldOps numbering (F-020 = minio, F-034, F-035), which clashes with Commons F-020 (Java `mask`). It also lists `F-035-java-Thing.java`, which is absent.
  - `eval/fieldops-audit/README.md` links `matrix/` and `evidence/` relative to itself, but those directories live at `eval/matrix` and `eval/evidence`, so the links are broken.

## Top problems

1. **R-1 is the one systemic fix left undone.** Python keywords as field names (`def`, `lambda`, `pass`) produce SyntaxError output with a clean generate, and nothing tracks it. #3063 will make more such names declarable.
2. **Elixir workflow state with a value-object field.** The Ecto `field :x, :string` does not match the migration's flattened `x_amount`/`x_currency` columns. This is deferred item D-3, is broader than filed, and is untracked.
3. **F-006 now applies by default.** With `denyByDefault` the language default, the injected `findAll` list route is open and gets no diagnostic, while by-id reads do get one. The "posture" ruling has no decision record.
4. **F-008 stale-pin detector, F-009 context move, F-018 bundle trace, F-019 README qualification and X-1 (tsc in the node Dockerfile).** All are acknowledged as open, and none has a mission.
5. **Register hygiene.** The header tally excludes F-023, coverage.md says S1 x10, and the F-005/D-1/D-4 statuses are stale.
6. **FieldOps and Commons artefacts are mixed in `eval/`.** They clash on IDs, and several path references are dead.

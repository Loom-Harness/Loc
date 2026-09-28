# fieldops-audit register — true status on main d2a0bc02 (2026-09-28)

Scope: `eval/fieldops-audit/` (FINDINGS.md, FIX-PLAN.md, fix-plans/A..J, EVALUATION-REPORT.md, EVAL-LOG.md, README.md).
The fixes landed in **PR #2911** (merged 2026-09-22, branch `claude/loom-dsl-evaluation-67vd8s`; waves 0–5), plus independent fixes by other tracks.

Method notes:
- **The `out/` CLI build was stale** (built 2026-09-21, before #2911 merged). The first repro pass on it wrongly showed F-002, F-003 and F-004 as still broken. Every result below comes from a fresh `npm run build`.
- The repo is a shallow clone, so some older commits can't be cited. F-ids collide with two other registers (`eval/FINDINGS.md` for Commons, and `eval-fieldops/` for #2980). Every commit match was checked by its content, not only by the F-id in its message.
- All repros are in `eval/repro/*.ddd` and were re-run with `parse` or `generate system`. Scratch output is in `scratchpad/review/tmp-fieldops-audit/`.

## Findings table

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-001 starter warns on own output | S4 | "claimed #2874" (no update block) | FIXED-VERIFIED | #2874 merged 09-22. `ddd new --template crud` → `parse` gives 0 errors, 0 warnings | Register never updated |
| F-002 `let` in `for` body | S2 | FIXED (09-20) | FIXED-VERIFIED | b383852a (#2911). `wf-for-let-b.ddd` has no `workflow-foreach-unknown-binding` | Only shows as fixed on a fresh build |
| F-003 `this.id` in criterion | S3 | FIXED | FIXED-VERIFIED | 95e38561. `wf-for-let-e.ddd` no longer raises `retrieval-where-unknown-field` | |
| F-004 `transactional-no-effect` false positive | S3 | live (FIX-PLAN #19, wave 4) | **OPEN-UNTRACKED** | `wf-for-let-f.ddd` and `java-missing-repo-injection.ddd` (op-call in `if let` in `for`) still warn. A `for … { emit … }` body also still warns. `workflow-checks.ts:949` is unchanged. `api-checks.ts:23 forEachStmtDeep` is still hand-rolled | Planned for wave 4. The #2911 PR body and FIX-PLAN §0 never mention it again. No mission, no PR |
| F-005 no-create → read-only API | S3/S2 | FIXED; general check "MEASURED AND REJECTED" | FIXED-VERIFIED + WRONG-CLAIM | `loom.tenant-registry-not-constructible` fires on `tenancy-bootstrap.ddd`. `docs/tenancy.md:39` has `with crudish` | The "rejected" general check has since **landed** as a suggestion: `loom.aggregate-not-constructible`, commit 7d8cc551 (2026-09-27). It prints on almost every repro |
| F-006 create params ignored | S3 | claimed #2861 / M-T5.32 | OPEN-TRACKED (M-T5.32, `open`, blocked on #2882) | `create-params-not-wire` fires (#2861). But the residual `create(name, n)` on `{ name }` is still 0 warnings (n dropped). `docs/language.md:447` still says "the POST route takes its params" | The doc half named in FIX-PLAN §3.6 #34 was not edited |
| F-007 create body can't assign | S2 | HONEST ceiling | DECLINED/BY-DESIGN | Still `loom.lifecycle-body-dropped`. `docs/language.md:447` now leads with "the body is INERT". M-T3.16 closed (T3-done) without rendering assigns | FIX-PLAN never dispositions it (0 mentions) |
| F-008 crudish ⊥ denyByDefault | S2 | claimed #2877 | FIXED-VERIFIED | #2877 merged 09-13. The diagnostic now points at `with crudish(requires: <Policy>)` | Register not updated |
| F-009 cross-context workflow repo | S2 | CORRECTION: worse, open | FIXED-VERIFIED | 4bf0405d2 "A workflow reading another context's repository is refused, consistently". Both the read-only and mutating forms → `loom.workflow-cross-context-repository`. `docs/domain-services.md` is corrected | Register still has only the 09-13 correction |
| F-010 denyByDefault forces deprecated `find all` | S3 | claimed #2874 | FIXED-VERIFIED | #2874 merged. `nullable-claim-find.ddd` no longer warns "wire-shaped list query" | Register not updated |
| F-011 page `requires permissions.x` crash | S2 | FIXED | FIXED-VERIFIED | `page-gate-permissions.ddd` generates (82 files) | |
| F-012 multi-word e2e slug crash | S2 | FIXED | FIXED-VERIFIED | `e2e-multiword-slug.ddd` generates e2e | The fuzz "second deployable + test e2e" (M) is not done — see plan items |
| F-013 `ne()` un-imported | S1 | FIXED | FIXED-VERIFIED | `ne-import-missing` repo file imports `ne` | |
| F-014 FK vs nullable claim → bad Drizzle | S1 | live (FIX-PLAN #2, wave 2) | **OPEN-UNTRACKED** | Generated `workOrder-repository.ts:99` is byte-identical to the finding: `eq(schema.workOrders.technicianId, currentUser.technicianId)` with `technicianId: Ids.TechnicianId \| null` (`auth/user-types.ts:11`) | Wave 2 in #2911 silently dropped it. #2945 covers other currentUser-filter cells, not this one |
| F-015 workflow calls private `function` (node) | S1 | live; §3.5 recommends ruling (A) refuse | FIXED-VERIFIED (by ruling B) | 78358a8ca / **#2974**: `function` emitted public on all 5. Repro → node `public hasSkill`, dotnet/java public, python `def has_skill`, elixir `Context.has_skill(t, …)` | FIX-PLAN §3.5 is not updated with the opposite ruling |
| F-016 reserved-word op → `const void` | S1 | FIXED | FIXED-VERIFIED (TS); **python half OPEN-UNTRACKED** | React emits `const void_`. But `operation class()` on python → `def class(self)` (`app/domain/invoice.py:41`), a SyntaxError, with 0 diagnostics | FIX-PLAN #11 promised "two PRs, one per language". The python PR never happened. #3063 is about DSL keywords, not target keywords |
| F-017 mantine Chart `{{{` | S1 | fixed in FIX-PLAN §0 only | FIXED-VERIFIED | No `{{{` in `chart-triple-brace` output. `tsx-parse-gate.test.ts` exists | FINDINGS has no fix note |
| F-018 declared `find all(): T[]` breaks picker | S1 | live (FIX-PLAN #13, wave 2) | OPEN-TRACKED (#2942, open, updated 09-22) | `paged-vs-array-picker`: `CustomerListResponse = z.array(...)` but `new.tsx:48` reads `__customers.data?.items` | Wave 2 silently dropped it. Tracked only by an open PR |
| F-019 ui scaffolds unserved subdomain | S1 | FIXED (more general) | FIXED-VERIFIED | `generate` exits 1 with "12 error(s), 2 warning(s) in generated pages" | Landed as a generate-time check. FIX-PLAN #15's phase-⑦ error was not built (`parse` is still 0 errors) |
| F-020 minio image gone | S2 | FIX-PLAN §0 only | FIXED-VERIFIED | `src/system/index.ts:1283 quay.io/minio/minio`. `compose-images.test.ts` | FINDINGS has no note |
| F-021 dev-claims doc says raw JSON | S3 | FIX-PLAN §0 only | FIXED-VERIFIED (doc) | `docs/auth.md:1056` says base64 | The residual FIX-PLAN §3.6 #31 flagged is still there: malformed header → silent fallback to the base identity (`hono/v4/auth-emit.ts:118 catch { return base; }`). Untracked |
| F-022 realm has no claim mappers | S2 | FIXED | FIXED-VERIFIED | `src/system/index.ts:1071` mapper per claim. `auth-claim-path-parity.test.ts` | Residual "seeded tenantId has no registry row" is untracked |
| F-023 OCC If-Match never sent | S2 | FIXED (wave 5) | FIXED-VERIFIED (4 frontends) | ad92e91b, 591b7a51. `web/src/api/client.ts:166` sends If-Match | Residual: feliz and flutter do not send it. Named in #2911 but no mission. Angular `ng build` was never run |
| F-024 offline_access + post-login 404 | S1 | FIXED | FIXED-VERIFIED | `index.ts:1148` realm role `offline_access`; `:1482 OIDC_POST_LOGIN_REDIRECT` | FIX-PLAN §5.5's full code-flow gate is not built. The e2e tests only smoke-check `/auth/login` |
| F-025 .NET `Api.Api` namespace | S1 | FIX-PLAN §0 only | FIXED-VERIFIED | `global::Api.…` in the output. `dotnet-namespace-qualification.test.ts` | FINDINGS has no note |
| F-026 private fn on .NET/python | S1 | live (blocked on §3.5) | FIXED-VERIFIED | #2974 (see F-015) | FINDINGS not updated |
| F-027 python cross-context id import | S1 | FIXED | FIXED-VERIFIED | `bar_routes.py:13 from app.domain.ids import BarId, FooId`. `python-symbol-resolution.test.ts` | |
| F-028 java repo in `if let` not injected | S1 | FIXED | FIXED-VERIFIED | `java/emit/workflow.ts:196 walkWorkflowStmtsDeep` | |
| F-029 elixir currentUser find unbound | S1 | live (FIX-PLAN #6) | FIXED-VERIFIED | Output `thing_repository.ex:79-80 def mine(current_user \\ nil) … ^(current_user && current_user.owner_tag)`. Corpus `principal-read-filter.ddd` (173035fee) | Fixed by another track. Register not updated. #2945 (open, dirty) still describes elixir find cells as broken |
| F-030 elixir `--warnings-as-errors` | S3 | CORRECTION + §0 fixed | FIXED-VERIFIED | `elixir/vanilla/gate.ts`; `vanilla-compile-hygiene.test.ts` | FINDINGS has no fix note |
| F-031 Feliz design fixit | S3 | CORRECTION: text fixed, no code | FIXED-VERIFIED | `loom.design-theme-unknown` coded (`deployable.ts:480`, catalog entry) | The "no code" half closed through M-T9.56. Register still says codeless |
| F-032 vue nullable IdLink | S1 | FIXED #2885 | FIXED-VERIFIED | per register. Vue gate covers `id-ref-optional` | |
| F-033 angular `string[]` null | S1 | FIXED | FIXED-VERIFIED | `tech-new.component.ts:37 new FormControl<string[]>([]` | `ng build` not verified locally |
| F-034a decimal 2 vs 2.0 | S2 | WITHDRAWN | DECLINED/WONTFIX | Adjudicated tolerance (`wire-record.ts`, `numeric-codec.ts`) | |
| F-034b python echoes regex message | S2 | live (FIX-PLAN #10, §5.7) | **OPEN-UNTRACKED** | A message-less `matches` → `Field(pattern=…)` (`cust_routes.py:42`). `problem.py` returns `str(e["msg"])` (pydantic text). Node uses `singleFieldMessage`. `validation-messages.ddd` has no `.matches(` rule | Close by: wave-C5 5b handoff decided a *domain-floor* message-less rule uses "each backend's default". That is not the wire rung, so there is no ruling for this case |
| F-035 .NET drops 2nd onCreate stamp | S1 | CORRECTION + §0 fixed | FIXED-VERIFIED | `AuditableInterceptor.cs:43-46` stamps TenantId, DataKey, CreatedAt, CreatedBy | FINDINGS has no fix note |
| F-036 string→enum no migration | S2 | live (agent I) | FIXED-VERIFIED (partial) | 4f7621a5a. The v1→v2 regenerate emits `…_add_check_wos_currency_enum.sql` `CHECK … NOT VALID` | Legacy rows are still not validated (NOT VALID; the SQL comment says so). Not in FIX-PLAN at all |
| F-037 hand edits overwritten | S2 | DOCUMENTED | OPEN-TRACKED (partial fix) | cf6b6afd: generate now reports "N of which had local modifications" (`cli/main.ts:971`). Still no backup | #2948 (draft, stale 09-21) claims it. Not in FIX-PLAN |
| F-038 no lockfile, carets | S2 | measured, NOT landed ("not an evaluator's call") | **OPEN-UNTRACKED** | No mission in `docs/new-plan` for generated-project lockfiles or pinning | Deferred to maintainers, but no mission was ever minted |
| F-039 no toolchain versioning | S2 | observation | OPEN-TRACKED (M-T8.24 `open`) | `package.json` is still 0.1.0. M-T8.24 "Loom cannot be installed: the release surface" | Not in FIX-PLAN |
| F-040 cyclic containment crash | S2 | FIXED | FIXED-VERIFIED | `Child → Child` cycle → "Cyclic containment…" error. `test/ir/containment-cycle.test.ts` | Fixed twice (7ddfb4a7 merge note) |
| F-041 page-body typo unvalidated | S3 | re-verified, NOT landed | OPEN-TRACKED (M-T5.33 `partial`, #3050 landed `of:` half) | `broken/b09-page-wrong-aggregate.ddd` → 0 errors | Phoenix `KeyError` half is still live |
| F-042 trace blind in prod | S3 | FIX-PLAN §0 only | FIXED-VERIFIED | `hono/v4/emit.ts:2127 CMD ["node","--enable-source-maps",…]` | |
| F-043 README 404 links | S3 | FIX-PLAN §0 only | FIXED-VERIFIED | No `lemmit.github.io` in README/docs/src. Denylist in `archived-docs-fence.test.ts` | |
| F-044 i18n translations never reach frontend | S2 | live | OPEN-TRACKED (#2969 draft, stale 09-21) | `ddd i18n init … de` then `generate` → `web/src/locales/` has only `en.json` | No new-plan mission |
| F-045 README LICENSE claim | S3 | CONFIRMATION (fixed) | FIXED-VERIFIED | README:405-413 corrected | |
| F-046 auditable without auth → unbound currentUser | S1 | fixed (in body) | FIXED-VERIFIED | `with crudish, auditable` on a no-auth node deployable → `loom.stamp-principal-without-auth` error | |
| F-047 122 codeless diagnostics | S2 | ratchet landed; "migration NOT landed, mission-sized" | FIXED-VERIFIED + WRONG-CLAIM | M-T9.56 `done` (wave C4 4c, 128 → 0). `diagnostic-code-coverage.test.ts` BASELINE is 0 for both layers | The register still says the migration is open |
| F-048 vacuous parse asserts | S2 | FIXED | FIXED-VERIFIED | `test/system/vacuous-parse-assertion.test.ts` | |
| F-049 six doc fences don't parse | S3 | FIXED | FIXED-VERIFIED | `test/system/first-run-examples-parse.test.ts` (README + every `docs/` .md) | Contradicts FIX-PLAN §5.6 "not landed" |
| F-050 claim path read two ways | S1 | FIXED | FIXED-VERIFIED | Shared `claimPathFor`; `test/generator/auth-claim-path-parity.test.ts` | |

### FIX-PLAN plan items (non-finding)

| item | true-status | evidence |
|---|---|---|
| §5.1 fuzz: multi-word names, `api` deployable name | landed (#2911) | per PR body |
| §5.1 second deployable + `test e2e` in generator (F-012 reach, M) | OPEN-UNTRACKED | "still open" in §5.1. No mission |
| §5.1 deep leg nightly + `divergence` rung | OPEN-UNTRACKED | No workflow runs the deep fuzz leg (grep `.github/workflows`). No mission |
| §5.2 field-shape matrix | landed | `frontend-field-shape-coverage.test.ts`. **Debt still waived:** vue `decimal, datetime, scalar-array, file`; svelte `id-ref-optional, scalar-array`; angular `id-ref, id-ref-optional, file`. Untracked |
| §5.3 module-symbol sweep — "no unresolved-symbol-gate mission anywhere … this is that missing mission" | python only (`python-symbol-resolution.test.ts`); the cross-backend mission was **never minted** | grep new-plan: none |
| §5.4 TSX parse gate | landed | `tsx-parse-gate.test.ts` |
| §5.5 image existence leg | landed | `compose-images.test.ts` |
| §5.5 real OIDC code-flow gate | OPEN-UNTRACKED | e2e only smoke-checks the `/auth/login` redirect |
| §5.6 link half + fence validator | both landed | fence validator = `first-run-examples-parse.test.ts`. FIX-PLAN still says "Not landed" |
| §5.7 corpus fixtures (`matches` without message, `requires true`, `for`×`if let`, #2864 D2–D4 ts-build fixture) | mostly OPEN-UNTRACKED | Corpus has no `.matches(` rule and no `requires true`/`if let` fixture. Only the currentUser-find fixture landed |
| §5.8 widen ir-walk-census to non-chained `if` ("mint it as its own mission") | OPEN-UNTRACKED | The census still detects only switch/else-if chains. No mission |
| J-docs code-side find: `apply Opened {…}` typo → raw TypeError | **OPEN-UNTRACKED** | Reproduced on main: `TypeError … at lowerApply (lower-members.js:32)`. Never promoted into FIX-PLAN |
| J-docs: `.loom/asyncapi.yaml` undocumented | partially fixed | In `language-reference/14-…:444`. Still missing from `docs/loom-artifacts.md` |
| B/E: java keyword diagnostic "advertises python as safe" | moot | java now escapes identifiers (`java/java-ident.ts`). The python half is still broken (F-016) |

## Top problems

1. **Four live defects with no tracker.** F-014 (node S1, uncompilable Drizzle, output byte-identical to the filing), F-004 (validator false positive, exact repro unchanged), F-034b (python leaks the regex in its 422 message) and the F-016 python half (`def class(self)`, SyntaxError). Waves 2 and 4 of #2911 dropped them without a word, and FIX-PLAN §0 still implies they are planned.
2. **Four more with no tracker:** F-038 (lockfiles; "a maintainer's call", but no mission was minted) and three residuals: J's `apply` TypeError crash, F-021's silent dev-claims fallback, and F-023 on feliz/flutter.
3. **The register's status layer is stale:**
   - Header: "45 findings / 43 live / 16 S1 · 2 withdrawn or fixed". The body holds **50** findings (F-046–F-050 added), **18 S1**, and ~39 are fixed on main.
   - About 15 fixed findings have no fix note in FINDINGS: F-001, F-008, F-009, F-010, F-015, F-017, F-020, F-025, F-026, F-029, F-030, F-035, F-036, F-042, F-043.
   - FIX-PLAN says "wave 0 implemented; waves 1–5 still plans" and "nothing modified, no PR opened" (§6; README says the same). Waves 0–5 all merged in #2911.
4. **Claims contradicted by later work:**
   - F-005 "general check rejected": `loom.aggregate-not-constructible` has since landed (7d8cc551).
   - F-047 "migration not landed": drained to 0 by M-T9.56.
   - §5.6 "fence validator not landed": it did land.
   - §3.5 recommends ruling (A); #2974 shipped ruling (B).
5. **FIX-PLAN §3.0 "Disposition of all 45"** never dispositions F-007, F-036, F-037 or F-039 (0 mentions in FIX-PLAN).
6. **EVALUATION-REPORT** gap register and target matrix are frozen at 09-13 (only F-032 marked fixed). A council reader sees 15 live S1s where about 2 remain (F-014, F-016-python).
7. **Broken relative paths.** README/FINDINGS/FIX-PLAN link `eval/fix-plans/`, `fieldops/`, `repro/`, `matrix/`, `evidence/`, `repatch.sh` and `phase0/` relative to `eval/fieldops-audit/`. Those artefacts live one level up in `eval/`, and no doc gate covers `eval/`.
8. **Process hazard:** the shared `out/` CLI build was a week stale. Any auditor re-running repros without `npm run build` gets false "still broken" results for F-002, F-003 and F-004.

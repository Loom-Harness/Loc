# Testability audit cluster: status on main d2a0bc02 (2026-09-28)

Scope: `docs/audits/2026-09-13-testability-audit.md` (F1-F12), `2026-09-14-testability-fleet-plan.md` (P1-P11, D-1..D-4), `2026-09-14-p3-e2e-payload-sweep.md`, `2026-09-09-verification-fleet-plan.md` (its tiered items and six decisions), `docs/new-plan/missions/field-test-2026-09-register.md` (13 M-FT ids), and M-T5.36.

How I checked: I re-ran the repros under `scratchpad/review/tmp-testability/` and ran the 9 pinning test files (153 tests, all green). I also read the PR bodies for #2949, #2956, #2957, #2959, #2962, #2967, #2968 and #2991, and grepped the emitters, validators and plan files.

## Testability audit F1-F12 and fleet packets P1-P11

| id | sev | register status | true status | evidence | notes |
|---|---|---|---|---|---|
| F1 (P6) repo-read binding typed `string` in domainService | P1 | closed (#2968) | FIXED-VERIFIED | #2933 + #2968 (e616496d9); `test/ir/domain-service-repo-read-binding.test.ts` passes. My repro emits `f.length` / `len(f)` / `f.size()` / `Enum.count(f)` / `f.Count` for `.count` and `.length` on all 5 backends | |
| F1-c: invented member on an ARRAY receiver | P1 | fleet plan: "#2949's natural extension" | OPEN-UNTRACKED | `let f = Owners.byTier(t)  return f.totallyInvented > 0`: parse 0 errors, emitted verbatim on all 5 backends (`f.totallyInvented`, `f.totally_invented`, `f.totallyInvented()`). Also inside an aggregate: `derived bad: int = tags.bogus` becomes `return this._tags.bogus;` (TS2339) with 0 errors | #2968 body says #2949 cannot reach it: `envForNode` has no `DomainServiceOperation` arm (grep confirms 0 hits), and #2949 only gates PRIMITIVE receivers. #2949 is still an open draft, `dirty`, untouched since 09-14. No mission covers array receivers or the missing domain-service env arm |
| F1-adj: .NET CS8602 on a `getById` deref (#2968 out-of-scope note) | P2 | filed in PR body | FIXED-VERIFIED | #3035 (dbfec37b7) "getById is contractually non-null"; #3042 findById nullable gate | |
| F2 (P2) raw id/datetime literals in emitted unit tests | P1 | closed (#2957) | FIXED-VERIFIED | 4b4b76ecf; `src/generator/_test/arg-coercion.ts`; `test/generator/typed-literal-test-args.test.ts` passes; fixtures `ts-build/typed-test-literals.ddd` and `python-build/typed-test-literals.ddd` | The fleet plan's acceptance said the gate "must reach `web/src/examples/**`". #2957 fixtured the shape instead, so `sales-system.ddd` itself is still not in any per-PR typecheck. That was a deliberate substitution, argued in the PR, but the audit's cross-cutting point (the behavioral tier transpiles without typechecking) still stands for web examples. Java and .NET were not compiler-verified (PR admits this) |
| F2-r1: mypy `comparison-overlap` on an enum-progression test | P3 | #2957: "filed as a diagnosis… a separate mission" | OPEN-UNTRACKED | Regenerated on main: `assert wo.status == WoStatus.Scheduled; wo.complete(); assert wo.status == WoStatus.Completed` is the exact shape #2957 reproduced as a mypy error. Grep of docs/new-plan for "comparison-overlap" / "non-overlapping" finds 0 | Never missioned |
| F2-r2: Elixir pure core skips datetime coercion | P2 | #2957: "wants its own mission" | OPEN-UNTRACKED | Regenerated: `lib/d/ops/work_order.ex` `dispatch/2` does `at = Map.get(params,"at"); %{record \| dispatched_at: at}` (raw string), while `Ops.dispatch_work_order/2` coerces through `DateTime.from_iso8601` | No mission |
| F3 (P7) e2e suite not idempotent | P1 | coverage.md: "In flight #2967 + #2997" | FIXED-VERIFIED | #2967 (0f4d58dcb) + #2997 (c29c62f9a) are both merged. `test/system/e2e-state-reset.test.ts` passes. The baseline e2e has 6 `__resetState` calls; compose carries `LOOM_TEST_RESET: "1"`; `docs/tools.md` § "The e2e reset seam" exists | Default is per-file; per-test is opt-in via `E2E_RESET`. See WRONG-CLAIM W1 |
| F4 (P3) e2e payload unchecked | P1 | closed (#2958) | FIXED-VERIFIED | a3ea8bdcf; codes `loom.e2e-unknown-body-key` / `-missing-required-field` / `-body-type-mismatch` / `-unknown-response-field` are in messages.ts; `test/ir/e2e-payload-contract.test.ts` passes; the double-report was collapsed | |
| F4-lim: find/list/all query + envelope, `null`, `ui.` surface, `extends` subtypes not judged | P3 | sweep doc: "deliberately does NOT check" | DECLINED (named limitation) | p3 sweep doc § "What the gate deliberately does NOT check"; coverage.md row 234 | Named as the "obvious next" widening but has no mission. Fine as a limitation |
| F5 (P9) no workflow accessor | P2 | closed M-T5.37 | FIXED-VERIFIED | #2985 + #3002; `src/ir/util/e2e-workflow-accessor.ts`; `loom.e2e-*#workflow-run` messages | |
| F6 (P10) no principal clause in `test e2e` | P1 (auth) | owner-deferred | DECLINED | M-T5.37 design doc decision #2: "a gap, not a bug" | M-T5.19(b) (open, P2) still plans the `as`/`user`/`system` principal context from `test-authoring-language.md`, and `isolation:` (which overlaps F3's seam). Two plan entries describe the same surface with opposite postures |
| F7 (P5) ui `toThrow(422)` drops status and times out | P2 | closed (#2959) | FIXED-VERIFIED | 01cdc223f; `loom.e2e-ui-throw-invalid#status/#bare`; `test/system/ui-e2e-throw-backstop.test.ts` passes | Only React was browser-verified; the other frontends are covered by the descriptor flag |
| F7-r: a real UI negative matcher ("field shows error, page did not navigate") | P2 | D-3: "file the real matcher as its own mission"; #2959: "wants its own mission" | OPEN-UNTRACKED | Grep of docs/new-plan for such a matcher finds 0 missions | D-3's follow-up was never filed |
| F8 (P1) `verifies` join on e2e | P1 | closed (#2956) | FIXED-VERIFIED | 4298537d5; `src/verify/verification.ts` handles the ` against ` suffix and the `.ui.spec.ts` suite alias; `test/verify/e2e-title-join.test.ts` passes (15 tests); storefront went 1/4 to 3/4 per the PR | |
| F8-r: behavioral rollup still exits 0 on UNVERIFIED | P3 | audit: "broken join is silent by construction" | OPEN-UNTRACKED (low) | `test/behavioral/run.mjs:402` fails only on `reqFailing`; UNVERIFIED is printed but never gated | A future join regression is caught only by the unit pins, not by the DoD leg |
| F9 (P4) `auditable` + any frontend | P2 | closed (#2960) | FIXED-VERIFIED | 2b35b0139; `test/system/auditable-with-frontend.test.ts` (6 frameworks) passes | |
| F10 (P4, D-2) uuid 422 vs 404 | P2 | closed (#2962) | FIXED-VERIFIED | 6c2090f04; `src/util/uuid-wire.ts`, used by `hono/v4/emit.ts:384` (v5 reuses v4); `test/util/uuid-wire.test.ts` passes; the other 3 backends were measured permissive | |
| F11 (P11a/b) matcher catalogue | P3 | closed M-T5.37 | FIXED-VERIFIED (partial) | #2987 throw-kinds, #3001 `toBeNull`/`toBeAbsent`/`toContain`, all in `src/util/intrinsic-matchers.ts` | |
| F11-r: no emitted-event assertion, no object-equality matcher | P3 | coverage: "F11 closed" | OPEN-UNTRACKED | The catalogue has no event matcher (13 names in intrinsic-matchers.ts); the M-T5.37 design never mentions events; grep of docs/new-plan for `toEmit` / "event was emitted" finds 0 | The audit called the missing event matcher "notable, given events drive projections and sagas" |
| F12 (P8) no generated README | P3 | coverage.md: *not listed* | FIXED-VERIFIED | #2971 (904dbd0d3) + #2997; `test/system/readme.test.ts` passes; `test/fixtures/baseline-output/README.md` | See W2 |
| M-T5.36 optional/plural find bindings | P3 | open | OPEN-TRACKED | 3 codes still in `unsupported-register.ts`; T5-language-core.md:86 | |

## 2026-09-09 verification-fleet plan items

| id | sev | register status | true status | evidence | notes |
|---|---|---|---|---|---|
| F63 give-up routing glob | P0 | M-T9.55 done | FIXED-VERIFIED | T9 M-T9.55 `done` 2026-09-11 (#2843) | |
| F65 pr-gate "dropped dispatch" premise | P0 | M-T9.57 done | FIXED-VERIFIED | #2859 retired the branch-filtered claims; ci-gating.md:415 has the merge-API probe | Also settles decision 5 (#2832/#2835) |
| F64/F55 code-less diagnostics | P1 | M-T9.56 done | FIXED-VERIFIED | M-T9.56 heading: "zero do now" | |
| F66/F56 SPA async-effect gate | P0 | via M-T9.44 note | FIXED-VERIFIED | `store-checks.ts:537`: `loom.async-effect-subject-unsupported` runs `classifyFelizAsyncEffect` over every mounted ui | The `Promise.reject("no remote op…")` fallback still sits in 4 walker targets as a backstop |
| F19 Java guarded invariant | P0 | M-T6.54 done | FIXED-VERIFIED | M-T6.54 `done` (F19 by #2857) | |
| F18 Java `ignoring` | P1 | M-T6.54 done | FIXED-VERIFIED | same | |
| F62/F11 DestroyForm unresolved | P0 | M-T1.31 `open`, "F11 in flight #2860" | FIXED-VERIFIED | #2860 merged (ebf777add); `loom.destroy-form-of-unresolved` has 3 slugs in messages.ts | See W3 |
| F17 extern hatch gate | P1 | M-T1.31 "F17 landed" | FIXED-VERIFIED | packet 1d-ii, per M-T1.31 | |
| F58 state-bearing workflow create | P0 | coverage: →M-T6.60; T6: M-T6.62 `in-flight` | FIXED-VERIFIED (core) + OPEN-TRACKED (remaining) | M-T6.62 "LANDED": #2850 + C1 1a, `loom.workflow-create-correlation-unsupplied`, corpus `workflow-create-state.ddd`. REMAINING (uncorrelated command workflow on node/.NET/Java, etc.) is listed in the mission | See W5 and W6 |
| F59 match error-variant binding | P0 | M-T6.61 done | FIXED-VERIFIED | #2857 | |
| F60 Elixir derived-reads-derived | P0 | M-T6.56 `open` | FIXED-VERIFIED | Closed 2026-09-13 in packet 2a; `test/generator/elixir/derived-wire-contract.test.ts` exists | Residue (a derived that bottoms out on a `function` call) is characterized in the mission. The heading still says `open` |
| F61 HEEx WorkflowForm handle_event | P0 | M-T6.56 | FIXED-VERIFIED | "F61 CLOSED 2026-09-13" in M-T6.56 | |
| F20 Ecto `:map` VO column | — | decision | DECLINED | coverage row 239; docs/generators.md:1054 now tells the truth (`:map`, never `embedded_schema`) | |
| F28/F29 dormant gates | — | reword, not delete | DECLINED (reworded) | register ✅ rows 377-378 | |
| F57 `envelope` | P0 | M-T6.57 done | DECLINED/ratified | D-ENVELOPE-RATIFY (option B) | |
| F13 `handle` | P1 | M-T6.58 partial | OPEN-TRACKED | M-T6.58 `partial` | |
| F4 `for` in a domain body | — | M-T5.30 | OPEN-TRACKED | `loom.for-placement` names M-T5.30 (open, P3) | |
| F47 heading ids | P3 | M-T9.47 `open` | FIXED-VERIFIED | `docs/build.mjs:59-73` stamps `id` through `headingSlug` | See W4 |
| F47-r: no `-1` de-dup, slug rule duplicated, 30/219 dead fragments | P3 | plan: "do the de-duplication first" | OPEN-UNTRACKED | build.mjs:65 and code-docs.ts:23 still carry two copies of the slug rule (now identical, joined by a "keep in step" comment); no `-1` suffixing | M-T9.47's text doesn't mention the residue |
| Decision 4: auto-merge footgun hook (SQUASH-only) | — | owner decision | UNVERIFIABLE | No hook in `.claude/settings.json` and no disposition found in decisions.md or new-plan | Probably moot now that the merge queue refuses direct merges, but never dispositioned |
| Decision 5: #2832 / #2835 | — | owner decision | FIXED-VERIFIED | M-T9.57 records #2835 as "right on mechanism", superseded by #2859 | |

## Field-test register (M-FT)

| id | register status | true status | evidence |
|---|---|---|---|
| M-FT.8, .9, .14, .15, .16, .17, .23, .25, .28, .29, .30 (11) | UNKNOWN-DEFINITION | UNVERIFIABLE (unchanged) | 0 refs in docs/src/test outside the register; 0 in git log; GitHub PR search "M-FT" returns 23 PRs, none defines these ids |
| M-FT.5: parameterless-op affordance / `Action` toast slot (quoted from #2746) | UNKNOWN-DEFINITION | OPEN-UNTRACKED | The work #2746 deferred to it has no owner. #2991 (toast() effect) is a different surface. Grep of new-plan for "parameterless" finds no owning mission |
| M-FT.24: union wire shape + review-A D-7 (OpenAPI union document), quoted from #2744 and FT-done.md:136 | UNKNOWN-DEFINITION | OPEN-UNTRACKED | No mission owns D-7. The adjacent .NET `F2-W-14` (no `UseOneOfForPolymorphism`) is recorded as "not reached" in wave-1-dotnet-adapters.md:103 |

## Wrong claims

- **W1**: coverage.md:232-233 says F3 is "In flight → #2967 + #2997" and "The only open work this doc owns is #2967/#2997". Both merged (0f4d58dcb, c29c62f9a).
- **W2**: coverage.md:232 lists closed / in-flight / deferred for 11 findings and omits F12 (fixed by #2971) entirely.
- **W3**: M-T1.31 heading is `open (… F11 in flight)` and says "closes when that lands". #2860 merged (ebf777add), so the mission is complete but not flipped.
- **W4**: M-T9.47 is `open` for "headings render without ids". `docs/build.mjs` has stamped ids since at least 09-09 (the fleet plan itself says "already fixed").
- **W5**: coverage.md:239 says "F58→M-T6.60". F58 was renumbered to M-T6.62, and M-T6.60 is the numeric-strictness ruling.
- **W6**: the M-T6.62 heading still says `in-flight (#2850 + wave C1 1a)`. Both landed, so it should read partial/done-with-remaining. M-T6.56's `open` heading is similarly stale (F60/F61/F22 closed; only residue remains).
- **W7**: the p3 payload-sweep doc says the audit and plan "land on their own branch … named rather than linked". #2964 merged them long ago.
- **W8**: the fleet plan says "This retires the fleet: every one of F1-F12 is either merged, in flight, or owner-deferred", and coverage says F11 is closed. Four PR-declared follow-ups were never missioned: F1-c, F2-r1, F2-r2, F7-r. F11's event matcher is also absent. The fleet plan has no wave-2 outcomes section (P6/P7/P8 results are only in coverage.md, and there F3 is stale and F12 is missing).

## Top problems

1. **An invented member on any array receiver is silently accepted and emitted verbatim** (F1-c, broader than domain services: `tags.bogus` in an aggregate derived gives `this._tags.bogus`, TS2339). #2949 is primitive-only and has been a stalled draft for two weeks. `envForNode` still has no `DomainServiceOperation` arm, so no type-based gate can fire in domain-service bodies at all.
2. **Four "own mission" follow-ups from merged fleet PRs were never filed**: the UI form-error matcher (D-3), the mypy enum-narrowing false positive, the Elixir pure-core datetime divergence, and the event-emitted matcher from F11.
3. **coverage.md's testability rows are stale**: F3 is shown as in flight, F12 is missing, and F58 points at the wrong id. Several mission headings were never flipped: M-T1.31, M-T9.47, M-T6.62, M-T6.56.
4. **The two M-FT ids that do have known content (M-FT.5 and M-FT.24) carry deferred work that no mission owns**, notably the OpenAPI union document (D-7). The other 11 ids are unchanged, and no PR body defines any of them.
5. F6 is owner-deferred, but open mission M-T5.19(b) still plans the same principal clause and an `isolation:` keyword that overlaps F3's shipped reset seam. The two plan entries disagree.

# PR-description sweep: follow-ups, deferrals and stale claims (Loom-Harness/Loc, main @ d2a0bc02, 2026-09-28)

Scope: PR bodies updated since 2026-08-28 that relate to evaluation findings: the eval umbrellas #2861, #2862, #2864, #2865, #2911, #2922, #2950, #2964, #2980, #3005, #3026 and #3029, their fix PRs, and all open or draft PRs. I extracted every "deferred / not in this PR / follow-up / claimed by / owned by" promise and checked it against main. The checks were grep, `ddd parse` / `generate system` repros under `scratchpad/review/tmp-pr-sweep/`, and `git log`.

## Current-session items (asked for explicitly)

| Item | PR | State (2026-09-28 ~15:30Z) | Notes |
|---|---|---|---|
| F-012 drizzle journal ordering | #3049 | open, ready, `blocked` (label `run-migration-e2e`), rebased on d2a0bc02 | node/drizzle only by design. The PR argues the other 4 migrators track by identity. |
| F-004 denyByDefault vs ES create gate | #3048 | open, ready, `blocked` | Silent defect **reproduced on main**: a gated named ES create `create open(..){ requires … }` on node gives `0 error(s)` and emits `currentUser`/`ForbiddenError` unbound in `domain/account.ts:100`. #3054 (merged today) made `denyByDefault` the language default, which raises the urgency. |
| H1 envForNode has no DomainServiceOperation arm | #3040 | open, ready, `blocked` | `grep -c isDomainServiceOperation src/language/type-system.ts` = 0 on main. |
| H2 domainService getById unguarded deref | #3035 | **merged** 2026-09-27 (9eb9f0314) | dotnet + elixir render-expr, with tests `domain-service-reading.test.ts` ×2. |
| Reserved-keyword field names (systemic) | #3063 | draft claim opened 15:06Z today, 1 stub commit | Earlier batches #2883, #2937 and #3036 are merged. |

## Findings table

| id | severity | register-status (per PR body) | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-004 ES-create gate silently unbound | S1 (security) | #3048 open | OPEN-TRACKED | repro `es.ddd`: 0 errors, `currentUser` unbound in node domain | fix pending in #3048 |
| ES create gate hoist (node/.NET/java/python) | S2 | #3048: "owned by **M-T3.16**" | **OPEN-UNTRACKED + WRONG-CLAIM** | M-T3.16 is `done`/archived (README:99, archive/T3-done.md:48). `waves/handoffs/wave-c5-5b-golden2.md:206` says it "was never part of M-T3.16… needs its own mission". None minted. | pointer dangles |
| Array-receiver invented member (`f.totallyInvented` on `array<T>`) | S2 | #3040 "recommend tracked as own finding" | **OPEN-UNTRACKED** | recorded only in #3040's body and its unmerged audit-doc edit. `absentRecordMember` has no array arm. | |
| F-103 (eval-claims) `requires`-gated op called from an event reactor | S1 | eval-claims register: "claimed by #2966" | **OPEN-UNTRACKED** (the claim is stale and under-scoped) | repro `f103-*.ddd`, 0 errors. node `http/workflows.ts:103`, dotnet `CloserStartShippedHandler.cs:35` and java `DDispatcher.java:41` all reference an unbound `currentUser`. | #2966 scopes it java-only, has been idle 14d and is dirty |
| F-105 (eval-claims) op-call args in unit `test` body unchecked | S2 | "OPEN, unclaimed" | **OPEN-UNTRACKED** | repro `f105.ddd`: `r.retarget(42)` / `r.bump("x")` gives `0 error(s)` | no mission in new-plan |
| F-041 (fieldops-audit) page-body lambda typo | S2 (Phoenix `KeyError`) | #2911 "not landed, deliberately — sweep first" | **OPEN-UNTRACKED** | `eval/repro/broken/b09-page-wrong-aggregate.ddd` gives `0 error(s)` | no mission |
| F-038 (fieldops-audit) lockfile / determinism | S2 | #2911 "not landed, not an evaluator's call" | **OPEN-UNTRACKED** (design fork) | no mission mentions it | |
| #2911 F-023 residual: feliz/flutter If-Match | S3 | "residual, named rather than skipped" | **OPEN-UNTRACKED** | `If-Match` only in `_frontend/occ.ts`. None in `feliz/` or `flutter/`. | |
| G5 (eshop) IR diagnostics have no source position | S3 | #2862 "deliberately still open" | **OPEN-UNTRACKED** | `printIrDiagnostics` (cli/main.ts:291) prints `${code} ${source}:` with no file:line | named only in coverage.md prose |
| P9 (eshop) flattened VO all-null-or-all-present | S3 latent | #2862 "still open" | **OPEN-UNTRACKED** | no mission | |
| Commons F-018 `ddd trace` can't map default bundle | S3 | #2922 "the only genuinely open row" | **OPEN-UNTRACKED** | audit table row 78 still `open`. No mission. | |
| `emitsCommandRoute` local duplicate in dotnet | S4 hygiene | #3015 "out of scope" | OPEN-UNTRACKED | `src/generator/dotnet/workflow-emit.ts:373` still local | |
| #2966 item 2: java `objectStore.put(k,{…})` passes a Map into a String param | S1 compile | #2966 draft claim | OPEN-TRACKED (stale claim) | repro `res.ddd` (java): `S3Resources.salesFilesPut("orders/"+name, Map.of(...))` against `salesFilesPut(String key, String body)` | #2966 idle 14d, dirty |
| #2966 item 1: java workflow gate with unbound principal | S1 | claimed | partially FIXED | command-create path now binds `var currentUser = currentUserAccessor.user()` (`eval/matrix/be-java.ddd`). The reactor path is still broken (see F-103). | |
| #2966 items 3+4: Ecto `enum[]` and Feliz form collision | S1 | claimed | FIXED-VERIFIED (by #2980) | #2980 body plus merged fixes | #2966 now duplicates landed work |
| #2947 F-010: optional part field required in node factory | S1 compile | #2947 draft claim | OPEN-TRACKED (stale) | repro `managed.ddd`: `Line._create({id,parentId,text})` against `tag: string \| null` (TS2345) | #2947 idle 14d, dirty |
| #2947 F-017: non-optional `managed` field has no default | S1 | #2947 claim | OPEN-TRACKED (stale) | repro: `total: null` into `money` slot, `0 error(s)` | |
| #2947 F-039: criterion `== null` gives `eq(col,null)` | S1 | #2947 claim | FIXED-VERIFIED | repro emits `isNull` import (landed via #2980) | |
| #2947 F-021: IdLink in a containment row | S2 | #2947 claim | UNVERIFIABLE | needs a vue-tsc build | |
| #2948 #1: Keycloak realm lacks claim mappers | S1 ops | #2948 claim | FIXED-VERIFIED (by #2911 F-022) | `src/system/index.ts:1067-1080` has per-field mappers and `multivalued` | |
| #2948 #3: regenerate clobbers hand edits silently | S2 | #2948 claim | FIXED-VERIFIED | cf6b6afdf "report writes that land on locally-modified files (F-019)". `cli/main.ts:847-866` | |
| #2948 #2: missing tenant claim makes a write 500 | S2 | #2948 claim | UNVERIFIABLE (likely open) | node audit-stamp binds principal but not claim presence. Needs a runtime check. | |
| #2969 F-034: translated locales never reach frontend | S2 | #2969 draft claim | OPEN-TRACKED (stale) | `generate system` has no `--locales`/translations option | same as clinica F-017. Idle 14d. |
| #2949 F-040: invented member on primitive | S2 | #2949 draft | OPEN-TRACKED (stale) | repro `f040.ddd` gives `0 error(s)`. Code absent from messages.ts. | #3040 depends on it |
| #2942 page emitter fails open | S1 | open PR | OPEN-TRACKED | `walker-core.ts:1822` still returns `/* unresolved: … */ undefined` | idle since 09-22 |
| F-108 ui bound to two backends | S2 | #3029 → M-T1.35 | OPEN-TRACKED | `T1-ui-frontend.md:476` `open` | |
| G2 retrieval route (eshop) / clinica F-008 | S2 | "deliberately open" | OPEN-TRACKED | M-T5.31 `open` | |
| M-T5.35 VO collection create-input | S2 | #2918 | OPEN-TRACKED | active today | |
| E2E-less drains (part-rules-private-op, envelope, projection-fold-statements, paged-nonrelational) | S3 | #2977/#2978 drafts | OPEN-TRACKED, **duplicate claim** | all 4 still in `E2E_LESS_CORPUS_FIXTURES`. #3058 (opened 09-28) also claims "the E2E-less drain". | drafts idle 8d |
| Behavioural identities | S3 | #2976 draft | OPEN-TRACKED (stale 8d) | | |
| CR1 waiver drain | — | #2938/#3051 closed unmerged | OPEN-TRACKED via #3065 | #3065 says it replaces both | |
| #2945 currentUser in read filter | S1 | closed unmerged 09-28 | FIXED on main / DECLINED part | closing comment shows main emits bound principal on py/elixir/java. The non-`.id` claim case is refused (`loom.find-where-not-queryable`). Remainder moved to #3064. | |
| 3005 declare-only keyword asymmetry (grammar widening) | S3 | "did not do it" | OPEN-TRACKED (#3063) | | |
| H2 getById deref | S1 | #3035 | FIXED-VERIFIED | 9eb9f0314 + two tests | |
| F-026 elixir/java halves | S2 | #3015 "scoped out" | FIXED-VERIFIED | #3045, #3046, #3047 merged. `test/system/openapi-component-uniqueness-census.test.ts` exists (the "corpus-wide" follow-up). | |
| #2980 F-023/F-024/F-025 | S1 | "found late, not fixed" | FIXED-VERIFIED | #2983, #2981, #2982 merged | |
| #2980 F-008/F-011/F-016 | S1 | "claimed by other PRs" | FIXED-VERIFIED | e.g. `src/system/index.ts:1283` `quay.io/minio/minio` | |
| eshop P7/P8/P10/P11 | S1–S2 | #2862 "still open / P11 has no PR" | FIXED-VERIFIED | #2900, #2902, #2906, #2901 merged | see WRONG-CLAIM on coverage.md |
| Commons `workflow-foreach-unknown-binding` false positive | S3 | #2922 "found, not fixed" | FIXED (commit evidence) | b383852a2 (#2911 F-002: the for-each arm now records `let` bindings) | |
| #2974 "5 backends" | — | claim | FIXED-VERIFIED | diff touches dotnet, elixir, java, python, typescript entity emitters plus tests | spot-check |
| #2850 / #3057 "all five" | — | claim | verified by file spread | merge diffs touch dotnet, elixir, hono, java and python | |
| #2885 "all six frontends" | — | claim | plausible | shared `_walker` (6 files) + feliz + flutter | |
| Testability F6 principal clause | P1 (auth area) | owner-deferred | DECLINED (orphaned) | fleet-plan:209-211. The deferral is "recorded on the mission" M-T5.37, which is archived, so there is no live tracker. | |
| #3048 header `requires` on `create` | — | argued against | DECLINED | PR body | |
| #2980 F-015 F841 | S4 | deliberate | DECLINED | eval-fieldops/FINDINGS.md:994 | |
| F-117 sales-ui.ddd | — | dropped | DECLINED | #3026 | |
| Commons F-002/F-012 (ceilings), F-006/F-008/F-009 (posture/design/feature) | S2 | "open — decision" | DECLINED-pending (no mission for F-006/F-008/F-009) | coverage.md:235 | worth a ruling row |
| #2922 .NET entity-member collisions (`Create`, `AssertInvariants`, `Id`) | S2 | "wants its own issue" | UNVERIFIABLE | no mission and no repro run | |
| #2922 `crudish, auditable` gives java `UserId` with no User aggregate | S1 | "wants its own issue" | UNVERIFIABLE (possibly fixed by #2960 P4/F9) | | |

## WRONG-CLAIM list

1. **#3048 → M-T3.16.** The body says the ES create-gate parity hoist is "owned by M-T3.16". M-T3.16 closed today (wave C5 5b), and the 5b handoff (`wave-c5-5b-golden2.md:206`) says it never covered this. No replacement mission exists.
2. **`docs/new-plan/coverage.md:231` (eshop row).** It says "Deliberately still open, no PR: … P7/P9/P11 — of which P11 … is the most severe". P7 (#2900) and P11 (#2901) are merged, so only P9 is open. The same row maps "P8 → #2876", but #2876 is P4/P5 and P8 is #2902.
3. **#2862 body.** "The eight fix PRs … all open" and "P11 has no PR": all eight are merged, and P11 was fixed by #2901. The merged PR body was never updated.
4. **Mission-id collision M-T9.59.** Commit 3772511f1 and `docs/audits/2026-09-10-freight-fleet-plan.md:52` use M-T9.59 for "the unresolved-symbol gate", which has landed (`test/system/emitted-unbound-symbols.test.ts`). `T9-toolchain-health.md:855` uses M-T9.59 for "the `*-unsupported` register cannot see a target gap", which is `open`.
5. **F-id namespace collision.** The session PR titles "F-012" (#3049) and "F-004" (#3048) match no register on main. `eval/FINDINGS.md`, `eval/fieldops-audit/FINDINGS.md`, `eval-fieldops/FINDINGS.md` and `eval-clinica/` each define a *different* F-004 and F-012. For example, eval-fieldops F-012 is the java `Objects` import and fieldops-audit F-012 is an e2e slug crash.
6. **The eval-claims register exists only on the unmerged branch `claude/loom-dev-experience-test-xukeqa`.** #3026 and #3029 cite it as the source register, but it never reached main. That is why F-103 and F-105 are invisible to every on-main register.
7. **#2966's claim is both stale and under-scoped.** Items 3 and 4 landed via #2980, and #2980's body says "whichever lands second should reconcile". Item 1 is scoped "java-only", but the live defect (F-103) is node, .NET and java unbound plus python dropping the gate.

## Top problems

1. **F-103 (live S1, untracked).** A `requires`-gated operation called from an event reactor emits unbound `currentUser` on node, .NET and java, with `0 error(s)`. The only claim is a stale java-only draft (#2966).
2. **F-004 (#3048) is still unmerged** while #3054 made `denyByDefault` the default today. The named-ES-create gate emits uncompilable node code with `0 error(s)` on main. The follow-up hoist mission it points at (M-T3.16) is closed, so there is no owner.
3. **Five stale dirty drafts from 2026-09-14** (#2947, #2948, #2949, #2966, #2969) still "claim" live defects. Confirmed live: F-010, F-017, the java Map→String put, F-034 and F-040. Other parts of the same drafts already landed elsewhere. Each claim now blocks others from picking the work up; they should be re-cut or released.
4. **Several deferred items have no mission:** F-105, F-041, F-038, the array-receiver member gate, the feliz/flutter If-Match residual, G5, P9 and commons F-018.
5. **Register and plan drift:** coverage.md eshop row, the M-T9.59 id reuse, F-id collisions across 5 registers, and the eval-claims register living off-main.
6. **Duplicate claims:** #2977/#2978 (idle 8d) and #3058 all claim the E2E-less drain.

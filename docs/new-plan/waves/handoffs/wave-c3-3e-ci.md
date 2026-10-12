# Wave C3 · packet 3e, part (ii) — the never-gating legs, B7, A7 (PR 3-B(ii))

Branch `claude/c3e-ii`, base `d85bb773d` (`main` @ `6f0de5889` + PR 3-B(i)). Never pushed; the coordinator folds it. Plan row: [`../wave-c3.md`](../wave-c3.md) §Packets, "3e"; background [`../../completion-waves-2026-09.md`](../../completion-waves-2026-09.md) §4 "Wave C3", [`../../verification-waves-2026-09.md`](../../verification-waves-2026-09.md) §2–§4 (G1.5/G1.6), [`../../improvement-waves-2026-09.md`](../../improvement-waves-2026-09.md) 3.7 (B7 + A7).

**Verdict.** The exit — *0 runtime legs outside both the per-PR set and the queue, or a dated reason per leg* — is met and is now a test, not a claim: `merge-queue-readiness.test.ts` → "no post-merge leg sits outside both the per-PR set and the queue" fails on any `push: main` workflow that runs neither per-PR nor in the queue unless it has a dated waiver, and fails a waiver once it is 90 days old or its leg starts gating. The one waiver is `playground-e2e` (CDN-gated specs). B7 is built on both java compile legs with the emitter warnings it surfaced fixed. A7 and the Schemathesis elixir cell stay out, each with a measured, dated reason.

## Item → outcome

| item | outcome | where |
|---|---|---|
| `phoenix-ui-e2e` (#2718 re-measure) | **promoted per-PR, path-scoped.** #2718 closed 2026-09-09; 30/30 first-attempt passes over the last 30 `main` runs (20/20 in the flake-budget window). PR block mirrors `behavioral-heex-ui-e2e` (elixir tree + shared seams + both HEEx packs, which were added to the push block too); draft guard on both jobs; PR-aware concurrency; `labeled` dropped. Not in the queue (per-PR-binding legs stay out by the documented trim) | `.github/workflows/phoenix-ui-e2e.yml` |
| `channels-e2e` | **promoted into the merge queue** (`merge_group:` + `channels-e2e-passed` rollup; manifest row `queueIsOnlyRun`). The runner-cost measurement says otherwise than "stay label-gated": 18 cells × 1.3–3.3 min, 34 runner-min a firing — the "35-minute legs" in verification-waves §2 was the job cap | `channels-e2e.yml`, `merge-queue-required-checks.ts` |
| `api-call-e2e` | **promoted into the merge queue** (`merge_group:` + `api-call-e2e-passed`; `queueIsOnlyRun`). 5 cells × 1.4–2.4 min, 9 runner-min | `api-call-e2e.yml`, manifest |
| tenancy `flat` legs (G1.5) | **promoted per-PR, path-scoped** as a separate job `tenancy-e2e-flat` (draft guard); the other 13 cells stay in job `tenancy-e2e`, guard `… \|\| draft == false && contains(labels, 'run-tenancy')`; one rollup needs both. Not an event-conditional matrix: a job `if:` cannot read `matrix`. `labeled` dropped (a label event would cancel the live flat run) — the label is read on the next push | `tenancy-e2e.yml` |
| `migration-evolution-e2e` (G1.6) | **promoted per-PR, path-scoped AND kept in the queue** (manifest row: `lane: per-pr`, `queueRequired: true`, no `queueIsOnlyRun`). Measured 1.2–3.0 min a cell, ~10 runner-min a firing — the per-PR run cannot move the pr-gate cycle, which `corpus × tsc` bounds at ~22 min. `run-migration-e2e` label retired | `migration-evolution-e2e.yml`, manifest |
| Schemathesis elixir cell | **kept out — dated reason 2026-10-05.** The 2026-10-05 nightly (run 37301241323, artifact `schemathesis-reports-elixir`): 32 failures + 30 errors over 29 operations (14 Schema Error, 16 Runtime Error; `Ecto.Query.CastError` on non-uuid `{id}` and on `/by_email` shadowed by `/{id}`; undeclared success Content-Types; `POST /customers` / `POST /orders` → 405). Binding needs root-cause rules AND `src/generator/elixir/**` fixes — an elixir triage packet, not a workflow edit. Nightly-only, so outside the `push: main` ratchet | `docs/ci-gating.md` |
| B7 `-Xlint:all -Werror` java leg | **built on both java legs** (`java-build.yml`, `corpus-build.yml` `corpus × java`) through `test/e2e/support/java-werror.init.gradle`, pinned by `test/system/java-compile-strictness.test.ts`. Emitter fixed, not scoped — see below | `src/generator/java/**` (7 files), the two workflows |
| A7 per-backend npm legs | **not collapsed — dated reason 2026-10-05.** 51 of 112 `test*` scripts are per-backend variants, but every runtime feature is already ONE matrix workflow (tenancy 18 cells, channels 17, email/migration/schemathesis 5) and a new corpus feature is one manifest row for all five compile legs. What stays per backend is the boot harness (`test/e2e/*-<backend>.test.ts`, genuinely different boot mechanics) — a `test/e2e/**` + `package.json` refactor outside this tree, with nil measured cycle payoff (the cycle is bounded by `corpus × tsc`). The obs ×5 / native-oidc ×4 files stay separate because `paths:` is per workflow | `docs/ci-gating.md` |
| pr-gate cycle before/after | **before measured** (below); **after** defined and left for the coordinator post-merge | `docs/ci-gating.md` |

## Measurements (Actions REST API, 2026-10-05)

Scripts were scratch (not committed); the method is in `docs/ci-gating.md` → "The never-gating legs, re-measured (2026-10-05)" so it can be repeated.

- **Flake budget** — `scripts/flake-budget.mjs --repo Loom-Harness/Loc`: 4 of 65 legs flagged (three `never-run` new workflows + `conformance-full` 65 %); every leg this packet touches is 20/20 first-attempt. `phoenix-ui-e2e` independently: 30 most recent completed `main` runs all `run_attempt == 1` + `success`.
- **Runner cost** (last 10 completed non-skipped `main` push runs, job `completed_at − started_at`): phoenix 2 jobs / 4.4 runner-min; channels 18 / 34.4; api-call 5 / 9.0; tenancy 13.5 / 17.4 (flat cells 1.0–1.9 min); migration-evolution 6 / 9.8.
- **Queue entry** (every run on each of the last 10 `merge_group` head SHAs): ~309 jobs, ~514 runner-min, wall median 22.6 / p90 26.4 min; critical path the corpus compile gates. Channels + api-call add 23 jobs / ~43 runner-min (+8 %), each job shorter than that path.
- **pr-gate cycle, BEFORE** (last 22 merged PRs whose final `pr-gate` was `success`): cycle = first check-run start on the final head SHA → that SHA's last `pr-gate` completion — **median 24.5 min, p90 45.3 min**; tail = last non-`pr-gate` completion → `pr-gate` verdict, median 0.4 / p90 1.3 min. Slowest check on broad PRs: `corpus × tsc (Hono/node)`, 17–23 min. (#3115's tail read −16.6 min: a check ran on its head after the final verdict; left in, it does not move the medians.)
- **pr-gate cycle, AFTER — for the coordinator**: same definition over the first 20 PRs merged after this lands, plus the queue-entry figures over the first 10 merge groups carrying `channels-e2e`; record both in the wave log. A cycle p90 above ~45 min under load is the documented revert signal for `migration-evolution-e2e`'s per-PR block.

## B7 — what `-Werror` surfaced, and the fixes

Inventory first (`-Xlint:all -Xmaxwarns 100000`, no `-Werror`, `compileJava compileTestJava`) over all 37 `generated-java-build` fixtures with host JDK 25 + Gradle 9.7.1 (`/opt/jdk25`, `/opt/gradle-9`):

| lint | site | fix |
|---|---|---|
| `serial` ×5–6 per project | the emitted exception classes (`DomainException` both variants, `ValueObjectInvariantException`, `WireFormatException`, `ForbiddenException`, `DisallowedException`, `AggregateNotFoundException`) + the api-client `RemoteCallException` | `private static final long serialVersionUID = 1L;` (`emit/common.ts`, `adapters/api-client.ts`) |
| `try` | `try (var __frame = RequestContext.openChild())` ×4 (workflow/dispatch), `try (Scope ignored = span.makeCurrent())` | Java 22 unnamed resources: `var _` / `Scope _` (`emit/workflow.ts`, `emit/dispatch.ts`, `emit/request-context.ts`) |
| `deprecation` | Jackson 3 `JsonNode.asText()` / `isTextual()` (auth, dev stub) | `asString()` / `isString()` — `javap -c` on jackson-databind 3.1.4 shows the old names are one-instruction delegates to these (`emit/auth.ts`) |
| `rawtypes` | `Map<String, Schema>` in `OpenApiContractCustomizer.retargetEnumProps` | `@SuppressWarnings("rawtypes")` on that one method — swagger-core's `Schema.getProperties()` is declared raw, and `var` still trips the lint on the loop variable (`emit/openapi-customizer.ts`) |

After: **37/37 fixtures and 95/95 corpus features compile clean under `-Xlint:all -Werror`** (the corpus leg run through the real `test/e2e/corpus-java-build.test.ts` with an isolated `GRADLE_USER_HOME` whose `init.d` carried the script; two cases first failed because they compiled while the mutation below was live in `out/`, and passed on re-run). Three test pins moved with the emitted text (`java-workflow-command-surface`, `java-workflow-dispatch`, `dev-claims-array`); `npx vitest run test/generator/java test/generator/dev-claims-array.test.ts` 582/582.

## Mutation proofs (each reverted by file copy)

| gate | mutation | failing assertion |
|---|---|---|
| never-gating ratchet | `phoenix-ui-e2e.yml` restored to the base version | `post-merge-only legs with no pre-merge run and no waiver: phoenix-ui-e2e.yml — give each a per-PR … or a dated NEVER_GATING_WAIVERS entry: expected [ 'phoenix-ui-e2e.yml' ] to deeply equal []` |
| waiver expiry | `playground-e2e` waiver dated `2026-06-01` | `playground-e2e.yml: measured 2026-06-01, over 90 days ago — re-measure and re-date it, or promote the leg` |
| waiver staleness | a waiver added for `channels-e2e.yml` (now in the queue) | `stale NEVER_GATING_WAIVERS entries: channels-e2e.yml` |
| `queueIsOnlyRun` claim on the split tenancy file | the label clause dropped from job `tenancy-e2e`'s guard | `tenancy-e2e-passed (tenancy-e2e.yml) claims the queue is its only run but is not label-guarded: …` |
| the `-Werror` leg itself | `serialVersionUID` removed from `AggregateNotFoundException` in `emit/common.ts`, toolchain rebuilt, `domain.ddd` compiled with the init script | `AggregateNotFoundException.java:4: warning: [serial] …` → `error: warnings found and -Werror specified`, exit 1 (the same build without the init script passes — the base inventory) |
| java strictness pin | `'-Werror'` deleted from the init script | `expected 'allprojects {…' to contain '\'-Werror\''` |
| java strictness pin | the install step deleted from `java-build.yml` | `java-build.yml no longer installs test/e2e/support/java-werror.init.gradle: expected -1 to be greater than -1` |

## Gates run (on the final tree)

- `npx biome ci .` — clean (3493 files).
- `npx tsc -b` — exit 0. `node scripts/test-typecheck.mjs` — "test/ and src/ are both clean".
- `npx vitest run test/system` — 141 files passed, 1 skipped; 3252 tests passed, 31 skipped. (`emitted-symbol-binding.test.ts` first failed on "@types/node not found" because this worktree has no `node_modules`; with `node_modules/@types` linked to the main checkout's it passes 6/6 — environment, not code.)
- `npx vitest run test/generator/java test/generator/dev-claims-array.test.ts` — 582 passed.
- `npm test` (full fast suite) — 2278 files passed, 92 skipped; 28546 tests passed, 6 expected-fail, 1320 skipped; **4 failed, all environmental**: `test/platform/packaging-split-{core-pkg,fs-discovery}.test.ts` read the `node_modules/@loom/*` workspace symlinks this worktree lacks — with `node_modules/@loom` linked to the main checkout's, both files pass 10/10. Exit code 1 for that reason only.
- actionlint (`…/snapshots/84/fs/usr/local/bin/actionlint`) over every workflow — no findings; every `.github/workflows/*.yml` YAML-parses.
- `node docs/build.mjs` — exit 0.
- `scripts/mission-counts.mjs --check` — not run: no mission status was touched.

## Left for the owner / coordinator

1. **`CLAUDE.md` § "CI surface" is now stale** and was deliberately not edited here (agent instructions cannot authorise a CLAUDE.md change): it says **22** gates are wired into the queue (now **24**), names `channels-e2e`, `api-call-e2e` and `phoenix-ui-e2e` as "in neither the per-PR set nor the queue … the blind spot that remains" (now: queue, queue, per-PR), and lists `migration-evolution-e2e` among the label-guarded queue-only legs (now per-PR + queue). The replacement facts are in `docs/ci-gating.md` → "The never-gating legs, re-measured (2026-10-05)".
2. **Labels.** `run-migration-e2e` is unbound and can be deleted from the repo's label set; `run-e2e` now drives `playground-e2e` alone; `run-tenancy` now takes effect on the next push and only on a PR whose diff the tenancy `paths:` match (the queue runs every cell regardless).
3. **The after-measurement** above, and the queued-vs-running ratio the runbook asks for before raising build concurrency (the queue set is 24 now).
4. **The Schemathesis elixir triage packet** — the 2026-10-05 artifact is the starting inventory; it needs `src/generator/elixir/**` fixes (non-uuid `{id}` cast, static sub-path shadowed by `/{id}`, the two POST 405s, the 14 schema errors) plus root-cause rules, then the `discovery: true` line goes.
5. **The behavioural java leg** (`behavioral-e2e-java.yml` / `run-java.mjs`) and `pairwise-corpus-java` still compile without the init script. Both build the same emitters, so the fixes above cover them today; wiring them is one `install` step each if wanted.
6. The 3e row status in `wave-c3.md` / `completion-waves-2026-09.md` (left to the coordinator, as instructed).

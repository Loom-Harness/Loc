# u-claims — audit of eval-claims/ register (origin/claude/loom-dev-experience-test-xukeqa) vs main d2a0bc02 (2026-09-28)

Branch: 2 commits (f4b580297 evaluation, 11f96125e disposition). **No PR was ever opened from this branch** (list_pull_requests head=… → empty). The register never reached main; `eval-claims/` absent on main; `docs/new-plan/coverage.md` does not disposition it (sibling registers `eval-fieldops/`, `eval-clinica/` and 4 `docs/audits/*-dev-experience.md` ARE on main). Only on-main traces: M-T1.35 ("Minted … by the 'Assure' dev-experience evaluation"), M-T5.39 (date scalar), M-T9.66 (mission-count collisions), plus fix PR bodies #3026/#3029/#3031/#3044/#3050 (all merged 2026-09-28).

Method: every repro/ file + v1/v2/v3 main.ddd re-run with `ddd parse` / `generate system` on current main; F-102/F-103 re-generated on all 5 backends; F-106/F-107 on react/vue/svelte/angular/flutter; F-108 reproduced by splitting Claims onto its own deployable in v2; one-liner probes for F-109/110/111/115; emitter greps for F-112 siblings. Static only (no docker, no tsc of output).

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F-101 | S1 | fixed #3029 | FIXED-VERIFIED | repro now emits `createInProcessDispatcher/createOutboxDispatcher/startOutboxRelay` in api/http/workflows.ts; fix in src/platform/hono/v4/workflow-builder.ts; corpus fixture `channels-broker-workflow` | node-only defect class; v5 delegates to v4 |
| F-102 | S1 | fixed #3029 | FIXED-VERIFIED | node api_a no longer imports `Addr`; dotnet/java/python/elixir api_a also free of `Addr`; fixture `projection-split-deployables` | all 5 backends clean |
| F-103 | S1 | "claimed elsewhere — #2966 owns it; my note widens theirs" | OPEN-UNTRACKED (+WRONG-CLAIM) | Current main, repro: node workflows.ts:103 `currentUser.permissions` unbound; .NET CloseOrderStartShippedHandler.cs:35 same; java OrdDispatcher.java:41 same; python dispatch.py:28 `o.finish()` gate absent; elixir start_shipped.ex:18 `finish_order(o, %{})` → `current_user` nil → crash. #2966 is a DRAFT, `mergeable_state: dirty`, idle since 2026-09-21, scoped **Java only**; it has **0 comments** — the "widening note" was never posted. No new-plan mission. | Language gap ("saga-only operation" / reactor principal) also untracked anywhere in docs/new-plan |
| F-104 | S1 | fixed #3031 | FIXED-VERIFIED | repro → `error: 'R.create' field 'a' expects 'A id' but got 'B2 id' …` | |
| F-105 | S1 | OPEN, unclaimed | OPEN-UNTRACKED | repro still `0 error(s)`; control (workflow body) still 2 errors. No mission/PR mentions it (grep docs/new-plan, PR search) | disposition accurate |
| F-106 | S1 | fixed #3050 | FIXED-VERIFIED | `.round(0)`/`.round(2)` on projection money → `toDecimalPlaces(n, Decimal.ROUND_HALF_UP)` on react/vue/svelte/angular (angular exposes `Decimal` on the class) | |
| F-107 | S2 | fixed #3050 | FIXED-VERIFIED | original repro → `loom.money-in-text-slot` error (projection `of:` now reached); interpolated form compiles via `.toString()` | fires also for flutter/vue (refusal, not MoneyValue rendering) — non-React frontends refused rather than formatted |
| F-108 | S2 | "half fixed — refused + M-T1.35" | OPEN-UNTRACKED (+WRONG-CLAIM) | Re-ran the register's actual scenario (v2, Claims moved to `claimsApi`, `ui Portal with scaffold`, `targets: api`): `parse` 0 errors, `generate` → **26 error(s)** `loom.method-call-unresolved-receiver`/`page-ref-unreachable` in unwritten portal pages, none naming `targets:`/context. The new `loom.ui-multi-backend-unsupported` only fires for ≥2 api handles bound to distinct deployables — a different shape. M-T1.35 text covers only per-handle routing; it never mentions the scaffold/`targets:` mismatch message. | Refusal for multi-handle shape is real (ui-backend-binding-checks.ts) but doesn't touch F-108's repro |
| F-109 | S2 | fixed #3026 | FIXED-VERIFIED | `migration "r" { A.description -> summary }` (also message/key/page) → 0 errors; `PropertyName` rule at ddd.langium:104/159 | |
| F-110 | S2 | filed M-T5.39 | OPEN-TRACKED | T5-language-core.md:319 `M-T5.39 … open · L · P1`; `date` still unknown type | |
| F-111 | S2 | fixed #3026 | FIXED-VERIFIED | `string(guid)`, `string(datetime)` → 0 errors; json/File refused with corrected vocabulary text | |
| F-112 | S3 | fixed #3029 | FIXED-VERIFIED (rabbitmq only) | v2 broker-init/bus-definitions.json now has 3 exchanges / 4 queues / 4 bindings incl. `loom.Claims.ClaimEvents.payoutsApi`; test/generator/channels-auth.test.ts pins bindings | Sibling on **kafka** open & untracked: node kafkajs `consumer.subscribe({topic})` (no fromBeginning), java `AUTO_OFFSET_RESET "latest"` (java/emit/channels.ts:720), .NET `AutoOffsetReset.Latest` (dotnet/emit/channels.ts:545) — a new group misses queue/work events published before its first boot; v2 with `type: kafka` validates clean. Static finding, not booted. |
| F-113 | S3 | fixed #3044 | FIXED-VERIFIED | repro → 2 × `loom.workflow-param-unused` warning | |
| F-114 | S3 | fixed as advisory #3044 | FIXED-VERIFIED | v1/v2/v3 print `loom.aggregate-not-constructible` suggestions for Policy/Claim (true positives) | advisory, not warning — by design |
| F-115 | S3 | fixed #3026 | FIXED-VERIFIED | `date` → no bogus hint; `Adr` → "Did you mean 'Addr'?" even with scaffold ui | |
| F-116 | S3 | fixed #3026 | FIXED-VERIFIED | "until `crudish(requires` " gone from src/cli/new-templates.ts | |
| F-117 | S4 | dropped (wrong to file) | DECLINED | sales-ui.ddd still fails parse by design; documented README.md:264, examples/README.md:18, pinned in test/_helpers/ddd-corpus.ts, ddd-source-census, etc. | |

Unnumbered items in EVALUATION-REPORT.md:
- Keycloak demo user has no `permissions` attribute / no unmanagedAttributePolicy → every gated write 403s out of the box. Still live (v2 realm.json: demo user attributes = `{tenantId}` only; no "unmanaged"). "Owned" by #2948 item 1 — DRAFT, dirty, idle since 2026-09-21. OPEN (weakly tracked by stale draft).
- "Authorization has no internal door" (saga-reachable-only operation; reactor principal): untracked.
- M-T3.19 (by-id ungated) referenced — exists, open.

## Counts
FIXED-VERIFIED 12 (101,102,104,106,107,109,111,112*,113,114,115,116) · OPEN-TRACKED 1 (110) · OPEN-UNTRACKED 3 (103,105,108) · DECLINED 1 (117) · WRONG-CLAIM 3 (103 ownership, 108 half-fixed/M-T1.35, "15 of 17 closed" headline) · UNVERIFIABLE 0.

## Top problems
1. **F-103 is the worst open item and effectively orphaned**: uncompilable on node/.NET/java, silently ungated on python, runtime crash on elixir — "owned" by a stale Java-only draft (#2966) that never received the widening note. Needs a mission covering all 5 backends + the language question (reactor principal / saga-only operation).
2. **F-108's disposition is wrong**: the shipped refusal covers a different shape (multi-handle binding); the register's own scenario (move a context off the `targets:` backend under a scaffolded ui) still yields 26 misdirecting generated-page errors after a clean `parse`, and M-T1.35 does not own the message fix.
3. **F-105** (unit-`test` body operation-call args unchecked) — open, no mission.
4. **F-112 fixed on rabbitmq only**; kafka consumers on all three kafka emitters start at `latest`, same lost-event class, untracked.
5. **"15 of 17 closed" overstates**: 12 fixed, 1 filed as mission, 1 declined, 3 open.
6. Register itself never reached main and isn't dispositioned in `docs/new-plan/coverage.md`, unlike sibling evals (`eval-fieldops/`, `eval-clinica/`, docs/audits/*-dev-experience.md).

## Recommendation
Port (not merge verbatim) to main: add `eval-claims/FINDINGS.md` + repro/ (or a docs/audits entry) with the corrected disposition, disposition it in coverage.md, and mint missions for F-103 (5-backend + language), F-105, F-108 message, and the kafka F-112 sibling. The v1–v3 models are useful corpus candidates (axis combinations).

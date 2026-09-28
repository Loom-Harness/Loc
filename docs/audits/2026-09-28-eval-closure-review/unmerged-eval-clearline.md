# u-kllafl — audit of `origin/claude/loom-dsl-evaluation-kllafl` against main d2a0bc02 (2026-09-28)

## Which register is this?
A **third, independent evaluation** (FieldOps 354-line + Clearline models, 47 findings F-001..F-046 + F-040a, plus
`eval/FIX-REGISTER.md` with 12 work packets A–L). It is **not** `eval/fieldops-audit/` on main (that is the parallel
FieldOps eval from branch `67vd8s`/PR #2911, 45+ findings, different numbering) and **not** `eval/` on main (Commons).
The branch shares no merge commit with either; `git diff origin/main...ref` shows every `eval/` file as new.
**Nothing from this register reached main**: no `clearline`/`kllafl`/`FIX-REGISTER` string anywhere on main, and no PR
was ever opened from the branch (list_pull_requests head=…kllafl → empty). Much of it is *indirectly* covered because
#2911 (fieldops-audit) fixed the overlapping defects under its own numbers (see "overlap" column).

Method: re-ran every `eval/repro/*.ddd` + constructed repros for F-022/024/027/039/041/044/032/035 and the breadth
models (`eval/fieldops/breadth/*`) with `node bin/cli.js parse|generate system` on main, inspected emitted code, traced
fixing commits (git log / -L / ancestry), read PR bodies/comments. No toolchains (tsc/mix/dotnet/gradle) or docker run.
Note: every FieldOps model on the branch now FAILS `parse` on main — `loom.e2e-unknown-body-key` (#2958) catches the
eval's own test sending managed `totalAmount`; I patched that line to re-run them. That is a genuine bug in the eval model.

## Work packets (FIX-REGISTER) — did they merge?
| pkt | PR | state 2026-09-28 | findings | landed? |
|---|---|---|---|---|
| A | #2940 | MERGED 09-21 | F-006, F-011, F-041 | F-006 yes, F-011 yes on node/py/dotnet/java — **elixir untouched**; **F-041 explicitly NOT fixed** (PR body) |
| B | #2939 | MERGED 09-21 | F-009, F-030 | yes (+ `test/system/emitted-symbol-binding.test.ts` binder gate) |
| C | #2949 | open draft (upd 09-27) | F-040, F-040a | no |
| D | #2945 | **CLOSED unmerged 09-28 15:29** | F-007, F-023 (+F-005) | superseded: F-023 fixed by #2911, F-007 refused by design; closing comment wrongly says nothing else survives (see X-1) |
| E | #2942 | open, non-draft (upd 09-22) | F-014, F-015 | no |
| F | #2944 | MERGED 09-21 | F-019 | yes (node); F-045/F-046 left as follow-ups, not done |
| G | #2947 | open draft, stale since 09-21 | F-010, F-017, F-021, F-039 | no; F-039 already fixed by #2911 (overlap) |
| H | #2946 | MERGED 09-21 | F-029 (+F-020) | F-029 yes (`src/system/migration-ledger.ts`, `test/system/migration-ledger.test.ts`, `test/cli/generate-system-rebaseline.test.ts`); **F-020 explicitly excluded** ("worth its own mission") |
| I | #2943 | open, non-draft (upd 09-28) | F-022 | no |
| J | #2966 (register says "—") | open draft, dirty, stale since 09-21 | F-024, F-025, F-027, F-033 | no; F-027 + Feliz form-name collision already fixed on main (#2911 / #2923) |
| K | #2948 | open draft, stale since 09-21 | F-016, F-018, F-031 | no; F-016 fixed by #2911, F-031 half-fixed by #2911 |
| L | #2969 (register says "—") | open draft, dirty, stale since 09-21 | F-034 (+F-004 diag, F-042/F-043 scoping) | no |

4 of 12 merged; 1 closed unmerged; 7 open (4 stale dirty drafts untouched for a week).

## Findings
| id | sev | register-status | true-status | evidence | notes / overlap |
|---|---|---|---|---|---|
| F-001 | S4 | not assigned | FIXED-VERIFIED | README.md:180 "There is no global `ddd` on your PATH…"; cb8030124 | via #2911 |
| F-002 | S3 | not assigned (dependency-upgrade skill) | OPEN-TRACKED | `npm audit` still 11 (4 high); M-T9.61 in T9-toolchain-health.md | |
| F-003 | S3 | not assigned | UNVERIFIABLE | needs docker behind TLS proxy | |
| F-004 | S2 | "language-design decision, feature not landed" (L part 2) | FIXED-VERIFIED / **WRONG-CLAIM** | repro now 0 errors; node emits `parts.getById` + save inside `for` in a tx; b383852a2 (#2911 wave 4: "not a gap at all, a validator refusing what all five backends emit") | = fieldops-audit F-002 |
| F-005 | S2 | subsumed by D | DECLINED (by design) | (b)/(c) → `loom.find-where-not-queryable` (collection op / no-column comparison); #2945 closing comment: refusal is "a design decision already shipped" | admin-sees-all/owner-sees-own still inexpressible as a row filter |
| F-006 | S1 | A #2940 | FIXED-VERIFIED | repro → `loom.projection-columnless-source`; `test/ir/projection-columnless-field.test.ts` | |
| F-007 | S1 | D #2945 | FIXED-VERIFIED (as refusal) | repro → `loom.find-where-not-queryable` at validate, no crash; e6486a043; `ownerUserId == currentUser.role` emits `eq(…, requireCurrentUser().role)` | shape not widened (#2945's widening rejected) |
| F-008 | S1 | fixed #2884 | FIXED-VERIFIED | 2 errors "'permissions' is not a claim on the principal" | |
| F-009 | S1 | B #2939 | FIXED-VERIFIED | `import { …, ne } from "drizzle-orm"` in repo + query-projections | = FA F-013 |
| F-010 | S1 | G #2947 | OPEN-TRACKED | `domain/note.ts:64` `NoteLine._create({ id, parentId, text })` vs required `tag: TagId \| null` | stale draft |
| F-011 | S1 | A #2940 | OPEN-UNTRACKED (partial) | node `sum(schema.bills.amount_amount)` fixed; **elixir** `sum(record.amount)` over `field :amount, :map` (jsonb) | #2940 body: elixir half not done; no mission |
| F-012 | S2 | roll-up | OPEN-TRACKED | constituents F-010/014/015/017/040 still open | |
| F-013 | S1 | claimed #2911 | FIXED-VERIFIED | compose `quay.io/minio/minio:latest` | = FA F-020 |
| F-014 | S1 | E #2942 | OPEN-TRACKED | `web/src/pages/home.tsx:13-34` `/* unresolved: JobTotals */ undefined.isLoading`, 0 errors | |
| F-015 | S1 | E #2942 | OPEN-TRACKED | `DocListResponse = z.array(...)` while `touch.tsx:48` reads `__docs.data?.items` | = FA F-018 |
| F-016 | S2 | K #2948 | FIXED-VERIFIED | realm.json: `oidc-usermodel-attribute-mapper` for role/tenantId/permissions; demo user seeded role+tenantId; 727a510af/98d2a9aaf | via #2911 (FA F-022); demo user gets no `permissions` attribute |
| F-017 | S1 | G #2947 | OPEN-TRACKED | `domain/thing.ts:59` `total: null` into `Decimal`, column NOT NULL, 0 diagnostics | |
| F-018 | S3 | K #2948 | OPEN-TRACKED | static: `auth/middleware.ts` builds principal with no missing-tenant-claim 4xx; runtime not re-run | stale draft |
| F-019 | S1 | F #2944 | FIXED-VERIFIED | #2944 merged; `src/generator/_channels/wire-codec.ts`, `test/generator/channels-wire-decode.test.ts` | |
| F-020 | S3 | "+F-020" in H | OPEN-UNTRACKED / **WRONG-CLAIM** | `grep -c restart: docker-compose.yml` = 0; no retry; #2946 "Not in this PR"; no mission (grep unless-stopped/restart policy in docs/ = 0) | |
| F-021 | S1 | G #2947 | OPEN-TRACKED (partial) | top-level list fixed (#2885); containment row `notes/detail.vue:60` `:title="row.tag"` unguarded | |
| F-022 | S1 | I #2943 | OPEN-TRACKED | java: `this.status == WorkOrderStatus.Draft` on an `InvoiceStatus` field | |
| F-023 | S1 | D #2945 | FIXED-VERIFIED | python `require_current_user().id` + import; elixir `^(current_user && current_user.id)`; 06cc6936c + 173035fee (corpus fixture `principal-read-filter`) | via #2911, not D |
| F-024 | S1 | J (#2966) | OPEN-TRACKED | java `CWorkflows.java:31` bare `currentUser.role()`; **.NET too** `CloseJobHandler.cs:29` bare `currentUser.Role` | #2966 only names Java |
| F-025 | S1 | J (#2966) | OPEN-TRACKED | `S3Resources.photosPut(key, Map.of(...))` vs `photosPut(String key, String body)` | |
| F-026 | S1 | claimed #2911 | FIXED-VERIFIED | `ChannelTransport.cs` `namespace Api.Infrastructure.Channels`, `global::Api.Infrastructure…` | = FA F-025 |
| F-027 | S1 | J (#2966) | FIXED-VERIFIED | `field :skills, {:array, Ecto.Enum}, values: [...]`; 173035fee corpus `enum-collection` | via #2911; #2966 scope stale |
| F-028 | S2 | roll-up | OPEN-TRACKED | F-022/024/025 still break java/.NET | |
| F-029 | S1 | H #2946 | FIXED-VERIFIED | see packets | |
| F-030 | S1 | B #2939 | FIXED-VERIFIED | `item.routes.ts` imports Decimal | |
| F-031 | S2 | K #2948 | OPEN-TRACKED (partial) | now prints "1 of which had local modifications (pinnable via .loomignore)" (cf6b6afdf, #2911) but still clobbers and does not NAME the files (report's ask) | = FA F-037 |
| F-032 | S3 | claimed #2883/#2923 | OPEN-TRACKED (partial) | 15/43 freed (state,kind,type,key,data,user,admin,queue,replica,snapshot,mailer,page,store…); 28 still fail (node…feliz, port, design, api, ui, storage, cache, contexts, targets, auth, theme, layout, menu, area, match, emit, let, return) with generic "Expecting token of type '}'" | #3063 draft opened today |
| F-033 | S1 | J (#2966) | UNVERIFIABLE (partial fix) | root cause (duplicate `ScheduleWorkOrderForm`) fixed: `ScheduleWorkOrderOpForm`/`…WorkflowForm` (#2923, 81321b8b2); other 2x errors need `dotnet fable` | |
| F-034 | S2 | L | OPEN-TRACKED | generate from dir with `locales/de.json` → only `web/src/locales/en.json` | #2969 stale dirty draft; = FA F-044 |
| F-035 | S3 | "claimed by #2924" | OPEN-UNTRACKED / **WRONG-CLAIM** | `verify` with `"passed"/"failed"` → "Verified 0/3 … 3 unverified", exit 0, "_No unknown results._"; `src/cli/main.ts:1383` no status validation; #2924 merged without it | |
| F-036 | S3 | claimed #2911 | FIXED-VERIFIED | README:405-413 corrected (66c8d0e80) | = FA F-045 |
| F-037 | S2 | project health | DECLINED | not a code change | |
| F-038 | S2 | honest by design | DECLINED | still refused with the same diagnostic; D-POLYMORPHIC-ID-REPRESENTATION | |
| F-039 | S1 | G #2947 | FIXED-VERIFIED | `isNull(schema.ts.tech)`; 06cc6936c (#2911) | #2947 scope stale |
| F-040 | S1 | C #2949 | OPEN-TRACKED | 0 errors; `get bad1() { return this._s.totallyMadeUpMember; }` | |
| F-040a | S1 | C #2949 | OPEN-TRACKED | `this._limit.amount > this._deductible.amount` on Decimal | |
| F-041 | S1 | A #2940 | OPEN-UNTRACKED | `from(schema.autoClaims)`; schema has only `claims`; #2940 "free for another agent to claim"; no mission | |
| F-042 | S3 | L part 2 scoping | OPEN-UNTRACKED (design) | messages.ts:492 "Pick exactly one per (context, kind)"; only a promised write-up in stale #2969; no mission | |
| F-043 | S2 | L part 2 scoping | OPEN-UNTRACKED (design) | `requires` has no `can_*` companion; no mission | |
| F-044 | S2 | branch-only (post-#2944) | OPEN-UNTRACKED | consumer `domain/value-objects.ts` empty while `events.ts` imports `Price`/`Level` from it | |
| F-045 | S2 | branch-only | OPEN-UNTRACKED | dotnet/emit/channels.ts:107 & python/dispatch-builder.ts:1254 "No `optional` leaf" | |
| F-046 | S4 | branch-only | OPEN-UNTRACKED | typescript/emit/channels.ts:502 `envelopeFor … as unknown as` | |
| X-1 | S1 | FIX-REGISTER "D found beyond brief" | OPEN-UNTRACKED / **WRONG-CLAIM** (#2945 close comment) | declared `find all(): Doc[] where ownerUserId != ""`: node/java/dotnet apply it; python `async def all` → `select(DocRow)` no where; elixir `Repo.all(Api.C.Doc)` | silent row-filter drop |
| X-2 | — | "consume-failure visibility" | OPEN (partly tracked) | `channelConsumeFailed` still `warn`; DLQ items exist in T4 | |

## Counts (47)
FIXED-VERIFIED 16 · OPEN-TRACKED 17 · OPEN-UNTRACKED 9 (+X-1) · DECLINED 3 · UNVERIFIABLE 2.
Wrong claims: F-004, F-020, F-035, the #2945 close comment (X-1), and FIX-REGISTER listing J/L without PRs.

## Top problems
1. **X-1 (S1, silent):** a declared `find all() where` predicate is dropped on python and elixir. #2945 found it, then closed saying nothing survives. Nothing tracks it now.
2. **F-041 / F-011-elixir:** the "projection resolves against the domain model" class still has two live instances. #2940 said so and nobody picked them up.
3. **F-035:** marked "claimed by #2924", but #2924 merged without fixing it; `verify` still says "No unknown results" on a status typo.
4. **F-020:** there is still no restart policy and no connect retry. #2946 deferred it "to its own mission", and that mission was never written.
5. **F-044/F-045/F-046:** the follow-ups to the F-019 fix exist only on this branch.
6. G/J/K/L are stale dirty drafts from 09-21 whose scopes are half-done on main (F-016, F-027, F-039, the Feliz collision). They block nobody, but they keep claiming work: close them or rescope.
7. The register never reached main. Its unique deltas (above, plus F-024-on-.NET, F-032's 28 remaining words and the Clearline findings F-038 to F-043) should be ported into `docs/new-plan/` missions, not merged as a fourth `eval/` tree.

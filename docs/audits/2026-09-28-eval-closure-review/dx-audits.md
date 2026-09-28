# dx-audits — true status of the 2026-09-10 dev-experience + independent audits (main @ d2a0bc02, 2026-09-28)

Scope: `docs/audits/2026-09-10-{eshop-dev-experience,claimshub-dev-experience,freight-dev-experience,freight-fleet-plan,independent-completeness-audit}.md`.
Method: re-ran repros under `scratchpad/review/tmp-dx-audits/` (parse + generate system on node/dotnet/python/java/elixir/react/vue, grepped emitted output), `git log` for merge commits, grepped `docs/new-plan/**` (live + archive) for each mission id.

## eshop-dev-experience (#2862)

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| D1 crudish vs denyByDefault | P1 | coverage: G1 → #2877 | FIXED-VERIFIED (crudish) | #2877 merged 1d054db47; `crudish.macro.ts:51-62` `requires:` param; `messages.ts:2728` `#denybydefault-is-reachable-macro` | scaffoldPaged half → M-T5.31 slice 3 (OPEN-TRACKED) |
| D1 sub: hand-written handler same name as macro's | P3 | not tracked | OPEN-UNTRACKED | `queryHandler ListItemBySellable` beside `scaffoldPaged(of: Sellable)` → 0 errors; the macro handler (and the repo `run` method) silently vanish from output | no duplicate-name diagnostic |
| D2 UI-gate codegen throw | P1 | coverage → #2871 | FIXED-VERIFIED | #2871 (3ff21f7b8) commit 4392144f0 `loom.page-gate-not-client-evaluable`; repro now emits `currentUser.permissions.includes("sd.manage")` on instance pages, no throw | |
| D3 markup in collection-op lambda | P2 | → #2871 | FIXED-VERIFIED | commit 6894856bb | |
| D4 money in text slot | P2 | → #2871 | FIXED-VERIFIED | commit 37ca1dd18, `loom.money-in-text-slot#replace/#wrap` | |
| D5 optional VO hydration (node) | P1 | → #2872 | FIXED-VERIFIED | node hydrate emits `root.office_city!` etc.; #2872 da0ea39c4 | |
| D6 `X id?` user claim | P1 | → #2869 (coverage mislabels as "D1") | FIXED-VERIFIED | node `Ids.CustomerId \| null`, dotnet `CustomerId? CustomerId`, python imports `CustomerId`, java `import …domain.ids.*` | |
| D7a filter bar lost on find→criterion | P2 | coverage: part of G2 "no PR" | OPEN-UNTRACKED (partial) | M-T5.31 lists route/requires/scaffoldPaged retirement only; G2 axis 4 (scaffold scans retrieval params) is in no mission | |
| D7b index suggestions blind to criterion | P2 | → #2874 | FIXED-VERIFIED | commit 53718daed; repro suggests `Item.qty` (criterion-only column) | |
| D7c dead client hook / find deprecation | P2 | → #2874 interim + G2 | OPEN-TRACKED | 2261fa5f4 narrowed warning to contexts with a criterion/retrieval; route parity = M-T5.31 `open` | |
| D8 aggregate with no creator | P3 | (F6 → "#2861 slice 4 or dropped") | FIXED-VERIFIED | `parse` prints suggestion "No code path can create a 'Ghost'…" | advisory channel, not error |
| D9 / G3 `this.x :=` | P2 | → #2873 | FIXED-VERIFIED | `this.name := name` / `this.total := 0.50` parse clean; #2873 d5dc5a9c2 | |
| D10a / G4 commas | P3 | → #2873 | FIXED-VERIFIED | `user { id: string, role: string }`, `aggregate … { a: string, b: money }` parse | |
| D10b `carries: [..]` doc | P3 | papercut agent F11 (never missioned) | FIXED-VERIFIED | `docs/language.md:337` now "bare comma-separated list — no [ ]" | |
| D10c migration-rename fix text omits ROOT-level | P3 | F11, never missioned | OPEN-UNTRACKED | `src/system/migrations-builder.ts:1210` still prints `migration "<name>" { … }` with no placement; `migration` inside `system` still `Expecting '}'` | |
| D10d `api` no deployable `serves:` is silent | P2 | F11, never missioned | OPEN-UNTRACKED | `api CatalogApi with scaffoldPagedApi(of: Sellable) from Sd {}` + no `serves:` → 0 errors, 0 warnings | only `loom.resource-api-unserved` exists (resource binding case) |
| D10e / G5 IR diagnostics carry no file:line | P2 | coverage: "deliberately open, no PR" | OPEN-UNTRACKED | `LoomDiagnostic` (`src/ir/validate/checks/diagnostic.ts`) still `{severity,message,source,code}`; `loom.ui-read-unresolved page 'OnlyLive': …` printed without position | no mission in new-plan |
| D10f `'requires' must be bool, got unknown` | P3 | F11 | FIXED-VERIFIED | undeclared permission now `loom.unknown-permission … permissions.manage` | |
| docs-fence CI ratchet | P2 | coverage: "deliberately open, no PR" | FIXED-VERIFIED / WRONG-CLAIM | `test/system/first-run-examples-parse.test.ts` (12e66c76d + all-docs sweep) parses every ` ```ddd ` fence | coverage row still lists it as open |
| G1 macro gate surface | P1 | → #2877 | FIXED-VERIFIED | see D1 | |
| G2 retrieval parity (6 axes) | P1 | "no PR" | OPEN-TRACKED (axes 2,3,6) | M-T5.31 `open` | axis 4 untracked (D7a) |
| P1 Phoenix filtered read → `list_*` | P0 silent | → #2870 | FIXED-VERIFIED | elixir repro emits `Api.C.by_state_item(:Live)`; unknown read → `loom.ui-read-unresolved` | |
| P2 id-claim 4 backends | P1 | #2869 | FIXED-VERIFIED | see D6 | |
| P3 dotnet optional VO scalar mapping | P1 | #2872 | FIXED-VERIFIED | `PersonConfiguration.cs:29 builder.OwnsOne<Addr>(x => x.Office …)` | |
| P4 Vue 31 errors | P1 | coverage mislabels "P8 → #2876" | FIXED-VERIFIED | #2876 a618cd1c3 (f5295a688) | not re-compiled here |
| P5 Svelte hook arity | P2 | #2876 | FIXED-VERIFIED | f5295a688 | |
| P6a widen field-name soft keywords | P2 | "#2883 independently claimed" | PARTIAL → OPEN-UNTRACKED | `type`,`user`,`index`,`policy`,`deny`,`slot` now OK; `event`,`header`,`document`,`layout`,`log`,`main`,`provider`,`required`,`seed`,`storage`,`test`,`theme`,`unique`,`work` still fail | |
| P6b "`X` is reserved here" message in field position | P3 | F11 | OPEN-UNTRACKED | `aggregate A { event: string }` → `Expecting token of type '}' but found \`event\`` (the keyword message exists only for declaration names) | |
| P7 non-optional id claim dev-stub | P1 | coverage: "still open, no PR" | FIXED-VERIFIED / WRONG-CLAIM | #2900 merged a49eb4ab1 | coverage row wrong |
| P8 money in VO array (vue/svelte) | P2 | #2902 | FIXED-VERIFIED | #2902 e7a4af0a3 | |
| P9 CHECK all-null-or-all-present | P3 | coverage: "still open, no PR" | FIXED-VERIFIED / WRONG-CLAIM | #2904 (c4e85b4ee); `persons_office_null_consistent CHECK` in node/python/java/dotnet migrations | |
| P10 Phoenix filter bar decorative | P1 | #2906 | FIXED-VERIFIED | #2906 f90fdd159 | |
| P11 python nested VO | P0 runtime | coverage: "still open, no PR — most severe" | FIXED-VERIFIED / WRONG-CLAIM | #2901 4da21c0e8; python repo writes `home_geo_lat`/`home_geo_lng` | |
| P11 java `toGeo` missing | P1 | #2901 | FIXED-VERIFIED | #2901 | |
| P11 dotnet CS0136 | — | corrected | DECLINED (not a defect) | doc correction | |
| P12.1 python hydrate mypy | P1 | #2872 | FIXED-VERIFIED | `required(row.office_city)` | |
| P12.2 python optional VO subfield default | P1 | #2872 | FIXED-VERIFIED | `wire_models.py:83 line2: WireStr \| None = None` | |
| P12.3 elixir `__money_round` binary | P0 runtime | #2872 | FIXED-VERIFIED | `person_controller.ex:195 defp __money_round(bin) when is_binary(bin)` | |
| P12.4 elixir update clears omitted optional | P1 | #2872 | FIXED-VERIFIED | `person_changeset.ex:31 __clear_absent(attrs, @update_optional)` | |
| P13 inspect of optional scalar | P3 | (landed text) | FIXED-VERIFIED | #2920; node `(this._nickname === null ? "null" : …)` | |
| Angular unverifiable caveat | — | corrected in doc | DECLINED (retracted) | | |
| Header tally | — | coverage: "Eleven defects D1–D10 / P1–P11" | WRONG-CLAIM | body has D1–D10 + P1–P13 | coverage also mislabels D6→"D1", P4/P5→"P8" |

## claimshub-dev-experience (#2865)

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| D1 softDelete hook `string\|undefined` | P2 | doc: "fix in flight #2878, open, not merged" | FIXED-VERIFIED / WRONG-CLAIM | #2878 merged 2026-09-13 (9f6984f7d); `controls.ts:257 ?.id ?? ""` | doc "amended 2026-09-20" still says open |
| D2 `currentUser.<undeclared>` | P1 | doc: "#2884 open" | FIXED-VERIFIED / WRONG-CLAIM | #2884 merged 2026-09-13; `messages.ts:1636 loom.unknown-user-claim` | |
| D3 crudish update bypasses gate | P1 | doc: "#2965 in flight" | FIXED-VERIFIED / WRONG-CLAIM | #2965 merged 2026-09-21; repro prints `loom.update-gate-suggestion` advisory | |
| D3 deferred axis (precondition-only operations) | P2 | "recorded as deferred decision" | OPEN-UNTRACKED | no mission/decision in new-plan or decisions.md mentions it | |
| D4a `policy` field name | P3 | doc: "#2883 open" | FIXED-VERIFIED / WRONG-CLAIM | #2883 merged 2026-09-13; `policy: string` parses | |
| D4b `operation deny()` declaration name | P3 | "separate decision, pinned by a test" | OPEN-UNTRACKED | `operation deny()` → "'deny' is a Loom keyword…"; no mission/decision | |
| coverage row "all still open as of 09-13" | — | coverage.md:236 | WRONG-CLAIM (stale) | all four merged | |

## freight-dev-experience (#2864) + freight-fleet-plan

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| D1 VO-collection phantom column in diff | P0 data | M-T2.15 | FIXED-VERIFIED | #2875 a7439c9c1 (5852eefa7) + #2899 FK | no M-T2.15 heading anywhere |
| D2 managed/internal default dropped | P1 | M-T6.63 | FIXED-VERIFIED | #2882 1f25ff0c6; node `_create` emits `nm: 7, mm: new Decimal("2.50")` | no heading |
| D3 VO with `X id` no imports | P1 | M-T6.64 | FIXED-VERIFIED | #2881; `emitted-unbound-symbols.test.ts` WAIVERS empty | no heading |
| D4 / T3 enum-stated workflow schema (backend + FE) | P1 | M-T6.65 | FIXED-VERIFIED | #2894; `api/http/workflows.ts:13` + vue `web/src/api/workflows.ts:7 export const StSchema` | no heading |
| D5 `handle` emits nothing | P1 | D-1(c) | DECLINED (diag) + OPEN-TRACKED (emitter) | #2896 `loom.workflow-handle-unsupported`; M-T6.58 `partial` | |
| D6 entity-part param | P1 | D-2 reject | DECLINED | #2896 `loom.entity-part-param-unsupported` | |
| D7 / T2 command-typed workflow param wire type | P1 | M-T6.67a | FIXED-VERIFIED | #2886 7534696f9 | no heading |
| G1 field default → DDL | P2 | M-T2.16 (D-3) | FIXED-VERIFIED | #2895 (d4e7c77fd) | id M-T2.16 now names a different live mission |
| G2 reactor without starter | P2 | M-T5.30 | FIXED-VERIFIED | #2896 `loom.reactor-without-starter`; M-T5.34 `done` | renumbered M-T5.30→M-T5.34 |
| G3 mask/secret in sort allowlist | P1 sec | M-T3.18 | FIXED-VERIFIED | #2889 440dd2448; `sortable-fields.ts:48,55` | no heading |
| G4 VO collection required create input | P2 | M-T5.30 | OPEN-TRACKED | M-T5.35 `open` | |
| money("…") Chevrotain ambiguity | P3 | M-T9.60 | FIXED-VERIFIED | #2888 f051f366f | no heading |
| two contradictory summary lines | P3 | M-T9.60 | FIXED-VERIFIED | #2888 7f714321d; parse prints one summary | |
| stale migration baseline | — | retracted | DECLINED (retracted) | 03f1f2eec | |
| reserved words `File`/`slot` unexplained | P3 | papercut | FIXED-VERIFIED | `command File` → "'File' is a Loom keyword…"; `slot:` field OK (4feaf2187) | |
| VO subform picker/datetime/error | P3 | M-T1.32 | FIXED-VERIFIED | #2914 (7189d4619) | id M-T1.32 now a Flutter mission |
| T1 id-claim 4 backends | P1 | #2862 | FIXED-VERIFIED | #2869 | |
| T4 nullable `X id?` link, 6 frontends | P1 | M-T1.33 | FIXED-VERIFIED | #2885 (d8b5f7c11) | id M-T1.33 now Angular extern |
| T5 Svelte picker redeclared | P1 | M-T1.34 | FIXED-VERIFIED | #2879 (1c5caf1d3) | id M-T1.34 now Flutter Riverpod |
| T6 python channel-tee annotation | P3 | M-T6.68 | FIXED-VERIFIED | #2889 d3c4931de | no heading |
| T7a Angular root tsconfig includes e2e | P3 | wave 3 #13 | FIXED-VERIFIED | #2905 d59d8a0e7 | |
| T7b no `@playwright/test` | — | retracted | DECLINED (retracted) | 03f1f2eec | |
| T7c ng build Node floor 22.22.3 | P3 | wave 3 #13 | UNVERIFIABLE | env note; eshop doc shows Node-24-on-PATH workaround; no fix/mission, doc bullet unannotated | |
| fleet "free" note: `language.md` create body "populates fresh this" | P3 | no mission | FIXED-VERIFIED | 60940c934 | |
| fleet M-T9.59 unresolved-symbol gate | P1 | Wave 0 | FIXED-VERIFIED | 3772511f1 `test/system/emitted-unbound-symbols.test.ts`, WAIVERS empty | id M-T9.59 now the independent audit's register mission (collision) |
| fleet plan: 13 missions minted | — | coverage.md:240 "Missioned … M-T2.15 … M-T9.60" | WRONG-CLAIM | none of M-T2.15, M-T6.63/64/65/66/67a/68, M-T3.18, M-T9.60 exists as a heading in `docs/new-plan/` or `archive/`; M-T1.32/33/34, M-T5.30, M-T9.59, M-T2.16 headings now name DIFFERENT missions | ~14 fixes have no tracker record |
| fleet plan tally "Thirteen missions: one gate, five, four, four" | — | | WRONG-CLAIM | 1+5+4+4 = 14 | |
| fleet "DECIDED… missions in flight" / D-1 "landing in M-T5.30" | — | | WRONG-CLAIM (stale) | landed via #2896 as M-T5.34; M-T5.30 is now `for … in …` | |
| D-4 re-price M-T3.16 | — | | FIXED | M-T3.16 `done` 2026-09-28 (archive/T3-done.md:48) | |

## independent-completeness-audit

| id | sev | register-status | true-status | evidence | notes |
|---|---|---|---|---|---|
| F1 .NET `amount`/`Amount` collision | P1 | M-T6.69 | OPEN-TRACKED | repro still `loom.dotnet-name-collision` | |
| F2 register membership by suffix | P1 | M-T9.59 | OPEN-TRACKED | T9:855 `open`; register still has no `dotnet-name-collision` row | id collides with fleet's landed M-T9.59 gate |
| F3 deep fuzz red, unwired | P1 | M-T9.64 | OPEN-TRACKED | `grep fuzz .github/workflows` → only schemathesis/pr-gate/ci-red-alarm | M-T9.22 re-statused `partial` ✓ |
| F4 not installable | P1 | M-T8.24 | OPEN-TRACKED | package.json still no files/exports/repository; packages all `0.0.0-experimental` | |
| F5 no advisory/freshness gate | P2 | M-T9.61 | OPEN-TRACKED | no dependabot/renovate; `stacks/v1` React ^18.3 / zod ^3.23 used by chakra/v2, mantine/v7, mui/v5, shadcn/v3 | |
| F6 walker-give-up glob | P0 | M-T9.55 | FIXED-VERIFIED | #2843 | |
| F7 denominators | P1 | M-T9.62 | OPEN-TRACKED | `open` | |
| F8 tiers CI never runs | P2 | M-T9.64/M-T9.13 + CLAUDE.md blind spot | OPEN-TRACKED | | |
| F9 frontend corpus skew | P2 | M-T9.63 | OPEN-TRACKED | | |
| F10 no `ddd fmt` | P2 | M-T8.25 | OPEN-TRACKED | no `fmt` in CLI, no formatting provider | |
| F11 nothing reads wire-spec.json | P2 | M-T2.16 | OPEN-TRACKED | T2:41 `open` | id M-T2.16 also claimed by #2895 (field-default DDL) — coverage's "verified free at mint" is wrong |
| F12 sales-ui.ddd doesn't parse | P2 | M-T9.51 | OPEN-TRACKED | `parse examples/sales-ui.ddd` → 1 error | |
| F13 register rows unreviewed | P3 | coverage: "folds into M-T9.27" | WRONG-CLAIM → OPEN-UNTRACKED | M-T9.27 section has no F13 text; register now 21 `verified: true` / ~62 rows | |
| fold-in: user-component-deferred-target as M-T1.20 7th row | — | fold | FIXED (docs) | T1:242 | |
| fold-in: M-T9.13 drain ordered by runtime risk | — | coverage: fold, no mission | WRONG-CLAIM → OPEN-UNTRACKED | M-T9.13 text unchanged, no runtime-risk ordering | |

## Top problems

1. **The freight fleet's missions were never registered.** ~14 fixes (#2875, #2881, #2882, #2885, #2886, #2888, #2889, #2894, #2895, #2896, #2905, #2914, #2879, gate 3772511f1) landed under ids that have no heading in `docs/new-plan/` or `archive/`; coverage.md:240 claims "Missioned … M-T2.15 … M-T9.60".
2. **Mission-id collisions.** M-T9.59 (fleet gate, landed vs. independent-audit register mission, open), M-T2.16 (#2895 field-default DDL vs. live `ddd diff`), M-T1.32/33/34 and M-T5.30 (fleet usage vs. unrelated live headings). Commit history and docs cite the same id for different work.
3. **Stale "open" claims.** Claimshub doc (amended 09-20) still says D1/D2/D4 PRs are unmerged (merged 09-13). The eshop coverage row lists P7/P9/P11 and the fence gate as "still open, no PR", but all four landed. It also mislabels defect ids and gives the tally as P1–P11 when the body runs to P13.
4. **Leftovers from the never-missioned papercut agent (eshop F11/F12).** G5 (no file:line on IR diagnostics), an api that no deployable serves is silent, the migration-rename hint doesn't say "root level", and P6 has both open items: 14 field words still reserved, and the error still doesn't name the reserved word.
5. **Deferred items with no follow-up:** claimshub D3's precondition-only axis, `operation deny()`, G2 axis 4 (the scaffold filter bar over retrieval params), a duplicate handler name next to a macro-emitted one, and the independent audit's F13 and M-T9.13 fold-ins, which were never applied.

# eval-fieldops/ register audit — main @ d2a0bc02 (2026-09-28)

Scope: `eval-fieldops/{FINDINGS,EVALUATION-REPORT,EVAL-LOG,README}.md`, findings F-001…F-026.
Method: I re-ran every repro under `eval-fieldops/repro/` with `node bin/cli.js parse` and `generate system`, swapping `platform:` where a finding is about a specific backend or frontend. I then inspected the emitted source, read the fix commits and PR bodies (#2980, #2981, #2982, #2983, #3015, #3045, #3046), and ran the four pinning test files: 35 tests passed.
Scratch output: `scratchpad/review/tmp-eval-fieldops/`.

**Scope note.** The task text lists "Waves 4/5, F-102, F-041/F-038 NOT landed, F-023b". Those commits edit `eval/fieldops-audit/FINDINGS.md`, which is a different evaluation with its own F-numbering, not `eval-fieldops/`. F-102 appears in no register at all. They are covered in a short appendix and are not counted below.

| id | sev | register status (FINDINGS.md) | true status | evidence | notes |
|---|---|---|---|---|---|
| F-001 `ddd` not on PATH | S4 | "still reproduce" (9/14 table); no later disposition | FIXED-VERIFIED (residual) | cb8030124; README:180-186 now says `node bin/cli.js` / `npx ddd` | Residual, OPEN-UNTRACKED: `ddd new` prints `cd <dir> && npx ddd generate …` (src/cli/main.ts:1197). Outside the clone, `npx ddd` resolves to the unrelated public npm package `ddd` ("Plot common visualizations…", `npm view ddd`). That is a wrong command and a supply-chain footgun. |
| F-002 `/api` prefix undocumented | S4 | "still reproduce" | FIXED-VERIFIED | cb8030124; README:166 documents `/api/orders` | — |
| F-003 cross-agg invariant (4 break, elixir drops) | S1 | "still reproduce" | FIXED-VERIFIED | Repro A now fails with 2 errors ("references 'Technicians', which is a repository…"); 28ac285f2 / 628f944c1 (rule-expr purity) | The refusal is at the validator, so all five backends are covered. |
| F-004 positive (workflow) | n/a | positive | n/a | — | — |
| F-005 `ignoring tenantOwned` unflagged | S2 | "still reproduce" | FIXED-VERIFIED | C2/C3/C4 now emit `loom.tenancy-filter-bypass` in every enforcement mode; 965c6b782; docs/tenancy.md:13,218 | The finding's premise that "`enforcement: opt` is the LANGUAGE DEFAULT" is itself now false: M-T3.1 flipped the default to denyByDefault (6fdcc6112, 2026-09-28; docs/auth.md:25). |
| F-006 invariant over parts removes `create`; call sites don't compile | S1 | "still reproduce" | FIXED-VERIFIED | G2 now fails with `loom.create-call-not-constructible` ×2; 28ac285f2 | README's "headline" recipe for F-006 (`generate … G2 … && tsc`) now stops at generate. The recipe is stale. |
| F-007 criterion `!= null` → `ne(col,null)` | S1 | "still reproduce" + correction note | FIXED-VERIFIED | Repro E emits `isNotNull(schema.workOrders.technicianId)`; 70c8a6834 | — |
| F-008 compose `minio/minio:latest` | S2 | CLAIMED by #2911 | FIXED-VERIFIED (UNVERIFIABLE residual) | src/system/index.ts:1283 `quay.io/minio/minio:latest`; all regenerated composes use it | I could not confirm that the quay.io tag is still published: the quay API returned 401 and Docker was not started. MinIO's community image distribution has been shrinking, so the fix needs a boot check. |
| F-009 by-id read ungated under denyByDefault | S2 | "still reproduce" | FIXED (diagnostic) + OPEN-TRACKED (gate surface) | Repro I now warns `loom.default-deny-by-id-ungated`; docs/auth.md:61-70 lists the by-id exception; the gate surface is M-T3.19 (`open`, T3:106) | The M-T3.19 heading still says "…and says nothing". Its body (line 23) records that the diagnostic landed, so only the heading is stale. |
| F-010 language.md `carries: [...]`; `create { }` | S3 | "still reproduce" | FIXED-VERIFIED | docs/language.md:337 (bare list, no `[ ]`); 06-behavior…md:389 ("The parens stay"); cb8030124 wired both docs into first-run-examples-parse | — |
| F-011 .NET channel CS0234 | S1 | CLAIMED by #2911 | FIXED-VERIFIED | Repro J: ChannelTransport.cs:239,244 now `global::Api.Infrastructure.Events…` | — |
| F-012 Java `mask unless` missing `Objects` import | S1 | ALREADY FIXED | FIXED-VERIFIED | Repro K: the file using `Objects.equals` has 1 `import java.util.Objects` | — |
| F-013 criterion `currentUser` broken on python/elixir | S1 | "still reproduce" | FIXED-VERIFIED (both backends) | main.ddd→python: `require_current_user().id`; →elixir: `^(current_user && current_user.id)` | — |
| F-014 `enum[]` invalid Ecto type | S1 | "still reproduce" | FIXED-VERIFIED | Repro L: `field :skills, {:array, Ecto.Enum}, values: [...]`; 4cbb0d615 tracks the repro as a regression guard | — |
| F-015 generated Python fails its own ruff | S3 | "3 of 4 fixed, F841 deferred as a language-design decision" | PARTIAL: F821/E714 FIXED; F841 OPEN-UNTRACKED | `ruff check` on regenerated FieldOps python: 1 error, F841 `tech` at app/http/workflows_routes.py:47 | No mission or decision record anywhere (grepped new-plan and decisions.md for unused-let/F841). The "language-design, not a bug" framing is also weak: the python workflow emitter already drops a dead binding and keeps the awaited call for `run`-retrieval and `exprLet` lets (workflows-builder.ts:1009-1020), and routes-builder.ts:1117 does the same for the destroy "404 probe". Only the `getById` let arm lacks that pattern. |
| F-016 Angular `enum[]` FormControl | S1 | CLAIMED by #2927 | FIXED-VERIFIED | Repro M: `skills: new FormControl<string[]>([], { nonNullable: true })` | — |
| F-017 Feliz 14 errors (dup form record) | S1 | "still reproduce" | FIXED-VERIFIED | Repro N: `TechCreateForm` / `ScheduleWorkOrderOpForm` / `ScheduleWorkOrderWorkflowForm`, each name once | The Guid/string half was taken from the PR #2980 body; I did not re-compile it. |
| F-018 rename heuristic mis-migrates, drops backfill | S1 | "still reproduce" | FIXED-VERIFIED | v1→v2 now aborts as destructive (DROP bin_code). With `--allow-destructive` it emits DROP + ADD `supplier_ref` + `UPDATE … 'NO-SUPPLIER'`, with no RENAME; 3b17acadd | — |
| F-019 hand edits overwritten silently | S3 | "still reproduce" | FIXED-VERIFIED | Regenerating over an edited file prints "1 of which had local modifications (pinnable via .loomignore)"; cf6b6afdf | — |
| F-020 cyclic containment RangeError | S2 | "still reproduce" | FIXED-VERIFIED | broken/05 now fails: "Cyclic containment in aggregate 'A': X → Y → X"; 28ac285f2 | — |
| F-021 `ddd breakpoints` → line 1 | S3 | "still reproduce" | FIXED for operations; residual OPEN-UNTRACKED | Line 203 (`operation complete`) → workOrder.ts:157 and line 210 → :166 (51943196b). **Line 150 (field decl, one of the finding's own samples) still → `workOrder.ts:1` + `workOrder.routes.ts:1`.** | Operation lines no longer map to the route file at all (1 location, previously 2). Workflow/criterion header lines honestly answer "No generated location". Field lines still answer a misleading `:1`. |
| F-022 Prometheus can't scrape `/metrics` | S3 | "still reproduce" | FIXED-VERIFIED | monitoring/prometheus.yml header: /metrics is on the auth-bypass list; 8a29d29a3 | The trade-off (unauthenticated /metrics) is documented in the emitted config. |
| F-023 op/workflow name collision on React/Vue/Svelte | S1 | **"not fixed"** | FIXED-VERIFIED → WRONG-CLAIM | PR #2983 / 10f1ebaea (`src/generator/_frontend/request-names.ts`); regenerated N-react/vue/svelte/angular import `WorkflowScheduleWorkOrderRequest`; test/generator/_frontend/request-name-collision.test.ts passes | The register (and #2980's body) still say not fixed. |
| F-024 Feliz `For` in QueryView data lambda `yield!` | S2 | **"not fixed"** | FIXED-VERIFIED → WRONG-CLAIM | PR #2981 / a7f437ab7; test/generator/_walker/for-value-slot.test.ts + child-slot-ratchet pass | — |
| F-025 workflow param `id` → `this._id` | S1 | **"Not fixed"** | FIXED-VERIFIED → WRONG-CLAIM | PR #2982 / 1e0607741; my repro emits `workOrders.getById(id)` (node) and `get_by_id(id)` (python); test/ir/id-binding-shadow.test.ts passes | — |
| F-026 OpenAPI request component minted twice | S2 | FIXED node/elixir/java; census gate in | FIXED-VERIFIED | repro f026: node `WorkOrdersScheduleWorkOrderRequest` / `WorkflowsScheduleWorkOrderRequest`; elixir two schema files; java `@Schema(name=…)` ×2. #3015 (node), #3045 (elixir), #3046 (java + census 232c923e1). request-component-collisions.test.ts passes. | The census covers node and java only, and the register says so honestly. The PR #3015 title "(elixir/java scoped out)" was accurate when it merged. |

## Register-level WRONG-CLAIMs / stale tallies

1. **FINDINGS.md never recorded dispositions for F-001…F-022.**
   - The only status block is the 2026-09-14 re-verification table ("17 still reproduce … 17 unclaimed and mine to fix"), and every finding body still reads as open.
   - On main, 20 of those 22 are fixed, plus F-009's diagnostic and most of F-015 and F-021.
   - A reader of the register alone would conclude that most S1s are live.
2. **F-023, F-024 and F-025 are marked "not fixed" / "Not fixed"** in FINDINGS.md and in PR #2980's body. All three were fixed by #2983, #2981 and #2982, merged 2026-09-22.
3. **README.md says "22 numbered findings (F-001…F-022)"**, but the register holds F-001…F-026.
   - The README's "the S1s, each self-contained" recipe for F-006 now fails at `generate` (by design, since the model is refused).
   - The `repro/f026/` folder is not listed.
4. **EVALUATION-REPORT.md §6 and §10 are an unmarked point-in-time snapshot.**
   - They say "22 findings", "15 silent to 2 documented", and give a Top-10 fix list.
   - Top-10 #2 (F-018), #4 (F-006/F-003), #6 (F-011/12/13/14/16), #7 (denyByDefault default + F-005 warning), #9 (F-019) and #10 (F-020/F-021) have all landed. #8 (F-009) is half done.
   - Nothing marks the report as superseded.
   - F-005's text also states that `enforcement: opt` is the language default. That stopped being true with M-T3.1 (2026-09-28).
5. **The F-015 F841 residual is framed as "a language-design decision, not a bug fix".** The emitter already applies the drop-binding-keep-call pattern on sibling arms (see the table row), so this is fixable in codegen. No mission or decision tracks it either way.
6. **M-T3.19's heading still says "and says nothing"**, although `loom.default-deny-by-id-ungated` landed (the body acknowledges this). This is minor.

## Appendix — items the task named that belong to `eval/fieldops-audit/` (not counted)
- F-023a/F-023b (If-Match precondition): commits 591b7a510, ad92e91b2 and d4f3e5353 are in main; test/generator/if-match-client-parity.test.ts exists.
- F-041 (page-body lambda typo; silent KeyError on HEEx), "NOT landed": OPEN-TRACKED by M-T5.33 (T5-language-core.md:215, `partial`). The mission does not name F-041 or its HEEx runtime-break consequence.
- F-038 (no lockfiles; five different pinning stances), "NOT landed — maintainer's call": OPEN-UNTRACKED. No mission or decision in new-plan (grepped "lockfile"; T9:1088 is unrelated).
- F-102: f640f33b7 (projection VO import filtered by reachability) is in main. The ID appears in no register or doc (grep F-102 → none), so it is an orphan ID.

## Top problems
1. The register is badly stale in the "looks open" direction: 20 of 22 original findings plus F-023, F-024 and F-025 are fixed on main, and nothing in `eval-fieldops/` says so.
2. F-015's F841 is still live: the generated FieldOps Python fails its own declared ruff. It is untracked, and a codegen fix pattern already exists in-tree.
3. The `ddd new` hint `npx ddd …` resolves to an unrelated npm package when run outside the clone. This is untracked.
4. F-021 is only fixed for operations. A field-declaration line still resolves to a misleading `:1`, which is untracked.
5. The quay.io MinIO replacement image (F-008) has not been boot-verified here and deserves a live pull check.

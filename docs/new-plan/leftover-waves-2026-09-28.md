# Leftover waves — 2026-09-28 (what the 09-07 → 09-28 merges left behind)

*Snapshot: `main` @ `d2a0bc02` (2026-09-28), 187 merges since 2026-09-07, 24 open PRs (15 draft claims). Fourth plan in the 2026-09 series. It **does not replace** [`completion-waves-2026-09.md`](completion-waves-2026-09.md). That plan keeps its end-state table (§1), and its C3 wave is claimed by #3058. This plan covers the **residue**: items that merged PRs deferred, scoped to one backend, or described only in prose, and that no wave row, mission heading or open PR owns. It also covers the unexecuted C6/C7 remainder, ordered so that it can be fanned out to agents. Mission statuses stay in the track files; this plan forks nothing.*

*Method: seven read-only agents, all working from fresh `main`. Five read every merged PR body and the review threads of the large PRs, split by date range. One audited `docs/new-plan/`. One audited every in-code waiver or ratchet ledger. Every item below was re-checked on `d2a0bc02`. **"repro"** means the agent generated the model with `bin/cli.js` and saw the defect. Items that later merges had already fixed were dropped. Items claimed by an open PR are listed in §5 and are excluded everywhere else.*

---

## 0. Headline

- **Where the completion plan stands:** C0, C1, C2, C4 and C5 are merged. C3 is claimed only by #3058, which is still a draft with nothing landed. C6 (product completion) and C7 (docs truth + closing audit) **have not started**.
- **Distance to "done"** (`node scripts/completion-denominators.mjs`):
  - Register LIVE `gap` rows: **17**. C2 closed at 16; `ui-multi-backend` was added on 09-27.
  - Ledger P2/P3: **1/30**; P4/P5: 84 still open.
  - E2E-less fixtures: **28**. The target is 2; the count was 13 at plan time.
  - Non-parsing sources: 1.
  - Runtime legs outside both the per-PR set and the queue: 3.
  - `flaky-gate` issues: 1 (#2892).
  - All seven "zero" rows the C-waves targeted (flutter freeze, pairwise waivers, dapper, test typecheck, uncoded validators, HEEx pins, ledger P1) **do read zero**.
- **~95 verified leftovers** (§2), about **40 of them silent**: the model validates `0 error(s)` and the generated code fails to compile, crashes, or does the wrong thing. **30 orphaned open missions** have no wave row and no open PR (§3).
- **Bookkeeping drift is back**, and at the same scale as at C0:
  - 12 `done` headings are still in the track files.
  - Six missions have the wrong status.
  - 23 of 62 register `site:` pointers have drifted.
  - Several ratchets name owner missions that are already done.

  Agents route on these files, so wave L0 goes first.

---

## 1. Owner decisions — blocking, and yours to make

These are user-owned forks. Each has a default that applies if it is not overridden. The waves below assume the default.

| # | Decision | Blocks | Default if unanswered |
|---|---|---|---|
| O1 | **D-HANDLE-REMOVAL**: remove workflow `handle` or build saga emission | M-T6.58 (5 backends), the `workflow-handle` register row, `HandleDecl` showcase allowlist | Remove: refusal stays; delete the register row as `settled` |
| O2 | **D-NUMERIC-INGRESS-STRICT** | M-T6.60's two blocked rows | Strict (422 on lossy numeric text) |
| O3 | **D-WIRESHAPE-KEEP** | The default applies **2026-09-30** | Apply as written |
| O4 | D-STACKS-HOME, D-WITH-IMPLEMENTS, the open C4 questions | C6 triage rows | As proposed in wave-c5 |
| O5 | Elixir `timestamps` → `utc_datetime_usec` (RS-38 parity) **with** a generated `timestamp(0)`→`timestamptz` migration step | L1-E.4 | Do it, with the migration step |
| O6 | Merge-queue admission of a PR with **zero check runs on its head** (#2964 fleet plan; #3002 was admitted this way) | L2.9 | Make `pr-gate` fail on an empty head |
| O7 | Python mypy `[comparison-overlap]` on an enum progression in unit tests (#2957): cast, re-read, or `# type: ignore` | L1-D.5 | Re-read via a helper (`_status(wo)`) |
| O8 | ~~cowlib 2.20.0 CVEs in every generated Elixir app~~ — **resolved by #3067** (serve on Bandit, not Plug.Cowboy) | — | — |

---

## 2. The verified leftover list

Legend:
- **Src**: the merged PR it comes from.
- **Sz**: S / M / L.
- **Silent**: validates clean, then emits broken or wrong code.

### 2.1 Bookkeeping and docs truth (→ L0)

| id | Item | Evidence | Mission |
|---|---|---|---|
| D1 | 12 `done` headings are still in track files: M-T5.28, 5.34, 6.57, 6.61, 9.32, 9.38, 9.50, 9.53, 9.55, 9.56, 9.57, 9.58. Archive them. | `node scripts/mission-counts.mjs` | **done** (L0, #3076) |
| D2 | Wrong statuses:<br>• M-T5.29 `open`: done (#2833)<br>• M-T1.31 `open (F11 in flight)`: done (#2860)<br>• M-T6.62 `in-flight`: `partial`, with REMAINING unowned<br>• M-T5.32 `blocked(#2882)`: unblocked<br>• M-T9.47 `open`: `partial`<br>• M-T3.19 `open`: `partial`; its "claimed by #2861 author" line is stale<br>• M-T9.42 `in progress`: outside the status legend | Track files | **done** (L0, #3076) |
| D3 | README is stale:<br>• the "Open PRs at this refresh (2026-09-10)" list<br>• the "what remains … M-T5.28, M-T6.57" paragraph<br>• shortlist item 4 (`KNOWN_FLUTTER_GAPS` is `{}`) | `README.md` | **done** (L0, #3076) |
| D4 | `wave-c5.md` status line still says "5b folded → last PR" | — | **done** (L0, #3076) |
| D5 | `completion-waves-2026-09.md:50,51,267` still reads "470 errors / 182 files", "~130"; both are 0 now | #3011 | **done** (L0, #3076) |
| D6 | Conformance docs:<br>• RS-32..35 "⚠ Registry entry pending" paragraph (`conformance-semantics.md:~1614`) is false<br>• RS-33 still names java as open<br>• a `semantics-rules.ts:~1100` comment says dotnet is in `targets`<br>• RS-6 `targets` lists dotnet/elixir, but `field-defaults.ddd` shows both conforming (verify, then flip) | #3013 | L0, #3076 (the code/comments half) |
| D7 | `eval-fieldops/FINDINGS.md:933-984`: F-023/024/025 are marked "not fixed"; all three are fixed | #2980 | L0, #3076 (the code/comments half) — *note: the F-022/F-004/F-012 PR citations came from a different evaluation register, so `FINDINGS.md`'s F-numbers do not map to them* |
| D8 | `coverage.md:236` says #2878/#2884 are "still open"; both merged | #2865 | **done** (L0, #3076) |
| D9 | Register drift:<br>• 23/62 `site:` pointers are 6–20 lines off<br>• the `mikroorm` and `dapper` rows point at done M-T6.23, not M-T2.17<br>• ledger row `register-rows-unowned-workflow-load` is stale<br>• the ledger JSON's stored `counts` (135/6/61) ≠ its arrays (115/7/60) | `unsupported-register.ts`, ledger JSON | L0, #3076 (the code/comments half); closed-mission register rows → M-T9.27 (remainder) |
| D10 | Ratchets owned by done missions, so their residue has no owner:<br>• `UNDOCUMENTED_CODES` 366 (M-T8.18)<br>• direct `generateSystems` 199 (M-T9.35)<br>• legacy generate 38+32 (M-T9.49)<br>Mint owners. | test/system/* | **done** (L0, #3076): owners minted — M-T8.26 (codes), M-T9.75 (direct `generateSystems`), M-T9.76 (legacy generate) |
| D11 | Stale comments:<br>• `heex-parity.test.ts:56-68` says "EMPTY" while DataGrid is pinned<br>• `waivers-compile.ts:70` says "surviving W3 entry" over an empty array<br>• `corpus/manifest.ts:148` still says "waits on pairwise F11" (now D-EMBEDDED-TPH)<br>• `T1-ui-frontend.md:228` says "four KNOWN_FLUTTER_GAPS" | — | L0, #3076 (the code/comments half) |
| D12 | `docs/build.mjs` `RENDERED_SUBDIRS` omits `new-plan/waves{,/handoffs}`, so 17 track-file links 404 on Pages | #2891 H5 | L0, #3076 (the code/comments half) |
| D13 | `.NET #line` weaving doc comment says it is gated on `sourcemap`; it is actually gated on `sourceTexts` alone. **Decide** which one is intended, then fix the code or the comment. | `dotnet/index.ts:276` (#3017) | comment corrected in #3076 (L0); the behaviour bug is **C5** → M-T6.75 |
| D14 | Stdlib/docs: `collection-ops.ts:34` declares `sum` as `(λ): decimal`, but the type system returns the lambda type. `language.md` host-type table predates #2575. | #3055 | L0, #3076 (the code/comments half) |
| D15 | *(moved to L1-F — a code change, not docs)* Playground view-graph shows "—" for an unset `enforcement:`; unset now means `denyByDefault` | `web/src/builder/system-v2/view-graph.ts:617` (#3054) | M-T1.36 (F11) |
| D16 | Mint mission rows for every untracked item in §2.2–2.4 that the waves below do not close in one PR, plus the Commons F-018 / F-008 / F-006 rows that only `coverage.md` mentions (#2922) | — | **done** (L0, #3076) |

### 2.2 Silent defects: validate clean, generated code broken (→ L1)

**Validator / language (tree: `src/language/`, `src/ir/validate/checks/`)**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| V1 | **Unit `test` bodies are never validated (F-105).** Wrong-typed `toBe`, unknown op, and unknown field all give 0 errors. `structural.ts` never dispatches `TestBlock`. | #3031 | repro | M–L | M-T5.41 |
| V2 | Param **defaults silently dropped** on `domainService` ops and workflow `handle`/`create` (`defaults: false`). Refuse them for now. | #3011 4d | `lower-domain-service.ts:62`, `lower-workflow.ts:271,347,398` | S | M-T5.42 |
| V3 | Inline repo call inside a **`commandHandler`** is dropped (`Orders` unbound). The gate only runs for workflows. | #2916 | repro, `workflow-checks.ts:179` | S | M-T5.42 |
| V4 | A local/param **shadowing a field of another type**: `name := name` → TS2322 | #3000 | repro | S | M-T5.42 |
| V5 | **Unknown collection op** in a page body (`rows.bogusOp(...)`) is emitted verbatim | #2865 | repro (not covered by #2949) | S | M-T5.42 |
| V6 | .NET **entity-member collision**: field `assertInvariants`/`create`/`id` vs the generated method → CS0102. Only type names are gated. | #2923 | repro, `backend-syntax-checks.ts:282-345` | S | M-T5.42 (+ M-T6.75 emitter half) |
| V7 | VO-typed field in a `Text` slot → TS2322; only money has a gate | #2871 | `messages.ts` | S | M-T5.42 |
| V8 | `Button { icon: "nope" }` gives no warning (`Icon` does). Move the icon set to `src/util/`. | #2996 | repro | S | M-T5.42 |
| V9 | `storage { type: nats \| meilisearch }` binds to no kind, 0 warnings | #2924 | repro | S | M-T5.42 |
| V10 | Folded-projection e2e reads (`byKey`/`list`) have no response-field check | #3002 | `e2e-route-checks.ts:1134` | S | M-T5.42 |
| V11 | e2e payload gate blind spots: find/list/projection args, explicit `null`, `ui.` forms, `extends` subtypes | #2958 | header of `e2e-route-checks.ts` | M | M-T5.42 |
| V12 | Page-body lambda param untyped (F-041 / M-T5.33 remainder): a typo'd field is emitted, and Phoenix gives a KeyError | #2911 | `type-system.ts:2043` | M–L | M-T5.33 (remainder) |
| V13 | Grammar:<br>• a param named `from` is declarable but unreadable<br>• `operation deny()/state()/money()` gives a hintless parse error | #2865, #2883 | repro | S | M-T5.42 |
| V14 | Variant-`match` **statement** form keeps a `string` `subjectType`, so the four shape gates never run on it (F56) | #2838 | `variant-match-subject-type.test.ts:70` | M | M-T5.43 |
| V15 | `loom.locator-matcher-receiver` is re-derived in the AST validator; move it onto the resolved IR | #2789 | `validators/match.ts:161` | S | M-T5.42 |

**Node / TypeScript tree**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| N1 | A foreign event's **enum/VO is never emitted on the consuming deployable**: `import type { Priority }` from an empty `value-objects.ts` | #2944 | repro | S–M | M-T6.74 |
| N2 | `zod .refine` evaluates **decimal** cross-field invariants in binary float: `a+b <= 0.3` → 422 on node (and the 4 JS frontends), 201 elsewhere | #3055 | `zod-refine.ts:~118` | S | M-T6.74 |
| N3 | decimal.js runs at 20 significant digits; the others use ≥28. Set `Decimal.set({precision})`. | #3055 | no `Decimal.set` in `src` | S | M-T6.74 |
| N4 | `writeScopePredicate` returns `null` when lowering fails, so **the write-scope guard silently vanishes** (fail-open) | #2770 | `repository-find-predicate.ts:782` | S | M-T6.74 |
| N5 | `toWire` doubles its optional-VO guard (cosmetic) | #2864 | repro | S | M-T6.74 |

**.NET tree**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| C1 | Create param named `e` collides with the `var e` local → CS0136 | #3055 | repro, `emit/entity.ts:681,809,904` | S | M-T6.75 |
| C2 | Document store ignores `ignoring` (same `_CapabilityVisible` for scoped / `ignoring X` / `ignoring *`), so reads are over-restricted | #2891 1f | repro | M | M-T6.75 |
| C3 | Channel consumer crashes on an absent optional event field (`GetProperty` → KeyNotFound) | #2944 | `emit/channels.ts:~108` | S | M-T6.75 |
| C4 | Private byte-identical copy of `emitsCommandRoute` | #3015 | `workflow-emit.ts:373` | S | M-T6.75 |
| C5 | `#line` directives woven on **every** `generate system` run, not only under `--sourcemap`: gated on `sourceTexts` alone, and the CLI always passes them (contradicts `docs/debugging.md:5-7`). Fix: gate on `sourcemap && sourceTexts`. *(Added 2026-09-29 from D13.)* | #3017 | `dotnet/index.ts:~276`, `cli/main.ts:~701` | S | M-T6.75 |

**Java + Python trees**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| J1 | Workflow mappers read `ctx.valueObjects` only, so a **sibling-context VO** gives `new Money2()` against a 2-arg record | #2925 | repro, `emit/workflow.ts:530,1007`, `workflow-state.ts:94` | S | M-T6.76 |
| J2 | Unit test `toBe(3)` on a decimal → `compareTo(3)` does not compile | #3055 | repro, `emit/tests.ts:291` | S | M-T6.76 |
| J3 | Retrieval with partial `ignoring` keeps the whole principal scope (over-restricts) | #2891 1f | `emit/repository.ts:623` | M | M-T6.76 |
| P1 | Channel consumer `payload["f"]` gives KeyError on an absent optional field | #2944 | `dispatch-builder.ts:1254` | S | M-T6.76 |
| P2 | `If-Match` parser misses weak tags (`W/"3"` → None, falls back silently) | #2742 | `routes-builder.ts:1256` | S | M-T6.76 |

**Elixir tree**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| E1 | Event-sourced repo, filterless single-row `find` → `Enum.find(all, fn a ->  end)`: invalid Elixir | #2852 | repro | S | M-T6.77 |
| E2 | `command`-typed workflow create param: `c.cargo` on a string-keyed map → KeyError at runtime | #2886 | repro | S | M-T6.77 |
| E3 | Query-time projection `sum(b.amount.amount)` → `sum(record.amount)` over jsonb | #2940 | repro | S–M | M-T6.77 |
| E4 | `timestamps`/audit `at` still `:utc_datetime`, so second precision on the wire (RS-38); see O5 | #3057 | `schema-emit.ts:200,360`, `audit-emit.ts:120` | M | M-T6.77 |
| E5 | LiveView flash `inspect`s the coded domain-floor map; add a `%{detail: d}` clause | #3057 | `liveview-emit.ts:1956` | S | M-T6.77 |
| E6 | HEEx `IdLink` has no nil guard for `X id?` (`~p"/x/#{nil}"`) | #2885 | `heex-primitives.ts:1377` | S | M-T6.77 |
| E7 | Workflow 422 for a missing param has no `errors[]` pointer extension (node has one) | #3017 | `vanilla/denial.ts:463` | M | M-T6.77 |
| E8 | Bare `toThrow()` on an invariant-only rejection: `assert_raise GuardError` never fires (not generated; medium confidence) | #2987 | PR analysis | M | M-T6.77 |
| E9 | = M-T6.70: OpenAPI `servers: /api`, so Schemathesis hits the HTML routes | orphan | `openapi-emit.ts:921` | S | M-T6.70 |
| E10 | = M-T6.71: a non-UUID id in a LiveView route gives a 500 | orphan | — | S | M-T6.71 |

**Cross-backend (workflow / projection emitters)**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| X1 | **M-T6.62 REMAINING**: a state-bearing command workflow with no id field assigns through an unbound receiver on node / .NET / Java (`this.total = n`) | #2840/#2850 | repro | M | M-T6.62 (REMAINING) |
| X2 | Query-time projection over a **TPH subtype** names a nonexistent table (`schema.autoClaims`) and has no discriminator filter | #2940 | repro | M | M-T6.78 |
| X3 | RS-38 millisecond datetime not applied at:<br>• CloudEvents `time`<br>• the document serializer<br>• `string(datetime)` on node + python | #3057 | `typescript/emit/channels.ts:524`, `repository-document-builder.ts:661`, `render-expr.ts:226`; python `channels-builder.ts:571`, `render-expr.ts:296` | M | M-T6.79 |
| X4 | `ctx.enums` lookups that should read the cross-context `enumPool` (6 likely sites) | #3033 | `elixir/vanilla/schema-emit.ts:80`, `projections-emit.ts:63`, `python/emit/http-models.ts:519`, `java/emit/workflow-state.ts:220`, `_frontend/workflows-module.ts:241`, `_walker/form-fields-vm.ts:96` | M | M-T6.80 |

**Frontends**

| id | Item | Src | Evidence | Sz | Mission |
|---|---|---|---|---|---|
| F1 | **Vue/Angular**: a page with a store-reading `derived` loses its `toast()` import + module. Vue also emits `computed(() => count)` without `.value`. | #2786 | repro (`store-showcase.ddd`) | S–M | M-T1.36 |
| F2 | **Vue/Angular**: two routes at `/` when a scaffold ui declares its own `/` page; React writes an unrouted `home.tsx` | #2891 H6 | repro | M | M-T1.36 |
| F3 | Angular: a VO-typed workflow state field is typed `unknown` | #2894 | `angular/workflows-module.ts:53` | S | M-T1.36 |
| F4 | Scaffolded list columns are all `sortable: true`, including `version` and masked keys the server allowlist refuses | #2889 | `_body-builders.ts:1323,1331` | S–M | M-T1.36 |
| F5 | **Feliz**: `Stat`/`KeyValueRow` with a `For` child renders the literal string `"yield! …"` | #2981 | repro | S | M-T1.36 |
| F6 | **Feliz**: page `state {}` initialised from an API read → FS0039, or a raw `Error:` crash with no `loom.*` code | #2721 | repro, `fs-expr.ts:527` | M | M-T1.36 |
| F7 | Feliz: numeric scalar-array form cells have no parse guard (`int s` throws on `"a,2"`) | #2674 | `feliz/wire.ts:1070,1224` | S | M-T1.36 |
| F8 | **Feliz**: all scaffold list pages share one pager state (Next on /products refetches categories); CI works around it | #2885 | repro, `generated-feliz-build.yml:582` | S–M | M-T1.36 |
| F9 | **Flutter CreateForm drops fields** with a `// TODO` comment, not `giveUp()` (`datetime[]`, id/File arrays, nested VO arrays). `KNOWN_FLUTTER_GAPS` is `{}` because its fixture no longer reaches these arms. | ledger | repro, `flutter/forms-emit.ts:211,420,471,480` | S–M | M-T1.36 |
| F11 | Playground view-graph shows "—" for an unset `enforcement:` (now means `denyByDefault`) | #3054 | `web/src/builder/system-v2/view-graph.ts:617` | S | M-T1.36 |
| F10 | Feliz `renderNotice` escapes only `"`; there are three weaker Dart `dartStr` copies (`BYPASS_BASELINE` 5/2/2). **Land after #2966.** | #3011 4a | `feliz-target.ts:921` | S | M-T1.36 |

### 2.3 Gates, corpus, CI (→ L2)

| id | Item | Src | Sz | Mission |
|---|---|---|---|---|
| G1 | **Unbound-symbol gate (M-T9.59) is node-only.** Port it to python/java/dotnet/elixir; it is the gate that would have caught J1/N1/V3. | #2864 | M | M-T9.67 |
| G2 | No within-document **OpenAPI component-uniqueness** gate (only the F-026 shapes are pinned) | #3015/#3046 | M | M-T9.68 |
| G3 | `.loom/wire-spec.json` has **no request contracts** (op/workflow command bodies), so the D6/D7 class passes the diff | #2864 | M | M-T9.69 |
| G4 | Deep fuzz tier built and red, run nowhere (M-T9.64) | orphan | M | M-T9.64 |
| G5 | Census gates assert their own denominator (M-T9.62); per-target corpus floor (M-T9.63); mission-counts region collision (M-T9.66) | orphans | S×3 | M-T9.62, M-T9.63, M-T9.66 |
| G6 | Corpus shapes missing:<br>• select-only query-time projection (#3030)<br>• `scaffoldHandlers` × `softDeletable`/`extends` (#3011 H2, precursor to M-T5.40)<br>• re-add the grouped read + enum-key sorts to `projection-agg-filters.ddd` (#2988)<br>• X1's `Tally` workflow<br>• a Flutter fixture reaching the F9 arms | several | S | M-T9.74 |
| G7 | Wire goldens are sensitive to unordered reads (`.NET prefix-filter #14`). Make an order-insensitive compare or order every read. | #3016 | M | M-T9.70 |
| G8 | Behavioural harness DDL is built from the drizzle object, not the migrations: no FKs, no enum CHECKs | #2919 | M | M-T9.71 |
| G9 | `pr-gate` can publish onto a SHA that is no longer the head (#2804); admission with zero head checks (O6) | #2804/#2964 | S | M-T9.72 |
| G10 | Ratchets missing:<br>• pack-loader `SHARED_SOURCE_DIRS_*` ↔ `generated-*` workflow `paths:`<br>• `frontend-showcase-render` `GAPS` (3, incl. `heex:Console`) into `allowlist-ratchet` | #2766/#2891 | S | M-T9.72 |
| G11 | `behavioral-e2e-java` cap still at a provisional 30 min; re-measure (the gradle daemon gave ~4×) | #2855 | S | M-T9.72 |
| G12 | Schemathesis F21 / W27 (.NET write half) re-triage: the nightly on `8202fb63` is green, so read its artifacts | #2773 | S | M-T9.72 |
| G13 | `it.fails` flips (4 patches):<br>• `lookupPreset` → `Object.hasOwn`<br>• `elixirRegexBody` single-scan escape<br>• import `KEYCLOAK_HOST_PORT`<br>• `loom.workflow-fn-name-collision`<br>Also delete the dead `describe.skip` in `storage-declaration.test.ts:46`. | ledger | S | M-T9.73 |
| G14 | Test-helper type workarounds:<br>• `allContexts`/`allAggregates` erase the enriched brand<br>• `enrichLoomModel(RawLoomModel)` / `reEnrich`<br>• `.d.mts` for the `pr-gate`/`quality-delta`/`ledger-counts` scripts | #3011 4b | S | M-T9.73 |
| G15 | Module-global census does not cover `test/_helpers/` (M-T9.54 residue) | #2800 | S | M-T9.54 (residue) |
| G16 | Duplicate id-target walk `claimIdTargets` vs `ir/util/id-targets.ts` | #2881 | S | M-T9.73 |

### 2.4 Product holes and parity (→ L3)

| id | Item | Src | Sz | Mission |
|---|---|---|---|---|
| P1 | **M-T3.19: `denyByDefault` leaves `GET /{id}` ungated.** 5d made `denyByDefault` the default, so the warning now fires on every auth model. **Security; raise to P0.** | orphan | M | M-T3.19 |
| S1 | **A principal with no tenancy claim gets a 500 on every tenant-owned write** (#2948's F-018 — not the Commons F-018). Must refuse with a 403 naming the claim. `test/system/tenant-stamp-refusal.test.ts` (salvage on the closed #2948 branch, `af086265`) fails against `main` on four backends: node's shared stamp helper, the .NET SaveChanges interceptor, python's stamp method, java's `@PrePersist`; `src/ir/util/principal-stamp.ts` (115 lines, same branch) was never imported. **Security.** *(Added 2026-09-29.)* | #2948 | M | M-T3.20 |
| P2 | Frontend register gaps (11 LIVE rows):<br>• M-T1.20 ×4 (async-effect subject, feliz async effect, collection ops, store lifetime)<br>• M-T1.1 page-form locals / two forms on one page<br>• M-T1.6 modal op form<br>• M-T1.10 toast message<br>• M-T1.15 scaffold filter param<br>• M-T1.27 HEEx component host state<br>• M-T1.32 flutter action body<br>• M-T1.3 ui projection read | ledger | L | M-T1.20, M-T1.1, M-T1.6, M-T1.10, M-T1.15, M-T1.27, M-T1.32, M-T1.3 |
| P3 | Persistence adapters: dapper/mikro real migration chain (M-T2.17, the ledger's last P2 "no ALTER path"); `vanilla-document` (M-T6.35) | orphan | L | M-T2.17, M-T6.35 |
| P4 | Cross-cutting register rows:<br>• polymorphic TPC id ref (M-T5.7)<br>• multi-backend `ui` (M-T1.35)<br>• `handle` (O1) | ledger | L | M-T5.7, M-T1.35, M-T6.58 |
| P5 | Language holes:<br>• M-T5.31 `retrieval` has no route (P1)<br>• M-T5.32 create params ≠ request contract (P1)<br>• M-T5.40 response record ≠ wire (P1)<br>• M-T5.39 `date`/`time` scalars (P1)<br>• M-T5.30 `for` in a domain body<br>• M-T5.36 find binding vocabulary<br>• M-T5.38 two IR spellings of `this`<br>• M-T5.2 failure-sink contract | orphans | L | M-T5.31, M-T5.32, M-T5.40, M-T5.39, M-T5.30, M-T5.36, M-T5.38, M-T5.2 |
| P6 | Scaffolded forms can't edit `X id[]`/`string[]` (`arrayUnsupported`) on the 4 static frontends | #2927 | M | M-T1.37 |
| P7 | VO subform rows fixed on React only; vue/svelte/angular packs lack id-select / datetime / row-error arms; enum/bool/File sub-fields are text everywhere | #2914 | M | M-T1.38 |
| P8 | A list page can't host a per-row operation dialog on any frontend | #2970 2k | L | M-T1.39 |
| P9 | `If-Match`/`ETag`:<br>• only node sends `ETag`<br>• feliz + flutter don't send `If-Match` (`DOES_NOT_SEND`) | #2742/#2911 | M | M-T6.81 (+ M-T6.76 P2) |
| P10 | `app-error` boundary missing on feliz/flutter/HEEx shells, so the smoke gate is weaker there | #2989 | M | M-T1.40 |
| P11 | `renderToast` seam (React mounts its own region, not the pack widget), M-T1.28 | #2786 | M | M-T1.28 |
| P12 | .NET never logs `workflow_failed` (Mediator pipeline behaviour) | #2742 | M | M-T6.82 |
| P13 | Channel consume failure is only `warn`; node bypasses the log catalog; no retry/DLQ for `ephemeral` | #2944 | M | M-T4.13 |
| P14 | Generated compose has no `restart:`; backends don't retry the DB at boot | #2946 | M | M-T7.10 |
| P15 | Default invariant message `"Invariant violated: <src>"` is not humanised on any backend | #2736 | M | M-T6.83 |
| P16 | Messaged precondition in `domainService`/`function`/workflow step gives a text-only 422 with no `code` | #3057 | M | M-T6.84 |
| P17 | TPH base with no children still owns an orphan table (pairwise F17) | #2975 | M | M-T2.18 |
| P18 | `User id` collapse still requires a `user {}` block; read-side narrowings; a loud `IdLink` when it can't resolve a route | #2960 | S–M | M-T3.21 |
| P19 | Smaller orphans:<br>• M-T6.69 `amount` vs VO `Amount` on .NET<br>• M-T6.72 .NET capability filters<br>• M-T1.32 / M-T1.34<br>• M-T9.65 money literal in ui e2e<br>• 3 flowbite spacing waivers (M-T1.12)<br>• `sales-ui.ddd` parse (M-T9.51) | orphans | S–M each | M-T6.69, M-T6.72, M-T1.32, M-T1.34, M-T9.65, M-T1.12, M-T9.51 |
| P20 | DX: M-T8.24 installable release surface (P1), M-T8.25 `ddd fmt`, M-T2.16 `ddd diff` wire verdict, M-T9.61 dependency freshness | orphans | M each | M-T8.24, M-T8.25, M-T2.16, M-T9.61 |

### 2.5 Debt ratchets (→ L4)

- Undocumented diagnostic codes: **366** → M-T8.26
- Direct `generateSystems` callers: **199** → M-T9.75
- Legacy generate path: **70** (32 Hono + 38 .NET files) → M-T9.76
- Assertion-free tests: **27** (21 in e2e)
- Module-global pins: **23** → M-T9.54
- Angular dead pack templates (`KNOWN_UNREACHABLE`): **15**
- ir-walk remainder after #3051: **7**
- Ledger P4/P5 disposition: **84**
- Walker `giveUp()` sites: **63** (audit only)

---

## 3. Orphaned open missions (no wave row, no open PR)

These were minted after 09-10, or handed off by a closed wave into C6 without being added to C6's build list:

- **T1:** M-T1.1, 1.3, 1.13, 1.15, 1.16, 1.18, 1.20, 1.27, 1.28, 1.31 (done and archived by L0), 1.32, 1.34, 1.35
- **T2:** M-T2.16, 2.17
- **T3:** M-T3.19
- **T4:** M-T4.12
- **T5:** M-T5.2, 5.9, 5.10, 5.16, 5.21 (phases 2–4), 5.30, 5.31, 5.32 (unblocked), 5.33, 5.36, 5.38, 5.39, 5.40
- **T6:** M-T6.2, 6.14, 6.35, 6.50, 6.56, 6.59, 6.62, 6.69, 6.70, 6.71, 6.72
- **T8:** M-T8.9, 8.24, 8.25
- **T9:** M-T9.3, 9.21, 9.22, 9.26 (#2918 merged 09-28 — unblocked), 9.27, 9.40, 9.54, 9.59, 9.61, 9.62, 9.63, 9.64, 9.65, 9.66

The waves below own all of them, either directly or through the L3/L4 triage.

---

## 4. The waves

Rules, carried over from completion-waves §3 and CLAUDE.md:
- One PR per packet.
- A draft-PR claim before any code.
- Packets are **tree-fenced**, so parallel agents never share a file.
- Every new gate is mutation-proved, and the PR body says so.
- Re-sync `main` before each packet.
- A packet that finds its item already fixed records that and stops.

Each wave lists how many agents it runs in parallel.

### L0 — True the ledgers (1 agent, docs + comments only; lands first)

**Status (2026-09-29): done by #3076.** `mission-counts` shows 0 `done` headings in the track files (15 archived: the plan's 12 plus M-T1.31, M-T5.35 and the stale live duplicate of the already-archived M-T5.29); every §2 item carries a mission id in its table's *Mission* column — 37 missions minted (M-T1.36–1.40, M-T2.18, M-T3.20–3.21, M-T4.13, M-T5.41–5.43, M-T6.74–6.84, M-T7.10, M-T8.26–8.28, M-T9.67–9.76), the rest appended to existing missions' remainders.

**D1–D16.** Archive the 12 done headings, fix the 7 statuses, rewrite the stale README paragraphs, correct the register `mission:`/`site:` fields (and consider a ±N-line `site` check in `unsupported-register.test.ts`), mint owners for the D10 ratchets, add `waves/` to `RENDERED_SUBDIRS`, and mint mission ids for every untracked §2 item so that L1–L3 PRs can cite them. *Exit:* `mission-counts` shows 0 `done` in track files; every §2 item has an id.

### L1 — The silent class, by tree (8 agents in parallel; after L0)

This is the P0/P1 wave. Every packet ends with a fixture in the corpus, so the class stays caught.

| Packet | Tree fence | Items | Sequencing |
|---|---|---|---|
| **L1-V1** | `src/language/validators/` test-block dispatch | V1 (F-105 unit-test body validation) on its own. Expect it to surface corpus breakage, which it fixes in the same PR. | — |
| **L1-V2** | `src/ir/validate/checks/`, `src/diagnostics/messages.ts`, grammar | V2–V11, V13–V15 | After #2949 (primitive member read) and #3040 (domainService params) |
| **L1-SEC** | auth + tenancy-stamp emitters, all backends | P1 / M-T3.19: gate the synthesised by-id read (and the injected `find all`, Commons F-006) under `denyByDefault` on all 5 backends, then retire the warning. S1 / M-T3.20: refuse a tenant-owned write whose principal lacks the tenancy claim (403 naming the claim, not a 500) on all 5 | #2945 closed; its remainder merged as #3064 |
| **L1-N** | `src/generator/typescript/`, `src/platform/hono/`, `zod-refine.ts` | N1–N5, plus X3's node sites | After #3060 |
| **L1-C** | `src/generator/dotnet/` | C1–C5, V6's emitter half if any, M-T6.69 | After #3043 (merged 09-28 — clear) |
| **L1-JP** | `src/generator/{java,python}/` | J1–J3, P1–P2, X3's python sites, O7 | After #2966 (java workflow gate) — #2966 closed; check whether that gate landed on `main` or rides #3066 |
| **L1-E** | `src/generator/elixir/` | E1–E10 | After #3023 (merged 09-28 — clear) |
| **L1-F** | `src/generator/{vue,angular,feliz,flutter}/`, scaffold `_body-builders.ts`, `web/src/builder/` | F1–F11 | F10 and F6 after #3066 (#2966's successor) |

Run **X1, X2 and X4** as a ninth packet only if the fleet cap allows; otherwise fold X1 into L1-N (its node half) and hand the dotnet/java halves to L1-C/L1-JP. X2 and X4 touch every backend's projection or enum lookup and **must not** run beside the per-tree packets. They go first in L2.

*Exit:*
- Every repro from §2.2 is a corpus fixture that compiles on its target.
- `MAX_OPEN_GAPS` is not raised.
- The E2E-less count does not grow: new fixtures carry e2e blocks.

### L2 — Gates that would have caught L1, and the corpus shapes it lacked (6 agents; after L1 merges)

| Packet | Items |
|---|---|
| **L2-X** | X2 + X4 (cross-backend projection/enum sweep; now alone in those files) |
| **L2-G1** | G1: port the unbound-symbol gate to 4 backends. It must go red on a seeded L1 regression before landing. |
| **L2-G2** | G2 + G3 (OpenAPI uniqueness, wire-spec request contracts) |
| **L2-CORPUS** | G6 + G7 + G8 (fixtures, order-insensitive goldens, migration-built harness DDL) |
| **L2-CI** | G4, G5, G9 (incl. O6), G10, G11, G12 |
| **L2-HYG** | G13, G14, G15, G16 |

Coordinate with **#3058** (C3 3-A): it owns the E2E-less drain, the authz census and corpus promotion. L2 must not touch `E2E_LESS_CORPUS_FIXTURES` / `BEHAVIOURAL_ABSENT`. *Exit:*
- M-T9.59, M-T9.62, M-T9.63, M-T9.64 and M-T9.66 are done.
- The quality-delta gate-discovered share is measured again.

### L3 — Product completion, the C6 build list (8 agents; start after L1; runs alongside L2 because the trees differ)

| Packet | Items | Notes |
|---|---|---|
| **L3-UI-a** | P2: M-T1.20 ×4 + M-T1.10 toast + P11 `renderToast` seam | Walker core. Only one walker-core packet runs at a time. |
| **L3-UI-b** | P2: M-T1.1, M-T1.6, M-T1.15, M-T1.3; then P8 per-row op dialog | After L3-UI-a |
| **L3-FORMS** | P6 array editing + P7 VO subform parity (pack templates + Angular `form-fields.ts`) | Design packs only |
| **L3-SELF** | P2: M-T1.27 (HEEx), M-T1.32/1.34 (flutter); P10 app-error boundaries; P9 feliz/flutter `If-Match` | Feliz/flutter/heex trees |
| **L3-LANG** | P5: M-T5.31 → M-T5.32 → M-T5.40 (one route/contract story), then M-T5.39 `date`/`time` | Uses the `language-feature-developer` skill; 1 agent, sequential |
| **L3-PERSIST** | P3: M-T2.17 dapper/mikro migration chain, M-T6.35 vanilla-document; P17 TPH orphan table | — |
| **L3-RUNTIME** | P9 ETag on 4 backends, P12, P13, P14, P15, P16 | Obs/log catalog + compose. Runs the obs-e2e legs locally. |
| **L3-DX** | P20: M-T8.24 release surface, M-T8.25 `ddd fmt`, M-T2.16 `ddd diff`, M-T9.61 | CLI island |

Also: P4 (M-T5.7, M-T1.35) and the rest of P5/P18/P19 go through **owner triage** first. Each gets build, defer-with-date, or freeze, as C6 planned. One agent drafts the triage table for you; nothing is built without a disposition.

*Exit:* register LIVE `gap` rows = 0; ledger P2/P3 = 0.

### L4 — Debt ratchets + the closing audit (≤6 agents; after L2/L3)

- **L4-CODES**: 366 undocumented codes, in batches of ~40 by prefix (workflow + projection first, then policy/tenancy/resource). About 2 agents.
- **L4-TESTS**: direct `generateSystems` 199, legacy generate 70, assertion-free 27, module-global 23.
- **L4-DEAD**: 15 Angular dead templates (delete, or route Angular forms through the pack), and the 7 ir-walk remainders.
- **L4-LEDGER**: disposition the 84 P4/P5 ledger rows.
- **L4-C7**: completion-waves C7 as written. Docs truth (M-T9.46/47/51), generated per-target tables, the closing `parity-auditor` sweep, and the M-T9.8 hollow-work sweep. Then start the two-week hold on the §1 denominators.

### Order and parallelism at a glance

```
L0 (1) ──► L1 (8, tree-fenced) ──┬──► L2 (6) ──┐
                                 └──► L3 (8) ──┴──► L4 (≤6) ──► two-week hold
O1–O8 answered any time before the packet that needs them (defaults apply otherwise)
```

---

## 5. Excluded: claimed by open PRs at this snapshot

- #3061: i18n pack-swap carry
- #3060: M-T6.64 test-body import + python cross-context VO hydrate
- #3059: money/decimal wire docs
- #3058: C3 3-A, the E2E-less drain, authz census, corpus promotion, remaining test-coverage missions
- #3051: CR1 batch 2, ir-walk waivers 98 → 43, OIDC audience
- #3049: F-012 drizzle journal
- #3048: denyByDefault ⊗ eventLog, the ES create gate, M-T3.16 pointers
- #3043: .NET BCL type names
- #3040: domainService param binding
- #3024: M-T6.73 explicit routes, handler triad
- #3023: elixir invariant residue
- #2978 / #2977: E2E-less entries
- #2976: registry-row / second principal
- #2969: F-034 locale files
- #2966: four compile-breakers incl. the Feliz collision
- #2949: F-040 primitive member read
- #2948: auth demo token, hand-edit clobber
- #2947: four codegen defects
- #2945: `currentUser` in read filters
- #2943: F-022 enum member resolution
- #2942: page emitter fail-open
- #2938: CR1 batch 1
- #2918: M-T5.35 create-input asymmetry

**Refresh 2026-09-29** (`main` @ `cbda9165`, +10 merges; #2918 merging unblocks M-T9.26). **Merged since the snapshot:** #2918, #2943, #3023, #3043, #3048, #3049, #3059, #3062, #3064, #3067. #2918 closed M-T5.35 (archived by L0). Five PRs closed without merging; where their items went (verified from each PR's closing comment):
- **#2938 + #3051** → re-cut whole as **#3065** (open): CR1, the ir-walk waiver drain 111 → 43.
- **#2966** → three of its fixes landed on `main` independently; the remaining three are carried by **#3066** (open).
- **#2945** → fixed on `main` independently (python/elixir/java); the non-`.id` claim case is answered by the refusal `loom.find-where-not-queryable`; the remainder merged as **#3064**.
- **#2948** → F-031 (hand-edit overwrite report) and F-016 (Keycloak claim mappers) are on `main`. **F-018 is genuinely unclaimed**: a principal with no tenancy claim gets a 500 on a tenant-owned write instead of a 403 naming the claim. Added as **§2.4 S1**, packet **L1-SEC**, mission **M-T3.20**.

**New claims:**
- #3063: soft-by-default keywords (209 → 58 reserved field names). May close V13; re-check before L1-V2.
- #3065: CR1 ir-walk drain 111 → 43
- #3066: JSON resource-verb param, an unbound principal in a workflow's inlined op gate, untyped containment-row cells
- #3070: retro §119
- #3071: Flutter `design:` warning
- #3072: RS-4 `.000Z` on node raw-row read routes. Overlaps X3; L1-N takes only the X3 sites #3072 does not touch.
- #3073: `loom.migration-rename-inferred`
- #3074: `ddd breakpoints` recorder gap

**Several of these are ready or stale for more than a week.** Landing or closing them is the cheapest progress available: #2918, #2938, #2942, #2943, #2945 since 09-13/14, and drafts #2947–#2949, #2966, #2969 since 09-14. Before L1 starts, the fleet lead should either take each over or close it, so its claim stops fencing work that is not moving.

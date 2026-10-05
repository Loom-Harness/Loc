# T9 — Toolchain & process health

> **Completed missions for this track live in [`archive/T9-done.md`](archive/T9-done.md)** (9 closed as of 2026-09-02). This file lists only the live missions.

*Weak-spot #5: the expression/statement/walker axes are correctly abstracted and CI-pinned; the persistence-emit axis and the version axis are not, runtime feedback is nightly-only, and one human author + 190 design docs made doc rot a first-class failure mode (this plan is itself the remediation of that last one).*

> **Test-coverage missions M-T9.12–M-T9.20** (shared-core unit tests, validator negative tests, generated-output runtime validity, cross-target parity fill) live in the companion analysis doc [`testing-quality-improvement-plan.md`](testing-quality-improvement-plan.md) — sourced from the 2026-07-28 coverage sweep, verify-first. **M-T9.17 slice 1** (direct unit tests for `renderWorkflowStmts` / `seed-datasets` / `reachable-types` / `repo-methods`), **M-T9.19 (done)**, and **M-T9.12 (done — event-sourcing + eventsourced-workflow behavioural blocks, node + python verified)** landed; M-T9.19's bigger claimed set was mostly false gaps on re-check (already covered) or four structurally-unreachable arms handed to M-T9.8.

## M-T9.3 — Per-PR runtime boot gates — `partial` · **L** · P1
Compile-only per-PR gates let runtime regressions ship green and fail nightly. Progress verified 2026-07-13: per-PR behavioral workflows now exist for **all five backends** — node, python, dotnet, java, **and elixir** (`behavioral-e2e{,-python,-dotnet,-java,-elixir}.yml`, all `on: pull_request` with per-generator path filters). **a6.2 v2 is done** (the Elixir leg landed via `test/behavioral/run-elixir.mjs` — boots the generated Phoenix project `mix deps.get`+`ecto.create`+`ecto.migrate`+`phx.server` against a real Postgres and HTTP-dispatches the emitted api suite; RS-1..RS-8 verified green locally, PR #1893). **Update (2026-07):** the five per-backend `corpus-*.json` allowlists + forked `sales.ddd` copies were collapsed — every runner now derives its cases from the typed corpus manifest (`test/behavioral/cases.mjs`) plus the shared tokenized `test/behavioral/systems/*.ddd` (one `__PLATFORM__` source per broad system), gated by `test/conformance/behavioural-coverage.test.ts` (a `test e2e` block must emit on every declared backend). This surfaced a **node event-sourcing gap** (`systems/ledger.ddd`: the ES `create` checked `invariant balance >= 0` before the create event folded initial state → 400; passes on java/python) — **now fixed** (the event-sourced create folds events before asserting invariants, `src/generator/typescript/emit/aggregate.ts`); `ledger` re-armed and **every backend's `cases.mjs` skip-list is empty**. **Phase 2 landed** — `showcase-completeness` is HARD, and `feature-doc-coverage.test.ts` closes the inverse doc/fixture direction (a documented feature with no corpus fixture fails; `KNOWN_GAPS` now **empty**). **Both original gaps drained:** `domain-services.ddd` (pure/reading/mutating tiers) — which surfaced + fixed a real Python emitter bug (`== null` → `is None`, ruff E711) — and `scaffold-macros.ddd` (`crudish` + `softDeletable`/`softDelete`); both compile-verified on all five backends. Remaining: v3 unit-tier parity; the unit-tier domain-test drain continues (corpus domain `test` blocks now on `core-domain`/`saga`/`single-containment`/`domain-services`/`provenance` — `domain-services` adds decimal value-object arithmetic through operations, `provenance` adds integer arithmetic (`total := qty*price - discount`); each executed on node+python+elixir and compiled on the JVM/CLR backends); the manifest-driven wire-parity sweep (Phase 3) + behavioural runtime tier (Phases 4–5); and Elixir in the per-PR OpenAPI parity boot (with M-T6.3).
Sources: [a6.2-behavioral-tier-second-backend](../old/plans/a6.2-behavioral-tier-second-backend.md), [global-test-coverage-plan](../old/plans/global-test-coverage-plan.md), [runtime-conformance-harness](../old/plans/runtime-conformance-harness.md).
- **Timers runtime leg (moved here from M-T4.1 on its 2026-09-02 close):** every timer runtime proof to date was a per-PR hand-run (#1963, #2009, #2525's watermark-advance boot); fire / single-fire / coalesce-once catch-up have no standing gate on any backend. A `timers-e2e` leg in the same shape as `channels-e2e` is the gap — a test gate, not a feature.

## M-T9.4 — Full-review remediation residue — `partial` (re-verified on fresh `main` by wave C4 packet 4f, 2026-09-22: **every item but A5 is closed**) · **S** · P2
**The residue is now ONE item: A5.** Re-verified item by item on the folded C4 tree; the old list was five items stale.
- **A5 — retire the deprecated `WorkflowIR` primary-create facade — STILL OPEN, and it is not S.** `params` / `statements` / `savesAtExit` are `@deprecated` facades over `creates` (`src/ir/types/loom-ir.ts:1279–1299`). Measured: **54 reader sites across 16 files**, including all five backends (`platform/hono/v4/workflow-builder.ts`, `generator/{dotnet,java,python}/workflow-*`, `generator/elixir/vanilla/explicit-handlers-emit.ts`), the shared `_workflow/stmt-target.ts`, both lowerers and two IR check leaves. That is an **L** under the byte-identical bar, not the S the row implied.
- **A7.4 fullstack-embed seam on `PlatformSurface` — CLOSED.** The seam exists as `STATIC_BUNDLE_FRAMEWORKS` + `EMBEDDABLE_FRAMEWORKS` (`src/platform/surface.ts:39–58`), with backend hosts advertising the wider set and the frontend static hosts the narrower one.
- **B23 heex-parity behavioral OUTPUT test — CLOSED** by [#2662](https://github.com/Loom-Harness/Loc/pull/2662): `test/behavioral/run-heex-ui.mjs` runs the emitted `*.ui.spec.ts` plus a create → list → detail round-trip against a booted Phoenix stack and asserts on RENDERED TEXT, so a 200 with an empty page fails.
- **C-mediums C1–C7, C11, C12, C15 — CLOSED.** Every one carries its fix marker in `src/` (`(C1)` … `(C15)` across `validators/{structural,statements,builder-call,deployable,composition,types}.ts`, `print-structural.ts`, `lower-expr.ts`, `platform/metadata.ts`). Spot-checked: C2's `Create`/`Destroy` owner arm (`structural.ts:158`), C11's `BARE_REJECTED_COLLECTION_ACCESSORS` (`types.ts:168`), C6's `print-keyword-mirrors.test.ts` deriving both keyword sets from the parsed grammar.
- **#22 / C5 macro expansion under LSP incremental rebuild — CLOSED by packet 4f.** C5's named deliverable was "the currently-missing expander idempotency/incremental test"; it is `test/macro/expansion-rebuild-idempotence.test.ts`. See M-T5.16 (c) for what it measured.
Sources: [full-review-remediation](../old/plans/full-review-remediation.md), [full-code-review-2026-07](../audits/full-code-review-2026-07.md).

## M-T9.5 — Version-axis consolidation — `partial` · **M** · P2 ⚠ the `stacks/` move is BLOCKED on an owner fork (measured 2026-09-22, wave C4 packet 4f)
**The `stacks/` → `src/platform/react/v{N}/` move was measured and NOT taken.** Two reasons, both in the way:
1. **The target path names React; the directory does not hold only React.** `stacks/` holds five FRAMEWORK families — `v1`/`v3` (React/TSX), `vue1`, `sv1` (Svelte), `ng1` (Angular). Moving only `v1`/`v3` splits one directory across two homes, which is worse than either end state. Moving all five means per-framework platform dirs, but `src/platform/{vue,svelte,angular}.ts` are thin surface files with no package directory — so this is really "do the frontends adopt the hono v4/v5 PACKAGE pattern?", a bigger question than a move.
2. **The blast radius is not mechanical.** `stacks/` is resolved by path in THREE places, one of which is a build-time glob: `src/generator/_packs/loader-fs.ts:187` (`<repo>/stacks/<id>/`), `web/src/build/template-bundled.ts:65,74,102–109,160,166` (three glob literals + a path regex that reconstructs `/stacks/<id>/<file>` into the browser VFS) and `web/src/build/loader-vfs.ts:167`. Plus 7 `.github/workflows/generated-*` files, 4 tests (`stack-router-seam`, `package-json-shape`, `money-form-generics`, `playground/loader-vfs`), `docs/design-packs.md`, and the publish `files:` list. Under the byte-identical bar that is an **M**, and it must land with the web VFS half in the same PR or the playground silently stops finding its stacks.
**Owner decision wanted:** (a) move all five into per-framework platform package dirs (adopt the backend-packages pattern on the frontends), (b) move React's two only and accept a split `stacks/`, or (c) close this sub-item — `stacks/<id>/` IS already a version axis with one directory per version, and the consolidation buys naming symmetry rather than behaviour.
Other sub-items unchanged: backend-packages B3+ decisions (render-expr sharing granularity, frontend single-versioning, CI version sharding); pack-versioning Phase 2 tail (Phoenix dep bump, .NET stack scaffold, shadcn@v4 bareword promote).
Sources: [platform-directory-layout](../old/proposals/platform-directory-layout.md), [backend-packages](../old/plans/backend-packages.md), [pack-versioning-plan](../old/plans/pack-versioning-plan.md), D-BACKEND-PKG.

## M-T9.6 — Doc & status hygiene — `recurring` · **S** · P2
This consolidation replaces three drifting status tables with one. Keep it true: mission status lines update on completion (see README rule 5); the `status-refresh` skill audits `docs/` (not this plan's history); stale code comments flagged by audits (registry.ts HEEx-gap claims, `ashPhoenix` references) get scrubbed. One-time task: sweep the flagged stale comments now.
**Open items queued here by the 2026-08-13 test-coverage audit (#2558):**
- ~~**M-T9.28 – M-T9.32 have no mission bodies.**~~ **Drained (#2572)** — the first of the two ways out was taken: all five bodies are written below, with statuses re-derived from what actually shipped. One correction fell out of it: `README.md`'s mint line describes M-T9.28 as the repo-wide `.ddd`/clause census, but that shipped *unlabelled* in #2498 and the ID's only claim in code (#2515) is the **authorization-surface** census — first claim wins, so the stale description is flagged in M-T9.28's own ID note rather than silently reinterpreted.
- ~~The stale "warning, not error" comment beside `checkUserVisibleConcat`~~ — corrected in the same PR; the rule has raised `"error"` since M-T1.11 item 8 landed, and 9 of that PR's 53 fixture fixes were tripping it.

**Open item queued here 2026-09-10, from a deferred comment on merged [#2832](https://github.com/Loom-Harness/Loc/pull/2832#issuecomment-5609067588):**
- **`docs/ci-gating.md`'s queue runbook has no honest "is my PR actually in the queue?" probe, and the obvious one is wrong.** An accepted queue entry has **no `gh-readonly-queue` ref until its batch forms**, so `ls-remote` for that ref answers "not queued" for a PR that is queued — which is exactly what sent #2832 down two dead diagnoses (the `cancel-in-progress` cancellation, already fixed by #2822; and a rejected auto-merge method, where the `405 Merge commits are not allowed` is about the direct merge API, not the queue). The probe that does answer is the merge API itself, which replies `405 Pull Request is in the merge queue`. One paragraph in the runbook, next to the existing lever table — **landed in [#2859](https://github.com/Loom-Harness/Loc/pull/2859)**, verified live rather than quoted. Two refinements on the filing above: `ls-remote` for `gh-readonly-queue/*` lists **running batches**, not membership — the ref embeds a batch base SHA and does not exist until the batch forms, so its silence proves nothing. And the merge-API answer must be read by its **message, not its status code**: `PUT /pulls/:n/merge` returned `405 Pull Request is in the merge queue.` for #2849 (queued) and `405 Pull Request is still a draft` for #2859 (open draft). Both are 405; only the first means queued. Cheap, and it retires a wrong diagnosis that has already cost one session ~95 minutes.

Sources: weak-spots §5, old global-plan T1.4; test-coverage-audit-2026-08-13 §3.7.

## M-T9.7 — Repo-admin one-clicks — `blocked(admin)` · **S** · P3
RST-4: add `behavioral-python` to branch-protection required checks. Anything else needing owner action collects here.
RST-5 (added 2026-08-30, the 08-17 review's **B4**; **superseded 2026-09-07**): turn on branch protection's **"require branches to be up to date before merging"** on `main`. Without it a PR can go green against a base that has since moved, which is one of the two ways `main` goes red after a green merge. The merge queue supersedes this — it gates the *rebased* candidate, which is strictly stronger than requiring the branch be current — and the queue was switched on for `main` on 2026-09-07 ([`docs/ci-gating.md`](../ci-gating.md)). Close unless an audit shows queue bypasses in use. The 08-17 audit filed this against "M-T6.7", which does not exist — it is this mission.

## M-T9.8 — Hollow-work audit — `recurring` · **M** · P1
Parallel agents sometimes *claim* done what isn't: dead code never wired in, gates softened/reverted to get CI green, skip-lists and allowlists that quietly grow, emitters that write `TODO` comments into compiling output, validators defined but unreachable, tests without assertions. Run an adversarial sweep for this class on a cadence (and after any large multi-agent push): (a) dead `render*/emit*/build*` exports in `src/generator/`+`src/platform/`; (b) every skip/allowlist + `HARD_GATE`-style flag audited against its justification; (c) generated-output TODO/placeholder strings vs honest fail-fast throws; (d) diagnostic codes defined but unemittable; (e) assertion-free tests; (f) parity gates that exclude the case they claim to cover (`LOOM_E2E_SKIP_*`, normalize filters). Confirmed hollow claims get a mission + a status correction here; the best generic checks graduate into permanent CI gates. First run 2026-07-13 found: the dead `renderSpaController` (→ M-T6.1), Feliz silent statement/expression drops (→ M-T6.15), the grown showcase allowlist over grammar-only kinds (→ M-T6.16), the guarded walker-core `undefined` fallthrough, and the Java `embedded` compile-skip. Three checks to graduate into CI (own slice, size S each) — **all three landed 2026-07-14 (PR #1897)** as vitest meta-tests in the fast per-PR suite (self-contained, no knip/ts-prune dep, riding `tests-passed`): (1) **dead-export gate** ✅ `test/platform/dead-generator-exports.test.ts` — fails on any exported `render*/emit*/build*` in `src/generator/`+`src/platform/` with zero cross-file importers; drained the 8 offenders it found — deleted 4 dead duplicates in `src/generator/elixir/shell/web.ts` (`renderWebModule`/`renderSpaController`/`renderErrorJson`/`renderErrorHtml`, superseded by the `renderVanilla*` emitters in `vanilla/shell-emit.ts` per M-T6.1, with a stale header comment) + un-exported 4 internal-only helpers; clean at zero. (2) **no-TODO-in-generated-output gate** ✅ `test/conformance/generated-output-sentinels.test.ts` — generates the shared corpus × 5 backends in-memory and fails on any emitter-written `TODO`/`FIXME`/`XXX`/`HACK`/`unsupported`/`unimplemented`; honest fail-fast throws (`extern` "not implemented") and prose "placeholder" deliberately excluded; clean at zero (146 cells). (3) **allowlist ratchet** ✅ `test/platform/allowlist-ratchet.test.ts` — snapshots every registered allowlist/skip-list's entry count (showcase ALLOWLIST, corpus compile-skip maps, heex frozen set, pipeline-layering ALLOWED, …) and fails CI on growth past the pinned baseline (with an anti-slack check forcing the baseline down on drain). Remaining audit residue (unblocked, not part of this slice): the walker-core `undefined` fallthrough + Java `embedded` compile-skip are M-T6.16; the diagnostic-codes / assertion-free-tests sweeps (d/e) stay recurring. **Added 2026-07-17 (realness audit):** two more silent-gap residues to drain here — (g) the ~17 Python import sites that recover import names by regex-scanning emitted source (`scan.match(/\b[A-Z]\w*Id\b/g)` etc.), fragile by construction — the `*Id`-ImportError instance was fixed in PR #1961, but the principled fix is a `used: Set<string>` populated during emission instead of a post-hoc scan; (h) non-exhaustive `default:` arms in the per-backend expression renderers that degrade silently rather than throwing (e.g. `elixir/render-expr.ts` binary-op fallthrough emits `${l} ${op} ${r}` for an unknown operator → possibly-invalid Elixir, no build error) — audit each against `assertNever`-style exhaustiveness.
**Run 2026-07-27 (~#2226, after the ~300-PR push):** drained (h), dispositioned (g). **(h) — CONFIRMED SILENT BUG + fix.** Auditing every `default:` arm in the five backend `render-expr.ts` against reachability: all are benign (import-accumulators returning `into`, documented `refKind === "unknown"` verbatim-render, id-type fallbacks) *except* the money/decimal binary-op fallthrough the residue named — and it was **reachable and wrong**, not just fragile. `decimal % decimal` type-checks (numeric-widening chain, `type-system.ts:596`) and routes to the shared money/decimal method-renderer on **Java** (`renderMoneyBinary`) and **Elixir** (`renderDecimalBinary`), whose `%`-less `default:` emitted `${l} % ${r}` = `bigDecimal % bigDecimal` (uncompilable — BigDecimal has no `%`) / `%Decimal{} % %Decimal{}` (invalid Elixir). Verified end-to-end by generating: Java `Acct.java` → `this.balance % this.divisor`, Elixir `acct_controller.ex` → `record.balance % record.divisor`; both would fail their compile gates — but **no corpus/example fixture exercises decimal modulo**, so it shipped green. TS/.NET/Python were already correct (native `%` on `number`/`decimal`/`float`). **Fix:** added the proper `%` arm (Java `.remainder()` — exact, no MathContext; Elixir `Decimal.rem/2`) closing the parity gap on all five, and converted the three silent fallthroughs (`renderMoneyBinary` on Java + TS, `renderDecimalBinary` on Elixir) to loud `throw`s — the only ops that can still reach them are `&&`/`||`, which the type validator rejects on money/decimal, so a future reachable case now fails at codegen instead of emitting garbage. Regression pinned in `render-expr-kinds.test.ts` (Java) + `phoenix-render-expr.test.ts` (Elixir). **(g) — VERIFIED NOT A CURRENT BUG (no drain).** The ~20 Python regex-scan import sites are fragile-by-construction but currently correct: generated all 24 python-corpus features (907 `.py` files) and ran `ruff --select F821,F401` (undefined-name = missed import ∧ unused-import = spurious import) → **all pass**; the class is already continuously gated by `corpus-python-build.yml` (ruff + mypy `--strict`), which is exactly what catches a missed-import false-negative. The `*Id`-ImportError instance was already fixed (#1961). The principled `used: Set<string>`-threaded-through-emission refactor spans ~20 emitter files with real byte-identical risk — legitimate tech-debt, but not a "cheap, highest-integrity" audit drain and not a current false claim; left as tracked debt rather than force-fit into this pass. (d) diagnostic-codes / (e) assertion-free-tests sweeps remain recurring. **BOTH GRADUATED 2026-08-13** — (d) is now [M-T9.33](#m-t933--diagnostic-firing-census-prove-every-loom-gate-is-reached--partial-gate-landed-38-of-49-still-undrained--sm--p1--retires-a-recurring-manual-sweep)'s permanent gate (`test/system/diagnostic-firing-census.test.ts`; the manual sweep had been reasoning from a grep that over-reports 2.7x — 131 "uncovered" against a measured 49), and (e) is `test/platform/assertion-free-tests.test.ts` (the class was already drained: 35 of 16,584 cases, all reviewed-benign; pinned per file, both directions ratcheting). The same pass deleted 16 dead `export *` re-export shims and gave `dead-generator-exports.test.ts` a second half that catches them — the first one matched export NAMES, and a bare `export *` declares none. **(d) input from the M-T9.19 reachability pass (2026-07-28):** four `src/ir/validate/checks/workflow-checks.ts` codes are **unemittable from source** — ~~`loom.workflow-name-collision` (`:180`, preempted by `loom.duplicate-workflow`)~~ **— WRONG, corrected by M-T9.33's drain (2026-08-30).** The two gates test different things: `duplicate-workflow` fires on a REPEATED workflow name, `workflow-name-collision` on a clash with an aggregate / value object / enum / event / repository — and a workflow named after an aggregate trips only the second. It fires cleanly and now has a fixture. The other three below HELD, each re-driven rather than inherited, `loom.workflow-create-unknown-aggregate` (`:502`, preempted by correlation/scope resolution), and `loom.workflow-unknown-repository` (`:551`) + `loom.workflow-run-unknown-repository` (`:621`/`:674`) — an unknown repository name lowers to a generic `expr-let`, never the `repo-let`/`repo-run` these arms switch on. Audit for `assertNever`-style deadness or deletion (every reachable sibling arm now has a negative test in `test/ir/workflow-dataflow-checks.test.ts`).

## M-T9.21 — Spec-driven API property fuzzing (Schemathesis) — `partial` (the Hono leg + nightly gate shipped [#2522](https://github.com/Loom-Harness/Loc/pull/2522); the five-backend extension **merged 2026-08-24** as [#2664](https://github.com/Loom-Harness/Loc/pull/2664); the findings drain continues) · **M** · P2
Every gate today drives backends with **example-shaped** inputs (the emitted api suite, the corpus fixtures) — the negative/edge space (out-of-range ints, missing required, malformed enums, boundary strings) is only ever exercised where a human wrote the case. That's the class the `journey/FINDINGS.md` silent-codegen bugs came from. **Feed each booted backend its *own* emitted `openapi.json` to Schemathesis**, which auto-derives thousands of cases from the schema and asserts the server never 500s, never violates its own declared response schema, and honors declared `required`/`format`/`enum`/bounds. Run **per-backend** (a divergence localizes to one target) as a nightly matrix over the booted stack the obs/tenancy e2e workflows already stand up. Complements M-T9.11: the differential checks backends against *each other*, this checks each backend against *its own published contract*.
**Findings drain (2026-08-14, PR #2555):** the node leg's register [`schemathesis-findings-2026-08.md`](../audits/schemathesis-findings-2026-08.md) is down from 9 root causes to 6 — **F2** (non-UUID `X id` in a request body → 500), **F3** (its query-parameter twin) and **F4** (`page × pageSize` overflowing the SQL `OFFSET`) are fixed on all five backends together, since the emitted spec half is diffed by `conformance-parity`. Waivers W2/W3 deleted, W1/W5 narrowed to F1. Still open: F1 (non-JSON Content-Type skips body validation), F5–F9.
**All five legs (2026-08-24):** the runner is generalized (`schemathesis-core.mjs` + `run-schemathesis-backend.mjs`) and `schemathesis.yml` is a backend matrix, so each backend is now fuzzed against its OWN published contract. **F14–F26** in the register: the headline is that F7 (declared type coerced), F8 (wrong verb on a static sub-path) and the `minLength` bound the node emitter fixed are STILL OPEN on python / java / dotnet — a per-backend fix reads as "closed" here while three backends answer the old way. Two spec-availability defects too: .NET 500s `/openapi.json` when two contexts emit a same-named request DTO (**F14**), and elixir publishes no spec at all without an explicit `serves:` (**F15**). Waiver rules are now scoped per backend. The elixir cell ships as a `continue-on-error` discovery leg until a nightly seeds its rules.
**F14 fixed (2026-08-30, PR #2686):** the .NET emitter now qualifies only the OpenAPI schema ids that genuinely collide across its per-aggregate DTO namespaces (`src/generator/dotnet/schema-ids.ts` → `Program.cs`), so `/openapi.json` generates and `SKIP.dotnet["storefront-system"]` is drained — the dotnet leg fuzzes both shared fixtures again. F15 (elixir, no spec without `serves:`) is still the remaining spec-availability defect.

Sources: `journey/FINDINGS.md`, weak-spots §runtime-feedback; reuses the per-backend boot from M-T9.3.

## M-T9.22 — Generative compiler-robustness fuzzing — `partial` (both fuzz slices landed; the corpus-graduation loop is the remainder) · **M** · P2
The corpus is a *fixed* fixture set — it proves the pipeline handles the models someone wrote, never the unbounded valid-input space. **Property-based generator emits random *valid* `.ddd` models** (grammar-driven, shrinking, seed-logged for replay) and asserts two invariants: (1) the pipeline never throws across parse→macro→lower→enrich→validate→codegen (a crash on valid input is always a bug — either a missing validator gate or a silent emitter hole), and (2) the output compiles on ≥1 backend. This is the inverse of the corpus (input space, not input list) and the automated form of the "compile the output by hand to find silent bugs" discipline in `journey/FINDINGS.md`. Nightly; every failure ships with its seed for a deterministic repro fixture that graduates into the corpus.
**Slice 1 landed** — `test/system/pipeline-fuzz.test.ts`: 250 seeds × 1 backend each (~12s in the fast suite), a seeded PRNG with no `Math.random`, so a failure reproduces from its seed alone and the message carries the seed AND the generated source. The invariant is the mission's: a crash on valid input is always a bug — a missing validator gate or an emitter hole.

**Slice 2 (FUZZ-1) landed 2026-09-03** (`eac596e3`, wave G of the [verification plan](verification-waves-2026-09.md)) — the DEEP arm: `test/system/pipeline-fuzz-deep.test.ts` over a generator grown 156 → 684 lines (`test/_helpers/ddd-model-generator.ts` — value objects with invariants, ui pages carrying real walker primitives, workflows/sagas, the three find shapes), plus a deterministic **structure-aware shrinker** (`test/_helpers/ddd-model-shrink.ts` `shrinkModel`) that reduces a failing model to the two or three declarations carrying the bug by removing whole declarations from a `ModelSpec` decision record and re-emitting — every candidate valid by construction, rather than shrinking a string by line deletion. `genModel(seed)` is byte-identical across the growth, so slice 1's seeds still reproduce.

**Remainder:** the corpus-graduation loop the mission's own sentence promises — a failing seed's shrunk repro becoming a committed `test/e2e/fixtures/corpus/` fixture, not just a message — plus the second invariant (*the output compiles on ≥ 1 backend*), which neither slice asserts: both stop at "the pipeline did not throw".

Sources: `journey/FINDINGS.md`, `experience_gathered.md` (silent-codegen retros); pairs with M-T9.8 (hollow-work sweep — same "valid input, wrong/absent output" class, found generatively instead of by audit) and M-T9.29 (the systematic sibling — the pairwise matrix hunts the same class by the opposite method).

## M-T9.26 — `RouteTarget`: seal the HTTP-emission surface behind a contract — `open` (design landed #2396 `173473c`, docs-only; **re-measured post-#2462 on 2026-09-22, wave C4 packet 4d — the seam is CONFIRMED**; slice 1's §2.6 blocker, #2918, **merged 2026-09-28** — unblocked, re-check the quiet baseline and build) · **L** · P2
*(Two duplicate headings for this ID were collapsed into this one on 2026-08-10/12; both prior statuses — `design (awaiting sign-off)` and `in-flight` — were stale.)*

**Re-measurement, 2026-09-22 (the ⚠ below is now DISCHARGED).** On the merged C4 tree the node HTTP shell is **217 coupling sites across 22 emitter files** (`src/platform/hono/v4/` + `src/generator/typescript/`) — it **grew** from the design's pre-unification 183 / 18, it did not shrink; `hono/v5` delegates to v4's emitters and adds none. The mission's own accept/reject test (§2.6b: *"a method used exactly once is dead contract surface"*) was measured rather than estimated, per contract method against the real call sites: **14 of the 16 contract methods are multi-use** (`respondJson` 30, `requestPath` 24, `route` 22, `openRouter` 16, `ctxGet` 12, `errorHandler` 11, `sseStream` 10, `closeRouter` 10, `mountChild` 8, `readParam` 6, `readBody` 4, `ctxSet` 4, `respondEmpty` 2, `imports` 32); only `readQuery` (1) and `rawRequest` (1) are single-use, and §1.3 already records `rawRequest` as the deliberate adapter exception. **The anti-criterion does not fire — the seam is justified on the numbers, not on judgement.** What blocks it is the design's OWN sequencing prerequisite (§2.6, "byte-identical gating needs a quiet baseline"): **#2918 adds 24 lines to `routes-builder.ts`** — the whole of slice 1's blast radius — and changes emitted create-input output, so the byte-identical gate would be a diff against a moving reference; #2980 likewise moves `auth-emit.ts` (slice 4). Same shape as the original #2340 block, one baseline later. **Next action: re-check §2.6 after #2918 lands, then build slice 1 unchanged** *(#2918 merged 2026-09-28 as `a0b4650a`; #2980 also merged — both baselines have settled, so the next action is live)* — the contract shape needs no revision. Recipe + the full per-method census: [`waves/handoffs/wave-c4-4d-callable.md`](waves/handoffs/wave-c4-4d-callable.md).

⚠ *(discharged above, kept for the record)* Re-verify the design's divergence measurements before slicing: the route-builder unification series (#2453–#2462, merged 08-06/08-07) rebuilt every backend's route surface from `deriveContextOperations` AFTER the design was written, so its 183-site census and file list are pre-unification numbers.
The node backend's HTTP shell is the **largest un-sealed emitter in the toolchain** — measured at **56% of a feature-rich generated project** (2337 of 4163 LOC on `showcase.ddd` → `hono_api`, vs 34% for the persistence layer), across **183 coupling sites in 18 emitter files**. It is un-contracted: the `style` axis (`adapter-metadata.ts:63`) already models "one HTTP emission per backend" as a *value*, but nothing pins what that value must provide, so the surface is hand-threaded branches rather than a checked interface.

Unlike the persistence surface [M-T9.2](archive/missions/M-T9.2-persistence-seam-design.md) declined, this divergence is **leaf-shaped, not compositional** — every route is a `(spec object, handler body)` pair whose interior is already framework-neutral IR-rendered TypeScript, so the framework touches only four edges (router construction, input binding, response emission, error mapping). That is the condition `ExprTarget`/`WalkerTarget` succeeded under. Two seams are honestly non-leaf and recorded as such: raw-request access (`c.req.raw`, a Web-Standards-vs-Node adapter) and SSE (`streamSSE`, ~57 emitted LOC, its own lifecycle).

**Value independent of any second framework:** a compile-checked contract replaces hand-placed branches — the failure mode that let `persistence: mikroorm` emit *nothing* for five features with no diagnostic ([M-T6.23](archive/T6-done.md)) at 109 branch sites. Possible de-triplication of OpenAPI emission (Hono / Elixir `openapi-emit.ts` / Java `openapi-customizer.ts`) is slice 6 and deliberately **not promised** up front.

**Scope guard:** this is a *sealing* mission. It does not add a framework and does not reopen the [T10 target freeze](T10-new-targets.md). It is explicitly allowed to conclude as a partial decline if a slice's port yields single-use contract methods — the M-T9.2 §0.4 net-negative-indirection test applies.

Sources: [M-T9.26 brief + design](missions/M-T9.26-route-target-seam-brief.md). Related: M-T9.2 (the precedent + the decline discipline), M-T6.23 (the silent-omission failure mode), `_obs/` (the in-tree neutral-catalog-plus-renderers pattern this generalises).
## M-T9.25 — Intra-backend consistency gates — `partial` · **M** · P1 ⭐ the seam every existing gate is blind to
*(ID history, kept short: minted 2026-08-05 reserving the ID PR #2340 had claimed since 08-01 with no tracker entry, while main independently landed RS-26 (#2329) and RS-27 (#2429) under different meanings than #2340's draft mints. Resolved 2026-08-06 by hard-rebasing #2340 onto both — its four rules renumbered RS-27–RS-30, its 404 finding folded into main's RS-27, and its superseded emitter changes dropped in favor of main's route-derivation refactor (#2462) — except that #2462's supersession was incomplete: it never re-threaded the DomainError/Forbidden `httpStatus` override into the four backends' runtime handlers, silently reverting M-T5.20's own feature; re-applied in the same rebase. #2340 merged 08-09 as `c21dca0`. Two duplicate headings for this ID were collapsed here.)*

> **Round 1 landed (#2340).** Four census sweeps ran; every one found something.
> **Yield: RS-27, RS-28, RS-29, RS-30**, two ratcheted IR merge boundaries, a
> static elixir unused-helper gate, and four missions filed (M-T6.25–M-T6.28).
> Probe 2 is **drained**; probe 1 is **partly swept** and probe 3 is **untouched**.
> The unswept list is at the bottom of this mission — start there.
**Found 2026-08-01 by a 30-second probe, having already shipped.** Every runtime gate this repo owns compares one backend to *something else*:

| Gate | Compares |
|---|---|
| `conformance-parity` | backend ↔ backend (OpenAPI shape) |
| M-T9.11 wire golden | backend ↔ node oracle (runtime values) |
| RS-rules | backend ↔ a named contract |

**Nothing compares a backend's own emitters to each other.** So when a backend disagrees with *itself* — one router resolving a status while a sibling router hardcodes it — every gate stays green, because all five backends are wrong in the same direction and the oracle is wrong too.

That is not a hypothetical. Landing M-T5.20 produced exactly it, twice over:
1. hono emits **four** independent `app.onError` handlers (aggregate routes, workflows, extern handlers, query-time projections), each with its own copy of the denial ladder. Three were converted to `resolveErrorStatus`; the fourth was missed, so `httpStatus DomainError -> N` moved three routers and silently not the projection one.
2. The reason converting it didn't help was worse: **`mergeContexts` never carried `structuralErrorStatuses` / `errorStatusOverrides`**, so *every* emitter fed a merged context read `undefined` and every override no-opped on that path — with no type error, because the fields are optional and `undefined` reads exactly like "nothing declared".

Both were invisible until someone censused the emitted statuses per backend and noticed node still had literals after the sweep.

**The work — three probes, cheapest first.** All are source-level and need no boot, which is the point: they are per-PR affordable.
1. **Repeated-concept census.** For each backend, enumerate every site emitting the same wire concept (7807 arms, wire-key casing, absence shape, money/decimal coercion) and assert they agree. The 7807 surface alone is **61 sites** across five backends — node 25, java 11, elixir 10, dotnet 8, python 7 — and that asymmetry is itself unexplained signal worth reading.
   - **Sweep 1 (422) → RS-27**, python collapsing the wire-validation rung into the domain floor. Pinned by `test/conformance/problem-arm-census.test.ts`.
   - **Sweep 2 (404) → RS-28**, and this one is the class in its purest form: **node emitted three different `detail` strings for one rung inside one generated app** — descriptive at the repository, `"not found"` on the criteria-find path, `"not_found"` on the route a client actually reaches. Python had two of the three; dotnet, java and elixir one each. Because node is the golden's **oracle**, the first golden to record an id-addressed 404 would have frozen the bare token as the answer key and turned the three *correct* backends red. Pinned by `test/conformance/not-found-detail-parity.test.ts`.
   - **Method note, earned twice.** Both sweeps were only trustworthy because the divergence was read off **generated output**, not off the emitters. Grepping emitters is what made a `conforms: all five` claim wrong three times in this rule family (RS-18 ×2, RS-19, RS-26). Generate all five, diff the emitted strings, then write the rule.
   - **Remaining, unswept:** 401/403 arms (blocked on the same unauthorized-principal harness gap as M-T9.11's 4xx goldens), 409 concurrency, 500. Plus the non-7807 concepts listed above — wire-key casing and absence shape have had no census at all.
2. **Field-carry ratchets at every merge/projection boundary.** `test/ir/ir-merge-completeness.test.ts` holds both: it fails when a field is neither carried nor named in a reviewed drop-list, *and* when a drop-list entry goes stale.
   - **`mergeContexts`** (`EnrichedBoundedContextIR`) — written from the original bug.
   - **`mergeLoomModels`** (`RawLoomModel`, the multi-file import-graph fold) — swept 2026-08-02 and found **complete**, but ratcheted anyway because it is the same field-by-field rebuild with a *worse* escape hatch: `if (models.length === 1) return models[0]!` means a single-file model never enters the rebuild, and nearly every test in this repo is single-file. A field dropped there stays green across the whole suite and fails only on the multi-file shape users actually write. Its one uncarried field (`traceability`) is correct — enrichment populates it after the merge — and that reasoning is now pinned rather than re-derived.
   - **Swept and found immune:** every other IR reconstruction site spreads (`enrichContext` → `{...ctx}`, `enrichAggregate` → `{...resolved}`, `enrichPart`, `enrichValueObject`), so the class cannot occur there. `collectContextsFor` filters rather than rebuilds. **These two are the whole population** — the probe is drained unless a new field-by-field rebuild is introduced.
3. **One-override-moves-everything.** `test/conformance/denial-ladder-override-parity.test.ts` is the template: assert a single declaration reaches *every* emission site, per backend and across backends. Its first version was worthless — a whole-output `toContain` passes as soon as one router resolves, and it went green against the broken code — so the assertion has to be **per-file**, and must be verified to fail without the fix.

**Why P1.** The two other discovery seams (cross-backend divergence, golden re-read) are largely drained: 26 RS-rules, 25 of them now five-way conforming. This one has **no coverage at all** and produced a shipped bug on first inspection. Expected yield is the highest of the three.

### What is still unswept (round 2 starts here)

Ordered by expected yield. Every one is a source-level probe needing no boot.

1. ~~**Re-run the whole 4xx/5xx census UNDER AN OVERRIDE.**~~ **SWEPT (round 2, probe 1)** — pinned by `test/conformance/override-status-census.test.ts`: 33 emission sites across five backends, each a (file, regex-capturing-the-status) pair asserted PER FILE both under a six-rung non-default override *and* under default emission (the second half is what stops a stale regex passing vacuously). **The four named suspects were stale** — node/dotnet/python destroy and elixir `conflict_response` all resolve on fresh `main` (#2340's own M-T5.20 restoration commit converted them). The suspicion was right as a *class* and wrong as a *list*; six real hardcodes were elsewhere, and the biggest was one layer up from any backend: **`findErrorStatuses` (`src/ir/util/api-surface.ts`) threaded the `httpStatus` resolver into `operation`/`create`/`destroy` and omitted it on all three FIND arms**, so `httpStatus Forbidden -> N` moved a gated operation's declared response set on all five backends and silently not a gated find's — `resolve` being an *optional* parameter whose absence reads exactly like "nothing declared", the same shape as the `mergeContexts` bug that opened this mission. Also fixed: elixir's find controller, audit-history controller and optional-find absent arm spelled `403, "Forbidden"` / `404, "Not Found"` as literals while the projection controller beside them already went through `denialResponse(…, denialOverrides(ctx))`; and elixir's `problem_response/4` chose its observability CATALOG EVENT from the status (`case status do … 409 -> "disallowed"`), so a remapped rung answered the right wire status and logged `domain_error`. **Ratcheted, then fixed (2026-08-18):** the sweep parked one divergence as four waivers — `httpStatus NotFound -> N` honoured by **elixir only**, the other four hardcoding 404 at both the handler arm and the declaration. The follow-up slice closed it (M-T5.20's last rung: `errorStatuses` resolves `NotFound`, every backend's exception-handler arm and hand-rolled declared set reads the resolved value), so all four waivers are **deleted** and their sites live in `SITES` alongside a new DECLARED-set site per backend. The ratchet worked exactly as designed: the waivers named the gap precisely enough that closing it was a scoped slice rather than a rediscovery.
2. ~~**The 401/403 arms.**~~ **CLOSED (wave C3 packet 3c, 2026-09-28).** Bodies: #2541 recorded the 401/403 problem bodies into the wire golden, so they are five-way diffed on every behavioural leg. Headers + envelope: every 401/403 arm the authz ladder drives now ALSO asserts, on the booted app and against the RFCs rather than any emitter, `application/problem+json`, `status` member == HTTP status, the RFC 9110 reason phrase as `title`, `type`/`detail` present, and on a 401 a `WWW-Authenticate: Bearer` challenge (`__refusalEnvelope`, `test/behavioral/wire-differential.mjs`) — the golden records no headers, so this is the only runtime witness of either. Mutation-proved on node and python (the challenge dropped, the problem media type downgraded: the status arms stayed green, the envelope arms failed by name). Source level: `test/conformance/authz-status-census.test.ts` (the five-way 401/403 producer census) gained a ratcheting waiver for the one divergence left — the **audit-history gate's 403 detail** is spelled `Forbidden` (node, python), `Forbidden: find history` (dotnet, java), `Forbidden: history <Agg>` (elixir); handed off (`docs/new-plan/waves/handoffs/wave-c3-3c-authz.md`). History, kept: **UNBLOCKED (2026-08-17) — the harness gap is closed.** #2515 minted the second principal in both auth flavours (`DEV_CLAIMS_UNAUTHORIZED`, `oidc.unauthorizedToken`), and the three-rung `AUTHZ_LADDERS` walk (unauthenticated → 401, authenticated-but-unauthorized → 403, authorized → 2xx) now runs on **all five** behavioural legs — see `test/behavioral/README.md` § the ladder, and `AUTHZ_LADDERS` in `cases.mjs`. What remains here is the *problem-body* half: the ladder asserts STATUS CODES on the unrecorded dispatch, so the 401/403 RFC-7807 bodies are still uncompared across backends. Wiring them into the recorder is a deliberate golden rebaseline (M-T9.11's 4xx goldens, #2541).
3. **Event-sourced and document persistence.** Sweeps 1–4 used a relational fixture, so `repository-eventsourced-builder.ts` / `repository-document-builder.ts` (TS **and** python) each carry their own `Concurrency` sites that were never reached. Parameterize on `event-sourcing.ddd` / `document.ddd`.
4. **`errors[]` pointer shape for a NESTED field.** Partly inferred, not verified: java's `pushNestedPath` yields `/lineTotals[0].unitPrice`, which is **not an RFC 6901 pointer**, while .NET explicitly converts to `/items/0/qty`. Elixir's validator never traverses `cast_assoc` children, so a nested violation likely yields `errors: []`. Needs generating all five and reading, not reasoning.
5. **Probe 3 — one-override-moves-everything, per backend.** `denial-ladder-override-parity.test.ts` is the template but currently asserts per-file on node only. The same claim is unmade for dotnet/java/python/elixir.

**Method, non-negotiable, earned four times:** read GENERATED OUTPUT, not emitters. Grepping emitters is what made an all-five `conforms` claim wrong on RS-18 (×2), RS-19 and RS-27. Generate all five from one parameterized fixture, diff the emitted strings, *then* write the rule. And make the fixture able to falsify the rule — see `docs/conformance-semantics.md` § "Make the fixture able to falsify the rule".

Sources: found while landing M-T5.20 / M-T6.24 (#2340). Relates to M-T9.11 (whose oracle model structurally cannot see this class) and M-T9.8 (the "is a green gate telling the truth" question, asked of the gates' *domain* rather than their assertions).
## M-T9.27 — The `*-unsupported` register: enumerate the gaps before draining them — `partial` (slices 1–3 landed; slice 4 open) · **S→M** · P1 ⭐ policy-enabling
**Under no-permanent-skips, every `*-unsupported` code is a commitment — and the list could not be planned.** Sixty-nine codes carry the suffix; they were inline string literals across ~50 files (enumerating them needed a throwaway script), **53 of the 69 were mentioned nowhere in `docs/new-plan/`**, and — the finding that matters — **the suffix misclassifies 27 of them**. Reading every emission site splits the 69 four ways: **42 `gap`** (real parity TODOs, drain to zero), **13 `never`** (semantically impossible or deliberately refused — `projection-groupby-join` "'join' and 'group by' don't compose"; `policy-write-global`, a documented deliberate never), **8 `scope`** (declared v1 limits naming their own successor, e.g. `criterion-unsupported-target` → M-T5.4), and **6 `rule`** (not gaps at all — `auth-ui-on-backend` is a misuse error, `ui-handler-unsupported` a closed vocabulary). A third of the apparent debt is permanent by design, and no naming convention separates it from the real work.

**Slice 1 landed:** `src/diagnostics/unsupported-register.ts` (one row per code — `kind`, emission site, one-line what, owning mission, `verified`) + `test/system/unsupported-register.test.ts` gating four invariants: every emitted suffixed code is registered (a new gap can't be minted silently), every row is still emitted (a drained gap deletes its row in the same PR), no duplicates, and the open-gap count pinned at `MAX_OPEN_GAPS` (asserted both `<=` and `===`, so draining without lowering the pin fails, and minting a gap without raising it fails too). **The current ceiling is `MAX_OPEN_GAPS` in `test/system/unsupported-register.test.ts` — read it there.** A number copied into this prose is a cache with no invalidation (retro §91), and this paragraph used to carry one. **Mutation-proven** — deleting a row fails invariants 1+4; renaming a code at its emission site fails 1+2.

**Sprint view:** the gaps collapse to **ten work units** (lifecycle stamps ×5 codes = one rule with five names; projections ×6; persistence adapters ×5; frontend primitives ×5; governance emission ×5; misc backend tails ×6; unions/carriers ×3; UI read paths ×3; event sourcing ×2; inheritance ×2). **Slice 3 landed:** every gap now cites an owning mission (six minted — M-T6.32/33/34/35/36 + M-T1.20), and two mutation-proven invariants keep it honest: every gap cites a mission, and every cited id resolves to **exactly one** `## M-Tx.y` heading. The second was load-bearing — T6 carried three duplicate ids from two collided renumbering attempts, since fixed (M-T6.29/30/31).

**Slice 2 landed:** the 19 non-gaps are renamed out of the suffix — `-invalid` (impossible/refused, 15), `-no-effect` (parses, does nothing, 2), `-unknown` (not in a closed vocabulary, 2) — so **the remaining suffix means exactly one thing: work, now (`gap`) or later (`scope`)**. `UnsupportedKind` is narrowed to those two, making a future `kind: "never"` row a *compile* error rather than a review catch. No behaviour change (same checks, messages and emission sites; only the stable ids and their `messages.ts` catalog keys move); the register is one row per suffixed code — count `UNSUPPORTED_REGISTER` in `src/diagnostics/unsupported-register.ts`, not this sentence. This had to precede the drain sprint — left in place, a third of the board would have been undrainable by construction and the burndown would have stalled at 19.

**First drain (M-T6.33, 2026-08-11):** the lifecycle-stamp unit re-verified as **not gaps at all** — its five codes were one shared body whose two arms read only the model (`dep.auth`, `sys.user`, `agg.persistedAs`), never a backend capability. Renamed to `loom.stamp-principal-without-auth` (misuse) and `loom.stamp-on-event-sourced-invalid` (impossible), five validators collapsed to one, five register rows removed: **`MAX_OPEN_GAPS` came down by five**. Worth noting how that number moved — by re-classification, not by emitting anything, which is exactly what the verify-first instruction on three of the six slice-3 missions was for. The pin is **not** a monotonic burndown: it also rises when a new gap registers honestly, so the ceiling today is whatever `MAX_OPEN_GAPS` (`test/system/unsupported-register.test.ts`) says — this paragraph deliberately no longer names it.

Slice 4 (the FULL `loom.*` catalogue — `messages.ts` — plus docs anchors and fix hints) is deliberately last; it covers the plain-rule codes, which don't drain. Its size is `grep -c '^  "loom\.' src/diagnostics/messages.ts`, not a number written here (the design doc's "419" was already stale when the 08-30 ledger checked it).

**Register rows owned by closed missions (wave L0, 2026-09-29 — leftover-waves D9/D10 residue; ledger row `register-rows-closed-missions` in `docs/audits/targets-completeness-2026-08-30.ledger.json` is still open).** This mission owns their re-homing until each row names a live owner: the `scope` row `loom.migration-expr-unsupported` cites done **M-T2.3**; the `seam` rows `loom.audited-backend-unsupported`, `loom.filter-bypass-unsupported` and `loom.provenanced-backend-unsupported` cite done **M-T6.32**, and `loom.event-sourced-workflow-unsupported` and `loom.event-sourcing-backend-unsupported` cite done **M-T6.34** (`src/diagnostics/unsupported-register.ts:128,248,257,346,578,836` on `cbda9165` — five seam rows counted here; the L0 register audit reported six, so re-count before draining). For each: re-verify the gap, then point the row at the live mission that will close it (or re-kind it `settled`) and close the ledger row.

Design: [`M-T9.27-unsupported-register-design.md`](missions/M-T9.27-unsupported-register-design.md).

Sources: language-size review 2026-08-04/05. Relates to M-T9.8 (allowlist ratchet — same discipline, one register over), M-T5.21 (callable unification — the other half of the same review; the six duplicate `loom.workflow-*` code pairs are that mission's symptom, not this one's).

## M-T9.28 — Authorization-surface census: prove a gate DENIES, not just compiles — `partial` (slices 1–3 landed; the registry-row residue is #2976's) · **M** · P1 ⭐
> **ID note.** [`README.md`](./README.md)'s 2026-08-10 mint line describes M-T9.28 as "repo-wide `.ddd` + clause census". That description is **stale**: the `.ddd`/clause census shipped unlabelled in [#2498](https://github.com/Loom-Harness/Loc/pull/2498) (`test/system/ddd-source-census.test.ts`), and the only claim on this ID in code is [#2515](https://github.com/Loom-Harness/Loc/pull/2515), which uses it for the **authorization-surface census**. First claim wins (the rule the M-T6.37/38 collision established), so M-T9.28 is the authz census and the README line is the thing to correct.

The behavioral tier held exactly ONE identity, so the only authorization statement it could make was "the satisfying principal gets through" — which a `requires` emitted as a **no-op passes identically**. That is precisely how [#2446](https://github.com/Loom-Harness/Loc/pull/2446) shipped a guarded `create` with an open route: every gate was green because every gate was blind in the same direction.

**Slice 1 landed (#2515)** — a second principal in both auth flavours: `DEV_CLAIMS_UNAUTHORIZED` (same shape and same tenancy claims as `DEV_CLAIMS`, so only the authorization predicate differs) and `oidc.unauthorizedToken` (same issuer and signing key, so it *verifies* and is then *refused* — the 403 path, not the 401 path). Three consumers were on record as blocked on it: this census, M-T9.25 round 2's 401/403 problem-arm sweep, and M-T9.11's 4xx wire goldens ([#2541](https://github.com/Loom-Harness/Loc/pull/2541), open).

**Slice 2 landed too — and it is the census, not the runtime drain.** [#2766](https://github.com/Loom-Harness/Loc/pull/2766) (the verification waves, merged 2026-09-09) shipped `test/ir/authz-gate-census.test.ts` + `test/ir/authz-gate-census-pins.ts`: it enumerates the four authorization surfaces `docs/auth.md` defines — `requires` (per surface: `operationGates`, `lifecycleGates`, `FindIR.requires`, a projection header's `query.requires`, `RepositoryIR.historyFind.requires`, `WorkflowIR.instanceReadGate`, and a `requires` statement in a workflow command entry or route-bound handler), the `policy` `authz-filter` sentinel, `mask unless`, and the tenancy predicate — **read off the enriched IR, never grepped from emitted source** — and asks, per gate, whether any caller exists that must be DENIED. So the denominator now exists and a newly-emitted gate with no refusing caller fails rather than passing silently. The old "Open half" paragraph read as though nothing had been built.

**Slice 3 landed (wave C3 packet 3c, 2026-09-28) — 13 more gates proven to DENY on the booted app, pins 84 → 71.** Two harness changes, neither needing the registry-row principal: a ladder surface may carry its OWN `seed` (the multi-id seeding `R.oneSeededId` named — `lifecycle-guard`'s `Shipment.destroy` is now refused, the class is empty), and the census credits the CROSS-TENANT rung as the refusal of a surface whose ONLY gate is the tenancy predicate (`isSurfaceRefused` — the objection that a hidden-row arm would stand in for an unexercised `requires` cannot apply where there is none). New cross-tenant arms on the read AND write seams (by-id, update, destroy — each on its own seeded row): `tenancy-owned`, `policy-deny`'s `Ledger`, and new specs for `tenancy-filter` and `tenancy-claim-name`. Goldens node-minted and verified on the python and mikroorm legs; mutation-proved (the node by-id tenant conjunct dropped → every new cross-tenant arm answers 200/204 where 404 is required, while `tenancy-owned`'s own `test e2e` stays green). The emitted-source census (M-T9.41) now also proves APPLICATION for every remaining un-refusable pin (`principalFreeGate`, `sharedTenancyIdentity`, `maskIsNotAStatus`) — see its "pin redirect".

**Residue after slice 3** (the census's `PIN_CLASS_CENSUS` is the count, not this sentence): the tenant-REGISTRY aggregates' surfaces (their self-scope keys `id` on the tenancy claim, and no harness principal's claim is a registry row id — #2976, open, claims the registry-ROW principal); `create` surfaces (a foreign tenant creating stamps its own tenant — nothing to refuse); list `find`s (a leak answers 200 — status cannot see it); `maskIsNotAStatus` (needs a principal HOLDING the unmask claim to show the mask lifting); `principalFreeGate` (argued unreachable at the site).

**What was still open before slices 2–3** was the *drain* the census enumerates: a runtime caller that is authenticated-but-unauthorized and must be REFUSED, for every gate the census lists (`requires`, each `policy` ladder rung, `mask unless`, the tenancy predicate). The negative direction is the whole point — an authz test that only ever asserts the allowed case cannot distinguish an enforced gate from an absent one — and the two principals slice 1 minted are what makes it writable. **Verify the census's current pin before starting; it moves with every gate added.** Its emitted-code sibling is M-T9.41, which owns the proof-on-emitted-code framing.

Sources: [quality-audit-2026-08](../audits/quality-audit-2026-08.md) R3(a). Feeds M-T9.25 (round 2), M-T9.11 (4xx goldens). Related: M-T3.16 (the lifecycle write gate whose absence this class of blindness hid).

## M-T9.31 — Weekly quality delta, mechanically — `partial` (lane 1 landed; lane 2 in flight) · **S/M** · P1 ⭐ the pinned success metric
§3 of the 2026-08 audit ("how the bugs are actually found") is its most important table and its most expensive: an afternoon of reading 235 commit bodies by hand, i.e. a snapshot nobody will redo, i.e. a ratio that **cannot be watched moving**. R11 pins the success metric explicitly — the share of bugs discovered by per-PR gates (~16% at baseline) should overtake the share discovered by episodic audits (~58%).

**Lane 1 landed (#2513)** — `scripts/quality-delta.mjs` + a Monday cron appending one comment to one `quality-delta`-labelled issue: register counts read from the repo (wire waivers, unsupported-register open gaps, HEEx pins, corpus `COMPILE_SKIP`), merge stats over the trailing window, the R11 discovery split over ATTRIBUTED fixes only, R12 claim hygiene, and main-push failures from the Actions API. The classifier is pure and pinned by `test/system/quality-delta.test.ts`.

**Lane 2 — the Δ was measured against the wrong thing.** `BASELINE` was a frozen constant dated 2026-08-02, so every run diffed against a fixed point rather than the previous week, and a ratchet drained *after* that date read as growth forever. The 2026-08-16 dry run printed `wire waivers 2 → 4 ↑ +2 ⚠️` and `COMPILE_SKIP 0 → 2 ↑ +2 ⚠️` — the first was moving DOWN week over week, the second had not moved at all. In a repo whose convention is "a stale waiver fails its gate", a false ⚠️ costs an agent a re-fix of something already fixed. Fixed by DERIVING the comparison: every register is a file under version control, so last week's value is the same reader at `git rev-list -1 --before=<window start>` — no stored series, nothing to invalidate ("derive, don't stamp"). An unreadable register renders `n/a`, never `0`, so a rename cannot read as a regression.

**Open:** red-time. The report can count main-push failures but not how long `main` was broken — see M-T9.30's sibling note; the `ci-red-alarm` recovery half (landed with lane 2) is what makes the open→close span recordable.

Sources: [quality-audit-2026-08](../audits/quality-audit-2026-08.md) R11 §6.


## M-T9.40 — `--verify-ir`: the resolved-IR contract has no verifier, and no check reaches every expression — `partial` (the census, the enumeration, the verifier and BOTH migrations landed; **only the production `--verify-ir` surface remains**) · **M** · P1 ⭐ turns phase-⑧ forensics into a phase-⑤ assertion

> **Body reconciled 2026-09-10 (Wave C0.4).** This mission's status line and its "The work" list contradicted its own body: the line said "the verifier and the partial-walk migration are open" and the list said "(1) is done; (2) and (3) remain", while three paragraphs above them recorded the verifier landing, running on every fixture in the tree, and both migratable walks being migrated. Re-verified on `main` — **(1) and (2) are done and (3) is HALF done**, and the half that is missing is the one the mission is named after. See §Remaining below; the narrative that follows it is the landing record, kept verbatim.

### Remaining — the production `--verify-ir` surface (the only open half)

The verifier runs on every **test** generation and nowhere else. `assertLoomModelVerifies` (`src/ir/verify/verify-ir.ts:131`) has exactly two call sites, both in `test/_helpers/generate.ts` (`:38` inside `assertModelVerifies`, `:288` on the multi-file path) — `grep -rn "verify-ir\|verifyIr" src/cli bin src/system` is **empty**. So slice (3)'s two production halves are unbuilt: a `GenerateSystemOptions` flag (default OFF) and the CLI `--verify-ir` the mission's own title promises, which is what would let a user — or an agent authoring through the toolkit — get the contract checked on their own model rather than only on ours.

**No longer open, contrary to the old text:** the `generateHono` bypass this body named as "worth its own slice" is **closed** — `test/_helpers/generate.ts:64` now wraps it (and `generateDotnet` at `:87`) in the shared `assertModelVerifies`, which runs the verifier before phase ⑦, pinned by `test/system/legacy-generate-path-ratchet.test.ts` (that was M-T9.48 / M-T9.49's work, not this mission's).

**The follow-up this opened stays a separate mission, not a continuation:** a per-declaration check is only as complete as `validate.ts`'s fan-out — a check handed each `BoundedContextIR` cannot see a page body, because pages hang off the SYSTEM. Scope it from a measurement the way this one was, and *not* from the assumption that the remaining walkers are copies. They are not (see the classification table below).

Minted 2026-08-31 by the [verification-architecture audit](../audits/verification-architecture-2026-08-31.md) §4 C2.

`docs/technical.md` states the payoff of phase ⑤ as a CONTRACT: "every name carries a `refKind`, every member access carries `receiverType` and `memberType`, every call carries a `callKind`. Backends never re-resolve." Most of that contract is enforced by the IR's own types — but the parts that are not are exactly the parts a lowering bug breaks: `enumName` on an `enum-value` ref, `resourceName`/`resourceKind` on a `resource` ref, `wfScope` on a `workflow-fn` ref, `storeName` on a `store-field` ref. Each is an OPTIONAL field the type system cannot require, and each reaches a backend as `undefined` that renders into emitted source as the literal text `undefined` — found, today, only by whichever compile leg happens to cover that cell.

**The second half is the harder one: there is no model-wide expression enumeration.** Eleven files under `src/ir/validate/checks/` and `src/ir/enrich/` roll their own partial walk over the model's expression-bearing sites, and they disagree about which sites exist. `validateExprIntegrity` — the check whose name claims the whole surface — carried its own outer loop over page body/title/requires/state plus the aggregate/workflow domain sites, and an A/B against the enumeration measured what that reached: **2,316 of the 3,609 expressions in five examples**. It skipped every `find` filter, criterion, retrieval, domain service, command/query handler, seed value, field default, context filter and stamp, every test, every value-object and entity-part member, and — on the UI side it partly covered — every component, store, action, named layout, menu and notification. So "does this check reach every expression" had no answer anywhere in the tree, and a check that looks total is silently partial. This is the §77 class (a gap spanning one axis is invisible to per-axis tests) applied to the compiler's own checks.

> That figure is an A/B measurement, and getting to it took two corrections. The first version of this row said the check reached "no ui page" at all — it reaches four page sites. The second estimated the gap at 18% by classifying sites from the source by hand — the real gap is 36%, because the old loop was selective *within* a site (`DerivedIR.expr` on an aggregate but not on a page, a value object or an entity part), which a site-level reading cannot see. Prose about coverage is exactly the thing this mission exists to stop trusting, including its own.

**The denominator now exists** (landed 2026-08-31). `test/_helpers/expr-sites.ts` computes, from `loom-ir.ts`'"'"'s own declarations, every `(type, field)` pair that transitively reaches an `ExprIR`: **222 sites, of which 42 are the intra-expression recursion `walk.ts` already owns exhaustively, leaving 180 declaration sites across 65 IR types** for the outer loop to reach. The split is the number that matters — it is the size of the half nothing owns. `test/ir/expr-site-census.test.ts` gates the analysis in both failure directions (an empty census reads as total coverage; a census of every field reads as plausible), mutation-proved against three seeded regressions.

**A generic shape-sniffing walk is NOT the shortcut it looks like** (checked 2026-08-31, before writing the enumeration). The obvious cheap version — descend structurally through the model and treat any `{ kind: … }` object whose tag is an `ExprIR` kind as an expression — needs no per-type maps and would be total over the actual data for free. It is unsafe here: the tag namespaces OVERLAP. `id` and `primitive` are both `ExprIR` kinds and `TypeIR` kinds; `call` is both an `ExprIR` kind and a `StmtIR` kind. A sniffing walk would hand a `TypeIR` to an expression consumer, or skip a real expression, depending on which disambiguation rule it guessed — and mis-visiting silently is the exact failure class this seam exists to remove. So the enumeration is EXPLICIT, and the census is what makes explicit safe.

**The enumeration now exists** (landed 2026-08-31). `src/ir/util/model-exprs.ts` walks all 176 declaration sites and hands every expression — deep, with a `source` label, its census `site`, and a `ui` flag only the walk can know — to one visitor. `test/ir/model-exprs-completeness.test.ts` asserts its declared site set equals the independently-derived census in BOTH directions, so adding an expression-bearing field to the IR fails the build until the walk acknowledges it; mutation-proved by adding a field, by dropping a visit, and by making the walk shallow. **The verifier now runs on every fixture in the tree (2026-08-31).** `assertGeneratable` (`test/_helpers/generate.ts`) already lowered and enriched the model to run phase ⑦, so the verifier rides that same model for the cost of one more walk — which is why it could be wired into the shared helper rather than living in one gate. All 2,677 `generateSystemFiles` call sites now check the phase-⑤/⑥ contract, and it is ordered BEFORE phase ⑦ deliberately: `validateLoomModel` reads `refKind`, `receiverType` and `callKind` off the IR, so a model check running on a malformed IR is reporting on something that was never built correctly.

Proven to fire, not assumed: seeding `enumName: undefined` into the common enum-value lowering path failed 8 tests with `IR verification failed` on 10 fixtures. **The first attempt at that proof was a false negative worth recording** — the mutation broke four tests in `test/generator/hono` and the verifier said nothing, because those tests call `generateHono`, the legacy single-context helper, which does not go through `assertGeneratable` at all. **93 call sites use it**, and every one bypasses phases ①/④/⑦ as well as the verifier — the same honesty hole M-T9.34 closed for `generateSystemFiles`, still open on the legacy path. Worth its own slice; noted here rather than fixed, because widening `generateHono` is a separate blast radius.

**The verifier landed, and it found one thing (2026-08-31).** `src/ir/verify/verify-ir.ts` checks the resolution contract over every expression (`enumName` / `resourceName` / `wfScope` / `storeName` on the ref kinds that must carry them, plus the `as never`-escape guards for `receiverType` / `memberType` / `callKind`) and the two structural invariants no validator owns (the derived wire shape leads with `id`; a concrete aggregate has a repository whose first find is the auto parameterless `all`). **It found zero violations on eight examples and all 59 corpus fixtures** — which is the honest measurement, and the reason it is described as a regression guard rather than a discovery.

The discovery came from the property beside it. Running **enrichment idempotence over the corpus** rather than the four examples `test/ir/properties.test.ts` could afford failed on `policy-deny` and `policy-document`: the `policy { deny [read] }` carve-out appended its always-false sentinel to `contextFilters` unconditionally, so a second enrichment added a second identical term and a second `contextFilterOrigins` slot. Harmless in the pipeline (enrichment runs once) and harmless in meaning (an AND of a term with itself) — but it violated a contract `properties.test.ts` already asserted, on the only two fixtures in the tree that carry a `deny`, and neither example set has one. Fixed at the append site; mutation-proved by reverting it. That is the input-set lesson in one finding: the invariant was already written down, and the four examples it ran on could not reach the shape that broke it.

**Two migrations are done too.** `validateExprIntegrity` now runs off `forEachModelExpr` — 51 lines of hand-rolled outer loop deleted for 20, its reach going 2,316 → 3,609. `validateVariantMatch` followed: it carried a straight COPY of the same loop minus the ui half, so 29 more lines went for 14. Both produced **zero new diagnostics** across nine examples and all 59 corpus fixtures, so the widening is reach and not behaviour.

The second migration closed a gap worth naming. The copied loop walked `agg.operations` and `wf.statements` — and not `agg.creates` / `agg.destroys` / `canonicalCreate`, nor `wf.creates` / `subscriptions` / `handlers`. **Every hand-written `create` and `destroy` body, and every workflow `create` block, was outside all four variant-match gates**: a `match` there was parsed, lowered and emitted with its non-union subject, unknown variant, duplicate variant and exhaustiveness checks never run. `test/ir/variant-match-reach.test.ts` pins it with a control case beside the widened one, and it was verified by reverting the outer loop and watching the widened case go quiet.

**And (3) turns out to be done, because "eleven partial walks" was the wrong count.** Eleven files walk expressions; the number that carried a MODEL-WIDE, scope-free outer loop over the expression surface — the thing `forEachModelExpr` replaces — is **two**, and both are now migrated. Verified rather than assumed, by classifying every walker:

| Shape | Files | Migratable? |
|---|---|---|
| Model-wide, scope-free outer loop | `validateExprIntegrity`, `validateVariantMatch` (both in `structural-checks.ts`) | yes — **done** |
| Model-wide but SCOPE-CARRYING | `ui-checks.ts` (9 model loops, 26 walk sites) | **no** — it threads lexical `scope`, `exemptLambdas`, `actionsByName` and per-ui callable-name sets through a custom recursion, and says so at its own recursion site: "`walkExprDeep` can't thread scope". A wholesale migration would drop the context every one of its checks depends on. |
| Local walks over a declaration handed in by `validate.ts`'s fan-out | the other eight (`system-checks`, `domain-service-checks`, `capability-checks`, `test-checks`, `workflow-checks`, `projection-checks`, `index-suggestion-checks`, `shared`, plus `enrichments`) — **zero** model-wide loops between them | **no** — there is no outer loop in them to replace |

The two remaining `allContexts(loom)` loops in `structural-checks.ts` are not expression walks at all (duplicate context names, unique-key columns).

**What the classification opens instead.** The per-declaration checks are exactly as complete as `validate.ts`'s fan-out is: a check handed each `BoundedContextIR` cannot see a page body, because pages hang off the SYSTEM, not the context. So "does this check reach every expression" becomes "does the fan-out hand it every declaration of the kind it cares about" — the same question one level up, and one the census can now answer the same way. That is a follow-up mission, not a continuation of this one; it should be scoped from a measurement, the way this one was, and NOT from the assumption that the remaining walkers are copies. They are not.

**The landing record.** (1) ~~`src/ir/util/model-exprs.ts` — ONE enumeration of every expression in a model with a source label, exhaustive over the declaration kinds (the `walkExprChildren` family already gives the intra-expression exhaustiveness; this is the missing outer loop). (2) `src/ir/verify/verify-ir.ts` — a pure `verifyEnrichedModel(model): string[]` over that enumeration plus the structural invariants `test/ir/properties.test.ts` currently asserts on four examples (`wireShape` present and `id`-first, VOs carrying neither `id` nor containment, every aggregate's repository leading with the auto `all`, deployable/module references resolving). (3) Wire it as a `GenerateSystemOptions` flag and a CLI `--verify-ir`, default OFF in production and ON in `test/_helpers/generate.ts`, so every fixture in the tree — plus the 250 fuzz seeds and the pairwise matrix — checks the contract for free.~~ (1) and (2) are done; (3)'s TEST half is done (`test/_helpers/generate.ts`) and its PRODUCTION half — the `GenerateSystemOptions` flag and the CLI `--verify-ir` — is what §Remaining above carries.

Sequence (3) last and behind a measurement: turning it on across ~985 generator test files will either be silent or surface a wave, and which one it is IS the finding. The partial walks in (1)'s consumers are then deletable, which is the point — the seam pays for itself in removed copies.

**Verification when it lands.** Mutation-proved per invariant, not per file: drop `enumName` at the lowering site that sets it and the verifier must name the expression; drop a `wireShape` and it must name the aggregate. And the enumeration itself needs its own proof, which the census now makes mechanical rather than aspirational: every one of the 180 declaration sites must be marked visited by `model-exprs.ts`'"'"'s own per-owner site maps, cross-checked against the census. Two independent derivations of the same fact, with a gate between them — the §89 shape, gated this time. A site added to the IR with no arm must fail, or the seam is one more partial walk with a better name.

Sources: [verification-architecture-2026-08-31](../audits/verification-architecture-2026-08-31.md) §4 C2. Relates to M-T9.34 (harness honesty — the same "the instrument was blind" class, one layer down), M-T9.25 (intra-backend consistency).

## M-T9.41 — The tenancy/authz/masking proof belongs on EMITTED CODE, not on the IR — `partial` (the emitted-source census landed, wave C3 packet 3c; residue below) · **L** · P1 ⭐

**Landed (wave C3 packet 3c, 2026-09-28):** `test/ir/authz-emitted-census.ts` (engine) + `.test.ts` (gate) + `-pins.ts`. Per backend variant — node, MikroORM, EF, Dapper, java, python, elixir — over the tokenized half of the IR census's population (now shared: `test/ir/authz-gate-census-population.ts`) plus two census-local fixtures carrying the historical leak shapes and every gate class: **S** every read of a filtered aggregate's storage (repository methods, projection handlers, aggregations, retrievals, command loads) is located, classified against the IR, and must carry every conjunct the IR applies (tenant floor, registry self-scope, `policy` subtree scope and `deny`, write scope, a find's own principal `where`) and drop every one an `ignoring` bypasses — an unclassifiable read fails, and a vacuity guard requires every IR read to be LOCATED; **G** every `requires` gate (all eight surface classes) is emitted in a scope its surface names — the emitted half of route-gate totality under `denyByDefault`, whose IR half is `loom.default-deny-ungated`; **M** mask closure: masked serializers carry each field's predicate, raw-serializer uses are audit snapshots only, audit-history entries are guarded. **Mutation-proved against both historical leaks on every backend**, at emitted level (28 seeded proofs in the gate) and at src level (re-seeding F2-ADP-1 in `find-emit.ts`/`dapper.ts` and A1 in the node/python aggregation builders each fails the census by name). The IR census's 71 un-refusable pins are redirected: each must name an aggregate whose gate this census proves applied on every declared backend. Found and handed off: .NET document finds (EF + Dapper) do not honour `ignoring` (fail-closed) while `FILTER_BYPASS_FAMILIES` certifies they do; the audit-history 403 detail diverges (M-T9.25). **Residue:** mask closure over the paths the census does not walk — event payloads crossing a channel, log fields, OpenAPI examples, error bodies (the projection-row paths are refused by `loom.field-mask-projection-source`); the WRITE-side tenant stamp on create (the #2696 class) is not censused; `examples/` (fixed platforms) are outside the population. No runtime leg is demoted by this.

Minted 2026-08-31 by the [verification-architecture audit](../audits/verification-architecture-2026-08-31.md) §4 C3.

The three cross-cutting properties whose violation is the worst failure mode in the codebase — a read that escapes its tenant filter, a route that escapes its `denyByDefault` gate, a `mask unless` field that reaches a wire — are all verified the same way today: per backend, at runtime, on a handful of fixtures (`test:tenancy-*` is ten npm legs; `authz-status-census` and `wire-no-leak-parity` are per-target). Coverage is therefore anecdotal by construction, and the gate ledger says so directly: `tenancy-hierarchy` and `policy-document` sit at the COMPILE tier in the corpus, and `projection-agg-filters` exists only because an audit found a cross-tenant COUNT/SUM leak that no fixture crossed.

**The original framing of this mission said those properties are decidable on the IR. A measurement says they are not — not the half that breaks.** A probe over the corpus and examples found **17 tenancy-relevant aggregates and zero gaps**: every `tenantOwned` aggregate carries a `tenantOwned`-origin entry in `contextFilters`, every registry carries the `tenancy` self-scope entry, and there are no `ignoring` bypasses at all. That result is close to tautological, and that is the finding: the check restates the enrichment that derives the filter. Deriving it is not where tenancy breaks.

**Where it breaks is emission.** Each backend reads `agg.contextFilters` and applies them in its own read paths (`typescript/repository-find-predicate.ts`, `python/find-predicate.ts`, and one more per backend). The IR hands over a filter; whether a given read site ANDs it in is per-backend code. That is exactly where the leak `projection-agg-filters` was minted for lived — the aggregation shapes read the source table DIRECTLY, so four backends applied only the projection's own `where` and produced a cross-tenant COUNT/SUM. No IR walk could have seen it: the IR was correct.

**So the altitude is wrong, and the re-scope is to emitted code.** The proof this mission should build is a census over EMITTED SOURCE, per backend: enumerate every read site the generator produced for an aggregate carrying a capability filter — repository finds, by-id loads, bulk loads, document reads, projection folds, query-time projection arms, aggregations — and assert each one carries the predicate. That is cheaper than a runtime leg, exhaustive where a fixture-driven runtime test is anecdotal, and — unlike an IR walk — it is pointed at the layer that actually diverges. `query-projection-arm.ts` already knows the shape of "which filters apply to this arm"; the census asserts the emitter used it.

The same argument applies to `denyByDefault` route gating and `mask unless` closure: the IR can prove the gate/mask was DERIVED, and only emitted code can show it was APPLIED. Scope each the same way, and do not promise that any of them demotes a runtime leg until the emitted-code census exists and is mutation-proved against a re-seeded historical leak.

**The work.** Three IR-level proofs over M-T9.40's enumeration: (a) scope-filter totality for reads and writes, with `crossTenant`/`ignoring` as the only exits and each exit named; (b) route-gate totality under `enforcement: denyByDefault`, with `open` as the only exit; (c) mask closure — enumerate EVERY path that can serialize a masked field (wire DTO, event payload, projection row, audit record, log field, OpenAPI example, error body) and require each masked or explicitly exempted. (c) is the one that pays for itself immediately: leaks live in the paths nobody thought to test, and an exhaustive walk is the only thing that visits them.

Does NOT depend on M-T9.40's enumeration the way the original framing assumed — an emitted-source census walks generated text, not the IR. What it does inherit from M-T9.40 is the method: measure what the check would find before building it, because the first version of this row promised to replace ten runtime legs with a walk that would have restated a derivation.

**Verification when it lands.** Unchanged, and now load-bearing rather than aspirational: mutation-proved against a real historical leak — re-seed the EF `ignoring *` deny-sentinel drop (#2668 wave 1) and the aggregation-source filter drop (`projection-agg-filters`' minting defect) and watch the census name them. Both are EMISSION defects, which is the direct evidence that the census has to read emitted code. A proof that cannot re-find the leak that motivated it has not been shown to work — and an IR-level version demonstrably cannot, because the IR was correct in both cases.

Sources: [verification-architecture-2026-08-31](../audits/verification-architecture-2026-08-31.md) §4 C3. Relates to M-T9.9 (sentinel `ExprIR` → typed nodes, done — the prerequisite that made these sentinels inspectable), M-T9.28 (the authorization-surface census this generalises).

## M-T9.42 — Promote the duplicated per-target scenarios into the corpus, then delete them — `partial` (20 of 42 landed: `temporal` + 19 in wave C3 3d) · **L** · P2 ⭐ the only route that shrinks the suite without losing a claim

Minted 2026-08-31 by the [verification-architecture audit](../audits/verification-architecture-2026-08-31.md) §1, §5.

The suite is 302,948 LOC across 1,825 files — 0.91× `src/` — and **879 files / 126,741 LOC assert only by substring on emitted text**, the tier [quality-audit-2026-08](../audits/quality-audit-2026-08.md) §3 measures as discovering ~0% of bugs. 42 scenarios are duplicated across three or more target directories (199 files, 35,700 LOC): the same `.ddd` written five times, each copy asserting that one emitter wrote particular tokens.

The naive conclusion — delete them — is wrong, and the gate ledger (`test/_helpers/gate-ledger.ts`) is what shows it: **only 3 of the 42 have a corpus fixture.** For the other 39 (33,639 LOC) the string tests are the only gate those cells have. So the unit of work is promotion, not deletion: one `.ddd` plus one manifest row buys five compile cells; a behavioural block plus a golden buys five runtime cells; then the five copies go. `temporal` is the canonical case — 813 LOC across five near-identical fixtures, replaced by ~60 LOC whose cells assert that five backends compile and answer rather than that five emitters wrote a token.

**The rule the drain runs under** (audit §2): keep exactly one gate per (feature × target) cell, at the strongest tier available. A string assertion survives only when it is the strongest gate for its cell, or when it pins something no stronger tier can observe — import hygiene, a negative no-leak, a name that never reaches the wire. No deletion without citing the cell and the stronger gate now watching it; `gate-ledger.test.ts`'s `BEHAVIOURAL_ABSENT` names the 14 features where nothing runtime watches, and those keep their string tests until B3 reaches them.

Ranked by copies × LOC, the promotion candidates are `generator` (5,236/×5), `render-expr-kinds` (3,203/×4 — and this one wants M-T9.43's shape, an evaluated value table rather than a rendered-string table), `i18n-runtime` (2,136/×7), `explicit-handlers` (1,885/×5), `projection-read` (1,522/×7), `store` (1,444/×7).

**Verification when it lands.** Per promoted scenario, in its own PR: the new corpus cells green at the tier claimed, and the deleted copies' claims accounted for — anything the string test asserted that the new tier does NOT cover stays, named, rather than being dropped silently. The failure mode to guard is a promotion that trades a specific claim for a general one and calls it a win.

**Landed — `temporal` (the canonical case, and the proof the drain is worth running).** 813 LOC across five near-identical per-backend fixtures became one `test/fixtures/corpus/temporal.ddd` (`backends: ALL`) plus one retained gate, `test/ir/temporal-queryable-gate.test.ts`. The e2e drives six arms — column-side interval, value-side interval, the same predicate through a reified criterion, `dt − dt` against composed units, duration × int, `datetime − duration`, and the commuted `duration + datetime` — with every asserted value chosen so a wrong unit FLIPS it, and none of them depending on the datetime wire format.

It found a real bug on its first run, and the shape of that bug is the whole argument for the drain: `find w(q: datetime) where this.dueDate < q + days(2)` 500s at run time on node and elixir, because the bound datetime reaches Postgres as an untyped `$n` and `unknown + interval` resolves it to `interval`, leaving `timestamptz < interval`. **The deleted node test asserted that exact broken spelling, character for character, and passed** — `expect(repo).toContain("lt(schema.invoices.dueDate, sql\`${q} + make_interval(days => ${2})\`)")`. A test that pins what an emitter wrote cannot tell you whether what it wrote runs. Fixed by casting the bound side (`::timestamptz`) on both backends; the column side and any nested interval fragment are deliberately left uncast.

**And it found a SECOND, unrelated bug — one no amount of reading would have produced.** With the value-side cast in place on elixir, a real Phoenix boot still 500'd, and on the COLUMN side, which had nothing wrong with its SQL: `DBConnection.EncodeError: Postgrex expected %DateTime{} or %NaiveDateTime{}, got "2026-01-15T00:00:00Z"`. Phoenix delivers every query param as a string, and `findParamCoercion` in `src/generator/elixir/vanilla/find-controller.ts` coerces `int`, `decimal` and `bool` — but never `datetime`, so a `datetime`-typed find param was pinned into the Ecto query as a raw binary. That file's own comment records the same bug being found for `int` on 2026-08-05 by the caller-census drain; `datetime` was simply the member of the family nothing had ever driven. Fixed with a `__find_datetime/1` clause emitted on the same needed-only basis as its siblings. This is exactly the trap [`docs/tools.md`](../tools.md) warns about ("elixir *by reasoning* for weeks, and the first real elixir boot found four divergences") — the local elixir toolchain recipe there is what turned a prediction into a diagnosis.

Both elixir fixes are mutation-proved against a real boot: reverting the `::timestamptz` cast 500s on `due_before`, reverting the param coercion 500s on `overdue_by`. The elixir run also **matches the node-captured wire golden byte for byte**, so the two backends are cross-verified on all six arms rather than each merely self-consistent.

**A third gate caught a gap in the promotion itself**, which is the drain working as designed: `api-caller-census` flagged that the new fixture derives `all`/`update`/`destroy` from `crudish` and drove none of them. Those are drained classes in `api-caller-census-pins.ts` (its own prose says a re-pinned drained class is as loud as an un-drained one), so they are DRIVEN, appended after every temporal assertion so the bracketed counts still read against a stable two-row table. Only `dueWithin` is pinned, under a new reason `R.clockDependentFind`: its predicate reads `now()`, so a recorded response body would be green only on the run that captured it. Draining that needs a freezable harness clock, not a caller.

Claims accounted for rather than dropped: the phase-⑦ rejection gate is KEPT (deduplicated from the two identical TS/.NET copies) because a behavioural test cannot observe a program the compiler refuses — and it gained the control case the originals lacked, so a gate that rejected everything would now fail it. .NET's `not.toContain("TimeSpan.From")` is an EF-translatability claim that EF Core now enforces by throwing on an untranslatable `Where`, so the .NET behavioural leg makes it. Python's `not.toContain("python-dateutil")` is a dependency-manifest claim, not a temporal one, and its failure mode is a deliberate act rather than a regression.

Net: **−813 +1 fixture (171) +1 test (55) = −587 LOC**, three real bugs fixed across two backends, and 5 runtime cells where there were 5 string cells.

**Then the two ALTERNATE-PERSISTENCE adapters failed, and that is the sharpest result in the whole slice.** MikroORM and Dapper both 500'd on the new fixture. Neither was a regression: their find emitters had never had a temporal arm, so every `datetime ± duration` predicate emitted a runtime-throwing stub — while `find-predicate-capability.ts` DECLARED both shapes lowerable (`walkValue` returns null for any value-position expression, and `DAPPER_SUBSET = FULL_SUBSET`, "narrows nothing versus the EF Core / drizzle baseline"). A descriptor promising a lowering the emitter does not have is a SILENT gap: no `loom.*` refusal, a clean compile, and a 500 on the first call. It had gone unnoticed because nothing had ever called such a route on those adapters.

Dapper's own source states the precedent for exactly this situation, from the last time it happened (M-T3.6, the missing intrinsic arm): *"The fix is the table, not a narrowing of the descriptor: every one of these IS expressible in Postgres SQL."* So both were implemented rather than registered as skips — the interval is ordinary Postgres text, and both adapters already had the hatch for it (Dapper writes SQL directly; MikroORM has the `raw()` `RawQueryFragment` the deep-scope sentinel uses). The four SQL emitters that write this interval had four copies of the same three-row `make_interval` table, so it now lives once in `src/generator/_expr/pg-interval.ts`, beside `pg-intrinsics.ts` — the same seam, for the same reason.

MikroORM then reproduced the value-side bind bug independently, and took the same targeted cast. Seven runtimes now answer this fixture identically.

**Verified on all five backends by a real boot, not by reasoning** — node on PGlite, and elixir / python / dotnet / java each against a live Postgres, all five matching ONE wire golden byte for byte. That mattered: both bugs are node-and-elixir only, so a promotion checked on whichever backends happened to be running would have reported a five-way claim it had half-verified. The other three were genuinely correct rather than merely unexercised, and booting them is the only thing that tells those two states apart. Toolchain recipes are in [`docs/tools.md`](../tools.md) — elixir's already existed; java (JDK 25 + Gradle 9.1) and dotnet (SDK 10, since the emitted TFM is `net10.0`) are host installs, and the shared-`app`-database collision between those two legs is now documented there beside the port one.

**Slice 2 (in progress) — `explicit-handlers`, and a cheaper promotion shape than slice 1.** 1,885 LOC across five backend copies (hono/dotnet/java/python/elixir). Unlike `temporal` this feature ALREADY has three corpus fixtures — `handler-triad`, `extern-handlers`, `handler-resource-ops` — so the naive read is that the cells are covered and the string tests are redundant.

They are not. All three fixtures carry **zero `test e2e` blocks**: they generate and compile on five backends and nothing ever calls the routes they declare. Every runtime claim in the 1,885 lines — that the router mounts under the api base, that a returned aggregate goes through `toWire`, that an extern scaffold stub throws loudly, that a VO body param resolves, that repo-delete actually deletes — is asserted only as emitted text, on one backend each.

**Blocked, and the block is the finding.** The behavioural tier cannot address an explicit `route … -> <Handler>` route at all: `matchApiCall` admits only `api.<slug>.<method>(…)` with the slug resolving against the aggregate / projection / workflow sets, and a handler route is api-level. That is *why* the three fixtures have no `test e2e` blocks — not an oversight. Tracked as its own capability gap (#2793); the promotion resumes once it lands.

The investigation produced one shippable gate (#2792): the one-level `api.<name>(…)` spelling — the natural thing to reach for — validated with **0 errors** and was then emitted against a bare `api` identifier nothing binds, or, when the handler name collided with a collection intrinsic, silently **miscompiled** (`api.sum({a,b})` → a `.reduce(…)` fold). It is now refused with `loom.e2e-unaddressable-call`.

So the unit of work here is not a new fixture but a **runtime driver for fixtures that already exist**: add the `test e2e` blocks, capture the golden, and the compile-tier cells become behavioural ones. That is the cheaper half of the mission's own recipe ("a behavioural block plus a golden buys five runtime cells") and it should generalise — the `BEHAVIOURAL_ABSENT` register names the other features sitting at compile tier with a fixture already in the corpus.

Deliberately NOT taking the largest candidate first. `generator` (5,236 LOC ×5) is bigger, and #2766 independently measured `generator-dotnet.test.ts` as this mission's largest single target — but that PR now holds an exact-count ratchet over it (dotnet: 39 files / 150 call sites), so deleting tests there would break its gate and conflict. It waits until #2766 lands.

**Wave C3 3d (2026-09-28) — 20 of 42.** Nineteen more scenarios promoted, each a fixture (three new: `stamps-principal`, `intrinsics`, `wire-ingress`; the rest extensions of existing ones) with a value-asserting `test e2e` block and a node-minted golden verified on all seven legs, then its string copies deleted — ~234 `it` blocks and 4 files, `test/generator` −3,403 / +1,099 LOC (the plus is mostly M-T9.43's harness). Promoted: audit-history, provenance, projection-groupby, field-mask, seed, stamping, render-expr-kinds (via M-T9.43), lifecycle-audit, intrinsic-trim, the `generator-dotnet` batch (66 → 58 pinned sites), message-clause, projection, workflow-instances, query-projection-join-missing, workflow-own-state-assign, saga-starter-guard, tenancy-registry-self-scope, wire-numeric-ingress, document-capability-filter (its non-principal arm; the principal arm needs authz-census probes, handed to 3c). Every promotion is mutation-proved on node; every kept string claim is named with its reason. **Promoting found 25 defects (D1–D25), all handed off with repros** — among them .NET/Dapper accepting a money `"12,50"` as 1250, node 500ing on a reloaded saga money compound (the hono string test pins that exact broken spelling), `unique(...)` unenforced on Dapper and MikroORM, and MikroORM 500ing every `transactional` workflow. The audit's list of 42 was never committed; recomputed by the same rule it is 71 names on this base, and the hand-off note gives a reason for every unpromoted one (frontend-only, harness capability, a D-defect, or owned elsewhere). `explicit-handlers` still waits on #3024. Details: [wave-c3-3d-promote.md](waves/handoffs/wave-c3-3d-promote.md).

Sources: [verification-architecture-2026-08-31](../audits/verification-architecture-2026-08-31.md) §1, §2, §5. Relates to M-T9.13 (the behavioural matrix that unblocks the compile-only cells), M-T9.29 (the driven-primitive census — the same "emitted but never exercised" question from the other side).

## M-T9.46 — Ten per-feature docs contradict the code — `open` · **M** · P3 ⚠ verify-first, docs-only, route to `status-refresh`

Found 2026-09-03 by the language-docs audit (F37–F46, P4) — outside that audit's own scope (it covered the language surface docs), found in passing and each verified. `docs/capabilities.md` lists four built-ins with no `tenantRegistry`, presents `versioned` as opt-in where the expander applies it by default, and names three removed per-backend codes; `docs/inheritance.md` claims Java and .NET emit a polymorphic base reader (neither does), says the base emits no Ecto schema (under TPH it does), and uses the legacy `phoenix` platform literal; `docs/auth.md` carries pre-#2717 prose ("fails closed on four of five backends"), a `curl` example sending raw JSON where every stub base64-decodes, and a named-policy example putting `permissions { … }` in a `context` (a proven parse error — the block is a `Subdomain` member); `docs/tenancy.md` writes `crossTenant aggregate Plan` as a prefix (proven parse error — the grammar puts it in the header region after the name); `docs/actions.md` calls `loom.missing-effect-marker` a warning where the check raises `severity: "error"` (`ui-checks.ts:2320`); `docs/observability.md:20` claims the emitted `level` is `"warn"` on every backend where the Elixir `LogFormatter` stringifies `:warning` (`elixir/shell/runtime.ts:136`); `docs/resources.md` names `loom.resource-unknown-verb` where the catalog ships `loom.resource-verb-invalid`; `docs/macro-api.md` gives the wrong stdlib path shape and omits the `api` target and `apiVersion`; `docs/scaffold-macros.md` has no `scaffoldHandlers`/`scaffoldApi`/`scaffoldPaged`/`scaffoldPagedApi` sections though chapter 22 cross-links it as authoritative; and `CLAUDE.md` says "~55 primitives" where `WALKER_LAYOUT_PRIMITIVES` holds 56.

**The fix:** strictly docs-only, per the `status-refresh` boundary — every claim re-derived from code, as in the audit that found them. If a doc is right and the code is wrong, that is a different mission; flag it rather than editing an emitter.

**Verification when it lands.** Each corrected claim cites the file:line it was re-derived from; the two proven parse errors are re-run as parses, not read.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F37–F46, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W7.1** (`route: status-refresh`, `docsOnly: true`). No dependency on any other packet.

## M-T9.47 — Headings render without `id`s, so every in-page anchor in every chapter is dead on the published site — `partial` (the slugger landed; duplicate slugs + the rendered-id assertion remain — re-statused 2026-09-29, wave L0) · **S** · P3

Found 2026-09-03 by the language-docs audit ([F47](../audits/2026-09-03-language-docs-audit-findings.md), P4). `docs/build.mjs` runs `marked` with no heading-id slugger, so emitted `<h2>`s carry no `id` and **every** `](#…)` link in every rendered chapter is dead on the Pages build. They work on GitHub's renderer, which is why nobody noticed — and the language-docs audit just added a great many cross-links, which makes the fix worth more than it was last week.

**The fix:** one `marked` slugger extension in `docs/build.mjs`, with the anchor text matching GitHub's slug rules so existing links keep resolving in both renderers.

**Verification when it lands.** `node docs/build.mjs` exits 0 and a rendered chapter's in-page links resolve against the ids actually emitted — assert the ids, not just that the build ran; mutation-proved by removing the extension.

**Status 2026-09-29 (wave L0) — the core LANDED.** `docs/build.mjs:65` defines `headingSlug` (GitHub's rule: lowercase, keep letters/digits/space/`-`/`_`, space → `-`) and the `marked` heading renderer at `:69-75` emits `<h{n} id="…">`; `src/diagnostics/code-docs.ts` carries the same rule and `test/system/diagnostic-docs-anchors.test.ts` checks its entries against the markdown headings. **Remaining:** (1) **duplicate slugs** — GitHub suffixes a repeated heading `-1`, `-2`; the renderer emits the bare slug twice, so a link to the second occurrence resolves on GitHub and lands on the first on Pages; (2) the verification the mission asked for — an assertion over the RENDERED ids (build a chapter, resolve its `](#…)` links against the emitted `id`s), mutation-proved by removing the renderer.

Sources: [language-docs-audit-2026-09-03](../audits/2026-09-03-language-docs-audit-findings.md) F47, [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md) packet **W7.2**. Touches the same file as the archived-docs fence (`test/system/archived-docs-fence.test.ts` imports `docs/build.mjs`) — keep that gate green.


## M-T9.51 — `sales-ui.ddd` is a design document with a `.ddd` extension: repair it or move it — `open` · **S** · P2 ⚠ verify-first

Minted 2026-09-07 from [verification-waves-2026-09](verification-waves-2026-09.md)'s hand-off list; the non-parsing file is already fenced by a two-way ratcheting `NON_PARSING_SOURCES`, so this row is the *drain plus the missing gate*, not the discovery.

**The gate half has landed.** `test/system/ddd-source-census.test.ts` sweeps **every** tracked `.ddd` (`git ls-files '*.ddd'`, 405 files) for zero `parserErrors`, and every self-contained one for zero AST-validation errors, in the fast suite. It subsumes the "widen `generated-react-build.yml` from `examples/acme.ddd` to `examples/**`" step this row originally asked for, and does it over the whole repo rather than one directory. Its `UNPARSEABLE` pin ratchets — the file's repair deletes the pin in the same PR — and re-verified 2026-09-14: seeding a syntax error into `examples/acme.ddd` fails the sweep by name, and replacing `sales-ui.ddd` with a parseable file fails the stale-pin check.

**One diagnosis in the original row is wrong, and it matters for the remedy.** `sales-ui.ddd` is not "stale against a grammar that moved under it". It fails *identically* at `880eb73c0` and *worse* at the oldest commit in the shallow history — it has never parsed, in any tree available. The trigger is `Stat { api Sales.Order.all }`: `api <Api>.<op>` was proposed page-metamodel syntax and never became a grammar rule, exactly as the file's own first paragraph says ("This file does NOT parse with the current Langium grammar; it is the target syntax driving the discussion. It is a HISTORICAL prototype"). So this is not a repair against drift; it is a decision about a design document.

**The fork, which is user-owned.** `Dashboard(items: [...])` and `MasterDetail` are **out of scope by prior decision and by maintainer steer** ([T1-ui-frontend](T1-ui-frontend.md) §134, [M-T1.3](missions/M-T1.3-charts-and-dashboards-scope.md)), and M-T1.3 cites this file as the prior art for that decision. "Repair it against the current grammar" therefore means *deleting the record of a design that was deliberately rejected*, which is a worse outcome than the pin. The three live options: **(a)** leave it pinned — both READMEs already label it "does not parse", so no reader is misled; **(b)** move it out of `examples/` into the frozen design record (`docs/old/proposals/`) with the extension changed, which empties both waivers and makes "everything in `examples/` parses" true by construction; **(c)** rewrite it in shipping syntax, losing the prior art M-T1.3 points at. (b) is the recommendation.

**A second, quieter instance in the same class:** `web/src/examples/auth-capabilities.ddd` carries two `requires` gates and no runner boots it — so the example that demonstrates the authorization surface is the one nothing executes. This half is untouched by the census (the file parses and validates; it is *execution* that is missing) and is the part of this row still worth draining.

**Verification when it lands.** If (b) or (c): both `UNPARSEABLE` (`test/system/ddd-source-census.test.ts`) and `NON_PARSING_SOURCES` (`test/ir/authz-gate-census-pins.ts`) empty in the same PR, and their stale-pin ratchets prove it. For the `auth-capabilities.ddd` half, the failure shape to avoid is a glob that matches and a runner that silently continues — `experience_gathered.md` §59 verbatim.

Sources: [verification-waves-2026-09](verification-waves-2026-09.md), "Findings handed off, not fixed here". Relates to M-T9.3 (corpus/example coverage) and M-T9.8 (a fixture nothing executes is hollow).


## M-T9.54 — Module-global mutable state was a convention with no gate — `partial` (the census and the gate landed; the drains it names are open) · **S** · P1 ⭐

Minted 2026-09-07, from the isolation leak [#2766](https://github.com/Loom-Harness/Loc/pull/2766) found and fixed one instance of. That fix was per-instance; this row is the class.

**Why the class is worth a gate.** The unit project runs `isolate: false` — one module graph per worker, deliberately, because it takes the full suite from >10 min to ~6. The price is that every module-level binding is shared by every test file the worker happens to run, so a module global that one file mutates and does not restore is a coin-flip for every later file in that worker. The observed instance: three assertions in `test/util/source-types.test.ts` about a `clickhouseCloud` sourceType it never declares, written into the shared registry by `test/platform/source-type-plugins.test.ts`, which deleted its temp *directory* but not its registry *entry*. Both files predated the change that exposed it — all that moved was the file set, and with it the worker assignment. It was found by a full run going red, which is the expensive way to find this.

**The census: 20 entries over 864 files** (`test/system/module-global-state-census.test.ts`) — 13 module-scope `let`, 7 mutated module-scope containers. Each carries one of six disciplines: `scoped-restore` (try/finally), `per-run-reset`, `build-once-cache`, `keyed-cache` (WeakMap keyed by an owner), `wiring-injection`, `test-reset-hook`. A new module global fails as UNPINNED; a pinned one that no longer exists fails as STALE.

**The scan is AST-based, and that is load-bearing, not fastidiousness.** A regex census reports eight false positives that all look convincing — `nextId` in `svelte/emit-templates.ts`, four `let`s in `hono/v4/auth-emit.ts`, `subscribers`/`rooms` in `realtime-builder.ts` — every one of them inside a TEMPLATE LITERAL. They are module-global in the *emitted* project and irrelevant to the toolchain's own workers. Walking `sourceFile.statements` excludes them by construction.

**The one genuine trap the census found**, and it is a convention rather than a mechanism: `_resetRegistryForTests()` empties the macro registry but does NOT bring the stdlib back, because `loadStdlibMacros()` latches on a module-level `_loaded`. Its doc comment claimed the opposite — *"Stdlib re-registers itself on next import"* — which is exactly how a caller walks into it: an empty registry plus a latched flag, for every later file in the worker. The comment now says what actually happens and names both recoveries. The two hooks are NOT fused, because `stdlib/index.ts` imports `registerMacro` from `registry.ts` and reaching back would close an import cycle; what stops the trap instead is that both halves are pinned and the gate asserts the pairing.

**Verification (done).** Four seeded defects, four distinct failures, each reverted by file copy and diffed byte-identical (never `git checkout --`, per `experience_gathered.md` §84): a new module-scope `let` fails UNPINNED; renaming a pinned binding fails STALE; renaming an exported reset hook fails the hook-existence arm; reinstating the old false doc comment fails the coupling arm. The hook-existence arm is what keeps the table from decaying into prose — without it a renamed hook leaves a `test-reset-hook` claim that nothing checks.

**The residue, none of it blocking:**
- ~~The census proves each entry *has* a discipline; it does not prove every *caller* honours it.~~ **Closed** by the caller-side gate (`test/system/module-global-caller-discipline.test.ts`): every call to a mutator of a pinned global must dispose of what it wrote, via a paired restorer in a teardown, a snapshot-replay, or a stated `additive-permanent` waiver. It found one real unrestored write — `test/util/source-types.test.ts` registered `__test_objstore` permanently, in the very file that was the *victim* of the `clickhouseCloud` leak — benign only because that descriptor declares an `objectStore` surface and nothing else. Building the gate also corrected a modelling error worth recording: `_resetRegistryForTests` is NOT `registerMacro`'s restorer, it is a second mutator, and treating it as one would have let a file empty the shared registry on its way out and count that as disposal. `registerMacro` is now modelled as having no undo at all, so every one of its sites must name a real shape.
- `src/language/generated/` is excluded as committed `langium generate` output. If generated code ever grows module state that tests mutate, this census will not see it.
- The scan covers `src/` only. `test/_helpers/` has its own module state and is not yet censused.

Sources: [verification-waves-2026-09](verification-waves-2026-09.md) — the isolation-leak section. Relates to M-T9.8 (hollow work: a test asserting against leaked state is green for the wrong reason), M-T9.50 (the `test/` typecheck baseline, the other shrink-only census).

*Wave L2-HYG (leftover-waves-2026-09-28), item **G15**: the census does not scan `test/_helpers/` (#2800) — that is this mission's residue too.*

## M-T9.59 — The `*-unsupported` register cannot see a target gap that wears another suffix — `open` · **M** · P1 ⭐ the entry hole

Found 2026-09-10 by the [independent completeness audit](../audits/2026-09-10-independent-completeness-audit.md) (F2).
This is [M-T9.27](#m-t927)'s slice 4, re-aimed: the problem is not that rows are undrained,
it is that rows are **missing**, and the reason they are missing is structural.

**The contradiction.** `src/diagnostics/unsupported-register.ts` opens by arguing — correctly
— that *"NO NAMING CONVENTION separates these"*, and therefore writes `kind` down per row as a
reviewed field. But **membership** in the register is still decided by the code's suffix. So a
per-target refusal wearing any other suffix is invisible to the one list that exists to drain
per-target refusals. Two measured instances:

* `loom.dotnet-name-collision` — a portability break ([M-T6.69](T6-backend-parity.md#m-t669)).
  Grepping the register and every track file for the code returns nothing.
* `loom.user-component-deferred-target` — Angular and Feliz refuse a user component declaring
  `slot`/`action` params. Pinned as a gap in `test/conformance/frontend-showcase-render.test.ts`,
  and a **seventh** row on exactly the axis [M-T1.20](T1-ui-frontend.md#m-t120) enumerates as
  "the five rejections outside the pack matrix" (which lists six, not this).

**The fix, in three slices.**
1. **Classify once.** All 493 `loom.*` codes into `target-refusal` / `misuse` / `impossible` /
   `no-effect`. 23 codes name a specific target in their catalog message and sit outside the
   register today; most of those 23 are genuine misuse errors, which is precisely why the
   classification must be reviewed and written down rather than derived.
2. **Admit every `target-refusal`**, suffix irrelevant, starting with the two above.
3. **Close the entry hole, not the exit one.** Extend `test/system/unsupported-register.test.ts`
   so a code whose message names a single target and carries no row **fails**. Today the gate
   only checks that existing rows cite a live mission id — it cannot notice an absent row.

**Verification.** Mutation-prove both directions: add a new single-target refusal code with no
row → the gate fails; delete `loom.dotnet-name-collision`'s row after M-T6.69 lands → the gate
passes (the code is gone), while deleting a row whose code still exists → fails as missing.
Revert by file copy, never `git checkout --` (`experience_gathered.md` §84).

Relates to [M-T9.56](archive/T9-done.md#m-t956) (the other "the code identity is not carrying its weight" row)
and [M-T9.27](#m-t927), whose partial status this supersedes for slice 4.

## M-T9.61 — Nothing says a dependency bump is due, on either surface — `open` · **S** · P2

Found 2026-09-10 by the [independent completeness audit](../audits/2026-09-10-independent-completeness-audit.md) (F5).
The repo has a `dependency-upgrade` skill that knows *how* to land a bump across both surfaces.
Nothing knows *when* one is due.

**Measured.** `npm audit` → **11 advisories, 4 high** (`fast-uri`, `ip-address`, `nanoid`,
`postcss`) — all transitive dev-tree, so no user is exposed today. No `dependabot.yml`, no
Renovate config, and no `npm audit` / OSV / Trivy / CodeQL step in any of the 67 workflows. On
the generated-app surface the hand-maintained pins have drifted apart: `stacks/v1` still emits
**React 18.3 + zod 3.23** where `stacks/v3` emits React 19.2 + zod 4, and four shipping design
packs — `chakra/v2`, `mantine/v7`, `mui/v5`, `shadcn/v3` — resolve to `v1`, so choosing one of
them silently produces a two-major-old React app.

**Two halves, one per surface.** *Toolchain:* a Dependabot (or Renovate) config plus
`npm audit --audit-level=high` as a failing step, with an explicit, **expiry-dated** waiver file
for accepted dev-tree advisories (an undated waiver is the stale-row failure this repo already
ratchets against). *Generated apps:* a freshness ratchet over `stacks/*/stack.json` and the
backend-package pins that fails when a pinned major falls more than one behind latest — which
would fire immediately on `stacks/v1` and name the four packs still on it.

Relates to [M-T9.5](#m-t95) (version-axis consolidation — the React `stacks/` fork this would
put a clock on) and to the `dependency-upgrade` skill, which this feeds.

## M-T9.62 — Every census gate asserts its own denominator — `open` · **S** to build, **M** to apply · P1 ⭐

Found 2026-09-10 by the [independent completeness audit](../audits/2026-09-10-independent-completeness-audit.md) (F7).
The generalization of [M-T9.55](archive/T9-done.md#m-t955): fix the instance there, build the class here.

**The shape.** The repo has ~40 census / ratchet gates. Each computes a file set, a call-site
set or a code set, then asserts something about it. The **numerator** is asserted everywhere;
the **denominator** almost nowhere. So a pattern that silently stops matching turns the gate
green rather than red — `experience_gathered.md` §59 and §63 verbatim, and the exact mechanism
of M-T9.55 (a `git ls-files 'src/generator/<t>/**/*.ts'` pathspec reaching 28 files where the
two-entry form reaches 96, because git's default wildmatch runs without `WM_PATHNAME`, so
`**/` still requires a following `/`).

**The fix.** One assertion per gate: *this scan reached N files (or call sites, or codes), and
N is pinned here.* A shrunken denominator then fails as a shrunken denominator. Apply it to the
existing gates, taking the `git ls-files` pathspec users first — `inline-ddd-source-census` and
`ddd-source-census` are fine today, but by luck of pattern rather than by construction.

**Verification.** Per gate, narrow its pattern by one directory and confirm the gate fails.
Reverting by file copy is load-bearing here: several of these gates live in files that carry
other pinned tables.

Relates to [M-T9.55](archive/T9-done.md#m-t955) (the instance), [M-T9.8](#m-t98) (which finds this class by hand)
and [M-T9.40](#m-t940) (the same "the instrument was never wired to anything" shape on the
generator entry points).

*Wave L2-CI (leftover-waves-2026-09-28), item **G5**.*

## M-T9.63 — A per-target corpus floor — `open` · **S** · P2

Found 2026-09-10 by the [independent completeness audit](../audits/2026-09-10-independent-completeness-audit.md) (F9).
Declarations across all 280 repo `.ddd` files:

| target | node | elixir | dotnet | java | python | react | svelte | vue | flutter | feliz | angular |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| count | 93 | 87 | 50 | 42 | 35 | 34 | 9 | 6 | 3 | 2 | 2 |

Backends sit within 2.7× of each other. Frontends span **17×** — and the two thinnest after
Angular are Feliz and Flutter, the two self-hosting frontends that
[M-T1.20](T1-ui-frontend.md#m-t120) itself identifies as carrying most of the remaining risk
*because* the per-pack build matrices structurally cannot see them.

**The gate.** Assert a minimum declaration count per target and fail below it. Set the floor at
today's value for the healthy targets and **one above** today's for Feliz, Flutter and Angular,
so the ratchet forces the gap closed rather than freezing it in place.

Pairs with [M-T9.42](#m-t942) (which supplies the fixtures) and
[M-T9.38](archive/T9-done.md#m-t938) (which supplies the Feliz/Flutter runtime leg those fixtures would exercise —
a corpus fixture on a target with no runtime leg only buys a compile).

*Wave L2-CI (leftover-waves-2026-09-28), item **G5**.*

## M-T9.64 — The deep fuzz tier is built, red, and runs nowhere — `open` · **M** · P1

Found 2026-09-10 by the [independent completeness audit](../audits/2026-09-10-independent-completeness-audit.md) (F3).

*Half-corrected while this row was in flight.* The audit found **[M-T9.22](#m-t922) mis-statused** —
it read `open` ("no code yet") though the deep leg, the model generator and the shrinker all exist. It
was re-statused to `partial` on `main` on 2026-09-11, independently, so that half is closed and this
row no longer asks for it. **The three findings below are unaffected and were re-measured on `main` @
`d6192914`.**

Measured: `LOOM_FUZZ_DEEP=1 LOOM_FUZZ_DEEP_N=400 npm run test:fuzz-deep` → **3 failures**
(seeds 45, 70, 115), each shipping a shrunk 20-line corpus-ready `.ddd` and a replay seed. The
harness works. Three things around it do not.

1. **It is red on `main`.** All three seeds reduce to
   [M-T6.69](T6-backend-parity.md#m-t669), so that mission closes them; re-run at 400 and pin
   the seed count.
2. **No workflow runs it.** `grep -rln fuzz .github/workflows/` matches `schemathesis.yml`,
   `pr-gate.yml` and `ci-red-alarm.yml` — all three only as references to the *Schemathesis* job.
   Nothing invokes `npm run test:fuzz-deep`. The one tier that explores the *input space* rather
   than a fixture list is unwired. Add a nightly leg, register it in `ci-red-alarm.yml`, and put
   the seed in the failure output.
3. **Its triage sends the author to the wrong file.** The failure reads *"the GENERATOR emitted
   an invalid model. Fix `test/_helpers/ddd-model-generator.ts`"* — so a model that ONE backend
   refuses and four accept is reported as a fuzzer bug. Add a rung to the tier ladder: a
   diagnostic raised by a single-target gate on a model the other targets accept is a **backend**
   finding, and the report should name the backend, not the generator.

**Verification.** Seed the ladder with a model that only one backend refuses and confirm it is
attributed to that backend; seed one that every backend refuses and confirm it is still
attributed to the generator. A green first run proves neither.

Relates to [M-T9.8](#m-t98) (same "valid input, wrong output" class, found generatively) and
[M-T9.42](#m-t942) (the shrunk models graduate into the corpus).

*Wave L2-CI (leftover-waves-2026-09-28), item **G4**.*

## M-T9.65 — A `money` literal in a `test e2e … against <ui>` body is emitted as a JS NUMBER, losing the scale the api renderer keeps — `open` · **S** · P3

Found 2026-09-13 while landing [M-T9.38](archive/T9-done.md#m-t938)'s numeric round-trip (PR #2898), by
reading the emitted spec the new Feliz assertion drives.

`renderLiteral` in `src/system/ui-e2e-render.ts:511-516` handles `string`, `now` and `null`
and returns `value` verbatim for everything else — so a `money` literal falls through to a
**bare JS number**:

```
// .ddd (a ui e2e body)
let prod = ui.products.create({ …, listPrice: money("98.7600") })

// emitted *.ui.spec.ts — measured
await __new.fill(({ …, listPrice: 98.7600 }));   // → String(98.76) is typed into the form
```

The api-side renderer does the opposite, deliberately, and says why in a nine-line comment:
`src/system/e2e-render.ts:591` is `if (lit === "money") return JSON.stringify(value);`
because "`money` crosses the wire as a STRING on every backend". The UI renderer is the same
boundary — the value is typed into a form field and POSTed — so it wants the same string.

**Consequences, in order of severity.** (1) The SCALE is lost before the value reaches the app
(`"98.7600"` → `98.76`), so a spec cannot assert a scale-sensitive money round-trip through the
form at all; M-T9.38's Feliz assertion survives only because the `NUMERIC(19,4)` column
re-scales it on the way back. (2) A money literal past double precision — or past 17
significant digits, the second half of M-T9.37's `offContractNumber` rule — is **corrupted by
the spec itself**, so the test would report a divergence the backend never produced. (3) It is
the one arm of the money contract where two renderers of the same boundary disagree, which is
the `_expr`-target class the repo has otherwise been consolidating.

**The fix:** a `money` arm in `ui-e2e-render.ts`'s `renderLiteral` returning `JSON.stringify(value)`,
matching `e2e-render.ts`. Check the `convert` arm below it (`e.target === "money"` already emits
`new Decimal(…)`, which is the DOMAIN idiom, not the wire one) while you are there.

**Verification when it lands.** A generator test asserting the emitted `fill(...)` carries the
quoted, full-scale money string for a `money(...)` literal — mutation-proved by reverting the
arm, since a presence-only assertion on `listPrice` passes for either spelling. Then extend
M-T9.38's numeric UI round-trip with a money value whose scale-4 tail is non-zero
(`money("98.7654")`) and watch the Feliz leg's `toHaveText` hold it end to end; that is the
assertion the current lossy path cannot support.

Sources: measured on `main` @ `09427a5` while landing M-T9.38. Relates to RS-12 (money wire
scale), [M-T9.37](#m-t937) (the wire-golden `offContractNumber` rule, whose >17-significant-digit
half is the one this defect would trip), and M-T9.38 (the leg that found it).

## M-T9.66 — the mission-counts region is a committed derivation of every mission heading, so two mission-touching PRs collide by construction — `open` · **S** · P2

`docs/new-plan/README.md` carries a generated block between
`<!-- mission-counts:begin … -->` and `<!-- mission-counts:end -->`: a prose line
(`**167 live missions** … By status: open 69 · in-flight 1 · …`) plus a per-track
`| Track | Live | Archived |` table, produced by `node scripts/mission-counts.mjs --write`
and pinned by `test/system/mission-counts.test.ts`, which fails on drift.

The block is a pure function of the `## M-Tx.y` headings across the ten track files. That
makes it a **shared mutable counter that every mission-touching PR has to write**, and the
write is not commutative: two PRs that each change one heading's status produce two different
values for the same prose line, from the same base. The collision is structural, not a
coincidence of timing — it fires whenever two PRs are open against different missions, which
in this repo is the normal state.

**Two distinct failure shapes, both measured on `main` this week.**

1. **On the PR.** The prose line is one line, so two PRs that both regenerate it conflict
   textually. Landing the five PRs of 2026-09-27/28 (#3026, #3031, #3044, #3050, #3052) hit
   **three** such collisions in that region, each resolved by re-merging `origin/main` and
   re-running `--write`. Nothing is *wrong* in either side of such a conflict — each PR is
   individually correct and individually green.
2. **In the merge queue.** #3044 was evicted with `CI_FAILURE`, root-caused to
   `mission-counts.test.ts`. A batch's combined tree can carry headings from entry A and a
   region regenerated by entry B, and the region is then stale for the tree it is in — so the
   batch is red while every entry in it was green on its own head. This is the expensive
   shape: it costs the whole batch, and re-running the check cannot fix it.

**Why this is worth a mission rather than a habit.** The drift gate is right — an unpinned
count rots. The problem is that the *denormalization* is committed. This is the repo's own
"derive, don't stamp" rule (CLAUDE.md § Conventions) applied to a doc artefact: the counts are
a pure function of facts already in the tree, and storing them buys a GitHub-rendered number
at the price of a guaranteed conflict per concurrent mission edit.

**Options, in the order they should be considered — the choice is an owner call.**

- **(a) Move the derivation to the doc-site build.** `docs/build.mjs` already recurses
  `new-plan/`; have it compute the block and leave the README carrying only the marker
  comments. `mission-counts.test.ts` then pins the *generator* (and that the markers are still
  there), not a stored value. Cost: the numbers stop appearing in the GitHub-rendered README —
  which is the only reason they are committed.
- **(b) Make the stored block conflict-free.** One fact per line (`- open: 69`), so two PRs
  changing different statuses touch different lines and git merges them — the same trick that
  keeps a lockfile mergeable. Reduces (1) sharply and does nothing for (2): a line-per-status
  block is still stale in a combined tree.
- **(c) Keep the block, drop the ratchet from the required set.** Report drift as a warning, or
  scope `mission-counts.test.ts` to skip under `GITHUB_EVENT_NAME=merge_group`. Cheapest, and
  it fixes only (2) — at the cost of the gate's teeth in the one place the repo has decided is
  authoritative (`pr-gate` on the PR keeps them, which is arguably the right split).

**Both shapes were reproduced before filing, so the picker starts from a repro, not a story.**
Two worktrees off `origin/main` @ `a9544170a`, each flipping ONE different mission's status and
regenerating (`M-T9.61` `open`→`in-flight`; `M-T9.63` `open`→`partial`):

```
$ git merge-tree --write-tree tmp-probeA tmp-probeB        # → exit 1
Auto-merging docs/new-plan/README.md
CONFLICT (content): Merge conflict in docs/new-plan/README.md
Auto-merging docs/new-plan/T9-toolchain-health.md          # ← the track file merges CLEANLY
```

That is shape (1): the *content* edits compose, only the derived block does not. Then shape (2),
the batch — resolve that conflict by taking either side's region (a queue batch has no author to
re-run `--write`) and the tree is self-inconsistent:

```
$ git merge --no-commit tmp-probeA && git checkout --ours docs/new-plan/README.md
$ node scripts/mission-counts.mjs --check                  # → exit 1
docs/new-plan/README.md's mission-counts region is STALE.
  stored:  `open` 68 · `in-flight` 2 · `partial` 69      (probeB's regeneration)
  correct: `open` 67 · `in-flight` 3 · `partial` 69      (the combined tree)
```

Both headings are present and correct; only the counter disagrees.

**Verification when it lands.** Whichever option: keep a test that a tree carrying a *newly
added* mission heading and an *un-regenerated* region is caught on the PR — that is the
behaviour worth keeping — plus, for (a) or (b), the two-worktree exercise above as a script,
asserting `merge-tree` reports no conflict and the merged tree passes `--check`. The mutation
proof is free: the same script run against today's single-line block must reproduce the two
exits above. A fix asserted only by "the suite is green" proves nothing here, since the suite is
green on every individual entry today.

Sources: measured while landing #3026, #3031, #3044, #3050 and #3052 on 2026-09-27/28 — the
re-merge count on the PRs, and #3044's `CI_FAILURE` eviction from the queue. Relates to
[M-T9.6](#m-t96) (doc & status hygiene, the recurring mission this block serves) and
`docs/ci-gating.md` § the queue runbook.

*Wave L2-CI (leftover-waves-2026-09-28), item **G5**.*

## M-T9.67 — The unbound-symbol gate is node-only: port it to python, java, dotnet and elixir — `open` · **M** · P1 ⭐

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-G1 (leftover-waves-2026-09-28).**

Item **G1** (#2864). The freight audit minted this gate as "M-T9.59", an id that was already taken (the live M-T9.59 is the `*-unsupported` suffix register), so it landed with **no heading of its own**: `test/system/emitted-unbound-symbols.test.ts` (a regex heuristic over the whole corpus's node backend trees) and `test/system/emitted-symbol-binding.test.ts` (a real TypeScript binder). Python has only the narrow principal check (`test/system/emitted-unbound-principal-python.test.ts`). It is the gate that would have caught J1, N1 and V3 of the leftover list.

**The fix:** the same invariant per backend — a binder where the toolchain offers one cheaply (javac/Roslyn symbol passes are too heavy per-PR; the regex heuristic generalises), scoped to the corpus trees `corpus-coverage` already generates.

**Verification.** Each port must **go red on a seeded L1 regression** (e.g. revert J1's fix) before landing, and the PR body says which assertion failed.

## M-T9.68 — No within-document OpenAPI component-uniqueness gate — `open` · **M** · P1

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-G2 (leftover-waves-2026-09-28).**

Item **G2** (#3015, #3046). Two schema components with the same name in one served OpenAPI document silently shadow each other in every client generator. Only the F-026 shapes are pinned; nothing asserts uniqueness across a whole emitted document on all five backends.

**Verification.** A gate over every corpus fixture's statically emitted document (java, elixir) and the booted ones (node, python, dotnet) in the 5-way OpenAPI parity leg; mutation-proved by seeding a duplicate.

## M-T9.69 — `.loom/wire-spec.json` carries no request contracts — `open` · **M** · P1

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-G2 (leftover-waves-2026-09-28).**

Item **G3** (#2864). `wire-spec.json` is built from `wireShape` (responses) only; operation and workflow **command bodies** are absent, so the D6/D7 class of freight-audit defects (a request contract that drifts) passes the spec diff. Prerequisite for [M-T2.16](T2-data-evolution.md#m-t216)'s wire-compatibility verdict being complete.

**Verification.** Every create/operation/workflow request body present in the spec for the corpus; the spec-diff test catching a seeded request-field removal.

## M-T9.70 — Wire goldens are sensitive to unordered reads — `open` · **M** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-CORPUS (leftover-waves-2026-09-28).**

Item **G7** (#3016 — the `.NET prefix-filter #14` case). A read with no declared ordering returns rows in storage order, which differs across backends and across runs, so the wire-golden differential flakes or pins an arbitrary order. Either an order-insensitive compare for unordered reads (keyed by id), or an explicit `ORDER BY id` on every read without one — decide and apply once.

**Verification.** The differential green across repeated runs with a shuffled insert order.

## M-T9.71 — The behavioural harness builds its DDL from the drizzle object, not from the migrations — `open` · **M** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-CORPUS (leftover-waves-2026-09-28).**

Item **G8** (#2919). The behavioural tier's schema is derived from the node backend's drizzle tables, so it has no foreign keys and no enum `CHECK`s — the constraints `MigrationsIR` emits for every real deployment. A behaviour that only a constraint enforces passes here and fails in production.

**The fix:** build the harness DDL from the phase-⑨ migrations (the same `sql-pg.ts` output the backends ship).

**Verification.** A seeded FK/enum violation that the harness now rejects.

## M-T9.72 — CI residue batch: `pr-gate` head drift, empty-head admission, ratchet gaps, Java cap, Schemathesis re-triage — `open` · **M** (a batch of S items) · P1

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-CI (leftover-waves-2026-09-28).**

| id | Item | Src | Sz |
|---|---|---|---|
| G9 | `pr-gate` can publish onto a SHA that is no longer the head (#2804); a PR with **zero check runs on its head** was admitted by the merge queue (#3002, the #2964 fleet plan). Owner decision **O6** — default: make `pr-gate` fail on an empty head | #2804 / #2964 | S |
| G10 | Ratchets missing: pack-loader `SHARED_SOURCE_DIRS_*` ↔ `generated-*` workflow `paths:`; `frontend-showcase-render` `GAPS` (3, incl. `heex:Console`) not in `allowlist-ratchet` | #2766 / #2891 | S |
| G11 | `behavioral-e2e-java` cap still at a provisional 30 min; re-measure (the gradle daemon gave ~4×) | #2855 | S |
| G12 | Schemathesis F21 / W27 (.NET write half) re-triage: the nightly on `8202fb63` is green, so read its artifacts | #2773 | S |

The other L2-CI items are existing missions: G4 = [M-T9.64](#m-t964), G5 = [M-T9.62](#m-t962) + [M-T9.63](#m-t963) + [M-T9.66](#m-t966).

**Verification.** Each new ratchet mutation-proved; G9 proved by a queue entry with a stripped head.

## M-T9.73 — Test-hygiene batch: four `it.fails` flips, the brand-erasing helpers, a duplicate id-target walk — `open` · **S–M** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-HYG (leftover-waves-2026-09-28).**

| id | Item | Src | Sz |
|---|---|---|---|
| G13 | `it.fails` flips (4 patches): `lookupPreset` → `Object.hasOwn`; `elixirRegexBody` single-scan escape; import `KEYCLOAK_HOST_PORT`; `loom.workflow-fn-name-collision`. Also delete the dead `describe.skip` in `storage-declaration.test.ts:46` | ledger | S |
| G14 | Test-helper type workarounds: `allContexts`/`allAggregates` erase the enriched brand; `enrichLoomModel(RawLoomModel)` / `reEnrich`; `.d.mts` for the `pr-gate` / `quality-delta` / `ledger-counts` scripts | #3011 4b | S |
| G16 | A duplicate id-target walk: `claimIdTargets` vs `src/ir/util/id-targets.ts` | #2881 | S |

G15 (the module-global census does not cover `test/_helpers/`) is [M-T9.54](#m-t954)'s residue.

## M-T9.74 — Corpus shapes the leftover list proved missing — `open` · **S** (per fixture) · P1

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L2-CORPUS (leftover-waves-2026-09-28).**

Item **G6**, plus the fixtures other leftover missions defer here. Each is a shape whose absence let a silent defect ship; every new fixture carries an `e2e` block (the E2E-less count must not grow — coordinate with #3058, which owns `E2E_LESS_CORPUS_FIXTURES`).

- a select-only query-time projection (#3030);
- `scaffoldHandlers` × `softDeletable` / `extends` (#3011 H2 — precursor to M-T5.40);
- re-add the grouped read + enum-key sorts to `projection-agg-filters.ddd` (#2988);
- [M-T6.62](T6-backend-parity.md#m-t662)'s uncorrelated `Tally` workflow (X1), once its emitters land;
- a Flutter fixture that reaches [M-T1.36](T1-ui-frontend.md#m-t136) F9's `CreateForm` drop arms;
- a behavioural case that OMITS a value-object collection on create and reads back `[]` (the named follow-up of M-T5.35 / #2918).

**Added 2026-09-29 (evaluation-closure item G8-10e — FieldOps-audit FIX-PLAN §5.7's two-line fixtures, which no mission named):**

- `validation-messages.ddd` gains a message-less `matches(...)` rule and a `toThrow(422)` case;
- a fixture combining `requires true`, a `currentUser.<claim>` find filter, and a `for` × `if-let` workflow body;
- a ts-build fixture with a value object holding an `X id`, an enum-stated workflow, and a managed default.

## M-T9.75 — 199 test files still import `generateSystems` directly — `open` · **L** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L4-TESTS (leftover-waves-2026-09-28).**

Owner of the `PINNED` backlog in `test/system/direct-generate-systems-ratchet.test.ts` — **199 files** on `cbda9165`. The ratchet was minted by M-T9.35 (done, archived), which left the residue with no owner (leftover-waves D10). Each pinned file asserts on emitted output from a model nothing checked at phase ⑦ (and, via a bare `parseString`, often not at ① or ④ either).

**The drain:** move each file to `generateSystemFiles` / `generateSystemResult` (or `generateSystemFilesUnchecked(source, why)` when the fixture must stay one the product refuses) and delete its pin in the same commit; regenerate the list with `node scripts/direct-caller-census.mjs`. Expect genuinely invalid fixtures to surface — repair them, never weaken the assertion.

## M-T9.76 — The legacy single-context `generate` backlog: 32 Hono + 38 .NET test files — `open` · **L** · P2

*Minted 2026-09-29 by wave L0 of [leftover-waves-2026-09-28](leftover-waves-2026-09-28.md) (D16), from its §2 verified-leftover list (`main` @ `d2a0bc02`, re-checked on `cbda9165`). Evidence is the plan's; re-verify on fresh `main` before building (RUNBOOK §1) — a packet that finds an item already fixed records that and drops it.* **Wave: L4-TESTS (leftover-waves-2026-09-28).**

Owner of the `PINNED_HONO` (32 files / 58 call sites) and `PINNED_DOTNET` (38 files / 145 call sites) backlogs in `test/system/legacy-generate-path-ratchet.test.ts`, counted on `cbda9165`. The ratchet's .NET column was minted by M-T9.49 (done, archived) and its Hono column by [M-T9.48](#m-t948) (whose own residue is only the two `parseString` files it names), so the call-site drain had no owner (leftover-waves D10).

**The drain:** move each file to `generateSystemFiles` — the path the CLI ships, and the only one that can host a capability (see the ratchet's header: the legacy path emits from loose contexts and so has no backend deployable) — deleting its pin in the same commit; the per-file counts are pinned exactly.

## M-T9.77 — Paged `queryHandler` body shape crashes generate on all five backends — `open` · **S** · P1

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

Any `queryHandler H(…): Agg paged` whose body is not exactly `let r = Repo.run(Crit(args)); return r`, e.g. `return Orders.run(InRegion(rgn))`, reaches `pagedRunStmt` (.NET / Java / Python / Elixir) or `emitPagedRunHandler` (node) and throws. **#3084 already adds the refusal** (`loom.paged-query-handler-shape`). When it merges, re-classify the five census entries `guardedBy: ["loom.paged-query-handler-shape"]` and close this mission.

## M-T9.78 — An event-sourced workflow with no id-typed correlation field crashes .NET / Java / Elixir — `open` · **S** · P1

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

`workflow Tracker eventSourced { create(c: string) { emit … } apply(…) { … } }`: a command-only create, no `on`, no id-typed state field. `loom.workflow-correlation-required` returns early when there are no event consumers, so nothing refuses it. **node and python generate it**; .NET (`esCorrIdClass`), Java (`esWorkflowCorrIdClass`) and Elixir (a raw `TypeError … reading 'replace'`, not a census throw site) crash. Parity gap: port the node/python shape, or refuse target-neutrally if the instance-id stream key is not meant to exist.

## M-T9.79 — Statement vocabulary of event-sourced and workflow bodies — `open` · **M** · P1

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

The Elixir `if` gate (`if-stmt-checks.ts`) and the applier-discipline checks cover aggregate operations, functions and `apply` blocks. They miss an event-sourced `create` body (an `if` crashes Elixir's `renderCommandRunner`), a workflow `function` (`if` with an early `return` crashes `renderFunctionBodyLines`), an aggregate `apply` with `return` (Elixir `renderFoldStatement`), a workflow `apply` with `let` / `if` (Python and node `renderApplierStmt`), a workflow `apply` constructing a same-context part (Elixir `renderFoldNewMap`), and a reactor `on(…)` body with `Repo.delete` (Elixir `dispatch-emit` `renderStmt`). The fix that closes the class: declare each body position's statement vocabulary per backend once, the way `UNIT_TEST_STMT_KINDS` does for test tiers, and add a position × backend × kind census like `test/system/test-statement-census.test.ts`.

## M-T9.80 — Resource operations in positions with no resource mapping — `open` · **S** · P2

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

A resource op where the emitter has no resource class: in a workflow `function` (.NET `renderCall`), a projection fold assignment (Java `renderCall`), or a raw verb on a `kind: api` resource bound to an in-system api (Elixir `renderCall`). Each passes `loom.resource-op-outside-workflow` / `loom.projection-fold-impure`.

## M-T9.81 — Frontend page- and store-action vocabulary (Feliz / Flutter, plus the shared JS walker) — `open` · **M** · P1

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

Eleven sites on the two self-hosting frontends: a page-action method outside F#'s small set (`reverse`, `indexOf`, …), an effect-free block lambda, `this` / an action-ref as a value, `toast(…)` (exempted as a builtin by `loom.unresolved-action-ref`, but Feliz renders only `navigate`), a nested `match await`, store action bodies never scanned (`foo()` / `match await`), and four Feliz find-read shapes (list param, non-aggregate return, unchecked arity, a row binding as the argument). Also: a union-typed payload field crashes both frontends' `wireTypeInfo` even when no page touches it. The shared JS walker (React / Vue / Svelte / Angular) has two more: `this` in a page or component body (`Text { this.name }`, `walker-core.ts` `emitExpr`), and a page action assigning to a name that is not a declared state field (`action bump() { other := 1 }`, `unsupportedPageStmt`). Only `if` / `precondition` / `requires` are gated.

## M-T9.82 — Generate-crash residue — `open` · **M** · P2

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

One-off crashes with no shared root: JPA's optional / entity-part reference collection (`Tag id[]?`) and VO-array projection state; Java `group by` on a `json` column; a Java part builder-call inside an aggregate test; a folded projection with no `keyed by` whose handlers use `on(e) by …` (shared `migrations-builder.ts` `TypeError`, so every backend); MikroORM's VO-in-VO collection column; MikroORM `filter this.refs.contains(<id>)`; node's zod row for a `duration` select; HEEx `match await` on an aggregate this deployable doesn't serve; and HEEx store-action / component `handle_event` name collisions. Found while compile-checking #3133 (a COMPILE failure, not a throw site): a query-time projection named `Count` emits `OrderJpaRepository.count()`, which clashes with Spring Data's `CrudRepository.count()` (`javac: count() in OrderJpaRepository clashes with count() in CrudRepository`). `ddd parse` is clean. Add the inherited `CrudRepository` / `JpaRepository` method names to the Java reserved-surface check, or rename the emitted method.

## M-T9.83 — A misconfigured custom design pack crashes generate with no diagnostic — `open` · **S** · P2

*Minted 2026-10-04 by the fail-closed sweep (#3133), from `test/system/generator-throw-census.test.ts`. Each site below has a `.ddd` that `ddd parse` reports as `0 error(s)` and `ddd generate system` then crashes on; the per-site register with every repro is [`missions/M-T9.77-fail-closed-register.md`](missions/M-T9.77-fail-closed-register.md). Each site is a `deferred` entry in `generator-throw-census.manifest.ts` and expires 2027-01-31. **The fix closes the census entry:** add the `loom.*` refusal (and re-classify the site `guardedBy`) or make the emitter render the shape (and delete the throw).*

`design: "<path>"` on a deployable is accepted with only the `loom.design-pack-custom-unchecked` warning, and every way the pack can be malformed then crashes generate with a descriptive but uncoded `Error`. The cases: no `pack.json`, no `emits`, an `emits` entry naming a missing `.hbs`, an unknown `stack`, a required primitive missing, an empty / `<`-carrying / brace-unbalanced chrome message, an undeclared chrome role used by a template, an ICU hole passed by a HEEx pack template, and a `shellFiles` key not in `emits` (`_packs/loader-fs.ts`, `loader.ts`, `pack-chrome.ts`, `shell-emits.ts`). Load and check the pack in phase ⑦ and raise a `loom.design-pack-invalid` error naming the defect. **Side bug, same mission:** a relative `design:` path resolves against the process working directory, not the `.ddd` file's directory (`resolvePackDir` is called without `referenceDir`, e.g. `react/index.ts:168`).

## M-T9.89 — Widen `ir-walk-census` to independent `if (x.kind === …)` statements — `open` · **M** · P2

*Minted 2026-09-29 by wave B7 (docs sweep) of the 2026-09-28 evaluation-closure review, from its mission-only list: owner ruling **D12** or a plan item no wave builds. Every item was re-proved on `main` @ `cbda91658` by an adversarial re-verification (minimal repro, `parse` + `generate system`, generated `path:line`). Re-verify on fresh `main` before building.*

Item **G8-10b** (FieldOps-audit FIX-PLAN §5.8, which asked for it to be "minted as its own mission"). `test/system/ir-walk-census.test.ts` detects a hand-rolled `switch (x.kind)` and an `if … else if` chain over `ExprIR` / `StmtIR` / `WorkflowStmtIR`, but not a run of **independent** `if (x.kind === …)` statements in one function body, which is the same partial-dispatch shape (the plan counted ~76 sites across ~12 files). A kind the run forgets is invisible exactly as it is in an unchecked chain.

**The fix:** a third detector shape (two or more non-chained kind tests on the same receiver within one function), then triage every hit into migrate onto `walk.ts` / make exhaustive with a `never`-check / waive with a reason, as the existing shapes do. **Sequence after #3065** (Wave CR1), which reshapes the same test's waiver register.

**Verification.** The census fails on a seeded independent-`if` run over `ExprIR` and passes after the triage; mutation-proved by deleting one waiver.

## M-T9.90 — Promote the Clinica evaluation model into the compile corpus — `open` · **M** · P2

*Minted 2026-09-29 by wave B7 (docs sweep) of the 2026-09-28 evaluation-closure review, from its mission-only list: owner ruling **D12** or a plan item no wave builds. Every item was re-proved on `main` @ `cbda91658` by an adversarial re-verification (minimal repro, `parse` + `generate system`, generated `path:line`). Re-verify on fresh `main` before building.*

Item **G8-10g**. `eval-clinica/FIX-PLAN.md:82-100` planned a wave-0 gate: a bespoke `test/system/generated-compiles.test.ts` plus a realistic multi-feature app (`eval-clinica/clinica/main.ddd`). The test never landed and no mission named it. The bespoke gate is now superseded by the per-backend corpus compile legs (`python-build`, `java`, `dotnet`, `elixir`, `ts`), but those legs only reach what `test/fixtures/corpus/` holds, and no realistic multi-context app is in it.

**The fix:** trim `eval-clinica/clinica/main.ddd` into a corpus fixture (keep its cross-context events, workflows, tenancy and projections; drop what the fixtures already cover), with an `e2e` block (the E2E-less count must not grow; coordinate with #3058's `E2E_LESS_CORPUS_FIXTURES`). No new bespoke gate.

**Verification.** The fixture compiles on every backend its manifest row declares; any shape it breaks is filed against the owning mission rather than waived.

## M-T9.91 — Residue of the ported 2026-09 evaluation registers — `open` · **S** (a batch) · P3

*Minted 2026-09-29 by wave B7 (docs sweep) of the 2026-09-28 evaluation-closure review, from its mission-only list: owner ruling **D12** or a plan item no wave builds. Every item was re-proved on `main` @ `cbda91658` by an adversarial re-verification (minimal repro, `parse` + `generate system`, generated `path:line`). Re-verify on fresh `main` before building.*

The small open items the ported registers (`docs/audits/2026-09-13-council-fieldops-evaluation.md`, `2026-09-20-clearline-fieldops-evaluation.md`, `2026-09-22-platform-orderly-evaluation.md`, `2026-09-22-cargo-meridian-evaluation.md`, `2026-09-28-claims-assure-evaluation.md`) carry that no wave, PR or other mission owns:

| id | Item | Source | Sz |
|---|---|---|---|
| R1 | A cross-aggregate `X id` naming an **entity part** of another aggregate: a backend-only system accepts it and emits `Ids.SiteId`; with a UI deployable it is refused as `loom.ui-id-ref-unknown-aggregate … no aggregate 'Site' is declared` about a declared entity. Pick one rule, word the message for the part case, and document the part-vs-aggregate trade-off | council F-003 | S |
| R2 | The Feliz project and its Dockerfile target `dotnet/sdk:8.0` / `net8.0` beside a `net10.0` .NET backend (consistent, so not a build break; net8 leaves support 2026-11). Route through the `dependency-upgrade` skill | platform M-2 | S |
| R3 | `ddd parse <file>.txt` (any non-`.ddd` input) dies with `The service registry contains no services for the extension '.txt'` and a raw stack trace; refuse with a one-line message instead | eval-clinica G8-09d | S |
| R4 | A register's header tally drifted from its own `### F-` headings in five registers. A `test/system` gate that every `eval*/FINDINGS.md` (and ported `docs/audits/*-evaluation.md`) header count equals its heading count would make that impossible | eval-closure review §5.5 | S |

**Verification.** Per row: R1 a validator case each way; R3 a CLI test on a `.txt` path; R4 the gate mutation-proved on a seeded miscount.

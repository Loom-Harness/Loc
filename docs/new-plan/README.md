# Loom — the global implementation plan

*One roadmap, divided into feature tracks and agent-pickable missions. Created 2026-07-13 from a full re-classification of the design corpus (118 proposals, 71 plans, the DEBT backlog, the parity registers, the audits); it supersedes every earlier status table. The archived corpus under [`../old/`](../old/) is the design record — missions link into it; nothing was deleted.*

*Execution plan (**2026-09-02**): [`improvement-waves-2026-09.md`](improvement-waves-2026-09.md) — the quality/stability wave plan for the next agent fleets: the 2026-08-30 gap-ledger residue re-counted against the 29 merges since it was cut (after the Wave 1 ledger reconciliation: one open P0, the W1b `F2-ADP-3` gate handoff — the three P0s first listed were drained by #2668 itself), the in-flight PR fence, and five waves, one PR per wave to spare the shared CI pool (land the ready queue → close the P0/P1 residue by tree-fenced packet → class-level seams with byte-identical gates → runtime-value verification → process). Statuses stay in the track files; it forks nothing.*

*Completion plan (**2026-09-10**): [`completion-waves-2026-09.md`](completion-waves-2026-09.md) — the review of the 583 commits / 193 merges since 08-17 and the wave plan to "all done" (no gaps, no debt, nothing unsupported on any target): the end state as a table of registers that must read zero (§1), the priority order (§2), eight rules added from `experience_gathered.md` §100–§112 (§3), and eight waves of dedicated Opus agents — C0 land/stabilise/true-the-ledgers, C1 the P0s + the silent class, C2 one packet per target until `MAX_OPEN_GAPS` counts zero live rows, C3 runtime-value verification, C4 the debt seams, C5 the fifteen blocking rulings + the three coordinated moments, C6 every product mission built or owner-dispositioned, C7 docs truth + the closing audit. It re-homes the unfinished items of the two earlier 2026-09 plans by id and forks no status table. Hygiene landed with it: the duplicate P0 `M-T6.60` was renumbered **M-T6.62**, and **Wave C0.4 has since drained the rest** (2026-09-10) — the merged-but-unflipped missions flipped with their PR link and file:line evidence and archived, the 20 `done` headings moved to `archive/T<n>-done.md`, the stale "claimed by open PR" lines drained, and the out-of-repo `M-FT.1–31` field-test series reconstructed into [`archive/FT-done.md`](archive/FT-done.md) (18 merged ids) + [`missions/field-test-2026-09-register.md`](missions/field-test-2026-09-register.md) (13 with no definition anywhere in the repo).*

*Last refreshed: **2026-09-02**, against `main` @ `36d8516`. This pass was a plan-hygiene audit and a layout change, not a feature pass:*

- *Every one of the 208 mission headings was cross-checked against the merged-PR record on `main` (3,253 commits, 304 of them naming a mission id) and the 12 open PRs. Four statuses were stale in the direction that matters — **three missions marked `open` had their fix merged** (M-T2.14 #2669, M-T6.44 #2670, M-T6.46 #2677; each PR carries the full fix plus witnesses, not a claim stub) — and four numeric-audit missions are `in-flight` on ready-for-review PRs (M-T1.21–M-T1.24). Four `done` headings had no PR citation and now do (M-T1.25 #2673, M-T6.17 #1955, M-T6.24 #2340, M-T6.45 #2676). Everything else the audit checked was current as written: the `partial` bodies are maintained PR-by-PR by their owners and matched the log. One `partial` was closed by owner decision: **M-T4.1 scheduling** — `every:` + durable `cron:` timers ship on all five backends, and the sugar its "Remaining" list named is not open work; agents had been re-proposing "temporal" features on the strength of that heading.*
- ***The track files now list only live missions.*** *The 76 closed missions (`done` / `shipped` / `closed` / `concluded` / `withdrawn`) moved, verbatim, to [`archive/T<n>-done.md`](archive/); the design docs of closed missions moved to [`archive/missions/`](archive/missions/); the ten stacked "Last refreshed" notes and the 08-24 shortlist that used to head this file are preserved in [`archive/refresh-log.md`](archive/refresh-log.md). `coverage.md` rows that pointed at a closed mission now say so and link into the archive.*

*Last refreshed: **2026-09-02** — a playground UX pass (docs + one fix batch, no generator changes). Two audits landed: [`playground-ux-review-2026-09.md`](../audits/playground-ux-review-2026-09.md) (34 findings against a production build on desktop + phone; the header-overlap, wrong bundle-failure message, red "0 errors" and empty-state findings fixed in the same PR) and [`playground-landscape-research-2026-09.md`](../audits/playground-landscape-research-2026-09.md) (Replit / Lovable / v0 / Bolt, the compiler playgrounds, the model-driven tools, the HAX/PAIR/HIG guidance — source-linked). **Eight missions minted, M-T8.16–M-T8.23**, IDs verified free on this head and against every open PR, with one program doc ([`missions/M-T8.16-playground-ux-program.md`](missions/M-T8.16-playground-ux-program.md)) carrying the shared vocabulary rule, the test-id contract, the file-disjoint waves and the owner-overridable defaults: wave 1 = **M-T8.16** (pipeline strip + vocabulary + honest dock, P1) ∥ **M-T8.17** (confirm/undo layer + silent no-op drain, P1); wave 2 = M-T8.18 (Problems as teaching surface, `⌘K`, first run), M-T8.21 (scaffold gradient in the Builder), M-T8.22 (runtime & evolution surfaces); wave 3 = M-T8.19 (agent plan → receipt → checkpoint), M-T8.20 (`.loom/` as views + source↔output correspondence), M-T8.23 (targets drawer, read-only links, export). Nothing in the program touches the language or the generators.*

## What Loom is building toward

Loom lets you program architecturally correct business apps concisely, with a no-code feel: the `.ddd` model is the single source of truth; UI can be scaffolded from the domain and customized through escape hatches (`extern`, unfold); the model is editable as text, visually (builder), or by an AI agent through the compiler's tool surface; and backend/frontend targets are a config choice. Every open thread in the old corpus lands in exactly one **mission** — a self-contained, agent-pickable unit of work.

## How to use this plan (for agents)

**Starting a mission?** The full execution protocol lives in [`RUNBOOK.md`](RUNBOOK.md) — the kickoff prompt for any mission is two lines (mission ID + "follow the runbook"). The rules below are the summary; the runbook is the contract.

1. **Pick a mission** from a track file (`T1`–`T10`). Missions are sized S (≤1 PR, hours), M (1–3 PRs), L (a PR stack / multi-session), XL (an epic with its own sub-plan).
2. **Re-verify before building.** `main` moves fast. A mission's first step is always: check fresh `main` (and open PRs) that the gap still exists. Missions carrying a ⚠ *verify-first* flag have known doubt.
3. **Claim with a draft PR** naming the mission ID (e.g. `M-T1.1`) before implementing — see CLAUDE.md's claiming protocol.
4. **Honor the D-tags.** Pinned decisions in [`../decisions.md`](../decisions.md) constrain design; a mission that contradicts one needs the decision re-opened first, not silently ignored.
5. **When a mission completes**, flip its status line with the PR link, then **move its section to `archive/T<n>-done.md`** (and update the coverage row if the source doc is now fully drained). This plan is the only status table — don't resurrect the old ones, and don't leave closed missions in the track files.

## Status legend

`open` (no code yet) · `in-flight` (claimed / PR open) · `partial` (some slices landed; mission covers the remainder) · `blocked(X)` (waiting on mission/decision X) · `plan` / `deferred` / `recurring` / `frozen` (as named) · `done` (moved to `archive/` — a track file should never carry one for long).

## Where things live

| Path | What |
|---|---|
| `T1`–`T10-*.md` | The live missions, one file per track. Ordering within a track is top-to-bottom unless a mission states a dependency. |
| [`RUNBOOK.md`](RUNBOOK.md) | The execution protocol every mission follows. |
| [`coverage.md`](coverage.md) | Disposition of every archived proposal / plan / audit (test-enforced: `test/system/coverage-guarantee.test.ts`). |
| [`missions/`](missions/) | Design docs / briefs for live missions (`M-Tx.y-*.md`). |
| [`testing-quality-improvement-plan.md`](testing-quality-improvement-plan.md) | Companion plan for the test-quality missions M-T9.12–M-T9.20 (its `###` entries include three already-done ones, left in place because the sections read as one argument). |
| [`archive/`](archive/) | Closed missions per track (`T<n>-done.md`), their design docs (`missions/`), and the refresh history (`refresh-log.md`). Evidence trail only — nothing open. |

The unsupported-diagnostic register (`src/diagnostics/unsupported-register.ts`) cites mission ids; `test/system/unsupported-register.test.ts` requires each cited id to appear as exactly one `## ` heading somewhere under `docs/new-plan/` (the archive counts), so a mission id is never renumbered or deleted once minted.

## The tracks

| Track | Theme | Weight |
|---|---|---|
| [T1 — UI & frontend ceiling](T1-ui-frontend.md) | Data-heavy tables, upload, forms tail, state/async, i18n, a11y, extern parity, navigation, the numeric/money frontend seams | **P1 — highest product ROI** |
| [T2 — Data & schema evolution](T2-data-evolution.md) | Rename intent, data migrations, baseline safety, seeding/uniqueness tails, storage config tail | **P1 — the "silent data loss" class** |
| [T3 — Security, tenancy & governance](T3-security-governance.md) | `organizationContext`, OIDC depth, sensitivity, versioned-on, the read surface, lifecycle-gate goldens | **P1 — secure-by-default** |
| [T4 — Eventing, workflow & temporal](T4-eventing-temporal.md) | Projections, channels/brokers, outbox completion, saga hardening, realtime contract, email/storage batteries — **scheduling is done** (`timerSource` `every:`/`cron:` on all five backends, M-T4.1 archived 2026-09-02; don't re-propose "temporal" features) | P2 |
| [T5 — Language core & type system](T5-language-core.md) | Exception-less A4–A6, criterion/retrieval tails, payload P3/P5, stdlib tail, inheritance I4, lifecycle 3–5, surface hygiene, numeric RS-rulings | P2 |
| [T6 — Backend parity & generated-code quality](T6-backend-parity.md) | Phoenix gaps register, adapter subsets, numeric ingress, saga/workflow emission holes, ES seeding | P1/P2 (small missions, wrong failure modes today) |
| [T7 — Deployment & operations](T7-deployment-ops.md) | k8s hardening, proxy/networking, terraform, PaaS deploy | P2 |
| [T8 — DX, tooling & the AI platform](T8-dx-tooling-ai.md) | Debugger frontier, sourcemaps, LSP tail, playground chat/agent loop, builder, packaging split, mutation testing | P2/P3 |
| [T9 — Toolchain & process health](T9-toolchain-health.md) | Per-PR boot gates, test-coverage phases, the numeric wire-codec seam, `RouteTarget`, doc hygiene, the recurring sweeps | **P1 — prerequisite to trusting the matrix** |
| [T10 — New targets](T10-new-targets.md) | Go/PHP/NestJS/Blazor/HTMX/Next.js studies **retired to design-record**; **matrix frozen — decided 2026-07-17, no more targets** | — (closed; every heading is `frozen`) |

<!-- mission-counts:begin (generated by scripts/mission-counts.mjs) -->

**149 live missions** across the ten track files, and **109** archived — counted by `node scripts/mission-counts.mjs` over the `## M-Tx.y` headings themselves, not typed by hand. By status: `open` 51 · `in-flight` 1 · `partial` 66 · `blocked` 14 · `deferred` 1 · `recurring` 2 · `frozen` 7 · `done` 5 · **2 outside the legend** (M-T4.12 `mostly done`, M-T9.42 `in progress`).

| Track | Live | Archived |
|---|---:|---:|
| T1 | 20 | 12 |
| T2 | 8 | 6 |
| T3 | 12 | 5 |
| T4 | 8 | 4 |
| T5 | 21 | 10 |
| T6 | 18 | 46 |
| T7 | 8 | 1 |
| T8 | 13 | 10 |
| T9 | 34 | 15 |
| T10 | 7 | 0 |
| **all** | **149** | **109** |

A track file should carry no `done` heading for long (see §Status legend); regenerate this block with `node scripts/mission-counts.mjs --write` whenever you archive one. `test/system/mission-counts.test.ts` fails if it drifts.

<!-- mission-counts:end -->

*The 2026-09-03 jump is the [language-docs audit](../audits/2026-09-03-language-docs-audit-findings.md): 18 missions minted from its 47 findings — M-T5.26–M-T5.29, M-T1.28–M-T1.31, M-T6.53–M-T6.58, M-T9.44–M-T9.47, one per packet of its [wave plan](../audits/2026-09-03-language-docs-audit-findings.waves.md). **Waves 1, 2 and 4 of that plan are drained** (2026-09-09/10): M-T1.29, M-T1.30, M-T5.26, M-T5.27, M-T5.29, M-T6.53, M-T9.44 and M-T9.45 are archived, and M-T1.28 stays live carrying only the residue #2786 opened (the `renderToast` seam + F50, the Svelte twin). What remains from the plan is W3.1 (M-T5.28), Wave 5 (M-T6.54–M-T6.57), Wave 6 (M-T6.58) and Wave 7 (M-T9.46, M-T9.47) — all `open`.*

## Sequencing — the load-bearing dependencies

- **The governance spine is built.** Execution-context backbone, multi-tenancy Phases 1–2, authorization read/write ladders + named policy functions, item 3's operation/view/workflow/find gates, item 6's read half (`mask unless`, all five backends) and P4 `deny` (M-T3.3, all five backends + adapter arms) all ship; item 6's write side is **WON'T DO** (reverted #2254/#2257). What remains is **`organizationContext` (M-T3.6)** and the read-surface plan (M-T3.15).
- **Coordinated single-PR moments** (one PR + fixture re-baseline, don't slice): **A4** `Repo.getById` re-shape to `T or NotFound` (M-T5.1); the language default `opt` → `denyByDefault` (M-T3.1, a major); `organizationContext` (3)+(5) (M-T3.6, all-or-nothing). (Versioned default-on, M-T3.4, and paged-by-default implicit `findAll`, M-T2.6, both shipped.) Sequenced as Wave C5 of the completion plan.
- **Target freeze — decided (2026-07-17):** the matrix is permanently closed; **there will be no more backends or frontends** (owner decision, see [direction-review-2026-07](../audits/direction-review-2026-07.md)). M-T9.2 concluded the persistence surface can't be abstracted, so a growing matrix would have re-landed it by hand forever; frozen, that cost is bounded ×5 and amortizes. **The breadth budget goes to depth (T4 eventing, T2 data-evolution) — each capability lands ×5 once against a closed set, then is done.**
- **The numeric series is the current cluster.** The 2026-08-23 numeric-types audit minted 17 missions; as of this refresh nine are done, four are in-flight (M-T1.21–M-T1.24, the frontend money/decimal seams), and the two seam missions behind them (M-T9.36 wire-codec seam, M-T9.38 Flutter/Feliz runtime leg) are `blocked` on those four. Land the four before opening the seams.

## Priority shortlist (if you only take five things)

**Owner directive (2026-08-10, unchanged):** gaps in implementations (a missing feature per target) and bugs outrank architectural improvements. Rows that restate a defect go stale the week the defect is fixed, so each row points at the register or audit that *owns* its list. Verify against fresh `main` + open PRs before claiming.

1. **The 2026-08-24 generator code review's follow-up register** — `docs/audits/generator-code-review-2026-08-24.md` §"Follow-up register (2026-08-30, post-#2667)", re-verified and landed as #2689. The §A bug register is drained (all 21 in #2667); what is left is that dated table plus the §F architecture queue, each row with an owner: the six missions minted from it (M-T1.26, M-T4.12, M-T5.25, M-T6.50, M-T6.51, M-T9.39) plus rows folded into M-T4.2 / M-T4.3 / M-T9.7. The 251-row `G2667-*` ledger from #2668 is merged — cite ledger ids, don't fork them.
2. **The persistence-adapter axis, down to one survivor:** **M-T6.35** (the remaining `loom.*-unsupported` adapter rows). The other row here — the **dapper raw-Npgsql aggregation arm** #2609 left as reported follow-up (M-T6.41's residue) — is **closed**: both Dapper aggregation arms splice the source aggregate's capability filters (`src/generator/dotnet/query-projection-emit.ts:661`, `:857`), pinned by `test/generator/dotnet/dapper-query-projection-capability-filters.test.ts`; M-T6.41 is archived in [`archive/T6-done.md`](archive/T6-done.md).
3. **M-T3.16's residue is two goldens, not two gaps** — C2 (a guarded create with an invalid body answers 403 on Elixir vs 422 elsewhere) and C4 (no golden covers a remapped `Forbidden`). The enforcement they cover already ships on all five backends.
4. **The frontend feature×target tail is Flutter's four form-field shapes** — pinned in `KNOWN_FLUTTER_GAPS` (`test/generator/flutter/parity-freeze.test.ts`) and owned by M-T1.18's M-A residue. What is left on `loom.auth-ui-unsupported-framework` / `loom.ui-realtime-unsupported` is the seam a future frontend would gate on, not a Flutter gap (M-T1.20).
5. **Coverage that hides gaps:** M-T9.13's drain of `E2E_LESS_CORPUS_FIXTURES` (the array in `test/ir/api-caller-census-pins.ts` — grep it, the count moves weekly). Every drain so far has uncovered a live defect the waiver was hiding (#2696 the `tenantOwned` + `shape: document` create-stamp hole; #2717 the dev-claims classifier that dropped array claims on four backends). Then M-T9.28's repo-wide `.ddd`/clause census, and registering the unwatched ratchets in `allowlist-ratchet` (M-T9.8).

**Architectural improvements queue behind these**, in order: §F2 of the 08-24 review (emission *mode* explicit on the shared renderers), §F4 → **M-T4.12** (the plan-level realtime contract, which also owns the live hole that no generated SPA can authenticate its own SSE stream), §F5 → **M-T9.39** (the i18n round-trip gate), then M-T9.26 `RouteTarget` (unblocked; re-measure post-#2462 first), M-T5.21 callable unification (design signed off in #2444), M-T3.6 `organizationContext` + M-T5.1 A4 re-shape (the two remaining coordinated moments), M-T9.25 round 2.

## Open PRs at this refresh (2026-09-10)

Five, none draft: **#2770** (Wave 2 seams — carries M-T9.36, M-T6.52 and the feliz/flutter/HEEx legs of M-T1.8; their track rows still read `open`), **#2778** (Wave 2.6 hotspot splits; merges after #2770, needs one rebase), **#2843** (M-T9.55 give-up glob fix; red only on the playground spec #2848 fixes), **#2846** (the `pr-gate` sweep's concurrency self-collision), **#2848** (two playground specs). The merge order is Wave C0.1 of the completion plan. Every PR from the 09-02 list has merged.

## Statuses rot — verify, then verify the verifier

Two standing rules beyond the per-mission verify-first step:

- **No status flip without code evidence.** Marking a mission `done` requires the PR link *and* the gate/emitter/test evidence line — the same standard the old corpus failed to keep (its three status tables drifted apart within weeks). This refresh found three merged fixes whose missions were still `open`: the PR landed, the tracker didn't — the runbook's step 5 exists for exactly that.
- **Audit for pretended work.** In a repo where parallel agents land PRs continuously, "merged" is not "real": gates get softened, dead code gets left unwired, TODOs get emitted into output. **M-T9.8** is the recurring adversarial sweep for this class; run it after any large multi-agent push.

## Provenance & coverage

Every archived proposal/plan is dispositioned in [`coverage.md`](coverage.md): either *shipped/superseded/historical* (no open work) or mapped to the mission(s) that carry its remaining items. If you find an open thread in an old doc that no mission covers, that's a bug in this plan — add a mission, don't fork a new tracker doc.

Audit findings feed the same way: the open items from `completeness-audit-2026-07`, `architecture-weak-spots-2026-07`, `full-code-review-2026-07`, `generated-code-ddd-review-2026-07`, `numeric-types-audit-2026-08-23` and `generator-code-review-2026-08-24` are all mission-mapped; see coverage.md §Audits.

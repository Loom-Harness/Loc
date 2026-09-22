# Wave C4 — the debt seams and compiler hygiene (coordinator log)

Plan: [`../completion-waves-2026-09.md`](../completion-waves-2026-09.md) §4 "Wave C4". Rules: §3 there (rules 10–18) and §3/§3a of [`../improvement-waves-2026-09.md`](../improvement-waves-2026-09.md). Wave PR: **[#3011](https://github.com/Loom-Harness/Loc/pull/3011)** (draft = the claim) on `claude/loom-review-planning-adz0n4`, restarted from `main` @ `a45fc948b` (the C2 batch-3 merge, 2026-09-22 03:19Z).

## Status: **launched 2026-09-22 — batch 1 (4b, 4c, 4a) running; batch 2 (4d, 4e, 4f) follows as slots free (4-core box, three Opus agents at a time)**

## Coordinator commit (first, per the kickoff)

This log, plus the reconciliation below. C4 has no register re-classification to land up front (C2's was the `seam` re-class); its coordinator commit is the measured baselines every packet drains FROM, so a packet's exit is a diff against a number this file pins.

## Reconciliation before launch (2026-09-22, on `main` @ `a45fc948b`)

- **Prerequisites.** #2770 and #2778 are merged (C0). Every mission C4 names is still live: M-T9.50 `partial` (config + baseline + ratchet landed, the drain is open), M-T9.56 `open` (gate half landed in C1 1g, the drain is C4's), M-T5.21 `open` (design signed off, [`missions/M-T5.21-callable-unification-design.md`](../missions/M-T5.21-callable-unification-design.md)), M-T9.26 `open` (design [`missions/M-T9.26-route-target-seam-brief.md`](../missions/M-T9.26-route-target-seam-brief.md); unblocked, re-measure post-#2462), M-T5.10 `partial` (the `wireShape` retirement spun off as XL, unminted), M-T5.16 `open`, M-T9.4 `partial`, M-T9.5 `partial`, M-T5.9 `open`, M-T1.13 `open`, M-T9.53 `open`, M-T8.9 `open`, M-T9.32 `partial`. M-T6.18 is `done` (2026-09-10) — the 4e slot is the M-T5.10 measurement, as the plan already says.
- **Baselines measured on this head** (the numbers each packet's exit is diffed against):

| ratchet | file | now |
|---|---|---|
| `test/` typecheck errors / files (M-T9.50) | `test-typecheck-baseline.json` via `node scripts/test-typecheck.mjs` | **469 / 181** (largest: `render-expr-kinds.test.ts` ×15 on typescript, ×12 on python; `api-binding-validation`, `stmt-rows`, `deployable-realization-axes`, `slice0-shell` ×12) |
| uncoded validator sites (M-T9.56) | `test/system/diagnostic-uncoded-baseline.ts` (per-file exact counts, shrink-only, a row at 0 is deleted) | **128 across 12 files** (`deployable.ts` 24, `statements.ts` 22, `ui.ts` 21, `types.ts` 15, `match.ts` 12, `datasource.ts` 9, …) |
| `UNDOCUMENTED_CODES` length | `test/system/diagnostic-docs-anchors.test.ts` | **365** |
| `MAX_OPEN_GAPS` / `LATENT_SEAMS` (not C4's, pinned for drift) | `test/system/unsupported-register.test.ts` | 16 / 27 |

- **Open PRs on the fences, cited not duplicated** (`list_pull_requests`, state open, drafts included, 2026-09-22 03:40Z): the validator fence (4c) is touched by #2871 (page-gate diagnostics: `ui-checks`, `ui-page-structure-checks`), #2874 (read-path validators), #2949 (`loom.unknown-primitive-member`), #2942 (page emitter fails open), #2945 (`currentUser` in criteria), #2982 (`id` as a parameter name — a GRAMMAR change, 4d's fence), #2983/#2981/#2966/#2947 (codegen fixes with validator arms). The test fence (4b) is touched by every open PR that adds a test — 4b keeps to typed fixture builders and directory-scoped edits, never a rewrite of a test another PR is changing. 4f's `PreToolUse` hook item touches `.claude/hooks/` (no open PR).
- **Wave 2 follow-through (4a) inputs.** `elixirString` enforcement and the `seed-emit.ts:52` `exStr` duplicate: [`handoffs/wave-1-elixir.md`](handoffs/wave-1-elixir.md) §"Two structural follow-ups"; the seeder contract's readers: [`handoffs/wave-2-seeder-contract.md`](handoffs/wave-2-seeder-contract.md) §"The five readers"; the §F queue rows and the byte-identical corpus re-check: [`wave-2.md`](wave-2.md) and its fold notes.

## Packets

| packet | model | tree fence | rows | state |
|---|---|---|---|---|
| **4b `test/` typecheck drain (M-T9.50)** | Opus | `test/**`, `tsconfig.test.json`, `test-typecheck-baseline.json`, `scripts/test-typecheck.mjs` | 469 → 0 by directory, largest first; typed fixture builders under `test/_helpers/` replace the partial-object-as-full-IR casts (TS2345/TS2322, 66 %); the baseline file deleted in the last commit and the script promoted from ratchet to gate | **launched** (batch 1, `claude/c4-typecheck`) |
| **4c uncoded validator conditions (M-T9.56)** | Opus | `src/language/validators/**`, `src/ir/validate/checks/**`, `src/diagnostics/**`, `test/system/diagnostic-*`, firing fixtures | 128 → 0 in slices by validator file (largest first: `deployable`, `statements`, `ui`, `types`, `match`, `datasource`); each condition gets a catalog code (`messages.ts`), a `code-docs.ts` anchor (or an `UNDOCUMENTED_CODES` row it then lowers) and a firing fixture; the per-file rows deleted at 0 | **launched** (batch 1, `claude/c4-uncoded`) |
| **4a Wave 2 follow-through** | Opus | `src/generator/**` (NO emission change), `test/system/**`, `scripts/**` | byte-identical re-check of the corpus snapshots on the merged `main`; the `elixirString` enforcement lint as a `test/system` scan (plus `elixirRegexBody`, and the `exStr` duplicate deleted); the §F queue rows F2/F3/F5 flipped `done` with evidence; the seeder contract's remaining readers | **launched** (batch 1, `claude/c4-wave2`) |
| **4d callable unification (M-T5.21) + `RouteTarget` (M-T9.26)** | Opus | `src/language/ddd.langium` + `src/language/generated/**`, `src/language/validators/**` (the `CALLABLE_SITES` legality validator only), `src/ir/lower/**`, `src/language/print/**`, `src/generator/_route/` (if built) | M-T5.21 per the signed-off design: one `Callable` production + `CALLABLE_SITES`, byte-identical across all eleven targets; M-T9.26 re-measured post-#2462 on the merged tree — build slice 1 or decline with the measurement, closing the mission either way | batch 2 — launches when a batch-1 packet hands off |
| **4e M-T5.10 `wireShape` retirement — measure, then build or decline** | Opus | `src/ir/enrich/**`, `src/generator/**` (measurement only unless built) | what retirement touches on the merged tree (179 refs / 49+45 files at the spin-off); slice 1 or a decline with the measurement; the XL minted as its own mission or closed | batch 2 |
| **4f compiler and repo hygiene** | Opus | per row | M-T5.16 (a)(b)(c) · M-T9.4 residue (A5 `WorkflowIR` facade, A7.4 embed seam, B23, C-mediums) · M-T9.5 (React `stacks/` → `src/platform/react/v{N}/`) · M-T5.9 `with`/`implements` split + codemod · M-T1.13 menu reform · M-T9.53 NUL bytes + the repo-wide check · M-T8.9 static-analysis breadth · M-T9.32 next-free-id check across open branches · the `PreToolUse` push hook running `npx tsc -b` + the test typecheck on the merged tree (improvement-waves 4.1) | batch 2 |

**Byte-identical gate.** Every 4a/4d/4e/4f refactor diffs the corpus snapshots before and after on the folded tree and states the result in its note (the plan's C4 addendum); a non-identical diff is either justified line by line or reverted.

**Exit** (plan): baseline files 0; uncoded conditions 0; M-T5.21 `done`; M-T9.26 `done` or `declined`; no `G*-C` "same defect, next backend" row in the next review.

## Fold notes

*(none yet)*

# Wave C0 — packet 0.4 hand-off: plan hygiene (statuses, ids, counts, the M-FT register)

*Branch `claude/c0-plan-hygiene` (11 commits), folded 2026-09-10. Built on #2849, merged #2856 (the parallel session's seven flips + 20 archive moves — its flips verified correct; the packet's versions won each conflict because they carry the evidence line the README requires) and #2854. Heading multiset after the fold: 252 ids / 252 headings, zero `done` headings in any `T*.md`.*

## Status flips (each verified on the code, not the PR title)

| mission | → | evidence |
|---|---|---|
| M-T5.26 | `done` #2788, archived | `unwrapGuardedIntrinsicReceiver` `lower-expr.ts:504`; `test/ir/guarded-optional-intrinsic.test.ts` |
| M-T5.27 | `done` #2789, archived | `loom.locator-matcher-receiver` `validators/match.ts:151`; consolidation residue → M-T5.28 |
| M-T5.29 | `done` #2833, archived | `loom.multiple-systems` `composition.ts:136`; body corrected (both systems generate in full) |
| M-T6.53 | `done` #2787, archived | `python/api-client.ts:255-267`; `elixir/domain/predicates.ts` `walkExpr` exhaustive |
| M-T1.29 / M-T1.30 | `done` #2830, archived | `walker-core.ts:394` `match` arm; `:1195` `method-call` arm |
| M-T6.52 | `done` #2770, archived | `seed-datasets.ts:181`; `loom.seed-event-sourced-unsupported` gone, `MAX_OPEN_GAPS` 49 |
| M-T9.36 | `done` #2770, archived | `src/generator/_numeric/{codec,target}.ts` + five leaf tables |
| M-T9.35 | `done` #2647, archived | `direct-generate-systems-ratchet.test.ts` + `scripts/direct-caller-census.mjs` |
| **M-T6.18** | `done`, archived | all four gap-#3 repros diagnose through `ddd parse`; each control goes silent |
| M-T9.18 | `done` | `test/macro/{registry-unit,expander-unit}.test.ts` exist |
| M-T9.22 | `partial` | FUZZ-1 slice 2 landed (`pipeline-fuzz-deep.test.ts`, `ddd-model-shrink.ts`) |
| M-T9.55 | `in-flight (#2843)` | |
| **M-T1.28** | **`partial`** (disagrees with #2856's `done`) | F50 reproduces on `main`: `svelte/index.ts:264` emits `toast.svelte.ts` with no importer; `page-shell.ts:326,:669` `dummyCtx` has no `usedStores`, so `$derived(count)` is unbound |
| M-T1.8 | `partial`, body rewritten | the boundary ships on all seven targets (vue `onErrorCaptured` `:632-640`); "vue has none" was stale |
| M-T9.14 / 9.21 / 9.29 | stale "claimed by open PR" drained | #2663 / #2664 / #2512 all merged |
| M-T9.28 / 9.17 / 9.40 | bodies re-derived | |

Residues re-homed: M-T5.27's consolidation → M-T5.28; M-T8.23's L5 + `theme-tokens` waiver → M-T8.3; the five flowbite spacing waivers → M-T1.12.

## Files added

`docs/new-plan/archive/FT-done.md` (one heading per merged `M-FT` id — **18 merged, not 16**: M-FT.7 #2746 and M-FT.10 #2737 carry the id only on the branch name) · `docs/new-plan/missions/field-test-2026-09-register.md` (13 unmerged ids as UNKNOWN-DEFINITION; two carry a quoted hint from a merged sibling) · `scripts/mission-counts.mjs` + `test/system/mission-counts.test.ts` · `scripts/completion-denominators.mjs` + `test/system/completion-denominators.test.ts` (prints §1; the gate-ledger cell count is the one row it cannot compute and prints the command instead) · `docs/generators.md` §"don't do" corrected · `.claude/skills/parity-auditor/references/target-matrix.md` rewritten from the registers.

## Gates

9 files / 723 tests green; lint 0 errors; docs build; test typecheck 182/470 unchanged; `tsc -b` clean. Mutation proofs: mission-counts ×3, completion-denominators ×3, one non-proving mutation recorded in the test header.

## Flagged, out of fence

`ashPhoenix` survives in `.claude/skills/design-pack-author/{SKILL.md,references/pack-anatomy.md}` and `.claude/skills/language-feature-developer/references/pipeline-checklist.md`. Recovery note: never resolve a conflict by line number in a file another process may have moved.

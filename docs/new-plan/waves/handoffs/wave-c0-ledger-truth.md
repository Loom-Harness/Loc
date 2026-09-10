# Wave C0 — packet 0.5 hand-off: ledger truth (Reconciliation 3)

*Branch `claude/c0-ledger-truth`, folded 2026-09-10. Dated section: `docs/audits/targets-completeness-2026-08-30.md` → "Reconciliation 3 — 2026-09-10". Every P1–P3 row re-derived by writing the `.ddd`, running `generate system` per target and reading the emitted output (or running the ratchet that already encodes the claim).*

| bucket | before | after |
|---|---|---|
| open | 153 | **140** |
| P0 / P1 / P2 / P3 | 0 / 7 / 13 / 32 | 0 / **6** / **11** / **34** |
| P4 / P5 | 89 / 12 | **80** / **9** |
| done | 140 | **148** |
| declined (new bucket) | — | **6** |

P1–P3 (52 rows): **49 reproduce · 1 fixed · 1 honest-gated · 1 split**; nine reproduce on fewer targets than the row named. Notable: `G2644-M-T6.48-numeric-ingress` → done (#2821, closed by running `numeric-ingress-parity.test.ts`); `G2646-open-projection-on-event-no-channel` → honest-gated (`loom.projection-event-uncarried`, #2705; premise stale — folds on *no* backend; P2 → P3); `M-T3.8-sensitivity-phases-2-4` split (diagnostic half done, `M-T3.8-sensitivity-wire-masking` is the surviving P3 row); `static-subpath-405-node-only` retitled (only elixir remains: `delete "/articles/:id"` swallows `/by_owner` → 422); `M-T5.14-reading-service-readport-not-threaded` sharpened (python emits an infinitely self-recursive `is_free`; elixir calls a never-emitted module); `queryview-lambda-int-plus-literal-concat` is worse than recorded (build breaks on feliz/flutter); `F2-CB-C1-paged-nonrelational` now dotnet + python only (elixir fixed); `F2-CFE-1` flutter only; `F2-XB-4` four backends (node fixed).

P4/P5 (101 rows): 89 kept open with corrections, 6 done, 6 declined (each with a >40-char reason and a `declinedBy`; `test/system/ledger-counts.test.ts` enforces both, mutation-proved). `register-site-pointers-stale` re-measured 4 of 60, not 36 of 46. `G2667-C9-packaging-tests-worktrees` reproduced empirically for the first time (4 of 17 packaging suites fail inside a worktree).

**Lesson carried forward:** when a gate already encodes the row's claim, run the gate — it was the cheapest strong evidence every time.

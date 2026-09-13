# Wave C0 — land, stabilise, and true the ledgers (coordinator log)

*Plan: [`../completion-waves-2026-09.md`](../completion-waves-2026-09.md) §4 Wave C0. Base: `main` @ `54750de` (#2849, the plan, merged 2026-09-10 17:5xZ). One PR for the wave (`claude/loom-review-planning-adz0n4`, the same branch the plan landed from, restarted from `main` per the merged-PR rule); packets work on local `claude/c0-<packet>` branches in isolated worktrees and are folded here by the coordinator. This file is the claim: any agent reading the PR list sees every packet, row and tree fence below. Hand-off notes are under [`handoffs/`](handoffs/).*

## Status: **all eight packets folded — ready for review** (2026-09-10)

## Packets

| packet | model | tree fence | rows | state |
|---|---|---|---|---|
| 0.1 merge order | coordinator | — | #2848 → #2843 → #2778 (#2770 and #2846 merged on their own; #2849 merged) | #2848 merged; #2843 base-updated + auto-merge; #2778 rebased by its author, awaiting green |
| 0.2a schemathesis | Opus | `test/behavioral/schemathesis-*`, waivers, its workflow, `src/generator/java/emit/{validator,wire,workflow,openapi-customizer}.ts` | #2579 0/20 root cause; elixir cell binding | **folded** — [`handoffs/wave-c0-schemathesis.md`](handoffs/wave-c0-schemathesis.md); red was java alone (F31/F32/F33), W11/W12 deleted with the fix; elixir inventoried, not yet binding |
| 0.2b frontend-fullstack | Opus | `test/behavioral/run-ui*`, `_frontend/e2e*`, its workflow | #2636 0/20 root cause; §111 error surfacing | **folded** — [`handoffs/wave-c0-frontend-fullstack.md`](handoffs/wave-c0-frontend-fullstack.md); cause A was #2674 (already on `main`), cause B npm's optional-dep hole (harness heal) |
| 0.2c+d playground + conformance | Opus | `web/e2e/**`, `test/conformance/**`, the two workflows | #2844 residue after #2848; Conformance full red 09-07 → 09-10 | **folded** — [`handoffs/wave-c0-playground-conformance.md`](handoffs/wave-c0-playground-conformance.md); neither was flake; c7 (browser-mode pino envelope on hono) handed to C1 |
| 0.2e behavioral-java timeout | Opus | java behavioral harness + workflow | the 20-min cap: measure, fix the dominant cost | **folded** — [`handoffs/wave-c0-behavioral-java.md`](handoffs/wave-c0-behavioral-java.md); stacked on #2855 (carried here until it merges); Gradle daemon ~4× per case |
| 0.3 pr-gate mechanism | Opus | `pr-gate.yml`, `scripts/pr-gate.mjs`, its test, `docs/ci-gating.md` | M-T9.57 | **folded** — [`handoffs/wave-c0-pr-gate.md`](handoffs/wave-c0-pr-gate.md). #2859 (the opposite reading: branch-filtered counts are an artifact, parks are latency with no diagnosed cause) merged to `main` on 09-10 while this PR sat in the queue; the fold composes the two — main's measurement trap, lever table, queue probe and cancel ratio are kept, the packet's unfiltered census and the bounded tail watch are kept, and every doc/comment that said one reading was settled now carries both with the owner's ruling pending (`M-T9.57`, `docs/ci-gating.md`, `pr-gate.yml`, `scripts/pr-gate.mjs`) |
| 0.4 plan hygiene | Opus | `docs/new-plan/**`, `docs/generators.md`, parity-auditor matrix | rows (i)–(viii) + M-T6.18 flip + `scripts/completion-denominators.mjs` | **folded** — [`handoffs/wave-c0-plan-hygiene.md`](handoffs/wave-c0-plan-hygiene.md); carries #2856's moves with evidence lines; one disagreement (M-T1.28 stays `partial`) |
| 0.5 ledger truth | Opus | the ledger, `scripts/ledger-counts.mjs`, its test | P1–P3 by running, P4/P5 by reading, `declined` bucket | **folded** — [`handoffs/wave-c0-ledger-truth.md`](handoffs/wave-c0-ledger-truth.md) |
| 0.6 decisions batch | Opus | `docs/decisions.md`, status lines | the fifteen rulings (moved from C5 per the #2849 review) | **folded** — [`handoffs/wave-c0-decisions.md`](handoffs/wave-c0-decisions.md); owner sign-off on #2 and #4 pending |

## Fold protocol

1. Packet hands over its local branch + a note (row table: fixed / gated / handed-off / already-done-verified; the mutation-proof assertion per fix; local gate results).
2. Coordinator merges the branch, runs `npx tsc -b`, `node scripts/test-typecheck.mjs`, `npm run lint`, the packet's suites and `npm test` on the folded tree **after** merging `origin/main`, appends the note under `handoffs/`, and pushes — at most once a day.
3. Rebase only on a real `merge-tree` conflict. Flip to ready once, when the whole wave is green locally.

## Amendments to the plan folded in this wave

The ten amendments from the #2849 review (`7978b06`): M-T5.22 as the fourth coordinated moment; the 40-digit-money 500 as a C1 defect; M-T6.18 gap 3 closed; the decisions batch as packet 0.6; the 3-day time-box on 0.2; C0.5's scope; §1 as a script in 0.4; C2 as one PR per target tree; the `NON_PARSING_SOURCES` row; the done-claim vs C6 split.

## Collisions with parallel sessions (2026-09-10 18:00Z)

Seven PRs opened outside the wave protocol while C0 ran: #2859 (claim-only draft duplicating the folded 0.3 — told so), #2856 (0.4's rows i–iv — merged into 0.4), #2855 (0.2e's measurement — 0.2e builds on it), #2858 (install diagnosability, complementary to 0.2b), #2857 (M-T6.54 + M-T6.61 — C1 1b/1f rows), #2860 (M-T1.31 — C1 1d), #2854 (docs). The wave stays the claim unit; per-mission PRs from other sessions are folded by reference, not re-done.

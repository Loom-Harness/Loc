# u-commons2 — delta audit of origin/claude/loom-dsl-evaluation-bxc2c6 (eval/) vs origin/main d2a0bc02

## Result: the register delta is EMPTY
- Branch commits: ab31b1b2c (Commons eval), bdfe28c64 (second pass, closes java/elixir/feliz/flutter "unverified").
- eval/FINDINGS.md, EVALUATION-REPORT.md, EVAL-LOG.md, .gitignore and all 11 eval/repro/F0xx*.ddd are BYTE-IDENTICAL on main
  (landed via b60fe2a58 "audit: Commons dev-experience — 22 findings", PR #2922, incl. the "Second pass" sections: FINDINGS.md:894, :1000; EVAL-LOG.md:81; EVALUATION-REPORT.md:100,141).
- Every finding id (F-001..F-022 + VERIFIED-GOOD) is therefore on main; true-status verification belongs to the main-copy auditor.
- No PR was ever opened from this branch (GitHub search head:claude/loom-dsl-evaluation-bxc2c6 → 0).
- Two-dot "deletions" (eval/fieldops-audit, eval/matrix, eval/evidence, ...) are main-side content newer than the branch, not branch content.

## What IS only on the branch: 35 scenario/probe sources (b60fe2a58 deliberately shipped "register + repros only")
| file group | referenced from main's register | parses on main today | notes |
|---|---|---|---|
| eval/phase0/readme-quick{,-fixed}.ddd | FINDINGS.md:20-23,144 (F-001, F-003) | exit 1, loom.e2e-unrouted-verb | the new gate IS the F-003 fix (e78f3bcc5 / #2922) — confirms F-003 closed as HONEST |
| eval/commons/s1..s6, breadth, commons-elixir | EVALUATION-REPORT.md:7,96; FINDINGS.md:294 (F-006), :952 (F-021); EVAL-LOG.md:33 | s1,s2,commons-elixir exit 0; s3,s4,s5,s6,breadth exit 1 (loom.workflow-foreach-source, loom.reactor-without-starter, loom.default-deny-by-id-ungated, loom.audit-history-ungated) | rotted: newer gates (the F-013/F-021 + F-006 fixes) now reject the scenario as written |
| eval/probe/*.ddd (10) | FINDINGS.md:94 (F-002), :515 (F-012); EVAL-LOG.md:38 | 5 pass; feed-a (projection-where-not-queryable), search (find-where-not-queryable), visibility2 (criterion-not-selectable), fanout, rowlevel (type error: Member id == string), searchstore (replica vs meilisearch) fail | probes for HONEST gaps; only on-disk evidence for F-002/F-012 |
| eval/evo/{v1,v2,mv1,mv2}.ddd | FINDINGS.md:415 (F-009) | all exit 0 | only repro for F-009 (context move drops table); none in eval/repro/ |
| eval/adversarial/01..10 | FINDINGS.md:606 (F-014) | all exit 1 as intended (09 → loom.duplicate-host-port) | negative corpus |
| eval/wire/wire.ddd | none | exit 0 | cross-backend wire probe |

## Top problems
1. Main's register has ~14 dangling path references (eval/commons/*, eval/probe/*, eval/evo/mv1.ddd, eval/adversarial/05-*, eval/phase0/readme-quick*.ddd) to files that exist only on this unmerged branch — WRONG-CLAIM-ish doc defect: the repro steps in F-001/F-002/F-003/F-006/F-009/F-012/F-014/F-021 cannot be followed from main.
2. F-009 and F-012 (HONEST gaps) have NO repro on main at all; their only evidence is branch-only (evo/, probe/).
3. The Commons scenario itself (s3–s6, breadth) no longer parses on main — expected (gates added by fixes), but means porting needs a refresh, not a copy.
4. Nothing FIX-PLAN-like exists on this branch; no partial-backend fix claims in the delta.

## Recommendation
Do not merge the branch (it would also delete main's eval/fieldops-audit etc. if taken wholesale). Cherry-pick only eval/evo/*, eval/probe/*, eval/adversarial/*, eval/phase0/readme-quick*.ddd, eval/commons/*.ddd (optionally with a note that s3–s6/breadth predate the foreach/default-deny gates) — or edit main's FINDINGS.md to drop the dangling paths.

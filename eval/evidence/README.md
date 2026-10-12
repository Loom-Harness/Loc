# Evidence kept out of the generated trees

The per-target generated trees (5 backends x 6 frontends x 4 React packs) were ~54 MB and are
reproducible in one command each, so they are not committed. Regenerate any of them with:

    node bin/cli.js generate system eval/matrix/<target>.ddd -o <outdir>

`eval/matrix/*.ddd` are the exact per-target model variants used for the matrix in
EVALUATION-REPORT.md §4.

**Finding numbers below are the FieldOps register's**
([`../fieldops-audit/FINDINGS.md`](../fieldops-audit/FINDINGS.md)), not the Commons register in
[`../FINDINGS.md`](../FINDINGS.md), which reuses the same `F-0nn` ids for different findings
(there, F-020 is the Java `Objects` import). Clarified 2026-09-29 (eval-closure review G8-09c).

What is kept here:
- `migrations-node/` — the derived migration chain from the Phase 5 evolution run (additive,
  rename-of-a-populated-column, nullable flip, declarative backfill).
- `docker-compose.node.yml` — the generated compose file (see F-020: `minio/minio:latest`).
- `F-035-dotnet-AuditableInterceptor.cs` — the dropped `onCreate` stamp. (A `F-035-java-Thing.java`
  was listed here but never committed; F-035's Java half was withdrawn as an unsound inference —
  see the FieldOps register's F-035 correction.)
- `wire-node.txt` / `wire-python.txt` / `wire-dotnet.txt` + `wire-diff-node-vs-python.txt` —
  the cross-backend runtime probe output behind claim 10 / F-034.
- `wireprobe.sh` — the probe script itself.

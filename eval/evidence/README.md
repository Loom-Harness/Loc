# Evidence kept out of the generated trees

The per-target generated trees (5 backends x 6 frontends x 4 React packs) were ~54 MB and are
reproducible in one command each, so they are not committed. Regenerate any of them with:

    node bin/cli.js generate system eval/matrix/<target>.ddd -o <outdir>

`eval/matrix/*.ddd` are the exact per-target model variants used for the matrix in
EVALUATION-REPORT.md §4.

What is kept here:
- `migrations-node/` — the derived migration chain from the Phase 5 evolution run (additive,
  rename-of-a-populated-column, nullable flip, declarative backfill).
- `docker-compose.node.yml` — the generated compose file (see F-020: `minio/minio:latest`).
- `F-035-dotnet-AuditableInterceptor.cs`, `F-035-java-Thing.java` — the dropped `onCreate` stamp.
- `wire-node.txt` / `wire-python.txt` / `wire-dotnet.txt` + `wire-diff-node-vs-python.txt` —
  the cross-backend runtime probe output behind claim 10 / F-034.
- `wireprobe.sh` — the probe script itself.

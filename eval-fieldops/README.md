# Loom adoption evaluation — evidence tree

| Path | What it is |
|---|---|
| `EVALUATION-REPORT.md` | **the deliverable** — recommendation, claim matrix, target matrix, gap + risk registers, fit, comparison, top-10 fixes, coverage limits |
| `FINDINGS.md` | 22 numbered findings (F-001…F-022) with severity, class, repro steps, exact output, workaround, impact, time lost |
| `EVAL-LOG.md` | chronological working log — every command, error, timing and dead end, phase by phase |
| `fieldops/main.ddd` | the FieldOps model this evaluation is built on (317 lines) |
| `fieldops/slice1.ddd` | the first domain-only slice (parsed clean on the first attempt) |
| `fieldops/mixed.ddd` | 2 backends + 2 frontends in one system (the mixing test) |
| `fieldops/scale.ddd` | the 32-aggregate / 992-line scaling model |
| `repro/*.ddd` | minimal reproductions, one per S1/S2 finding (letters A–N map to findings, see FINDINGS.md) |
| `repro/broken/*.ddd` | the ten deliberately-broken models from the error-quality test |
| `repro/migr/v1.ddd`, `v2.ddd` | the F-018 migration data-corruption reproduction (generate v1, then v2) |
| `out-fieldops/` | one generated tree kept as evidence (node + React), pruned of `node_modules` and build output |

Generated trees for the other ten targets were pruned after measurement; their build commands and
verbatim output are in `EVAL-LOG.md` §Phase 3 and in the individual findings.

## Reproducing the headline results
```bash
npm install && npm run build
node bin/cli.js parse    eval-fieldops/fieldops/main.ddd
node bin/cli.js generate system eval-fieldops/fieldops/main.ddd -o /tmp/fo
cd /tmp/fo/api && npm install && npx tsc --noEmit      # node backend: clean

# the S1s, each self-contained:
node bin/cli.js generate system eval-fieldops/repro/G2-invariant-over-parts-breaks-create.ddd -o /tmp/g2
cd /tmp/g2/api && npm i && npx tsc --noEmit            # F-006
node bin/cli.js generate system eval-fieldops/repro/migr/v1.ddd -o /tmp/m   # then v2.ddd → F-018
```
Note: in a TLS-intercepting environment, copy your proxy CA into each deployable's `certs/` before
`docker compose build` — this is Loom's own documented hook (`docs/tools.md` §"Proxy CAs") and it works.

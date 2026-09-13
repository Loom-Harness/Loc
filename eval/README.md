# Loom — external build-on-it evaluation

A time-boxed spike answering one question for an architecture council: **should we build our next
multi-tenant B2B product on Loom, and under what conditions?**

Everything here was **executed**, not read. Nothing is taken from the vendor's own examples.

| File | What it is |
|---|---|
| **[`EVALUATION-REPORT.md`](EVALUATION-REPORT.md)** | The council document — recommendation, claim-verification matrix, target matrix, gap + risk registers, comparison, top-10 fixes, and an explicit statement of what was *not* covered. **Start here.** |
| [`FINDINGS.md`](FINDINGS.md) | 45 numbered findings with severity, class (SILENT / HONEST / DOCUMENTED / CRASH / CONTRADICTED), exact repro commands and observed output. |
| [`EVAL-LOG.md`](EVAL-LOG.md) | Chronological working log — commands, errors, timings, dead ends. A reviewer can re-run the evaluation from it. |
| [`fieldops/`](fieldops/) | The application I wrote: `main.ddd` (OIDC + in-model e2e), `main-devauth.ddd` (dev-stub auth — the build I ran), `with-notifier.ddd` (cross-deployable channels), `scale.ddd` (40 aggregates), plus the two growth slices. |
| [`repro/`](repro/) | 29 minimal reproductions, one per S1/S2 finding, plus [`repro/broken/`](repro/broken/) — the 10 deliberately-broken models behind the error-quality scorecard. |
| [`matrix/`](matrix/) | The per-target `.ddd` variants used for the 5-backend × 6-frontend matrix. Regenerate any tree with `node bin/cli.js generate system eval/matrix/<t>.ddd -o <dir>`. |
| [`evidence/`](evidence/) | Kept artefacts from the pruned generated trees — the derived migration chain, the cross-backend wire probes and their diff, and the two files behind F-035. |
| [`repatch.sh`](repatch.sh) | The script I had to write because `ddd generate` silently overwrites hand edits (F-037). It is itself a finding. |
| `phase0/` | The `ddd new` starter used for the cold-start timing. |
| `*.png` | Browser evidence — the generated app after an OIDC login, and the playground. |

**Verdict: Pilot on a non-critical project only** (node + React), with five falsifiable conditions
for moving to *Adopt with conditions* — see §1 of the report.

Generated trees (~54 MB across 15 targets) were pruned after measurement; every one is reproducible
from the `.ddd` sources here with a single command.

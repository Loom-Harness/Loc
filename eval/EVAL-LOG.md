# Loom evaluation — running log

Evaluator: senior staff engineer, time-boxed spike.
Question: *Should we build our next product (Commons) on Loom, and under what conditions?*
Start: 2026-09-13T19:55Z. Repo HEAD `bcd25e3e`.

**Disclosure on Rule 5 (blind to internals until Phase 6):** the harness
auto-injected `CLAUDE.md` into my context before I could opt out. I have not
opened `docs/new-plan/`, `docs/old/`, `docs/audits/`, `experience_gathered.md`,
`.claude/` or `test/`, and every finding below is grounded in a command I ran
from outside. Where CLAUDE.md content could have biased me I say so explicitly.

---

## Phase 0 — cold start (README only)

| # | Command | Result | Time lost |
|---|---|---|---|
| 0.1 | `npm install` (runs `prepare` → langium:generate + build) | OK, 28s. Warns `web/node_modules not present`. `npm audit`: 11 vulns (4 high) in the toolchain's own deps. | — |
| 0.2 | `npm run langium:generate` | OK 1.3s. Prints 2 grammar warnings about multiple `=` assignments (`ddd.langium:1824-5`). No drift vs committed output. | — |
| 0.3 | `npm run build` | OK (incremental, 0.3s). | — |
| 0.4 | `node bin/cli.js --help` | OK. Lists 9 commands; README documents only 5. | — |
| 0.5 | Extracted the README Quick Example verbatim → `parse` | `0 error(s), 0 warning(s)` | — |
| 0.6 | `generate system` on it | 226 files in 1.6s, exit 0 | — |
| 0.7 | `docker compose up -d --build` | **FAILED** — Docker Hub 429 (anonymous pull limit). Environment. Fixed with a `mirror.gcr.io` registry mirror in `/etc/docker/daemon.json`. | 20 min |
| 0.8 | rebuild | **FAILED** — `.NET NU1301 … UntrustedRoot`. Environment (sandbox TLS proxy). Loom anticipates this: every deployable ships a `certs/` drop-in, documented in `docs/tools.md`. Dropped the CA in → fixed. | 15 min |
| 0.9 | rebuild | **FAILED** — `error CS0246: 'MoneyResponse' could not be found`. **Loom defect → F-001.** | 35 min |
| 0.10 | rebuild after F-001 workaround (hoist `Money` to model root) | **db + api + api_net + web_app all healthy.** | — |
| 0.11 | Run the generated e2e suite against it | **3 failed / 3** — `POST /api/products → 405`. **F-003.** | 25 min |
| — | **Time to first running app, by an outsider** | **≈95 min**, of which ~35 min was environment (proxy/registry) and ~35 min was F-001. On a clean network with the F-001 workaround known: **≈10 min.** | |

### Phase 1 — modelling Commons
Grown in slices (`eval/commons/s1→s6`), `parse` after each. 320 `.ddd` lines final.
Notable round-trips: `permissions` belongs on the **subdomain** not the context;
`user { a, b }` commas rejected (F-011); `channel { carries: [A] }` brackets
rejected (F-011); field-modifier order is `T access = default` not
`T = default access`; `retrieval { where:, sort: }` commas rejected (F-011).
Probes: `eval/probe/` (feed, notif, fanout, search, visibility, rowlevel, xctx, searchstore).

### Phase 2 — running Commons
Full stack up: api + notifier + web + postgres + redis + **Keycloak** (the
generator emits a dev realm). Minted a real OIDC token via the password grant.
Verified: 401 unauthenticated on every domain route; health/ready open;
`POST /api/members` → 403 `Forbidden: CanRead()`; `mask unless` returns
`email: null`/`phone: null` to a non-admin and the real values to an admin —
**enforced in generated code, not just the model**; list reads open to any
authenticated caller (F-006).

### Phase 3 — breadth
One Commons model → 5 backends × 6 frontends = 1148 files, 0 errors.
Elixir crashes (F-013). Compile results in the report's target matrix.
Wire identity (node vs python, same model, real values): **byte-identical JSON**
— key order, `money` 4-decimal string scaling, enum casing, ISO timestamps,
derived `total`. One divergence at the boundary: `long` = 2^53+1 → node **422**,
python **201**.

### Phase 5 — evolution (the verdict phase)
| Change | Result |
|---|---|
| additive (+2 fields) on a populated DB | `ADD COLUMN … NULL`; `ADD COLUMN … NOT NULL DEFAULT` then `DROP DEFAULT`. Applied, **data preserved**. |
| rename `bio`→`about` on a populated DB | auto-detected → `RENAME COLUMN`. Applied, **data preserved** (`mathematician` survived). |
| ambiguous rename (drop 2 + add 1) | **refused**, names the `migration "…" { Agg.old -> new }` ledger and `--allow-destructive`. Nothing written. |
| drop a populated column | **refused** (destructive gate). |
| optional → required with NULLs present | **refused**; `migration "…" { Member.phone = "" }` ledger → `UPDATE … WHERE IS NULL` then `SET NOT NULL`. Correct order. |
| retype `string`→`int` | **refused** (`alterColumnType`). |
| move an aggregate between contexts | `DROP TABLE c.things`. **No safe spelling exists** (F-009). |
| hand-edit + regenerate | **silently clobbered**. `.loomignore` pins it; a pinned file then goes **permanently stale** with no detector (F-008). |
| scale 5→40 aggregates | 3.9s → 6.6s, flat. 651 `.ddd` lines → 387 files / 56,169 generated lines (86:1). |

### Phase 6 — adversarial + tooling
10 broken models: **9/10** caught with precise, actionable diagnostics
(incl. "did you mean", an `X id` fixit, the macro list, and a duplicate-host-port
check that anticipates `docker compose up` failing). 1 missed → **F-014**.
Tooling: `--dry-run` ✓ · `.loom/` bundle (mermaid, LikeC4, AsyncAPI, wire-spec,
sourcemap, i18n catalog) ✓ · `i18n extract/init/status/check --strict` ✓
(325 keys, `--strict` exits 1) · `patch` ✓ (excellent agent-facing diagnostics)
· traceability + `verify` ✓ but see F-017 · `trace`/`breakpoints` partial (F-018).

---

## Second pass — closing the "unverified" rows

Prompted by the user pointing out there is a playbook for running the targets.
There is: `docs/tools.md` §§472–700 ("Compiling generated backends in Docker",
`LOOM_HEX_MIRROR`, "Java images behind a fingerprinting proxy") and §§912–990
("Compiling generated FRONTENDS locally", "Flutter: analyzing a generated app
locally"). Two sections are titled for exactly the TLS-fingerprinting failure I
hit. I had recorded four targets as "unverified — environment" without looking
for it.

| Target | Recipe used | Result |
|---|---|---|
| **elixir** | `scripts/hex-mirror.py` — loopback TLS mirror re-originating hex.pm with an accepted fingerprint; `--network host --add-host {builds,repo,hex}.hex.pm:127.0.0.1`, `HEX_CACERTS_PATH` | `mix deps.get && MIX_ENV=prod mix compile --warnings-as-errors` → **EXIT=0** on the full Commons domain (F-013 workflow removed) |
| **java** | `docker run --network host … -e JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS" gradle:9-jdk25 gradle --no-daemon testClasses bootJar` — the piece my compose build lacked was passing the host's proxy JVM opts in | deps resolved; **10 real compile errors in generated code** → F-020, F-021 |
| **flutter** | `ghcr.io/cirruslabs/flutter:stable`, `flutter pub get && flutter analyze` with `CURL_CA_BUNDLE` + proxy env | **0 errors, 0 warnings**, 153 `info` lints |
| **feliz** | docs say it "stays CI's to answer" (no .NET SDK on the host). Worked around: `mcr.microsoft.com/dotnet/sdk:8.0` + a Node **tar.gz** (the image has no `xz`), then `dotnet tool restore && npm install && npm run build` | fails on Commons (**F-022**); rename one field → **`✓ built in 4.40s`, 894 kB bundle, EXIT=0** |

Also re-ran `generate` for the whole breadth model after `npx tsc -b`:
`Wrote 0 file(s), unchanged: 1141` — the rebuilt toolchain emits byte-identical
output, so the first pass's generated trees were not stale.

**Net effect on the evaluation:** 4 unverified → 0. Two were passes I had
written off (elixir, flutter); two were failures I had excused (java, feliz),
yielding three new S1 defects (F-020, F-021, F-022). SILENT count 9 → 12;
HONEST unchanged at 4.

**Lesson for the method, recorded against myself:** an "unverified" row is not
neutral. Mine hid two passes and two failures in equal measure. Search the
vendor's docs for a recipe before recording an environment blocker — especially
when the vendor ships one named for your exact failure.

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

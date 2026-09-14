# Clinica / Loom evaluation — working log

All timestamps UTC. Repo HEAD at start: bcd25e3e (2026-09-13).
Evaluator: senior staff eng, outsider persona. Environment: Linux 6.18, Node v22.22.2, npm 10.9.7, 4 cores.

Note on rule 5 (blindness to maintainer-internal material): the harness injected
`CLAUDE.md` into my context automatically before I could opt out. I did not read
`docs/new-plan/`, `docs/old/`, `docs/audits/`, `experience_gathered.md`, `.claude/`,
`IMPL-NOTES.md` or `test/` during Phases 0-6, and every finding below is reproduced
from outside via the CLI + generated output. Where CLAUDE.md could have told me an
answer, I still reproduced it. Flagged again in the report's coverage section.

---
## Phase 0 — cold start

**19:55Z** `npm install` (README step 1, which also runs `prepare` = langium:generate + build).
29.3s, clean. Note: `npm audit` reports **11 vulnerabilities (1 low, 6 moderate, 4 high)** in
the *toolchain's own* deps at HEAD. README says "Requires Node 20+"; ran on Node 22.22.2.
Langium codegen printed 2 warnings about `ddd.langium:1824-1825` multiple `=` assignments —
noise on a clean install, would worry a first-time user.

**19:55Z** `node bin/cli.js --help` — works. Note the help text for `patch`, `trace` and
`breakpoints` points users at `docs/old/proposals/...`, which the README itself describes as
"the archived design corpus — frozen proposals... not deployed to the docs site". The CLI's
own help routes users to docs the project calls non-authoritative. (F-001, S3)

**19:55Z** `ddd new hello --platform node --template crud` → 1.4s, 4 files.
The starter `main.ddd` is unusually candid: its header comment documents, unprompted, that
under `enforcement: denyByDefault` the synthesised **GET /{plural}/{id}** read "has no author
surface to attach a gate to, so ... it still serves to any authenticated caller, and nothing
warns", and that `with crudish` create/update/destroy "cannot carry a gate today".
That is a real security-relevant limitation disclosed in the template. Verified in Phase 6.

**19:56Z** `ddd generate system main.ddd -o .` → **1.4s, 83 files** from a 90-line model.
Tree: `api/` (Hono+drizzle), `web_app/` (React+Mantine), `db-init/`, `docker-compose.yml`,
`docker-compose.obs.yml`, `monitoring/`, `LICENSE` (MIT, as README claims).
Generated deps are current (React 19.2, Vite 8, TS 6, zod 4, hono 4.12, postgres:18-alpine).

**19:57Z** `docker compose up -d --build` started. (timing below)

**20:38Z — Phase 2 headline: the full generated Clinica stack boots under `docker compose up -d --build`.**
Four services healthy: `api` (Hono), `db` (postgres:18-alpine), `staff_web` (React/Mantine, 200 on :3001),
`keycloak` (realm auto-imported). Build wall-clock ~22 min in this sandbox, dominated by two `npm install`s
through a MITM proxy; the generated Dockerfile's `certs/` hook is what made it work at all — dropping the
proxy CA into `api/certs/` + `staff_web/certs/` was the entire fix, and the Dockerfile documents that hook
in a comment. (First attempt without the CA failed after 24 min with
`npm error ... self-signed certificate in certificate chain`.)

Also recorded before this: the same API run directly on the host against a dockerised Postgres —
`npm install` 34s, `tsc --noEmit` clean, boot + migrate + `/ready` 200 in ~12s.

## Phase 3 — breadth: what I actually ran

Every cell below was executed in this session. "generates" = `ddd generate system` exit 0;
"compiles" = the target's real compiler, in the version the generated project pins.

### Backends (same Clinica model, only `platform:` changed)

| Backend | generates | compiles | how it was run | blockers |
|---|---|---|---|---|
| node (Hono) | ✅ 141→373 files | ✅ `npx tsc --noEmit` clean | host, node 22 | needed F-004 + F-016 worked around first |
| dotnet | ✅ 321 files | ✅ `dotnet build` **succeeded, 0 warnings** | `mcr.microsoft.com/dotnet/sdk:10.0` | **F-013** (`state` field) — 4 errors until renamed; `-warnaserror` still fails on **F-019** |
| java | ✅ 261 files | ✅ `gradle testClasses` **BUILD SUCCESSFUL** | `gradle:9-jdk25` | **F-014** — 1 missing import, patched by hand |
| python | ✅ 157 files | ⚠️ `python -m compileall` clean on 3.13 | `python:3.13-slim` | full `uv sync` + mypy **not run** (sandbox proxy) — marked unverified |
| elixir | ✅ 247 files | ⚠️ `mix compile` OK; `--warnings-as-errors` **fails** | `elixir:1.18-alpine` | **F-015** (5 warnings, all from datetime params) |

### Frontends (same model; design pack swapped where the framework demanded it)

| Frontend | generates | builds | how |
|---|---|---|---|
| react (mantine) | ✅ | ✅ `tsc --noEmit && vite build` | host |
| vue (vuetify) | ✅ | ✅ `vue-tsc && vite build` | host — twice (staff UI and the separate patient portal) |
| svelte (shadcnSvelte) | ✅ | ✅ `svelte-check && vite build` | host |
| angular (angularMaterial) | ✅ | ❌ **`ng build` fails** | `node:24-bookworm-slim` — **F-022**, a `string[]` field |
| feliz (F#/Fable) | ✅ 98 files | ⛔ **not built** — no `dotnet fable` toolchain set up here | marked unverified |
| flutter (Dart) | ✅ 119 files | ⛔ **not built** — no Flutter SDK here | marked unverified |

### Mixes actually generated and run
- **one backend, two frontends on different frameworks**: `api` (node) serving both
  `staff_web` (react/mantine) and `portal_web` (vue/vuetify) — both built, both wired to
  `http://api:3000`. This is the Clinica brief's "patient portal on a *different* framework
  off the same backend". ✅
- **two backends in one system**: `api` (node) + `notifier` (node) sharing a redis channel —
  compose wires `LOOM_CHANNEL_APPT_BUS_URL` into both. ✅ generated; notifier `tsc` clean.
- design packs exercised: mantine, vuetify, shadcnSvelte, angularMaterial (4 of 13), plus
  the honest refusal when a pack and framework mismatch.

## Phase 5 — scaling (synthetic models, `eval-clinica/tools/gen-scale.py`)

| aggregates | .ddd lines | parse | generate | files | generated lines | ratio |
|---|---|---|---|---|---|---|
| 8 | 160 | 3.1s | 2.2s | 133 | 12,903 | 80x |
| 20 | 364 | 3.1s | 3.3s | 229 | 28,611 | 78x |
| 40 | 704 | 5.5s | 5.9s | 389 | 54,791 | 77x |

Generated-project `tsc --noEmit` at 40 aggregates: **12.3s**. No cliff at this size;
cost is linear and the amplification ratio is flat at ~78x.
Real Clinica model: **444 lines .ddd → 42,402 lines across 373 files (95x)**.

## Phase 2 — running it for real (host + compose)

- **20:25Z** Generated Clinica api run on the host against a dockerised Postgres, with a
  local OIDC issuer I wrote (`eval-clinica/tools/idp.mjs`, ~40 lines over the generated project's
  own `jose`) so I could mint tokens with exact claims. `npm install` 34s · `tsc --noEmit`
  clean · boot + migrate + `/ready` 200 in ~12s · 11 tables created in schema `clinics`.
- Round-trip verified by value, not status code: camelCase keys, enum as string,
  `endsAt` derived correctly (09:00 + 30min → 09:30), `money` as `"85.5000"` string,
  timestamps ISO-Z, `cancelReason: null`, `tenantId`/`dataKey` correctly absent from the wire.
- Error shapes, all RFC 7807, all executed: `when`-gate → **409 Disallowed**;
  `precondition` → **422** with the authored message; invariant → **422** with
  `{"pointer":"/durationMinutes","message":"Duration Minutes must be at least 1"}`;
  dangling FK → **422** "references a record that does not exist"; delete with children →
  **409** "still referenced"; bad enum → 422 listing the valid options; unauthenticated → 401.
- Auth/tenancy attack results: see FINDINGS F-021 (all passed) and F-020 (`aud` unchecked).
- **20:38Z** `docker compose up -d --build` — 4/4 services healthy, staff_web serving on
  :3001 (HTML + hashed assets 200). Build wall-clock ~22 min, dominated by two `npm install`s
  through this sandbox's MITM proxy; the generated Dockerfile's `certs/` hook was the fix.
- **20:59Z** The DSL-declared `test e2e` block, run as generated vitest against the live
  API: **1 passed**. Full chain model → generated test → HTTP → Postgres → assertion.
  (Note: the generated `e2e/` project ships no `vitest.config.ts`, so run from inside a
  repo that has one, vitest walks up and picks up the wrong config. Ran it from `/tmp`.)

## Phase 6 — adversarial DX

Ten deliberately-broken `.ddd` files in `eval-clinica/repro/errors/`. Verdicts:

| Case | Diagnostic | Quality |
|---|---|---|
| unknown field in a `derived` | `Unknown name 'nmae' — did you mean 'name'?` | **excellent** |
| wrong arity | `Function 'f' expects 1 argument, got 2.` | excellent |
| bare cross-aggregate ref | `References across aggregate boundaries need an id link — write 'B id'` | excellent, with fixit |
| duplicate field | names the rule *and why* (one field of the wire shape) | excellent |
| page primitive bad arg | a paragraph explaining that the content is silently dropped from every frontend and never reaches the catalog | **outstanding** |
| unknown intrinsic | lists all 9 valid string intrinsics | excellent |
| bad create-input field | lists every valid create input | excellent |
| unknown enum value | generic "no parameter, local, field, enum value…" | adequate |
| **typo'd primitive type** | `Could not resolve reference to NamedDecl named 'strng'` | **poor** — compiler-internal jargon, no "did you mean", though the same facility exists for field names (F-003) |
| **soft keyword in expression position** | `Unexpected 'from'. Expected one of: '!', '-', 'retrieval', '{', '(' (+111 more).` | **poor** — raw Chevrotain dump (F-005) |
| **self-recursive entity part** | `0 error(s)` then `RangeError: Maximum call stack size exceeded` | **crash where a diagnostic belongs** (F-018) |
| **`Repo.run(<Retrieval>)` in a paged handler** | `0 error(s)` then `Error: internal: … Please file a bug` + Node stack | **crash** (F-009) |

Debuggability: `--sourcemap` + `ddd breakpoints --line N --map …` resolved a statement line
to `api/domain/appointment.ts:67`, which is exactly the emitted assignment — precise.
Declaration-header lines resolve only to `file:1`. `ddd trace` annotated 3 of 3 stack frames
with the `.ddd` construct and line. A developer could realistically debug this.

AI-authoring surface: the MCP server handshakes and returns a tool catalog; `loom_validate`
on a typo returned a coded diagnostic with a **machine-applicable `fixHint` patch**
(`{"op":"replace","target":"aggregate C.A.up","source":"derived up: string = name"}`).
`ddd patch` applied two node-addressed patches correctly and printed to stdout without
touching the file.

## Phase 7 — reconciliation and project health

- **Releases: zero.** `list_releases` → `[]`. No tags, no changelog. `package.json` 0.1.0.
  The FSL's Apache-2.0 future grant is keyed to "two years after each release is
  published" — with no releases, that clock has not started.
- **Contributors (shallow-clone window, 2026-09-01 → 09-13, 810 commits):** 1 human
  (135 commits), `Claude` (669), `claude[bot]` (6). ~83% AI-authored. **Bus factor 1.**
  The clone is shallow so this is a window, not the full history (PR numbers reach #2919).
- **Open PRs today** include `#2913 "A plain operation reaching a repository validates
  clean and breaks codegen"` — opened ~1h before I independently reproduced it as F-002 —
  plus #2915, #2916 in the same class, and #2911 "Defects found by building a multi-tenant
  field-service system end to end".
- **The maintainers run this same evaluation on themselves.**
  `docs/audits/targets-completeness-2026-08-30` records **251 open rows, 108 classified
  *silent*, 90 "proven from emitted output"**; the committed ledger still lists **135 open**
  (12 silent). A September fleet audit found "six defects that emit non-compiling or
  crashing code from `.ddd` reporting `0 error(s), 0 warning(s)`" and diagnosed the cause:
  *"five of the six severe defects survived because no corpus fixture exercises the shape."*
- **Overclaiming check.** The ICU work (M-T1.11) was scoped to the **frontends** —
  `docs/new-plan/T1` states plainly that "a backend `derived` stays byte-identical
  (… format dropped)". That is a deliberate internal decision; `docs/language.md` presents
  ICU format suffixes as a general expression feature with a **backend TypeScript example**
  and never says frontend-only. So F-006's dropped format is *known*; the user-facing doc
  overclaims it, and the Python `TypeError` is not covered anywhere.
  Likewise `sensitive()` not reaching the wire is tracked (T3 "Phase 3 wire masking") and
  is surfaced to the user by an unusually honest warning — good practice.
- **Test surface:** 2,107 `.test.ts` files, 67 workflows, ~303k LOC of test (0.91x `src/`).
  README's "1,300+ test files" understates it.
- **License:** FSL-1.1-Apache-2.0 on the generator (source-available, any non-competing
  use), MIT on generated output, with a clear FAQ. Fine for our use; see the release caveat.

## Deliverables

- `eval-clinica/EVALUATION-REPORT.md` — the council document
- `eval-clinica/FINDINGS.md` — 23 entries (21 defects, 2 recorded strengths)
- `eval-clinica/EVAL-LOG.md` — this file
- `eval-clinica/clinica/main.ddd` — the model (444 lines) + `locales/et.json`
- `eval-clinica/repro/*.ddd` — minimal reproductions, one per S1/S2
- `eval-clinica/repro/errors/*.ddd` — the diagnostic-quality battery
- `eval-clinica/tools/` — `idp.mjs` (local OIDC issuer), `gen-scale.py` (scaling models), `tok.sh`
- `eval-clinica/out-*/` — generated trees per target (node tree kept complete; others pruned of
  `node_modules`)

## Note on what is committed here

The generated trees (`eval-clinica/out-*`, ~21 MB across seven targets) are **deliberately not
committed** — they are build output, reproducible in seconds from the models that are.
What is kept:

- `eval-clinica/clinica/main.ddd` (+ `locales/et.json`) — the model everything was generated from
- `eval-clinica/repro/` — a minimal `.ddd` per S1/S2 finding, plus the 10-case diagnostic battery
- `eval-clinica/tools/verify-repros.sh` — re-runs every S1/S2 reproduction in one command
- `eval-clinica/evidence/` — the small artefacts that ARE the evidence and cannot be re-derived
  from a single generate: the seven migration `.sql` files the Phase-5 evolution sequence
  produced in order, the `.loom/snapshots/` baseline they were diffed against, and the
  generated `gaps.md` / `traceability.md` / `verification.md`
- `eval-clinica/hello/` — what `ddd new --template crud` actually writes (4 files)

To rebuild any generated tree:

```bash
node bin/cli.js generate system eval-clinica/clinica/main.ddd -o eval-clinica/out-node          # node
sed 's/platform: node/platform: dotnet/' eval-clinica/clinica/main.ddd > /tmp/c.ddd \
  && node bin/cli.js generate system /tmp/c.ddd -o eval-clinica/out-dotnet              # and so on
bash eval-clinica/tools/verify-repros.sh                                               # all S1/S2 repros
```

# Loom evaluation — working log

Evaluator: senior staff engineer, external. Environment: Linux 6.18, Node v22.22.2, npm 10.9.7.
Repo HEAD at start: 09427a5 (Merge PR #2879).
All times UTC. "T+" is minutes from the cold-start clock (2026-09-13T09:17Z).

## Phase 0 — Cold start

### T+00 — 09:17 setup
Created `eval/`. Started dockerd in background. Read `README.md` (377 lines) only.
Claims captured for the verification matrix (verbatim, README):
- "The speed of no-code. The keys to the codebase."
- "walk away with real, owned source code across five backends ... and six frontends"
- "No vendor lock-in. No scaling cliff. No drift between layers."
- "Thirteen design packs ... swap any time"
- "Pick a runtime per deployable. Switch any time. Identical API contracts"
- "LLM-safe by construction"
- "1,300+ test files / 9,000+ tests"
- "`docker compose up -d` → everything running on ports 3000 / 8080 / 4000 / 3001"

### T+01..T+15 — `ddd new` → `generate system` → `docker compose up`
```
$ node bin/cli.js new fieldops-starter --platform node --template crud -o eval/phase0
Scaffolded 4 file(s) ... (1.9s)
$ node bin/cli.js generate system main.ddd -o .
main.ddd:34:14 warning: repository find 'byProject' is a wire-shaped list query — ...
0 error(s), 1 warning(s).   Wrote 83 file(s) in .   (1.9s)
```
- `ddd new --template crud` emits a model that **warns on its own generated code** (`loom.repository-find-deprecated`). Cosmetic but a bad first impression. → F-001.
- `docker compose up -d --build` ran **14m40s and never finished** — both `npm install` layers were looping on
  `SELF_SIGNED_CERT_IN_CHAIN` (this sandbox MITMs TLS). Confirmed independently:
  `docker run --rm node:24-alpine npm view hono version` → same error.
- **Loom anticipated this.** The generated Dockerfile ships a `certs/` dir + `COPY certs/ /usr/local/share/ca-certificates/`
  and `docs/tools.md:831` "Proxy CAs (sandboxed builds)" documents exactly the fix. Dropped
  `/root/.ccr/ca-bundle.crt` into `api/certs/` + `web_app/certs/` and rebuilt. Environment friction, NOT a Loom gap;
  credit where due. Cost: ~20 min of my clock, 0 min once you know.

### T+15 — Phase 1 slice 1 (core domain, 128 lines .ddd)
```
$ node bin/cli.js parse eval/fieldops/slice1.ddd
0 error(s), 0 warning(s).   (2.9s)
```
Parsed clean **first try**, written only from `docs/language.md`. Customer/Site/Asset/Technician/WorkOrder
+ contained WorkOrderLine, 5 enums, money arithmetic, guarded lifecycle ops, `unique (serial)`,
collection invariant `lines.all(l => l.currency == currency)`, interpolated `derived display`.

### T+18 — **TIME TO FIRST RUNNING APP: 18m17s wall (09:17:49 → 09:36:06)**
Of which ~14m40 was the wasted TLS-blocked build. **Hands-on cost in a normal network: ~4 minutes**
(`npm install` 33s · `ddd new` 1.9s · `generate system` 1.9s · `docker compose up --build` 1m10s).
Verified running, not just "started":
```
GET  /health                       200
GET  /ready                        {"status":"ready"}
POST /api/projects {"name":"Roof survey"}   → {"id":"01a09a1f-a225-758f-afde-6ded4f838fb8"}   (uuidv7)
POST /api/tasks    {...,"project":"<id>"}   → {"id":"01a09a1f-a25b-..."}
GET  /api/projects → {"items":[{... "version":1,"display":"Roof survey"}],"page":1,"pageSize":20,"total":1,"totalPages":1}
GET  /api/tasks    → FK round-tripped correctly
GET  http://localhost:3001/        200 (React SPA shell, hashed bundle)
GET  /openapi.json → 7 paths
```
Migrations applied to an empty DB with no manual step. This is a **real** headline number.

### T+20..T+95 — Phase 1 (modelling FieldOps)
Final model: `eval/fieldops/main.ddd` 594 lines → **189 files / 20,657 lines generated** (~35x).
Split into two files because of F-012: `main.ddd` (e2e tests, no notifier deployable) and
`with-notifier.ddd` (cross-deployable channel eventing, no e2e tests) — both parse clean.
Findings raised in this phase: F-002 … F-012.
Things that worked **first try, from docs alone**: aggregates/entities/containment, enums, money
arithmetic, guarded lifecycle (`when` gates), `unique (…)`, collection invariants, interpolated
`derived display`, `mask unless`, `tenantOwned`/`tenantRegistry`, `permissions{ implies }`,
find `requires` gates, criteria, a grouped projection, traceability decls, api + ui e2e tests,
a hand-written dashboard page with `Chart`/`QueryView`/`Table`/`Money`.
Standout diagnostics (caught real modelling bugs I made naturally):
  - `loom.unique-missing-tenant-scope` — my `unique (serial)` was global across tenants.
  - `loom.audit-history-ungated` — `GET /invoices/{id}/history` reachable by any authenticated caller.
  - `loom.default-deny-ungated` × 21 — every ungated command and read.
  - index suggestions on every column used in a query filter.

### T+95..T+190 — Phase 2 (does the output run?)
**Compile.** `npm install && npx tsc --noEmit` on the generated `api/` and `web/`:
 - api: **4 errors, 3 distinct bugs** → F-013 (missing `ne` import), F-014 (nullable claim in a find),
   F-015 (workflow calls a `private` aggregate function). Fixed with 3 one-line patches.
 - web: **10 errors, 3 distinct bugs** → F-016 (`const void =`), F-017 (`yAxisProps={{{`),
   F-018 (`.items` off a bare array — the deny-by-default interaction), plus F-019 (pages for an
   unserved subdomain). After model-level workarounds, `tsc --noEmit` is clean.
**Boot.** `docker compose up -d --build` → 1m27s. Services: db(pg18) · keycloak(realm-imported) ·
valkey · mailpit · minio · api · web. minio needed F-020's image fix first.
**Round-trip (node backend, dev-stub auth stack `eval/out-devauth`, port 3100).** All values checked:
```
POST /customers → 201;  POST /sites, /assets, /technicians, /work_orders → 201
POST /work_orders/{id}/add_line {"quantity":2,"unitPrice":"50.2500"} → 204
GET  /work_orders/{id} →
  "unitPrice":"50.2500"  "subtotal":"100.5000"  "total":"100.5000"      ← money exact, string wire
  "status":"Draft" "priority":"Normal"                                   ← enums as strings
  "assetId": <uuid>  "technicianId": null  "scheduledAt": null           ← nullability correct
  "createdBy":"u-a" "updatedBy":"u-a" "version":2                        ← audit + optimistic version
  "lines":[{…}]  "display":"WO Draft for …"  "isOpen":true               ← containment + derived
  (no tenantId on the wire)
POST /workflows/schedule_work_order → 204                                ← cross-aggregate skill rule
```
**Error shapes** — all RFC 7807 `application/problem+json`:
```
invariant violation           → 422  + {"errors":[{"pointer":"/billingEmail","message":"…"}]}
`when` state gate (start x2)  → 409
`requires` gate (low perms)   → 403
unauthenticated               → 401
```
**Transactional stock decrement (the hard requirement).** Part stock 3, usages 2 + 5:
```
POST /workflows/complete_work_order → 422 {"detail":"insufficient stock"}
GET  /parts/{id}      → stockOnHand = 3      ← the 2-unit decrement rolled back
GET  /work_orders/{id}→ status = InProgress  ← not completed
```
**Tenant isolation (the S1 question) — HOLDS on node:**
```
A lists work orders            → total 1
B lists work orders            → total 0
B GET  /work_orders/{A's id}   → 404
B POST /work_orders/{A's}/cancel → 404
B GET  /work_orders/{A's}/history→ 404
tenantId="" / claim absent     → empty list (fail-closed)
tenantId="' OR '1'='1"         → 0 rows (parameterised; no injection)
```
**Optimistic concurrency**: works via `If-Match` (204 then 409) but is **off by default and the
generated React client never sends it** → F-023.
**UI**: renders, nav + custom dashboard page, calls the API. OIDC login flow BROKEN out of the box
(F-024); after two hand fixes the browser login completes and lands in the app
(`eval/ui-logged-in.png`).
**Generated e2e suite**: 3/3 PASS against the running stack (after I fixed my own three test bugs).
Not idempotent — a re-run fails on a `unique` constraint (no fixture isolation / teardown).
**`ddd verify`**: works; needs a hand-written adapter from the runner's JSON (documented). Rollup,
`.loom/verification.{json,md,mmd}`, and exit code 1 on a failing requirement all behave as documented.
**Regeneration clobbered every hand patch silently** (see Phase 5 / F-025).

### T+190..T+300 — Phase 3 (breadth)
Method: ONE model (`eval/fieldops/main-devauth.ddd`, 594 lines) regenerated per target by changing
`platform:` (+ `framework:`/`design:` where the validator demanded it), then compiled with the real
toolchain in docker, then (where booted) driven with one identical HTTP probe script.

**Backends** — all five GENERATE from the same model with 0 errors.
| backend | generates | compiles | patches needed to compile | boots | wire-probed |
|---|---|---|---|---|---|
| node (Hono)   | ✅ 178 files | ❌→✅ | 3 (F-013,F-014,F-015) | ✅ | ✅ reference |
| dotnet        | ✅ 401 files | ❌→✅ | 2 (F-025,F-015)       | ✅ | ❌ **every create 500s** (F-035) |
| python        | ✅ 189 files | ⚠ compiles+imports; **mypy** finds 3 | 2 (F-026,F-027) | ✅ | ✅ 2 diffs (F-034) |
| java          | ✅ 317 files | ❌→✅ | 3 (F-028,F-015 ×2)    | not booted | — |
| elixir        | ✅ 284 files | ❌→✅ (fails `--warnings-as-errors`, F-030) | 1 (F-029) | not booted | — |
**0 of 5 backends compiled the same model without hand patches.**

**Frontends** — `tsc`/native build on the generated project:
| frontend | generates | builds |
|---|---|---|
| react (mantine/shadcn/mui/chakra) | ✅ | ✅ **0 tsc errors, all four packs** |
| svelte (shadcnSvelte) | ✅ | ✅ `npm run build` 0 errors 0 warnings |
| vue (vuetify)   | ✅ | ❌ `vue-tsc` fails on a nullable `X id` (F-032) |
| angular (angularMaterial) | ✅ | ❌ `ng build` fails on a `string[]` field (F-033) |
| feliz   | ✅ 118 files | **unverified** (no .NET/Fable frontend toolchain run) |
| flutter | ✅ 142 files | **unverified** (no Flutter SDK in this environment) |

**Design packs**: 4 React packs generated and typechecked clean; vuetify / shadcnSvelte /
angularMaterial generated. The pack↔framework validator is excellent (names the legal packs), except
the Feliz one whose suggestion doesn't parse (F-031).

**"Pick a runtime per deployable, switch any time"**: switching react→vue/svelte/angular is 1 line
(`platform:`) if you keep the react ui as a served bundle, 3 lines (`platform:`+`framework:`+`design:`)
to render natively. feliz/flutter require the `framework:` change (honest, well-diagnosed error).
Switching the BACKEND is genuinely 1 line. The cost is not the switch — it is that the target you
switch to may not compile.

### T+300..T+390 — Phase 5 (evolution & maintenance)
All schema changes exercised against the **live** FieldOps Postgres with real rows.

**1. Additive.** New field + new enum value + new aggregate + new page:
```
$ ddd generate system … -o eval/out-devauth      3.9s
Wrote 34 file(s), unchanged: 151
```
Derived incremental migration (not a rebaseline):
```sql
CREATE TABLE "field"."service_contracts" ( … ) ;  CREATE INDEX …_customer_id_idx / _tenant_id_idx / _data_key_idx
ALTER TABLE "field"."work_orders" ADD COLUMN "customer_signature" TEXT NULL;
```
Applied to a DB holding 4 work orders — clean. Diff is scoped and readable (34 files / +1244 lines).

**2. Rename a POPULATED column** (`resolutionNote` → `closureNote`), no migration block declared:
```sql
ALTER TABLE "field"."work_orders" RENAME COLUMN "resolution_note" TO "closure_note";
```
```
db=# select closure_note, count(*) from field.work_orders group by 1;
 IMPORTANT CUSTOMER TEXT | 4          ← zero data loss, auto-detected
```
**3. DROP a populated column** — refused:
```
migration for module "Ops" contains 1 destructive change(s):
  - DROP COLUMN field.work_orders.closure_note
… re-run with --allow-destructive …      EXIT=1
```
**4. optional → required with NULL rows present** — refused, then fixed declaratively:
```
  - SET NOT NULL on field.sites.address_line (fails on rows holding NULL)   EXIT=1
# add:  migration "backfill-site-address" { Site.addressLine = "unknown" }
UPDATE "field"."sites" SET "address_line" = 'unknown' WHERE "address_line" IS NULL;
ALTER TABLE "field"."sites" ALTER COLUMN "address_line" SET NOT NULL;       EXIT=0 → applied, verified
```
**5. `string` → `enum` on a populated column**: NO migration, no constraint; a legacy `'CHF'` row is
served as a valid enum value → F-036.

**6. Hand-written code survival.** Unpinned edits are **silently overwritten** — I lost the same three
patches on every regeneration and ended up scripting them (`eval/repatch.sh`). `.loomignore` works
exactly as documented and is reported (`skipped (.loomignore): 1`). Pinning a repository then adding a
field to its aggregate produced a **compile error in the pinned file** — drift caught by the type
system on typed backends; on Python/Elixir the same drift would be silent.

**7. Customization gradient.** Rung 1 (override-by-name) verified — my `area WorkOrders { page Detail }`
replaced only that page (4 files changed). Rung 2 (unfold) verified via the `loom_unfold_macro` agent
tool: the emitted `.ddd` parses clean and **regenerates byte-identical output** (only migration history
and my pinned file differ). This is a real, working escape hatch.

**8. Scaling.** 8 → **40 aggregates** (1,381 lines `.ddd`, scripted):
```
ddd parse            7.8s     (was 2.9s at 8 aggregates)
ddd generate system  8.0s     (was 3.9s)      → 442 files, 51,005 lines
generated api: npm install 17s, tsc --noEmit 18s, 0 errors
generated web: npm install 18s, tsc --noEmit 14s, 0 errors
```
Roughly linear, no cliff at this size.

### T+390..T+450 — Phase 6 (adversarial DX)
**Error quality**: 10 broken models in `eval/repro/broken/` — see the scorecard in FINDINGS.md.
8/10 excellent (fixits, exact line:col, the rule restated inline), 1 crash (F-040 cyclic containment
→ `RangeError: Maximum call stack size exceeded`), 1 validator gap (F-041 page-body field typo).
**Debuggability**: `--sourcemap` + `ddd breakpoints` are precise to the column (verified against the
emitted line). `ddd trace` cannot read a production trace because the shipped image is a tsup bundle
run without `--enable-source-maps` (F-042) — with the best failure message I have seen from a compiler.
**Agent/LLM surface**: 14 `loom_*` tools work (`validate`/`outline`/`hover`/`find_symbol`/`unfold_macro`/…).
A hallucinated field is rejected (`ok:false`) — so "LLM-safe" holds **at the model layer**. It does not
extend to the emitted code: 12 of my findings are models that validate `ok:true` and then fail to compile.
**Playground**: the advertised URL is 404 (F-043); the repo moved org. Built and served it locally
(`npm install` 19s, `npm run build` **2m12s**, 9.5 MB monaco chunk) — it loads clean, validates its
example (0 errors) and generates 107 files in the browser, with Explorer / Diagrams / API /
Traceability / Builder / Chat tabs and no page errors. I could not drive a 600-line paste through
Monaco headlessly, so the playground is **smoke-tested only**; "Boot" showed as *blocked* on the
sample. Screenshot: `eval/playground.png`.
**Ops**: `/health` `/ready` `/metrics` `/openapi.json` all 200; prom-style metrics; an opt-in
`docker-compose.obs.yml` overlay (Prometheus v3.1.0 + Jaeger 1.62) with a generated `monitoring/prometheus.yml`;
structured JSON logs carrying `request_id`/`trace_id`/`span_id`/`scope_id` on every backend I booted.
`--k8s` emits a Helm chart + raw manifests; **`helm lint` passes** (0 failed) and the chart parameterises
secrets through `values.yaml` with a declared secret/config split. No `restart:` policy in the generated
compose, so a container that dies at boot on a transient DB blip never comes back.
**Security probes** (node backend): SQLi through a find parameter and through the tenant claim both
parameterised (0 rows, no leak); NUL-byte refinement on every string; CORS read from `CORS_ORIGIN`
with an allowlist; no credentials in generated source. Weaknesses: F-023 (lost updates), F-034
(python echoes the validation regex to the client), and the raw `k8s/secret.yaml` carries dev
credentials in `stringData` (documented as a placeholder).
**i18n**: extract/init/status/`check --strict` all work and gate; the translated catalog never reaches
the generated app (F-044).

### T+450..T+500 — Phase 7 (reconciliation, read only after the evaluation was complete)
```
$ git rev-list --count HEAD                      → 668     (shallow clone; visible history 14 days)
$ git log --format='%an' | sort | uniq -c | sort -rn
   536 Claude <noreply@anthropic.com>
   131 Michał Kupiec
     1 claude[bot]
$ git tag | wc -l                                → 0
$ ls CHANGELOG*                                  → (none)
$ gh releases                                    → []
$ issues: totalCount 92, of which ~50 are auto-filed "🔴 main is red" (≈3/day), 4 open "Flaky gate"
$ find test -name '*.test.ts' | wc -l            → 2070      (README claims "1,300+")
$ grep -rhoE '(it|test)\(' test | wc -l          → 15740     (README claims "9,000+")
$ find src -name '*.ts' | wc -l ; … | wc -l      → 915 files / 352,848 LOC
$ ls .github/workflows/*.yml | wc -l             → 67
$ grep -rhoE '"loom\.[a-z0-9-]+"' src | sort -u | wc -l → 493 diagnostic codes
```
Key reconciliations (detail in EVALUATION-REPORT.md §11):
- `docs/audits/2026-09-10-independent-completeness-audit.md` reaches my verdict verbatim
  ("a finished compiler wrapped in an unfinished product") and independently records my F-038/F-039.
- Its §2 "Generated output is clean" was measured by **grepping their own three example models for
  TODO markers**. I measured the same property with a compiler over a model I wrote: 16 defects.
- `experience_gathered.md` §104 (2026-09-09) names the exact failure class of my F-013 and F-027 and
  concludes "`npm test` cannot catch this class, structurally."
- Their corpus skew (react 34 · svelte 9 · vue 6 · flutter 3 · feliz 2 · angular 2) predicts exactly
  which frontends broke for me.

### Deliverables
- `eval/EVALUATION-REPORT.md` — the council document.
- `eval/FINDINGS.md` — 45 numbered findings.
- `eval/EVAL-LOG.md` — this log.
- `eval/fieldops/` — `main.ddd` (OIDC + e2e), `main-devauth.ddd` (dev-stub auth, the one I ran),
  `with-notifier.ddd` (cross-deployable channels), `scale.ddd` (40 aggregates), `slice1/slice2`.
- `eval/repro/` — 25 minimal reproductions, incl. `broken/b01..b10` (the error-quality corpus).
- `eval/matrix/` — the per-target `.ddd` variants (5 backends × 6 frontends × 4 React packs).
  The generated trees themselves (~54 MB) were pruned after measurement; `eval/evidence/` keeps the
  migration chain, the cross-backend wire probes + diff, and the two files behind F-035.
- `eval/repatch.sh` — the script I had to write to survive regeneration.
- `eval/ui-logged-in.png`, `eval/playground.png` — browser evidence.

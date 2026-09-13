# Loom evaluation — working log

Evaluator: senior staff engineer, time-boxed adoption spike.
Checkout: /home/user/Loc @ bcd25e3e (main), eval branch `claude/loom-fieldops-eval-ebi6es`.
Environment: Linux 6.18, Node v22.22.2, npm 10.9.7, Docker available (daemon started manually).

## Disclosure on blindness (evaluation contract rule 5)
The harness auto-injected `CLAUDE.md` (maintainer-internal) into my context before
Phase 0 began; I could not decline it. I have not read `docs/new-plan/`, `docs/old/`,
`docs/audits/`, `experience_gathered.md`, `.claude/`, `IMPL-NOTES.md` or `test/`
before Phase 7. The Phase-0 "cold start" timing is therefore an *optimistic* lower
bound: I knew from that file that the CLI is `node bin/cli.js` and that `prepare`
runs codegen. A true outsider would have spent additional time on both.

---

## Phase 0 — cold start

| time (UTC) | action | result |
|---|---|---|
| 19:54 | `npm install` | 26 s, "up to date". 11 npm audit vulns in the TOOLCHAIN's own deps (4 high: fast-uri, ip-address, nanoid, postcss), all with fixes available. |
| 19:55 | `npm run build` (`tsc -b`) | 0.24 s — incremental, tree already built. |
| 19:55 | `node bin/cli.js --help` | 9 commands listed. `ddd` is NOT on PATH → **F-001**. |
| 19:55 | `node bin/cli.js new fieldops-starter -o eval/starter` | 1.2 s, 4 files. Starter model is a working crud+scaffold system (Project/Task, criterion+retrieval, react UI, postgres). |
| 19:56 | `generate system main.ddd -o .` | 1.5 s, **83 files**, "0 error(s), 0 warning(s)". |
| 19:56 | `docker compose up -d --build` | **Hung 13 min** on in-container `npm install`. |
| 20:07 | diagnosed | NOT a Loom bug: this sandbox terminates TLS at an agent proxy; containers lack the CA. `docker run alpine wget https://registry.npmjs.org` → `SSL routines:tls_post_process_server_certificate`. |
| 20:08 | found Loom's own documented fix | `docs/tools.md` §"Proxy CAs (sandboxed builds)": every generated deployable ships an empty `certs/`; the emitted Dockerfile already has `COPY certs/`, `update-ca-certificates`, `NODE_EXTRA_CA_CERTS`. Confirmed present in the emitted `api/Dockerfile` lines 6-11. |
| 20:09 | `cp /root/.ccr/ca-bundle.crt {api,web_app}/certs/` + rebuild | Built and booted. **This is a genuine point in Loom's favour** — it anticipated TLS-intercepting corporate proxies and the hook worked first try. |
| 20:10 | `docker compose ps` | api healthy (:3000), db healthy, web_app healthy (:3001). Backend logged `migrations_starting` → `migrations_complete` → `server_listening`; structured JSON logs carry request_id / trace_id / span_id. |
| 20:10 | `curl localhost:3000/projects` | 404 — routes are under `/api/…`, undocumented → **F-002**. `/openapi.json` is served and lists all 6 paths. |
| 20:10 | full CRUD round-trip | `POST /api/projects` → `{"id":"01a09c64-…"}`; `GET /api/projects/{id}` → `{id,name,version:1,display:"Acme Rollout"}`; `POST /api/tasks` with the FK → created; `GET /api/tasks` → paged envelope `{items,page,pageSize,total,totalPages}` with the association round-tripping. |
| 20:10 | invariant violation `{"name":""}` | **422** `application/problem+json`, `{"errors":[{"pointer":"/name","message":"Name must be at least 1 character"}]}`, `x-correlation-id` header. RFC7807-shaped, field-pointed. |

### Phase 0 headline result
**Time from `ddd new` to a running app I could `curl`, excluding the sandbox-specific
TLS detour: ~15 minutes**, of which ~13 was a cold `npm install` inside two Docker
images. Loom's own share (`new` + `generate`) was **2.7 seconds**. Including the TLS
detour it was 21 min, but that cost is this environment's, not Loom's — and Loom shipped
the fix for it.
Commands needed: 4 (`npm install`, `new`, `generate system`, `docker compose up -d --build`).
Places I had to guess: 2 (F-001 `ddd` not on PATH, F-002 the `/api` route prefix).
The starter template's own `main.ddd` parsed and generated with 0 errors / 0 warnings.

---

## Phase 1 — modelling FieldOps (expressiveness)

Wrote `eval/fieldops/main.ddd` in slices. Slice 1 (130 lines of pure domain: 6 aggregates,
containment, money arithmetic, enum collections, optional FKs, a multi-currency invariant)
**parsed clean on the first attempt** and its generated node backend passed `tsc --noEmit`
with exit 0. That is a real result and worth saying plainly: the language is learnable from
the docs and the happy path is genuinely short.

Four syntax errors over the whole session, each with an actionable message:
| what I wrote | diagnostic | verdict |
|---|---|---|
| `channel X { carries: [E] }` (the form `docs/language.md:325` documents) | `Expecting token of type 'ID' but found '['` | **doc bug** — the grammar (`ddd.langium:1355`) takes a bare comma list; the error doesn't say "drop the brackets" → F-010 |
| `guid("…")` as an id literal in a test | `Unexpected 'guid'. Did you mean 'id'?` | fine — a plain string literal works |
| `requires permissions.contains(permissions.x)` | `'requires' must be of type 'bool', got 'unknown'` | fine — the receiver is `currentUser.permissions` |
| `channelSource … use: bus` (redis) for a `retention: log` channel | "binds channel 'WorkOrderEvents' (broadcast/log) to storage 'bus' of type 'redis', which can't realise it. **Compatible: kafka.**" | excellent — names the fix |
| `create { }` | `Expecting token of type '(' but found '{'` | doc says "omitting the parens keeps it quiet"; `create()` is required → F-010 |

Two warnings I did NOT ask for and was glad to get:
- `loom.unique-missing-tenant-scope`: "`unique (serialNumber)` on tenant-owned aggregate 'Asset'
  omits the tenant discriminator — this is a GLOBAL unique across all tenants. Did you mean
  `unique (tenantId, serialNumber)`?" — a real multi-tenant bug caught at compile time.
- `loom.sensitive-wire-unsupported`: tells you `sensitive(pii)` does **not** redact on the wire,
  and names the two things that do (`mask unless`, `internal`/`secret`). This is the model of an
  HONEST gap: the tool refuses to let you believe a tag does more than it does.
- `loom.index-suggestion`: "'WorkOrder.technicianUserId' is read on a query filter but has no index."

### Expressiveness verdict per spec requirement
| Requirement | Verdict | Evidence |
|---|---|---|
| Tenant isolation, explicit stances | **direct** | `with tenantOwned` / `crossTenant`; proven live below |
| Deliberate cross-tenant admin report | **direct** | `from WorkOrder as w ignoring tenantOwned` + `requires` (F-005) |
| Customer→Site→Asset, WorkOrder lifecycle w/ guarded transitions | **direct** | `operation … when <state pred>` → 409 + a free `GET /{id}/can_<op>` |
| Money total over line items, multi-currency invariant | **direct but see F-006** | `derived total: money = lines.sum(l => l.amount)`; the invariant breaks the factory |
| "Decrement stock or fail the whole operation" | **direct** | transactional workflow, verified SQL-level (F-004) |
| Skill-matching across aggregates | **NOT EXPRESSIBLE as an invariant** | F-003 — accepted, then emits non-compiling code (or nothing on elixir). Workaround: a workflow precondition, which only guards that one path |
| "A technician sees only their own work orders" | **awkward** | `currentUser.id` is a user id, not a `Technician id`; the type system correctly refuses the join. Requires denormalizing `technicianUserId: guid?` onto the row |
| Masked cost rate | **direct** | `mask unless currentUser.role == "admin"`, proven live |
| Immutable-once-issued invoice | **direct** | `operation adjust(...) when issuedAt == null` |
| Photos (file upload), email, object store | **direct** | `File?` + `storage … type: s3` + `kind: objectStore`/`mailer` |
| Eventing to another deployable | **direct** | `channel` + `channelSource` (broker compatibility validated) |
| Dashboard reporting (count by status, revenue) | **direct** | query-time `projection … group by … select count()/sum()` |

## Phase 2 — running the generated FieldOps stack

`generate system`: **317 lines of .ddd → 151 files / 12,555 lines**, in **1.8 s**. That includes a
7-service `docker-compose.yml` and a Keycloak realm.

- `docker compose up -d --build` failed outright on the `minio/minio:latest` pull → **F-008**.
  After a one-line patch, **all 7 services came up**: api + web_app healthy, db, keycloak,
  valkey (bus), mailpit (mail), minio (photos).
- Rebuild+boot cycle after a model change: **2.5 min** (warm cache).
- Migrations: applied cleanly to an empty DB into a per-context schema (`field.*`), 10 tables,
  with `customers_tenant_id_idx` and a `data_key` pattern-ops index derived automatically.
  *(I wasted ~8 min looking in `public` — my mistake, not a defect.)*
- `tsc --noEmit`: **exit 0** on both the Hono API and the React frontend.

Live probes (all against the running stack, tokens minted from the generated Keycloak realm):
| probe | result |
|---|---|
| unauthenticated `GET /api/work_orders` | **401** problem+json |
| token with **no** `orgId` claim reading a table holding two tenants' rows | **0 rows** — fail-closed, not fail-open |
| tenant A list read | only A's row; tenant B list read | only B's row |
| **tenant A reads tenant B's customer by id** | **404** — isolation holds on the by-id route |
| `requires` permission gate | **403**, detail names the predicate verbatim |
| `when` state gate (`start` on a Draft order) | **409 Disallowed** |
| `precondition` failure | **422** `Precondition failed: isEditable()` |
| field `check` failure (empty name) | **422** with `{"pointer":"/name"}` |
| `mask unless currentUser.role == "admin"` | dispatcher → `"costRate":null`; admin → `"85.5000"`; DB → `85.5000` |
| money arithmetic `2.5 × 60.0000` | `"150.0000"` — exact, string on the wire |
| optimistic concurrency | `version` 1→3 across two operations |
| audit stamps | `createdBy`/`updatedBy` populated from the token `sub` |
| frontend | serves a built Vite bundle at :3001, `<title>Field Ops</title>` from the model |
| `GET /{id}` under `denyByDefault` | **ungated** → F-009 |

**The three-way error taxonomy (403 authorization / 409 state / 422 validity) is real, consistent
and correctly wired.** Wire values were checked, not just status codes: camelCase JSON keys, enums
as strings, `money` as a 4-dp string, timestamps as ISO-8601 Z, `null` for absent optionals,
associations round-tripping, and a `{items,page,pageSize,total,totalPages}` paged envelope.

---

## Phase 3 — breadth (the headline claims), measured

Method: **one model** (`eval/fieldops/main.ddd`, 317 lines), only `platform:` / `design:` varied.
Every "compiles" verdict below is an executed build using **the generated project's own declared
toolchain and version**, in a container matching its declared runtime.

### Backends (5/5 generate; 2/5 compile as-shipped)
| Backend | generates | compiles | evidence |
|---|---|---|---|
| node / Hono | ✅ 158 files | ✅ `npx tsc --noEmit` exit 0 | also booted + served real traffic (Phase 2) |
| .NET / ASP.NET | ✅ 331 files | ❌ **F-011** | `dotnet build` (SDK 10, net10.0): CS0234 ×2 in `ChannelTransport.cs`. Without the channel: `Build succeeded, 0 Warning(s), 0 Error(s)` under `-warnaserror` + ~200 Roslyn CA rules |
| Java / Spring Boot 4.1 | ✅ 277 files | ❌ **F-012** | `gradle testClasses` (JDK 25): missing `import java.util.Objects` ×3. After adding those 3 lines: **BUILD SUCCESSFUL** |
| Python / FastAPI | ✅ 169 files | ⚠️ compiles, **wrong at runtime** | `compileall` exit 0 (py3.13); `ruff check` → `F821 Undefined name 'current_user'` (**F-013**) + 3 minor (**F-015**) |
| Elixir / Phoenix | ✅ 250 files | ❌ **F-013, F-014** | `mix compile` (1.17.3/OTP27/ecto 3.14.2): `Ecto.Query.CompileError: unbound variable current_user`, then `ArgumentError: invalid type {:array, Ecto.Enum, …}`. After patching both: **`Generated api app`** |

So: **1 of 5 backends builds and runs my model as shipped.** Each of the other four needed 1–3
one-line fixes — none deep, all silent. After patching, Java and Elixir both compiled, and .NET
compiled once the channel was dropped, so the *architecture* is sound; the *release gating* is not.

### Frontends (6/6 generate; 3/6 build)
| Frontend | generates | builds (own `npm run build`) | evidence |
|---|---|---|---|
| React | ✅ | ✅ exit 0 | `tsc --noEmit && vite build`; also served live at :3001 |
| Vue | ✅ | ✅ exit 0 | `vue-tsc --noEmit && vite build`, built in 904 ms |
| Svelte | ✅ | ✅ exit 0 | `svelte-kit sync && svelte-check && vite build` |
| Angular | ✅ | ❌ **F-016** | `ng build`: TS2322 + TS2345 — `skills: new FormControl(null)` vs `unknown[]` |
| Feliz (F#) | ✅ | ❌ **F-017** | `dotnet build`: **14 `error FS`** (duplicate type + 8× Guid/string) |
| Flutter | ✅ 126 files | ⚠️ **UNVERIFIED** | the Flutter SDK is a multi-GB download I did not attempt in this environment. **Not a pass.** |

### Design packs — 5 verified across 3 frameworks
`mantine`, `shadcn`, `mui`, `chakra` (React) each `tsc --noEmit` exit 0; `vuetify` (Vue) and
`flowbite` (Svelte) each build clean. Swapping is genuinely a one-word change and it worked every
time. **Packs are the most solid part of the breadth story.**

### Mixing
`eval/fieldops/mixed.ddd` — two backends (node + python) and two frontends (react + vue) pointing
at the same `api` in one system: generates 305 files and a coherent 9-service compose file
(`api`, `api_py`, `web_app`, `web_app2`, `db`, `keycloak`, `bus`, `photos`, `mail`). Composition
works.

### "Identical API contracts"
`.loom/wire-spec.json` is **byte-identical (sha 391d0b4e…, 10,580 bytes) across all five backends.**
Important caveat: that artifact is *derived from the model*, so it is identical by construction —
it proves the five backends are generated from one contract, not that each *honours* it at runtime.
Only node was executed end-to-end here.

### The single most telling result
One ordinary field — `skills: Skill[]` — broke **two** of the eleven targets I built (Elixir F-014,
Angular F-016), in two unrelated ways, with `0 error(s), 0 warning(s)` from the toolchain both times.

---

## Phase 5 — evolution and maintenance (the real adoption test)

### 1. Additive change
Added one enum value (`Priority { …, Emergency }`) and regenerated:
```
Wrote 7 file(s), unchanged: 149
files changed: 7   total line delta: 17
  .loom/domain.mmd · .loom/wire-spec.json · api/db/schema.ts · api/domain/value-objects.ts
  api/http/workOrder.routes.ts · web_app/src/api/workOrder.ts · web_app/src/pages/work_orders/new.tsx
```
**A completely reviewable diff**, and it lands in exactly the right places across backend schema,
route validation, the frontend API client and the form page. This is the "no drift between layers"
claim doing real work, and it is the single most persuasive thing I saw all day.

Adding a required field is handled by the migration gate (see 2). Adding an aggregate: covered by
the scale test (6).

### 2. Breaking change against a database WITH ROWS
Baseline data: 2 parts, 3 customers, 2 work orders, 1 technician.

| change | result |
|---|---|
| add required `binLocation: string` | **REFUSED. exit code 1, nothing written.** Message names the exact DDL (`ADD COLUMN field.parts.bin_location NOT NULL (no default)`) and both remedies |
| same, with `migration "…" { Part.binLocation = "UNASSIGNED" }` | emits the textbook add-nullable → `UPDATE … WHERE IS NULL` → `SET NOT NULL`. Applied live: **zero data loss**, all rows backfilled, all other tables intact |
| rename `binLocation` → `binCode` | heuristic inferred it: `ALTER TABLE … RENAME COLUMN "bin_location" TO "bin_code"`. Data preserved |
| **delete `binCode`, add unrelated `supplierRef`** (with an explicit backfill for the new column) | **`ALTER TABLE … RENAME COLUMN "bin_code" TO "supplier_ref"` — silently mis-migrates the data, discards the declared backfill, contradicts the documented rule. exit 0, no warning.** → **F-018 (S1)** |

So: **can a breaking schema change ship against a production DB without data loss? Yes for the
common cases, and the gate is genuinely good — but not safely unattended**, because one ordinary
refactor shape corrupts data silently. Every generated migration must be read by a human.

### 3. Hand-written code survival → **F-019**
Edits to generated files are overwritten on the next `generate`, with no warning in the report line
and no backup. Documented (`docs/tools.md`: "every file Loom generates is overwritten on every run";
every file is headed `// Auto-generated.  Do not edit by hand.`). `.loomignore` pins work exactly as
advertised, and `--dry-run` prints the `skip (.loomignore)` plan. **Honest answer: you own the source
until the next regenerate, unless you pin it — and a pinned file stops tracking the model, with no
tool to tell you it has drifted.**

### 4. Toolchain upgrade risk — **the weakest area**
```
package.json version: 0.1.0          git tags: 0          CHANGELOG: none
npm registry: {"error":"Not found"}   (loc-ddd-dsl is not published)
all packages/*: v0.0.0-experimental, private: true
```
There is **no release, no version to pin, no changelog, no deprecation policy and no
Loom-version→Loom-version migration guide.** Adoption means vendoring a git SHA of `main` and owning
every upgrade yourself. Generated *stacks* are versioned (`stacks/v1,v3,vue1,sv1,ng1`, and each pack
names one), which is real and good — but that pins the *generated app's* dependencies, not the
generator.

### 5. Team workflow
- Generated output is **not** gitignored → it is meant to be committed. With 12.5k lines from 317
  lines of model, a PR diff is dominated by generated files; review has to be of the `.ddd` plus the
  migration SQL, with generated code skimmed. Workable, but it needs a CODEOWNERS/review convention.
- **Output is byte-deterministic**: two independent generations of the same model produced
  **0 differing files**. This is what makes committed output and CI regeneration checks viable, and
  it is a genuine engineering achievement.
- CI must regenerate and then compile *every* target it ships (Phase 3 proves why).

### 6. Scaling — no cliff in the toolchain
Scripted `eval/fieldops/scale.ddd`: **32 aggregates, 5 contexts, 992 lines** (added 24 aggregates
each with containment, a derived money total, an invariant, a tenant-scoped unique, 2 operations, a
criterion, a retrieval and a grouped projection).

| metric | main.ddd (8 aggregates, 317 lines) | scale.ddd (32 aggregates, 992 lines) |
|---|---|---|
| `ddd parse` | 1.4 s | **4.7 s** |
| `ddd generate system` | 1.8 s | **5.3 s** |
| files out | 151 | **358** |
| generated LOC | 12,555 | **49,256** |
| on disk | — | 3.5 MB |
| generated-project `tsc --noEmit` | 4.4 s | **12.4 s** |

Roughly linear, nothing fell over, and the ratio held at ~50× expansion. **The "no scaling cliff"
claim holds for the sizes a real product reaches** — at least on the toolchain and the TypeScript
build. (I did not measure a full multi-backend docker build at 32 aggregates.)

---

## Phase 6 — adversarial DX

### Error quality — ten deliberately-broken models (`eval/repro/broken/`)
| # | realistic mistake | diagnostic | right line? | actionable? |
|---|---|---|---|---|
| 1 | typo'd type (`strng`) | `Could not resolve reference to NamedDecl named 'strng'` | ✅ 2:20 | ok (doesn't suggest `string`) |
| 2 | invariant over a field that doesn't exist | `Unknown name 'qty' — no parameter, local, field, enum value, or declaration with this name is in scope` | ✅ 2:38 | ✅ |
| 3 | wrong arity | `Function 'f' expects 2 arguments, got 1.` | ✅ 4:31 | ✅ |
| 4 | cross-aggregate ref done wrong | `References across aggregate boundaries need an id link — write 'Other id' (or 'Other id[]' for many-to-many).` | ✅ 3:22 | ✅ **gives the fix** |
| 5 | **cyclic containment** | **none — `RangeError: Maximum call stack size exceeded` + internal stack trace** | ❌ | ❌ → **F-020** |
| 6 | duplicate field names | `Duplicate field 'n' in aggregate 'A'; … they map to one field of the wire shape.` | ✅ 2:28 | ✅ explains *why* |
| 7 | bad enum value | `Unknown name 'Blue' — …` | ✅ 4:27 | ✅ |
| 8 | page bound to the wrong aggregate | `loom.method-call-unresolved-receiver page 'P': … A method-call receiver must resolve to a page/component parameter, state / derived value, lambda binding, or a declared api handle` | ✅ names the page | ✅ |
| 9 | unqueryable filter (`.count` in a `where`) | `loom.find-where-not-queryable … not queryable (collection projection '.count' on a list). Allowed: comparisons, &&/||/!, parens, 'this.<column>' …` | ✅ 5:30 | ✅ **lists what IS allowed** |
| 10 | type mismatch in an assignment | `Cannot assign 'string' to 'int'.` | ✅ 3:27 | ✅ |

**9/10 produced a precise, correctly-located, actionable diagnostic — several naming the exact fix
or the permitted alternatives. This is materially better than most compilers I have used.** One
crashed (F-020). Diagnostics carry stable `loom.*` codes you can look up.

### Debuggability
- `--sourcemap` emits a 46 KB `.loom/sourcemap.json`.
- **`ddd trace` works and is genuinely useful.** Given a real stack from generated code
  (`DomainError: Precondition failed: onHand >= qty  at Part.consume (…/api/domain/part.ts:48:39)`)
  it annotated the frame as `Field.Part.consume (…/eval/fieldops/main.ddd:134)` — and line 134 is
  exactly `precondition onHand >= qty`. **Production triage from a stack trace back to the model
  works.**
- **`ddd breakpoints` (the reverse) is unreliable** — declaration-level model lines resolve to
  generated **line 1** → **F-021**.

### Agent / AI-authoring surfaces — the strongest non-obvious part of the product
- **`ddd patch`**: `[{"op":"replace","target":"aggregate Field.Part.onHand","source":"onHand: long"}]`
  → `ok: true`, and the patch lands. A malformed address returns `ok:false` with a *remarkable*
  error: it explains the address grammar, says **"did you mean: aggregate Field.Part.onHand"**, and
  prints the full 228-entry address book. That is precisely what an LLM needs to self-correct.
- **MCP server** (`packages/ddd-mcp/bin.js`) responds to a real JSON-RPC handshake and exposes
  **14 tools**: `loom_validate`, `loom_outline`, `loom_read_model`, `loom_list_primitives`,
  `loom_generate`, `loom_apply_patch`, `loom_find_symbol`, `loom_references`, `loom_hover`,
  `loom_rename`, `loom_quickfix`, `loom_unfold_macro`, `loom_snapshot`, `loom_diff`.
  Calling `loom_validate` on a broken model returned structured JSON with the stable code
  `loom.unknown-name`. **The "LLM-safe" claim has real substance** — validate-before-emit, stable
  diagnostic codes, node-addressed patches, and an address book for recovery.
- Not tested: the VS Code extension / LSP interactively, and the browser playground (no browser
  session driven here) — both marked **unverified**.

### Quality tooling
- **`ddd verify` works exactly as documented.** With a correct `results.json`
  (`status: pass|fail`, matched by the DSL test *name*): pass → `Verified 1/4 requirements`, exit 0;
  fail → `Verified 0/4 (1 failing…)`, `Verification gate failed: 1 requirement(s) failing.`, **exit 1**,
  plus a readable `.loom/verification.md` with per-requirement verdicts and the backing test.
  The `requirement → testCase → test → verdict` chain is real. *(I lost ~5 min using `"passed"`
  instead of `"pass"` — my error; `docs/verify.md` states the contract plainly.)*
- **`.loom/` artifact bundle** (19 artifacts): `wire-spec.json`, `domain.mmd`, `er.mmd`,
  `sequence.mmd`, `deployment.mmd`, `workflows.mmd`, `traceability.{json,md,mmd}`,
  `traceability-matrix.md`, `coverage.md`, `gaps.md`, `manifest.json`, `architecture.c4`,
  `asyncapi.yaml`, `datasources.md`, `messages.en.json`, `sourcemap.json`, `snapshots/`.

### Operations and security posture
| item | finding |
|---|---|
| logs | structured JSON, one line per request, with `request_id` / `trace_id` / `span_id` / `duration_ms`. Good. |
| health | `/health` 200, `/ready` 200 (DB-checking), compose healthchecks on db/api/web/keycloak/mail |
| metrics | `/metrics` **401** on an auth-bearing deployable, but the emitted `monitoring/prometheus.yml` scrapes it with no credentials → **F-022** |
| tracing | OTel SDK + OTLP exporter wired; `docker-compose.obs.yml` adds prometheus + jaeger |
| SQL construction | Drizzle query builder throughout; **no template-literal SQL in any repository** — parameterised by construction |
| CORS | **fail-closed and well-reasoned**: `corsAllowAnyFallback = false` because auth is present; a probe with `Origin: https://evil.example` got **no** `Access-Control-Allow-Origin`, with `Vary: Origin` set |
| secrets | dev compose ships `postgres`/`admin`/`minioadmin` defaults — fine for a dev stack, but there is no emitted production posture; you supply that |
| dependency freshness (generated stack) | **current**: React 19.2, Mantine 9.2, TanStack Query 5, zod 4, hono 4.12, Drizzle 0.45, Spring Boot 4.1, net10.0, FastAPI 0.115, Python ≥3.13, JDK 25 |
| dependency freshness (the toolchain itself) | `npm audit`: **11 vulns (4 high)** — fast-uri, ip-address, nanoid, postcss — all with fixes available |
| k8s/Helm | documented (`docs/kubernetes.md`, 294 lines) but **not emitted for my model**; I did not find the opt-in → **unverified** |

---

## Phase 7 — reconciliation with maintainer-internal material

### Project health (measured, not inferred)
```
$ git log --oneline | wc -l                          810 commits
$ git log --reverse --format='%ci' | head -1         2026-09-01   (repo is ~6 weeks old)
$ git log --since='7 days ago' --oneline | wc -l     600 commits in the last week
$ git log --format='%an' | sort | uniq -c | sort -rn
    669  Claude <noreply@anthropic.com>          ← 83% of all commits
    135  Michał Kupiec <ten.michal.k@gmail.com>  ← 17%, one human
      6  claude[bot]
$ find test -name '*.test.ts' | wc -l                2,107 test files
$ grep -rhoE '^\s*(it|test)\(' test | wc -l          ~14,912 test call sites
$ ls .github/workflows | wc -l                       67 workflows
```
**Bus factor 1.** The project is six weeks old and ~83% AI-authored under one person's direction.
This single fact explains the shape of everything else I measured: very large surface area,
excellent diagnostics and documentation, byte-deterministic output, sophisticated architecture —
together with per-target compile failures on ordinary constructs that nobody had executed.

### Why CI did not catch my findings — the precise mechanism
CI *does* compile generated output per target (`dotnet-build.yml`, `java-build.yml`,
`generated-angular-build.yml`, `generated-feliz-build.yml`, `elixir-vanilla-build.yml`, …). Its
inputs are the vendor's own fixtures and `examples/` — the happy path by construction. Every bug I
found lives in a **feature combination the corpus does not contain**:

| finding | why the corpus misses it |
|---|---|
| F-011 .NET channel CS0234 | `test/e2e/fixtures/dotnet-build/multi-context-eventlog.ddd` has `deployable api` + `platform: dotnet` + `channel L {…}` — but **`grep -c channelSource` → 0**, and `channelSource` is what causes `ChannelTransport.cs` (the broken file) to be emitted at all. **No dotnet fixture wires a channelSource.** |
| F-012 Java missing `Objects` import | the `field-mask` corpus fixture is marked `backends: ALL`, but it masks with `mask unless currentUser.permissions.contains(permissions.unmask)` — a *membership* predicate. My model used `mask unless currentUser.role == "admin"` — **string equality**, which is what emits `Objects.equals(...)`. The predicate *shape* is uncovered, not the feature. |
| F-014 / F-016 `enum[]` | `enum[]` appears in the corpus only in two **dotnet-build** fixtures. Never on Elixir, never on Angular. |

**Generalisation, and the most important sentence in this evaluation: Loom's CI is broad across
targets and thin across feature combinations, and the corpus is written by the same process that
writes the emitters — so it tests what the author thought of.**

### Did they already know?
- **F-012 — yes, as a bug *class*, and they wrote down the exact follow-up they did not do.**
  `docs/audits/generator-code-review-2026-08-24.md` §A17: *"java: … renders `op.when` but the
  import loop … never visit it → `when this.owner == "system"` emits `Objects.equals(...)` with no
  `import java.util.Objects` ("cannot find symbol")"* — and its own remedy line ends
  *"**audit the route-layer twin for the same gap**."* My F-012 **is** the route-layer twin (the
  response-DTO emitter). The class was identified, some instances fixed, the generalisation written
  down, and the rest shipped. That is a **process** finding, not a bug.
- **F-011 — a sibling is known.** The 2026-09-10 independent audit lists "F1 · the .NET name
  collision" with code `loom.dotnet-name-collision`, noting it is a *refusal*. Mine is the silent
  miscompile variant, and the audit says plainly why no instrument sees it.
- **F-014, F-013(elixir/python), F-016, F-020 (`nestedContainLoads`), F-018 (rename heuristic
  mis-inference)** — no internal trace found (`grep` over `docs/new-plan/`, `docs/audits/`,
  `experience_gathered.md`, `IMPL-NOTES.md`). These appear to be genuinely new.
- **Release/ops gaps — known and named.** The same audit's own verdict is
  *"Loom is a finished **compiler** wrapped in an unfinished **product**"*, and it lists
  "F4 · nothing is installable", "F5 · no advisory or freshness gate", "F7 · gates that assert no
  denominator", and a generative fuzzer that is **RED on 3 seeds**. My independent findings on
  publishing, versioning and `npm audit` match theirs.

### Overclaiming in user-facing docs
- **Under-claimed:** the README says "1,300+ test files / 9,000+ tests"; actual is 2,107 files and
  ~14,912 test call sites.
- **Accurate:** "no drift between layers" (verified — one enum value propagated correctly to 7 files
  across backend schema, routes, frontend client and form); the migration gate; `.loomignore`;
  the design-pack story; "LLM-safe" (the MCP/patch surface is real).
- **Overclaimed — the one that matters:** *"Pick a runtime per deployable. Switch any time."* and
  *"Identical API contracts; idiomatic per-runtime output."* On my model, 1 of 5 backends and 3 of 6
  frontends built as shipped. The contract *artifact* is byte-identical across backends, but that
  is derived from the model and proves nothing about what each backend does. A buyer reading the
  README would reasonably expect to be able to switch targets; they cannot, without compiling first.
- **Doc-vs-behaviour contradictions found:** `docs/language.md:325` documents `carries: [Event, …]`
  which does not parse (F-010); `docs/migrations.md` promises "a backfilled add … never treated as a
  rename", which is false (F-018); `docs/auth.md` states the deny-by-default rule with one exception
  and omits the by-id read (F-009).

### The instrument that already exists (strongest reconciliation point)
`test/system/emitted-unbound-identifiers.test.ts` + `test/_helpers/emitted-scope.ts` implement exactly
the check my F-013 needs — "does the emitted code reference a name it never brought into scope?" —
and their headers diagnose my §6 generalisation verbatim: *"The gap is not the invariant — it is the
INPUT SET."* They even record the history: of 16 `main`-red events, **13 were one instance of this
bug class**, which "survived ten consecutive red sweeps" because the failing cell was not in the PR
gate's input set.
Scope today: **frontend page files only** (react/vue/svelte/angular page globs), checking unbound
`t()` calls. My F-013 is an unbound identifier in a **Python backend repository** — one
generalisation outside it. The header is candid about the limit too: *"It is a scope check, not a
type check … the `push: main` compile sweep remains the net"*.

### Phase 4 — Appendix A coverage (what I actually exercised)
**Exercised in context:** aggregates · entities/containment · value objects + invariants · enums ·
optional + collection types · derived fields · functions (expression + block) · operations with
preconditions · `when` state gates (+ the free `can_<op>` companions) · events + `emit` ·
repositories + custom finds · cross-aggregate `X id` refs · criteria + retrievals ·
query-time projections incl. `group by` / `count()` / `sum()` · capabilities (`tenantOwned`,
`auditable`, `crudish`) · multi-tenancy stances + `ignoring` bypass · `mask unless` ·
`requires` gates · `currentUser` · permissions catalogue · OIDC (real token round-trip against the
generated Keycloak realm) · workflows (transactional, cross-aggregate) · channels + `channelSource`
+ broker compatibility validation · resources (objectStore/mailer/queue) · storage + deployables +
docker compose · migrations incl. destructive gating + backfill blocks + rename intent ·
money/decimal semantics · datetime · `unique` (+ tenant-scope warning) · inline domain tests
(**generated test executed and passed**) · traceability `requirement`/`solution`/`testCase` ·
`ddd verify` (pass + fail, exit codes) · `.loom/` artifact bundle (19 artifacts) · `--sourcemap` +
`ddd trace` + `ddd breakpoints` · `ddd patch` · MCP agent tools (14, one called for real) ·
`ddd snapshot` · `--dry-run` · `.loomignore` · `ddd new` templates · i18n
(`extract` 251 msgs → `init de` → `status` → `check --strict` exit 1) · observability envelope ·
design packs (5 of 13).

**Smoke-tested only:** `sensitive(...)` tags (verified they do *not* redact, per the tool's own
warning) · `File`/upload wiring (emitted + compiled, no upload performed) · provenance (`snapshot`
ran; my model declared no `provenanced` field) · asyncapi/c4/mermaid artifacts (emitted, not consumed).

**Not tested:** event sourcing (`persistedAs: eventLog`) · aggregate inheritance / TPC vs TPH /
polymorphic reads · discriminated unions + `option` carriers · domain services · `extern` operations ·
macro `unfold` · multi-file models + `import` · `softDelete` macro · the audit-trail history read ·
policy read-ladders (`deep`/`global`) · API e2e + UI e2e test blocks (declared surface not exercised) ·
generated Playwright page objects · the OpenAPI conformance/parity harness · watch mode ·
Kubernetes/Helm · the DAP adapter · the browser playground · the VS Code extension.

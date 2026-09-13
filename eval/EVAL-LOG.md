# Loom evaluation — running log

Time-boxed spike. Every command, its exact output (or the interesting part of it),
and time lost. Written as I go, newest at the bottom of each phase.

Environment: Linux 6.18.44, 4 cores, 15 GB RAM, Node v22.22.2, npm 10.9.7.
Repo at `bcd25e3e` (main). Clock starts 2026-09-13T19:56Z.

Scope note: the brief names two applications — **Clearline** (claims handling)
and **FieldOps** (multi-tenant field service). The phase instructions reference
FieldOps by name and path, so FieldOps is the primary incremental build
(`eval/fieldops/`); Clearline (`eval/clearline/`) is built as the second model
because it is the better probe for abstract aggregates / TPC-vs-TPH / "change
your mind and migrate" / decision unions, which Phase 5(b) needs.

Blindness rule: until Phase 6 I have not opened `CLAUDE.md`, `docs/new-plan/`,
`docs/old/`, `docs/audits/`, `experience_gathered.md`, `.claude/` or `test/`.
Caveat recorded honestly: this session's harness injected the repository's
`CLAUDE.md` into my context automatically at startup, before I could decline it.
I have not used it as a source of evidence or navigation during Phases 0–5, and
every claim in the report is backed by a command I ran from outside. Where a
Phase 6 finding depends on maintainer-internal material I say so explicitly.

---

## Phase 0 — cold start

### Setup (README, verbatim)

```
npm install                 # 29s (warm cache). Runs `prepare` = langium:generate && build && build:web.
node bin/cli.js --help      # 2.0s, works
```

Friction: README writes every command as `ddd parse …`, but nothing in the
install sequence puts `ddd` on `PATH` (`which ddd` → not found). `package.json`
declares `"bin": {"ddd": "./bin/cli.js"}` but there is no `npm link` step in the
README. An outsider must guess `node bin/cli.js`. → F-001 (S4).

`npm install` reports **11 vulnerabilities (4 high)** in the toolchain's own deps
(fast-uri, ip-address, nanoid, postcss; plus 7 advisories on `hono`, which is
also the framework the node backend generates onto). Toolchain-side, not
generated-side, but it is the first thing a security reviewer sees. → F-002 (S3).

### Cold start: `ddd new` → `generate system` → `docker compose up`

```
node bin/cli.js new phase0 --out ./phase0
  Scaffolded 4 file(s) … (platform: node, template: crud).        1.3s
node bin/cli.js generate system main.ddd -o .
  0 error(s), 0 warning(s). Wrote 83 file(s) in .                 1.5s
docker compose up -d --build                                      (see below)
```

83 files from a 94-line `main.ddd`. The scaffolded model is unusually candid —
its own header comment names two auth holes up front (the synthesised by-id read
cannot carry a `requires` gate under `denyByDefault`; `with crudish`'s
create/update/destroy likewise). That is a DOCUMENTED gap, delivered at exactly
the moment you'd act on it. Good practice; tested later (F-01x).

**First `docker compose up` wedged for ~15 minutes** on
`RUN npm install` inside both containers, with no output. Root cause was NOT
Loom: this sandbox's egress is a TLS-terminating proxy, and the container had no
CA for it —

```
docker run --rm node:24-alpine wget -qO- https://registry.npmjs.org/hono
  SSL routines:tls_post_process_server_certificate:certificate verify failed
```

Loom anticipates exactly this: the generated `api/Dockerfile` already carries a
`COPY certs/ /usr/local/share/ca-certificates/` step with an explanatory comment,
and `docs/tools.md` §"Proxy CAs (sandboxed builds)" documents it. Fix:

```
cp /root/.ccr/ca-bundle.crt api/certs/proxy.crt
cp /root/.ccr/ca-bundle.crt web_app/certs/proxy.crt
docker compose up -d --build      # 58s, all three services healthy
```

Time lost ~17 min, all of it to *finding* the mechanism (the Dockerfile comment
says what `certs/` does; nothing on the failure path points at it). → F-003 (S3).

### First running app — the round trip (values, not status codes)

```
curl -s -o /dev/null -w '%{http_code}' localhost:3000/ready   → 200
curl -s -o /dev/null -w '%{http_code}' localhost:3001/        → 200
GET /openapi.json  → 6 routes over 2 aggregates
```

Note `/doc` 404s; the spec is served at `/openapi.json`.

```
POST /api/projects {"name":"Apollo"}
  → {"id":"01a09c67-351b-71a0-a414-8c962c7db1b9"}
POST /api/tasks {"title":"Design","done":false,"project":"<pid>"}
  → {"id":"01a09c67-3557-7654-96df-59fa952af4b5"}
GET  /api/tasks
  → {"items":[{"id":"…","title":"Design","done":false,"project":"…","version":1}],
     "page":1,"pageSize":20,"total":1,"totalPages":1}
GET  /api/projects/<pid>
  → {"id":"…","name":"Apollo","version":1,"display":"Apollo"}
```

Values check out: camelCase keys, `done:false` survives as a real boolean (not
`"false"`), UUIDv7 ids, the association carried as a bare id, the `derived
display` materialised on the wire, an optimistic-concurrency `version` column,
and a paged envelope with real `total`/`totalPages`.

Invariant + type enforcement through the API, both RFC7807:

```
POST /api/projects {"name":""}                   → 422
  errors:[{"pointer":"/name","message":"Name must be at least 1 character"}]
POST /api/tasks {"done":"notabool", …}           → 422
  errors:[{"pointer":"/done","message":"Invalid input: expected boolean, received string"}]
```

Database truth (not the API's word for it):

```
\dt in public → "Did not find any tables"     ← tables are schema-namespaced per context
select table_schema, table_name … → drizzle.__drizzle_migrations, projects.projects, projects.tasks

Table "projects.projects": id uuid PK, name text not null, version integer not null default 1
Referenced by: tasks_project_fkey FOREIGN KEY (project) REFERENCES projects.projects(id) ON DELETE RESTRICT
rows: Apollo / version 1 ; Design / f / <pid> / 1
```

Real migrations, real FK with `ON DELETE RESTRICT`, real rows.

### Phase 0 verdict — time to first running app by an outsider

| | |
|---|---|
| Tool time on Loom's own path | **~2.9 min** (install 29s + new 1.3s + generate 1.5s + build/boot 58s) |
| Wall clock including the sandbox-CA detour | **37 min** |
| A non-sandboxed laptop with working egress would see | ~5 min |

This is the fastest zero-to-running-full-stack-with-a-real-database I have
measured from any tool. The headline "speed of no-code" claim is **Verified** at
this scale. Everything after this is about what happens next.


---

## Phase 1 — modelling FieldOps

Slices, each parsed before moving on. `eval/fieldops/s1…s6.ddd` are the
checkpoints; `fieldops.ddd` is the final model (354 meaningful lines).

| slice | content | result |
|---|---|---|
| s1 | tenancy skeleton, Customer→Site→Asset | 7 errors first try — all one honest class (`loom.context-filter-unsupported` / `loom.stamp-principal-without-auth`: a tenancy filter needs `auth: required`). Fixed in 3 min. |
| s2 | WorkOrder lifecycle, guarded transitions, line items, Money + single-currency invariant, Technician skills, enums, events | **clean first try** |
| s3 | Part stock + `scheduleWorkOrder` + `completeWorkOrder` | `loom.workflow-foreach-source`, then `loom.workflow-foreach-unknown-binding` → **F-004, not expressible** |
| s4 | permissions, `mask unless`, row-level find | `loom.find-where-not-queryable` → **F-005**; later **F-007** (crash) |
| s5 | Invoice (immutable + audited), dashboard projections, paged list, cross-tenant report | header-order parse error (my mistake, exact line:col); a genuinely smart warning: `loom.unique-missing-tenant-scope` — "`unique (number)` … omits the tenant discriminator — this is a GLOBAL unique across all tenants" |
| s6 | channel + notifier deployable, object store, payment api, mailer | `loom.workflow-correlation-required` — told me exactly what to add |
| final | inline tests, api + ui e2e, traceability | clean |

**Requirement classification.**

*Expressed directly (17):* aggregates/entities/containment · value objects + invariants ·
enums · optional & collection types · derived fields · pure functions · operations with
preconditions · `when` state guards + `can_*` companions · events · repositories ·
cross-aggregate `X id` · criterion/retrieval · projections with `group by` · capabilities
(`tenantOwned`, `audited`, `crudish`) · transactional workflows · resources (objectStore /
api / mailer) · channels + a notifier deployable · traceability + inline/e2e tests ·
`mask unless` field redaction · `unique` with a tenant-scope warning.

*Expressed awkwardly (3):*
- **Part usage** — lifted out of `WorkOrderLine` into its own aggregate + criterion +
  retrieval to try to satisfy F-004. Didn't help; reverted to one-part-per-call.
- **Dashboard totals** — a stored `totalAmount` column mirroring the `derived total`,
  because a projection can't aggregate a derived (F-006) or a VO sub-field (F-011).
- **Row-level visibility** — degraded to an unconditional owner filter; the admin
  override has no expression (F-005 + F-007).

*NOT expressible (3) — this phase's real output:*
1. **"For each part used, decrement stock, transactionally."** `for x in Repo.run(...)`
   exists and `let x = Repo.getById(...)` exists, but not both: a `for` body may not load
   another aggregate. Two model shapes tried, both refused. (F-004)
2. **"A technician sees only their own work orders; an admin sees all."** The
   permission-catalogue spelling is honestly refused as non-queryable; every other
   spelling that mentions `currentUser` beyond `.id` passes validation and crashes
   codegen. (F-005 + F-007)
3. **A second language for the work-order UI.** The translator workflow and the
   generated runtime are not connected. (F-034)

Time: **~2 h 20 m**, of which ~1 h 20 m was on the three walls above.

## Phase 2 — running it

Build: `docker compose up -d --build` → 8 services (postgres, keycloak, valkey,
MinIO, Mailpit, api, notifier, web) in **62 s** cold after the MinIO image fix (F-013).
Full create → schedule → start → complete round-trip passes with correct values
(money as 4-dp strings, derived `total` = 2×50 = 100, enums as strings, optionals as
`null`, ISO-8601 timestamps, `version` incrementing). Guarded transition → 409
`Disallowed`; precondition → 422 with my own message; cross-field invariant → 422;
transactional rollback verified (stock stayed at 1 after a failed workflow).
**Tenant isolation held on all eight attack vectors** (POSITIVE-01) and is real in
the SQL, not just the DTO layer. Field masking correct and fail-closed.
The broker publishes correctly and **drops every event** (F-019).
Time: **~1 h 40 m** including 25 min hand-configuring Keycloak (F-016).

## Phase 3 — breadth

Same model, `platform:` substituted. All five generate with `0 error(s)`. One
compiles. Details and per-backend defects in F-022…F-028, F-033.
Time: **~1 h 30 m** (builds run in parallel).

## Phase 4 — depth

Folded into Phases 2/3/6; coverage checklist is in the report.

## Phase 5 — evolution

Additive in a clean dir → **live outage** (F-029). Additive in place → flawless.
Five breaking changes → four refused with excellent diagnostics, one (single rename)
correctly auto-detected and data-preserving (POSITIVE-02). Hand-edits → 5 of 6
silently clobbered; `.loomignore` works exactly as documented but the files you'd
need to pin are the ones the docs tell you not to (F-031). 39 aggregates: generation
flat, output does not compile (POSITIVE-03, F-030).
Time: **~1 h 45 m**.

## Phase 6 — adversarial + reconciliation

Ten broken files: 9 excellent diagnostics, 1 poor (POSITIVE-04). `trace` /
`breakpoints` / `verify` / `i18n` exercised (POSITIVE-05, F-034, F-035).
Internal material read last: the maintainers have my exact taxonomy and say so in
their own roadmap (F-037).
Time: **~1 h 15 m**.

## Phase 6b — Clearline (the second model)

Built to reach what FieldOps didn't: `abstract aggregate` + three `extends` subtypes
sharing one queue, TPH vs TPC, a discriminated union of decision outcomes, and an
authority-limit rule depending on both the record's amount and the actor's claim.

196 lines. Six honest refusals on the way in, each one informative:

| attempt | diagnostic |
|---|---|
| field named `policy` | `Expecting token of type '}' but found 'policy'` — another reserved word (F-032) |
| projection field named `claims` | same shape |
| `repository Claims for Claim` on the abstract base | *"'Claim' is an abstract aggregate and has no repository of its own. Repositories belong to concrete subtypes."* |
| `` `reserve {setAt}` `` | *"Cannot interpolate a 'datetime' … Convert it first (e.g. wrap in a 'derived' that formats it)."* |
| two `kind: api` resources on one context | *"Deployable 'api' has two dataSources for (Handling, kind: api): 'ocrApi' and 'fraudApi'. Pick exactly one per (context, kind)."* (F-042) |
| `derived withinMyAuthority = amount.amount <= money(currentUser.authorityLimit)` | `loom.currentuser-not-in-request-scope` (F-043) |

Then: `0 error(s), 3 warning(s)` → `Wrote 164 file(s)` → **`tsc --noEmit`: 8 errors**
(F-039, F-040, F-041, F-030). TPH DDL read and verified correct. TPH → TPC: **5
errors, no path** (F-038).
Time: **~1 h 15 m.**

**Total elapsed: ~10 h.**

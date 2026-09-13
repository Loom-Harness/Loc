# Loom — build-on-it evaluation for the architecture council

**Author:** staff engineering, platform · **Date:** 2026-09-13 · **Effort:** one-day timeboxed spike
**Subject:** `Loom-Harness/Loc` @ `09427a5` · **Method:** everything below was executed, not read.

---

## 1. Recommendation

> ### **Pilot on a non-critical project only.**

Loom's compiler is genuinely good and its migration story is better than what most of our teams
hand-roll — but **none of the five advertised backends compiled the app I wrote without me patching
the generated source**, and on .NET and Java the generated service boots healthy and then fails
*every single write* with a 500. That is not a maturity curve you put a flagship B2B product on.

**We would move to "Adopt with conditions" when all five of these are true** (each checkable in an
afternoon):

| # | Condition | How we verify it |
|---|---|---|
| C1 | A model *we* write — not a vendor example — generates and **compiles clean on all five backends** with zero hand patches. | Re-run `eval/fieldops/main-devauth.ddd` through the matrix in §4. Today: 0/5. |
| C2 | `tenantOwned + auditable` (the default shape of every B2B record) **writes successfully on all five backends** at runtime. | Re-run the round-trip in §7. Today: F-035 breaks .NET and Java. |
| C3 | Loom publishes **versioned, tagged releases with a changelog**, and generated projects ship a **dependency lockfile**. | `git tag`, `CHANGELOG.md`, `find <out> -name '*lock*'`. Today: none, none. |
| C4 | The **generated OIDC login flow works end to end** on the stack Loom itself emits, with no hand edits. | `docker compose up` + a browser login. Today: F-024, two hand fixes needed. |
| C5 | A **second maintainer** with merge rights, and a stated support/response commitment. | Today: 1 human, 80% of commits authored by an AI agent. |

**We would move to "Do not adopt"** if C1 is still false in six months, or if the project's single
human maintainer stops.

---

## 2. Executive summary

**What it is.** You write one file describing your domain — aggregates, invariants, operations,
workflows, permissions, tenancy, pages — and Loom generates a complete, runnable system: backend,
database migrations, REST API with OpenAPI, a SPA, docker-compose, an end-to-end test suite and a
Helm chart. You keep the generated source; there is no runtime to license.

**What it genuinely does well.** The modelling language is expressive and its diagnostics are better
than most commercial compilers — 8 of 10 deliberately-broken files got a precise, actionable error
with a suggested fix. Multi-tenant isolation, which is the thing we would be buying it for, is
**airtight in the code I ran**: a second tenant could not list, read, mutate or read the audit
history of the first tenant's data, and a malformed or missing tenant claim fails closed. A
transactional stock-decrement across aggregates rolled back correctly at `serializable`. The
migration engine detected a column rename on a populated table and preserved the data, and refused —
with exit code 1 and a named fix — to drop a populated column or to add a NOT NULL constraint over
NULL rows. Generation is byte-deterministic, so the output is reviewable. An outsider got from
`git clone` to a running, HTTP-verified full stack in about **four minutes** of hands-on work.

**What it cannot do.** It cannot reliably produce code that compiles. From one 594-line model I
wrote, I found **16 separate defects where the toolchain reported success and the output did not
build or did not work** — a missing import, a private method called from generated code, a JS
reserved word used as a variable, a triple brace in JSX, a missing dependency injection, an unbound
Ecto variable, a namespace that cannot resolve. Every one was shallow (a 1–3 line fix). None was
caught by anything Loom runs. Three further inputs crashed the generator outright with a raw Node stack trace.
Beyond that, three structural limits shape how you would have to model: a `create` cannot run any
logic, a workflow cannot reach a repository in another bounded context (so bounded contexts collapse),
and the recommended security posture (`denyByDefault`) is incompatible with the CRUD macro and with
the scaffolded UI's reference pickers.

**The one-sentence version.** *Loom is a finished compiler wrapped in an unfinished product* — which
is, word for word, the verdict of the maintainers' own internal audit dated three days before this
one. I reached it independently, from the outside, in a day.

---

## 3. Claim verification matrix

Every claim is quoted verbatim from `README.md`. **Verified** = I executed it and it did what it says.

| # | Claim (verbatim) | Grade | Evidence |
|---|---|---|---|
| 1 | "The speed of no-code." | **Verified** | `ddd new` → `generate system` → `docker compose up` → verified HTTP read+write in **~4 min** hands-on (18 min wall in this sandbox, incl. a TLS detour the docs cover). 594 `.ddd` lines → 189 files / 20,657 lines (**35×**). |
| 2 | "The keys to the codebase … walk away with real, owned source code" | **Partially verified** | The source is real, readable, idiomatic and yours *legally*. But **every generated file is overwritten on every run** (docs/tools.md:203). Unpinned hand edits vanish with no warning. `.loomignore` works, and hands you the drift. **F-037** |
| 3 | "across five backends (Hono, .NET, Phoenix LiveView, Java/Spring Boot, Python/FastAPI)" | **Contradicted** | All five *generate*. **0 of 5 compiled my model unpatched.** Patches needed: node 3, .NET 2, python 2, java 3, elixir 1. **F-013…F-015, F-025…F-030** |
| 4 | "six frontends (React, Vue, Svelte, Angular, Feliz, Flutter)" | **Partially verified** | React (4 packs) `tsc` clean; Svelte `npm run build` clean. **Vue** and **Angular** fail their own build on ordinary constructs (**F-032**, **F-033**). Feliz and Flutter **unverified** — no toolchain here. |
| 5 | "No vendor lock-in." | **Verified** | Generator is FSL-1.1→Apache-2.0; generated code is MIT. The output is ordinary Hono/EF/Ecto/Spring/FastAPI you could maintain by hand. (README overstates one detail: `ddd generate` does **not** emit the MIT LICENSE file — **F-045**.) |
| 6 | "No scaling cliff." | **Verified** at the size tested | 8 → **40 aggregates**: parse 2.9s→7.8s, generate 3.9s→8.0s, 442 files / 51,005 lines, generated `tsc --noEmit` 18s clean. Roughly linear, no cliff. Untested beyond 40. |
| 7 | "No drift between layers." | **Contradicted** | Three measured drifts: the deny-by-default `find all(): T[]` shape breaks every scaffolded FK picker (**F-018**); a `ui` scaffolding an unserved subdomain emits pages against an api client that was never generated (**F-019**, a *documented* validator obligation that does not fire); the .NET/Java `@PrePersist` stamp omits the columns the same tool marked `NOT NULL` (**F-035**). |
| 8 | "Thirteen design packs … swap any time" | **Verified** (React), partially elsewhere | 4 React packs generated and typechecked **0 errors** each. vuetify / shadcnSvelte / angularMaterial generate. The pack↔framework validator is excellent; the Feliz one suggests a value the grammar rejects (**F-031**). |
| 9 | "Pick a runtime per deployable. Switch any time." | **Partially verified** | The *switch* really is one line (`platform:`) — verified on all five backends and six frontends. The cost is not the switch; it is that the target you switch to may not compile (claims 3–4). |
| 10 | "Identical API contracts" | **Partially verified** | node vs python, same model, both booted, one identical probe: **every status code, the paged envelope, the full field set, money precision, enums, nulls, containment, tenancy 404s and field masking matched exactly.** Two diverged: `decimal` serialises `2` vs `2.0`, and python returns Pydantic's raw message (echoing the regex) instead of Loom's derived text. **F-034**. Sample: 2 of 5, at runtime. |
| 11 | "Built-in traceability … `ddd verify` … per-requirement Definition-of-Done verdicts" | **Verified** | `requirement`/`solution`/`testCase` parse; `ddd verify` produced `.loom/verification.{json,md,mmd}`, a correct rollup, and **exit 1** on a failing requirement. You write the runner-JSON adapter yourself (documented). |
| 12 | "LLM-safe by construction … Validation gates catch hallucinated fields … before any code is emitted" | **Partially verified** | True **at the model layer**: a hallucinated field is rejected (`ok:false`) through `loom_validate`; 14 agent tools work. **Not true of the output**: 16 of my findings are models that validate `ok:true` and then fail to compile — and 3 crash the generator *after* validation passes. |
| 13 | "Browser playground … typed editor … visual system builder … live preview … in-browser test runner" | **Partially verified** | The advertised URL is **404** — the project changed GitHub org and the README didn't (**F-043**). Built and served it locally: loads clean, validates (0 errors) and generates **107 files in the browser**, with Explorer/Diagrams/API/Traceability/Builder/Chat tabs and no page errors. "Boot" showed *blocked*. **Smoke-tested only** — I could not drive a 600-line paste through Monaco headlessly. |
| 14 | "`docker compose up -d` → everything running" | **Contradicted, then verified after 1 fix** | The generated compose pins `minio/minio:latest`, which **no longer exists on Docker Hub** — compose aborts before any service starts (**F-020**). With one image fix, all 7 services came up healthy in 1m27s. |
| 15 | "1,300+ test files / 9,000+ tests" | **Verified (exceeded)** | 2,070 `*.test.ts`, ~15,740 `it(`/`test(` call sites, 67 workflows, 493 `loom.*` diagnostic codes, 915 source files / 352,848 LOC. |
| 16 | "Generated migrations (Drizzle / EF Core / Ecto / JPA / SQLAlchemy)" | **Verified** | Incremental deltas derived from the model diff; rename detection; destructive-change gate; declarative backfills. See §7. The best part of the product. |

---

## 4. Target matrix

One model (`eval/fieldops/main-devauth.ddd`, 594 lines). Toolchains run in docker.

### Backends
| backend | generates | **compiles** | patches to compile | boots | wire-probed at runtime |
|---|---|---|---|---|---|
| node · Hono + Drizzle | ✅ 178 files | ❌ → ✅ | **3** (F-013, F-014, F-015) | ✅ | ✅ **reference** — full round-trip, tenancy, errors, rollback |
| dotnet · ASP.NET + EF | ✅ 401 files | ❌ → ✅ | **2** (F-025, F-015) | ✅ healthy | ❌ **every create 500s** (F-035) |
| python · FastAPI + SQLAlchemy | ✅ 189 files | ⚠ compiles & imports; **mypy finds 3** | **2** (F-026, F-027) | ✅ | ✅ — 2 wire diffs vs node (F-034) |
| java · Spring Boot + JPA | ✅ 317 files | ❌ → ✅ | **3** (F-028, F-015×2) | *not booted* | *unverified* — F-035 present statically |
| elixir · Phoenix + Ecto | ✅ 284 files | ❌ → ✅ (fails `--warnings-as-errors`) | **1** (F-029) | *not booted* | *unverified* |

### Frontends
| frontend | generates | **builds** | notes |
|---|---|---|---|
| react · mantine / shadcn / mui / chakra | ✅ | ✅ **0 tsc errors, all four packs** | the real path |
| svelte · shadcnSvelte | ✅ | ✅ `npm run build` — 0 errors, 0 warnings | |
| vue · vuetify | ✅ | ❌ `vue-tsc` fails on a nullable `X id` (F-032) | |
| angular · angularMaterial | ✅ | ❌ `ng build` fails on a `string[]` field (F-033) | also needs Node ≥ 22.22.3 |
| feliz (F#/Fable) | ✅ 118 files | **unverified** | no Fable toolchain in this environment |
| flutter (Dart) | ✅ 142 files | **unverified** | no Flutter SDK in this environment |

**Wire-identical**: verified only node↔python (see claim 10). Not measured for dotnet (broken), java,
elixir, or any frontend pair.

> The maintainers' own corpus explains the frontend column exactly: their `.ddd` corpus declares
> react 34 times, svelte 9, vue 6, flutter 3, feliz 2, angular 2 — a **17× skew**
> (`docs/audits/2026-09-10-independent-completeness-audit.md` §F9). The two frontends that broke for
> me are the two with almost no corpus behind them.

---

## 5. What it is actually like to use

### Hour 0 — cold start (headline number)
`npm install` 33s · `ddd new` 1.9s · `generate system` 1.9s · `docker compose up --build` 1m10s.
**~4 minutes of hands-on work to a running stack**, verified by HTTP, not by exit code:

```
POST /api/projects {"name":"Roof survey"} → 201 {"id":"01a09a1f-…"}   (uuidv7)
GET  /api/projects → {"items":[{…,"version":1,"display":"Roof survey"}],"page":1,"total":1}
GET  http://localhost:3001/ → 200  (React SPA)      GET /openapi.json → 7 paths
```
Migrations applied to an empty database with no manual step. This is a real result and it is the
best thing about the product.

### Hours 1–3 — modelling FieldOps (expressiveness)
Written from `docs/` alone; the first 128-line slice parsed **clean on the first try**. Expressed
directly, with no fight: aggregates + contained entities, enums, `money` with closed arithmetic,
guarded lifecycle transitions (`when` → 409), `unique (tenantId, serial)`, a collection invariant
across lines, `mask unless` field redaction, `tenantOwned` + `tenantRegistry`, a `permissions{}`
catalogue with `implies`, read gates, criteria, a grouped projection, traceability declarations,
api + ui e2e tests, and a hand-written dashboard page.

Three diagnostics caught real modelling bugs I made naturally — `unique (serial)` was global across
tenants; `GET /invoices/{id}/history` was reachable by any authenticated caller; 21 commands and
reads were ungated. I would not have caught the second one in review.

**Where the ceiling is** — three structural limits, not bugs:
1. **A `create` body cannot assign** (F-007). "A work order always starts in `Draft`", "stamp
   `issuedAt` server-side", "derive the invoice number" are not expressible at construction. Real
   construction logic becomes a `workflow` with its own HTTP route. 33 errors on my model from this
   one rule.
2. **A workflow cannot reach another context's repository** (F-009). FieldOps' stated requirement —
   completing a work order decrements part stock atomically — spans Field and Inventory. To express
   it I had to **merge the two bounded contexts**. Loom's real consistency boundary is the *context*,
   not the aggregate. Design your contexts accordingly on day one.
3. **`with crudish` and `enforcement: denyByDefault` cannot be combined** (F-008). The recommended
   security posture forbids the CRUD macro on every aggregate; I hand-wrote ~90 lines of
   create/update/destroy boilerplate that the macro exists to remove.

Plus one shape the language forces: `for` can only iterate a repository result, and a `let` inside a
`for` body is rejected (F-002) — so per-child cross-aggregate writes push the child out of its
containment boundary into its own aggregate. You can have a `derived total` over contained lines, or
per-line cross-aggregate writes. Not both.

### Hours 3–6 — running it (where it fell over)
`tsc --noEmit` on the generated backend: **4 errors, 3 distinct bugs.** On the frontend: **10 errors,
3 distinct bugs.** All from a model that `ddd parse` and `ddd generate system` both accepted with
exit code 0. Once patched, everything worked — and worked well (§7).

### Hours 6–9 — six months of product work in an afternoon
Additive change: 3.9s, a scoped 34-file diff, a correct incremental `ALTER TABLE`. Rename of a
populated column: auto-detected, data preserved. Destructive change: refused with a named fix.
Regeneration: **clobbered every patch, silently, every time** — I ended up scripting the re-patch
(`eval/repatch.sh`). The `.loomignore` escape hatch works and is honest; pinning then transfers
drift ownership to you, and the compiler catches that drift on typed backends but not on Python or
Elixir.

**Answer to "you own the source":** you own it until the next `ddd generate`. Pin a file and you own
keeping it in sync with the model. That is a defensible, clearly documented contract — it is simply
not what "the keys to the codebase" implies.

---

## 6. Gap register

**45 findings: 16 S1 · 16 S2 · 12 S3 · 1 S4.**
**Class split: 25 SILENT · 10 HONEST · 3 CRASH · 3 CONTRADICTED-doc · 2 DOCUMENTED · 2 other.**

The ratio is the story. **25 silent to 10 honest.** A mature generator has the opposite ratio: it
refuses what it cannot do. Loom refuses beautifully when it refuses at all — its honest gaps are
among the best diagnostics I have used — but its dominant failure mode is exit code 0 over broken
output.

### S1 — cannot ship (16, all SILENT)
Thirteen are "the generated code does not compile"; three are "it compiles, boots, and is wrong".

| ID | One line | Blast radius |
|---|---|---|
| **F-035** | `tenantOwned` + `auditable` → .NET/Java drop the `createdAt`/`createdBy` stamp; **every create 500s** against the NOT NULL column the same tool emitted | **the default shape of every B2B record** |
| F-018 | Declaring `find all(): T[]` — which deny-by-default *forces* — breaks every scaffolded FK picker | 8 of 14 pages in my model |
| F-024 | The generated OIDC login fails against the generated Keycloak realm (`offline_access`), then redirects to a 404 | the single most visible user path |
| F-027 | python: cross-context `X id` used without its import → `NameError` at request time; invisible to `compileall` *and* to `import` | any multi-context python deployable |
| F-015/026 | a workflow calling an aggregate `function` emits a call to a `private` method — **node, .NET, python, java** | cross-aggregate business rules |
| F-013 | `!=` in a filter emits Drizzle `ne(...)` and never imports it | any model with `!=` in a `where` |
| F-014 | an FK compared to a **nullable** user claim emits uncompilable Drizzle | row-level visibility |
| F-016 | an operation named `void` emits `const void = …` | any reserved-word domain verb |
| F-017 | `Chart` emits `yAxisProps={{{` | the only charting primitive |
| F-019 | a `ui` scaffolding an unserved subdomain emits pages against a missing api client — a **documented** validator obligation that does not fire | any multi-deployable system |
| F-025 | .NET channel transport emits an unqualified namespace that binds to the wrong one | .NET + any broker |
| F-028 | java never injects a repository used inside `for`→`if let` | java + the shape F-002 forces on you |
| F-029 | elixir emits an **unbound** `current_user` in an Ecto query (the other four are correct) | row-level visibility on Phoenix |
| F-032 | vue: a nullable `X id` breaks `vue-tsc` | any optional FK |
| F-033 | angular: a `string[]` field initialises to `null` | any tags/skills/roles field |

### S2 — major (16)
`create` cannot run logic (F-007) · no cross-context workflows (F-009) · `crudish` ⊥ deny-by-default
(F-008) · `let` in a `for` body rejected (F-002) · **two generator crashes with raw stack traces**
(F-011 page gate naming a permission; F-012 e2e + multi-word aggregate + second deployable) · a third
crash on cyclic containment (F-040) · compose references a dead image (F-020) · optimistic
concurrency is off by default and the generated UI never sends the precondition (F-023) · node↔python
wire divergence (F-034) · `string`→`enum` leaves unvalidated legacy rows served as valid (F-036) ·
hand edits silently clobbered (F-037) · **no lockfile in any generated project** (F-038) · **no
version tags, no changelog, no releases** (F-039) · the Keycloak realm carries none of the declared
claims (F-022) · the i18n catalog never reaches the generated app (F-044).

### S3/S4 — friction (13)
Mostly documentation: the dev-claims example in the docs doesn't work (F-021), the live-site links
are 404 (F-043), the README's LICENSE claim is wrong (F-045), the tenancy-bootstrap example is
unreachable (F-005), `create` params are ignored contrary to the docs (F-006), deny-by-default forces
the construct the linter deprecates (F-010), a Feliz fixit that doesn't parse (F-031), a false-positive
`transactional-no-effect` warning (F-004), a page-body typo that no validator catches (F-041),
`ddd trace` cannot read a production trace (F-042), elixir fails its own `--warnings-as-errors` gate
(F-030), `this.id` unusable in a criterion (F-003), the starter template warns on its own output (F-001).

---

## 7. What genuinely works — verified, at runtime

I want the council to weigh these as heavily as the gap register. Each was executed.

**Tenant isolation is airtight in the generated code, not just the model.** Two principals, same
API, node backend:
```
A lists work orders                  → total 1
B lists work orders                  → total 0
B GET   /work_orders/{A's id}        → 404   (existence hidden)
B POST  /work_orders/{A's id}/cancel → 404
B GET   /work_orders/{A's id}/history→ 404
tenantId = "" / claim absent         → empty list      (fail-closed)
tenantId = "' OR '1'='1"             → 0 rows          (parameterised; no injection)
```

**Transactional cross-aggregate rollback works.** Part stock 3, usages 2 + 5:
```
POST /workflows/complete_work_order → 422 {"detail":"insufficient stock"}
GET  /parts/{id}       → stockOnHand = 3      ← the 2-unit decrement rolled back
GET  /work_orders/{id} → status = InProgress  ← not completed
```

**The error contract is correct and RFC 7807 throughout.** invariant → 422 with a field pointer ·
`when` state gate → 409 · `requires` → 403 · unauthenticated → 401 · missing → 404. `mask unless`
redacted a technician's cost rate to `null` for an unprivileged caller and returned it for an
authorised one.

**Values are right.** `money` survives the wire as an exact decimal string (`"50.2500"` → subtotal
`"100.5000"` → derived total `"100.5000"`); enums are strings; nullables are `null`; containment
round-trips; audit columns stamp the acting principal; a `version` column is maintained.

**Migrations are the strongest single component.** Rename of a populated column detected
automatically and applied as `RENAME COLUMN` with zero data loss; `DROP COLUMN` on populated data
refused with exit 1; `SET NOT NULL` over NULL rows refused, then made safe by a declarative
`migration "…" { Site.addressLine = "unknown" }` block that emitted `UPDATE … WHERE IS NULL` +
`SET NOT NULL`. I could not get it to destroy data.

**Diagnostics.** 8 of 10 broken models produced a precise, actionable error — several restate the
whole rule inline ("Allowed for money: money ± money, money × {int|long|decimal}…") or give a fixit
("write `Customer id`", "did you mean 'total'?").

**The customization gradient is real.** Override-by-name replaced exactly one scaffolded page (4
files changed). `unfold` ejected genuine `.ddd` source that parses clean and **regenerates
byte-identical output**. Generation itself is deterministic: the same model into two fresh
directories produced **0** differing files.

**Ops.** `/health` `/ready` `/metrics` `/openapi.json` all 200; structured JSON logs with
`request_id`/`trace_id`/`span_id`; an opt-in Prometheus+Jaeger overlay; `--k8s` emits a Helm chart
that **`helm lint`s clean** with a proper secret/config split.

---

## 8. Risk register

| Risk | L | I | Evidence | Mitigation |
|---|---|---|---|---|
| **Generated code doesn't compile on the target we pick** | **High** | **High** | 0/5 backends, 2/4 buildable frontends | Pick node+React (the only pair that compiled clean) and treat the other nine as unavailable. Add a "compile the generated output" job to *our* CI on every model change. |
| **A silent runtime defect reaches production** | **High** | **High** | F-035 (.NET/Java every write 500s), F-027 (python NameError at request time), F-023 (lost updates) | Our own e2e suite against the generated stack, per target, per release. Do not trust "generation succeeded". |
| **Bus factor = 1** | Medium | **High** | 131 of 668 commits from one human; **536 from an AI agent**; no second maintainer | Vendor the toolchain at a pinned SHA. Budget for owning the fork. |
| **No release engineering** | **High** | Medium | 0 tags, 0 releases, no changelog, version `0.1.0`; no lockfile in generated projects | Pin a SHA, commit the generated tree, commit lockfiles, gate regeneration behind review. |
| **Unstable `main`** | **High** | Medium | **~50 of 92 issues are auto-filed "🔴 main is red"** in 14 days; 4 open "flaky gate" issues | Never track `main`. Upgrade deliberately, re-run C1/C2 each time. |
| **Abstraction ceiling forces model compromises** | Medium | **High** | F-007, F-009 (contexts collapse), F-008 | Prototype the three hardest use cases in `.ddd` *before* committing. Accept context = consistency boundary. |
| **Supply chain** | Medium | **High** | No lockfile, caret ranges, no dependabot/audit gate on either surface; 11 advisories (4 high) in the toolchain's dev tree | Commit lockfiles; run our own SCA on the generated tree. |
| **Exit cost** | Low | Medium | The output is ordinary Hono/EF/Ecto/Spring/FastAPI; MIT-licensed | See §10. This risk is genuinely low — the best structural property of the product. |
| **Hiring / onboarding** | Medium | Medium | ~25k lines of docs; I was productive in ~2h, blocked for ~6h on generator bugs | Budget 1 week to productive, 1 month to fluent. The *DSL* is easy; the *failure modes* are the learning curve. |

---

## 9. Fit analysis

**Clearly good for:** internal CRUD-shaped line-of-business apps; a well-understood domain with many
similar aggregates; anything where multi-tenant isolation correctness matters more than UI
distinctiveness; prototypes and pitch demos; a team already on Node+React that wants to stop writing
the same repository/route/form/migration layer.

**Clearly wrong for:** anything where the UI *is* the product; real-time/streaming/collaborative
systems; heavy analytical read paths (no window functions, no full-text search, no sorting on a
derived field, no ordering on a projection); a team that wants to pick .NET, Java, Elixir, Vue or
Angular today; anything under a compliance regime that needs reproducible builds.

**Where our next product falls:** multi-tenant B2B with a rich operational UI. The domain half is
squarely in Loom's sweet spot and the tenancy work alone would save us real months. The UI half and
the "we might want .NET" half are exactly where it is weakest. That is why the answer is *pilot*,
not *no* — and why the pilot should be a real internal tool on **node + React**, nothing else.

---

## 10. Comparison with the alternatives

| | Loom | Framework + AI assistant | No/low-code (Retool, OutSystems) | In-house scaffolding |
|---|---|---|---|---|
| Time to first app | **~4 min** (measured) | ~1 day | ~1 hour | n/a — months to build |
| Consistency across layers | **Enforced by the compiler** | Drifts after a few prompts | Enforced, inside the platform | Whatever we enforce |
| Multi-tenant isolation | **Compile-time stance + verified airtight at runtime** | Hand-written; the leak is a matter of time | Platform-provided, opaque | Hand-written |
| Migrations | **Derived, rename-aware, destructive-gated** (best in class here) | Hand-written | Platform-managed | Hand-written |
| Output compiles | **0/5 backends unpatched** | Always (you iterate until it does) | n/a | Always |
| Ownership / exit | Real source, MIT | Real source | **None** — rewrite | Total |
| Vendor risk | **1 human maintainer, 0 releases** | None | Priced, contractual | None |
| Cost to change the abstraction | Wait for upstream, or fork | Nothing | Impossible | Our sprint |

**Against a framework + an AI assistant** — today's realistic default — Loom wins decisively on
*consistency*: the model is the single source of truth, and a hallucinated field is a compile error
rather than a bug. It loses on *reliability of the output*, which is the one thing the assistant path
never gets wrong because you iterate until the code builds. Loom's pitch is that you shouldn't have
to iterate. Today you do, and you iterate on generated code you don't own the next morning.

**Exit cost if we abandon Loom in year two:** genuinely low, and this is its best structural
property. We keep the generated tree — a normal Hono+Drizzle+Postgres app and a normal React app,
MIT-licensed, with real migrations and a real test suite. We delete the `.ddd` file and the
`.loom/` directory and carry on. What we lose is the regeneration leverage and, for the first few
months, engineers who know the domain through the model rather than the code. Call it **two to four
weeks of re-orientation, not a rewrite.**

---

## 11. Reconciliation with the maintainers' own material

Read only after the evaluation was complete.

1. **They already know.** `docs/audits/2026-09-10-independent-completeness-audit.md` — three days
   before mine — opens with: *"Loom is a finished compiler wrapped in an unfinished product."* Its
   F4 is my F-039 (cannot be installed: no tags, no releases, no publish workflow). Its F5 is my
   F-038 (no lockfile, no advisory gate). Its F8 names verification tiers CI can never run. Its F9
   measures the 17× frontend corpus skew that explains exactly why Vue and Angular broke for me and
   React did not. **The self-assessment is unusually honest and largely correct.**
2. **The one place they measured wrong.** That audit's §2 says *"Generated output is clean"* —
   established by grepping 1,153 emitted files for `loom:unrendered` / `TODO` markers, over **three
   of their own example models**. I measured the same property with a compiler, over **a model I
   wrote**, and got 16 defects in an afternoon. Marker debt is not compilability, and the vendor
   corpus is not a customer's domain. That gap between instrument and claim is the single most
   important thing on this page.
3. **The failure class is named in their own retrospective.** `experience_gathered.md` §104
   (2026-09-09): *"The fast suite asserts on emitted TEXT, so a name that does not resolve is
   invisible to it… `npm test` cannot catch this class, structurally."* That is precisely F-013 (a
   missing Drizzle operator import) and F-027 (missing id-type imports in python). They wrote the
   lesson down four days before I re-discovered two fresh instances of it.
4. **Closed issues are the same shapes:** #2549 "Phoenix drops money to 2 decimal places through the
   projection-aggregation path", #2563 ".NET truncates a wire decimal", #2548 "`/api/auth/me` returns
   a different principal shape on node and phoenix", #1796 "Vanilla Elixir: relational operations
   silently drop their writes", #2433 "Flutter: a zero-parameter find emits invalid Dart",
   #763 "Guarded workflows return 500 on Phoenix and .NET (should be 403)". Open right now: #2649, a
   node emitter calling a handle that was never threaded — the same shape as my F-028.
5. **Overclaiming in user-facing docs is itself a finding**, and there is some: five backends and six
   frontends presented as equivalent when two of them cannot build an ordinary model; "no drift
   between layers" with three measured drifts; a live site that 404s; a LICENSE the CLI doesn't
   write; a dev-claims example that doesn't work. None is malicious — all are a fast-moving project's
   docs outrunning its gates — but a buyer reading only the README would form a materially wrong
   picture.
6. **Project health, plainly.** 668 commits over ~14 days of visible history. **536 by
   `Claude <noreply@anthropic.com>`; 131 by one human.** ~50 auto-filed "main is red" issues in that
   window. Zero releases, zero tags, no changelog. 67 CI workflows and 2,070 test files — the *gate
   machinery* is serious, and the merge queue, the pr-gate aggregate check and the mutation-proof
   discipline documented in the repo are better than most commercial projects. **The vendor risk is
   not "will they build it" — they are building it extraordinarily fast. The risk is that the whole
   thing depends on one person plus an agent fleet, with no release contract, and no way for us to
   pin a version or read what changed.**

---

## 12. Top 10 fixes, ranked by adoption impact

1. **Fix F-035** — `tenantOwned + auditable` must write on .NET and Java. Today the most common B2B
   aggregate shape 500s on two of five backends.
2. **Compile the generated output of a NON-vendor model, per backend, per PR.** Every one of my 16
   S1s dies here. A fuzz-generated or contributor-supplied corpus, not `examples/`.
3. **Ship releases**: tags, a changelog, semver, and a lockfile in every generated project. Until
   then Loom cannot be depended on by anyone who has to answer "what version are we on?".
4. **Make the OIDC demo path work end to end** (F-024, F-022): grant `offline_access` in the emitted
   realm, set `OIDC_POST_LOGIN_REDIRECT`, and seed protocol mappers for the declared `user { … }`
   claims so the shipped stack can demonstrate its own authorization model.
5. **Close the deny-by-default interaction set** (F-008, F-010, F-018, F-011): give `crudish` a gate
   argument; stop warning about the `find all()` the security posture requires; make the FK picker
   follow the declared return shape; let a page gate name a permission instead of crashing.
6. **No generator crash without a `loom.*` diagnostic.** Three crashes (F-011, F-012, F-040) reached
   me as raw Node stack traces into `out/`. Any throw that escapes codegen is a missing validator.
7. **Fix the Vue and Angular build breaks** (F-032, F-033) and add a per-target corpus floor so the
   17× skew fails rather than accumulates.
8. **Warn or refuse on hand-edited files** before overwriting them (F-037) — even a
   "`N file(s) differ from the last generation; overwrite? [--force]`" would end the whole class.
9. **Connect the i18n halves** (F-044): emit every `locales/*.json` and register it in the generated
   runtime.
10. **Fix the docs a buyer reads first**: the 404 live-site links, the LICENSE claim, the dev-claims
    example, the tenancy-bootstrap example, and the five-backends/six-frontends framing.

---

## 13. Coverage and limits of this evaluation

**What I did.** Built a 594-line multi-tenant B2B model from the docs; generated it onto 5 backends
and 6 frontends; compiled 5 backends and 4 frontends in real toolchains under docker; booted 3 full
stacks against Postgres; drove them with HTTP probes including tenancy, authorization, masking,
concurrency and SQL-injection attempts; exercised 6 schema-evolution scenarios against a database
with real rows; ran the generated e2e suite (3/3 pass) and `ddd verify`; wrote 10 deliberately
broken models; exercised `--sourcemap`/`trace`/`breakpoints`, the 14-tool agent surface, the i18n
CLI, `--k8s` + `helm lint`, and the playground built locally; scaled the model to 40 aggregates.
Every S1/S2 has a minimal reproduction in `eval/repro/`.

**What I did not do — do not infer coverage here.**
- **Feliz and Flutter are unverified.** No Fable or Flutter toolchain in this environment. They
  generate; whether they build is unknown.
- **Java and Elixir were compiled but never booted.** F-035 is confirmed statically on Java, not at
  runtime.
- **Wire parity was measured for exactly one backend pair** (node↔python). Four pairs untested.
- **The playground is smoke-tested only.** I could not paste a 600-line model through Monaco
  headlessly; the "visual system builder", "live preview" and "in-browser test runner" claims are
  **unverified**, only observed as present.
- Event sourcing (`persistedAs: eventLog`), aggregate inheritance (TPH/TPC), `extern`, domain
  services, provenance/`ddd snapshot`, the DAP adapter, `ddd patch`, the MCP server over a real
  transport, brokers at runtime (rabbitmq/kafka), and the conformance/Schemathesis harness were
  **not tested** — generated-only or not touched.
- I did not test beyond 40 aggregates, nor with a large data volume, nor under concurrency.
- **Disclosure:** this environment injected the maintainers' `CLAUDE.md` into my context at session
  start, so the Phase 0–6 blindness to internal material was imperfect for that one file. I did not
  consult it for answers — every finding below came from the public docs, the CLI, and execution —
  but the council should know.

**Where my confidence is low:** the Feliz/Flutter row; whether the 16 S1s are the whole set or a
sample (I stopped looking, I did not run out); and how fast the team fixes them — the closed-issue
history says *very* fast, which is the main reason this is a pilot recommendation and not a refusal.

---

## Appendix A — Appendix-B questions, answered directly

1. **How long to a running app?** ~4 min hands-on (18 min wall here). To model a realistic domain:
   ~3 hours to a clean parse, ~6 more to a running system because of generator bugs. To make the
   first breaking change safely: ~20 minutes, and it was safe.
2. **What can the DSL not express?** Construction-time logic (F-007); cross-context transactional
   orchestration (F-009); a `let` inside a loop (F-002); an identity criterion (F-003); page gates
   over permissions (F-011); group-by/window/full-text/derived-field-sorting read paths; array
   editing in forms. You escape via workflows, by merging contexts, or by owning a hand-written page.
3. **What happens when you regenerate over hand edits?** They are overwritten, silently, with no
   backup — unless listed in `.loomignore`, which preserves them and hands you the drift.
4. **Can a breaking schema change ship against production without data loss?** **Yes, demonstrated.**
   Renames preserve data automatically; drops and NOT NULL flips are refused with exit 1 and a named
   declarative fix. The one blind spot is `string`→`enum` (F-036).
5. **Is tenant isolation airtight in the generated code?** On node, **yes** — verified by probe, and
   fail-closed on a missing or malformed claim. Unverified on java/elixir; .NET could not be
   exercised because writes 500.
6. **Are the five backends and six frontends interchangeable?** **No.** node+React is the real path.
   The others are between "one patch away" and "unverified".
7. **Could our SRE team operate it? Could our engineers debug it?** Operate: yes — health/ready/
   metrics, structured logs with trace ids, a lint-clean Helm chart. Two fixes needed: no `restart:`
   policy, and no lockfile. Debug: partly — `ddd breakpoints` maps a model line to generated
   `file:line:col` precisely, but `ddd trace` cannot read a production stack trace because the
   shipped image is a bundle run without source maps (F-042).
8. **Exit cost in year two?** Two to four weeks of re-orientation. We keep everything.
9. **The most likely way this blows up:** we pilot on node+React, it works, we grow confident, and
   then a second team picks .NET or Vue — or we add an `auditable` tenant aggregate on .NET — and
   discover the target was never really there. **Early warning:** run condition C1 (compile the
   generated output of *our* model on *every* target) in our own CI from day one. The day it goes
   from 1/5 to 5/5 is the day this becomes an "Adopt".
10. **Verdict:** **Pilot on a non-critical project only**, on node + React, with C1–C5 as the exit
    criteria from pilot to adoption.

---

## Appendix B — feature coverage (the brief's checklist)

**exercised** = used in FieldOps or a dedicated repro AND the result observed at compile or run time ·
**smoke** = generated and eyeballed, not compiled/run · **not tested** = untouched.

### Language core
| Feature | | Verdict |
|---|---|---|
| aggregates, entities, containment | exercised | ✅ works, round-trips over the wire |
| value objects + invariants | exercised | ✅ 422 + field pointer |
| enums, optional + collection types | exercised | ✅; `string[]` breaks Angular forms (F-033) |
| derived fields | exercised | ✅ incl. money arithmetic and interpolation |
| functions (expression form) | exercised | ✅ — but `private` when called from a workflow (F-015/026) |
| operations + preconditions + `when` gates | exercised | ✅ 422 / 409 correctly separated |
| events and `emit` | exercised | ✅ emitted; broker delivery **not tested** at runtime |
| repositories and custom `find`s | exercised | ✅; `currentUser` finds break node (F-014) + elixir (F-029) |
| cross-aggregate refs (`X id`) | exercised | ✅; python misses the import (F-027) |
| criterion | exercised | ✅; no identity criterion (F-003) |
| payload/command/query/response/error | smoke | generated only |
| discriminated unions, `option` | not tested | |
| abstract aggregates, `extends`, TPC/TPH, polymorphic reads | not tested | (issue #2806 says java was broken here recently) |
| domain services | not tested | (issue #2649 open against node) |
| capabilities (`auditable`, `tenantOwned`, `tenantRegistry`) | exercised | ✅ model-side; **F-035 breaks .NET/Java at runtime** |
| `softDeletable`, `versioned` | not tested | |
| macros (`scaffold`, `crudish`) + unfold | exercised | ✅ unfold round-trips byte-identically |
| multi-file models + imports | not tested | |
| stdlib (scalars, collection ops, money, date/time) | exercised | ✅ money closed arithmetic enforced and correct on the wire |
| `extern` operations | not tested | |
| provenanced fields, `ddd snapshot` | smoke | `.loom/snapshots/` emitted |

### Systems layer
| Feature | | Verdict |
|---|---|---|
| subdomains/contexts, api/storage/ui/deployable | exercised | ✅ |
| multiple deployables, per-deployable platform | exercised | ✅ — and it triggers F-012 + F-019 |
| docker compose output | exercised | ✅ after F-020 |
| resources (objectStore, mailer, api) | smoke | minio + mailpit sidecars emitted; not exercised |
| channels/brokers, CloudEvents, outbox | smoke | redis sidecar + wiring emitted; **not tested at runtime** |
| workflows (transactional, isolation) | exercised | ✅ **serializable rollback verified** |
| Kubernetes/Helm | exercised | ✅ `helm lint` clean, secret/config split |
| migrations + destructive gating | exercised | ✅ **the strongest component** |
| observability envelope + logs | exercised | ✅ `/metrics`, structured logs, Prom+Jaeger overlay |
| `.loom/` artifact bundle | exercised | ✅ wire-spec, mermaid, LikeC4, traceability, verification, sourcemap |

### Frontend
| Feature | | Verdict |
|---|---|---|
| page DSL + primitives (Stack/QueryView/Table/Money/KeyValueRow/Chart) | exercised | ✅ except `Chart` (F-017) |
| scaffolded vs hand-written (the gradient) | exercised | ✅ rungs 0/1/2 all verified |
| the six frameworks | exercised ×4, unverified ×2 | see §4 |
| design packs + swapping | exercised | ✅ 4 React packs clean |
| navigation/menus | exercised | ✅ rendered in the browser |
| forms + client validation | exercised | ✅ (arrays honestly disabled on React) |
| i18n (`t()`, catalog, sync/check) | exercised | ⚠ CLI works, runtime never receives it (F-044) |
| generated Playwright page objects + e2e | exercised | ✅ emitted; api e2e **3/3 pass** |

### Auth, tenancy, governance
| Feature | | Verdict |
|---|---|---|
| OIDC code flow + PKCE + refresh rotation | exercised | ❌ fails out of the box (F-024); works after 2 hand fixes |
| `enforcement: denyByDefault` | exercised | ✅ caught 21 ungated surfaces — excellent |
| permissions catalogue with `implies` | exercised | ✅ backend; ❌ crashes the page-gate renderer (F-011) |
| `requires` gates (op/find/projection/page) | exercised | ✅ 403 verified |
| `mask unless` | exercised | ✅ redacts for the unauthorised caller |
| `currentUser` | exercised | ✅ |
| multi-tenancy stances, `tenantRegistry` | exercised | ✅ **isolation verified airtight on node** |
| hierarchical scoping, `policy {}` ladder, `crossTenant` | smoke | declared, not exercised |
| audit trail + history read | exercised | ✅ `/history` route + gate; **F-035 blocks it on .NET/Java** |

### Quality and tooling
| Feature | | Verdict |
|---|---|---|
| inline domain tests | smoke | declared and emitted |
| API e2e / UI e2e tests | exercised | ✅ api 3/3 pass; ❌ F-012 breaks generation with 2 deployables |
| `requirement`/`solution`/`testCase` + `ddd verify` | exercised | ✅ correct rollup + exit 1 |
| OpenAPI conformance harness | not tested | |
| `--dry-run`, watch mode, `.loomignore` | exercised (`.loomignore`) | ✅ works and is reported |
| `--sourcemap` + `trace` + `breakpoints` + DAP | exercised (DAP not tested) | ✅ breakpoints precise; ❌ trace on production (F-042) |
| `ddd patch` | not tested | |
| MCP / agent tool surface | exercised | ✅ 14 tools work |
| browser playground | smoke | loads, validates, generates 107 files in-browser |
| `ddd new` templates | exercised | ✅ (warns on its own output, F-001) |
| the docs site | exercised | ❌ advertised URL 404s (F-043) |

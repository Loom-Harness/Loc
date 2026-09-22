# Loom — platform evaluation for a new rich-domain project

**Question:** can we build **Meridian**, a freight-forwarding platform (cargo booking,
itineraries, voyages, invoicing; multi-tenant, OIDC-authenticated), on Loom?

**Method:** a hands-on adoption spike. I wrote my own 420-line domain model from the
reference docs — deliberately *not* by copying `examples/showcase.ddd`, because the previous
evaluations found that defects live exactly in the shapes the conformance corpus doesn't
cover. I then ran the full development cycle: scaffold → model → generate → compile on every
target → boot under `docker compose` → authenticate against the generated Keycloak →
exercise the API → attack tenant isolation → evolve the model against a populated database →
exercise the tooling. Every claim below is backed by a command I ran.

**Repo:** `Loom-Harness/loc` @ `86628b3f`, 2026-09-22. Evidence: `eval-cargo/FINDINGS.md`
(13 findings), repros in `eval-cargo/repro/`, model in `eval-cargo/meridian/main.ddd`.

---

## 1. Recommendation

### Pilot, on a single-backend, non-revenue project. Do not commit Meridian to it yet.

There is a lot of real engineering here, and on several axes it is better than what we would
build ourselves — the compiler's diagnostics are the best I have used in any code generator,
the authorization and multi-tenancy layers *actually work* under attack, and the
model→running-stack loop is genuinely ~15 minutes. I want to be clear that this is not a
toy.

But the central claim — *one model, five backends, six frontends* — did not hold for my
model. **Four of the four backends I was able to compile do not compile**, each from an
ordinary modelling choice, with `generate` reporting `0 error(s)`:

| What I wrote | What broke |
|---|---|
| a value object shared between two contexts | the generated SQL and the ORM disagree on column name *and* type → **HTTP 500 at runtime** (F-008) |
| a `projection … group by … select` | empty response schema on node, a record with no components on **Java → build fails** (F-010) |
| a regex `invariant` on a value object | `Regex` used without its `using` → **.NET build fails** (F-013) |
| a `domainService` with a `precondition` | `DomainError` never imported → the guard raises **`ReferenceError`**, 500 instead of 422 (F-009) |

And three structural problems would bite Meridian specifically:

1. **A shared value object has no correct home** (F-007 + F-008). At the model root it breaks
   the react/vue/svelte build; inside a context it breaks the migration↔ORM contract for every
   other context. Both placements are documented as supported.
2. **The first in-place model evolution does not work** (F-012). The migration journal
   renumbers on insert, so the new migration is silently skipped — and if any field is
   `provenanced`, the API will not boot at all. First deploy is fine; the second is the one
   with production data in it.
3. **`enforcement: denyByDefault` is unsatisfiable for several ordinary shapes** (F-004). The
   validator demands a `requires` gate on `create`; the grammar has no slot for one. For an
   event-sourced aggregate there is no workaround at all — deny-by-default and
   `persistedAs: eventLog` are mutually exclusive. I had to abandon event sourcing in my model
   to keep the security posture.

None of these is unfixable. Most look like a few days' work each for someone who knows the
codebase. But they are the difference between "we ship on this" and "we pilot it".

### What would move this to *adopt*

| # | Condition | How we check it |
|---|---|---|
| C1 | `generate` fails when its own output does not compile — or a `--verify-compiles` flag does | every repro in `eval-cargo/repro/` exits non-zero at `generate` time, not at `tsc`/`dotnet build`/`gradle` time |
| C2 | The generated node Dockerfile runs `tsc --noEmit` before `tsup` | F-009/F-010 must fail `docker compose build`, not ship |
| C3 | A shared value object works in *both* placements | `repro/zodorder/` builds **and** `repro/voxctx.ddd` emits agreeing SQL/ORM |
| C4 | In-place evolution works | evolve a populated stack twice; columns appear, the API boots, data survives |
| C5 | `denyByDefault` is satisfiable for every aggregate kind, incl. `persistedAs: eventLog` | `repro/esgate.ddd` compiles with a gate on its create |
| C6 | A tagged release, a changelog, a stated compatibility policy | today: **0 tags**, `version: 0.1.0` |
| C7 | A second maintainer with commit rights | see §6 |

C1–C2 are the highest-leverage items by a wide margin: they convert the entire **silent**
class into an honest one. **7 of my 13 findings are silent** — `parse` and `generate` report
zero errors and the defect surfaces minutes later at build time, or hours later at runtime.

---

## 2. Feature-by-feature

Verified against the running stack unless noted. "Silent" = 0 errors reported, breaks later.

### Language & domain modelling

| Feature | Verdict | Evidence |
|---|---|---|
| Aggregates, entity parts, containment | **works, well** | encapsulated fields, private ctor, invariants on transition but *not* on rehydration — idiomatic DDD |
| Value objects, invariants, `derived` | **works** | but see F-007/F-008 for *shared* VOs |
| `invariant … when …`, `message` | **works** | custom message surfaced verbatim as HTTP 422 |
| `check` per-field, `unique (a,b)` | **works** | and warned that my `unique (trackingId)` was global across tenants — excellent catch |
| Enums, `money`, `datetime`/`duration` algebra | **works** | `money` round-trips precisely as `"2500.0000"` on the wire |
| Operations, `precondition`, `private` | **works** | 422 with my message |
| `when` state gate (canCommand) | **works** | 409 `Disallowed` + a `GET /{id}/can_claim` → `{"allowed":false}` companion for UI enablement |
| `requires` authorization gate | **works** | 403 `Forbidden: CanBook()` |
| Cross-aggregate `workflow` | **works** | `POST /workflows/book_shipment` created a cargo, added a leg and routed it in one call |
| `domainService` | **SILENT defect** | F-009 — guard becomes `ReferenceError` |
| `criterion` / `retrieval` | **works** | |
| Query-time `projection` | **SILENT defect** | F-010 — right data, empty published schema; **breaks the Java build** |
| Aggregate inheritance (TPC/TPH) | **works** | tables emitted per concrete subtype |
| `persistedAs: eventLog` + `apply` | **works, but** | compiles and emits; **incompatible with `denyByDefault`** (F-004) |
| `create` body on a state aggregate | **honest gap** | an *error*, clearly explained: you cannot guard construction or emit a creation event; use a workflow |
| Aggregate with no `create` | **silent gap** | no POST route at all, no warning (F-003); docs claim otherwise |
| Multi-file `import` | **works, but** | incompatible with tenancy (F-005) — forced my 4 files back into 1 |
| String interpolation | **works** | |
| ICU format specs (`::currency/USD`, `plural`, `date`) | **SILENT defect** | F-002 — all dropped; `{x, date}` emits code that fails `tsc` |

### Security

| Feature | Verdict | Evidence |
|---|---|---|
| OIDC handshake, JWT verification | **works** | unauthenticated → 401 |
| `requires` / named `policy` gates | **works** | 403 with the policy name in `detail` |
| `permissions { … }` + `implies` | **works, scoped narrowly** | F-006 — subdomain-local, and lowers to `<subdomain>.<name>`, so duplicating a block creates *two different* runtime permissions |
| **Tenant isolation** | **works — I could not break it** | Bob got **404** on Alice's cargo by id, **empty list**, **404** invoking an operation on it |
| `tenantRegistry` tree, `dataKey` path | **works** | |
| `mask unless <policy>` | **works** | non-admin read of `Customer.email` → `null`; admin → the value |
| `enforcement: denyByDefault` | **works, but unsatisfiable for some shapes** | complete itemised worklist of every ungated surface (excellent); F-004 blocks |
| by-id read under denyByDefault | **honest, documented gap** | warns per aggregate, names the tracking mission, states the exact residual risk |
| Generated Keycloak realm | **under-provisioned** | F-011 — no `role`/`org_id` mapper, none of the declared permissions; the bundled user can do nothing |

### Code generation & targets

| Target | Compiles my model? |
|---|---|
| node / Hono | ❌ `tsc` fails (ships anyway — esbuild doesn't typecheck) |
| dotnet / ASP.NET | ❌ `CS0103` |
| java / Spring Boot | ❌ projection record |
| python / FastAPI | ❌ `mypy` (ruff clean) |
| elixir / Phoenix | ⚠️ not evaluated (sandbox proxy blocks hex.pm — a *documented* Loom wrinkle) |
| react / vue / svelte / angular | ✅ all four build |
| feliz / flutter | ⚠️ not evaluated (no SDK / proxy blocks pub.dev) |

### Tooling — the strongest part of the product

| Tool | Verdict |
|---|---|
| **Diagnostics** | **outstanding.** Repeatedly told me the exact fix, verbatim. Caught a C# name collision *at validate time* by predicting the CS error; caught an `update` route that would bypass a guarded operation; caught a criterion shadowing an enum case; caught a global-vs-tenant unique |
| `ddd verify` | **works** — requirement → AC → testCase → test → DoD verdict, gating the exit code; missing evidence fails by default |
| `ddd trace` | **works** — a real stack frame mapped back to `main.ddd:145`, the exact `precondition` line |
| `ddd breakpoints` | **works** — `.ddd` line → `api/domain/cargo.ts:109` |
| `ddd snapshot` / `provenanced` | **works** — lineage returned at runtime showing each input and its value |
| `ddd i18n extract/init` | **works** — 225 keys + source lock |
| `--dry-run` | **works** — deterministic; a re-run reported `0 files written, 165 unchanged` |
| Migration safety analysis | **very good** — refused an unannotated rename, a re-baseline over existing history, and a destructive drop, each with a precise explanation |
| Migration *execution* | **broken on evolution** — F-012 |
| `.loom/` artifacts | **works** — ER + domain + deployment mermaid, LikeC4, wire-spec (9 aggregates), traceability, coverage |
| Observability | **works** — structured JSON logs with request/trace/span/actor ids out of the box; opt-in Prometheus + Jaeger overlay |

---

## 3. What actually ran

```
npm test (Loom's own suite)   25,920 passed · 0 failed · 1202 skipped · 11 min · exit 0
ddd generate system           420 lines → 1153 files across 11 deployables, 0 errors
docker compose up             db + keycloak + api + web_app — all 4 healthy
generated e2e suite           2/2 passed against the live authenticated stack
```

Live API behaviour I verified by hand:

```
GET  /api/cargos                    (no token)   → 401
POST /api/cargos                    (no perm)    → 403  Forbidden: CanBook()
POST /api/cargos/{id}/mark_routed   (no legs)    → 422  "cannot route a cargo with no legs"
POST /api/cargos/{id}/claim         (wrong state)→ 409  Disallowed
GET  /api/cargos/{id}/can_claim                  → 200  {"allowed":false}
POST /api/workflows/book_shipment                → 204  (cargo created + leg + routed)
GET  /api/cargos/{id}   as another tenant        → 404
GET  /api/customers     as non-admin             → email: null
GET  /api/cargo_receiveds                        → 500  ← F-008
```

---

## 4. The two things I'd want the maintainers to read first

**The silent class is the whole problem.** Loom's diagnostics are excellent *when they
fire*. The failure mode is uniform: `parse` says 0 errors, `generate` says 0 errors, and the
defect is discovered by a compiler or a database minutes-to-hours later. Every hard failure I
hit is in that class. Two cheap changes — running each target's compiler over the emitted
tree in CI against a *realistic* model (not only feature fixtures), and putting
`tsc --noEmit` in the node Dockerfile — would have caught **6 of my 7 silent findings**.

**Cross-context and shared-kernel shapes are systematically under-tested.** F-005, F-006,
F-007 and F-008 are all the same story: something that works inside one context stops working
across two. That is the first thing a real domain does, and it is where I found the most
severe defect (F-008, a silent runtime 500 on the default backend).

---

## 5. What is genuinely good

Stated plainly, because it matters to the decision:

- **The diagnostics.** Several told me the exact edit to make. One predicted the precise C#
  compiler error a name collision would cause and offered two fixes. One noticed that a
  generic `update` route would let a caller bypass a `requires`-gated operation and its
  preconditions — that is a security review, performed by a compiler.
- **Tenant isolation held.** I attacked it directly with a second tenant's token and could
  not read, list, or mutate across the boundary.
- **The generated code is code I would accept in review.** Encapsulated aggregates,
  invariants on transitions but not on hydration (with the reasoning in a comment), typed
  ids, a paged envelope, ProblemDetails errors, structured logs, an OpenAPI document.
- **Determinism.** Re-running `generate` over an unchanged model wrote 0 files.
- **Honesty in the output.** The scaffolded starter documents its own auth limitations; the
  by-id gap warns per aggregate and names its tracking mission; the `create`-body limitation
  is an error, not a silent drop. This project tells you where it is weak more readily than
  most commercial tools.

---

## 6. Project health

| Signal | Value |
|---|---|
| Releases / tags | **0** |
| Version | `0.1.0` |
| Commits in visible history | 1365 (**shallow clone** — this is a ~20-day window, *not* the project's age) |
| Authorship in that window | `Claude <noreply@anthropic.com>` 1112 · `Michał Kupiec` 204 · `claude[bot]` 16 · `lemmit` 9 |
| Distinct human identities | **one** (the `Michał Kupiec` / `lemmit` / `leming.m@…` addresses are the same person) |
| CI workflows | 67 |
| Test files | 2270 |

The engineering investment is real and the test suite is large and green. The adoption risk
is **concentration**: one human, no release, no compatibility policy. For a pilot that is
acceptable; for a revenue-bearing product line it is the single factor I would weight highest
— above any individual defect in this report, all of which are fixable.

---

## 7. Bottom line

Loom did something I did not expect: it took a 420-line description of a freight domain and
gave me a running, authenticated, multi-tenant system with working authorization, working
tenant isolation, working business rules and real observability, in an afternoon. The parts
that work are better than what we would write by hand.

It also gave me four backends that don't compile and a migration path that breaks on the
second deploy, without telling me. Both statements are true, and the second is the one that
decides the question for Meridian today.

**Pilot it on something we can afford to regenerate. Re-run this spike against C1–C5.**

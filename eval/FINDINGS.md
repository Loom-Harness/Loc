# Loom evaluation — findings register

Severity: S1 blocker · S2 major · S3 friction · S4 polish
Class: **SILENT** (valid input, exit 0, wrong/stubbed/non-compiling output) ·
**HONEST** (clear refusal with a `loom.*` diagnostic) · **DOCUMENTED** (named in docs up front)

---

### F-001 — README's CLI commands do not work verbatim; `ddd` is never on PATH
Severity: S4   Class: DOCUMENTED-adjacent (docs/DX)
Area: onboarding / CLI
Claim under test: README "## CLI" block — `ddd parse <file.ddd>`, `ddd generate system …`

Repro:
```
$ which ddd            # exit 1 — not installed by `npm install`
$ ddd --help           # command not found
$ node bin/cli.js --help   # works
```
Observed: every `ddd …` line in README.md, `docs/tools.md` and the output of
`ddd new` ("next: cd eval/starter && ddd generate system main.ddd -o .") assumes a
global binary that the documented install (`npm install && npm run build`) does not
create. No `npm link` / `npx ddd` instruction appears in the README.
Expected: README says `npx ddd` or `node bin/cli.js`, or the install step links it.
Workaround: prefix every command with `node bin/cli.js`. Cost: seconds, once.
Impact on adoption: trivial, but it is the first command an evaluator types.
Time lost: 2 min

---

### F-002 — Generated REST routes live under `/api/…`, which no quickstart doc states
Severity: S4   Class: DX
Area: generated node backend / docs
Claim under test: README quick example — "`docker compose up -d` → everything running on ports 3000 / 8080 / 4000 / 3001."

Repro:
```
$ curl -sS localhost:3000/projects
{"type":"about:blank","title":"Not Found","status":404,"detail":"no route for GET /projects",...}
$ curl -sS localhost:3000/api/projects   # works
```
Observed: the aggregate plural is mounted at `/api/<plural>`, not `/<plural>`. Grepping
`README.md`, `docs/tools.md`, `docs/architecture.md` for the prefix returns nothing.
Mitigated by a served `GET /openapi.json` that lists all 6 paths, and by `GET /health`.
Expected: one line in the quickstart, or a route index at `/`.
Workaround: read `/openapi.json`. Cost: 3 min of guessing on first contact.
Impact on adoption: negligible after the first hour.
Time lost: 4 min

---

### F-003 — A cross-aggregate `invariant` generates non-compiling code on 4 backends and is silently DROPPED on the 5th
Severity: **S1** (blocker — silently wrong output / output that does not compile)
Class: **SILENT** gap
Area: codegen / all five backends / aggregate invariants
Claim under test: README — "walk away with real, owned source code across five backends";
"Validation gates catch hallucinated fields and out-of-scope references **before any code is emitted**."

Repro: `eval/repro/A-cross-agg-invariant.ddd` (19 lines). The rule is straight out of a
normal field-service spec: *a work order may only go to a technician whose skills cover
the asset's required skill.*
```ddd
aggregate WorkOrder {
  assetId: Asset id
  technicianId: Technician id?
  invariant Technicians.getById(technicianId).skills.contains(Assets.getById(assetId).requiredSkill)
}
```
```
$ node bin/cli.js parse eval/repro/A-cross-agg-invariant.ddd
0 error(s), 0 warning(s).
OK: eval/repro/A-cross-agg-invariant.ddd
$ node bin/cli.js generate system eval/repro/A-cross-agg-invariant.ddd -o eval/out-A
0 error(s), 0 warning(s).
Wrote 48 file(s) in eval/out-A
$ cd eval/out-A/api && npx tsc --noEmit
domain/workOrder.ts(37,11): error TS2304: Cannot find name 'Technicians'.
domain/workOrder.ts(37,67): error TS2304: Cannot find name 'Assets'.
```
Observed, per backend (same model, only `platform:` changed):

| Backend | Emitted | Consequence |
|---|---|---|
| node | `if (!(Technicians.getById(this._technicianId).skills.includes(Assets.getById(this._assetId).requiredSkill))) throw …` | **`tsc` fails**, TS2304 ×2 (proven above) |
| .NET | `if (!(Technicians.GetById(this.TechnicianId).Skills.Contains(Assets.GetById(this.AssetId).RequiredSkill, StringComparison.Ordinal))) throw …` | unresolvable symbol — `dotnet build` cannot succeed (inspected, not compiled here) |
| Java | `if (!(Technicians.getById(this.technicianId).skills().contains(Assets.getById(this.assetId).requiredSkill()))) throw …` | unresolvable symbol (inspected, not compiled here) |
| Python | `if not ((Assets.get_by_id(self._asset_id).required_skill in Technicians.get_by_id(self._technician_id).skills)):` | `python -m compileall` **passes** (exit 0); `Assets`/`Technicians` are unbound module globals → **NameError at runtime, on the first mutation** |
| **elixir** | **nothing at all** — `work_order_changeset.ex` contains no trace of the rule | **the business rule silently does not exist in the shipped app** |

Elixir control: the same backend *does* emit a simple invariant — `invariant n >= 0` becomes
`validate_number(:n, greater_than_or_equal_to: 0)` (`eval/out-inv-elixir`). So this is a
targeted silent drop of the cross-aggregate form, not "elixir doesn't do invariants".

Expected: a `loom.*` diagnostic refusing repository access inside an `invariant` — the language
reference already states a pure `function` "may not call a repository / operation / domain-service /
extern (the IR validator rejects each)". The same rule is simply not applied to `invariant`,
even though an invariant is documented as a "`bool` predicate; checked after every mutation".
Secondary defect: even if it were resolvable, `getById` is asynchronous on every backend, and the
emitted call site is synchronous.

Workaround: move the rule into a `workflow` (verified working — see F-004), which changes where
the rule lives and means it is **no longer enforced on every mutation**, only on the one path
that goes through the workflow. A second write path (the generated `PATCH /work_orders/{id}`
update route) bypasses it entirely.
Impact on adoption: **high, and this is the shape of the danger.** The construct is the first
thing a DDD practitioner writes for a cross-entity rule; it is accepted with zero diagnostics;
four backends fail at build time (annoying but safe) and **one ships a running app with the rule
missing** (not safe). Under a "regenerate and deploy" workflow, the elixir case is a silent
correctness regression. Any team using Loom needs a CI gate that compiles every generated backend
— which means Loom's "0 errors" is not a sufficient gate.
Time lost: 35 min (including confirming the elixir control and the four-backend spread)

---

### F-004 — POSITIVE: transactional cross-aggregate workflow generates correct code
Severity: n/a (recorded as verified evidence, not a gap)
Area: workflows / node backend
Claim under test: README — "Workflows (transactional, isolation, event drain)"; spec requirement
"completing a work order must decrement stock transactionally and fail the whole operation if
stock is insufficient."

Repro: `eval/repro/B-workflow-stock.ddd` → `generate system` → `npx tsc --noEmit` **exit 0**.
Emitted (`http/workflows.ts`):
```ts
await db.transaction(async (tx) => {
  const workOrders = new WorkOrderRepository(tx, events);
  const parts = new PartRepository(tx, events);
  const wo = await workOrders.getById(workOrder);
  const part = await parts.getById(wo.partId);
  part.consume(wo.qty);      // precondition onHand >= qty  → throws → tx rolls back
  wo.complete();
  await workOrders.save(wo);
  await parts.save(part);
});
```
Both repositories are bound to the transaction handle, both saves are inside it, and the route
is OpenAPI-documented with 400/404/415/422. This requirement is **expressed directly** and
correctly. Contrast with F-003: the *same rule* expressed as an aggregate invariant is broken.
The lesson for a buyer: the workflow path is the load-bearing one; the aggregate-invariant path
is not.

---

### F-005 — `ignoring tenantOwned` is a one-word cross-tenant read bypass, unflagged under the DEFAULT auth mode
Severity: **S2** (major — headline security property is opt-in, not default)
Class: **SILENT** under `enforcement: opt`; **HONEST** under `enforcement: denyByDefault`
Area: multi-tenancy / authorization / projections
Claim under test: `docs/tenancy.md` — "the toolchain **guarantees** the read scope on every
generated query — the 'forgot the filter on one query' cross-tenant leak becomes a compile error
instead of an incident."

Repro: `eval/repro/C4-ignoring-ungated.ddd`
```ddd
auth { enforcement: opt  … }          // ← the LANGUAGE DEFAULT
tenancy by user.orgId of Org
aggregate WorkOrder with tenantOwned { ref: string  amount: money }
projection PlatformRevenue {          // ← no `requires` gate
  revenue: money
  from WorkOrder as w ignoring tenantOwned
  select revenue = sum(w.amount)
}
```
```
$ node bin/cli.js parse eval/repro/C4-ignoring-ungated.ddd
0 error(s), 0 warning(s).
```
Observed — emitted route has no auth check and no tenant predicate:
```ts
const [row] = await db.select({ revenue: sum(schema.workOrders.amount) }).from(schema.workOrders);
```
`GET /projections/platform_revenue` returns the revenue sum **across every tenant** to any
authenticated caller from any tenant. Compare the gated sibling (`eval/out-C`), which correctly
emits `.where(eq(schema.workOrders.tenantId, requireCurrentUser().orgId))`.

Mitigation that works (verified): flipping one line to `enforcement: denyByDefault`
(`eval/repro/C5-…ddd`) turns it into a hard error —
`loom.default-deny-ungated projection/PlatformRevenue: … declares no requires gate. Add a
requires <expr> … (use requires true to allow anonymous access).`

Expected: `ignoring tenantOwned` is categorically different from `ignoring softDeletable` — it
disables the security boundary the tenancy feature exists to provide. It should warn on its own
merits regardless of `enforcement:` mode. It does not; only the *generic* read-gate rule catches
it, and only in the non-default mode. Note also that `requires true` satisfies `denyByDefault`
while still leaking cross-tenant.
Workaround / adoption condition: **mandate `auth { enforcement: denyByDefault }` in every model,
and grep CI for `ignoring tenantOwned` / `ignoring *`.** Both are cheap and effective.
Impact on adoption: the capability is genuinely good and the escape hatch is *needed* (it is how
the spec's deliberate platform-admin cross-tenant report is expressed — see below). But the
headline "compile error instead of an incident" claim holds only in the non-default mode, and a
buyer must know that.

**Expressiveness result for the spec's deliberate cross-tenant read:** *expressed directly.*
`from WorkOrder as w ignoring tenantOwned` + `requires currentUser.role == "platformAdmin"`
emits exactly the intended SQL (`eval/out-C2`) with the 403 gate ahead of it.
Time lost: 25 min

---

### F-006 — An `invariant` over a contained collection silently removes the aggregate's `create` factory; every call site then fails to compile
Severity: **S1** (blocker — valid input, exit 0, output does not compile)
Class: **SILENT** gap
Area: codegen / node backend / aggregate factories + invariants
Claim under test: README — "Aggregate roots with private state, **factories**, invariant checks,
derived properties, domain events"; "Validation gates catch … before any code is emitted."

Repro: `eval/repro/G2-invariant-over-parts-breaks-create.ddd` (24 lines). The invariant is the
spec's own multi-currency rule — *all lines share the order's currency*:
```ddd
aggregate Order {
  currency: string
  contains lines: Line[]
  invariant lines.all(l => l.currency == currency)   // <-- the whole finding is this line
  entity Line { currency: string  amt: money }
  test "an order can be built" { let o = Order.create({ currency: "EUR" })  expect(o.display).toBe("EUR") }
}
workflow openOrder { create(currency: string) { let o = Order.create({ currency: currency }) } }
```
```
$ node bin/cli.js parse   eval/repro/G2-….ddd   →  0 error(s), 0 warning(s).  OK
$ node bin/cli.js generate system eval/repro/G2-….ddd -o eval/out-G2
0 error(s), 0 warning(s).   Wrote 45 file(s)
$ cd eval/out-G2/api && npx tsc --noEmit
domain/order.test.ts(7,21):  error TS2551: Property 'create' does not exist on type 'typeof Order'. Did you mean '_create'?
http/workflows.ts(46,23):    error TS2551: Property 'create' does not exist on type 'typeof Order'. Did you mean '_create'?
```
Causality is exact — delete that one invariant line and regenerate:
```
$ npx tsc --noEmit   →   exit 0
```
Observed: with the invariant present the emitter drops `static create(input: …)` from the domain
class (only the internal `static _create(state: …)` survives), but the **unit-test emitter and the
workflow emitter both still emit `Order.create({ … })`**. Two independent call sites in the same
project reference a method the class emitter decided not to write. Verified by counting in the
generated source: `grep -c 'static create' domain/order.ts` → `0` with the invariant, `1` without.
Expected: either the factory keeps being emitted, or a `loom.*` diagnostic explains that an
invariant over a contained collection is incompatible with the synthesized factory.
Workaround: none that keeps the rule. You can (a) delete the invariant and re-express the rule as
a `precondition` on the operation that appends a line — which no longer enforces it on other write
paths — or (b) hand-write a `create` action. Neither is discoverable from the failure.
Impact on adoption: **high.** "Total in Money, all lines same currency" is a textbook aggregate
invariant; the exact sentence appears in our own product spec. The failure surfaces only when you
compile the generated code — `ddd parse` and `ddd generate system` both report success. This is
the single strongest argument in this evaluation for the rule that **"Loom reports 0 errors" must
never be a team's merge gate**; the generated project's own compiler must be.
Time lost: 50 min (30 of it bisecting, because nothing points at the invariant)

**Second instance of the same root cause, found later at scale.** Nothing validates an
`Agg.create({ … })` call site against the factory's actual input shape *at all* — not just when the
factory is suppressed. I added a required field (`binCode`) to `Part` and left an inline
`test` block calling `Part.create({ sku, onHand, unitPrice, currency })`. `ddd parse` and
`ddd generate system` both reported success; the generated project then failed:
```
domain/part.test.ts(8,27): error TS2345: Property 'binCode' is missing in type
  '{ sku: string; onHand: number; unitPrice: Decimal; currency: string; }' but required in type
  '{ sku: string; binCode: string; onHand: number; unitPrice: Decimal; currency: string; }'.
```
Loom *does* have a warning for the adjacent case on the declaration side
(`loom.create-params-not-wire`, when a `create(...)` parameter list omits a required create-input
field), so the concept exists — it just is not applied to **call sites** in `test` / `workflow`
bodies. That is the generalised form of this finding: **the DSL type-checks expressions but not
factory-call arity/shape, and the first thing that notices is the target compiler.**

---

### F-007 — A `criterion` comparing an optional reference to `null` emits invalid Drizzle (`ne(col, null)`)
Severity: **S1** (blocker — output does not compile)
Class: **SILENT** gap
Area: codegen / node backend / criterion → Drizzle lowering
Claim under test: `docs/criterion.md` / language reference — criteria are "reusable, SQL-inlinable
predicate specifications"; "The queryable-subset validator rejects shapes that don't fit … with a
clear diagnostic."

Repro: `eval/repro/E-criterion-null-compare.ddd` (18 lines) — "work orders that have been assigned":
```ddd
aggregate WorkOrder { technicianId: Tech id? }
criterion Assigned() of WorkOrder = this.technicianId != null
retrieval AssignedOrders() of WorkOrder { where: Assigned() }
```
```
$ node bin/cli.js parse … → 0 error(s), 0 warning(s). OK
$ node bin/cli.js generate system … -o eval/out-E → Wrote 45 file(s)
$ cd eval/out-E/api && npx tsc --noEmit
db/repositories/workOrder-repository.ts(15,33): error TS2769: No overload matches this call.
  Argument of type 'null' is not assignable to parameter of type 'string | SQLWrapper'.
```
Emitted: `const assignedCriterion = () => ne(schema.workOrders.technicianId, null);`
Expected: `isNotNull(schema.workOrders.technicianId)` — Drizzle exports exactly this, and the
`== null` case has the same problem (`isNull`). Or a queryable-subset diagnostic refusing it.
Workaround: none inside the DSL; you must avoid null tests in criteria entirely (e.g. add a
redundant boolean column and index it), which is a schema change to work around a codegen bug.
Impact on adoption: high frequency. Optional foreign keys are everywhere in a real B2B schema
("unassigned", "not yet invoiced", "no parent"), and "is it set?" is the most natural filter over
one. This reached my model within the first hour of writing it, unprompted.
Time lost: 20 min

---

### F-008 — Generated `docker-compose.yml` pins `minio/minio:latest`, an image removed from Docker Hub; the whole stack fails to start
Severity: **S2** (major — `docker compose up` fails on any model using an `s3` objectStore)
Class: **SILENT** gap (valid input, exit 0, output does not run)
Area: system composition / docker-compose emission / dependency freshness
Claim under test: README — "`ddd generate system acme.ddd -o ./out` → runnable multi-project tree
+ `docker-compose.yml` … `docker compose up -d` → everything running".

Repro: any model with `storage photos { type: s3, … }` + `resource … kind: objectStore`
(`eval/fieldops/main.ddd`):
```
$ docker compose up -d --build
 Image minio/minio:latest Error pull access denied for minio/minio, repository does not exist or may require 'docker login'
Error response from daemon: pull access denied for minio/minio, …
```
The failure aborts the **entire** `compose up`, so api / web_app / db never start either.
Root cause is upstream, not local policy — Docker Hub's own API agrees the repo is gone:
```
$ curl -sS "https://hub.docker.com/v2/repositories/minio/minio/tags?page_size=3"
{"message":"object not found","errinfo":{}}
$ docker pull minio/minio:RELEASE.2024-01-16T16-07-38Z   → pull access denied
$ docker pull quay.io/minio/minio:latest                 → Status: Downloaded newer image  ✅
```
MinIO delisted the image from Docker Hub; the project now publishes on quay.io. Every other
sidecar Loom emits pulls fine (`quay.io/keycloak/keycloak:26.0`, `valkey/valkey:8-alpine`,
`axllent/mailpit:latest`), so this is one stale registry reference, not a broken compose emitter.
Expected: `quay.io/minio/minio:<pinned tag>`.
Workaround: one `sed` on the generated compose file — but it is *generated*, so the edit is
clobbered on the next `ddd generate system` (see F-014 on hand-edit survival). The durable
workaround is a compose override file or a post-generate patch step in CI.
Secondary observations on the same emitted file, all S4: three sidecars are pinned to `:latest`
(`minio`, `mailpit`) rather than a digest or version, so builds are not reproducible; the object
store ships hardcoded `minioadmin/minioadmin` credentials; and the `photos` / `mail` services carry
no `healthcheck`, while `db` and `keycloak` do.
Impact on adoption: a buyer evaluating Loom today, on the exact feature set in our spec
(photo upload → object store), hits a dead stack on the first `compose up` with no hint that one
image reference is the cause. It is trivially fixable by the vendor and trivially worked around by
us, but it is evidence about **release hygiene**: nothing in CI pulls this image.
Time lost: 15 min

---

### F-009 — Under the RECOMMENDED `denyByDefault` posture, `GET /<plural>/{id}` carries no authorization gate and nothing warns
Severity: **S2** (major — role-based read isolation is not enforceable on the by-id route)
Class: **DOCUMENTED** (in a `ddd new` code comment) but **SILENT** from the compiler's point of view
Area: authorization / route emission
Claim under test: `docs/auth.md` — "Under `denyByDefault`, every **client-reachable command AND read**
on an `auth: required` deployable must declare a `requires` gate … else `loom.default-deny-ungated`
fires." (The doc lists exactly one exception, the auto-injected `find all`.)

Repro: `eval/repro/I-byid-gate.ddd`
```ddd
auth { enforcement: denyByDefault  … }
aggregate Secret { body: string  create() { requires currentUser.role == "admin" } }
repository Secrets for Secret { find all(): Secret[] requires currentUser.role == "admin" }
deployable api { … auth: required … }
```
```
$ node bin/cli.js parse eval/repro/I-byid-gate.ddd
0 error(s), 0 warning(s).
```
Observed — gate presence per emitted route (`eval/out-I/api/http/secret.routes.ts`):
```
  POST  /        -> requires-gate
  GET   /        -> requires-gate
  GET   /{id}    -> NO GATE        <-- any authenticated caller, any role
```
So the list of secrets is admin-only, and the individual secret is readable by every authenticated
user who has (or guesses) an id. The compiler reports nothing.

**Scope of the exposure — measured, not assumed.** I tested the tenancy half live against the
running FieldOps stack: the tenant filter *does* cover the by-id route.
```
tenant A reading its own customer by id    -> 200
tenant A reading tenant B's customer by id -> 404 Not Found
```
So **cross-tenant** isolation holds on by-id; what fails is **role separation within a tenant**.
For our product that is still a real finding (a `customerReadOnly` user reading a technician
record by id), but it is not a tenant leak.

The project is honest about this in one place — the comment block that `ddd new` writes into every
scaffolded `main.ddd` says the by-id read "has no author surface to attach a gate to, so under
denyByDefault it still serves to any authenticated caller, **and nothing warns**", citing an
internal mission id. That disclosure is not in `docs/auth.md`, which instead states the rule with
only the `find all` exception.
Expected: `loom.default-deny-ungated` should fire for the by-id read too, or the doc should list it
as a second exception.
Workaround: none inside the DSL. You must front the API with a gateway, or avoid `denyByDefault`'s
implied guarantee and treat by-id as public-to-authenticated in your threat model.
Impact on adoption: this is the difference between "the compiler proves my authorization" and "the
compiler proves most of my authorization". A team that reads `docs/auth.md` and ships will believe
the former.
Time lost: 20 min

---

### F-011 — The .NET backend cannot build ANY system that uses a channel (C# namespace shadowing, CS0234)
Severity: **S1** (blocker — a headline feature is non-functional on a whole backend)
Class: **SILENT** gap
Area: codegen / .NET backend / channels (cross-deployable eventing)
Claim under test: README — ".NET" as one of five backends; `docs/channels.md` — "cross-deployable
eventing over external brokers"; README "Pick a runtime per deployable. Switch any time."

Repro: `eval/repro/J-dotnet-channel-namespace.ddd` — 15 lines, one aggregate, one event, one
channel, `platform: dotnet`.
```
$ node bin/cli.js parse eval/repro/J-dotnet-channel-namespace.ddd      → OK
$ node bin/cli.js generate system … -o eval/out-J                      → Wrote 64 file(s)
$ docker run … mcr.microsoft.com/dotnet/sdk:10.0 dotnet build
/w/api/Infrastructure/Channels/ChannelTransport.cs(239,26): error CS0234: The type or namespace
  name 'Infrastructure' does not exist in the namespace 'Api.Api' (are you missing an assembly reference?)
/w/api/Infrastructure/Channels/ChannelTransport.cs(244,13): error CS0234: (same)
Build FAILED.  2 Error(s)
```
Causality, same model with the channel removed:
```
$ dotnet build -warnaserror
Build succeeded.  0 Warning(s)  0 Error(s)
```
Root cause (read off the generated source): `ChannelTransport.cs` declares
`namespace Api.Infrastructure.Channels;` and then writes the fully-qualified
`Api.Infrastructure.Events.RealtimeDomainEventDispatcher`. But the generated controllers live in
`namespace Api.Api;` (folder `Api/` under root namespace `Api` — e.g.
`Api/SitesController.cs:18: namespace Api.Api;`). C# resolves the leading `Api` to that *nested*
namespace, yielding `Api.Api.Infrastructure.Events…`. The file already has
`using Api.Infrastructure.Events;` on line 22, so the qualifier is redundant as well as wrong —
the fix is to drop it or write `global::Api.…`.
Because every .NET project puts controllers in `Api.Api`, this fires for **every** dotnet
deployable that wires a channel, regardless of model content.
Workaround: post-generate `sed` on `ChannelTransport.cs` (2 lines), re-applied after every
regenerate. Cheap but it must live in your build pipeline forever, or until the vendor fixes it.
Impact on adoption: our spec requires `WorkOrderCompleted` published to a separate notifier
deployable. On .NET that feature does not build today. More importantly for the *breadth* claim:
this is a per-backend feature hole that the toolchain reports as success, so "switch any time"
is not a safe assumption — you must compile every target you intend to use.
Time lost: 30 min

**Positive control worth recording:** the .NET backend otherwise produced *high-quality* output —
331 files for the full FieldOps model, building under `-warnaserror` with `AnalysisLevel:
latest-recommended` (~200 Roslyn CA rules) at **0 warnings**. The channel bug is a specific defect,
not a general quality problem.

---

### F-012 — `mask unless` emits `Objects.equals(...)` without `import java.util.Objects` on the Java backend; the project does not compile
Severity: **S1** (blocker — output does not compile)
Class: **SILENT** gap
Area: codegen / Java (Spring Boot) backend / field masking
Claim under test: README — "Java/Spring Boot" as a supported backend; `docs/auth.md` — "`mask unless`
field read-redaction"; README "Identical API contracts; idiomatic per-runtime output."

Repro: `eval/repro/K-java-mask-missing-import.ddd` — 16 lines, one aggregate, one masked field.
```
$ node bin/cli.js parse eval/repro/K-java-mask-missing-import.ddd   → 0 error(s). OK
$ node bin/cli.js generate system … -o eval/out-K                   → Wrote 68 file(s)
$ docker run … gradle:9-jdk25 gradle testClasses
/w/api/src/main/java/com/loom/api/features/teches/TechResponse.java:21: error: cannot find symbol
  symbol:   variable Objects
BUILD FAILED
```
Causality — identical model with `mask unless` removed:
```
BUILD SUCCESSFUL in 58s
```
Emitted line (imports present are `CurrentUserAccessor`, `User`, `UUID`, and three wildcard domain
imports — **no `java.util.Objects`**):
```java
return new TechResponse(value.id().value(), value.fullName(),
  (__maskUser != null && (Objects.equals(__maskUser.role(), "admin"))) ? … : null, …);
```
The same masked field works correctly end-to-end on the node backend — I verified it live
(dispatcher sees `"costRate":null`, admin sees `"85.5000"`).
Workaround: post-generate insert of one import line per affected response record, re-applied on
every regenerate.
Impact on adoption: `mask unless` is the *only* mechanism Loom offers for field-level read
redaction (the `sensitive(...)` tag explicitly does not redact — see the toolchain's own
`loom.sensitive-wire-unsupported` warning). So on Java, the one supported way to hide a salary,
a cost rate or a PII column breaks the build.
Time lost: 25 min (most of it getting a JDK 25 toolchain — the generated project requires Java 25)

---

### F-013 — A `criterion` referencing `currentUser` is emitted correctly on 3 backends and broken on 2
Severity: **S1** (blocker on python + elixir — runtime NameError / non-compiling query)
Class: **SILENT** gap
Area: codegen / python + elixir backends / criterion + retrieval lowering
Claim under test: README — "Identical API contracts"; "five backends from one source";
`docs/auth.md` — "`currentUser` admissible inside repository find `where` filters".

Repro: the FieldOps row-level rule (`eval/repro/H2-rowlevel-denormalized.ddd`, and
`eval/fieldops/main.ddd`):
```ddd
criterion MineAsTechnician() of WorkOrder = this.technicianUserId == currentUser.id
retrieval MyWorkOrders() of WorkOrder { where: MineAsTechnician()  sort: [priority desc] }
```
One model, `platform:` varied. What each backend emits for that predicate:

| Backend | Emitted | Verdict |
|---|---|---|
| node | `eq(schema.workOrders.technicianUserId, requireCurrentUser().id)` | ✅ correct |
| .NET | `Query.Where(x => x.TechnicianUserId == RequestContext.Current!.CurrentUser!.Id)` | ✅ correct |
| Java | `@Query("… where (e.technicianUserId = :#{@currentUserAccessor.user()?.id()}) …")` | ✅ correct |
| **Python** | `WorkOrderRow.technician_user_id == current_user.id` | ❌ **`current_user` is an unbound name** |
| **Elixir** | `where: record.technician_user_id == current_user.id` | ❌ **no `^` pin** |

The tell is that on **both** broken backends, the *compiler-generated* tenancy filter on the very
same line is correct while the *author-written* criterion is not:
```python
# app/db/repositories/work_order_repository.py:67   — one line, two different lowerings
select(WorkOrderRow).where(and_(
    (WorkOrderRow.technician_user_id == current_user.id),              # author criterion — UNBOUND
    (WorkOrderRow.tenant_id == require_current_user().org_id)))        # tenancy filter — correct
```
```elixir
# lib/api/field/retrievals/my_work_orders.ex
query = from(record in Api.Field.WorkOrder, where: record.technician_user_id == current_user.id)
query = ... where(query, [record], record.tenant_id == ^(current_user && current_user.org_id))
```
Python: `python -m compileall` **passes** (exit 0 under 3.13) because Python binds names at
execution — so a compile gate does not catch this. It raises `NameError` the first time the
endpoint is called.
Elixir: `current_user` *is* bound (from `opts[:current_user]`), but Ecto's `from/2` requires `^` to
interpolate a runtime value into a query expression; the tenancy filter one line below uses `^`
correctly. **CONFIRMED by an executed build** (`mix compile`, elixir 1.17.3 / OTP 27, ecto 3.14.2):
```
== Compilation error in file lib/api/field/retrievals/my_work_orders.ex ==
** (Ecto.Query.CompileError) unbound variable `current_user` in query.
   If you are attempting to interpolate a value, use ^var
    lib/api/field/retrievals/my_work_orders.ex:16: Api.Field.Retrievals.MyWorkOrders.run/1
```
Impact on adoption: "a technician sees only their own work orders" is a core requirement of our
product, and `currentUser` in a read filter is the mechanism for every row-level rule. It silently
does not work on 2 of the 5 advertised backends. This is the single clearest answer to
"are the five backends genuinely interchangeable?": **no, not without compiling and running each.**
Time lost: 35 min

---

### F-014 — An enum COLLECTION field (`Skill[]`) emits an invalid Ecto type; the Elixir project does not compile
Severity: **S1** (blocker — output does not compile)
Class: **SILENT** gap
Area: codegen / Elixir (Phoenix/Ecto) backend / enum collections
Claim under test: README — "Phoenix LiveView" as a supported backend; `docs/language.md` — `T[]`
denotes a collection of any `TypeRef`, including an enum.

Repro: `eval/repro/L-elixir-enum-array.ddd` — 15 lines, one aggregate, one `Skill[]` field.
```
$ node bin/cli.js parse … → 0 error(s). OK
$ node bin/cli.js generate system … -o eval/out-L → Wrote 61 file(s)
$ docker run … hexpm/elixir:1.17.3 … mix compile
== Compilation error in file lib/api/c/tech.ex ==
** (ArgumentError) invalid type {:array, Ecto.Enum, [values: [:Electrical, :Plumbing, :HVAC]]} for field :skills
    (ecto 3.14.2) lib/ecto/schema.ex:2623: Ecto.Schema.check_field_type!/4
    lib/api/c/tech.ex:12: (module)
```
Emitted:  `field :skills, {:array, Ecto.Enum, values: [:Electrical, :Plumbing, :HVAC]}`
Ecto wants: `field :skills, {:array, Ecto.Enum}, values: [:Electrical, :Plumbing, :HVAC]`
— `values:` is an option of `field/3`, not a third tuple element. A one-token codegen error.
Workaround: post-generate `sed`, per affected schema, forever.
Impact on adoption: "a technician has skills" is an ordinary domain shape; `enum[]` is a first-class
type in the language. On Elixir, any aggregate with one fails to compile.
Time lost: 15 min

---

### F-015 — Generated Python does not pass the linter the generated project itself declares
Severity: **S3** (friction; the F821 row is the S1 already filed as F-013)
Class: **SILENT** gap
Area: codegen / Python backend / output quality
Claim under test: README "Status" — "Python type-checked with mypy"; the generated `pyproject.toml`
declares `ruff>=0.8,<1` in its own dev group and configures `[tool.ruff]`.

Repro:
```
$ docker run … python:3.13-slim sh -c 'pip install -q ruff && ruff check --output-format concise app'
app/db/repositories/work_order_repository.py:67:85: F821 Undefined name `current_user`
app/domain/invoice.py:94:17: E714 [*] Test for object identity should be `is not`
app/http/invoice_routes.py:92:13: E714 [*] Test for object identity should be `is not`
app/http/workflows_routes.py:47:9: F841 Local variable `tech` is assigned to but never used
Found 4 errors.
```
These are *default* ruff rules under the project's own `[tool.ruff]` config — not a strict profile
I invented. Notes on each: **F821** is F-013 (a real runtime `NameError`). **E714** (`not x is None`
instead of `x is not None`) is cosmetic, ×2. **F841** is arguably mine — my workflow binds
`let tech = Technicians.getById(technician)` and never uses it; a nicer outcome would be a Loom-level
"unused binding" warning, since the DSL is where the mistake was made.
Impact on adoption: small on its own, but it is the cheapest possible gate and it is not being run.
One `ruff check` in Loom's CI over generated Python would have caught F-013 — a genuine S1 — for free.
Time lost: 10 min

---

### F-016 — An enum collection field breaks the Angular scaffolded forms; the bundle does not build
Severity: **S1** (blocker — output does not compile)
Class: **SILENT** gap
Area: codegen / Angular frontend / scaffolded create+update forms
Claim under test: README — "Angular" as one of six frontends; "Generated UI pages (list, detail,
create) with a modal-form button per public operation."

Repro: `eval/repro/M-angular-enum-array-form.ddd` — 18 lines, one aggregate with `skills: Skill[]`,
scaffolded Angular UI.
```
$ node bin/cli.js parse … → 0 error(s). OK
$ node bin/cli.js generate system … -o eval/out-M → Wrote 76 file(s)
$ docker run … node:24-slim npm run build           # the project's own `ng build`
Application bundle generation failed. [4.831 seconds]
✘ [ERROR] TS2322: Type '{ fullName: string; skills: null; }' is not assignable to type 'UpdateTechRequest'.
✘ [ERROR] TS2345: Argument of type '{ fullName: string; skills: null; }' is not assignable to parameter of type 'CreateTechRequest'.
```
Emitted (`web/src/app/pages/tech-new.component.ts:37`):
```ts
readonly techForm = new FormGroup({
  fullName: new FormControl("", { nonNullable: true }),
  skills:   new FormControl(null, { nonNullable: true })   // typed unknown[] in the DTO
});
```
There is a second, non-fatal problem visible on line 28: the array field is rendered as a plain
single-line text input (`<mat-form-field><input matInput formControlName="skills">`), which would
not be a usable multi-select even if it compiled.
The same model on React (`eval/fe-react`) and Vue (`eval/fe-vue`) and Svelte (`eval/fe-svelte`)
builds clean — so this is Angular-specific.
Workaround: avoid `enum[]` fields on any aggregate reachable from an Angular scaffold, or eject and
hand-write those two pages.
Impact on adoption: **`Skill[]` broke two of the eleven targets I tested — Elixir (F-014) and
Angular (F-016) — from one ordinary field.** That is the strongest single data point about how
even the breadth claim behaves under a real model: the same `.ddd` is not equally viable on
every target, and the toolchain says nothing.
Time lost: 25 min (plus 20 min on an unrelated Node-version mismatch: the generated Angular project
requires Node ≥22.22.3 and this machine had 22.22.2)

---

### F-017 — The Feliz (F#) frontend does not compile: 14 errors, from an identifier collision and a Guid/string mismatch
Severity: **S1** (blocker — output does not compile)
Class: **SILENT** gap
Area: codegen / Feliz (F#/Fable/Elmish) frontend
Claim under test: README — "Feliz (F#/Fable)" as one of six frontends.

`dotnet build App.fsproj` on the full FieldOps Feliz output: **14 `error FS`** —
`8× FS0001` (type mismatch), `1× FS0037` (duplicate type), `2× FS1129`, `2× FS0039`, `1× FS0764`.

**Bug A — form-record name collision** (minimal repro `eval/repro/N-feliz-form-name-collision.ddd`,
26 lines). An aggregate operation `WorkOrder.schedule(...)` and a workflow `scheduleWorkOrder(...)`
both lower to an F# record type named `ScheduleWorkOrderForm`:
```
$ grep -c '^type ScheduleWorkOrderForm =' eval/out-N/web/src/App.fs
2
$ dotnet build App.fsproj
src/App.fs(246,6): error FS0037: Duplicate definition of type, exception or module 'ScheduleWorkOrderForm'
src/App.fs(255,5): error FS1129: The record type 'ScheduleWorkOrderForm' does not contain a label 'workOrder'.
src/App.fs(256,5): error FS1129: … does not contain a label 'technician'. Maybe you want one of the following:   tech
… 6 errors
```
F# has no overloading here — the second definition shadows the first, so the workflow's form then
tries to set fields (`workOrder`, `technician`) that belong to the operation's record (`tech`).
Any model where a `<verb><Aggregate>` workflow sits beside a `<verb>` operation on that aggregate
collides — a very ordinary naming pattern (it is the one the Loom docs' own workflow examples use).

**Bug B — `System.Guid` vs `string`**, 8 occurrences (`src/App.fs:465,466,499,527,538,539,568,569`):
`error FS0001: The type 'System.Guid' does not match the type 'string'`. Id values are typed `Guid`
in one place and `string` in another within the same generated file.
Workaround: none short of hand-editing generated F#, which the next regenerate overwrites.
Impact on adoption: the Feliz target does not build a realistic model at all. If a team picked F#
as their frontend on the strength of the README, they would discover this after committing.
Time lost: 25 min

---

### F-018 — The rename heuristic silently mis-migrates data when a field is deleted and an unrelated one added, ignoring the author's explicit backfill and contradicting the documented rule
Severity: **S1** (blocker — silent data corruption on a populated production database)
Class: **SILENT** gap, and a **contradicted documented guarantee**
Area: phase-⑨ migration derivation / rename detection
Claim under test: `docs/migrations.md` §"Rename detection (heuristic fallback)" — *"**A backfilled add
is an explicit new column, never treated as a rename.**"* and *"Rather than silently degrade to a
data-losing drop+add, it **aborts** …"*

Repro: `eval/repro/migr/v1.ddd` → `eval/repro/migr/v2.ddd` (two 14-line models).
v1 has `Part { sku, binCode }`. v2 **deletes `binCode`**, **adds an unrelated `supplierRef`**, and
declares an explicit backfill for the new column:
```ddd
migration "add-supplier-ref" {
  Part.supplierRef = "NO-SUPPLIER"
}
… aggregate Part with crudish { sku: string  supplierRef: string … }
```
```
$ node bin/cli.js generate system eval/repro/migr/v1.ddd -o eval/out-migr   # baseline
$ node bin/cli.js generate system eval/repro/migr/v2.ddd -o eval/out-migr
0 error(s), 0 warning(s).
Wrote 11 file(s) in eval/out-migr, unchanged: 31
EXIT=0
$ cat eval/out-migr/api/db/migrations/<newest>.sql
ALTER TABLE "c"."parts" RENAME COLUMN "bin_code" TO "supplier_ref";
$ grep -l 'NO-SUPPLIER' eval/out-migr/api/db/migrations/*.sql
  (no match — the author's declared backfill appears in NO migration file)
```
Three things go wrong at once, all silently:
1. **Data lands in the wrong column.** Every row's bin code becomes its supplier reference. Not
   deleted — *misattributed*, which for an audited system is worse than loss because nothing looks
   missing.
2. **The author's explicit backfill is discarded.** `Part.supplierRef = "NO-SUPPLIER"` never runs.
3. **The documented rule that should have prevented it did not fire.** The doc says a backfilled add
   is "never treated as a rename"; it was.

`--allow-destructive` does not help — it emits the identical RENAME. I could find **no way to express
"drop `binCode`, add `supplierRef`" in one change**; you would have to split it across two deploys
and would have no reason to know that.

I also reproduced the benign half, so the heuristic is not simply broken: renaming
`binLocation → binCode` with *no* other change correctly emitted
`ALTER TABLE "field"."parts" RENAME COLUMN "bin_location" TO "bin_code"`, and I verified live against
the running stack that all rows survived with values intact. The defect is that the heuristic cannot
tell that case apart from mine, and the documented escape (an explicit backfill) does not disambiguate.
Workaround: a human must read every generated migration before it is applied, every time. That is
sound practice anyway, but it means the migration story is **not** safe to automate in CI, which is
how it is presented.
Impact on adoption: this is the highest-consequence finding in the evaluation. It is a
data-integrity defect on the one path where mistakes are unrecoverable, it is silent, and it
contradicts the documentation a team would rely on. Our product is audited; we could not ship this
without a mandatory human migration review gate.
Time lost: 40 min

**Recorded as the counterweight — the rest of the migration story is genuinely strong:**
- Adding a `NOT NULL` column to a populated table **refuses** with **exit code 1**, writes nothing,
  names the exact DDL, and points at both remedies:
  `migration for module "Ops" contains 1 destructive change(s): - ADD COLUMN field.parts.bin_location NOT NULL (no default)`.
- Supplying the backfill produces the textbook three-step, which I applied to a live populated DB
  with **zero data loss** and correct backfill:
  ```sql
  ALTER TABLE "field"."parts" ADD COLUMN "bin_location" TEXT NULL;
  UPDATE "field"."parts" SET "bin_location" = 'UNASSIGNED' WHERE "bin_location" IS NULL;
  ALTER TABLE "field"."parts" ALTER COLUMN "bin_location" SET NOT NULL;
  ```
  (verified: 2 parts / 3 customers / 2 work orders / 1 technician all intact afterwards)
- Tenant and FK indexes are derived automatically (`customers_tenant_id_idx`, `data_key` pattern-ops).

---

### F-019 — Hand edits to generated files are overwritten with no warning (documented contract, but the report line is silent about it)
Severity: **S3** (friction — the behaviour is documented and there is a working escape hatch)
Class: **DOCUMENTED**
Area: regeneration / file-write plan
Claim under test: README — "**The keys to the codebase**", "walk away with real, owned source code",
"full ownership of every line that's generated".

Repro: edited two generated files by hand (a Drizzle repository and a scaffolded React page), each
with a marker comment, then regenerated:
```
$ node bin/cli.js generate system eval/fieldops/main.ddd -o eval/out-fieldops
Wrote 3 file(s) in eval/out-fieldops, unchanged: 153
$ grep -c 'HAND-EDIT' …/part-repository.ts   → 0
$ grep -c 'HAND-EDIT' …/pages/assets/detail.tsx → 0
```
Both edits gone. The summary line says "Wrote 3 file(s)" and does **not** distinguish "rewrote a file
a human had modified" from "rewrote a file that was already ours". No backup, no prompt, no diff.
This is honest by design, not a trap: `docs/tools.md` §`.loomignore` states the contract in one
sentence — *"every file Loom generates is overwritten on every run"* — every emitted file opens with
`// Auto-generated.  Do not edit by hand.`, and the pin works exactly as advertised:
```
$ cat .loomignore
api/db/repositories/part-repository.ts
/docker-compose.yml
$ node bin/cli.js generate system … -o eval/out-fieldops
Wrote 1 file(s) in eval/out-fieldops, unchanged: 153, skipped (.loomignore): 2
   → both hand edits survived
$ node bin/cli.js generate system … --dry-run
  skip (.loomignore)  api/db/repositories/part-repository.ts  (6.3 KB)
  skip (.loomignore)  docker-compose.yml  (2.7 KB)
```
**The honest answer to "you own the source": you own it until the next regenerate, unless you pin
it — and a pinned file stops tracking the model.** That trade is the real cost, and it is the one a
buyer must price in: every pinned file is a file you now maintain by hand against a model that keeps
moving, with no tool telling you when it has drifted.
Time lost: 15 min

---

### F-020 — Cyclic entity containment crashes the generator with a `RangeError` stack trace instead of a diagnostic
Severity: **S2** (major — a crash where a diagnostic belongs; no `loom.*` code, no source location)
Class: **SILENT** gap (validation accepts it; the generator dies)
Area: validation / node backend `repository-find-builder`
Claim under test: README — "Validation gates catch hallucinated fields and out-of-scope references
before any code is emitted"; `docs/tools.md` — "All `generate` sub-commands run validation first and
refuse to emit if there are errors."

Repro: `eval/repro/broken/05-cyclic-containment.ddd` — 8 lines. Entity `X` contains `Y[]`, entity `Y`
contains `X[]`.
```
$ node bin/cli.js parse eval/repro/broken/05-cyclic-containment.ddd
0 error(s), 0 warning(s).
OK: 05-cyclic-containment.ddd

$ node bin/cli.js generate system eval/repro/broken/05-cyclic-containment.ddd -o eval/out-cyclic
0 error(s), 0 warning(s).
RangeError: Maximum call stack size exceeded
    at Array.find (<anonymous>)
    at file:///home/user/Loc/out/generator/typescript/repository-find-builder.js:155:34
    at Array.flatMap (<anonymous>)
    at nestedContainLoads (file:///home/user/Loc/out/generator/typescript/repository-find-builder.js:154:26)
    … (repeats)
exit code 1
```
`nestedContainLoads` walks the containment tree with no cycle guard. The validator reports the model
as clean, so the first sign of trouble is an unhandled Node exception naming a compiler-internal
file the user has never heard of — with **no `.ddd` line number** to work back from.
Expected: a `loom.*` diagnostic ("containment cycle X → Y → X") pointing at the source line.
Credit where due: **this was the only one of ten deliberately-broken models that failed to produce a
clean diagnostic** (see the error-quality table in EVAL-LOG). The other nine were excellent.
Workaround: don't write cyclic containment — but you won't know that's what you did.
Impact on adoption: low frequency, high confusion when hit. An engineer's first day with the DSL is
exactly when they'd write something like this.
Time lost: 10 min

---

### F-021 — `ddd breakpoints` resolves declaration-level model lines to generated **line 1**, so you cannot set a breakpoint from a model line
Severity: **S3** (friction — the reverse direction, `ddd trace`, works well)
Class: **SILENT** gap
Area: `--sourcemap` / `ddd breakpoints`
Claim under test: `docs/tools.md` / CLI help — "`breakpoints` — Resolve a .ddd source line to the
generated file:line(s) it produced … the reverse of `ddd trace`"; `docs/debugging.md`.

Repro (FieldOps, `--sourcemap`, 46 KB map emitted):
```
$ node bin/cli.js breakpoints eval/fieldops/main.ddd --line 203 --map eval/out-fieldops/.loom/sourcemap.json
eval/fieldops/main.ddd:203 maps to 2 generated location(s):
api/domain/workOrder.ts:1
api/http/workOrder.routes.ts:1
```
Model line 203 is `operation complete(note: string) when status == InProgress {`. The real locations
are `api/domain/workOrder.ts:155` (`public complete(note: string): void {`) and
`api/http/workOrder.routes.ts:299` (`path: "/{id}/complete"`). Both are reported as **line 1**.
Sampling four model lines: `195 → workOrder.ts:144:20` (**correct**, with a column — a fine
expression region), but `150`, `203`, `210` all → `:1`. So the map carries accurate
*expression-level* regions and degrades to line 1 for *declaration-level* ones — which are exactly
the lines an engineer wants a breakpoint on.
Workaround: search the generated file for the member name.
**The reverse direction is genuinely good and worth stating plainly:** given a real runtime stack
from generated code —
```
DomainError: Precondition failed: onHand >= qty
    at Part.consume (…/api/domain/part.ts:48:39)
```
`ddd trace` annotated it as `Field.Part.consume (…/eval/fieldops/main.ddd:134)`, and line 134 is
exactly `precondition onHand >= qty` — the precise failing statement. **Production triage from a
stack trace back to the model works.** Setting a breakpoint forward from the model does not.
Time lost: 20 min

---

### F-022 — The generated Prometheus config cannot scrape the generated app: `/metrics` is auth-gated, the scrape job sends no credentials
Severity: **S3** (friction — ops papercut, trivially fixable, but it ships broken)
Class: **SILENT** gap
Area: observability emission / `monitoring/prometheus.yml`
Claim under test: `docs/observability.md`; README "healthchecks"; the emitted `docker-compose.obs.yml`
(api + prometheus + jaeger).

Repro: FieldOps with `auth: required`, stack running.
```
$ curl -o /dev/null -w '%{http_code}' localhost:3000/health   → 200
$ curl -o /dev/null -w '%{http_code}' localhost:3000/ready    → 200
$ curl -o /dev/null -w '%{http_code}' localhost:3000/metrics  → 401
$ cat monitoring/prometheus.yml
scrape_configs:
  - job_name: api
    metrics_path: /metrics
    static_configs:
      - targets: ["api:3000"]        # no bearer_token, no basic_auth
```
Gating `/metrics` behind auth is a defensible default; emitting a scrape job that cannot satisfy it
is not. The two halves are generated by the same tool from the same model, so they should agree.
Expected: either leave `/metrics` open on the internal port, or emit `bearer_token_file` /
`basic_auth` in the scrape job, or note the required step.
Workaround: hand-edit `monitoring/prometheus.yml` (and pin it in `.loomignore`).
Impact on adoption: an SRE team wires this up on day one, sees an empty dashboard, and spends an
afternoon. Small, but it is exactly the class of thing that erodes trust in generated ops config.
Time lost: 10 min

---

### F-010 — `docs/language.md` documents a `channel … carries:` syntax that does not parse
Severity: **S3** (friction — first-contact papercut, hit within the first hour)
Class: **DOCUMENTED**-wrong (docs contradict the grammar)
Area: docs / channels
Claim under test: `docs/language.md:325` — "`channel Name { carries: [Event, …], delivery: …`"

Repro:
```ddd
channel WorkOrderEvents { carries: [WorkOrderCompleted], delivery: broadcast, retention: ephemeral }
```
```
$ node bin/cli.js parse eval/fieldops/main.ddd
main.ddd:137:42 error: Expecting token of type 'ID' but found `[`.
```
The grammar (`src/language/ddd.langium:1355`) takes a bare comma-separated list:
`('carries' ':' carries+=[EventDecl:ID] (',' carries+=[EventDecl:ID])* ','?)`, and
`docs/channels.md:36` shows the correct bare form. So `language.md` — the *formal language
reference*, the doc a new user reads first — contradicts both the grammar and the sibling doc.
The parse error does not say "drop the brackets".
A second instance of the same class: `docs/language-reference/06-behavior-and-statements.md:364`
says "omitting the parens keeps it quiet", but `create { }` is a parse error —
`Expecting token of type '(' but found '{'`; `create()` is required.
Impact on adoption: small individually. Two doc-vs-grammar contradictions inside one afternoon of
first use is a signal about doc maintenance, in a product whose docs are otherwise unusually good.
Time lost: 8 min

---

## Re-verification against fresh `main` (2026-09-14)

The evaluation was written against `bcd25e3e`. `main` moved **190 commits** in the interim. Per
`CLAUDE.md` ("a stale base lies twice"), every finding was re-run before any fix was written.
Method: `git rebase origin/main`, rebuild, re-run each repro, and inspect the *generated output*
rather than the exit code.

| Finding | Status on fresh `main` | Evidence |
|---|---|---|
| **F-012** Java `mask unless` missing `import java.util.Objects` | ✅ **ALREADY FIXED** | the emitted `TechResponse.java` now carries 1 use / 1 import |
| **F-011** .NET channel `CS0234` | 🔶 **CLAIMED** by open PR #2911 | verified on that branch: `global::Api.Infrastructure` ×2, 0 unqualified |
| **F-008** compose pins withdrawn `minio/minio` | 🔶 **CLAIMED** by open PR #2911 | named in its body (their F-020) |
| **F-016** Angular array → `FormControl(null)` | 🔶 **CLAIMED** by open PR #2927 | their fix covers "`string[]`, enum collections — every non-VO array", i.e. my `enum[]` case |
| F-003, F-005, F-006, F-007, F-009, F-010, F-013, F-014, F-015, F-017, F-018, F-019, F-020, F-021, F-022 | ❌ **still reproduce** | re-run verbatim; see each finding |

Two collisions were settled **empirically rather than by reading PR titles**, because the titles
were misleading in both directions:
- PR #2923 touches `src/generator/feliz/**` heavily for a name-collision class. I checked out the
  branch, built it, and re-ran my repro: `grep -c '^type ScheduleWorkOrderForm ='` → **still 2**.
  Different collision. **F-017 is unclaimed.**
- PR #2911 touches `src/generator/elixir/vanilla/**`. On that branch the `enum[]` Ecto type is
  **still** `{:array, Ecto.Enum, values: […]}` and the criterion still lacks its `^` pin.
  **F-013-elixir and F-014 are unclaimed.**

Net: **1 fixed upstream, 3 claimed by others, 17 unclaimed and mine to fix.**

---

### F-023 — The SAME operation/workflow name collision breaks React, Vue and Svelte via a different mechanism (found while fixing F-017)
Severity: **S1** (blocker — output does not compile)   Class: **SILENT** gap
Area: codegen / `src/generator/_frontend/` request-schema naming
Discovered by the agent fixing F-017, confirmed with `tsc --strict` on a reduced two-module case, **not fixed**
(fixing it would have blown the minimal-diff mandate on the Feliz change).

The model that collides on Feliz (`WorkOrder.schedule` operation + `scheduleWorkOrder` workflow) also breaks
react/vue/svelte, but in the *api-client* layer rather than the form layer: the operation's request schema lands
in the aggregate api module and the workflow's in `api/workflows.ts`, **both named `<Wf>Request`**, and the page
imports both:
```ts
import { ScheduleWorkOrderRequest, useScheduleWorkOrderWorkflow } from "../api/workflows";
import { ScheduleWorkOrderRequest, useScheduleWorkOrder } from "../api/workOrder";
// → error TS2300: Duplicate identifier 'ScheduleWorkOrderRequest'
```
**Angular escapes by accident** (its page imports the workflow request but not the operation's).
**Flutter escapes by construction** — `flutter/forms-emit.ts:65-83` already uses per-family names
(`Create<Agg>Form` / `<Op><Agg>Form` / `<Wf>WorkflowForm`), which is exactly the shape the Feliz fix adopted.
So the correct fix is known and already shipping on one target.
Impact: raises the F-017 blast radius from 1 frontend to **4 of 6**. Recorded in the new Feliz test header so it
is not lost.

---

### F-024 — `For { each: … }` inside a `QueryView` `data:` lambda emits `yield!` in a non-list context (Feliz)
Severity: **S2**   Class: **SILENT** gap
Area: codegen / Feliz walker list rendering
Also found while building the F-017 repro; **not fixed** (separate emitter path).
`dotnet build` → `error FS0747`. The agent rewrote its repro around the defect rather than widen the change.

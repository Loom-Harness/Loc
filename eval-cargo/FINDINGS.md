# Meridian evaluation — findings

Repo `Loom-Harness/loc` @ `86628b3f`, evaluated 2026-09-22.
Severity: **SILENT** = `parse`/`generate` report 0 errors, defect appears later (build or runtime).

| # | Severity | Title |
|---|---|---|
| F-001 | Medium (DX) | `route` is a reserved field name; parse error points at the *next* line and says "Expecting `}`" |
| F-002 | **SILENT / High** | ICU format specs in interpolation are dropped on the backend; `{x, date}` emits non-compiling TypeScript |

---

## F-001 — `route` cannot be used as a field name; the diagnostic misdirects

`route` is a keyword in the `api { }` body (`route GET "/x" -> handler`). Used as an
aggregate field name it is a parse error — but the error is reported on the **following**
line, as a generic "Expecting token of type '}'".

```ddd
aggregate Cargo {
  customer: Customer id
  route: RouteSpecification      // <- the real problem
  bookedAt: datetime
}
```
```
booking.ddd:29:5 error: Expecting token of type '}' but found `route`.
```
The message names `route` but frames it as a block-termination problem, so the natural
reading is "I have an unbalanced brace above". Cost me a wrong-line hunt.
Same defect class as the prior evaluations' `state` / `member` findings — a reserved-word
collision with no reserved-word diagnostic.

**Workaround:** rename the field (`routeSpec`).

## F-002 — ICU format specs are silently dropped; `{x, date}` emits code that does not compile

`docs/language.md` documents format suffixes on interpolation holes:
`{total, number, ::currency/USD}`, `{n, plural, one {# item} other {# items}}`,
`{at, date}`, `{n, number, ::percent}`, `{kind, select, …}`.

All five parse with **0 errors, 0 warnings** and all five are **dropped** by the node
emitter — the format, and in the `plural`/`select` cases the declared literal text, vanish:

| Source | Generated (node) |
|---|---|
| `` `{total, number, ::currency/USD}` `` | `this._total.toString()` |
| `` `{qty, plural, one {# item} other {# items}}` `` | `String(this._qty)` |
| `` `{qty, number, ::percent}` `` | `String(this._qty)` |
| `` `{name, select, vip {VIP} other {std}}` `` | `this._name` |
| `` `{placedAt, date}` `` | `this._placedAt`  ← **type error** |

The last one does not compile. `_placedAt` is a `Date`; the getter is declared `string`:

```
$ ddd parse icu.ddd        → 0 error(s), 0 warning(s).
$ ddd generate ts icu.ddd  → Wrote 27 file(s)
$ npm install && npx tsc --noEmit
domain/order.ts(34,21): error TS2322: Type 'Date' is not assignable to type 'string'.
```

Repro: `eval-cargo/repro/icu.ddd`.

**Impact.** A money label that silently renders `1234.5` instead of `$1,234.50`, and a
pluralisation whose text disappears, are wrong-output bugs a reviewer will not catch in a
diff. The `date` case is worse only in being noisy.

---

## F-003 — An aggregate with no `create` action silently exposes no creation endpoint

`docs/language.md` (the `api` row) says aggregates expose `all / byId / create / update / delete`.
In fact a create route is emitted only when the aggregate declares an unnamed `create(...)`
or `with crudish`. Without one you get `GET /{id}`, `GET /`, the operation routes — and no
way to create the record. `parse` reports **0 errors, 0 warnings**.

```
$ grep 'path:' ctor2-out/http/flat.routes.ts     # aggregate Flat: no create, no crudish
path: "/{id}"     path: "/{id}/finish"     path: "/"
```
Repro: `eval-cargo/repro/ctor2.ddd`. I hit this on both `Cargo` and `Invoice` in the real
model and only noticed by reading the emitted route table.

**Note the contrast:** if you *call* `Agg.create({…})` from a `test`, the compiler produces
an outstanding error explaining non-constructibility and what to do. The silent case is only
when you never call it.

## F-004 — `denyByDefault` cannot be satisfied for a hand-written or event-sourced `create`

**This blocks generation, and for event sourcing there is no workaround.**

`loom.default-deny-ungated` demands a `requires` gate on every reachable command, including
`Agg.create`. The grammar has no `requires` slot on `create`
(`src/language/ddd.langium:1930` — `'create' (name=ID)? '(' params ')' (audited?='audited')? '{'`):

```
$ cat createreq.ddd            # aggregate Thing { create(name: string) requires CanMake() { } }
createreq.ddd:5:26 error: Expecting token of type '{' but found `requires`.
```

So the diagnostic's own suggested fix — *"Add a `requires <expr>` (use `requires true` to
allow anonymous access)"* — **is not expressible**. `docs/language.md` likewise lists
`requires` as "a header clause on `operation` / `create` / `handle` / `find` / `projection`";
it is not accepted on `create`.

Escapes, by aggregate kind:

| Aggregate | Escape |
|---|---|
| state-based, hand-written `create` | replace with `with crudish(requires: P)` — works, but swaps your factory for the macro's and re-opens a generic `update` surface |
| **`persistedAs: eventLog`** | **none.** `crudish` is structurally rejected on an ES aggregate ("declares multiple 'create' actions" / "must not mutate 'this' directly"), and there is no `requires` on `create`. |

Net: **`enforcement: denyByDefault` and `persistedAs: eventLog` are mutually exclusive** —
an event-sourced aggregate may have a creation endpoint, or the recommended security
posture, not both. Proven three ways in `eval-cargo/repro/esgate{,2,3}.ddd`:

```
ES + create + denyByDefault   → 1 error, generation refused (ungateable)
ES + crudish(requires:)       → 3 errors (crudish incompatible with event sourcing)
ES with no create at all      → 0 errors — but the aggregate can never be created
```

## F-005 — `tenancy by` does not reach aggregates in imported files

Multi-file projects and multi-tenancy are both headline features; together they fail.
The identical model, split across an `import`, stops compiling:

```
# one file:  system { tenancy by user.orgId of Org; aggregate Doc with tenantOwned … }
→ 0 errors
# same model, aggregates moved to ./model/dom.ddd and imported:
model/dom.ddd:1:1 error: 'currentUser.orgPath' requires a 'tenancy by user.<claim> of
  <Registry>' declaration — … Add the tenancy line, or drop the 'orgPath' reference.
```
The tenancy line *is* present, in `main.ddd`. Moving it into the imported file is not
possible either — `tenancy` is not admitted at file root
(`Expecting token of type 'EOF' but found 'tenancy'`).

**Exact constraint** (`repro/ten-multi3`): every `tenantOwned` aggregate must live in the
*same file* as the `tenancy by` declaration. Unrelated files may still be imported. For a
multi-context domain this forces the whole domain into one file — mine went from four
files to one.

## F-006 — `policy` and `permissions` are scoped far narrower than documented

`docs/language.md` calls a named policy function "a reusable, **ambient** boolean
authorization predicate". It is context-local:

```
# policy IsAdmin() declared in context A, used from context B:
polscope.ddd:10:36 error: 'requires' must be of type 'bool', got 'unknown'.
```
`permissions { }` blocks are subdomain-local in the same way. Both must be copy-pasted into
every context/subdomain that references them — my consolidated model carries five policy
declarations **four times**.

Worse for `permissions`: the identifier lowers to `<lowercase-subdomain>.<name>`, so the
duplicated declaration is not the same permission. `permissions.routeCargo` declared in
`Shipping` and in `Operations` yields **two distinct runtime strings**
(`shipping.routeCargo`, `operations.routeCargo`), both of which the IdP must now grant.
Duplicating a security vocabulary across subdomains is precisely where drift becomes a
vulnerability.

Secondary: the diagnostic is one of the few poor ones — `'requires' must be of type 'bool',
got 'unknown'` reads as a type problem, not "no policy of that name is in scope here".

## F-007 — **SILENT**: a shared-kernel value object inside another value object emits out-of-order Zod schemas; react / vue / svelte do not compile

The shared kernel is the textbook place to put a type two contexts share. Put a root-level
`valueobject` inside a context-local `valueobject`, and the generated frontend references
the inner schema **before it is declared**:

```ts
// web_app/src/api/cargo.ts — generated, 0 errors reported
export const RouteSpecificationSchema = z.object({
  origin: UnLocodeSchema,          // ← line 9
  ...
export const UnLocodeSchema = z.object({ … });   // ← line 13
```
```
src/api/cargo.ts(9,11): error TS2448: Block-scoped variable 'UnLocodeSchema' used before its declaration.
src/api/cargo.ts(9,11): error TS2454: Variable 'UnLocodeSchema' is used before being assigned.
=> docker compose build web_app: "npm run build" exit code 2
```

Emission is in declaration order with context-local VOs first, so it is specifically the
**root-level → context-local** direction that inverts. Isolated in `repro/zodorder/`:

| Shape | Order emitted | Result |
|---|---|---|
| both VOs in the same context | `Inner`, `Outer` | compiles |
| inner VO at model root, outer in a context | `Outer`, `Code` | **TS2448 / TS2454** |

**Blast radius** — the three frontends that emit runtime Zod `const`s:

| Frontend | Emits | Affected |
|---|---|---|
| react | `export const XSchema = z.object(…)` | **yes** |
| vue | same | **yes** |
| svelte | same | **yes** |
| angular | `export interface XResponse` (hoisted) | no |

`ddd generate system` reports `0 error(s)`; the failure is a `docker compose build` away.
This is the defect class the previous evaluations named as their top blocker, in a new shape.

## F-008 — **SILENT / runtime-breaking**: a cross-context value object makes the migration SQL and the ORM schema disagree on column name *and* type

Referencing a `valueobject` declared in **another context** — the ordinary DDD shared-type
move — emits a database schema the generated ORM cannot read.

Same field, same run, two generated artifacts (`repro/voxctx.ddd`):

| Aggregate | Migration SQL | Drizzle ORM schema | Agree? |
|---|---|---|---|
| `Owner.Home.spot` (VO in the same context) | `"spot_value" TEXT NOT NULL` | `spot_value: text("spot_value")` | ✓ |
| `Consumer.Away.spot` (**VO from another context**) | `"spot" JSONB NOT NULL` | `spot_value: text("spot_value")` | ✗ **name *and* type** |

The database gets a JSONB column called `spot`; the ORM reads and writes a TEXT column
called `spot_value`, which does not exist. `ddd generate system` reports `0 error(s)`, both
files are valid TypeScript/SQL, and every compile-time gate passes — the disagreement is
only observable against a live database.

The same divergence is present in my real model (`Handling.CargoReceived.location`,
`Handling.CargoLoaded.location`, VO `UnLocode` declared in `Booking`).

### F-007 + F-008 together: a shared value object has no correct home

| Where you declare the shared VO | react / vue / svelte build | migration ↔ ORM |
|---|---|---|
| model root (the documented shared kernel) | **fails — TS2448** (F-007) | consistent |
| inside one context, used from another | compiles | **diverges — runtime failure** (F-008) |

Both placements are documented as supported. Each breaks a different layer, and neither
is reported at generate time. The only shape that works is duplicating the value object
into every context that uses it, which defeats the point of a shared kernel.

## F-009 — **SILENT**: `domainService` precondition emits an unimported `DomainError`; the guard becomes a `ReferenceError` at runtime

A `domainService` operation with a `precondition` emits a `throw new DomainError(...)` into
`domain/services.ts`, which imports only `decimal.js`:

```ts
// domain/services.ts — generated, complete import list
import Decimal from "decimal.js";
export namespace Calc {
  export function quote(km: number, rate: Decimal): Decimal {
      if (!(km > 0)) throw new DomainError("Precondition failed: km > 0");   // ← never imported
```
```
domain/services.ts(7,40): error TS2304: Cannot find name 'DomainError'.
```

Runtime proof (`repro/svcproj.ddd`, executed with `tsx`):
```
ok: 20                                        # happy path fine
threw: ReferenceError | DomainError is not defined     # the guard path
```
So the declared business rule does not reject the input — it crashes the process path. A
`precondition` that should surface as **422 Unprocessable Entity** surfaces as **500**.

**Why it ships:** the generated `Dockerfile` builds with `tsup` (esbuild), which strips types
without checking them. `npm run typecheck` exists in the emitted `package.json` but nothing
runs it, so `docker compose build` succeeds on a project that `tsc --noEmit` rejects. This is
the previous evaluations' condition C5, still open.

## F-010 — **SILENT**: a query-time projection publishes an empty response schema

A `projection … { from X group by … select a = …, b = … }` emits its row schema with **no
properties**:

```ts
const OutstandingByStatusRow = z.object({
}).openapi("OutstandingByStatusRow");
...
return httpCtx.json(projected as z.infer<typeof OutstandingByStatusResponse>, 200);
```
```
http/query-projections.ts(63,27): error TS2352: Conversion of type '{ status: …;
  invoiceCount: number; outstanding: string; }[]' to type 'Record<string, never>[]'
  may be a mistake because neither type sufficiently overlaps with the other.
```

The runtime response is **correct** — I verified it against the booted stack:
```
GET /api/projections/outstanding_by_status
[{"status":"Issued","invoiceCount":1,"outstanding":"2500.0000"}]
```
but the **published contract is not**:
```
GET /openapi.json → components.schemas.OutstandingByStatusRow
{ "type": "object", "properties": {} }
```
Any client generated from this OpenAPI document sees a projection with no columns. Repro:
`repro/svcproj.ddd`.

## F-011 — the generated Keycloak realm cannot satisfy the model it was generated from

`ddd generate system` emits a working `keycloak` compose service with an imported realm — a
genuinely nice touch. But the realm is **not derived from the model's own auth configuration**:

| The model declares | The generated realm contains |
|---|---|
| `claims: { role: "role", orgId: "org_id", permissions: "realm_access.roles" }` | one `oidc-audience-mapper`, and no mapper for `role` or `org_id` |
| `permissions { bookCargo, routeCargo, invoiceRead, invoiceIssue, admin implies […] }` → runtime strings `shipping.bookCargo`, `finance.invoiceIssue`, … | realm roles `user`, `agent`, `admin` — none of the declared permissions |
| `tenancy by user.orgId of Org` | the `demo` user has no attributes at all |

So the bundled `demo` user gets a token with no `org_id` and no `role`. Against the stack as
shipped that user sees **every list empty** (the tenant filter matches nothing) and gets
**403 on every gated command**:

```
POST /api/cargos  → 403 {"title":"Forbidden","detail":"Forbidden: CanBook()"}
GET  /api/cargos  → 200 {"items":[],"total":0}
```

The generated code is correct — I confirmed it by provisioning Keycloak by hand (5 realm
roles, 2 protocol mappers, `unmanagedAttributePolicy: ENABLED`, per-user `org_id` matching
the `Org` row id). After that everything worked. But "boot the stack and it works" does not
hold for any model using roles, permissions or tenancy, and nothing in the output says so.

## F-012 — **HIGH / operational**: the first in-place model evolution silently skips its own migration, and crashes the boot if any field is `provenanced`

The migration journal keys each entry by `when = <module base timestamp> + <array index>`.
Inserting a migration **renumbers every later entry**, so the journal no longer agrees with
what the database recorded as applied.

Evolving my running system (added `notes: string?` and `priority: int = 3` to `Cargo`):

| tag | `when` in journal (after) | `created_at` recorded in DB (applied) |
|---|---|---|
| `20260101000000_shipping_initial` | 1767225600000 | 1767225600000 |
| `20260101500001_shipping_migrate` **(new)** | 1767405601001 | — |
| `20260102000000_operations_initial` | 1767312000**002** | 1767312000**001** |
| `20260103000000_finance_initial` | 1767398400**003** | 1767398400**002** |
| `20260104000000_platform_initial` | 1767484800**004** | 1767484800**003** |
| `29991231000000_provenance` | 32503593600**005** | 32503593600**004** |

Drizzle's migrator runs an entry only when `lastApplied.created_at < entry.when`. Two
consequences, both observed:

**1. The new migration is silently skipped.** Its `when` (1767405601001) is *lower* than the
highest applied value (32503593600004, the year-2999 provenance entry), so it never runs:
```sql
select column_name from information_schema.columns
 where table_schema='booking' and table_name='cargos' and column_name in ('notes','priority');
-- (0 rows)
```
The emitted SQL was correct — `ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 3` then
`DROP DEFAULT`, exactly the safe pattern. It was simply never executed, with no error.

**2. If any field is `provenanced`, the API will not boot.** The provenance migration is
pinned to a year-2999 timestamp so it always sorts last, so it is *always* the entry whose
number increments — which makes it always newer than the recorded maximum, so it always
re-runs:
```
{"event":"migration_failed","error":"Failed query: ALTER TABLE \"billing\".\"invoices\"
  ADD COLUMN \"total_provenance\" JSONB NULL;"}
cause: error: column "total_provenance" of relation "invoices" already exists
Node.js v24.21.0     ← process exits; container never becomes healthy
```

The **first deploy is fine** — the whole chain applies in order against an empty database.
It is the second deploy, the first real evolution, that fails. That is the deploy where a
production database already has data in it.

Note the contrast with the *derivation* layer, which is genuinely careful: it refused an
unannotated rename (`drop [location_value] + add [location] … would DESTROY the renamed
column's data`), refused to re-baseline over an existing history, and refused a destructive
drop without `--allow-destructive`. The safety analysis is good; the journal's ordering key
is what breaks.

## F-013 — **SILENT**: .NET wire validators call `Regex.IsMatch` without `using System.Text.RegularExpressions`

A value-object invariant using `.matches(...)` is lifted into a FluentValidation request
validator that never imports the regex namespace:

```csharp
// Application/Cargos/Requests/CargoRequestValidators.cs — complete using list
using FluentValidation;
...
        RuleFor(x => x).Must(x => Regex.IsMatch(x.Value, "^[A-Z]{5}$"))
```
```
/src/Application/Cargos/Requests/CargoRequestValidators.cs(21,35):
  error CS0103: The name 'Regex' does not exist in the current context
=> dotnet build FAILED
```
The **domain** emitter gets this right — `Domain/ValueObjects/UnLocode.cs` does emit
`using System.Text.RegularExpressions;`. Only the wire-validator emitter forgets. Same
missing-import class as F-009 (node). Reproduced in `matrix/out/api_dotnet` from the
evaluation model; I did not isolate a smaller trigger.

---

# Cross-target compile matrix

One model (`eval-cargo/matrix/main.ddd`, 420 lines), one `generate system`, **1153 files**
across 11 deployables, `0 error(s)` reported. Then compiled each with its own toolchain:

| Target | Toolchain | Result | Cause |
|---|---|---|---|
| **node** (Hono) | `tsc --noEmit` | ❌ **FAIL** (3 errors) | F-009 (`DomainError` unimported), F-010 (empty projection schema) |
| **dotnet** (ASP.NET) | `dotnet build /warnaserror` | ❌ **FAIL** | F-013 (`Regex` missing `using`) |
| **java** (Spring Boot) | `gradle testClasses bootJar` | ❌ **FAIL** | F-010 twin — projection row emitted as a **record with no components**, then constructed with 3 arguments |
| **python** (FastAPI) | `ruff` ✓ + `mypy --strict` | ❌ **FAIL** (2 errors) | F-008 twin — ORM row declares `location_value`, hydrator reads `row.location` |
| **elixir** (Phoenix) | `mix compile` | ⚠️ not evaluated | environment: hex.pm returns `503` to Erlang's TLS stack through this sandbox's proxy (a *documented* Loom wrinkle with a documented workaround, `LOOM_HEX_MIRROR`) |
| **react** | `vite build` | ✅ pass | |
| **vue** | `vite build` | ✅ pass | |
| **svelte** | `vite build` | ✅ pass | |
| **angular** | `ng build` | ✅ pass | (host Node v22.22.2 is one patch below Angular CLI's v22.22.3 floor — **environment**; passes in a `node:24` container) |
| **feliz** (F#/Fable) | `dotnet fable` | ⚠️ not evaluated | no .NET SDK on host |
| **flutter** | `flutter analyze` | ⚠️ not evaluated | environment: Dart's `pub.dev` TLS fails through the proxy |

**4 of the 4 backends I could compile do not compile.** The three that fail hard (dotnet,
java, python) fail on ordinary modelling: a regex invariant, a `group by` projection, a
cross-context value object. The node failure is the most dangerous of the four, because its
own Dockerfile builds with `tsup`/esbuild and ships the broken code anyway.

Java is worth singling out: the **same** projection defect is a soft `tsc` error on node and
a hard compile failure on Java, which is what "one model, five backends" means in practice —
a single emitter gap costs you a whole target.

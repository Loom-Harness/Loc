# Dev-experience audit — building a freight-forwarding system end to end (2026-09-10)

**Method.** Built a cargo-shipping / freight-forwarding `.ddd` as an ordinary
user, over three iterations that simulate real rounds of user feedback, then
**compiled what came out** (`npm install` + `tsc --noEmit` on the generated
api) and **applied the generated migrations to a real `postgres:17`**.

Domain chosen for DDD density (Evans' canonical cargo-shipping example): value
objects, contained entities, a routing itinerary, handling events, a claims
saga, a tenant registry, and a second service consuming the first one's events.

| iteration | simulated feedback | surface exercised |
|---|---|---|
| v1 | — | aggregates, value objects, `entity` parts, `invariant`, `unique`, `criterion`, `derived display`, a workflow |
| v2 | "roll it out to several forwarding agencies, and hide customer contact details from non-ops staff" | `tenancy by … of`, `tenantOwned`, `crossTenant`, `auth {}` + OIDC, `permissions … implies`, `requires`, `mask unless`, two `migration {}` blocks to adopt it on a live database |
| v3 | "we need freight charging, dashboards, a claims process, and a customer-facing tracking service" | `money`, `domainService`, grouped + singleton `projection`, a command-triggered saga with `handle` continuations, `channel` + `channelSource`, a second (Python) deployable |

Final model: 5 aggregates, 2 value objects, 4 enums, 3 events, 3 commands,
2 projections, 2 workflows, 1 domain service, 1 channel, 4 deployables
(node + python + react + keycloak). It parses **0 errors, 0 warnings** and
generates 165 files.

**The generated TypeScript API does not compile — 17 `tsc` errors from five
distinct emitter defects, on a model the toolchain reports as clean.**

---

## Overlap with the two parallel dev-experience sessions

#2861 (Jira-like tracker) and #2862 (e-shop) ran the same exercise
concurrently. Deduped against both, and against #2850:

| already claimed | by |
|---|---|
| a command-triggered `create` on a state-bearing workflow emits an unbound receiver on all five backends | **#2850** (F58 / M-T6.60) — my run reproduced it on all five; not re-claimed |
| an `X id?` claim in `user {}` → unimported `Ids.` + doubled `\| null` | **#2862** D6 |
| `this.x :=` is a parse error, so the natural factory cannot be written | **#2862** D9 |
| `docs/language.md` documents `channel { carries: [A, B] }` with brackets | **#2862** D10 |
| parameterized query-time `projection` drops its parameter | **#2861** slice 1 |
| README / `docs/workflow.md` / `docs/traceability.md` / starter first-run breakage | **#2861** slice 3 |

Everything below is **not** claimed by any of them. Where a finding is adjacent
to a claimed one, the adjacency is stated in the finding.

---

## Defects

### D1 — adding a value-object collection field to an existing aggregate emits a migration that bricks the table

**Severity: data-destroying. Proven against a live `postgres:17`.**

Two generations against the same output directory:

```ddd
valueobject LineVO { sku: string  qty: int }
aggregate Order { note: string }                     // generation 1
aggregate Order { note: string  lines: LineVO[] }    // generation 2
```

Generation 2 reports `ADD COLUMN ord.orders.lines NOT NULL (no default)` as a
destructive change. Under `--allow-destructive` the emitted SQL contains the
correct child table **and** a phantom root column:

```sql
CREATE TABLE "ord"."order_lines" ( "order_id" …, "ordinal" …, "sku" …, "qty" … );
ALTER TABLE "ord"."orders" ADD COLUMN "lines" JSONB[] NULL;
ALTER TABLE "ord"."orders" ALTER COLUMN "lines" SET NOT NULL;
```

`schema.ts` has **no** `lines` column on `orders` — the ORM knows only the child
table, so nothing ever writes it:

```
INSERT INTO ord.orders (id, note, version) VALUES (gen_random_uuid(), 'hello', 1);
ERROR:  null value in column "lines" of relation "orders" violates not-null constraint
```

Every insert into the evolved table fails, permanently. On a populated table the
`SET NOT NULL` step fails at apply time instead.

The **initial** migration is correct (no phantom column) — the defect is only in
the **diff** path, which models a VO-collection field as a root scalar column
rather than as the child table the same generation emits.

Files: `src/system/migrations-builder.ts` (`schemaFromModule` — the value-
collection field must project to the child `TableShape`, not an `addColumn`).

### D2 — a `managed` / `internal` field's declared default is discarded

```ddd
aggregate A {
  name: string
  nm: int managed = 7
  im: string internal = "hidden"
  mm: money managed = money("2.50")
}
```

Emitted `create` factory, per backend:

| backend | `nm` | `im` | `mm` |
|---|---|---|---|
| **node** | **`0`** | **`""`** | **`null`** → **TS2322**, does not compile |
| python | `7` | `"hidden"` | **`None`**, where the annotation says `Decimal` |
| dotnet | `7` | `"hidden"` | **omitted** → CLR `0` |
| java | `7` | `"hidden"` | **omitted** → `null` `BigDecimal` |
| elixir | `7` | `"hidden"` | `Decimal.new("2.50")` ✅ |

Two overlapping defects. **node drops every non-create-input default** and
substitutes a type zero-value; **`money` defaults are dropped on four of five
backends**. Elixir is the only backend that is right in both columns.

The columns are NOT NULL, so the `null`/`None` variants are an insert failure and
the `0` variants are a silently wrong monetary value. An `editable` field's
default is honoured correctly everywhere (`input.n ?? 5`,
`input.m ?? new Decimal("1.50")`) — it is exactly the fields the *server* owns
that lose theirs.

### D3 — a `valueobject` holding an `X id` field emits `value-objects.ts` with no imports

```ddd
context V {
  aggregate Ship { name: string  derived display: string = name }
  valueobject Berth {
    ship: Ship id
    position: int
  }
  aggregate Dock { berths: Berth[]  name: string }
  repository Ships for Ship { }
  repository Docks for Dock { }
}
```

```ts
// generated domain/value-objects.ts — the file has ZERO import statements
export class Berth {
  readonly ship: Ids.ShipId;      // TS2503: Cannot find namespace 'Ids'
```

Same missing-import *class* as #2862's D6, different emitter and different file
(`domain/value-objects.ts` vs the auth emitters), so a fix for D6 will not
necessarily cover it — worth landing together.

**Why no gate sees it:** across all 371 corpus `.ddd` files there is effectively
no value object that holds a cross-aggregate reference — every one is
scalar-only (`Money { amount, currency }`, `Rank { tier, points }`). The
`hono-build.yml` fixture set has none.

### D4 — a workflow with an enum-typed state field emits an undefined `<Enum>Schema`

```ddd
workflow Review { doc: Doc id  st: St  create(e: Submitted) by e.doc { st := Filed } }
```

```ts
import { St } from "../domain/value-objects";   // the VALUE is imported
const ReviewInstanceResponse = z.object({
  st: StSchema,                                  // TS2304: Cannot find name 'StSchema'
```

`StSchema` is referenced once and defined **zero** times anywhere in the
generated tree. The aggregate route emitter gets this right — `cargo.routes.ts`
emits `const HandlingKindSchema = z.enum([…]).openapi("HandlingKind");` before
using it — so the fix is to give the workflow route emitter the same local
emission.

This lands on the **event-triggered** saga path as well, the one T4 records as
runtime-proven at full five-backend parity — so that proof cannot have included
a node `tsc --noEmit` of a saga whose state carries an enum.

Files: `src/platform/hono/v4/workflow-builder.ts`.

### D5 — `handle` continuations emit nothing, on every backend, with no diagnostic

```ddd
workflow Review {
  doc: Doc id
  st: St
  create(c: Submit) { st := Filed }
  handle approve(c: Approve) { precondition st == Filed  st := Approved }
}
```

Searching all five generated trees for `approve` finds only the enum value and
the mermaid diagram. No route, no handler, no method — the saga can be started
and read, never advanced. `docs/workflow.md:318` calls this the multi-command
saga surface ("Multiple handles make a multi-command saga").

Adjacent to #2850, which fixes `create` on the same workflow kind and does not
touch `handle`. Either implement it or reject it with a `loom.*` code; silence
is the worst of the three.

### D6 — an entity-part-typed operation parameter emits broken code on every backend, with no diagnostic

```ddd
aggregate Order {
  lines: Line[]
  entity Line { sku: string  qty: int }
  operation replaceLines(newLines: Line[]) { lines := newLines }
}
```

| backend | emitted | verdict |
|---|---|---|
| node | `z.array(z.unknown())`; `replaceLines(body.newLines.map((e:any) => e))` | compiles, **no wire contract**; `save()` then reads `child.id` / `child.parentId` → `undefined` → insert with a null PK |
| dotnet | `request.NewLines.Select(__e => __e).ToList()` is `List<LineResponse>` → `ReplaceLinesCommand(List<Line>)` | **CS0029** |
| java | `request.newLines()` is `List<LineResponse>` → `replaceLines(List<Line>)` | **javac error** |
| python | `list(body.newLines)` of `LineResponse` → `replace_lines(list[Line])` | type error + runtime breakage |

The **value-object** equivalent is emitted correctly (`new LineVO(e.sku, e.qty)`),
so the materialization step simply has no entity arm. No corpus file uses an
entity-typed operation parameter, which is why nothing catches it.

### D7 — a payload-typed workflow command parameter has no wire schema

`create(c: FileClaim)`, where `FileClaim` is a declared `command`, emits:

```ts
const ClaimHandlingRequest = z.object({ c: z.unknown() }).openapi("ClaimHandlingRequest");
```

The whole command payload is uncontracted at the boundary, and every downstream
`c.<field>` read is `TS18046: 'c' is of type 'unknown'`. This is the explicit-
command workflow form documented in `docs/workflow.md` ("a single payload param
(`create(c: PlaceOrder)`) is an explicit command"). Same class as D6.

It also puts this workflow shape outside #2850's fix, whose correlation key is
"the create param that name-matches the correlation field" — a payload param
never name-matches.

---

## Gaps (a decision, not a bug)

### G1 — a DSL field default never becomes a SQL column DEFAULT

`status: string = "pending"` emits `"status" TEXT NOT NULL` with no `DEFAULT`, in
the initial DDL and in the add-column diff alike. So the obvious way to make a
required-column add non-destructive does not work, and the author is pushed into
a separate `migration "…" { A.status = "pending" }` block that restates the same
value. `MigrationsIR` already carries an `alterColumnDefault` step, but no DSL
surface can produce a non-null column default to feed it.

Wiring scalar-literal defaults through would delete a whole class of
destructive-gate friction — including the one this audit hit twice while
evolving the freight model.

### G2 — a workflow with reactors but no starter is a silent runtime no-op

A workflow declaring only `on(e: Event) by …` and no `create(e: …) by` compiles
clean, then at runtime logs `event_unrouted` and returns, forever — no instance
ever exists to route to. `loom.reactor-event-uncarried` already performs exactly
this class of check for a different cause. This is the "validator ruling …
tracked separately" that #2850's `create-state.ts` header defers.

### G3 — a `mask unless` field stays in the list-read sort allowlist

`contactEmail: string sensitive(pii) mask unless currentUser.role == "ops"` is
redacted correctly at the wire boundary
(`if (!(currentUser?.role === "ops")) wire.contactEmail = null`), but the list
query still accepts `?sort=contactEmail&dir=asc`, so a caller who cannot read the
value can order by it and infer it. Masked and `secret` fields should be dropped
from the sort enum.

### G4 — a value-object collection field is required in the create input; an entity containment is not

Changing `entity Leg` to `valueobject Leg` turned a clean model into
`loom.workflow-create-missing-field … missing required field 'legs'`, fixed only
by passing `legs: []`. An empty collection is the natural default, and the entity
spelling already treats it that way.

---

## Papercuts

- **Every `money("…")` literal dumps Chevrotain internals to the user.**
  `MoneyLit` (`'money' '(' STRING ')'`) and `PrimitiveConversion`
  (`target='money' '(' Expression ')'`) both match it, so a plain
  `ddd parse examples/showcase.ddd` prints four lines of
  `Ambiguous Alternatives Detected: <7, 8> in <OR1> inside <PrimaryExpr> Rule`
  plus a chevrotain.io link, above `0 error(s), 0 warning(s). OK`. Reproducible
  on the repo's own shipped examples. Notably `examples/money-primitive.ddd` —
  whose header says it "exercises every shape money should appear in" and lists
  the `money("…")` constructor literal *first* — never uses one outside a
  comment, which is why the noise went unnoticed.
- **`ddd parse` prints two contradictory summary lines**: the AST phase says
  `0 error(s), 0 warning(s).`, then the IR phase prints its own findings and
  `1 error(s).` A reader who stops at the first line concludes the model is clean.
- **Deleting the generated output directory leaves a stale migration baseline.**
  `rm -rf api && ddd generate system main.ddd -o .` fails the destructive gate,
  because the baseline lives in `.loom/snapshots/` while the migrations live in
  `api/db/migrations/`. The advice printed is "re-run with `--allow-destructive`",
  which is the wrong remedy when the real state is "there is no database yet".
  (By contrast the *drift* diagnostic for the same directory pair is the best
  message in the toolchain — see "What worked".)
- **Reserved words that cannot name a field give an unexplained parse error.**
  `command File { … }` → `Expecting token of type 'ID' but found 'File'`;
  `valueobject Berth { slot: int }` → `Expecting '}' but found 'slot'`. Neither
  says "reserved", and `docs/language.md`'s keyword tables do not list `slot`
  among names that cannot be a field.
- **Value-object subforms lose three things the same types get at top level.**
  In `cargos/detail.tsx` the `Leg[]` subform renders `voyage: Voyage id` and
  `loadLocation: Location id` as free-text UUID boxes (the same types get a
  searchable aggregate picker driven by `derived display` at top level), renders
  `loadTime: datetime` as a plain `TextInput` without `type="datetime-local"`,
  and binds no `error=` for validation display.

---

## What worked

Most of the surface, and it is worth recording:

- **Tenancy.** `with tenantOwned` AND-s
  `eq(schema.cargos.tenantId, requireCurrentUser().agencyId)` into every
  generated read, stamps on create, keeps the column out of the create input,
  and derives the index. `loom.unique-missing-tenant-scope` — "`unique
  (trackingId)` … is a GLOBAL unique across all tenants. Did you mean `unique
  (tenantId, trackingId)`?" — caught a real bug in my model.
- **Permissions.** The `implies` closure is precomputed and inlined:
  `includes("logistics.cargoBook") || includes("logistics.agencyAdmin") ||
  includes("logistics.cargoReroute")`.
- **The migration drift diagnostic** is the best message in the toolchain: it
  named the missing file, the snapshot, both recovery paths, and the risk of each.
- **Channel/broker validation**: "binds channel 'CargoLifecycle' (broadcast/log)
  to storage 'bus' of type 'redis', which can't realise it. Compatible: kafka."
- **`loom.reactor-event-uncarried`** told me exactly why a reactor would never
  fire, before I ran anything.
- **Money and domain services.** Closed `money` arithmetic; `Tariff.rate` emitted
  as a namespaced pure function with the right `Decimal` operations.
- **The React scaffold** — 21 pages including workflow instance views, subforms
  for value-object arrays, aggregate pickers, enum selects, i18n keys and test
  ids throughout.
- **The i18n workflow** — `i18n init de` → 175 keys, `status`, `check --strict`
  failing the build.
- **The data-migration surface.** Adopting multi-tenancy on a populated database
  worked exactly as documented: a `migration "adopt-tenancy" { Cargo.tenantId =
  "legacy-agency" }` block turned the blocked NOT NULL add into the safe
  add-nullable → `UPDATE` → `SET NOT NULL` sequence, including for the
  capability-provided `internal` column.

---

## The systemic point

D2, D3 and D4 are each one fixture away from being impossible. The per-PR
`hono-build.yml` corpus carries **no** value object holding an `X id`, **no**
workflow whose state field is an enum, and **no** `managed` field with a declared
default — so three separate emitters can emit non-compiling TypeScript and every
gate stays green. The cheapest durable fix is not three patches but one fixture
that carries all three shapes, plus a ratchet on the ts-build fixture set's
coverage of the type × access-modifier matrix.

---

# Part 2 — the same model on the other nine targets

The audit above compiled one target (node + react). This part retargets the
**identical model** to the other four backends and the other five frontends —
nine variants, all of which parse **0 errors, 0 warnings** and generate cleanly
— and compiles every one the sandbox has a toolchain for.

| target | how it was checked | result |
|---|---|---|
| python backend | `uv venv -p 3.13` + the project's own `pyproject.toml` deps + `mypy` | **7 errors** |
| java backend | `javac` on the offending file (gradle wants a JDK 25 toolchain the sandbox lacks) | **does not compile** |
| vue frontend | `npm install` + `npm run build` (`vue-tsc --noEmit && vite build`) | **build fails** |
| svelte frontend | `npm install` + `npm run build` (`svelte-check` + `vite build`) | **build fails, 6 errors** |
| angular frontend | `npm install` + `tsc -p tsconfig.app.json` | app sources clean; two notes below |
| dotnet / elixir / feliz / flutter | static review against the defect classes (no SDK in the sandbox) | **three of the four carry a provable compile error** |

Five of the nine fail to build. Every failure below is a **different symptom of
a defect the node+react pass either missed or under-measured**, so the
cross-target sweep more than paid for itself.

## T1 — an `X id?` claim in `user { … }` breaks FOUR of five backends

#2862's D6 records this as a node emitter defect (an unimported `Ids.` plus a
doubled `| null`). It is not node-specific — the same `customerId: Customer id?`
claim produces, from the same model:

| backend | emitted | verdict |
|---|---|---|
| node | `customerId: Ids.CustomerId \| null \| null;`, `Ids` never imported | TS2503 |
| python | `cast(CustomerId \| None \| None, …)`, `CustomerId` never imported | `Name "CustomerId" is not defined` (mypy), NameError at import |
| dotnet | `public record User(…, CustomerId?? CustomerId)` | **`CustomerId??` is not valid C#** |
| java | `public record User(…, CustomerId customerId)`, imports only `java.util.List` | **proven with `javac`**: `cannot find symbol: class CustomerId` |
| elixir | untyped map access | fine |

Both halves of the defect (the missing import AND the doubled nullability)
replicate on the two typed backends that spell nullability differently. This
should be scoped as one cross-backend fix, not a node patch.

## T2 — a `command`-typed workflow `create` parameter has no wire type on ANY backend

`create(c: FileClaim)`, where `FileClaim` is a declared `command`, is the
explicit-command form `docs/workflow.md` documents. Every backend emits a
request record referencing `FileClaimResponse` — and **no backend emits it**:

| backend | emitted | verdict |
|---|---|---|
| node | `z.object({ c: z.unknown() })` | compiles, no contract; every `c.<field>` is TS18046 |
| python | `class ClaimHandlingRequest(BaseModel): c: FileClaimResponse` | `Name "FileClaimResponse" is not defined` |
| java | `public record ClaimHandlingRequest(FileClaimResponse c)` | undefined type |
| dotnet | `record ClaimHandlingRequest([Required] FileClaimResponse C)` — **and** `record ClaimHandlingCommand(FileClaim C)`, with the domain `FileClaim` not emitted either | two undefined types |
| elixir | `c: ApiWeb.Api.Schemas.FileClaimResponse` — no `file_claim_response.ex` | undefined module |

This upgrades D7 from "node emits `z.unknown()`" to "the payload record's wire
type is emitted nowhere". It is also why this workflow shape sits outside
#2850's correlation rule — see the note on that PR.

## T3 — the enum-stated workflow (D4) breaks the generated FRONTEND too

D4 above reported an undefined `<Enum>Schema` in the node backend. The same root
cause reaches four frontends, in two shapes:

| frontend | emitted | verdict |
|---|---|---|
| react | `import { ClaimStateSchema } from "./agency";` | nothing exports it (react was never built in part 1 — this is why) |
| vue | same import | **`vue-tsc` TS2305 — build fails** |
| svelte | same import | **`svelte-check` — build fails** |
| angular | `claimState: unknown;` | builds, contract silently degraded |

Note the import target: `./agency` — an unrelated aggregate's module, apparently
the first in the context. So the fix is not only "emit the schema" but "resolve
which module owns an enum used by a workflow".

## T4 — a nullable `X id?` reference emits an unguarded link on ALL SIX frontends

`lastKnownLocation: Location id?` renders as a link built by string
concatenation, with no null check, everywhere:

| frontend | emitted | verdict |
|---|---|---|
| vue | `:title="row.lastKnownLocation"` | **TS2345 — build fails** (RouterLink's `title` rejects `null`) |
| feliz | `("/locations/" + cargoById.lastKnownLocation)` where the field is `string option` | **F# type error — `string` + `string option`** |
| react | `` to={`/locations/${row.lastKnownLocation}`} `` | compiles → `/locations/null` |
| svelte | `` href={`/locations/${row.lastKnownLocation}`} `` | compiles → `/locations/null` |
| angular | `[routerLink]='"/locations/" + …lastKnownLocation'` | compiles → `/locations/null` |
| flutter | `'/locations/' + row.lastKnownLocation.toString()` | compiles → `/locations/null`, label reads `"null"` |

Flutter is the tell: the same generated page **does** guard `datetime` and
`money` with `((DateTime? v) => v == null ? '—' : …)`. The null-guard helper
exists and is applied to scalars; the reference-link path just never got it.

An optional reference is completely ordinary domain modelling ("we don't know
where the cargo is yet"), so this is on the happy path of any real model.

## T5 — Svelte: two operations touching the same aggregate collide

Svelte hoists every operation form into ONE page-level `<script>`, and each
operation declares its own picker query:

```svelte
const __voyages = useAllVoyages();      // for assignToRoute
const __locations = useAllLocations();
…
const __locations = useAllLocations();  // for registerHandling — redeclared
const __voyages = useAllVoyages();
```
```
[PARSE_ERROR] Identifier `__locations` has already been declared
```

Trigger: **two operations on one aggregate that each take a parameter
referencing the same other aggregate.** Here `assignToRoute` (legs carry
`Voyage id` + `Location id`) and `registerHandling` (`at: Location id`,
`voyage: Voyage id?`). React and Vue scope each form to its own component and
are unaffected. Any aggregate with two such operations is un-buildable on
Svelte.

## T6 — Python: the channel tee's own annotation rejects what the factory passes

```python
def __init__(self, inner: NoopDomainEventDispatcher) -> None: ...
…
return ChannelTeeDispatcher(RealtimeDispatcher(NoopDomainEventDispatcher()))
```
`Argument 1 to "ChannelTeeDispatcher" has incompatible type "RealtimeDispatcher";
expected "NoopDomainEventDispatcher"`. Runtime duck-types fine, so this is a
types-only defect — but it means a channels-using Python backend can never pass
a strict type check. The parameter wants the dispatcher protocol, not the noop
implementation.

## T7 — two Angular notes

- The generated root `tsconfig.json` includes `e2e/**`, and **no** frontend
  declares `@playwright/test` in its `package.json`. On react/vue/svelte the
  build script uses a narrower config so nothing notices; on Angular a plain
  `npx tsc -p tsconfig.json` (or opening the project in an editor) reports 20+
  errors before any app code is reached. Either declare the dev dependency or
  exclude `e2e` from the root config.
- `ng build` refuses to run on Node 22.22.2 (the Angular CLI floor is 22.22.3).
  The generated Dockerfile uses `node:24-alpine`, so compose is unaffected — but
  a contributor on the same Node the toolchain repo uses cannot build the
  Angular output locally.

## What this part changes about the plan

Three of part 1's findings were **under-scoped by measuring one target**:

- D4 is a backend **and** four-frontend defect (T3).
- D7 is a five-backend defect, not a node `z.unknown()` (T2).
- #2862's D6 is a four-backend defect, not a node emitter detail (T1).

And two whole defect classes exist only off the node+react path: the unguarded
nullable reference (T4, six frontends, two of them un-buildable) and the Svelte
picker collision (T5).

The systemic conclusion from part 1 holds and gets sharper: the per-PR gates
compile a corpus that does not contain these shapes. But the second half of the
lesson is new — **compiling one target is not evidence about the others**, and
four of the five failures here are in targets a node-only pass cannot see.

# Loom evaluation — findings

Severity: **S1** data loss / broken isolation / doesn't compile or boot on a path
we need / silently wrong · **S2** blocked or expensively worked around, or a
headline claim materially untrue on a path we need · **S3** repeated friction ·
**S4** polish or a documented limitation.

Class: **SILENT** (valid input, exit 0, output wrong/stubbed/uncompilable) ·
**HONEST** (refused with a clear diagnostic) · **DOCUMENTED** (named up front).

---

## F-001 · S4 · HONEST · `ddd` is never put on `PATH`

**Claim under test.** README, *Install* and *CLI*: "`npm install` / `npm run
build`" then "`ddd parse <file.ddd>`".

1. `npm install && npm run build`
2. `which ddd` → not found (exit 1)

`package.json` declares `"bin": {"ddd": "./bin/cli.js"}` but no README step links
it. Every documented command has to be mentally rewritten to `node bin/cli.js …`.
**Workaround:** `npm link`, or prefix. **Adoption impact:** none beyond first
confusion. **Time lost:** 2 min.

---

## F-002 · S3 · DOCUMENTED(-ish) · 11 advisories (4 high) in the toolchain's deps

1. `npm install` → `11 vulnerabilities (1 low, 6 moderate, 4 high)`
2. `npm audit` → high in `fast-uri`, `ip-address`, `nanoid`, `postcss`;
   moderate in `hono` (7 advisories, incl. *"`memo()` retains SSR output across
   requests, leading to cross-user data disclosure"*) and `qs`.

These are the **toolchain's own** dependencies, not the generated app's — but
`hono` is also the framework the default backend generates onto, so a reviewer
will ask whether the emitted `package.json` pins a fixed version. Checked in
Phase 4. **Adoption impact:** a procurement/security-review speed bump, not a
blocker. **Time lost:** 5 min.

---

## F-003 · S3 · DOCUMENTED · first `docker compose up` hangs silently behind a TLS proxy

**Claim under test.** `ddd new`'s own next-step line: "`ddd generate system
main.ddd -o . && docker compose up`".

1. `node bin/cli.js new phase0 --out ./phase0`
2. `node bin/cli.js generate system main.ddd -o .`
3. `docker compose up -d --build`

**Observed:** both `RUN npm install` layers hang with no output; killed at 15 min.
**Expected:** either success, or a failure that says what is wrong.
Root cause is the sandbox's TLS-terminating egress proxy, reproducible as
`docker run --rm node:24-alpine wget -qO- https://registry.npmjs.org/hono` →
`certificate verify failed`. **Not Loom's bug** — and Loom anticipated it: the
generated `api/Dockerfile` already has `COPY certs/ …` with a comment, and
`docs/tools.md` §"Proxy CAs (sandboxed builds)" documents it.
**Workaround:** `cp <ca>.crt api/certs/proxy.crt` (per deployable); rebuild →
58s, healthy. **Adoption impact:** any corporate network with TLS inspection —
i.e. most of them — hits this on day one; the mechanism exists but the failure
path doesn't point at it. **Time lost:** 17 min.

---

## F-004 · S2 · HONEST (misleading message) · a workflow `for` body cannot load another aggregate

**Claim under test.** `docs/workflow.md`: "A `workflow` is a context-level
orchestration that loads or creates multiple aggregates, invokes their
operations". `docs/workflow.md` body vocabulary lists both `for x in xs { … }`
and `let x = Repo.getById(idExpr)`.

Repro: `eval/repro/F-004-workflow-loop-load.ddd`

1. `node bin/cli.js parse eval/repro/F-004-workflow-loop-load.ddd`

**Observed:**
```
loom.workflow-foreach-unknown-binding C/consumeAll: workflow 'consumeAll':
  in 'for u', 'p.consume(...)' references unknown binding 'p'.
1 error(s), 0 warning(s).
```
The same file's workflow `markAll` — a `for` body that only calls an operation on
the loop variable — passes. So the rule is: **a `for` body may not contain a `let`
that loads an aggregate.**

**Expected:** either it works, or a diagnostic that says *that*. The message
claims `p` is an unknown binding when `p` is bound by the `let` on the line
above; a reader will hunt for a typo, not conclude the language can't say this.

**What this costs.** The canonical transactional pattern — *"on completion,
decrement stock for each part used; insufficient stock fails the whole
operation"* — has **no expression in the DSL**. I tried two shapes:
(a) iterating the work order's contained line items
(`loom.workflow-foreach-source`: "must iterate a `let xs = Repo.run(...)` result
(the only aggregate array in v1)"), and (b) lifting part usage into its own
aggregate + criterion + retrieval so the loop *does* iterate a `Repo.run(...)`
result — same rejection, because the load inside the loop is the problem, not the
loop source.

**Workaround:** degrade to one part per call (what `eval/fieldops/s5.ddd` does),
push the loop into a hand-written `extern` handler, or hand-write the whole
transaction outside the model. All three put a core business rule outside the
single source of truth. **Adoption impact:** high — order fulfilment, inventory,
ledger posting, and batch state transitions are all this shape. This is a
*structural* ceiling, not a bug someone fixes next week: the workflow body
grammar has one aggregate-array binding form and no nested-load form.
**Time lost:** 25 min.

---

## F-005 · S2 · HONEST · the typed `permissions` catalogue is not usable in a row-level read filter

**Claim under test.** `docs/auth.md`: the `permissions { … }` catalogue with an
`implies` closure, used from "operation / workflow expression bodies"; and
`docs/auth.md` §"Find `requires` gates" — "the read-side analogue of an operation
gate". Coverage-checklist item: *row-level rules (a technician sees only their own
orders)*.

Repro: `eval/repro/F-005-rowlevel-or-permission.ddd`

1. `node bin/cli.js parse eval/repro/F-005-rowlevel-or-permission.ddd`

**Observed** — three variants of the same rule in one file:

| variant | filter | result |
|---|---|---|
| (a) | `ownerUserId == currentUser.id` | **accepted** |
| (b) | `currentUser.permissions.contains(permissions.readAll) \|\| ownerUserId == currentUser.id` | **rejected** — `loom.find-where-not-queryable … (non-queryable intrinsic '.contains')` |
| (c) | `currentUser.role == "admin" \|\| ownerUserId == currentUser.id` | **accepted** |

So the exact shape every real app needs — *"admins see all rows, technicians see
only their own"* — cannot be written with the typed permission catalogue that
exists for authorization. It **can** be written by comparing a raw claim string.

**Workaround:** (c) — revert to stringly-typed role checks in read filters, and
keep `permissions.*` for `requires` gates only. That is what `eval/fieldops/s5.ddd`
does, with a comment. The cost is that the `implies` closure (`admin implies
[readAll, …]`) silently does not apply to read filters, so the permission model
is split across two vocabularies with different semantics.
**Adoption impact:** medium-high. The diagnostic is accurate and names the
blocking node, which is why this is HONEST rather than S1 — but a team will
discover it after modelling their whole permission catalogue.
**Time lost:** 20 min.

---

## F-006 · S1 · **SILENT** · a projection aggregating a `derived` field generates code that does not compile

**Claim under test.** README: *"No drift between layers"*; `docs/language.md`:
"~50 `loom.projection-*` gates"; `docs/scaffold-macros.md`: a dashboard projection
"can only name real columns (`loom.projection-columnless-source`)"; and the CLI's
own contract — "All `generate` sub-commands run validation first and refuse to
emit if there are errors."

Repro: `eval/repro/F-006-projection-derived-source.ddd` (24 lines)

1. `node bin/cli.js parse eval/repro/F-006-projection-derived-source.ddd`
   → `0 error(s), 0 warning(s). OK:`
2. `node bin/cli.js generate system eval/repro/F-006-projection-derived-source.ddd -o /tmp/pd`
   → `0 error(s), 0 warning(s). Wrote 44 file(s)`
3. `cd /tmp/pd/api && npm install && npx tsc --noEmit`

**Observed:**
```
http/query-projections.ts(37,86): error TS2339: Property 'total' does not exist
  on type 'PgTableWithColumns<{ name: "orders"; schema: "c"; columns: { id … qty … unitPrice … version }}>'
```
The emitted query is
`db.select({ rowCount: count(), totalSum: sum(schema.orders.total) })`, but
`derived total: money = unitPrice * qty` is computed in the domain layer and has
no column — confirmed in the generated DDL:
```
CREATE TABLE "c"."orders" ("id" UUID, "qty" INTEGER, "unit_price" DECIMAL(19,4), "version" INTEGER, PRIMARY KEY ("id"));
```

**Expected:** `loom.projection-*` rejects `sum(<derived>)` at validation, the way
it rejects a columnless source.

**Why this is the dangerous class.** The input is valid, both Loom commands exit
0, 44 files are written, and the *only* thing that catches it is the downstream
TypeScript compiler — which in a `docker compose up` flow you meet after a
multi-minute image build, with an error that names a generated file you did not
write. Nothing in the Loom diagnostic stream mentions it. On a backend whose
build is less strict, or via a code path the compiler can't see (a raw SQL
string), the same class of defect reaches runtime.

**Blast radius.** This is a *natural* thing to write — summing an order total, a
work-order value, a claim reserve. `docs/scaffold-macros.md` describes
`scaffoldDashboard` as emitting "a row count plus a sum per numeric/money field",
which is exactly this query over hand-written projections.
**Workaround:** store the aggregate as a real (stamped) column instead of a
`derived`, i.e. denormalise for the reporting layer's benefit.
**Adoption impact:** high — it breaks the "validated before emission" promise,
which is the core of the "LLM-safe" claim. **Time lost:** 20 min.

---

## F-007 · S1 · SILENT (validator) + crash (generator) · a read filter mentioning any `currentUser` claim other than `.id` passes validation and crashes codegen

**Claim under test.** README: *"validated before emission"*, *"Validation gates
catch hallucinated fields and out-of-scope references before any code is
emitted"*. `docs/tools.md` / README: "All `generate` sub-commands run validation
first and refuse to emit if there are errors."

Repro: `eval/repro/F-007-criterion-currentuser-or.ddd` (22 lines)

1. `node bin/cli.js parse eval/repro/F-007-criterion-currentuser-or.ddd`
   → `0 error(s), 0 warning(s). OK:`
2. `node bin/cli.js generate system eval/repro/F-007-criterion-currentuser-or.ddd -o /tmp/f7`

**Observed:**
```
0 error(s), 0 warning(s).
QueryEmissionRefusal: drizzle-predicate: where-clause for find 'all' on 'Doc' is
  outside the declared query-emission vocabulary — the IR validator should have
  rejected this filter before codegen reached it.
    at refuseOutOfVocabulary (out/generator/_expr/target.js:359:11)
    …9 more frames…
exit code 1, nothing written
```
The generator's own message states the invariant that was broken.

**Bisection** (same file, one substitution each, parse then generate):

| criterion body | `parse` | `generate` |
|---|---|---|
| `ownerUserId == currentUser.id` | clean | **OK** |
| `currentUser.role != "technician"` | clean | **crash** |
| `currentUser.role == "admin" \|\| ownerUserId == currentUser.id` | clean | **crash** |
| `currentUser.role != "technician" && ownerUserId == currentUser.id` | clean | **crash** |
| `true \|\| ownerUserId == currentUser.id` | clean | **crash** |
| `ownerUserId != ""` | clean | **OK** |

So the queryable vocabulary in practice is narrower than the diagnostic in F-005
advertises ("Allowed: comparisons, &&/||/!, parens, `this.<column>` refs,
parameter refs, **literals**") — a bare `true` literal and any `currentUser`
claim other than `.id` are both outside it, and nothing says so until codegen.

**Mitigating:** it is fail-closed — exit 1, no files written, no wrong code
emitted. **Aggravating:** it is a 10-frame internal stack trace, with no source
line, in a tool whose entire value proposition is that the model is validated
before emission.

**Combined with F-005 this is the real result:** the requirement *"a technician
sees only their own work orders, an admin sees all"* — an explicit item on the
coverage checklist and in the FieldOps brief — **has no expression in the DSL.**
One spelling is honestly refused, every other spelling crashes the compiler, and
only the unconditional owner filter survives. `eval/fieldops/fieldops.ddd` ships
the degraded rule with the loss commented in place.
**Workaround:** none that keeps the requirement. Filter by owner only and
implement the admin override outside the model (a second service, a direct DB
read, or hand-edited generated code — see F-02x on what regeneration does to
that). **Adoption impact:** high. **Time lost:** 35 min.

---

## F-008 · S1 · **SILENT** · `currentUser.permissions` type-checks against a `user {}` shape that has no `permissions` field — the emitted auth gate does not compile

**Claim under test.** `docs/auth.md`: the `permissions { … }` catalogue, `requires`
gates and `mask unless` field redaction; README *"no drift between layers"*;
`docs/language.md`: "The `currentUser` magic identifier … **is typed against this
shape**" (the `user { … }` block).

Repro: `eval/repro/F-008-currentuser-permissions-undeclared.ddd` (22 lines)

1. `node bin/cli.js parse …` → `0 error(s), 0 warning(s). OK:`
2. `node bin/cli.js generate system … -o /tmp/chk` → `Wrote 49 file(s)`
3. `cd /tmp/chk/api && npm install && npx tsc --noEmit`

**Observed:**
```
db/repositories/person-repository.ts(101,48): error TS2339: Property 'permissions' does not exist on type 'UserClaims'.
http/person.routes.ts(86,25):             error TS2339: Property 'permissions' does not exist on type 'UserClaims'.
```
The generated `auth/user-types.ts` contains exactly the fields I declared —
`id`, `role` — and the generated mask is
`if (!(currentUser !== null && (currentUser.permissions.includes("s.unmask")))) wire.salary = null;`

**Expected.** `currentUser` is documented as *typed against the `user {}` shape*.
A reference to a member that shape does not declare should be the same error as
any other unknown member — the docs promise precisely this ("Validation gates
catch hallucinated fields").

**Why this one matters most.** The two constructs that failed are the **field
read-mask** and the **`requires` authorization gate** — i.e. the security layer.
On the node backend TypeScript stops it. The open question is what the four
looser backends do with the same input; tested in Phase 3 (see F-01x). A gate
that compiles into a dynamically-typed host and evaluates `permissions` as a
missing attribute is either a 500 or, if the host coerces, a silently wrong
authorization decision.

**Workaround:** declare `permissions: string[]` on `user {}` yourself. Nothing
tells you to; `ddd new`'s own scaffold comment happens to show a `user {}` block
*with* `permissions: string[]`, which is the only hint in the product.
**Adoption impact:** high — and the class is what worries me more than the
instance: `currentUser` is not actually type-checked against the declared shape.
**Time lost:** 20 min.

---

## F-009 · S1 · **SILENT** · `!=` in a projection `where` emits `ne(...)` without importing it

Repro: `eval/repro/F-009-ne-import-missing.ddd` (21 lines)

1. `node bin/cli.js parse …` → `0 error(s), 0 warning(s).`
2. `node bin/cli.js generate system … -o /tmp/chk` → `Wrote 43 file(s)`
3. `cd /tmp/chk/api && npm install && npx tsc --noEmit`

**Observed:**
```
db/repositories/ticket-repository.ts(95,72): error TS2304: Cannot find name 'ne'.
```
Generated line 95: `…where(ne(schema.tickets.status, "Closed"))`
Generated line 5:  `import { and, desc, eq, inArray } from "drizzle-orm";`

The import set is computed per file and simply omits the `!=` operator's symbol.
**Expected:** `ne` in the import list. **Workaround:** hand-edit the import (and
lose it on the next regenerate), or rewrite every `!=` filter as a positive
comparison — not always possible over an enum with >2 values.
**Adoption impact:** medium — trivially fixable upstream, but it is a
*one-token* codegen defect that the entire 9,000-test suite did not catch on the
default backend, which is a statement about where the test coverage is aimed.
**Time lost:** 10 min.

---

## F-010 · S1 · **SILENT** · an optional field on a contained entity part is emitted as a required constructor argument

**Claim under test.** `docs/language.md`: `contains name: PartName?` / `X id?` —
optional fields; the part-construction form `PartName { field: expr, … }`.

Repro: `eval/repro/F-010-optional-part-field.ddd` (24 lines)

1. `node bin/cli.js parse …` → `0 error(s), 0 warning(s).`
2. generate → `Wrote 45 file(s)`; 3. `npx tsc --noEmit`

**Observed:**
```
domain/note.ts(64,39): error TS2345:
  Argument of type '{ id; parentId; text: string }' is not assignable to
  parameter of type '{ id; parentId; text: string; tag: TagId | null }'.
  Property 'tag' is missing … but required
```
The `.ddd` writes `lines += NoteLine { text: text }`, omitting `tag: Tag id?`.
The DSL accepts the omission (it is optional); the emitted constructor type makes
it required-but-nullable, so there is **no way to write the construction that
compiles** other than passing `tag: null` — which the DSL has no spelling for on
an id-typed field that I found.
**Workaround:** make the field non-optional and carry a sentinel, or lift the
part into its own aggregate. **Adoption impact:** medium-high — optional fields
on line items are everywhere. **Time lost:** 15 min.

---

## F-011 · S1 · **SILENT** · a projection aggregating a value-object sub-field emits a non-existent column

Repro: `eval/repro/F-011-projection-vo-subfield.ddd` (23 lines)

1. `parse` → clean; 2. generate → `Wrote 44 file(s)`; 3. `npx tsc --noEmit`

**Observed:**
```
http/query-projections.ts(37,75): error TS2339: Property 'amount' does not exist on
  type 'PgTableWithColumns<{ name: "bills"; … columns: { id …; amount_amount: PgColumn<…>; …
```
`sum(b.amount.amount)` over `amount: Money` emits `schema.bills.amount`; the VO
is flattened to `amount_amount` / `amount_currency` — the error message itself
shows the correct column name one line later.
Sibling of F-006 (derived field). Together: **a query-time projection's `select`
resolves names against the domain model, not the emitted table**, and no gate
reconciles the two. Summing money on a dashboard is the single most common
projection there is.
**Workaround:** add a flattened scalar mirror column to the aggregate.
**Adoption impact:** high. **Time lost:** 10 min (after F-006 taught me the shape).

---

## F-012 · S2 · **SILENT** · summary: `generate system` emitted 214 files / 18,991 LOC with 7 type errors, after reporting "0 error(s), 0 warning(s)"

The five findings above are not five independent papercuts — they are what one
honest 354-line domain model produced **on the vendor's default and
best-supported backend**, in a single first compile:

```
$ node bin/cli.js parse fieldops.ddd
0 error(s), 0 warning(s).
OK: fieldops.ddd
$ node bin/cli.js generate system fieldops.ddd -o out
0 error(s), 0 warning(s).
Wrote 214 file(s) in out
$ cd out/api && npm install && npx tsc --noEmit
db/repositories/technician-repository.ts(103,48): error TS2339: Property 'permissions' does not exist on type 'User'.
db/repositories/workOrder-repository.ts(143,79): error TS2304: Cannot find name 'ne'.
domain/workOrder.ts(112,44): error TS2345: … Property 'part' is missing …
http/invoice.routes.ts(236,27): error TS2339: Property 'permissions' does not exist on type 'User'.
http/query-projections.ts(89,99): error TS2339: Property 'amount' does not exist on type … invoices …
http/workOrder.routes.ts(151,25): error TS2339: Property 'permissions' does not exist on type 'User'.
http/workflows.ts(164,27): error TS2339: Property 'permissions' does not exist on type 'User'.
```

**This is the single most important measurement in the evaluation.** The claim
being tested is not "does Loom have bugs" — every tool does — it is the
architectural claim that *the model is validated before emission, so the layers
cannot drift*. On a first honest model, the validator passed code the type
checker rejected in five distinct ways, **four of which the validator is
structurally positioned to catch** (a member that isn't on the declared `user`
shape; a projection selecting a name that is not a column; an omitted optional
field; a missing import is the one that is purely an emitter bug).

**Adoption impact:** this is the finding the recommendation turns on. See the
report's verdict section.

---

## F-013 · S1 · **SILENT** · the generated `docker-compose.yml` pins an image that no longer exists — any model with an object store cannot boot

**Claim under test.** README: "`ddd generate system acme.ddd -o ./out` → runnable
multi-project tree + `docker-compose.yml` + healthchecks … `docker compose up -d`
→ everything running". `docs/resources.md`: "Dev `docker-compose` gains a sidecar
per object-store / queue / smtp-mailer storage (MinIO for `s3`, …)".

1. Model declares `storage photoBlob { type: s3, config: { bucket: …, region: … } }`
   + `resource photos { for: Ops, kind: objectStore, use: photoBlob }`
   — i.e. the FieldOps requirement "an object store for photos".
2. `node bin/cli.js generate system fieldops.ddd -o out` → `0 error(s), 0 warning(s). Wrote 214 file(s)`
3. `docker compose up -d --build`

**Observed:**
```
Image minio/minio:latest Error pull access denied for minio/minio,
  repository does not exist or may require 'docker login'
Error response from daemon: pull access denied for minio/minio …
EXIT=1
```
Not a rate limit and not the proxy — three retries, and the control cases pass:
```
curl https://hub.docker.com/v2/repositories/minio/minio/tags  → {"message":"object not found"}
docker pull axllent/mailpit:latest        → OK   (another Docker Hub image)
docker pull quay.io/minio/minio:latest    → OK   (MinIO's current home)
```
MinIO has left Docker Hub; the emitted compose still points there.

**Also:** two of the five emitted sidecars are pinned to a **floating `:latest`**
tag (`minio/minio:latest`, `axllent/mailpit:latest`) while the other three are
pinned (`postgres:18-alpine`, `quay.io/keycloak/keycloak:26.0`,
`valkey/valkey:8-alpine`). Floating tags in generated infrastructure mean the
stack you boot today is not the stack you boot in six months — and this finding
is what that costs.

**Workaround:** `sed -i 's|minio/minio|quay.io/minio/minio|' docker-compose.yml`
after every regenerate (the file is fully regenerated — see F-02x).
**Adoption impact:** medium as a bug (one string), high as a signal: the compose
file is a generated artifact you cannot durably edit, pinned to a moving
external target, and nothing in Loom's own gate noticed the target moved.
**Time lost:** 15 min.

---

## F-014 · S1 · **SILENT** · the page emitter writes `/* unresolved: X */ undefined` into the generated source and reports success

**Claim under test.** README: *"Validation gates catch hallucinated fields and
out-of-scope references **before any code is emitted**"*; *"No drift between
layers"*. `docs/scaffold-macros.md`: *"**A hand-written `<Agg>Totals` wins** — the
macro skips a name the context already declares, and the ui side binds whatever
fields that projection declares."*

Repro: `eval/repro/F-014-unresolved-undefined.ddd` (26 lines)

1. `node bin/cli.js parse …` → `0 error(s), 0 warning(s). OK:`
2. `node bin/cli.js generate system … -o /tmp/f14` → `0 error(s), 0 warning(s). Wrote 78 file(s)`
3. `grep -rn 'unresolved:' /tmp/f14`

**Observed** — `web/src/pages/home.tsx`, six occurrences:
```tsx
{ /* unresolved: JobTotals */ undefined.isLoading && ( … ) }
{ /* unresolved: JobTotals */ undefined.isError && ( … ) }
{ /* unresolved: JobTotals */ undefined.data && /* unresolved: JobTotals */ undefined.data.length === 0 && …
<Text fw={700} size="xl">{/* unresolved: JobTotals */ undefined.data.rowCount}</Text>
```
**The emitter knew it could not resolve the name — it wrote "unresolved" in a
comment — and emitted `undefined` anyway, then told me there were no errors.**
The frontend build fails with `TS18050: The value 'undefined' cannot be used here`
×8 in my FieldOps model.

**It is exactly the documented override that breaks it.** Same file with the
hand-written `JobTotals` projection deleted (so `scaffoldDashboard` emits its own):
```
macro-only dashboard unresolved markers: 0     ← works
hand-written <Agg>Totals:                 6    ← the documented "wins" path
```
And none of the vendor's own examples trigger it:
```
for e in examples/*.ddd; do generate; grep -c 'unresolved:'; done   → no hits
examples/acme.ddd (286 files)                                      → 0
```
Which is precisely why their CI has never seen it.

**Classification (symptom reproduced first, then `src/` read to classify).**
This is not an accident, it is the page-body emitter's designed fallback:
`src/generator/_walker/walker-core.ts:1748`
```ts
return `/* unresolved: ${expr.name} */ undefined`;
```
one site, reached by every unresolved identifier in any page body, on every
frontend. The maintainers know what it costs — their own comments say so:
`src/ir/util/projection-read.ts:13` "`/* unresolved: Sales */ undefined.<Projection>`
— a runtime TypeError"; `src/generator/feliz/index.ts:585` "…into F# source that
cannot compile"; `src/generator/_frontend/projections-module.ts:9` same. There are
**three separate IR validator checks** (`ui-action-body-checks.ts:555`,
`ui-page-structure-checks.ts:575`, `projection-read.ts`) written specifically to
catch cases before they reach this fallback.

**So the architecture is: the page emitter fails open by default, and the
validator plays whack-a-mole in front of it.** That is the inverse of the
headline claim. Every hole they haven't found yet is a silent one, and the cases
they *have* found are the ones their own examples exercise.

**Workaround:** don't hand-write a projection the scaffold also derives; or grep
the output for `unresolved:` after every generate (I now do this, and recommend
any adopter wire it into CI as a build gate — see the top-10 fixes).
**Adoption impact:** this is the second-most-important finding after F-012, and
it is *structural*, not a bug. **Time lost:** 30 min.

---

## F-015 · S1 · **SILENT** · putting the documented authorization gate on a list read breaks every generated page that lists that aggregate

**Claim under test.** `docs/auth.md`: *"The auto-injected `find all` list route is
the one exception: it is compiler-synthesized with no author source line, so it
is out of default-deny scope. **Declaring an explicit `find all(): T[] requires
<expr>` gates that route**, and does so on all five backends."*

Repro: `eval/repro/F-015-declared-findall-breaks-ui.ddd` (25 lines)

1. `parse` → `0 error(s), 0 warning(s).`
2. `generate system` → `Wrote 87 file(s)`
3. Compare the emitted API client against an aggregate *without* a declared `all`:

```ts
// with `find all(): Doc[] requires true`   → web/src/api/doc.ts
export const DocListResponse = z.array(DocResponse);          // BARE ARRAY
// without it (auto-findAll)                → web/src/api/asset.ts
export const AssetPaged = z.object({ items: z.array(AssetResponse), page, pageSize, total, totalPages });
```
4. But the page emitter is unconditional — `web/src/pages/workflows/touch.tsx:48`:
```tsx
data={(__docs.data?.items ?? []).map((__o) => ({ value: __o.id, label: __o.display }))}
```

**Observed** in FieldOps: `Property 'items' does not exist on type '{ id: string;
asset: string; … }'` ×3, plus `Parameter '__o' implicitly has an 'any' type` ×3 —
the generated frontend does not build.

**The runtime shape of this bug is worse than the compile error.** `(x.data?.items ?? [])`
evaluates to `[]` without throwing. TypeScript catches it here only because the
zod schema is typed. Anywhere that inference is weaker — a different frontend
target, a looser tsconfig, a `JSON.parse` boundary — **the picker silently
renders zero options and nothing anywhere reports a problem.** A dispatcher opens
"schedule work order", the technician dropdown is empty, and there is no error in
any log.

**So the documented way to secure a list read is mutually exclusive with the
generated UI.** You can have the `requires` gate on `GET /docs`, or you can have
a working frontend, not both.
**Workaround:** drop the gate and leave the list read ungated (what
`eval/fieldops/fieldops.ddd` does — the `find all` there carries `requires true`,
which is the "intentionally public" escape, and the UI still breaks because the
*shape* changed, not the gate). Or hand-edit every generated page.
**Adoption impact:** high — it is a direct conflict between two shipped features,
on the security axis, discovered only by compiling.
**Time lost:** 25 min.

---

## F-016 · S2 · HONEST-but-empty · the generated Keycloak realm provisions none of the claims the model declares

**Claim under test.** README: OIDC "batteries included"; `docs/auth.md`: "Generates
the token verifier + `/auth/*` handshake (PKCE, refresh rotation)". The generated
compose ships a Keycloak with `--import-realm` and a `keycloak/realm.json`.

1. `docker compose up -d` → keycloak healthy, realm `field_ops` imported
2. Inspect `out/keycloak/realm.json`:
```
realm: field_ops
clients: field_ops-app(public)
users: demo pw=demo attrs={} roles=["user","agent"]
protocolMappers: []          ← none
```
3. Mint a token for the shipped user and decode it:
```json
{"iss":"…/realms/field_ops","sub":"9f8d…","preferred_username":"demo",
 "realm_access":{"roles":["agent","user"]}}
```

**Observed.** The system declares `user { id, email, role, tenantId, permissions }`
and `tenancy by user.tenantId of Organization`. The shipped realm emits **no
mapper for any of them**. The generated verifier (`auth/oidc.ts`) reads them with
unchecked casts —
```ts
tenantId: claim(payload, "tenantId") as string,
permissions: claim(payload, "permissions") as string[],
```
— so the only principal the product ships with has `tenantId === undefined` and
`permissions === undefined`.

**What that costs out of the box:** every read returns empty (correct,
fail-closed) and **every write returns HTTP 500** — see F-018. So the shipped
end-to-end auth demo is: log in successfully, then have the entire application
fail, with a generic `"detail":"internal"`.

**Workaround.** Hand-configure Keycloak: enable unmanaged user attributes
(Keycloak 26 disables them by default), add three `oidc-usermodel-attribute-mapper`
protocol mappers, create users with attributes, clear required actions, reset
passwords. I did this via the admin API — **25 minutes**, and it is per-realm
work you redo on every fresh environment because `realm.json` is regenerated.
**Adoption impact:** medium. The generator plainly *knows* the claim names — it
emits `claim(payload, "tenantId")` — so emitting the matching mappers is
mechanical. Until it does, "OIDC works out of the box" is Partial at best.
**Time lost:** 25 min.

---

## F-017 · S1 · **SILENT** · a non-nullable `managed` field with no default and no stamp makes the aggregate impossible to create (500 on every POST)

Repro: `eval/repro/F-017-managed-money-null.ddd` (17 lines)

1. `parse` → `0 error(s), 0 warning(s).`   2. `generate system` → `Wrote 43 file(s)`
3. In FieldOps, live: `POST /api/work_orders` →
```
{"title":"Internal Server Error","status":500,"detail":"internal"}
api log: {"event":"internal_error","error":"Cannot read properties of null (reading 'toString')"}
```

**Mechanism, from the emitted code:**
```sql
-- db/migrations/*.sql
"total" DECIMAL(19, 4) NOT NULL,
```
```ts
// db/repositories/thing-repository.ts:61
await tx.insert(schema.things).values({ …, total: aggregate.total.toString(), … });
```
`managed` removes the field from the create input (correct), nothing stamps it,
it has no default — so it is `null` at save, `NOT NULL` in the DDL, and the
serializer dereferences it. **There is no input for which this aggregate can be
created.**

**Expected.** A validator gate: a `managed`/non-nullable field with neither a
`= default` nor a `stamp` that writes it is unconstructible by inspection.
**Workaround.** Add `= money("0.00")` (verified: the default then lands in the
`_create` factory). **Adoption impact:** medium — you find it on the first POST,
but the error is opaque and the cause (`managed` + no default) is four files away.
**Time lost:** 20 min.

---

## F-018 · S3 · HONEST-ish · a principal whose tenancy claim is missing gets an opaque 500 on write, not a 4xx

1. Mint a token for the shipped `demo` user (no `tenantId` claim — see F-016)
2. `GET /api/customers` → `{"items":[],"total":0}` — **correct, fail-closed**
3. `POST /api/customers {"name":"ORPHAN",…}` → **HTTP 500** `{"detail":"internal"}`
```
api log: Failed query: insert into "ops"."customers" (…, "tenant_id", …)
         values ($1,$2,$3,default,$4,$5)   params: …,ORPHAN,o@o.test,,1
```
`tenant_id` binds to `default` on a NOT NULL column.

Fail-closed, which is the right direction — but `docs/tenancy.md` promises the
malformed/missing-claim path is "an ordinary empty read on every backend … never
a 500", and says nothing about the write path. A 500 with `"detail":"internal"`
is unactionable at 3am; a 401/403 naming the missing claim would be one line.
**Adoption impact:** low as a bug, medium as an operability signal.
**Time lost:** 5 min.

---

## F-019 · S1 · **SILENT** · every cross-deployable broker event carrying a `datetime` is dropped

**Claim under test.** README: five backends, per-deployable runtime; `docs/channels.md`:
"An `Order.place()` on `salesApi` publishes the event to the broker; **`shipApi`'s
consumer loop receives it and spawns the correlated `Fulfil` instance +
`Shipment` in its own database**." And the *README's own quick example* declares
`event OrderConfirmed { order: Order id, at: datetime }` — the exact shape that
fails.

Repro model: `eval/repro/F-019-broker-datetime-drop.ddd`. Runtime evidence is from
the live FieldOps stack (`api` + `notifier` + valkey, all healthy):

1. Drive a work order Draft → Scheduled → InProgress → Completed. `complete` →
   **HTTP 204**. The aggregate's `emit WorkOrderCompleted { workOrder: id, asset: asset, at: now() }` fires.
2. Subscribe to the broker address directly and watch:
```
$ valkey-cli SUBSCRIBE loom.Ops.WorkOrderLifecycle
message loom.Ops.WorkOrderLifecycle
{"specversion":"1.0","id":"mu0aa8qv-1-3","type":"Ops.WorkOrderCompleted",
 "source":"/loom/Ops","time":"2026-09-13T20:45:54.247Z","datacontenttype":"application/json",
 "loomchannel":"loom.Ops.WorkOrderLifecycle",
 "data":{"workOrder":"01a09c84-…","asset":"01a09c81-…","at":"2026-09-13T20:45:54.243Z"}}
```
   **Publishing is perfect** — a valid CloudEvents 1.0 envelope. `api` logs `channel_published`.
3. Consumer side:
```
$ docker compose exec db psql -d notifier -c 'select count(*) from notify.notifications;'
 0
$ docker compose logs notifier | grep -c channel_consumed
 0
$ docker compose logs notifier | grep warn
 {"level":"warn","event":"channel_consume_failed","address":"loom.Ops.WorkOrderLifecycle",
  "type":"Ops.WorkOrderCompleted","error":"value.toISOString is not a function"}   ×3
```

**Mechanism** — `notifier/http/channels.ts`, the consumer loop:
```ts
const event = { type: bare, ...envelope.data, __loomEventId: envelope.id } as unknown as DomainEvent;
await dispatcher.dispatch(event);
```
`envelope.data` came from `JSON.parse`, so `at` is a **string**. Nothing revives
it to a `Date`. The handler then does
`Notification.create({ …, sentAt: e.at })` (`notifier/http/workflows.ts:103`) and
the repository calls `.toISOString()` on it. **The `as unknown as DomainEvent`
cast is what stops TypeScript from catching this** — the one place a double cast
appears is the one place the wire boundary is unchecked.

**Why this is the worst failure mode in the evaluation.** Every layer reports
success: the HTTP call is 204, the aggregate is correctly `Completed`, the
publish is logged as `channel_published`, the broker delivers, the subscription
is healthy. The only trace is a `warn` in a *different service's* log. The channel
is `retention: ephemeral`, so there is no outbox, no retry and no DLQ — **the
event is gone.** In production this is a notification that never sends and a
downstream aggregate that silently never exists, discovered weeks later by a
customer.

And a `datetime` on a domain event is not an edge case — it is the shape of
essentially every event anyone writes, including both examples in Loom's own
README and `docs/channels.md`.

**Workaround:** carry timestamps as `string` on any event that crosses a channel
and parse them by hand — i.e. give up the type system at exactly the boundary
where you need it. **Adoption impact:** high; blocks the event-driven
multi-deployable architecture that is a headline reason to choose this tool.
**Time lost:** 40 min.

---

## F-020 · S3 · DOCUMENTED-by-omission · the generated compose has no restart policy; a transient DB blip kills the API permanently

1. `grep -c "restart:" out/docker-compose.yml` → **0**
2. Observed live: a docker-network hiccup produced
   `getaddrinfo EAI_AGAIN db` during the boot migration; the api process exited 1
   and **stayed down** (`api Exited (1)`) while every other service was healthy.
   `docker compose up -d api` reproduced the same exit until the whole network was
   recreated.

The boot sequence is: connect → migrate → serve, with no retry/backoff around the
migration and no `restart: unless-stopped` on any service. Healthchecks exist and
are good; nothing acts on them.
**Adoption impact:** low for dev, but it is the shape of the "could SRE operate
this at 3am" answer — see the report. **Time lost:** 10 min.

---

## POSITIVE-01 · tenant isolation holds, and it holds in the generated SQL

Recording this with the same rigour as the failures, because it is the single
strongest result in the evaluation and it is the thing I most expected to break.

Setup: two real OIDC principals, `TENANT-A` and `TENANT-B`, minted from the
generated Keycloak (after F-016's manual mapper work). Tenant A owns a customer,
site, asset, technician, part, work order and invoice.

| # | attack as tenant B | result |
|---|---|---|
| 1 | `GET /api/customers` (list) | `{"total":0,"items":[]}` |
| 2 | `GET /api/customers/{A's id}` | **404** — existence hidden, not 403 |
| 3 | `POST /api/work_orders/{A's id}/cancel` (operation) | **404** |
| 4 | `POST /api/workflows/schedule_work_order` with A's ids | **404**, `workflow_failed` logged |
| 5 | `GET /api/invoices/{A's id}/history` (audit trail) | **404** (A gets 200) |
| 6 | `POST /api/customers/{A's id}/update` | **404** |
| 7 | `DELETE /api/customers/{A's id}` | **404** |
| 8 | token with **no** `tenantId` claim | list `{"total":0}`; write fails (F-018) |

A's customer afterwards: `{"name":"Northwind","version":1}` — untouched.

And it is real in the database, not just in the DTO layer:
```
select name, tenant_id, data_key from ops.customers;
 Northwind | TENANT-A | TENANT-A
```
The filter is compiled into every generated read (`eq(t.tenantId, requireCurrentUser().tenantId)`),
the stamp into every insert, and the `dataKey` materialised path is populated.
The `loom.tenancy-stance-unmarked` gate makes forgetting a stance a compile error
— I hit it, and it is the right error.

**This is the feature I would buy the product for.** It is also the reason the
verdict is not "do not adopt".

---

## F-021 · S1 · **SILENT** · an optional cross-aggregate reference breaks the Vue frontend build (React/Angular/Svelte are fine)

Repro: `eval/repro/F-021-vue-optional-ref-link.ddd` (24 lines)

1. `parse` → clean; `generate system` → `Wrote 84 file(s)`
2. `cd web && npm install && npm run build`

**Observed:**
```
src/pages/notes/detail.vue(60,26): error TS2345:
  Argument of type '{ to: string; title: string | null | undefined; }' is not assignable
  to parameter of type '… RouterLinkProps …'
```
Emitted line: `<router-link :to="`/tags/${ row.tag }`" :title="row.tag">` — `row.tag`
is `Tag id?`, so `string | null | undefined`, and Vue's `RouterLink.title` wants a
string. The **same `.ddd`** builds clean on react (mantine/shadcn/mui/chakra),
svelte and angular.
**Adoption impact:** medium, and it is the proof for the interchangeability
question: a per-framework emitter divergence on an ordinary optional field.
**Time lost:** 15 min.

---

## F-022 · S1 · **SILENT** · two enums that share a member name resolve to the wrong enum — on all five backends

**Claim under test.** `docs/technical.md` / README: "**Loom IR is platform-neutral
and fully resolved.** Every name carries a `refKind` … Backends never re-resolve."

FieldOps declares two enums in one context:
```ddd
enum WorkOrderStatus { Draft, Scheduled, InProgress, Completed, Cancelled }
enum InvoiceStatus   { Draft, Issued, Paid }
aggregate Invoice … { status: InvoiceStatus = Draft
  function isDraft(): bool = status == Draft
  operation issue() … when status == Draft { … } }
```
The **field** lowers correctly to `InvoiceStatus`. Every **expression** use of the
bare value `Draft` lowers to `WorkOrderStatus.Draft` — the first enum that declared
the name. Five backends, one IR bug, five different outcomes:

| backend | emitted | outcome |
|---|---|---|
| node | `this._status === WorkOrderStatus.Draft` | **compiles and works** — TS emits enums as string-literal unions, so `"Draft" === "Draft"` |
| python | `self._status == WorkOrderStatus.Draft` | **runs and works by accident** — `StrEnum` compares by value (verified: `A.Draft == B.Draft → True`); mypy flags it as `Non-overlapping equality check` ×5 |
| java | `this.status == WorkOrderStatus.Draft` | **compile error** — `incomparable types: InvoiceStatus and WorkOrderStatus` |
| dotnet | `this.Status == WorkOrderStatus.Draft` | **compile error** — `CS1750: A value of type 'WorkOrderStatus' cannot be used as a default parameter … no standard conversions to type 'InvoiceStatus'` |
| elixir | (compile aborted earlier — not reached) | unverified |

**This single finding answers the interchangeability question.** The bug is in the
shared, "fully resolved", platform-neutral IR. Two backends hide it because their
enums are structural; two reject it because their enums are nominal. On node and
python it is a latent bug that becomes wrong the moment two same-named members
have *different* values.
**Workaround:** never reuse an enum member name inside one context — i.e. no
`Draft` on both `OrderStatus` and `InvoiceStatus`, which is a normal thing to want.
**Adoption impact:** high. **Time lost:** 20 min.

---

## F-023 · S1 · **SILENT** · a `criterion` referencing `currentUser` emits an undefined identifier on python and elixir

Repro: `eval/repro/F-023-criterion-currentuser-backends.ddd` (21 lines) —
the canonical row-level rule, `criterion Mine() of Doc = ownerUserId == currentUser.id`.

Generated for each backend, same source:

| backend | emitted predicate | verdict |
|---|---|---|
| node | `eq(schema.docs.ownerUserId, requireCurrentUser().id)` | **correct** |
| dotnet | `x.OwnerUserId == RequestContext.Current!.CurrentUser!.Id` | **correct** |
| java | `@Query("… e.ownerUserId = :#{@currentUserAccessor.user()?.id()}")` | **correct** |
| python | `DocRow.owner_user_id == current_user.id` | **BROKEN — `current_user` is undefined** |
| elixir | `from(record in Api.C.Doc, where: record.owner_user_id == current_user.id)` | **BROKEN — unbound variable** |

Confirmed by real toolchains on the FieldOps model:
```
python:  mypy → app/db/repositories/work_order_repository.py:66:
           error: Name "current_user" is not defined  [name-defined]
elixir:  mix compile → == Compilation error in file lib/api/ops/retrievals/my_work_orders.ex ==
           ** (Ecto.Query.CompileError) unbound variable `current_user` in query.
```
The **same file** gets the tenant filter right on the same line
(`WorkOrderRow.tenant_id == require_current_user().tenant_id`) — so the tenancy
path uses the correct accessor and the author-written criterion path uses a broken
one. Python's failure is a **runtime `NameError` → HTTP 500 on every read through
that retrieval**; nothing but mypy would have told you. Elixir at least refuses to
compile.
**Adoption impact:** high — this is the row-level authorization primitive.
**Time lost:** 25 min.

---

## F-024 · S1 · **SILENT** · Java: `currentUser` is an undefined symbol inside a workflow body, so `requires` gates don't compile

From the FieldOps Java build:
```
OpsWorkflows.java:85: error: cannot find symbol
  if (!(currentUser.permissions().contains("field.dispatch") || currentUser.permissions().contains("field.admin")))
       throw new ForbiddenException("Forbidden: currentUser.permissions.contains(permissions.dispatch)");
  symbol: variable currentUser
```
Note the `implies` closure expanded correctly (`field.dispatch || field.admin`) —
the authorization *logic* is right; the *binding* is missing. Any workflow that
inlines an operation carrying a `requires` gate fails to compile on Java.
**Adoption impact:** high on Java. **Time lost:** included in the breadth sweep.

---

## F-025 · S1 · **SILENT** · Java: an `objectStore.put(key, {json})` call emits a `Map` into a `String` parameter

```
OpsWorkflows.java:51: error: incompatible types: no instance(s) of type variable(s) K,V
  exist so that Map<K,V> conforms to String
  S3Resources.photosPut(key, Map.of("workOrder", workOrder, "caption", caption));
```
`docs/resources.md` documents `put(key, json)` with the Java client as
`software.amazon.awssdk:s3`. The emitted helper's second parameter is `String`;
the call site passes `Map.of(...)`. Object-store writes do not compile on Java.
**Time lost:** included in the breadth sweep.

---

## F-026 · S1 · **SILENT** · .NET: the generated channel transport has a broken namespace

```
Infrastructure/Channels/ChannelTransport.cs(239,26): error CS0234:
  The type or namespace name 'Infrastructure' does not exist in the namespace 'Api.Api'
Infrastructure/Channels/ChannelTransport.cs(244,13): error CS0234: (same)
```
A double-prefixed namespace (`Api.Api.Infrastructure`) in a file the generator
emits for **every** .NET deployable that wires a `channels:` binding. Independent
of anything specific to my model.
**Adoption impact:** any .NET + broker system is dead on arrival.
**Time lost:** included in the breadth sweep.

---

## F-027 · S1 · **SILENT** · Elixir: a collection-of-enum field is not a valid Ecto type

```
== Compilation error in file lib/api/ops/technician.ex ==
** (ArgumentError) invalid type {:array, Ecto.Enum, [values: [:Electrical, :Plumbing, :HVAC, :Refrigeration]]}
   for field :skills
```
Source: `skills: Skill[]` on `aggregate Technician` — a collection of a declared
`enum`, which `docs/language.md` lists as an ordinary typed field. Compiles on
node. Ecto requires `{:array, Ecto.Enum}` to be declared differently; the emitter
composes the two incorrectly.
**Time lost:** included in the breadth sweep.

---

## F-028 · S2 · **SILENT** · summary: one backend of five compiles the model; the CLI reports success for all five

`eval/fieldops/fieldops.ddd` (354 meaningful lines), regenerated verbatim onto each
backend by substituting only the `platform:` value. **All five report
`0 error(s), 0 warning(s)` and write a complete tree.**

| backend | files | Loom says | real toolchain | distinct defects |
|---|---|---|---|---|
| node (Hono) | 224 | 0 errors | `tsc --noEmit` → **0 errors** | — (after 5 model workarounds) |
| python (FastAPI) | 244 | 0 errors | `uv run python -c "import app.main"` → OK; **`mypy app` → 10 errors**; `ruff` → 1 | F-022 ×5, **F-023 (runtime NameError)**, 4 enum arg-type |
| dotnet (ASP.NET) | 495 | 0 errors | `dotnet build -warnaserror` → **BUILD FAILED, 3 errors** | F-026 ×2, F-022 |
| java (Spring Boot) | 415 | 0 errors | `gradle testClasses` (JDK 25 / Gradle 9) → **BUILD FAILED, 5 errors** | F-022, F-024 ×2, F-025, conditional-type |
| elixir (Phoenix) | 375 | 0 errors | `mix compile` → **COMPILATION ERROR** | F-023, then F-027 (aborts on first; ≥2 distinct, unknown how many behind) |

Elixir's count is a floor, not a total: `mix` stops at the first error, so I
removed the F-023 retrieval and recompiled to find F-027 behind it. I stopped
peeling after two.

**The README says "Five backends from one source … Identical API contracts;
idiomatic per-runtime output."** On my model that is **Contradicted**: the source
generates on five and compiles on one. I sampled one model — a real but ordinary
one, using only documented features — so I can say "the five backends are not
interchangeable for this domain", not "backend X never works".

---

## F-029 · **S1** · **SILENT** · generating into a clean directory silently rebaselines migrations — adding one nullable field takes a live application down while reporting healthy

**This is the most consequential finding in the evaluation.**

**Claim under test.** `docs/migrations.md`: "`MigrationsIR` is the schema delta a
generated stack applies to bring its Postgres database in line with the `.ddd`
source … the output is *stateful* (it diffs against what was emitted last time)".
README: "generated migrations".

**Setup.** A live FieldOps stack against Postgres with real rows (2 customers).
**Change.** Add one optional field: `phone: string?` on `Customer`. That is the
most common change any team makes.

1. `node bin/cli.js generate system fieldops-v2.ddd -o out-v2`  ← a **clean** output dir
   → `0 error(s), 0 warning(s). Wrote 224 file(s)`
2. `diff -rq out-baseline out-v2` →
   `Files BASE/api/db/migrations/20260101000000_field_initial.sql and V2/… differ`
   — the **initial migration was rewritten in place**:
   ```diff
   24a25
   >   "phone" TEXT NULL,
   ```
   and `meta/_journal.json` still has exactly **one** entry, same tag.
3. `docker compose up -d --build api` → `api Up 20 seconds (healthy)` ✅
4. `\d ops.customers` → **no `phone` column.** `select count(*) from
   drizzle.__drizzle_migrations` → still **1**. The migrator matched the tag,
   considered it applied, and skipped the changed content.
5. Every request:
```
GET  /api/customers → HTTP 500 {"detail":"internal"}
POST /api/customers → HTTP 500
api log: Failed query: select "id","name","billing_email","phone","tenant_id" …
         Failed query: insert into "ops"."customers" ("id","name","billing_emai…
```

**Root cause.** The migration baseline is state kept **inside the output tree**
(`.loom/snapshots/<module>.snapshot.json`). A clean output directory has no
snapshot, so `baseline = null` and the builder emits a fresh `Initial` with the
same `BASE_TIMESTAMP` tag — indistinguishable, to the generator, from a first run.

**The same change generated IN PLACE is flawless**, which is what makes this so
sharp:
```
$ node bin/cli.js generate system fieldops-v2.ddd -o out-inplace     # snapshots present
0 error(s), 0 warning(s). Wrote 18 file(s) in out-inplace, unchanged: 204
$ ls out-inplace/api/db/migrations/
20260101000000_field_initial.sql
20260101500001_field_add_phone_to_customers.sql      ← correct incremental delta
```
Deployed against the same populated DB: column added, `drizzle.__drizzle_migrations`
= 2, existing rows preserved (`{"name":"Northwind","phone":null}`), app healthy.

**Why this is S1 and not S3.** "Generate into a clean directory" is not an exotic
mistake — it is what a CI job does, what a fresh clone does, what `-o ../build`
does, and what anyone does the first time they try a second environment. There is
no warning: not at generate time (the tool cannot tell a rebaseline from a first
run), not at boot (the migrator is doing exactly its job), and not from the
healthcheck (`/ready` doesn't touch the table). The first signal is a total
outage. A `--allow-rebaseline` flag exists, which shows the concept is understood;
it simply is not reachable from this path.

**Workaround:** treat `.loom/snapshots/` as production state — commit the whole
generated tree to git, never generate into a fresh directory, and add a CI check
that the initial migration's hash never changes. That is a discipline an adopter
must invent and enforce themselves; nothing in the product tells them to.
**Adoption impact:** decisive. **Time lost:** 45 min.

---

## POSITIVE-02 · the destructive-migration gate is genuinely excellent

Every breaking change I tried against the populated baseline, in place:

| change | result |
|---|---|
| drop `phone` (holding data) | **refused** — `migration for module "Field" contains 1 destructive change(s): - DROP COLUMN ops.customers.phone`, plus the backfill alternative and `--allow-destructive` |
| retype `string?` → `int?` | **refused** — `alterColumnType` |
| `string?` → `string` (NOT NULL flip) | **refused** — "`SET NOT NULL on ops.customers.phone` (fails on rows holding NULL)" |
| rename one field (no annotation) | **accepted, data preserved** — heuristic emitted `ALTER TABLE "ops"."customers" RENAME COLUMN "phone" TO "phone_number";` |
| rename **two** fields at once | **refused** — "drops and adds column(s) on the same table that look like an unannotated rename — emitting them as drop+add would DESTROY the renamed column's data … declare it explicitly: `migration "<name>" { <Aggregate>.<oldField> -> <newField> }`" |
| the explicit `migration { }` block | **works** — two `RENAME COLUMN`s, no data loss |
| move an aggregate to another context | **refused** at parse — 4 precise errors (`loom.ui-id-ref-unmounted` ×2, cross-context ref) |

The diagnostics name the table, the column, the risk, and the exact fix. I could
not find a way to make it destroy data in place. This is better than most
hand-rolled migration tooling I have used — and it is exactly why F-029 is so
frustrating: the safety is real, and one state-location decision routes around
all of it.

---

## F-031 · S2 · **SILENT** (clobber) / DOCUMENTED (escape hatch) · hand-edits to generated code are overwritten with no warning

**Claim under test.** README: *"The keys to the codebase … All the source you'd
write by hand … full ownership of every line that's generated."*

1. Hand-edit six generated files in a tree, then `generate system` over it:
```
Wrote 5 file(s) in out-edit, unchanged: 215
```
| file | outcome |
|---|---|
| `api/domain/part.ts` (business logic) | **CLOBBERED** |
| `api/http/customer.routes.ts` | **CLOBBERED** |
| `docker-compose.yml` | **CLOBBERED** |
| `web/src/pages/customers/list.tsx` | **CLOBBERED** |
| `api/package.json` | **CLOBBERED** |
| `api/db/migrations/…_initial.sql` | SURVIVED (part of the ledger — correct) |

The run reports a file *count*, never that it replaced modified content.

2. The documented escape hatch works exactly as specified. `.loomignore` at the
output root, gitignore syntax:
```
$ node bin/cli.js generate system … --dry-run
  skip (.loomignore)  api/domain/part.ts  (3.4 KB)
  skip (.loomignore)  api/package.json  (1.3 KB)
  skip (.loomignore)  docker-compose.yml  (3.6 KB)
Would write 1 file(s), unchanged: 216, skipped (.loomignore): 3
$ node bin/cli.js generate system …
Wrote 1 file(s), unchanged: 216, skipped (.loomignore): 3     → all three SURVIVED
```

**So: "you own the source" means "until the next regenerate", unless you pin the
whole file — and a pinned file stops receiving generator updates forever.** The
granularity is the file; there is no merge, no region marker, no three-way.

**And here is the bite.** `docs/tools.md` is explicit about what you may pin:
*"Don't pin Loom's domain artefacts (`domain/*`, `db/schema.ts`, … controllers,
repository implementations, command/query handlers). Those are auto-derived from
the `.ddd` source — pinning them defeats the point."* But **every workaround for
the SILENT bugs in this report lives in exactly those files**: the missing `ne`
import (F-009) is in `db/repositories/*`, the `undefined` dashboard (F-014) is in
`web/src/pages/*`, the broken criterion (F-023) is in a repository, the missing
`Decimal` import (F-030) is in `http/*.routes.ts`. So when you hit a codegen bug,
your options are: pin a domain file and freeze it against your own future model
changes, or wait for upstream.
**Adoption impact:** high — this is the escape-hatch cost the report must state
plainly. **Time lost:** 25 min.

---

## F-030 · S1 · **SILENT** · a `money` field with a default emits `new Decimal(...)` without importing Decimal

Repro: `eval/repro/F-030-money-default-missing-import.ddd` (17 lines)

1. `parse` → `0 error(s), 0 warning(s).`  2. `generate` → `Wrote 43 file(s)`
3. `npx tsc --noEmit` → `http/item.routes.ts(15,35): error TS2304: Cannot find name 'Decimal'.`

Emitted: `weight: moneySchema.default(new Decimal("0.00")),`
Imports in that file: **no `decimal.js` import at all** (`grep -c 'decimal.js'` → 0).

`money` is Loom's flagship primitive and `= money("0.00")` is the most ordinary
modifier there is. Found accidentally, while scaling to 39 aggregates — 14
identical errors. (My hand-written FieldOps model dodged it only because its money
field was `managed`, which keeps it off the create-request schema.)
**Adoption impact:** high — this and F-009 are the same one-line class, and the
fact that two independent instances of it survived a 9,000-test suite says the
emitted-import path is not covered by a compile gate on the default backend.
**Time lost:** 10 min.

---

## F-032 · S3 · HONEST (poor message) · 43 ordinary words cannot be used as field names

1. `aggregate Holder { node: string  label: string  derived display: string = label }`
2. `node bin/cli.js parse …` →
```
/tmp/kw.ddd:3:24 error: Expecting token of type '}' but found `node`.
```

Swept a candidate list; **every one of these fails as a field name**:
```
node java python react vue svelte angular elixir dotnet flutter feliz
state port design api ui storage kind type key data user admin cache
queue replica snapshot mailer contexts targets auth theme layout menu
page area store match emit let return
```
The language-keyword half (`let`, `return`, `match`, `emit`) is unsurprising. The
rest is the deployment vocabulary leaking into the global token space, and it
takes with it some of the most common field names in business software: **`type`,
`key`, `data`, `user`, `state`, `kind`, `status`(ok), `page`, `store`, `area`,
`admin`, `queue`, `cache`, `snapshot`**. (`name` and `status` are fine.)

Two costs: the rename tax on a real domain, and a diagnostic that says
"Expecting token of type '}'" instead of "reserved word". I hit this while
generating a 39-aggregate model and lost time reading the grammar before
realising `node` was the problem.
**Workaround:** rename the field (`node` → `owner`, `type` → `kindOf`, …).
**Adoption impact:** low individually, but it is friction on every model, and it
leaks into your wire contract and database column names.
**Time lost:** 15 min.

---

## POSITIVE-03 · no scaling cliff in the toolchain

Grew FieldOps to **39 aggregates / 838 meaningful `.ddd` lines** (14 extra
contexts × 2 aggregates, each with an entity part, criterion, retrieval, enum,
invariants and operations):

| | 11 aggregates (354 lines) | 39 aggregates (838 lines) |
|---|---|---|
| `ddd parse` | 2.4 s | **3.0 s** |
| `ddd generate system` | 2.5 s | **3.1 s** |
| files emitted | 224 | **337** |
| generated LOC | 18,991 | **50,124** |
| `tsc --noEmit` (node backend) | 7 s | **13.7 s** |
| `docker compose up -d --build` (cold) | 58 s | not measured |

Generation is effectively flat — 2.4× the model for 1.25× the time. The
"no scaling cliff" claim, **as applied to the generator itself**, is Verified at
this size. (The claim's *other* meaning — that the generated application scales —
is not something a 39-aggregate compile can answer, and I did not test it.)

The 39-aggregate tree did **not** compile: 14 × F-030.

---

## F-033 · S1 · **SILENT** · Feliz (F#) frontend: 31 compile errors from the same model

`dotnet build` on the generated Feliz project (`design: "corporate"`, same FieldOps model):
```
31 Error(s), 10 Warning(s)
src/App.fs(3310,5):    error FS0019: This constructor is applied to 0 argument(s) but expects 1
src/App.fs(3796,233):  error FS0001: The type 'string option' does not match the type 'string'
src/App.fs(4068,491):  error FS0039: The type 'ScheduleWorkOrderForm' does not define a field … named 'workOrder'
src/App.fs(4068,1464): error FS0039: … does not define a field … named 'technician'. Maybe you want one of the following: tech
src/App.fs(4068,3233): error FS0001: This expression was expected to have type 'Msg' but here has type 'string -> Msg'
```
The workflow-form emitter builds a record with one field-name set and reads it with
another (`technician` vs `tech` — it took the *aggregate operation's* parameter name
rather than the workflow's). Loom reported `0 error(s), 0 warning(s). Wrote 160 file(s)`.
**Time lost:** 15 min (ran in parallel).

---

## F-034 · S2 · DOCUMENTED-in-a-code-comment · the `ddd i18n` translator workflow is not wired to the generated app

**Claim under test.** README/`docs/README.md`: "the i18n string-catalog layer (`t()`
runtime, `msg.<hash>` validation catalog, `ddd i18n sync`)". FieldOps requirement:
*"the work-order UI in a second language."*

The translator half works well:
```
$ ddd i18n extract fieldops-v2.ddd -o .     → Extracted 304 message(s) → .loom/messages.en.json
$ ddd i18n init fieldops-v2.ddd de          → Created locales/de.json — 304 key(s) to translate
                                              Wrote lock locales/.loom/source.lock.json
$ ddd i18n status fieldops-v2.ddd           → de: +0 new, 304 kept / de: 288 TODO
$ ddd i18n check fieldops-v2.ddd --strict   → 288 finding(s) with --strict → failing   (exit 1 ✓)
```
Then:
```
$ ddd generate system fieldops-v2.ddd -o out
$ ls out/web/src/locales/
en.json                                      ← only English
```
The generated `src/i18n.ts` states the contract in its own comment:
> *"To add a locale, drop a `src/locales/<locale>.json` file, **import it below, and
> register it in `catalogs`**."*

So the two halves do not meet: `locales/de.json` lives next to the `.ddd`, and
shipping it means hand-copying the file into the generated tree **and hand-editing
`src/i18n.ts`** — a generated file, so the edit is clobbered on the next regenerate
(F-031) unless pinned, and pinning it freezes the i18n runtime.
**Workaround:** a build step that copies the locale and patches `i18n.ts`; or pin
`src/i18n.ts` and maintain it yourself. **Adoption impact:** medium — "ship the UI in
a second language" is a one-afternoon task that becomes a permanent build-glue chore.
**Time lost:** 20 min.

---

## F-035 · S3 · **SILENT** · `ddd verify` treats an unrecognised test `status` as unverified and reports "No unknown results"

1. `results.json` with `"status": "passed"` / `"failed"` (instead of the documented
   `"pass"`/`"fail"`):
```
Verified 0/3 requirements (0 failing, 3 unverified, 0 untested).     exit 0
…
| `TC-001` | UNVERIFIED | work order lifecycle through the API (passed) |
| `TC-003` | UNVERIFIED | browse work orders in the UI (failed) |
## Diagnostics
_No unknown results._
```
It matched the tests, printed their statuses verbatim, classified none of them, and
then asserted there was nothing unknown.
2. The same file with `"pass"`/`"fail"` works perfectly:
```
Verified 2/3 requirements (1 failing, 0 unverified, 0 untested).
Verification gate failed: 1 requirement(s) failing.               exit 1 ✓
- ✅ US-001 (VERIFIED)  - ✅ US-002 (VERIFIED)  - ❌ US-003 (FAILING) — failing: TC-003
## Diagnostics
Results matching no declared test:  - stock decrements (pass) …
```
So the feature is real and the gate does gate — but a one-word typo in your CI glue
turns a fully green suite into "0% verified" while the report says nothing is wrong.
Unmatched *names* are diagnosed; unmatched *statuses* are not.
**Adoption impact:** low-medium, but it is a quality gate, and a quality gate that
can be silently neutralised by a typo is worth one line of validation.
**Time lost:** 15 min.

---

## F-036 · S3 · **Contradicted** · `ddd generate` does not emit the MIT LICENSE the README promises

**Claim under test.** README, *License*: *"The **code Loom generates** (everything
`ddd generate` writes into `<outdir>/`) is licensed to you under the **MIT
License** — the CLI **emits a `LICENSE` file at the output-directory root that says
so explicitly**."*

```
$ node bin/cli.js generate system fieldops-v2.ddd -o out
$ find out -maxdepth 2 -name LICENSE
(nothing)
$ ls out/
api  db-init  docker-compose.obs.yml  docker-compose.yml  e2e  keycloak  monitoring  notifier  web
```
Only `ddd new` emits it (`eval/phase0/LICENSE` → "MIT License … scaffolded by Loom").
`docs/tools.md` states the real behaviour and contradicts the README:
> *"`ddd generate` writes none of these: it emits build output into a tree whose
> identity files are yours (M-FT.13, finding G9)."*

The *grant* is in the README and `docs/license-faq.md`, so this is a missing
artifact rather than a missing right — but the artifact is exactly what a legal
reviewer asks for, and after the first scaffold every subsequent generate is into an
existing tree with no MIT file in it.
**Adoption impact:** low technically, medium in procurement. **Time lost:** 5 min.

---

## POSITIVE-04 · diagnostics on broken input are excellent — 9 of 10

Ten deliberately broken `.ddd` files (`eval/adversarial/a01…a10`). Every one was
refused with the right line:col and, in nine cases, an actionable message:

| # | defect | diagnostic |
|---|---|---|
| 01 | typo in a field ref | `3:28 Unknown name 'totl' — did you mean 'total'?` |
| 02 | `string > int` in an invariant | `3:22 Operator '>' cannot compare 'string' with 'int'. Operands must be the same type…` |
| 03 | bare cross-aggregate ref | `3:31 References across aggregate boundaries need an id link — write 'Customer id'…` |
| 04 | empty `dataSources: [ ]` | `5:64 Unexpected ']'. Expected one of: 'action','asc','body','by','canonical' (+101 more)` ← **the one bad one** |
| 05 | duplicate aggregate name | `3:13 Duplicate declaration 'Order' in context 'C'…` |
| 06 | assign to a derived | `4:24 Cannot assign to derived property 'twice'.` |
| 07 | `money + decimal` | `3:34 Operator '+' has incompatible operand types… Allowed for money: money ± money, money × {int\|long\|decimal}…` |
| 08 | wrong call arity | `4:29 Function 'scale' expects 2 arguments, got 1.` |
| 09 | frontend targets a missing backend | two errors: unresolved ref + `Frontend deployable 'web' must declare 'targets:'` |
| 10 | emit an undeclared event | `3:30 Could not resolve reference to EventDecl named 'OrderClosed'.` |

No crashes in this set. The one crash-where-a-diagnostic-belongs I found is F-007
(`QueryEmissionRefusal` + 10-frame stack trace, from *valid* input).

---

## POSITIVE-05 · `ddd trace` and `ddd breakpoints` are real, and good

`generate system … --sourcemap` emits `.loom/sourcemap.json` (72 files mapped,
construct-level spans with columns). Then, on a stack trace from the running app:
```
$ ddd trace crash.log
TypeError: Cannot read properties of null (reading 'toString')
    at WorkOrder.complete (/app/api/domain/workOrder.ts:136:64)
        →  Ops.WorkOrder.complete  (…/fieldops-v2.ddd:172:48)
    at WorkOrderRepository.save (…/workOrder-repository.ts:61:30)
        →  Ops.WorkOrder  (…/fieldops-v2.ddd:204)
    at Object.handler (…/workOrder.routes.ts:151:25)
        →  Ops.WorkOrder  (…/fieldops-v2.ddd:126)
ddd trace: annotated 3 of 4 stack frame(s).
```
And the reverse, at statement granularity:
```
$ ddd breakpoints fieldops-v2.ddd --line 170     # `completedAt := now()`
api/domain/workOrder.ts:134:25
$ ddd breakpoints fieldops-v2.ddd --line 172     # the `emit` line
api/domain/workOrder.ts:136:64 / :81 / :98
```
This materially answers "can we debug it" — see the report. (A line naming an
operation *header* resolves to the whole aggregate's span, i.e. `:1`; body lines are
exact.)

---

## F-037 · S2 · project health · 83% of the commits are machine-authored, the bus factor is 1, and the maintainers' own audit found a third of the docs wrong

Not a bug — the context in which every other finding has to be read.

```
$ git log --format='%an' | sort | uniq -c | sort -rn
    669 Claude <noreply@anthropic.com>
    135 Michał Kupiec <ten.michal.k@gmail.com>
      6 claude[bot]
$ git rev-list --count HEAD                    → 810
$ git log --format=%ad --date=short | sort -u  → 2026-08-24 … 2026-09-13   (~3 weeks visible)
$ git tag                                      → (none)
$ node -pe 'require("./package.json").version' → 0.1.0
```
PR numbers in the first visible commit are already ~#2705 and the tip is #2860, so
the true history is longer than the visible window — but **155 PRs merged in 13
days, ~12/day, by one human reviewer.** No tags, no releases, version `0.1.0`.

Their own commit subjects, verbatim:
- `Language docs audit 2026-09: ~940 claims re-verified against main, ~1/3 were stale or wrong (#2771)`
- `Eight agents re-verified 30 register rows by generating; half of them were wrong`
- `Wave 1: close the P0/P1 silent-gap residue — seven packets, one PR (#2752)`
- `Fold Wave C1 packet 1f: validator silent drops`
- `fix(vue,svelte): the generated Vue app failed its own 'npm run build'` ← 2 days before my run; F-021 is the same class, back
- `Wave C1 1d-ii: the two things the gates got WRONG, found by running them wide`

**Did they know?** Yes — and they have my exact taxonomy. `docs/new-plan/T6-backend-parity.md`, first paragraph:
> *"What's left is a short residue — but **several residues have the WRONG failure
> mode (silent output or generator crash instead of an honest `loom.*` gate)**.
> Converting those is cheap and high-value."*

And `experience_gathered.md` documents the F-014 fallback as a known, unfixed gap:
> *"**`currentUser.<claim>` in a body was the shared walker's unresolved-ref fallback**
> (`case "ref"` → `/* unresolved */ undefined`) … Optional is the key: only Feliz
> implements it, so React/Vue/Svelte/Angular are byte-identical … **their own
> `undefined` is a pre-existing gap, not a regression I own.**"*

**Is any user-facing claim contradicted by internal material?** Yes, three:
1. README *"No drift between layers"* / *"validated before emission"* vs T6's
   "several residues have the WRONG failure mode (silent output…)". (F-012, F-014)
2. README *"the CLI emits a `LICENSE` file at the output-directory root"* vs
   `docs/tools.md` "`ddd generate` writes none of these". (F-036)
3. The README's five-backend framing vs their own parity track, which is an active
   drain list. (F-028)

**Assessment.** This is not a sloppy project — the internal engineering writing is
genuinely excellent (`experience_gathered.md` §81, "A compile gate proves the code is
well-formed, not that the value binds", is better than most senior post-mortems I
read). The problem is throughput versus verification: features are landing faster
than the gates that would prove them, on a surface of 5 backends × 6 frontends × 13
design packs, with one human in the loop.
**Adoption impact:** this is the dominant risk. See the report's risk register.

---

# Clearline findings (the second model — inheritance, unions, authority limits)

`eval/clearline/clearline.ddd` (196 lines) probes what FieldOps didn't reach:
`abstract aggregate` + `extends`, TPH vs TPC, polymorphic reads, a discriminated
union of decision outcomes, and an authorization rule that depends on both the
record's amount and the actor's own limit.

**It parses clean (3 warnings) and generates 164 files with `0 error(s)`. It does
not compile: 8 `tsc` errors, 4 of them new classes.**

---

## F-038 · S2 · HONEST (excellent message) · you cannot change your mind about TPH vs TPC

**The brief's exact test:** *"Decide and justify one-table vs table-per-type, then
change your mind and migrate."* **The answer is: you cannot, for this domain.**

TPH is emitted correctly and is textbook — one table, a `kind` discriminator, shared
columns NOT NULL, subtype columns NULL, the Money VO flattened:
```sql
CREATE TABLE "handling"."claims" (
  "id" UUID NOT NULL, "kind" TEXT NOT NULL, "policy_ref" UUID NOT NULL,
  "reference" TEXT NOT NULL, "status" TEXT NOT NULL, "reported_at" TIMESTAMPTZ NOT NULL,
  "fraud_score" DECIMAL NOT NULL, "version" INTEGER NOT NULL,
  "vehicle_vin" TEXT NULL, "driver_name" TEXT NULL, "police_report_no" TEXT NULL,
  "third_party" TEXT NULL, "legal_counsel" TEXT NULL,
  "address_line" TEXT NULL, "peril" TEXT NULL,
  "contractor_estimate_amount" DECIMAL(19,4) NULL, "contractor_estimate_currency" TEXT NULL,
  PRIMARY KEY ("id"));
```
Flip `inheritanceUsing: sharedTable` → `ownTable` and the model stops type-checking —
**5 errors, one per aggregate that references the base**:
```
'Claim id' references the abstract base 'Claim', which uses inheritanceUsing: ownTable
(TPC) — there is no single table to key against, so the foreign-key target is ambiguous
across the per-concrete tables. Reference a concrete subtype's id (e.g. 'Customer id'),
or change 'Claim' to inheritanceUsing: sharedTable (TPH) to allow polymorphic references.
```
Repro `eval/repro/F-038-tph-to-tpc-blocked.ddd` isolates it in 20 lines:

| model | `parse` |
|---|---|
| TPH, `Payout { claim: Claim id }` | **OK** |
| TPC, `Payout { claim: Claim id }` | **error** (the message above) |
| TPC, `Payout` deleted | **OK** — emits `auto_claims` + `property_claims` |

So **TPC is only reachable if nothing in the model references the base** — and in a
claims domain, `Reserve`, `Payout`, `Subrogation` and `ApprovalStep` all hang off "a
claim". The suggested fix ("reference a concrete subtype's id") means giving every
one of them three nullable FKs and losing the polymorphism that motivated the base.

**This is HONEST — a superb diagnostic, no data at risk — and it is a permanent
architectural commitment made at modelling time.** The migration question never
arises because the model is rejected first. Budget for it: choose TPH unless you are
certain nothing will ever point at the base.
**Time lost:** 20 min.

---

## F-039 · S1 · **SILENT** · `== null` in a criterion emits `eq(col, null)` instead of `isNull(col)`

`criterion OpenSteps() of ApprovalStep = answeredAt == null` — the canonical
"unanswered / not yet closed / still open" filter.

1. `parse` → `0 error(s)`  2. `generate` → `Wrote 164 file(s)`  3. `npx tsc --noEmit`:
```
db/repositories/approvalStep-repository.ts(17,34): error TS2769: No overload matches this call.
  Argument of type 'null' is not assignable to parameter of type 'SQLWrapper | Date'.
```
Drizzle has `isNull()`; the emitter reaches for `eq()`. Even where it compiled, SQL
`col = NULL` is never true — so on a looser backend this is a filter that silently
matches nothing.
**Adoption impact:** high. "Show me the open ones" is the most common query in any
workflow application. **Time lost:** 10 min.

---

## F-040 · **S1** · **SILENT** · an invented member on any primitive passes validation and is emitted verbatim

**This is the cleanest counter-example to the headline claim in the report.**

**Claim under test.** README: *"**LLM-safe by construction** … Validation gates catch
**hallucinated fields** and out-of-scope references **before any code is emitted**."*
`docs/technical.md`: *"every member access carries `receiverType` and `memberType`."*

Repro: `eval/repro/F-040-unknown-member-on-primitive.ddd` (20 lines)

```ddd
aggregate A with crudish {
  s: string   n: int   m: money   label: string
  derived display: string = label
  derived bad1: string = s.totallyMadeUpMember    // string
  derived bad2: string = n.alsoInvented           // int
  derived bad3: string = m.amount                 // `money` has no `.amount`
  invariant m.amount > 0
}
```
```
$ node bin/cli.js parse …        → 0 error(s), 0 warning(s).  OK:
$ node bin/cli.js generate …     → Wrote 43 file(s)
$ grep -n … api/domain/a.ts
34:  get bad1(): string { return this._s.totallyMadeUpMember; }
35:  get bad2(): string { return this._n.alsoInvented; }
36:  get bad3(): string { return this._m.amount; }
55:  if (!(this._m.amount > 0)) throw new DomainError("Invariant violated: m.amount > 0");
```
Swept every primitive — `string`, `int`, `money`, `decimal` — **all accept an
arbitrary invented member with zero diagnostics.** There is no member table for
primitive receivers.

**Why this is the worst of the SILENT class.** Line 55 is an **invariant that can
never fire**: `undefined > 0` is `false` in JS, so the guard inverts to "always
throw" here — but in any position where the expression is a filter or a boolean
read rather than a negated guard, it silently evaluates to `false` forever, and a
business rule you wrote and reviewed simply does not exist. TypeScript catches the
node case; a dynamically-typed backend does not.

I found it by writing `limit.amount > deductible.amount` on two `money` fields —
a completely natural thing to write if you have ever used a `Money` value object,
and exactly the mistake an LLM makes.
**Workaround:** compile the output. There is no model-level protection.
**Adoption impact:** decisive for the "LLM-safe" claim. **Time lost:** 15 min.

---

## F-041 · S1 · **SILENT** · a projection over a TPH subtype selects a table that does not exist

`projection OpenByStatus { … from AutoClaim as c group by c.status … }` where
`AutoClaim extends Claim inheritanceUsing: sharedTable`.

```
http/query-projections.ts(36,53): error TS2339: Property 'autoClaims' does not exist on
  type 'typeof import("…/api/db/schema")'   (×4)
```
TPH puts all three subtypes in one `claims` table with a `kind` discriminator — there
is no `auto_claims` relation — but the projection emitter addresses the subtype by
name and never applies the discriminator. Same family as F-006/F-011: **the
projection `select` resolves against the domain model, not the emitted schema**, now
demonstrated a third time, on a third mechanism.
**Time lost:** 5 min.

---

## F-042 · S3 · HONEST · only one `resource` per (context, kind) — two external APIs need two contexts

```
Deployable 'api' has two dataSources for (Handling, kind: api): 'ocrApi' and 'fraudApi'.
Pick exactly one per (context, kind).
```
Clearline's brief names two external services on one bounded context: an OCR service
for document attachments and a fraud-scoring API at intake. The model cannot bind
both. The workaround is to split the context for purely infrastructural reasons,
which distorts the domain model to satisfy the deployment model.
**Adoption impact:** low-medium; common in practice (payments + email + a partner API
on one context is unremarkable). **Time lost:** 10 min.

---

## F-043 · S2 · HONEST · the authority-limit rule can gate the write but cannot be shown in the UI

The brief: *"the authority-limit rule is an authorization decision depending on the
**record's** amount and the **actor's** limit."*

The **write gate works** and is expressible exactly as intended:
```ddd
operation approve() requires amount.amount <= money(currentUser.authorityLimit) { … }
```
The **read side does not**:
```ddd
derived withinMyAuthority: bool = amount.amount <= money(currentUser.authorityLimit)
→ loom.currentuser-not-in-request-scope: currentUser is only available in per-request
  handlers (operations, workflows, repository find where filters). Found in
  ApprovalStep.derived[withinMyAuthority]; remove the reference or move the logic
  into a per-request body.
```
The diagnostic is honest and correct (a `derived` is computed outside a request). But
the consequence is that **the UI cannot ask "may I approve this one?"** — `when` state
guards get a free `GET /{id}/can_<op>` companion, and `requires` gates do not. So an
adjuster sees an Approve button on every step in their queue and discovers which ones
they may actually approve by clicking and getting a 403.
**Workaround:** duplicate the rule client-side against the token's claim — i.e. write
the authorization rule twice, in two languages, and keep them in sync by hand. That is
precisely the drift the product exists to prevent.
**Adoption impact:** medium-high for any approval/authority domain.
**Time lost:** 15 min.

---

## POSITIVE-06 · two more diagnostics worth quoting

Found while building Clearline; both caught real mistakes I would have shipped:

- `loom.create-params-not-wire` — *"the canonical `create`'s parameter list is not the
  request contract. `POST /<plural>` takes the FIELD-DERIVED create input, so
  `policyRef`, `reference`, `reportedAt` is REQUIRED on the wire even though the
  declared `create` does not accept it — a client (or a `test` block) written from the
  declaration gets a 422 naming a field the create never mentions."*
- `Cannot interpolate a 'datetime' — a template hole must be a string or a
  stringifiable value … Convert it first (e.g. wrap in a 'derived' that formats it).`

When this compiler decides to check something, it checks it better than most. The
problem is never diagnostic quality; it is diagnostic **coverage**.

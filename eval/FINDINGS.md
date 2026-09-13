# Loom evaluation — findings register

**45 findings as filed — 16 S1 · 16 S2 · 12 S3 · 1 S4.**
**Class split: 25 SILENT · 10 HONEST · 3 CRASH-where-a-diagnostic-belongs · 3 CONTRADICTED-doc · 2 DOCUMENTED · 2 other.**

> **Post-filing corrections (2026-09-13).** Every finding was re-verified against fresh `main`
> (`9a8f2fe0`, 93 commits after the evaluation's base) by a nine-agent fleet before any fix was
> planned. The register now stands at **43 live findings**: **2 withdrawn or fixed** — F-032 FIXED by
> `d8b5f7c1`/#2885, F-034(a) WITHDRAWN as a deliberate, already-adjudicated tolerance — and **4
> corrected in place** — F-035 (the Java half was my unsound static inference; .NET stands and is
> root-caused), F-031 (a message-text bug, not a grammar gap — but the message carries no `loom.*`
> code at all), F-030 (the README's CI claim is true; the defect is an uncovered fixture shape), and
> F-009 (**worse** than filed: a read-only cross-context body is not refused at all and emits a
> dangling receiver on all five backends). Each correction is a dated block above the finding it
> amends; nothing was quietly edited. Two findings were confirmed **wider** than filed: F-040 breaks
> four of five backends and makes the fifth emit an infinitely-recursive wire schema; F-004's
> `emit`-inside-`for` shape falsifies the diagnostic's own wording.
> Per-cluster re-verification evidence and fix plans: `eval/fix-plans/` (10 reports). Aggregate:
> `eval/FIX-PLAN.md`.

> The ratio is the headline. A mature generator refuses what it cannot do; Loom's honest refusals are
> excellent, but its **dominant** failure mode is exit code 0 over output that does not compile or
> does not work. Every S1/S2 below has a minimal reproduction in `eval/repro/`.

Severity: S1 blocker · S2 major · S3 friction · S4 polish.
Class: **SILENT** (valid input, exit 0, wrong/uncompilable output) · **HONEST** (refused with a
clear `loom.*` diagnostic) · **DOCUMENTED** (named in the docs up front) · **CRASH** (validator
passes, generator throws a raw stack trace) · **CONTRADICTED** (docs assert something untrue).

---

### F-001 — `ddd new --template crud` scaffolds a model that warns on its own output
Severity: S4 (polish)   Class: HONEST
Area: CLI / starter templates
Claim under test: "`ddd new` … scaffold a starter .ddd project … validated before writing" (CLI help)

Repro:
```
node bin/cli.js new fieldops-starter --platform node --template crud -o eval/phase0
node bin/cli.js generate system eval/phase0/main.ddd -o eval/phase0
```
Observed:
```
main.ddd:34:14 warning: repository find 'byProject' is a wire-shaped list query — pass a criterion
to 'run' (Repo.run(<Criterion>(args))) or name a 'retrieval' instead of accreting a bespoke list
finder on the repository.
0 error(s), 1 warning(s).
```
Expected: the vendor's own starter template should be idiomatic under the vendor's own lint.
Workaround: ignore, or rewrite the find as a `criterion`.
Impact on adoption: trivial in itself; it costs trust on minute two, and it teaches the newcomer a
shape the toolchain then tells them not to use.
Time lost: 5 min.

---

### F-002 — A `let` inside a workflow `for` body is invisible to the next statement
Severity: S2 (major)   Class: HONEST gap, but with a **misleading diagnostic**
Area: language / workflow bodies
Claim under test: docs/workflow.md — "`for x in xs { ... }` Iterate an aggregate array … per-iteration
mutations save inside the loop" and "`let x = Repo.getById(idExpr)` Load by id".

Repro: `eval/repro/wf-for-let-b.ddd` (vs `wf-for-let-a.ddd`, identical but without the inner `let`)
```
workflow finishB transactional {
  create(orderId: Order id) {
    let ls = Lines.run(LinesOf(orderId))
    for l in ls { let p = Parts.getById(l.partId)   p.consume(l.qty) }
  }
}
```
```
$ node bin/cli.js parse eval/repro/wf-for-let-b.ddd
0 error(s), 0 warning(s).
loom.workflow-foreach-unknown-binding C/finishB: workflow 'finishB': in 'for l',
  'p.consume(...)' references unknown binding 'p'.
1 error(s).
```
Observed: `p` IS bound by the immediately preceding statement. The message accuses the author of a
typo they did not make. Removing the `let` (`wf-for-let-a.ddd`) parses clean; hoisting the `let`
above the loop (`wf-for-let-c.ddd`) parses clean.
Expected: either the `let` is scoped to the loop body, or the diagnostic says "a `let` binding is not
supported inside a `for` body — use `if let`".
Workaround: `for l in ls { if let p = Parts.find(SomeCriterion(l.<field>)) { p.consume(l.qty) } }`
(`eval/repro/wf-for-let-f.ddd`, verified to parse and to emit correct transactional TS). Cost: the
lookup must go through a **criterion on a non-id field** (see F-003), and the `if let` else-branch
silently skips a missing row instead of failing the transaction.
Impact on adoption: this is exactly the shape of "for each work-order line, load the part and
decrement stock, atomically" — one of FieldOps' stated requirements. Every per-child-row
cross-aggregate write in our domain hits it.
Time lost: 35 min (most of it disbelieving the error message).

### F-003 — `this.id` is rejected as an unknown field in a `criterion`
Severity: S3 (friction)   Class: HONEST
Area: language / criterion + retrieval
Repro: `eval/repro/wf-for-let-e.ddd`
```
criterion ById(i: Part id) of Part = this.id == i
```
```
loom.retrieval-where-unknown-field C/retrieval findAllByById: retrieval 'findAllByById':
  where-clause references unknown field 'this.id' on aggregate 'Part'.
```
Observed: the aggregate's own synthetic identity is not addressable from a criterion, so the one
lookup you most want to express — "the row with this FK" — cannot be a criterion.
Expected: `this.id` resolves (docs/language.md: "`id` | the implicit identity of the enclosing
aggregate"), or a diagnostic that says identity lookups go through `getById`.
Workaround: use `getById` — but `getById` is not usable where a criterion is required (`if let`,
`Repo.run`), which is what makes F-002's workaround ugly.
Impact on adoption: combines with F-002 to force an unnatural natural-key lookup.
Time lost: 10 min.

### F-004 — `loom.transactional-no-effect` fires on a workflow that *is* transactional
Severity: S3 (friction)   Class: SILENT (wrong analysis) — but fails safe
Area: IR validation vs codegen agreement
Repro: `eval/repro/wf-for-let-f.ddd`
```
loom.transactional-no-effect C/finishE warning: workflow 'finishE': declared 'transactional' but
  does not mutate any aggregate or emit any event — the keyword has no effect.
```
But the emitter disagrees — generated `api/http/workflows.ts` DOES wrap the body:
```ts
await db.transaction(async (tx) => { ... p.consume(l.qty); await parts.save(p); ... });
```
Observed: the validator's mutation-detection doesn't descend into `for` → `if let` bodies; the
emitter does. Two passes over the same IR disagree.
Expected: the warning should not fire.
Workaround: ignore the warning.
Impact on adoption: an engineer who *believes* the toolchain and deletes the keyword loses atomicity
on a stock-decrement path. The failure direction is bad even though the emitted code is right today.
Time lost: 15 min (I only caught it because I read the generated TS).

### F-005 — An aggregate with no `create` silently emits a read-only API; the docs' own tenancy-bootstrap example is unreachable
Severity: S3 (friction) — S2 for the documentation half   Class: SILENT (no diagnostic) + CONTRADICTED doc
Area: codegen / route emission · docs/tenancy.md
Claim under test: docs/tenancy.md:136 — "Filters never gate creates and the registry carries no
stamp, so **`POST /organizations` works for any authenticated principal** … closing the signup loop:
create org → issue token with `tenantId = <org id>` → read it back."

Repro: `eval/repro/tenancy-bootstrap.ddd` (transcribed from the doc's own §Surface example)
```
$ node bin/cli.js parse   eval/repro/tenancy-bootstrap.ddd     → 0 error(s), 0 warning(s).
$ node bin/cli.js generate system eval/repro/tenancy-bootstrap.ddd -o /tmp/out-tb
$ grep -o 'method: "[a-z]*"' /tmp/out-tb/api/http/organization.routes.ts
method: "get"
method: "get"
```
Observed: **no POST route exists.** The registry is read-only, so the documented signup loop cannot
be executed. Generally: any aggregate without an explicit `create` (or `with crudish`) generates a
read-only resource, with **no warning**, and the scaffolded UI still renders a create page for it.
Expected: either a `create` is implied, or a diagnostic ("aggregate 'X' declares no `create` — it
will have no POST route").
Workaround: `aggregate Organization with crudish { … }`, or write an explicit `create(...)`. Five
seconds once you know; I lost 20 minutes assuming the API was broken.
Impact on adoption: low once learned, but it is the first thing a newcomer hits after the
`crudish`-using starter template, and the doc that *should* tell them says the opposite.
Time lost: 20 min.

### F-006 — `create(...)` parameters are silently ignored; the POST body is the field set, not the params
Severity: S3 (friction)   Class: SILENT gap + CONTRADICTED doc
Area: codegen / create route · docs/language.md §"Inside a context"
Claim under test: docs/language.md — "`create [name](params) …` the unnamed form is the aggregate's
canonical creator (**the `POST /<plural>` route takes its params**)."

Repro: `eval/repro/create-gate.ddd` — `create(n: string) { requires … }` on `aggregate Thing { name: string }`
```
$ node bin/cli.js parse eval/repro/create-gate.ddd    → 0 error(s), 1 warning(s)   (no mention of `n`)
$ grep -A3 'CreateThingRequest = ' /tmp/out-cg/api/http/thing.routes.ts
const CreateThingRequest = z.object({ name: z.string()… })
...
const created = Thing.create({ name: body.name });
```
Observed: the declared parameter `n` appears nowhere — not in the Zod schema, not in the OpenAPI, not
in the call. No diagnostic.
Expected: either the params shape the wire contract (as documented), or `loom.*` rejects params that
the create cannot consume.
Workaround: don't declare create params; rely on the create-input projection of the access-modifier
matrix.
Impact on adoption: you cannot design the create wire contract; it is derived. Fine once known, but
the doc says the opposite and nothing tells you.
Time lost: 15 min.

### F-007 — A `create` body cannot assign on a state-based aggregate: no server-side construction logic
Severity: S2 (major)   Class: HONEST (hard error, excellent message) — a real ceiling
Area: language / lifecycle
Repro: `eval/fieldops/main.ddd` (the WorkOrder + Invoice creates)
```
loom.lifecycle-body-dropped Field/aggregate WorkOrder.create: aggregate 'WorkOrder': the `create`
body's `assign` is not emitted on a state-based aggregate, so the assignment never runs — the field
takes its value from the request body instead. … Move the logic to a named `operation`, which emits
its guards and statements on every backend, or drop the clause.
```
33 errors on my model from this one rule.
Observed: on a `persistedAs: state` aggregate (the default), a `create` body may contain **only**
`requires` / `precondition` — no assignment. So "a new WorkOrder always starts in `Draft`",
"`issuedAt` is server-stamped", "derive `number` from a sequence" are not expressible at construction.
The client supplies every editable field, including `status`.
Expected: this is a legitimate design (the framework owns persistence), but it is a **hard ceiling**
that the language reference does not lead with — it is discovered at error time.
Workaround: (a) `= default` on the field, which only sets a *literal*; (b) a two-step
create-then-operation, which is not atomic and leaves an invalid row visible in between;
(c) a `workflow` with a `create` starter, which can run logic — this is the real answer, and it
means every non-trivial construction in the domain becomes a workflow + its own HTTP route.
Impact on adoption: significant. In FieldOps, `WorkOrder` and `Invoice` both need construction logic;
both had to become workflows. A team will hit this on day one and it reshapes the model.
Time lost: 25 min.

### F-008 — `with crudish` and `enforcement: denyByDefault` cannot be used together
Severity: S2 (major)   Class: HONEST gap (hard error, no workaround inside the macro)
Area: language / macros × auth
Claim under test: docs/auth.md:28 — "**Deny-by-default is the recommended posture** for anything
security-sensitive, and `ddd new`'s scaffold points at it" · docs/scaffold-macros.md:204 —
"`with crudish` on an aggregate adds a generated `create(...)` factory, an `update(...)` operation,
and a `destroy {}` destructor".

Repro: `eval/repro/crudish-vs-denybydefault.ddd` (the `ddd new --template crud` shape + the
deny-by-default block its own header comment recommends)
```
loom.default-deny-ungated Project/update:  … declares no `requires` gate.
loom.default-deny-ungated Project/create:  … declares no `requires` gate.
loom.default-deny-ungated Project/destroy: … declares no `requires` gate.
3 error(s).
```
Observed: `crudish` takes no gate argument (`updateOnly:` is its only option, per
docs/scaffold-macros.md:256), and the gate must live in the generated body — which you don't own.
So the recommended security posture forbids the CRUD convenience macro **on every aggregate**.
Expected: `with crudish(requires: <expr>)`, or a context-level default gate.
Workaround: hand-write `create` / `operation update` / `destroy` with a `requires` first statement,
per aggregate. In FieldOps that is 7 aggregates × 3 members ≈ **90 lines of boilerplate that the
macro exists to remove** — and they must be kept in sync with the field list by hand, which is the
drift the DSL is supposed to prevent.
Impact on adoption: high. Either you give up deny-by-default (the recommended posture for a B2B
multi-tenant product) or you give up the macro on every write surface. For FieldOps I took the second
option; it is the single largest source of hand-written `.ddd` in the model.
Time lost: 30 min.

### F-009 — A workflow cannot use a repository from another bounded context (cross-context orchestration is impossible)
Severity: S2 (major)   Class: HONEST refusal, **wrong diagnostic**, undocumented constraint
Area: language / workflows × bounded contexts
Claim under test: docs/workflow.md — "Reach for a workflow when a use-case naturally touches more
than one aggregate"; docs/language.md:221 — "Cross-context type references (`X id`, value-object
usage, enum values) work freely as long as both types are reachable from the same deployable's
hosted context set."

Repro: `eval/repro/wf-cross-context-repo.ddd` — contexts A and B, both hosted by the same `deployable api`
```
context B { workflow touchFoo { create(f: Foo id) { let x = Foos.getById(f)   x.bump() } } }
```
```
loom.workflow-unknown-binding B/touchFoo: workflow 'touchFoo': 'x.bump(...)' references unknown
  let-binding 'x', or 'x' isn't bound to an aggregate.
```
The identical body with `Foos` in the **same** context parses clean (`eval/repro/wf-let-after-for.ddd`).
Observed: cross-context `X id` *types* resolve (verified: `eval/repro/cross-context-id.ddd`), but a
cross-context **repository** does not, so no workflow can orchestrate two contexts. The message
blames the `let`, which sends you hunting in the wrong place.
Expected: either it works (both contexts are in the same deployable and the same database), or the
diagnostic says "repository 'Foos' belongs to context 'A'; a workflow may only use repositories of
its own context."
Workaround: **merge the bounded contexts.** There is no other transactional cross-context mechanism —
`commandHandler` is single-aggregate by validation, and channels/events are asynchronous.
Impact on adoption: high, and structural rather than a bug. FieldOps' stated requirement "completing
a work order must decrement stock transactionally and fail the whole operation if stock is
insufficient" spans Field (WorkOrder) and Inventory (Part). To express it I had to **collapse
Inventory into Field**. Repeat that a few times and the bounded-context decomposition — the thing the
DSL is named after — erodes into one mega-context. A buyer should assume Loom's real consistency
boundary is the *context*, not the aggregate, and design contexts accordingly from day one.
Time lost: 40 min.

> **CORRECTION (2026-09-13, fleet re-verification — this is WORSE than filed).** I reported a wrong
> diagnostic on a refusal. There is a second form that is not refused at all: a **read-only**
> cross-context body (`let x = Foos.getById(f)` with no subsequent mutating call) validates
> `0 error(s), 0 warning(s)` and then emits a **dangling receiver on all five backends** — the
> repository is never injected and the generated code references a name that does not exist. The
> refusal I hit is triggered by the *use* of the binding, not by the cross-context read itself; drop
> the use and the whole thing goes silent. Root cause: `src/ir/lower/lower-workflow.ts:96-103` builds
> `reposByName` from the enclosing context only, and a miss yields no binding rather than a
> diagnostic.
> Compounding it: `docs/domain-services.md:130` tells the reader that cross-context orchestration
> *"belongs in workflows"* — pointing at the one construct that cannot do it.
> **Reclassify: SILENT (read-only form) + HONEST-but-misdirecting (mutating form).** Severity S2 holds
> for the refusal; the silent form is S1 by the register's own rubric (generated code does not compile).

### F-046 — `auditable` without `auth:` emits an unbound `current_user` — the whole Elixir project fails to compile
Severity: **S1** (generated backend does not build)   Class: **SILENT**
Area: ir/lower + ir/validate (shared) → every backend emitter (symptom)
Found: 2026-09-13, while verifying the wave-0 fixes. **Not one of the original 45.**
**Scope: all five backends**, measured — the same 10-line model on each:

| target | emitted | verified |
|---|---|---|
| **elixir** | `put_change(:created_by, current_user)` in a 1-arity `insert/1` | `mix compile` → `** (CompileError) undefined variable "current_user"` ×3 |
| **node** | `createdBy: currentUser` (`db/audit-stamp.ts:10`) | `tsc --noEmit` → `TS2304: Cannot find name 'currentUser'` ×3 |
| **dotnet** | `.CurrentValue = currentUser` (`AuditableInterceptor.cs:42`) | source-evidenced (CS0103); not compiled |
| **python** | `self._created_by = currentUser` (`domain/foo.py:72`) | source-evidenced — a **`NameError` at request time**, not a build error |
| **java** | `@CreatedDate @Column(name="created_by") UserId createdBy;` | **two defects**: `UserId` is emitted by no file in the tree (`grep -rn "class UserId\|record UserId"` → empty ⇒ `cannot find symbol`), and the principal field carries `@CreatedDate` (the *timestamp* annotation) rather than `@CreatedBy` |

Repro (`/tmp/w0/elx-aud-noauth.ddd`, 10 lines) — one aggregate `with crudish, auditable`, on a
`platform: elixir` deployable with **no `user { }` block and no `auth:` clause**:
```
$ node bin/cli.js parse …                → 0 error(s), 0 warning(s).
$ node bin/cli.js generate system …      → Wrote 60 file(s)
$ mix compile --force --warnings-as-errors
    error: undefined variable "current_user"      (×3)
== Compilation error in file lib/api/c/foo_repository.ex ==
** (CompileError) cannot compile module Api.C.FooRepository (errors have been logged)
```
Emitted:
```elixir
def insert(attrs) when is_map(attrs) do          # ← arity 1: no current_user parameter
  ...
  |> Ecto.Changeset.put_change(:created_by, current_user)   # ← never bound
```
With `auth: required` + a `user { }` block the same model is correct
(`def insert(attrs, current_user \\ nil)` and `current_user && current_user.id`), so this is
specifically the **no-principal** case.

**Root cause — one level up from the emitter, and it is the interesting part.** Without a `user { }`
block, `currentUser` lowers to `{"kind":"ref","name":"currentUser","refKind":"unknown"}` instead of
`refKind:"current-user"` (dumped from `buildLoomModel`; with auth the same field lowers to
`refKind:"current-user"`). Two things follow from that one word:
1. `exprUsesCurrentUser()` returns **false**, so `validateStampSupport`
   (`src/ir/validate/checks/principal-guard-checks.ts:76`) never raises
   **`loom.stamp-principal-without-auth`** — the gate whose existence **three backends cite in
   comments as their upstream guarantee** (`dotnet/emit/auditable-interceptor.tpl.ts:32,73,175`,
   `java/emit/entity.ts:366`, `dotnet/index.ts:1620`).
2. The elixir `renderStampValue` (`vanilla/stamp-emit.ts:102-124`) tests for exactly those two
   principal shapes, misses both, and falls through to a plain `renderExpr` — which renders the
   bare identifier.

**Why no gate caught it, precisely.** `test/generator/dotnet/dotnet-stamping.test.ts` *does* carry a
case named "gates a currentUser stamp on a dotnet deployable WITHOUT auth fail-fast", and it passes.
It builds its model from a **hand-written context-level `stamp onCreate { createdBy := currentUser }`**
in a system that still declares `user { }`, and only strips `auth: required` from the deployable. The
**macro-injected** spelling — `with auditable` in a system with no `user { }` block at all — takes a
different lowering path and has never been handed to the gate. A hand-written `currentUser` read in a
find filter *is* refused today; the same read injected by a prelude capability is not.
Reach, not power — the same shape as F-025, F-030, F-033 and F-035.

Correct fix is upstream and single-site (lower `currentUser` to `refKind:"current-user"`
unconditionally, so the existing gate refuses the model with its existing message), **not** a
per-backend patch to `renderStampValue` — which would paper over a missing refusal by stamping nil.
Planned as slice 2; see `FIX-PLAN.md` §3.8.

### F-010 — Deny-by-default forces you to write the exact construct the linter deprecates
Severity: S3 (friction)   Class: HONEST (two rules, both documented, that contradict each other)
Area: auth × repository lint
Claims under test:
 · docs/auth.md:42 — "The auto-injected `find all` list route … is out of default-deny scope.
   **Declaring an explicit `find all(): T[] requires <expr>` gates that route**"
 · docs/language.md:1318 — "**List finds warn.** A `find` returning a collection (`T[]` / `T paged`)
   is flagged `loom.repository-find-deprecated`"

Repro: `eval/fieldops/main.ddd` — 10 of my 10 warnings are this, one per gated list read:
```
0 error(s), 10 warning(s).
…main.ddd:273:14 warning: repository find 'all' is a wire-shaped list query — pass a criterion to
'run' … instead of accreting a bespoke list finder on the repository.
```
Observed: to secure the list route under the *recommended* posture you must declare `find all()`,
which the linter then tells you not to do. There is no spelling that satisfies both.
Workaround: none. You learn to ignore your own warning output, which is how real warnings get missed.
Impact on adoption: low technically, corrosive in practice — a build whose baseline is 10 warnings
trains the team to stop reading warnings.
Time lost: 10 min.

### F-011 — Codegen CRASHES with a Node stack trace on a page `requires` gate that names a permission
Severity: S2 (major)   Class: **crash where a diagnostic belongs** (validator says OK, generator throws)
Area: generator / react / page gates
Claim under test: docs/auth.md §"UI gate — `page { requires <expr> }`" — "A `page` carries the same
`requires <expr>` clause … the generated page evaluates the gate client-side against the verified
session claims"; §"Permissions surface" — "`permissions.ordersCancel` … lowers to a plain string
literal … the runtime is `string[].includes(string)` either side of the wire."

Repro: `eval/repro/page-gate-permissions.ddd` (24 lines)
```
page Secret { route: "/secret"  requires currentUser.permissions.contains(permissions.read)
              body: Heading { "Top secret" } }
```
```
$ node bin/cli.js parse    eval/repro/page-gate-permissions.ddd   → 0 error(s), 0 warning(s).  OK
$ node bin/cli.js generate system eval/repro/page-gate-permissions.ddd -o /tmp/out-pgp
Error: UI gate: reference 'permissions' (unknown) is not evaluable client-side — a gate may only
touch currentUser and constants.
    at renderGateExpr (out/generator/_frontend/gate-expr.js:37:19)
    at renderPageGate (out/generator/react/walker/page-shell.js:551:24)
    at emitPagesForUi (out/generator/react/pages-emitter.js:252:33)
EXIT=1
```
Observed: **no `loom.*` code, no source line, no file/column** — a raw stack trace into the compiler's
own `out/` directory. Nothing is written; the whole system fails to generate. And the message is
wrong on its face: `permissions.read` *is* a constant (it lowers to `"s.read"` on every backend), and
the gate *is* currentUser-only.
Expected: it works (it works identically on the backend), or a `loom.*` validation error at parse
time pointing at the page.
Workaround: express the page gate as a role test (`currentUser.role == "dispatcher"`) and lose the
permission model on the client. This is what I did in FieldOps.
Impact on adoption: high. The permission catalogue with `implies` is the model's main authorization
primitive; you simply cannot use it to gate a page. Worse, the failure arrives at *generate* time on
a model that passed validation — so it would land in CI, not in the editor. Any crash that a validator
did not predict is a class problem: it means the "validated before emission" guarantee has holes.
Time lost: 25 min.

### F-012 — Codegen CRASHES on an e2e test naming a multi-word aggregate when a second backend deployable exists
Severity: S2 (major)   Class: **crash where a diagnostic belongs** (validator says OK, generator throws)
Area: system / e2e multi-backend replay
Claim under test: docs/language.md §"End-to-end tests against a deployable" — "every `test e2e` block
replays against each backend serving the referenced module"; README — "Generated end-to-end tests
against the live stack — the same DSL test runs against whichever runtime you point it at."

Repro: `eval/repro/e2e-multiword-slug.ddd` (22 lines) — two backend deployables, one e2e test
```
aggregate WorkOrder with crudish { … }        // two words
test e2e "create a work order" against api { let f = api.workOrders.create({ name: "x" }) … }
```
```
$ node bin/cli.js parse …        → 0 error(s), 0 warning(s).  OK
$ node bin/cli.js generate system eval/repro/e2e-multiword-slug.ddd -o /tmp/out-ems
Error: e2e: unknown aggregate 'api.workOrders' on this deployable. Available aggregates: bars.
    at renderApiCall (out/system/e2e-render.js:612:15)
```
**Control** (`eval/repro/e2e-two-deployables.ddd`, byte-identical except `WorkOrder`→`Foo`): `Wrote 71 file(s)`.
Observed: the replay's compatibility filter resolves a referenced aggregate slug back to its owning
context; `workOrders` does not resolve (`foos` does), so `requiredContexts` comes back empty, **every**
backend is deemed compatible, and rendering the test against the unrelated `other`/`notifier`
deployable throws. Raw stack trace, no `loom.*` code, no source line, nothing written.
Expected: the slug resolves; or at worst a diagnostic naming the test and the incompatible deployable.
Workaround: none that keeps the model. You must drop the second backend deployable, or drop the e2e
tests, or rename every multi-word aggregate. I split FieldOps into two files to keep working:
`eval/fieldops/main.ddd` (e2e tests, no notifier) and `eval/fieldops/with-notifier.ddd`
(cross-deployable channel eventing, no e2e tests).
Impact on adoption: high and near-universal. Multi-word aggregate names (`WorkOrder`, `PurchaseOrder`,
`LineItem`) are the norm, and a second deployable is the whole point of the systems layer. Together
they take out the in-model e2e suite — one of the headline quality claims.
Time lost: 45 min (including building four wrong minimal repros before finding the discriminator).

---
## The generated code does not compile — three independent SILENT defects

All three were found by running `tsc --noEmit` on the output of a model that `ddd parse` and
`ddd generate system` both accepted with **exit code 0**. None produced any diagnostic.

### F-013 — `!=` in a projection/criterion `where` emits `ne(...)` without importing it
Severity: **S1** (generated output does not compile)   Class: **SILENT**
Area: generator / node (Hono + Drizzle) / repository emitter
Claim under test: README — "walk away with real, owned source code"; docs/technical.md — "validated
before emission".

Repro: `eval/repro/ne-import-missing.ddd` (20 lines)
```
projection OpenCount { st: St  tickets: int
  from Ticket as t  where t.st != Closed  group by t.st
  select st = t.st, tickets = count() }
```
```
$ node bin/cli.js parse eval/repro/ne-import-missing.ddd        → OK
$ node bin/cli.js generate system … -o /tmp/out-ne              → Wrote 43 file(s)
$ cd /tmp/out-ne/api && npm install && npx tsc --noEmit
db/repositories/ticket-repository.ts(99,72): error TS2304: Cannot find name 'ne'.
```
The emitted file opens `import { and, asc, count, desc, eq, inArray } from "drizzle-orm";` — the
import set is computed without walking the `!=` arm.
Expected: compiles.
Workaround: hand-edit the generated import — which the next `ddd generate` overwrites (see F-024).
Impact on adoption: `!=` in a filter is ordinary. Any model with one gets a backend that will not
build. This is the exact failure mode a buyer must assume exists elsewhere: the toolchain's own
per-PR gates typecheck the *frontend* and compile the example corpus, so a construct outside that
corpus can ship broken.
Time lost: 20 min.

### F-014 — A find comparing an FK against a NULLABLE user claim emits uncompilable Drizzle
Severity: **S1** (generated output does not compile)   Class: **SILENT**
Area: generator / node / row-level visibility (`currentUser` in a find `where`)
Claim under test: docs/auth.md §"Row-level visibility (slice 1C)" — "`currentUser` is admissible
inside repository find `where` clauses; the renderer threads the resolved User through the generated
method as a closure-captured parameter."

Repro: `eval/repro/nullable-claim-find.ddd` (18 lines)
```
user { id: string  technicianId: Technician id? }
find mine(): WorkOrder[] requires true where this.technicianId == currentUser.technicianId
```
```
db/repositories/workOrder-repository.ts(99,75): error TS2769: No overload matches this call.
  Argument of type 'TechnicianId | null' is not assignable to parameter of type 'string | SQLWrapper'.
```
Observed: `eq(schema.workOrders.technicianId, currentUser.technicianId)` — Drizzle's `eq` rejects a
nullable right-hand side.
Expected: compiles (and semantically: a null claim should match no rows, the way the tenancy claim's
parse-to-null accessor already does — docs/tenancy.md documents exactly that discipline for the
tenant claim, so the machinery exists; it is just not applied to ordinary claims).
Workaround: declare the claim non-optional (`technicianId: Technician id`), which is wrong — most
principals are not technicians — or drop row-level visibility.
Impact on adoption: this IS the spec requirement "a technician sees only their own work orders". An
optional principal claim is the normal shape for any role-dependent identity claim.
Time lost: 20 min.

### F-015 — A workflow calling an aggregate `function` emits a call to a `private` method
Severity: **S1** (generated output does not compile)   Class: **SILENT**
Area: generator / node / workflow emitter × aggregate `function` visibility
Claim under test: docs/workflow.md — "`name.opName(args)` Invoke a public operation on a let-bound
aggregate"; docs/language.md — "`function name(params): TypeRef = Expression` Pure helper
(expression form); **callable from any expression in the same aggregate**."

Repro: `eval/repro/workflow-calls-function.ddd` (24 lines)
```
aggregate Tech { … function hasSkill(s: string): bool = skills.contains(s) }
workflow give transactional { create(...) { let t = Techs.getById(tech)   precondition t.hasSkill(skill) … } }
```
```
http/workflows.ts(56,17): error TS2341: Property 'hasSkill' is private and only accessible within class 'Tech'.
```
Observed: the aggregate emits `private hasSkill(...)`; the workflow handler calls it from module
scope. The validator accepts the call (it is a legal expression over a let-bound aggregate); the
emitter produces code TypeScript rejects.
Expected: either the function is emitted public when a workflow calls it, or the validator rejects
the call with a `loom.*` code pointing at `derived` as the public alternative.
Workaround: promote the helper to `derived` (loses parameters), or inline the predicate into the
workflow body (loses reuse and drops it out of the aggregate's own invariants).
Impact on adoption: cross-aggregate business rules are exactly what workflows are for, and factoring
the predicate onto the aggregate that owns the data is exactly what you should do. FieldOps'
skill-matching rule — a stated requirement — hits this.
Time lost: 15 min.

### F-016 — An operation named with a JavaScript reserved word emits `const void = …` (invalid TSX)
Severity: **S1** (generated output does not compile)   Class: **SILENT**
Area: generator / react / scaffolded detail page
Claim under test: README — "Generated UI pages (list, detail, create) with a modal-form button per
public operation."

Repro: `eval/repro/reserved-word-op.ddd` (18 lines) — `operation void() when st == Draft { st := Void }`
```
$ node bin/cli.js parse … → OK ;  generate → Wrote 75 file(s)
$ grep -n 'const void' /tmp/out-reserved-word-op/web/src/pages/invoices/detail.tsx
104:  const void = useVoidInvoice(id ?? "");
137:  … onClick={() => openVoidModal(void)} …
$ npx tsc --noEmit   (on my FieldOps output, same construct)
src/pages/invoices/detail.tsx(140,9):  error TS1389: 'void' is not allowed as a variable declaration name.
src/pages/invoices/detail.tsx(140,14): error TS1109: Expression expected.
src/pages/invoices/detail.tsx(186,72): error TS1109: Expression expected.
```
Observed: the operation name is used verbatim as a JS identifier with no reserved-word escaping. The
`.ddd` side is fine — `void` is a perfectly good domain verb ("void an invoice"), and the DSL accepts
it. Presumably the same for `delete`, `new`, `class`, `import`, `return`, `default`, `in`, `typeof`…
Expected: the emitter mangles the identifier (`void_`, `opVoid`), or the validator rejects the name.
Workaround: rename the domain operation to avoid the host language's keyword list — i.e. let
TypeScript's grammar dictate your ubiquitous language. I renamed `void` → `cancelInvoice`.
Impact on adoption: moderate frequency, total when hit (the whole frontend fails to build), and the
fix is a domain rename. It also reveals that the frontend emitter does no identifier hygiene, so the
blast radius is unknown without auditing the whole reserved-word list.
Time lost: 15 min.

### F-017 — The `Chart` primitive emits a triple brace `yAxisProps={{{ … }}` (invalid JSX)
Severity: **S1** (generated output does not compile)   Class: **SILENT**
Area: generator / react / walker / `Chart`
Claim under test: docs/page-metamodel.md §9 — "`Chart { of:, kind:, x:, y: }` Line / bar series over a
**grouped** query-time `projection` … **Ships on every frontend**, LiveView included."

Repro: `eval/repro/chart-triple-brace.ddd` (28 lines) — one grouped projection + one `Chart`
```
$ grep -o 'yAxisProps={{{.*' /tmp/out-chart-triple-brace/web/src/pages/dash.tsx
yAxisProps={{{ allowDecimals: !((byStatus.data ?? []).every((r) => Number.isInteger(Number(r.tickets)))) }} />
```
```
src/pages/ops_dashboard.tsx(28,196): error TS1136: Property assignment expected.
src/pages/ops_dashboard.tsx(28,198): error TS1005: '...' expected.
src/pages/ops_dashboard.tsx(28,252): error TS1382: Unexpected token. Did you mean `{'>'}` or `&gt;`?
```
Observed: three opening braces, two closing. The attribute is unparseable; the page, and therefore
the whole frontend bundle, fails to build.
Expected: `yAxisProps={{ … }}`.
Workaround: delete the `Chart` from the page (what I did) or hand-fix the brace after every
regeneration.
Impact on adoption: `Chart` is the only charting primitive in the closed component library, so a
dashboard — the FieldOps spec's reporting requirement — cannot be built on the React target at all.
That this ships at all suggests the React `Chart` renderer has no compile-level test behind it.
Time lost: 10 min.

### F-018 — Declaring `find all(): T[]` silently breaks every scaffolded reference picker
Severity: **S1** (generated frontend does not compile)   Class: **SILENT**, with a forcing function
Area: generator / react / scaffolded create + detail pages × repository list shape
Claim under test: docs/auth.md:42 — "Declaring an explicit `find all(): T[] requires <expr>` gates
that route" (the ONLY way to secure the list read under deny-by-default) · README — "No drift between
layers."

Repro: `eval/repro/paged-vs-array-picker.ddd` (17 lines) — `Customer`, `Site` with `Site.customerId`,
one explicit `find all(): Customer[] requires true`
```
$ npx tsc --noEmit   # in /tmp/out-pvp/web
src/pages/sites/new.tsx(48,177):    error TS2339: Property 'items' does not exist on type
                                    '{ id: string; name: string; version: number; display: string; }[]'.
src/pages/sites/detail.tsx(50,179): error TS2339: (same)
```
**Control**: delete that one `find all` line (`/tmp/ctl2.ddd`) → `tsc --noEmit` is clean.
Observed: the scaffolded FK picker always emits `(…data ?? []).items ?? []`, i.e. it assumes the
**paged envelope** that the auto-injected `find all` returns. An author-declared `find all(): T[]`
returns a bare array, and the picker is emitted against it unchanged. Nothing checks the two agree.
Expected: the picker adapts to the declared return shape, or `loom.*` rejects the mismatch.
Workaround: declare `find all(): T paged` instead — undocumented as a requirement; I found it by
diffing against the control. Note the docs' own deny-by-default instruction tells you to write the
broken form.
Impact on adoption: **this is the interaction that would have burned us.** Follow the recommended
security posture → you must declare `find all(): T[]` → every create form and every detail page that
references another aggregate fails to compile. In FieldOps that was 8 of 14 scaffolded pages. The two
rules are documented, individually correct, and jointly fatal; nothing in the toolchain connects them.
Time lost: 30 min.

### F-019 — A `ui` that scaffolds a subdomain its target backend does not host emits uncompilable pages
Severity: **S1** (generated frontend does not compile)   Class: **SILENT** (a documented validator gate that does not fire)
Area: generator / react / scaffold × deployable topology
Claim under test: docs/page-metamodel.md §3 "Validator obligations" — "**Every `scaffold` selector and
every page-data binding inside the `ui` must resolve to a subdomain reachable through the deployable's
`targets` chain.**"

Repro: `eval/repro/ui-scaffolds-unserved-subdomain.ddd` (15 lines) — `ui Web with scaffold(subdomains: [A, B])`,
`deployable api` hosts only `A`
```
$ node bin/cli.js parse … → 0 error(s), 0 warning(s).  OK       ← the documented gate never fires
$ generate → Wrote 81 file(s)
$ ls /tmp/out-usu/web/src/api/  →  client.ts  config.ts  foo.ts     ← no bar.ts
$ ls /tmp/out-usu/web/src/pages/ →  bars  foos  home.tsx           ← but bars/ pages exist
$ npx tsc --noEmit
src/pages/bars/detail.tsx(21,73): error TS18050: The value 'undefined' cannot be used here.   (×5)
```
Observed: pages are scaffolded for the unserved aggregate; the api client for it is not generated; the
pages reference `undefined`. The stated validator obligation is not implemented.
Expected: the documented error.
Workaround: keep the `scaffold(subdomains: […])` list exactly in sync with the target deployable's
`contexts:` by hand — which is precisely the cross-layer drift the product claims to eliminate.
Impact on adoption: high for any multi-deployable system, which is the systems layer's whole purpose.
I hit it the moment I split a notifier out of the main API.
Time lost: 20 min.

### F-020 — Generated `docker-compose.yml` references `minio/minio:latest`, which no longer exists on Docker Hub
Severity: **S2** (the whole generated stack fails to start)   Class: **SILENT** (generate exits 0; compose fails)
Area: system / docker-compose emission · object-store sidecar
Claim under test: README — "`ddd generate system acme.ddd -o ./out` → runnable multi-project tree +
`docker-compose.yml` … `docker compose up -d` → everything running."

Repro: any model with `storage photos { type: s3, … }` + `resource … kind: objectStore` (FieldOps:
`eval/fieldops/main.ddd`)
```
$ docker compose up -d --build
Error response from daemon: pull access denied for minio/minio, repository does not exist or may
require 'docker login'
```
Controls:
```
$ docker pull quay.io/minio/minio:latest   → Status: Downloaded newer image      (the live home)
$ docker pull axllent/mailpit:latest       → Status: Downloaded newer image      (Docker Hub works)
```
Observed: MinIO delisted the Docker Hub repository; the emitter still points there. `docker compose up`
aborts before any service starts, so a model that generates and compiles cleanly still has no stack.
Expected: `quay.io/minio/minio:<pinned tag>`.
Workaround: edit the generated compose (overwritten on regenerate), or add a compose override file.
Impact on adoption: total for anyone using file upload (`File` fields / `FileUpload`), which is a
documented, advertised feature — and it fails at the last step, after a successful build.
Secondary observation: the emitter pins `postgres:18-alpine`, `valkey/valkey:8-alpine`,
`quay.io/keycloak/keycloak:26.0` but uses **`:latest`** for `minio` and `mailpit` — unpinned images in
generated infrastructure is something we would flag in review regardless.
Time lost: 10 min.

### F-021 — The documented `x-loom-dev-claims` example does not work (docs say raw JSON; the code wants base64)
Severity: S3 (friction)   Class: CONTRADICTED doc
Area: docs/auth.md §"Dev-stub verifier"
Claim under test: docs/auth.md:975 —
```
curl -H 'x-loom-dev-claims: {"id":"u-1","role":"manager","tenantId":"t-1"}' http://localhost:8080/api/orders
```
Repro (FieldOps dev-auth build, `eval/out-devauth`):
```
$ curl -H 'x-loom-dev-claims: {"id":"u-a",...,"tenantId":"TENANT-A"}' localhost:3100/api/auth/me
{"id":"admin","email":"admin","role":"admin","permissions":[],"tenantId":"admin","technicianId":null}   ← header ignored
$ curl -H "x-loom-dev-claims: $(base64 <<<'{"id":"u-a",...}')" localhost:3100/api/auth/me
{"id":"u-a","email":"a@x","role":"admin","permissions":[...],"tenantId":"TENANT-A",...}                 ← works
```
The generated code says so plainly (`api/auth/dev-stub.ts:9`: "base64-encoded JSON object in
`x-loom-dev-claims`"); only the doc is wrong.
Observed: the raw-JSON form is silently ignored and you get the built-in identity — which *looks*
like a working call, so you can spend a while concluding your gates are broken.
Impact on adoption: small in time, but it is the first thing anyone does to test authorization, and
the failure mode is a false pass rather than an error.
Time lost: 10 min.

### F-022 — The auto-provisioned Keycloak realm carries none of the claims the `user { … }` block declares
Severity: S2 (major)   Class: **HONEST-ish gap, undocumented** — the generated dev IdP cannot exercise the generated authorization model
Area: system / OIDC dev sidecar
Claim under test: README — "`docker compose up -d` → everything running"; docs/auth.md — the OIDC path
"maps `string[]` claims (a `realm_access.roles`-shaped list) from the verified token."

Repro: FieldOps (`eval/out-node`), `user { id, email, role, permissions: string[], tenantId, technicianId }`
```
$ TOK=$(… password grant against the generated realm …)
$ curl -H "Authorization: Bearer $TOK" localhost:3000/api/auth/me
{"id":"bd28…","email":"demo@example.com","role":null,"permissions":[],"tenantId":null,"technicianId":null}
$ curl -H "Authorization: Bearer $TOK" -XPOST … /api/customers
403 Forbidden: currentUser.permissions.contains(permissions.workOrderWrite)
```
Observed: `generate system` emits a Keycloak sidecar **and** a realm import (`keycloak/realm.json`) —
a genuinely nice touch — but the realm has one demo user, no attributes, and **no protocol mappers for
the declared claims**. So the out-of-the-box OIDC stack authenticates and then denies everything:
`tenantId` is null (no tenant → no rows), `permissions` is empty (every gate 403).
Expected: the realm import seeds a mapper per declared `user { … }` field, and at least one demo user
per tenant, so the stack demonstrates its own authorization model.
Workaround: hand-configure Keycloak (users, attributes, three protocol mappers) through the admin API.
I spent 35 minutes on this and still could not get a password-grant token for a hand-created user
("Account is not fully set up"); I fell back to a second build with the dev-stub verifier.
Impact on adoption: you cannot demo or smoke-test tenancy/permissions on the generated stack without
becoming a Keycloak admin first. For a product whose headline B2B feature is multi-tenant isolation,
the shipped dev environment cannot show it working.
Time lost: 35 min.

### F-023 — Optimistic concurrency is off by default, and the generated frontend never sends the precondition
Severity: **S2** (lost updates in the generated UI)   Class: **SILENT** + doc mismatch
Area: generator / node route emitter × react api client
Claim under test: docs/language.md §"Field access modifiers" — "`token` … In `update(...)` input:
**sent as an optimistic-concurrency *precondition*** (like `id`/`version`)"; and the aggregate's
synthetic `version` is `token` by construction.

Repro (FieldOps dev-auth stack, `eval/out-devauth`):
```
# no precondition header — two updates from the same read both succeed (lost update)
upd1=204   upd2(stale)=204

# with the header, the mechanism works correctly
curl -H 'If-Match: 1' … /customers/{id}/update   → 204
curl -H 'If-Match: 1' … /customers/{id}/update   → 409     ✅
```
And:
```
$ grep -rn 'If-Match\|if-match' web/src/ | wc -l
0
```
Observed: the guard is an **`If-Match` header**, not the body `version` the access-modifier matrix
describes, and `parseIfMatch(ifMatch, aggregate.version)` **defaults to the row's current version**
when the header is absent — so a client that doesn't opt in gets last-write-wins. The generated React
client never sends it. So every edit through the generated UI is a potential lost update, silently.
Expected: the generated frontend round-trips the version it read (it has it — `version` is in every
read DTO), or the server rejects an update with no precondition.
Workaround: hand-edit the generated api client (clobbered on regenerate), or accept lost updates.
Impact on adoption: a two-dispatcher race on the same work order silently discards one edit. For a
field-service product with concurrent dispatchers this is a correctness bug in the shipped UI, and
nothing in the model can express "require the precondition".
Time lost: 20 min.

### F-024 — The generated OIDC login flow fails against the generated Keycloak realm (`offline_access` not granted), and then redirects to a 404
Severity: **S1** (the advertised auth flow does not work out of the box)   Class: **SILENT** — nothing warns; the browser just shows `{"error":"token_exchange_failed"}`
Area: system / OIDC handshake × generated realm import
Claim under test: docs/auth.md §"Session depth (PKCE + refresh rotation)" — "**PKCE (RFC 7636),
unconditional** … **Refresh rotation** — the handshake requests the `offline_access` scope …
Emitted identically across all five backends"; README — "`docker compose up -d` → everything running."

Repro: FieldOps with `auth { oidc { … } }` (`eval/fieldops/main.ddd`, stack in `eval/out-node`),
driven in a real browser (Playwright/Chromium):
```
/customers → "Sign in" → 302 /api/auth/login → Keycloak login (demo/demo) →
GET http://localhost:3000/api/auth/callback?state=… → 401  {"error":"token_exchange_failed"}
```
Keycloak's own event log names the cause:
```
type="CODE_TO_TOKEN_ERROR" clientId="field_ops-app" error="not_allowed"
reason="Offline tokens not allowed for the user or client" grant_type="authorization_code"
```
**Proof of causation** — granting the role and repeating the identical browser flow:
```
POST /admin/realms/field_ops/users/<demo>/role-mappings/realm  [offline_access]   → 204
… login again → token exchange SUCCEEDS
```
The generated handshake hard-codes `const SCOPES = "openid offline_access";`
(`api/auth/handshake.ts:8`) while the generated `keycloak/realm.json` grants the demo user only
`["user","agent"]`. The two halves are emitted by the same tool and disagree.

**Second defect, revealed once the first is fixed**: the post-login redirect is
`const POST_LOGIN = process.env.OIDC_POST_LOGIN_REDIRECT ?? "/";` and the generated
`docker-compose.yml` never sets `OIDC_POST_LOGIN_REDIRECT`. The callback runs on the **API** origin,
so a successful login lands the user on `http://localhost:3000/` — the API root:
```
{"type":"about:blank","title":"Not Found","status":404,"detail":"no route for GET /","instance":"/"}
```
not the SPA on :3001.
Expected: log in, land in the app.
Workaround: grant `offline_access` in the realm (or drop the scope) **and** set
`OIDC_POST_LOGIN_REDIRECT=http://localhost:3001/` in compose. Both are outside the model.
Impact on adoption: the single most visible end-to-end path in the product — "log in to the generated
app" — is broken on the stack the tool itself emits. Everything behind it (the `auth: ui` guard,
row-level reads, masked fields in the UI) is unreachable until you fix two files by hand.
Time lost: 50 min.

---
## Cross-backend: the same model, five backends

### F-025 — `.NET`: the channel transport emits an unqualified namespace that cannot resolve
Severity: **S1** (generated C# does not compile)   Class: **SILENT**
Area: generator / dotnet / channels
Repro: `eval/repro/dotnet-channel-namespace.ddd` (17 lines) — one aggregate, one event, one channel,
one `channelSource`, `platform: dotnet`
```
$ node bin/cli.js parse … → OK ;  generate → Wrote 64 file(s)
$ docker run … mcr.microsoft.com/dotnet/sdk:10.0 dotnet build
/src/Infrastructure/Channels/ChannelTransport.cs(239,26): error CS0234: The type or namespace name
'Infrastructure' does not exist in the namespace 'Api.Api' (are you missing an assembly reference?)
/src/Infrastructure/Channels/ChannelTransport.cs(244,13): error CS0234: (same)
Build FAILED.
```
Observed: inside `namespace Api.Infrastructure.Channels;` the emitter writes
`Api.Infrastructure.Events.RealtimeDomainEventDispatcher`. C# resolves `Api` outward and finds the
project's own `Api.Api` namespace (the generated `Api/` controllers folder) first. A `global::`
qualifier is missing.
Expected: `global::Api.Infrastructure.Events.…`.
Workaround: one `sed` on the generated file, re-applied after every regeneration.
Impact on adoption: **any** `platform: dotnet` deployable with a channel fails to build. Since a
`channelSource` is the documented way to get cross-deployable eventing, this takes out the .NET +
broker combination entirely.

### F-026 — F-015 (`private` aggregate function called from a workflow) reproduces on .NET and Python
Severity: **S1**   Class: **SILENT** (and on Python it is a *runtime* failure, not a compile error)
Repro: the same FieldOps model on each backend
```
dotnet: Application/Workflows/ScheduleWorkOrderHandler.cs(49,24):
        error CS0122: 'Technician.HasSkill(string)' is inaccessible due to its protection level
python: app/http/workflows_routes.py:57: error: "Technician" has no attribute "has_skill";
        maybe "_has_skill"?  [attr-defined]   (mypy — `python -m compileall` and `import app.main` both PASS)
node:   http/workflows.ts(56,17): error TS2341: Property 'hasSkill' is private …
```
Observed: this is not a node quirk — it is the same emitter-level decision reproduced on three
backends. On **Python there is no compile gate**, so the defect ships: `POST /workflows/schedule_work_order`
would raise `AttributeError` at request time.
Impact on adoption: raises the severity of F-015 from "a TypeScript error you'd see in CI" to "a 500
in production on the Python target".

### F-027 — `python`: a cross-context `X id` is used in a route without being imported (NameError at request time)
Severity: **S1** (generated service 500s on a core route)   Class: **SILENT** — invisible to `compileall` AND to `import`
Area: generator / python / route emitter
Repro: `eval/repro/python-missing-id-import.ddd` (19 lines) — `aggregate Bar` in context B with
`create(fooId: Foo id, …)` where `Foo` lives in context A
```
$ grep -n 'from app.domain.ids import' /tmp/out-pmi/api/app/http/bar_routes.py
13:from app.domain.ids import BarId                      ← FooId is NOT imported
$ grep -n 'FooId(' /tmp/out-pmi/api/app/http/bar_routes.py
64:    created = Bar.create(foo_id=FooId(body.fooId), tag=body.tag)
```
On FieldOps the same bug hits `POST /api/invoices` (`WorkOrderId`, `CustomerId`).
Evidence that the usual gates miss it:
```
python -m compileall app migrations   → compileall OK
python -c "import app.main"           → import OK
mypy app                              → app/http/invoice_routes.py:106: error: Name "WorkOrderId" is not defined
```
Expected: the import is emitted.
Workaround: hand-add the import after every regeneration.
Impact on adoption: this is the archetype of the dangerous class. A Python deployment passes byte
compilation, passes import, boots, serves `/ready` — and then 500s the first time anyone creates an
invoice. Only `mypy` catches it, and `mypy` is not something the generated project runs by default
(it is in the `dev` dependency group; the Dockerfile builds with `uv sync --no-dev`).

### F-028 — `java`: a repository used only inside an `if let` in a `for` body is never injected
Severity: **S1** (generated Java does not compile)   Class: **SILENT**
Area: generator / java / workflow emitter (dependency collection)
Repro: `eval/repro/java-missing-repo-injection.ddd` (23 lines)
```
$ node bin/cli.js parse … → OK ;  generate → Wrote 79 file(s)
$ grep -n 'public CWorkflows(' …/CWorkflows.java
20:    public CWorkflows(UsageRepository usagesRepository) {          ← PartRepository missing
$ grep -n 'partsRepository' …/CWorkflows.java
30:  var p = partsRepository.runFindAllByPartBySku(u.sku(), null, 1)…   ← used anyway
33:      partsRepository.save(p);
```
and on FieldOps:
```
FieldWorkflows.java:78: error: cannot find symbol   symbol: variable partsRepository
FieldWorkflows.java:82: error: cannot find symbol   symbol: variable partsRepository
```
Observed: the Java emitter's repository-dependency scan does not descend into a nested
`for` → `if let` body, so the constructor omits the repo the body uses. node/.NET/python all handle
the same model.
Expected: the repo is injected.
Workaround: hand-edit the constructor (clobbered on regenerate).
Impact on adoption: any Java deployable whose workflow loads a second aggregate inside a loop. That
is the shape the language itself forces on you for per-child cross-aggregate writes (see F-002), so
it is not an exotic corner.

### F-029 — `elixir`: a `find … where <field> == currentUser.<claim>` emits an unbound Ecto variable
Severity: **S1** (generated Elixir does not compile)   Class: **SILENT**
Area: generator / elixir / repository find (row-level visibility)
Claim under test: docs/auth.md §"Row-level visibility (slice 1C)" — "`currentUser` is admissible
inside repository find `where` clauses; the renderer threads the resolved User through the generated
method as a closure-captured parameter." Backends claimed: "All five backends emit auth files."

Repro: `eval/repro/elixir-currentuser-find.ddd` (15 lines; a NON-optional claim, so this is distinct
from F-014)
```
$ node bin/cli.js parse … → OK ; generate → Wrote 62 file(s)
$ sed -n '79,81p' /tmp/out-ecf/api/lib/api/c/thing_repository.ex
  def mine() do                                                       ← no current_user parameter
    query = from(record in Api.C.Thing, where: record.owner_tag == current_user.owner_tag)
```
On FieldOps:
```
== Compilation error in file lib/api/field/work_order_repository.ex ==
** (Ecto.Query.CompileError) unbound variable `current_user` in query.
   If you are attempting to interpolate a value, use ^var
```
Note the adjacent, compiler-generated tenant filter on the same line pins correctly
(`^(current_user && current_user.tenant_id)`) — so the capability-filter path is right and the
author-written `currentUser` path is not.
**Cross-backend check on the identical model** (`/tmp/cu-*.ddd`): node ✅ `async mine(currentUser: User)`,
python ✅ `async def mine(self, current_user: User)`, dotnet ✅ `Task<List<Thing>> Mine(User currentUser, …)`,
java ✅ SpEL `:#{@currentUserAccessor.user()?.ownerTag()}`, **elixir ✗**.
Impact on adoption: "a technician sees only their own work orders" — a stated FieldOps requirement —
makes the entire Phoenix backend unbuildable. A team that picked Elixir first would discover this the
first time they wrote a row-level rule.

### F-030 — `elixir`: the generated Phoenix project fails `mix compile --warnings-as-errors`, the gate the README claims
Severity: S3 (friction)   Class: **SILENT** (contradicts a stated CI claim)
Area: generator / elixir emitter hygiene
Claim under test: README §Status — "**Opt-in suites** … build and boot the generated stacks against
real toolchains (… `mix compile --warnings-as-errors`)"; "the backends are compiled against real
toolchains — … Phoenix compiled against plain Ecto/Phoenix in an Elixir docker image."

Repro: FieldOps on `platform: elixir` (`eval/matrix/out-be-elixir`), after patching F-029
```
$ mix compile                            → Generated api app        (exit 0)
$ mix compile --force --warnings-as-errors → exit 1
   7 × warning: the underscored variable "__s"/"__d"/"__dt"/"__other" is used after being set
   1 × warning: the following conditional expression will always evaluate to false:  `not true`
       at lib/api_web/controllers/work_order_controller.ex:156  (from a `requires true` gate —
       the documented "intentionally public" escape)
```
Observed: emitter hygiene (`__x` names that are then read) plus the `requires true` escape hatch
lowering to `if not (true) do`. The project compiles, but not under the strictness the README says CI
enforces.
Impact on adoption: low functionally; but it means a team cannot turn on the strict compile flag
their Elixir CI would normally use, and it is a small, checkable contradiction of a README claim.

> **CORRECTION (2026-09-13, after fleet re-verification on fresh `main`).** The **defect is confirmed
> live on both halves** (`__dt`/`__s`/`__d`/`__other` read-after-underscore ×6 from
> `src/generator/elixir/vanilla/context-emit.ts:243`, plus `if not (true)` from `requires true`, which
> Elixir 1.18 reports as a *typing violation*, not a style warning). **But the README claim I filed it
> against is not false.** `elixir-vanilla-build.yml` and `corpus-elixir-build.yml` both genuinely run
> `mix deps.get` + `mix compile --warnings-as-errors` in `hexpm/elixir`. The gate exists and runs; what
> it lacks is a fixture that reaches either site — `grep -rln "requires true" test/fixtures/corpus/`
> → **0 of 68**. Reclassify: **SILENT (uncovered shape)**, not "contradicts a stated CI claim". This is
> the same reach-not-power pattern as F-025, F-033 and F-035 (§5 of `FIX-PLAN.md`).

### F-031 — The Feliz `design:` diagnostic offers a fix that does not parse
Severity: S3 (friction)   Class: HONEST diagnostic with an **invalid fixit**
Area: language / validator vs grammar (feliz design packs)
Repro: `eval/matrix/fe-feliz.ddd` — `deployable web { platform: feliz … design: mantine }`
```
error: Design 'mantine' on Feliz deployable 'web' is not a daisyUI theme. Feliz's 'design:' selects a
daisyUI theme; use one of: light, dark, cupcake, bumblebee, … (32 themes)
```
Follow the advice — `design: dark`:
```
error: Unexpected 'dark'. Expected one of: 'mantine', 'shadcn', 'mui', 'chakra', 'coreComponents' (+9 more).
```
Observed: the validator's suggested vocabulary is not in the grammar. The only way forward is to
delete the `design:` clause entirely (which works).
Impact on adoption: minutes, but it is the kind of thing that erodes trust in diagnostics — and the
diagnostic here is otherwise excellent.

> **CORRECTION (2026-09-13, after fleet re-verification on fresh `main`).** **My diagnosis was wrong;
> the symptom is real.** I reported this as a validator-vs-grammar gap. It is not: `DesignPack`
> (`src/language/ddd.langium:434-435`) ends in `| STRING`, so the **quoted** form `design: "dark"`
> parses and validates clean (`0 error(s), 0 warning(s)`), and `design: "not-a-theme"` correctly
> errors. Only the *bareword* fails. So this is a **one-line message-text bug** — the diagnostic should
> quote its own suggestions — not a grammar change. I never tried the quoted form.
> **One thing got worse, though.** The message at `src/language/validators/deployable.ts:441-449` is an
> inline string literal carrying **no `loom.*` code at all** — so it is invisible to
> `test/system/diagnostic-catalog.test.ts` (which exists precisely to fail on inline literals) *and* to
> `diagnostic-docs-anchors.test.ts`. A codeless diagnostic is outside every gate the repo built for
> diagnostics. That is the finding worth keeping.

### F-032 — `vue`: a nullable `X id` in a scaffolded page breaks `npm run build` (`vue-tsc`)
Severity: **S1** (generated Vue frontend does not build)   Class: **SILENT**
Area: generator / vue / `IdLink`
Repro: `eval/repro/vue-idlink-nullable.ddd` (19 lines) — `assetId: Asset id?` on a scaffolded aggregate
```
$ node bin/cli.js parse … → OK ;  generate → Wrote 84 file(s)
$ cd /tmp/out-vin/web && npm install && npm run build          # = "vue-tsc --noEmit && vite build"
src/pages/work_orders/list.vue(56,22):   error TS2345: Argument of type
  '{ to: string; title: string | null | undefined; }' is not assignable to … RouterLinkProps …
src/pages/work_orders/detail.vue(45,276): error TS2345: (same)
```
Emitted markup: `<router-link :to="…" :title="row.assetId">` where `row.assetId` is optional.
Observed: only the Vue target. The same model builds clean on React (all four packs) and Svelte.
Expected: `:title="row.assetId ?? undefined"`.
Workaround: make the reference non-optional (a domain change) or hand-fix each page.
Impact on adoption: optional foreign keys are ordinary; on FieldOps this produced 6 build errors
across 3 pages. Anyone choosing Vue hits it on their first optional reference.

> **FIXED (2026-09-13) by commit `d8b5f7c1` / PR #2885** — re-verified on fresh `main`: the same repro
> now emits a `v-if`-guarded `<router-link>` via the new `src/generator/_walker/primitives/id-link.ts`,
> and `npm run build` in the generated `web/` exits 0 (`vue-tsc` narrows through the guard). #2885 also
> landed the gate that would have caught it, by adding the missing *shape* — `placedBy: Customer id?`
> — to `test/e2e/generated-vue-build.test.ts`'s scaffold case. That is the correct shape of fix, and
> it is the precedent §5 of `FIX-PLAN.md` generalises.

### F-033 — `angular`: a `string[]` field initialises its form control to `null` → `ng build` fails
Severity: **S1** (generated Angular frontend does not build)   Class: **SILENT**
Area: generator / angular / scaffolded create+update forms
Repro: `eval/repro/angular-string-array-form.ddd` (13 lines) — one aggregate with `skills: string[]`
```
$ generate → Wrote 76 file(s)
$ grep -n skills …/tech-new.component.ts
37: readonly techForm = new FormGroup({ …, skills: new FormControl(null, { nonNullable: true }) });
$ ng build
✘ [ERROR] TS2345: Argument of type '{ fullName: string; skills: null; costRate: string; }' is not
  assignable to parameter of type 'CreateTechnicianRequest'.  Type 'null' is not assignable to 'string[]'.
✘ [ERROR] TS2322: (same, for the update form)
EXIT=1
```
**Compare React**, which handles the same field honestly and builds:
```tsx
defaultValues: { fullName: "", skills: [], … }
<TextInput label="Skills" … disabled placeholder={t("pack.mantine.arrayUnsupported…", "(arrays not yet supported in forms)")} />
```
Observed: array *editing* is a known, deliberately-surfaced gap on React (disabled input + a
translated "not yet supported" placeholder — a good HONEST gap). Angular reproduces the gap as a
`null` initialiser and a plain text input, which is a hard build failure.
Impact on adoption: any `string[]` field (skills, tags, roles) takes out the whole Angular build.

### F-034 — node vs python wire divergence: `decimal` serialisation and validation-message text
Severity: S2 (major for the "identical API contracts" claim; S3 in practice)   Class: **SILENT**
Area: cross-backend wire parity
Claim under test: README — "Pick per deployable. Switch any time. **Identical API contracts**;
idiomatic per-runtime output." · README — "no drift between layers."

Method: the **same** `.ddd` (`eval/fieldops/main-devauth.ddd`) generated onto `platform: node` and
`platform: python`, both booted against Postgres, then driven with one identical probe script
(`/tmp/wireprobe.sh`) — same creates, same reads, same six error paths. Output diffed.
**What matched exactly**: every status code (401/403/404/409/422), the paged envelope keys
(`items,page,pageSize,total,totalPages`), the full `GET /work_orders/{id}` field set and ordering,
money as exact decimal strings (`"50.2500"`, `"100.5000"`), enum spellings, null handling, containment
round-trip, derived fields, audit stamps, tenant 404s, and `mask unless` redaction (`None`/`null`).
That is a genuinely strong result.
**What diverged** (the complete diff, minus uuid/row-count noise):
```
- "quantity": 2        (node)
+ "quantity": 2.0      (python)          ← a `decimal` field: integer vs float JSON token

- {"message": "Billing Email is not in the expected format", "pointer": "/billingEmail"}   (node)
+ {"message": "String should match pattern '^[^@]+@[^@]+\\.[^@]+$'", "pointer": "/billingEmail"} (python)
```
Observed: (a) `decimal` is not byte-stable across backends; (b) the Python backend returns **Pydantic's
raw message instead of Loom's derived text** — so the user-facing string differs per backend, it is
not translatable through the message catalog, and it **echoes the validation regex to the client**.
Impact on adoption: a shared client, a contract test, or a UI that renders `errors[].message` is not
portable across backends. "Identical API contracts" is **partially verified** — identical in shape and
status, not in every value. Sample: 2 of 5 backends, driven at runtime.

> **CORRECTION (2026-09-13, after fleet re-verification on fresh `main`).** This finding has two
> halves and they now part company.
> **(a) `"quantity": 2` vs `2.0` — WITHDRAWN.** Not a defect. The repo has already adjudicated exactly
> this divergence, in prose, at `test/_helpers/wire-record.ts:352`: *"python renders a float64 as
> `10.0` where V8 renders `10` … Same value, well inside float64's width, and no client can tell after
> parsing. Those produced 23 divergences per python run on the first cut of this field — a bill payable
> only in permanent waivers, since neither backend is wrong."* The upstream hydration is equally
> deliberate and symmetric: `src/generator/python/numeric-codec.ts:31` and
> `src/generator/typescript/numeric-codec.ts:40` document the same lossy-`float` split, so node and
> python have **identical precision** and only the JSON spelling differs. No golden in
> `test/behavioral/wire-golden/` carries a `numberFormats` key, confirming the tolerance is active and
> intended. I filed a deliberate, documented tolerance as a defect.
> **(b) the validation-message text — STANDS, and is the whole finding now.** Python emits
> `Field(pattern=r"…")` (`customer_routes.py:50`) and returns pydantic's default message, where node
> emits `.regex(/…/, { message: "Billing Email is not in the expected format" })`. Divergent
> user-facing text, untranslatable through the message catalog, and it echoes the regex to the client.
> Severity for (b) is unchanged. The register's S2 count is unaffected; the *scope* of F-034 narrows.

### F-035 — `dotnet`: two capabilities contributing `onCreate` stamps → one is dropped → every create 500s
Severity: **S1** (runtime; every write fails on a multi-tenant audited aggregate)   Class: **SILENT**
Area: generator / dotnet + java / capability stamp merge
Claim under test: docs/capabilities.md & docs/tenancy.md — "The filter and stamp ride the standard
capability-filter/stamp pipeline — tenancy adds **no bespoke backend code**"; docs/scaffold-macros.md —
`auditable` "adds the four canonical audit fields (`createdAt`, `updatedAt`, `createdBy`, `updatedBy`)
and the context-level stamping rules".

Repro: `eval/repro/dotnet-two-oncreate-stamps.ddd` (18 lines) — `aggregate Thing with tenantOwned, auditable, crudish`
```
// dotnet — Infrastructure/Persistence/AuditableInterceptor.cs
case Thing e:
    if (entry.State == EntityState.Added) {
        …Property(x => x.TenantId).CurrentValue = …CurrentUser!.TenantId;
        …Property(x => x.DataKey ).CurrentValue = …CurrentUser!.OrgPath;
    }                                                     ← CreatedAt / CreatedBy are NOT here
    if (Added || Modified) { …UpdatedAt…; …UpdatedBy…; }   ← the update stamps survive

// java — Thing.java
@PrePersist void _stampOnCreate() {
    var currentUser = CurrentUserAccessor.currentOrNull();
    if (currentUser == null) return;
    this.tenantId = currentUser.tenantId();
    this.dataKey  = currentUser.orgPath();                ← same omission
}
// and the migration the SAME tool emitted:
"created_by" TEXT NOT NULL,
```
**Controls** — the identical model on the other three backends stamps all of them:
```
node   db/audit-stamp.ts: { ...row, tenantId, dataKey, createdAt: new Date(), createdBy: ctx.actorId, updatedAt, updatedBy }
python app/domain/thing.py:85  self._created_by = current_user.id
elixir thing_repository.ex:57  |> put_change(:created_by, current_user && current_user.id)
```
And with `auditable` ALONE (no `tenantOwned`), the .NET interceptor is correct
(`eval/repro/dotnet-auditable-stamp.ddd`) — so it is specifically the **merge of two `onCreate`
contributors** that loses one.
**Observed at runtime** on the booted FieldOps .NET stack (`eval/matrix/out-be-dotnet`, port 3300):
```
POST /api/customers → 500 {"title":"Internal Server Error","detail":"internal"}
server log: Npgsql.PostgresException 23502: null value in column "created_by" of relation
            "customers" violates not-null constraint
```
Expected: both capabilities' stamps are emitted.
Workaround: none in the model. You would hand-edit the interceptor / `@PrePersist` after every
regeneration, on every aggregate.
> **CORRECTION (2026-09-13, after re-verification on fresh `main`).** As filed this finding named
> **.NET and Java**. The .NET half is confirmed and root-caused:
> `src/generator/dotnet/emit/auditable-interceptor.tpl.ts:157-158` uses `.find()` on the stamp-rule
> array, returning the first rule and discarding the rest — while *every* other consumer, including
> the .NET backend's own Dapper adapter (`dotnet/emit/dapper.ts:1041`), uses `.filter().flatMap()`.
> The IR is correct (both `create` rules are present).
> **The Java half was wrong.** `java/emit/entity.ts:381` iterates all rules with a `for…of`, and Java
> does not stamp audit columns in `@PrePersist` at all — it splits them, sending `createdAt`/`createdBy`
> to Spring Data (`@EntityListeners(AuditingEntityListener.class)`, `@CreatedDate`, `@CreatedBy`, wired
> by `config/JpaAuditingConfig.java` with `@EnableJpaAuditing`). The `@PrePersist` carrying only
> `tenantId`/`dataKey` is **correct by design**. I inferred the Java half statically from that
> `@PrePersist` body and never booted Java; that inference was unsound. Severity for .NET is unchanged.

Impact on adoption: **this is the single worst finding in the evaluation.** `tenantOwned + auditable`
is the default shape of every business record in a multi-tenant B2B product — exactly what Loom is
sold for. On .NET and Java the generated service compiles, boots, passes its health check, serves
reads, and then fails **every single write** with an opaque 500. Nothing in the toolchain warns; only
running it finds it.

---
## Evolution (Phase 5)

### F-036 — Changing a `string` field to an `enum` produces no migration and no constraint; out-of-enum legacy data is served as valid
Severity: S2 (major)   Class: **SILENT**
Area: phase-⑨ migration derivation · wire validation
Claim under test: docs/migrations.md — the delta union includes `alterColumnType`; README — "No drift
between layers."

Repro (against the live FieldOps DB with rows):
```
# 1. `currency: string` → `currency: Currency` (enum { EUR, USD, GBP })
$ node bin/cli.js generate system … → 0 error(s). Wrote 16 file(s).
$ ls api/db/migrations/            → NO new migration emitted (both map to TEXT)

# 2. a legacy row holding a value outside the new enum
db=# update field.work_orders set currency='CHF' where id = (select id … limit 1);

# 3. read it back through the API
GET /api/work_orders  →  { "currency": "CHF", … }        ← served as if valid
```
Observed: the column is TEXT before and after, so the diff is empty — correct as a *schema* decision,
but the consequence is that the newly-declared enum is enforced **only on write**, never on read and
never in the database. The generated OpenAPI/Zod declares `currency` as `EUR|USD|GBP`; the service
returns `CHF`. A generated typed client (or a `zod.parse` on the response) breaks on real data.
Expected: at minimum a warning that a widening-to-enum change leaves unvalidated rows; ideally a
`CHECK` constraint or a migration-block requirement to backfill, like the NOT NULL flip already has.
Workaround: write the data audit yourself before the change.
Impact on adoption: this is the one place where the otherwise-excellent migration gate is blind. It
matters because tightening a `string` into an enum is one of the most common schema refinements a
product makes in year two.

### F-037 — Hand edits to generated files are overwritten with no warning and no backup
Severity: S2 (major) — but **DOCUMENTED**   Class: DOCUMENTED limitation
Area: CLI / regeneration contract
Claim under test: README — "**The keys to the codebase** … walk away with real, owned source code";
"All the source you'd write by hand". Against docs/tools.md:203 — "The contract is intentionally
simple: **every file Loom generates is overwritten on every run**."

Repro: patch three generated files (F-013/F-014/F-015), then `ddd generate system` again:
```
Wrote 4 file(s) in eval/out-devauth, unchanged: 171
$ grep -c "EVAL PATCH" api/db/repositories/workOrder-repository.ts   → 0
$ grep -c "EVAL PATCH" api/domain/technician.ts                      → 0
$ grep -c "EVAL PATCH" docker-compose.yml                            → 0
```
No warning, no `.orig`, no diff — the only trace is a file count. I ended up writing
`eval/repatch.sh` to re-apply my patches after every single regeneration.
The sanctioned escape hatch works and is honest:
```
# .loomignore
api/db/repositories/customer-repository.ts
$ ddd generate system … → Wrote 17 file(s), unchanged: 165, skipped (.loomignore): 1   ← edit survived
```
**But pinning transfers ownership of drift to you.** With the file pinned, adding a field to
`Customer` produced:
```
db/repositories/customer-repository.ts(37,42): error TS2345: … Property 'accountNumber' is missing …
```
On node/.NET/Java the compiler catches it. On **Python and Elixir** the same drift is a runtime
failure, because neither has a compile gate over that boundary.
Impact on adoption: **"you own the source" in practice means "you own it until the next
regenerate — unless you pin the file, in which case you own keeping it in sync with the model."**
That is a defensible and clearly documented contract; it is *not* what "the keys to the codebase"
implies to a buyer, and the report should say so in those words.

### F-038 — Generated projects ship no dependency lockfile, and dependencies are caret-ranged
Severity: S2 (major, operational/supply-chain)   Class: **DOCUMENTED** (in a Dockerfile comment only)
Area: system / generated project scaffolding
Repro:
```
$ find /tmp/det1 -name '*lock*' -o -name 'uv.lock' -o -name 'gradle.lockfile'   → (nothing)
$ cat web/package.json | jq .dependencies
{ "react": "^19.2.0", "react-router": "^7.0.0", "zod": "^4.0.0", "@mantine/core": "^9.2.0", … }
$ head api/Dockerfile
# Use plain "npm install" rather than "npm ci": the generator emits no
# package-lock.json so npm ci exits with EUSAGE.
```
Observed: every generated project resolves its dependency graph fresh on every build. Two builds of
the identical `.ddd` a week apart can ship different transitive versions; a compromised or
regressed patch release lands without a review step. The generator KNOWS this (the Dockerfile
comment is explicit) and chose `npm install` over `npm ci`.
Note in contrast: **generation itself is byte-deterministic** — generating the same model twice into
two fresh directories produced `0` differing files. So the non-determinism is entirely in the
dependency layer.
Workaround: commit the generated tree, run `npm install` once, commit the lockfile, and `.loomignore`
it — meaning you now maintain lockfiles by hand per deployable.
Impact on adoption: for a B2B product with any compliance surface (SOC 2, supply-chain attestation,
reproducible builds) this is a blocker until fixed. It is also the difference between "the build
broke because we changed something" and "the build broke because npm did".

### F-039 — No versioning discipline on the toolchain itself
Severity: S2 (major, vendor risk)   Class: observation
Area: project health (pre-Phase-7, from the public repo surface only)
```
$ python3 -c "import json;print(json.load(open('package.json'))['version'])"   → 0.1.0
$ git tag | wc -l                                                              → 0
$ ls CHANGELOG*                                                                → (none)
```
Observed: version `0.1.0`, **zero git tags, no CHANGELOG, no release notes**. There is no way for a
consumer to pin a Loom version, to know what changed between two checkouts, or to be told that a
generated-code behaviour changed. Generated *stacks* are versioned internally (`stacks/v1|v3|vue1|sv1|ng1`)
and backends can be pinned (`platform: "node@v4"`), which is thoughtful — but the toolchain that
drives them is not.
Impact on adoption: you would be pinning a git SHA and hoping. A regeneration after a `git pull`
could change behaviour in your production app with no notice and no diff to read but the output
itself. Mitigable (vendor the toolchain, pin a SHA, gate regeneration in CI) but it must be a
deliberate, funded practice from day one.

---
## Adversarial DX (Phase 6)

### F-040 — Cyclic containment: `parse` says OK, `generate` dies with `RangeError: Maximum call stack size exceeded`
Severity: S2 (major)   Class: **crash where a diagnostic belongs**
Area: generator / typescript / repository-find-builder
Repro: `eval/repro/broken/b05-cyclic-containment.ddd` (10 lines) — a self-containing entity part
(the natural way to model a sub-task tree or a bill of materials)
```ddd
aggregate Node1 with crudish {
  contains kids: Child[]
  entity Child { label: string  contains kids: Child[] }   // Child contains Child
}
```
```
$ node bin/cli.js parse …                  → 0 error(s), 0 warning(s).  OK
$ node bin/cli.js generate system … -o …   → 0 error(s), 0 warning(s).
RangeError: Maximum call stack size exceeded
    at Array.find (<anonymous>)
    at nestedContainLoads (out/generator/typescript/repository-find-builder.js:154:26)
    … (repeats)
```
Expected: `loom.*` rejecting recursive containment ("an entity part may not contain itself; model a
tree as a separate aggregate with a self `X id` reference").
Impact on adoption: moderate frequency, and the failure is a raw stack trace with no source location —
a developer's first guess will be that their machine is broken, not their model.

### F-041 — A typo'd field in a PAGE body is not validated (the same typo in an invariant is)
Severity: S3 (friction)   Class: **SILENT** at the model layer, caught downstream by `tsc`
Area: language / page-body expression validation
Repro: `eval/repro/broken/b09-page-wrong-aggregate.ddd` — `data: o => … KeyValueRow { "Total", o.totl }`
```
$ ddd parse    → 0 error(s), 0 warning(s).  OK
$ ddd generate → Wrote 77 file(s)
$ npx tsc --noEmit
src/pages/bad.tsx(24,87): error TS2551: Property 'totl' does not exist on type
  '{ id: string; total: number; version: number; display: string; }'. Did you mean 'total'?
```
**Contrast**: the identical typo in an `invariant` is caught at parse time with a fixit
(`b02`: "Unknown name 'totl' — did you mean 'total'?").
Observed: the domain expression layer is validated; the page-data-lambda layer is not. On a
TypeScript frontend the compiler catches it. On targets where Loom's emitted code is not compiled
in CI (Flutter/Dart, Feliz/F# — both unverified here) the same class of typo would reach further.
Impact on adoption: modest — but it maps the boundary of the "validated before emission" guarantee,
which is a claim a buyer will lean on.

### Error-quality scorecard (10 deliberately broken models, `eval/repro/broken/`)
| # | mistake | verdict |
|---|---|---|
| 1 | typo'd type name (`dceimal`) | ✅ right line+col; wording leaks the grammar rule name ("NamedDecl") |
| 2 | invariant names a missing field | ✅ **"Unknown name 'totl' — did you mean 'total'?"** |
| 3 | wrong call arity | ✅ "Function 'fee' expects 2 arguments, got 1." |
| 4 | cross-aggregate ref without `id` | ✅ **"…need an id link — write 'Customer id'"** |
| 5 | cyclic containment | ❌ **parse OK → generator stack overflow** (F-040) |
| 6 | duplicate aggregate names | ✅ names the rule and the consequence |
| 7 | unknown enum value | ✅ lists what kinds of name it looked for |
| 8 | `.count` in a `find where` | ✅ **names the entire allowed queryable subset** |
| 9 | typo'd field in a page body | ⚠ not validated; `tsc` catches it (F-041) |
| 10 | `money + decimal` | ✅ **restates the whole closed-arithmetic rule inline** |
**8/10 excellent, 1 crash, 1 validator gap.** Every diagnostic carries a `loom.*`-style code or a
precise `file:line:col`, and several are better than what a hand-written framework would give you.
This is one of the strongest parts of the product.

### F-042 — `ddd trace` cannot resolve a PRODUCTION stack trace: the shipped image is a bundle and runs without source maps
Severity: S3 (friction, operational)   Class: **HONEST** — with an outstanding diagnostic
Area: debugging / `--sourcemap` + `ddd trace` × the generated Dockerfile
Claim under test: docs/debugging.md / README — `ddd trace <logfile>` "translate a runtime stack-trace
back to .ddd source via .loom/sourcemap.json".

What works (verified):
```
$ ddd generate system … --sourcemap        → .loom/sourcemap.json (54 KB, 67 files)
$ ddd breakpoints eval/fieldops/main-devauth.ddd --line 242 --map …/sourcemap.json
eval/fieldops/main-devauth.ddd:242 maps to 3 generated location(s):
  api/domain/workOrder.ts:160:11
  api/domain/workOrder.ts:160:28
# and line 160 is exactly the emitted precondition:
  if (!(this._status !== WorkOrderStatus.Completed)) throw new DomainError("a completed work order cannot be cancelled");
```
That is a real, precise model→code mapping, down to the column.

What doesn't:
```
$ ddd trace /tmp/crash.log --map …/sourcemap.json
ddd trace: no frame matched the sourcemap (0 of 2 stack frame(s)).
  frame files: /app/dist/index.js
  A BUNDLED frame (dist/…, *.min.js, a single-file build) names the bundle, not the generated file
  the map is keyed by. Run the process from the generated sources, or resolve the bundle's own
  source map first (`node --enable-source-maps`), then re-run `ddd trace`.
```
And the generated production image is exactly that case:
```
api/tsup.config.ts  →  entry: ["index.ts"], outDir: "dist", sourcemap: true
api/Dockerfile      →  CMD ["node", "dist/index.js"]        ← no --enable-source-maps, no NODE_OPTIONS
```
Observed: the map that would make this work IS emitted by tsup; the runtime just never enables it.
A one-line `ENV NODE_OPTIONS=--enable-source-maps` in the generated Dockerfile would close the loop.
Expected: production traces resolve to `.ddd` lines out of the box — which is the whole point.
Impact on adoption: "could our engineers debug production with this?" — today, not via `ddd trace`
without changing the generated Dockerfile. The diagnostic is one of the best I have ever read from a
compiler, and it tells you exactly what to do; it is still a missing last mile.

### F-043 — Every link to the "Live site" in the README is 404 (the project moved org and the README didn't)
Severity: S3 (friction) — S2 as a trust signal   Class: **CONTRADICTED** doc
Area: README / docs site
Claim under test: README — "**Live site:** <https://lemmit.github.io/Loc/> — landing, browser
playground (typed editor + visual system builder + live preview + in-browser test runner), and the
full documentation set." · "Open it at <https://lemmit.github.io/Loc/playground/>." · "Full
feature-by-feature comparison: <https://lemmit.github.io/Loc/#compare>."
```
$ curl -o /dev/null -w '%{http_code}' https://lemmit.github.io/Loc/             → 404
$ curl -o /dev/null -w '%{http_code}' https://lemmit.github.io/Loc/playground/  → 404
# the repo's own remote:  https://github.com/Loom-Harness/Loc
$ curl -o /dev/null -w '%{http_code}' https://loom-harness.github.io/Loc/       → 200   ← the real one
```
Observed: the project moved GitHub organisation; the README's three "live site" links were never
updated. A buyer evaluating from the README alone cannot reach the playground, the comparison table,
or the docs site at the advertised address.
Impact on adoption: small to fix, large as a signal — the README is the first artefact anyone reads,
and three of its links are dead. It also means the visual-builder / live-preview / in-browser-test-runner
claims are unverifiable from the advertised channel.

### F-044 — The i18n translator workflow and the generated runtime are not connected
Severity: S2 (major)   Class: **HONEST** in the generated comment, **undocumented** as a gap
Area: i18n · `ddd i18n` × the frontend runtime
Claim under test: README / docs — "the i18n string-catalog layer (`t()` runtime, `msg.<hash>`
validation catalog, `ddd i18n sync`)"; the spec requirement "at least the work-order UI localized
into a second language."

What works:
```
$ ddd i18n extract main.ddd     → Extracted 299 message(s) → .loom/messages.en.json
$ ddd i18n init main.ddd de     → Created locales/de.json — 299 key(s) to translate
                                  Wrote lock locales/.loom/source.lock.json
$ ddd i18n status main.ddd      → de: +0 new, 299 kept
$ ddd i18n check main.ddd --strict ; echo $?   → 1        (a real CI gate)
```
What doesn't:
```
# translate five keys in locales/de.json, then:
$ ddd generate system main.ddd -o /tmp/out-i18n
$ ls /tmp/out-i18n/web/src/locales/
en.json                                   ← de.json is NOT emitted
$ head web/src/i18n.ts
// … To add a locale, drop a `src/locales/<locale>.json` file, import it below,
// and register it in `catalogs`.
const catalogs: Record<string, Catalog> = { en: en as Catalog };
```
Observed: the CLI produces `locales/de.json` **beside the model**; `generate system` never reads it.
To ship a second language you hand-copy the file into `web/src/locales/` and hand-edit the
**generated** `i18n.ts` — which the next `ddd generate` overwrites unless you `.loomignore` it (and
then it stops picking up new keys). The two halves of the feature do not meet.
Expected: `generate system` emits every `locales/*.json` it finds and registers them in `catalogs`.
Workaround: pin `web/src/i18n.ts` and maintain the catalog registration by hand, accepting drift.
Impact on adoption: localisation is a hard requirement for most B2B products sold outside one
country. The expensive part (extraction, hashing, three-way merge, a CI gate) is built and good; the
cheap last mile is missing, and the workaround lands squarely in the clobber-zone.

### F-045 — README says `ddd generate` emits the MIT LICENSE for generated code; it does not
Severity: S3 (friction) — legal-facing   Class: **CONTRADICTED** doc
Area: README vs docs/license-faq.md vs behaviour
Claim under test: README §License — "The **code Loom generates** (everything `ddd generate` writes
into `<outdir>/`) is licensed to you under the **MIT License** — **the CLI emits a `LICENSE` file at
the output-directory root that says so explicitly**."
```
$ node bin/cli.js generate system eval/fieldops/main-devauth.ddd -o /tmp/det1
$ ls /tmp/det1/LICENSE        → No such file or directory
```
`docs/license-faq.md:45` states the truth: "`ddd generate` does **not** write one: it emits build
output into a tree you may have already licensed differently." Only `ddd new` writes it.
Observed: the README and the licence FAQ disagree, and the README is the one procurement will read.
Impact on adoption: zero technically; non-zero in a legal review, where "the artifact carries its own
grant" and "the grant is in a FAQ on a website" are different facts. Easy fix; worth fixing because
the underlying licensing posture (FSL-1.1 generator / MIT output) is actually one of Loom's better
answers to a buyer and deserves not to be muddied.

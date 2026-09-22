# Building "Assure" on Loom — an evaluation

A three-iteration build of a claims platform spanning insurance (policies,
claim adjudication), banking (payouts over a broker), and the shared
multi-tenant/auth layer both need. `main` @ `86628b3f`, 2026-09-22.

The defect register is [`FINDINGS.md`](FINDINGS.md); the models are
`v1/main.ddd` → `v2/main.ddd` → `v3/main.ddd`.

## What I did

| iteration | simulated feedback | what it exercised |
|---|---|---|
| **v1** | — | 2 contexts, 4 aggregates, entity parts, value objects, invariants, operations, events, criteria/retrievals, a scaffolded React portal |
| **v2** | "three insurers are buying it"; "adjusters vs. customers"; "pay the claim"; "the bank team works in Java/.NET" | `tenancy by` + `tenantOwned`, `auth { denyByDefault }` + `permissions`/`policy`/`requires`, a transactional workflow, file attachments on an objectStore, a **second deployable on a second platform**, a bidirectional saga over a RabbitMQ `queue`/`work` channel |
| **v3** | "the adjusters want a workbench"; "rename that field"; "mask the IBAN"; "write the rules down as tests" | a hand-written page with `QueryView`/`Table`/`Stat`, a query-time `projection` + `api`/`serves` handle wiring, a **live schema migration against a database with data in it**, `mask unless`, unit `test` blocks |

The v2 stack was **booted and driven for real**: postgres 18, RabbitMQ 4,
Keycloak 26 with the generated realm, and the generated Hono backend. Two
tenants, real OIDC tokens, the full claim lifecycle, and the migration applied
to a live table.

## The headline

**The generated system is genuinely good when it compiles, and `0 error(s)` is
not yet a reliable predictor that it will.**

Over three iterations the compiler reported `0 error(s)` six times on a model
whose generated output did not typecheck (F-101 … F-106). Every one is the same
shape: *a condition in the emitter that does not match the condition at the
reference site*, in a combination the corpus does not happen to contain — a
workflow **without** a reactor, a projection on a **partial** deployable, an
operation gate reached from a **reactor** rather than a route, an id in a
**`create` argument** rather than an assignment, a call in a **`test`** body
rather than a workflow body, `money.round` on the **frontend** rather than the
backend. In each case the correct behaviour already exists a few lines away, in
the sibling path.

That pattern is the single most actionable thing in this report: the gaps are
not in the features, they are in the **combinations**.

## What genuinely impressed me

These are worth protecting, and several are better than anything I'd expect
from a code generator.

1. **The migration deriver refused to destroy data, and told me the exact
   syntax to fix it.**
   ```
   migration for module "Insurance" drops and adds column(s) on the same table
   that look like an unannotated rename — emitting them as drop+add would
   DESTROY the renamed column's data:
     - claims: drop [description] + add [summary, priority]
   If this is a rename, declare it explicitly so the data is preserved:
     migration "<name>" { <Aggregate>.<oldField> -> <newField> }
   ```
   Declaring it produced exactly the right SQL — `RENAME COLUMN`, an added
   column with a default that is then dropped, and the enum CHECK re-created
   `NOT VALID` with a comment explaining how to validate it. I applied it to a
   live table holding a row and **the data survived**, verified in psql.

2. **The rebaseline guard.** `rm -rf out && regenerate` is refused, with a
   paragraph explaining that a database which already ran the old "Initial"
   would consider the new one applied and skip it. This is the kind of failure
   most tools discover in production.

3. **Multi-tenant isolation is real, and I proved it.** Two Keycloak users with
   different `tenantId` claims: the rival's list read is empty, the by-id read
   is `404` (not 403 — no existence leak), the write is `404`. The filter is in
   the repository, not the route.

4. **Per-context Postgres schemas**, and foreign keys exactly where they can be
   honoured: `policies.policies.holder → policies.policyholders` gets an FK;
   the cross-context `claims.claims.policy` gets an index and no FK, which is
   precisely what `docs/decisions.md:3241` says it should do.

5. **The diagnostics, when they fire, are the best I have seen in a DSL.** They
   name the rule, the reason, and the fix. Three examples from this session:
   - `loom.default-deny-ungated` on a `with crudish` member tells you the member
     has no source line to edit and hands you `with crudish(requires: <Policy>)`.
   - `loom.page-primitive-unknown-arg` lists every argument `Table` accepts and
     explains that an unknown one is silently dropped from *every* frontend and
     never reaches the message catalog.
   - A warning I did not ask for: *"`Order.done` is assigned by the guarded
     operation `finish`, but it is also writable through the generic `update`
     that `crudish` emits — a caller can set it on `update` and skip that
     gate."* That is a real security review, written by the compiler.

6. **The boot path works.** `migrations_starting` → `migrations_complete` →
   `auth_enabled` → `server_listening` in 150ms, structured JSON logs, a
   `/ready` probe, RFC-7807 problem details on every error, a clean OpenAPI
   surface (`POST /api/claims` correctly absent because the aggregate is
   created only by a workflow), and an outbox table that actually drains.

## Where it hurt

Ranked by how much of my time they cost, not by severity.

1. **The multi-deployable step is where the model and the tooling diverge.**
   Splitting a context onto its own service is the most ordinary evolution
   there is, and it produced: 18 generated-code errors naming no cause
   (F-108), an unexpressible `targets:` (a frontend may target exactly one
   backend), a projection that imports another deployable's value objects
   (F-102), and a broker event lost because the consumer had not booted yet
   (F-112). Loom's own headline is a multi-project tree wired as one compose
   stack; this is the seam that needs the most work.

2. **Authorization has no "internal" door.** An operation reachable from a saga
   must be public, and a public operation under `denyByDefault` must carry a
   gate, and a gate inlined into a reactor has no principal (F-103). All three
   rules are individually right; together they have no solution. I shipped
   `requires true` — an unguarded HTTP route — because the language offered
   nothing else. Add to that the documented-but-real by-id hole
   (`loom.default-deny-by-id-ungated`, mission M-T3.19): in a claims system,
   "adjusters see all claims, customers see only theirs" is *the* requirement,
   and today tenancy covers tenant separation while role separation within a
   tenant is unenforceable on `GET /api/claims/{id}`.

3. **`money` is a first-class type that cannot be displayed** on a hand-written
   page (F-107) and whose `round(n)` is mis-lowered on the frontend (F-106).
   The scaffold gets it right with `<MoneyValue/>`; the moment you hand-write
   the page the scaffold generated — the exact move `docs/customization-gradient.md`
   promises — money breaks the build. For a financial DSL this is the most
   surprising gap in the set.

4. **Type-system holes at argument positions** (F-104, F-105). "Every name
   carries a `refKind`, backends never re-resolve" is the architecture's
   headline claim, and it holds for assignments and comparisons and fails for
   `create({…})` arguments and `test`-body operation calls. F-104 is the one I
   would fix first in the whole register: it writes the wrong aggregate's id
   into a reference column, in production code, with no diagnostic.

5. **Small things that cost real minutes**: no `date` type in a date-heavy
   domain (F-110); `string(guid)` refused by a message that says it is allowed
   (F-111); a migration surface that cannot rename a field called `description`
   (F-109); a "did you mean" that suggests operation names as types (F-115);
   and a scaffold comment telling me to hand-write CRUD for a feature that
   shipped (F-116).

## Overlap with open PRs

Checked every open PR (25) before writing this up.

| finding | status |
|---|---|
| F-103 unbound principal in a reactor | **#2966 item 1** claims it **for Java only**. Live on node and .NET too; python drops the gate; elixir passes `nil`. The PR's scope should widen. |
| F-107 money in a page slot | **#2871 D4** adds `loom.money-in-text-slot` covering `Stat`. Two open questions for it: its row-typing reads `wireFieldsForAggregate` off a `QueryView`'s `of:` — mine is a **projection**; and refusing the model still leaves Vue/Svelte/Angular rendering money unformatted rather than through `MoneyValue`. |
| Keycloak demo user | **#2948 item 1** claims it. **Half has landed since that PR was written**: the realm now emits `loom-claim-tenantId` and `loom-claim-permissions` mappers off `user {}`. Still open, and I have a live repro: the seeded `demo` user has **no `permissions` attribute**, so every gated write 403s out of the box, and the realm sets no `unmanagedAttributePolicy`, so an operator cannot add one through the admin API without changing the realm's user profile first. |
| F-105 untyped args | sibling of merged **#2958** (`test e2e` payloads); the unit `test` body's operation calls are still open. |
| F-101, F-102, F-104, F-106, F-108–F-117 | **no open PR claims any of them.** |

## What I would do next, in order

1. **F-104** — `X id` in a `create({…})` argument. Silent data corruption in
   production code; the correct check already exists for assignment.
2. **F-101** — the outbox-dispatcher gate. One-line condition mismatch; makes
   an ordinary saga service uncompilable.
3. **F-103** — widen #2966 to all five backends, *and* decide the language
   question: what is the principal of an event reactor, and how does an
   operation say "saga-only"?
4. **F-102** — scope the projection emitter's value-object pool to hosted
   contexts, as the enum pool already is.
5. **F-108** — a phase-⑦ diagnostic for a ui whose scaffolded contexts are not
   hosted by its `targets:` deployable; then decide whether `targets:` should
   take a list.
6. **F-109 / F-115 / F-116 / F-111** — four cheap, self-contained fixes whose
   combined cost is probably one afternoon and which remove four "the compiler
   told me something untrue" moments.
7. **F-110** — a `date` scalar. Bigger, but it is the type a business DSL is
   most often asked for.

## A note on the corpus

Every S1 here is a *combination* the corpus does not contain. The cheapest
structural defence is a fixture that pairs the axes rather than exercising them
one at a time: one context with a workflow **and** a durable channel **and** no
reactor (F-101); one system with a projection **and** more than one deployable
(F-102); one operation gate reached from a reactor on all five backends
(F-103); one hand-written page over a **projection** carrying a `money` field
(F-106, F-107). Four fixtures would have caught six S1s.

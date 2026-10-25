# Proposed follow-up work from the helpdesk evaluation

Each section below is the design write-up for one follow-up item found by the helpdesk eval
(fleet slices H8 / H10 / H12 of #3259). The live status of each item is its GitHub issue; this
file only keeps the design text next to the evidence in `FINDINGS.md`. The `M-Tx.y` ids in the
headings are the working names used in the findings and in code comments; they are not
`docs/new-plan` missions.

## M-T2.20 (#3841) — No sequence / human-readable auto-number: `HD-1001` is client-supplied or a counter aggregate — `open` · **M–L** · P2 (design first)

Every ticketing, invoicing and ordering system needs a human-facing number that the server assigns. In the helpdesk, the client typed `T-1` and `unique (number)` caught the collisions. Spelling `HD-1001, HD-1002, …` takes a `Counter` aggregate plus a workflow that loads it, increments it and saves it. That is a hot-row serialization point, and under concurrency it degrades into a stream of optimistic-concurrency 409s.

**Sketch.** A server-assigned integer field, plus a derived display string:

```ddd
aggregate Ticket {
  seq: long sequence from 1001                 // DB-assigned, implicitly managed + unique, never in the create input
  derived number: string = "HD-" + string(seq)
}
```

- **The column is plain integer storage with a database default** (`CREATE SEQUENCE tickets_seq_seq START 1001` plus `DEFAULT nextval('tickets_seq_seq')`), so every backend reads the value back after insert:

  | Backend | Read-back |
  |---|---|
  | node (drizzle) | ``default(sql`nextval(…)`)`` + `.returning()` |
  | .NET (EF) | `HasDefaultValueSql("nextval(…)")` + `ValueGeneratedOnAdd` |
  | java (JPA) | `@Generated(event = INSERT)` with `insertable = false` |
  | python (SQLAlchemy) | `server_default=text("nextval(…)")` + `eager_defaults` |
  | elixir (Ecto) | `read_after_writes: true` |

- **It is implicitly `managed` and `unique`.** It never appears in the create input, and the unique index comes free.
- **The format stays in a `derived`**, so it is not stamped (derive, don't stamp). A `find byNumber("HD-1001")` therefore needs E2's queryable-derived inlining ([M-T5.49](#m-t549)), or the author finds by `seq`.

**Honest refusals for the first slice** (each one a `loom.*` code, never a silent drop):
- a `tenantOwned` aggregate (a Postgres sequence is global; per-tenant numbering needs a counter table with a row lock, which is slice 2);
- a `shape: document` / `persistedAs: eventLog` aggregate;
- the dapper and mikroorm self-provisioning adapters, until M-T2.17 gives them a migration chain.

**Migrations.** Adding a `sequence` field to a populated table emits `CREATE SEQUENCE` followed by `ADD COLUMN … DEFAULT nextval(…) NOT NULL`. Postgres fills the existing rows itself, so no backfill is needed and no destructive gate fires. That fill order is physical, not creation order: say so in `docs/migrations.md`, or emit an ordered `UPDATE … FROM (SELECT id, row_number() …)` before the default is attached. Changing `from` on an existing sequence becomes `ALTER SEQUENCE … RESTART`, gated as destructive.

**Verification.**
- A corpus fixture with a `sequence` field that compiles on all five tiers.
- A behavioral case: two concurrent creates get distinct, increasing numbers, and neither carries a `seq` in its request.
- A `migration-evolution-e2e` case adding the field to a populated table.
- Negative validator cases for each refusal.

Relates to M-T2.7 (seeding: a seeded row must not consume or collide with the sequence; advance it past seeded values).

## M-T2.21 (#3842) — No way to discard the last, unapplied migration (`ef migrations remove`) — `open` · **M** · P3

A bad generation gets committed into the migration chain: in the helpdesk, the duplicate `CREATE TABLE sla_sweeps` of finding G2. The baseline snapshot (`<out>/.loom/snapshots/<module>.snapshot.json`) is **overwritten in place** with the bad state, and the source-side ledger (`<source-dir>/.loom/<source>.migration-history.json`) records the new version. Any later fix is diffed against that bad baseline, so the repair surfaces as a `DROP TABLE` behind `--allow-destructive`. Without git, nothing holds the previous baseline. Recovery meant deleting snapshots, migration files and ledger entries by hand, which is exactly the hand-edit of generated state that D-MIG-DSL-STEPS exists to rule out.

**This is not a down migration.** D-MIG-NO-DOWN rules that applied migrations are never rewound: operators roll forward. Discard covers the **unapplied** tail only. It rewrites Loom's own bookkeeping as if the last generation never happened, and the database is not touched. That distinction must be in the command's help text and in `docs/migrations.md`.

**Sketch.**

```
ddd migrations discard app.ddd -o out [--module <m>]
  → removes version 20261012000003 (node/drizzle, .NET/EF, java/Flyway, python, elixir/Ecto files for module "support")
  → restores out/.loom/snapshots/support.snapshot.json to the baseline at 20261012000002
  → drops the version from the source ledger
```

- **It needs the previous baseline.** The ledger holds version numbers, not schema state, so the snapshot store must keep one prior baseline per module, written on each generation that emits a delta (for example `<module>.snapshot.prev.json`, or `snapshots/<module>/<version>.json`). The `--allow-rebaseline` guards (a)–(e) then stay consistent: the history and the files shrink together.
- **It works on the newest version only,** one step at a time.
- **It refuses** when the ledger shows a later version, and when no previous baseline was recorded (a tree from before this change).
- **Applied-ness is asserted, not detected.** Loom cannot see the database, so the command prints that discarding an applied migration will make the next run reuse its version number, which the migrator then skips. That is guard (c)'s failure mode, so state it loudly. A `--database-url` probe of `__loom_migrations` / `schema_migrations` is an optional follow-on.

**Verification.**
- A CLI test: generate v1 → generate v2 → discard → generate v2' produces the same files as a clean v1 → v2' run.
- A refusal case for each guard.
- A per-backend assertion that the discarded version's files are gone from every hosting deployable.

Relates to M-T2.1 (rename intent: the G2-then-rename sequence is how the helpdesk hit this) and to the `--allow-rebaseline` guards in `docs/migrations.md`.

## M-T3.24 (#3843) — `mask unless` on a contained part's field validates clean and is never applied; a part cannot be hidden per caller — `open` · **M** (slice 1 **S**) · **P1** · security

**Slice 1 is a silent leak.** The helpdesk's first real requirement was "customers must not read internal notes." The obvious spelling validates clean and leaks on every backend:

```ddd
aggregate Ticket {
  subject: string
  contains comments: Comment[]
  entity Comment { body: string  internal: bool mask unless currentUser.role == "agent" }
}
```

`ddd parse` reports `0 error(s), 0 warning(s)`, because the AST validator type-checks a part's `mask unless` (`src/language/validators/structural.ts:878`, `envForPart`). The same predicate on a root field redacts on all five backends; on the part field, no backend applies it. Here is what each backend emits for a root field `secret2` beside the part:

```
node    t-repository.ts    toWireMasked: wire.secret2 = null    — Comment.internal never touched
.NET    GetTByIdHandler    (…) ? found.Secret2 : null           — new CommentResponse(__e.Id.Value, __e.Body, __e.Internal)
java    TResponse.java     (…) ? value.secret2() : null         — value.comments().stream().map(CommentResponse::from)
python  t_repository.py    d["secret2"] = None                  — comments unchanged
elixir  t_controller.ex    Map.put(wire, "secret2", nil)        — comments unchanged
```

Every masked serializer iterates `agg.fields` only; the IR mask checks collect the same root-only set (`src/ir/validate/checks/storage-inheritance-checks.ts:280`). On all five backends at once, this must become one of two things:

- **The redaction:** the part serializer nils the field under the same predicate and the same principal read the root uses.
- **An honest refusal,** `loom.field-mask-on-part`, until the redaction lands.

Never fix one backend only. Value-object fields (`structural.ts:896`) raise the same question, so check them in the same slice.

**Slice 2 is new surface; design it first.** The helpdesk wants to hide *whole elements*, keyed on a sibling field of the element: comments where `internal` is true. A field mask cannot say that. The workaround of moving notes into their own aggregate leaks through `GET /internal_notes/{id}` instead (M-T3.19). A sketch:

```ddd
contains comments: Comment[] visible when !internal || currentUser.role == "agent"
```

Target output: the containment serializer filters the elements before mapping them.

| Backend | Filter form |
|---|---|
| node | `comments: root.comments.filter((e) => !e.internal \|\| u?.role === "agent").map(…)` |
| .NET | `.Where(…)` ahead of the `Select` |
| java | `.filter(…)` in the stream |
| python | a comprehension guard |
| elixir | `Enum.filter/2` before serialization |

The predicate may read the element's own columns and `currentUser`, and nothing else. That is the `mask unless` gate vocabulary widened by one element scope.

**Why slice 2 needs design: the write path.** A read-filtered aggregate must never reach a save. Every backend's repository save replaces the containment set: node and python delete missing children, and EF/JPA remove orphans. Suppose an operation loads a Ticket for a customer with the internal comments filtered out, then saves it. That save would **delete the hidden comments**. So the filter belongs to the wire projection only, applied after the domain load, and never to the repository load. A gate must pin this: a customer-principal operation runs on a Ticket that has hidden comments, then an agent re-reads it and asserts the comments survived.

The same rule binds any future per-row read mask keyed on a sibling field ("mask `amount` unless `this.public`"). Such a mask reads the row, so it can only run at the response boundary. It can be neither a claim-only predicate nor a query filter.

**Verification.**
- Slice 1, redaction route: a five-backend emission test, shaped like the existing `mask unless` cross-backend tests, asserting the part field is nulled. Mutation-prove it by reverting one backend's part arm.
- Slice 1, refusal route: a `FIRING_FIXTURES` entry plus the `diagnostic-catalog` and `diagnostic-firing-census` tests.
- Slice 2: the survive-the-save behavioral case above on all five backends, plus a wire golden of the filtered read.

Relates to M-T3.2 item 6 (`mask unless` on root fields), M-T3.15 (projection masking), and M-T3.19 (by-id reads).

## M-T3.25 (#3844) — No system-only operation: a command a workflow, timer or reactor may call but no client can route to — `open` · **M** · P2 · security

The helpdesk's `Ticket.flagBreached()` and `Ticket.escalate()` are called by the SLA timer workflow and the `SlaBreached` reactor. No customer or agent should be able to call them over HTTP. Today there are two access levels, and neither fits:

- **A public `operation`** gets `POST /tickets/{id}/flag_breached`. The author writes `requires true`, or `requires currentUser.isSystem` once [#3103](https://github.com/Loom-Harness/Loc/pull/3103) lands. The route still exists, OpenAPI still lists it, and the scaffold still offers a button for it.
- **A `private operation`** has no route, but no workflow can reach it either. The validator raises `loom.workflow-private-operation`: *"workflow 'w': 'T.flag' is private. Workflows can only call public operations."* (`src/ir/validate/checks/workflow-checks.ts`).

**Sketch.** A third access level, callable from same-context workflow, reactor, timer and handler bodies. It gets no route, no `can_<op>` companion, no OpenAPI entry and no scaffold button:

```ddd
// proposed surface — does not parse yet …
system operation flagBreached() when !breached { breached := true }
```

The keyword is the owner's call. `internal` is already a field modifier, which argues for a different word; `system` reads well beside `currentUser.isSystem`.

Target output:
- **Domain method:** emitted exactly as today.
- **Routes:** skipped by the route builders on all five backends (node `*.routes.ts`; .NET endpoint map + Mediator command; java controller; python router; elixir router + controller).
- **Workflows:** call it like any public operation.
- **`when`:** stays legal. Per D-WHEN-GATE-DOMAIN the gate runs inside the domain method, so its 409 still reaches the calling workflow. No `can_<op>` is emitted.
- **`audited`:** follows the private-operation rule (not part of the API surface).

**How it composes with #3103.** `currentUser.isSystem` makes a `requires` gate refuse clients at runtime. This mission removes the surface itself. Together, a system-only operation needs no gate. `validateDefaultDeny` must not report it as ungated, since there is no route to gate, and the deny-by-default work in M-T3.19 must not count it.

**Verification.**
- A five-backend route-emission test asserting no route, no OpenAPI path and no `can_` endpoint, while the calling workflow compiles and calls the operation on the corpus compile tiers.
- A negative validator case: a page or `ui` action that calls it is refused.
- A behavioral leg: the timer flips the flag, and a client `POST` to the would-be path answers 404 or 405.
- Mutation-prove by re-enabling the route arm on one backend.

## M-T3.26 (#3845) — Create-time identity: `requires x != null` does not narrow a nullable claim, and a stamp cannot fall back to a client-supplied value — `open` · **M** · P2

The requirement: "a customer opens a ticket for themselves; an agent opens one on a customer's behalf." Against fresh `main`:

1. **The plain stamp works and fails closed.** The model declares `customerId: Customer id?` in `user {}` and writes `stamp onCreate { customer := currentUser.customerId }`. It validates clean. Node's `stampInsert` answers 403 when the token lacks the claim (`audit-stamp.ts`: *"the access token carries no "customerId" claim, which this system stamps into customer on every write"*). This half of S5 has **already shipped**; do not rebuild it.
2. **A stamp is unconditional.** An agent has no `customerId`, so an agent can never create a ticket at all. There is no way to say "the principal's customer, else the one the request names." The helpdesk fell back to a workflow plus a redundant `customer` param, guarded by `requires currentUser.customerId == customer`.
3. **A `requires x != null` does not narrow `x`.** In an operation body, `requires currentUser.customerId != null` followed by `customer := currentUser.customerId` fails with `error: Cannot assign 'Customer id?' to 'Customer id'`. Other diagnostics already offer a nullable-narrowing hint, so the guard is the surprising exception.

**Sketch.**

```ddd
stamp onCreate { customer := currentUser.customerId ?? input.customer }   // (2) fall back to the create input
operation reassign() {
  requires currentUser.customerId != null
  customer := currentUser.customerId                                       // (3) narrowed after the guard
}
```

- **(3) is a type-system rule.** A `requires` or `precondition` whose condition is `e != null`, or a conjunction containing it, narrows `e` for the rest of the body, as `if let` already does. It belongs in the single typing pass (M-T5.47) if that has landed; otherwise it goes in the AST narrowing table, with lowering copying the result. No backend changes, since every backend already renders the claim read.
- **(2) needs the create input to be nameable inside a stamp.** The name is either `input.<field>` or a declared create param, which depends on M-T5.32 (the declared parameter list becomes the POST contract). Build (2) after M-T5.32. Target output on node: `customer: currentUser?.customerId ?? body.customer`, keeping the existing 403 when both are absent. The other four backends do the same at their own stamp sites: the .NET SaveChanges interceptor, java `@PrePersist`, the python stamp method, and the elixir changeset.

**Verification.**
- (3): an AST and IR type case covering both the narrowed case and the not-narrowed case after `||`. Mutation-prove by dropping the narrowing arm.
- (2): a five-backend behavioral case with three tokens. A customer token stamps its own id. An agent token with a supplied customer stores that customer. An agent token without one gets 403 or 422, not a NOT NULL 500 (the M-T3.20 class).

## M-T4.14 (#3846) — Lint: a workflow loop over a retrieval calls a `when`-gated operation whose gate the criterion does not imply — `open` · **S–M** · P3 (suggestion only)

The helpdesk's SLA sweep ran:

```ddd
criterion Overdue(at: datetime) of Ticket = status != Resolved && dueAt < at
let due = Tickets.run(OverdueTickets(t.at))
for ticket in due { ticket.flagBreached() }          // operation flagBreached() when !breached && status != Closed
```

The first already-breached ticket made the `when` gate refuse it with a 409. The whole timer run aborted (`timer_emit_failed`), with no partial commit. **That is as designed:** D-WHEN-GATE-DOMAIN runs the gate inside the domain method on every caller, and D-WRITE-TX makes the workflow one transaction. The model was wrong, because the criterion did not imply the gate. Fleet slice H7 documents the behaviour. This mission adds a cheap static hint so the next author catches it at generate time.

**Sketch.** A **suggestion**, never an error or warning, because implication is undecidable in general and a false positive must not block a build. Call it `loom.loop-gate-not-implied`. It fires when all of these hold:
- a workflow, `commandHandler` or `on` body contains `for x in xs { … x.op(…) … }`;
- `xs` is bound by `let xs = Repo.run(R(args))` (the only legal `for` source, per `loom.workflow-foreach-source`);
- `op` carries a `when` gate;
- a conservative syntactic check cannot show that `R`'s criterion (after inlining named criteria) implies the gate. Take the gate as a conjunction of atoms; each atom must occur among the criterion's conjuncts, or be entailed by one of them through a small table (`a == V` entails `a != W` for distinct enum values V and W; `b == false` entails `!b`).

Message sketch: *"`Ticket.flagBreached` is gated `when !breached && status != Closed`, but retrieval `OverdueTickets` does not guarantee `!breached`. One non-matching row refuses the call with a 409 and aborts the whole workflow. Add the conjunct to criterion `Overdue`, or wrap the call in an `if` that tests the gate condition."*

It must walk the IR through `src/ir/util/walk.ts` (`walkWorkflowStmtsDeep`), not a hand-rolled traversal (`test/system/ir-walk-census.test.ts`). The message goes in `src/diagnostics/messages.ts`.

**Verification.** A firing fixture (the helpdesk shape) and a non-firing one (the criterion carries `breached == false`), registered in `FIRING_FIXTURES`, plus `diagnostic-catalog` and `diagnostic-firing-census`. Mutation-prove by deleting the implication table's enum arm and watching the non-firing fixture start firing.

Relates to M-T5.4 (criterion tails) and M-T4.6 (`job`, the construct the sweep should become). Per-item isolation for a sweep (a partial commit, a per-row savepoint, or a dead-letter list) is a **different, owner-level** question against D-WRITE-TX. Do not fold it in here.

## M-T5.49 (#3847) — A `derived` field cannot appear in a query, even when its expression is queryable — `open` · **M** · P2

```ddd
aggregate Ticket { createdAt: datetime  hrs: int  derived dueAt: datetime = createdAt + hours(hrs) }
criterion Overdue(at: datetime) of Ticket = dueAt < at
retrieval OverdueTickets(at: datetime) of Ticket = Overdue(at)
```

→ `loom.retrieval-where-not-queryable: … where-clause is not queryable (ref to 'dueAt' (this-derived))`. The helpdesk had to turn its SLA deadline into a stored column, stamp it `onCreate`, and recompute it by hand in two operations. That is the denormalized-cache shape the "derive, don't stamp" rule warns against, and the compiler forced it.

**The fix: inline, don't store.** A `this-derived` reference is queryable exactly when the derived expression is queryable after substitution, checked recursively and cycle-safe (derived-of-derived). `firstNonQueryableNode` (`src/ir/validate/checks/shared.ts:390`) gains that arm. Lowering of `criterion` / `retrieval` / `find … where` / `filter` predicates substitutes the derived body for the reference, the way named policies and criteria are already inlined. The five query renderers then see only column refs and need no change. Keep the origin span of the reference, so a diagnostic about the inlined expression still points at the author's `dueAt`.

```ts
// node, drizzle — OverdueTickets(at)
.where(lt(sql`${tickets.createdAt} + make_interval(hours => ${tickets.hrs})`, at))
```

**Slices.**
1. Derived bodies built only from the operators and intrinsics already in the queryable subset (comparisons, arithmetic, `startsWith`, the `pg-intrinsics.ts` table). Pure IR work, byte-identical for every model that does not reference a derived field in a query.
2. `datetime ± duration` in a query. The helpdesk's actual case needs an interval in each dialect: drizzle `make_interval`, EF `AddHours` (LINQ-translatable), Ecto `datetime_add/3`, SQLAlchemy `func.make_interval`. JPQL/JPA Criteria has no portable interval arithmetic, so java either renders a native `function('make_interval', …)` or keeps an honest per-backend refusal. Decide at slice time; never leave it silent. Overlaps M-T5.5's storable `duration` row.
3. Optionally, a derived field in `sort:` and in the scaffold's sortable columns (finding U2's list half).

**Verification.** An IR test that the lowered predicate carries no `this-derived` ref; a corpus fixture with a queryable derived field in a retrieval, compiled on all five tiers; a behavioral case booted against Postgres that returns exactly the overdue rows. Mutation-prove by restoring the old refusal arm and watching the fixture refuse.

Relates to M-T5.4 (criterion and retrieval tails), M-T5.31 (retrieval routes), and M-T2.20 (`find byNumber` over a derived display number).

## M-T5.50 (#3848) — `.contains` on a value collection (`tags: string[]`) is not queryable, though the column is a Postgres array — `open` · **M** · P3

```ddd
aggregate Ticket { tags: string[] }
criterion Tagged(tag: string) of Ticket = tags.contains(tag)
```

→ `loom.retrieval-where-not-queryable: … (collection op '.contains')`. Only `X id[]` reference collections get a queryable `.contains`, through their join table. A scalar value collection is stored as a column on node (`tags: text("tags").array().notNull()`), and the natural query is `$1 = ANY(tags)`, which a GIN index can serve.

**The fix.** Admit `<valueCollectionField>.contains(<scalar>)` in the queryable subset when the collection is stored as a native array. Render it on every SQL path:

| Backend | Rendering |
|---|---|
| drizzle | ``sql`${p} = ANY(${col})` `` |
| EF Core (Npgsql) | `col.Contains(p)` (translated to `= ANY`) |
| Dapper | `@p = ANY(col)` |
| JPA Criteria / JPQL | `function('array_contains', col, :p)`, or `array_position(col, :p) IS NOT NULL` through a registered function |
| SQLAlchemy | `col.any(p)` |
| Ecto | `fragment("? = ANY(?)", ^p, field(t, :tags))` |

**First step: verify the storage on each backend.** If any backend stores a value collection in a child table instead (elixir `{:array, …}` versus a `has_many`; a `shape: document` JSONB body), that backend renders `EXISTS (SELECT 1 FROM … WHERE value = $1)` or `col @> to_jsonb(…)`, or else refuses with a backend-named `loom.*` code. Do not admit the shape until every backend either renders it or refuses it. `M-T2.8` (auto-derived finder indexes) could add the GIN index when a criterion uses the shape.

**Verification.** A corpus fixture (`tags.contains(param)` in a retrieval) compiled on all five tiers, plus a behavioral case returning exactly the tagged rows, including a tag containing a comma or a quote (values are data, not SQL). Mutation-prove by swapping in a `LIKE '%…%'` lowering and watching the comma case fail.

## M-T6.99 (#3840) — Elixir stamp parity: document-shaped self-reading stamps, `onUpdate` on operations, workflow and reactor actors — `open` · **M** · P2

A `stamp onCreate { dueAt := now() + hours(slaHours()) }` reads the aggregate's own function. Node, .NET, python, java and relational elixir evaluate it against the instance being persisted. The elixir **document** path merges stamps into the request attrs before any record exists, so there is nothing to read. That shape is refused today with `loom.stamp-reads-aggregate-unsupported` (register row `scope`).

**Done when:** the elixir document repository builds the record first, applies `apply_changes` the way the relational path's `then(fn cs -> …)` step does, and evaluates the stamp against it. The refusal and its register row are deleted, and a generated document-shaped elixir project with a self-reading stamp compiles and stores the computed value (`mix compile` + a Postgres round trip).

**Also in scope.** Fleet slice H12 found these on a booted elixir app:
1. A named operation (`bump_ticket`) saves through `persist_change` with no `onUpdate` stamp, on REST and in workflows alike, so `updated_at` / `updated_by` keep the creator's values. Node, .NET and python stamp every update.
2. A reactor that creates an `auditable` aggregate passes no actor, so the NOT NULL `created_by` gets nil (python writes `''`). The fix rides the system principal: `currentUser.isSystem`, #3103.
3. A cross-context workflow create gets no actor.
4. A `requires true` create gate leaves an unused `defp ensure(false, …)` clause, which fails `mix compile --warnings-as-errors`.

**Evidence:** `test/generator/stamp-per-aggregate-self-read.test.ts` (the validator arm), `test/generator/elixir/elixir-workflow-stamp-actor.test.ts`, `src/ir/util/stamp-self-read.ts`.

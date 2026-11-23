# D-HANDLER-TX — a command handler is one transaction

**Status:** decided by the owner, 2026-11-16.

**Question.** A `commandHandler` fails part-way through its body, after it has
saved a row (a loop that saves each row at the end of its iteration, then
refuses a later one).  Do the rows it saved before the failure stay?

**Decision.** No.  A command handler runs in one transaction on every backend,
whatever its body holds: a failure anywhere in it leaves none of its writes,
an expected-failure `error` answer rolls it back, and the events its saves
raised are dispatched only once it has committed.  A query handler writes
nothing and runs in none.  The plan's `bodyIsolation`
(`src/ir/plan/workflow-transaction.ts`) states it; every backend's
command-handler emitter reads it (the `handler-tx` rule of
`test/system/workflow-plan-census.test.ts`).

A resource call inside a command handler stays allowed inside that
transaction, in statement order — no refusal, no deferral.  Its outside effect
does not roll back with the database: a call the handler reads from is safe
there, and a call that must happen exactly when the change commits belongs in
a reactor on an emitted event.  The same holds wherever a transaction is
open (a `transactional` workflow, a reaction): a resource call is never
refused there, and an effect is named by the `loom.effect-in-transaction`
advisory.

**Rationale.** A handler answers its caller with one outcome, so its writes
are one unit.  Workflows keep their own default (`D-WORKFLOW-TX-BOUNDARY`):
non-transactional, with `transactional` as the opt-in.

**Proof.** `test/fixtures/corpus/handler-loop-boundary.ddd`: the loop archives
and saves the open item, then the locked item refuses with 422; on all five
backends the open item stays open.

**Enforced by:** `test/fixtures/corpus/handler-loop-boundary.ddd`, `test/system/workflow-plan-census.test.ts`

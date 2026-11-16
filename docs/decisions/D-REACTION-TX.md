# D-REACTION-TX — every reaction runs in one transaction

**Status:** decided by the owner, 2026-11-16.

**Question.** A reactor (`on(e: X)`) or an event-triggered `create(e: X) by …`
fails part-way through its body, after it has saved a row (a loop that saves
each row at the end of its iteration, then refuses a later one).  Do the rows
it saved before the failure stay?

**Decision.** No.  A reaction runs in one transaction on every backend,
whether or not its event arrived through the consumer inbox: a failure
anywhere in the body leaves none of its effects (`docs/workflow.md`
§ Reactor failures), and the events its saves raised are dispatched only once
it has committed.  A durably delivered event is claimed in the consumer inbox
inside that transaction.  The plan's `reactionBoundary`
(`src/ir/plan/workflow-transaction.ts`) states it; every backend's reaction
emitter reads it, none decides it from the inbox claim (the `reaction-tx` rule
of `test/system/workflow-plan-census.test.ts`).

**Rationale.** A failed reaction is reported (`reactor_failed`) and, on a
durable channel, retried; a retry against rows a failed attempt half-wrote
re-applies some of the work.  Workflow commands keep their own rule
(`D-WORKFLOW-TX-BOUNDARY`): a command answers its caller, a reaction answers no
one.

**Proof.** `test/fixtures/corpus/reactor-loop-rollback.ddd`: the loop archives
and saves the open item, then the locked item refuses; on all five backends
the open item stays open and no saga row is left.

**Enforced by:** `test/fixtures/corpus/reactor-loop-rollback.ddd`, `test/system/workflow-plan-census.test.ts`

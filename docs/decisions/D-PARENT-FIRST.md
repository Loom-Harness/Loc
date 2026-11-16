# D-PARENT-FIRST — a created aggregate is saved before the rows that reference it

**Status:** decided by the owner, 2026-11-16.

**Question.** A workflow creates an aggregate, then loops, and each pass
creates a row carrying the new aggregate's id.  Node, .NET, Java and Python
saved the created aggregate only at the exit, so the first child insert failed
on its foreign key (a 422) while Elixir, which saves where it creates, worked.
Where is a created aggregate saved?

**Decision.** Just before the first loop, `if`, `if let` or `match` that reads
it and saves rows of its own, on every backend.  The plan's `parentFirstSaves`
(`src/ir/plan/workflow-parent-saves.ts`) states where; the shared statement
spine renders the save through each backend's `saveBefore` leaf, and the
post-body `exit-saves` step drops it from the exit.  A created aggregate an
operation changes after that point keeps its exit save, which writes the
change.  Elixir persists a create where the body writes it, so it moves that
write to the same point (`deferredCreates`): the created aggregate is written
there, or at the list's end, unless a statement in between reads it, which
needs it stored sooner.  A guard that fails first therefore leaves nothing, on
every backend.

**Rationale.** The order of two writes that reference each other is a decision,
not a style: a backend that chose differently fails at the database.

**Proof.** `test/fixtures/corpus/workflow-parent-first.ddd`: the loop creates
a row per seed, each referencing the created batch; on all five backends the
call answers 2xx and the rows are present.
`test/fixtures/corpus/workflow-created-then-guard.ddd`: a guard fails after a
create; on all five backends the created row is not kept.

**Enforced by:** `test/fixtures/corpus/workflow-parent-first.ddd`, `test/fixtures/corpus/workflow-created-then-guard.ddd`, `test/system/workflow-plan-census.test.ts`

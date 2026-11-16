# D-WORKFLOW-TX-BOUNDARY — a workflow command commits each save on its own unless it is `transactional`

**Status:** decided by the owner, 2026-11-13.

**Question.** When a workflow command without `transactional` fails part-way, do
the saves it already made stay, or does the whole command roll back?

**Options.** (a) every save commits on its own, as `docs/workflow.md` says;
(b) every workflow command is atomic, and `transactional` only pins an isolation
level.

**Decision.** (a). **The rule, stated once:** a workflow command runs in one
transaction exactly when it is declared `transactional` (the plan's
`workflowRunsInTransaction`); the keyword is the only way a workflow gets one.
A workflow whose `create` answers an expected failure (`T or E`), or that
re-checks a held row's write scope, must roll back as a whole, so without the
keyword it is refused (`loom.workflow-implicit-transaction`, from the plan's
`workflowRequiresTransaction`).  `transactional` covers the command body; each
`on(...)` handler is always its own transaction, so the keyword and `on`
handlers combine.  Any other workflow command commits each repository save on
its own, so a failure keeps the rows saved before it.  Every
backend reads that fact; none chooses its own boundary (the `tx-boundary` rule of
`test/system/workflow-plan-census.test.ts`).  Reactors and event-triggered
starters are unaffected: a failed reaction leaves no effects of its own
(workflow.md § Reactor failures).

**Rationale.** The aggregate is the consistency boundary; a workflow that wants
all-or-nothing across aggregates says so with `transactional`, at the cost of the
locks and the distribution barrier the keyword names.  The consequence is the
caveat the docs carry: a client that retries a failed non-transactional workflow
re-runs it against the saves the failed run kept, so such a workflow must be
written to be safe to retry.

**Proof.** `test/fixtures/corpus/workflow-partial-commit.ddd`: a workflow saves a
counter, then fails; the counter keeps its bump on all five backends, and the
`transactional` twin keeps nothing.  `test/fixtures/corpus/workflow-tx-continuation.ddd`:
a `transactional` workflow answering `T or E` rolls its failed command back as a
whole, and its `on` handler commits on its own.

**Enforced by:** `test/fixtures/corpus/workflow-partial-commit.ddd`, `test/fixtures/corpus/workflow-tx-continuation.ddd`, `test/system/workflow-plan-census.test.ts`

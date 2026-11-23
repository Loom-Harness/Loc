# D-WORKFLOW-STEPS — a workflow sends commands, in named steps

**Status:** decided by the owner, 2026-11-22.

**Question.** How does a workflow change aggregates in other handlers, and
what commits when?

**Decision.** A workflow SENDS a `command` (or `query`) record to the record's
one handler: `send X { … }`, `let r = send X { … }`. Sends are grouped into
named steps, `step <name> { … }`, each committed as one transaction; a send
outside a step is a step of its own. In a `transactional` workflow every step
joins the body's transaction. A committed step that anything able to fail
follows carries `undo { … }` or `final`; there is no one-line form. A step
holds any workflow statements; a step or a send may sit anywhere a statement
may, and a step inside another step joins its transaction. A send is delivered now when the deployable hosts the target context
on the sender's storage; otherwise it needs the command outbox, which is
refused until it exists, and is a compile error inside a scope that must be one
transaction. A sent command's `requires` is checked against the workflow's
caller, or the system principal for a reaction. A workflow's earlier read is
not version-checked against the handler's write: the handler re-reads the row,
so a decision that must hold at the write is guarded by the handler's own
preconditions.

The facts live once in `src/ir/plan/workflow-steps.ts` (`workflowSteps`,
`sendDelivery`, `stepStores`, `stepsNeedingCompensation`, `sendPrincipal`);
the validators are `src/ir/validate/checks/workflow-send-checks.ts` and the
`send` / `step` arm of `src/language/validators/stmt-placement.ts`. A backend
that does not render steps refuses `stmt:send@workflow-body` in the capability
table.

**Enforced by:** `test/ir/workflow-send.test.ts`

# D-HANDLE-REMOVAL — workflow `handle` is removed; `commandHandler` is the named command entry

**Status:** applied — the owner signed option (b), remove, on 2026-10-21
(#3316 / M-T6.58, recorded on #3458), and the removal shipped as a hard cutover
with a codemod per the breaking-change policy (#3608): `HandleDecl` left the
grammar together with `HandleIR`, `WorkflowIR.handlers`, `lowerHandle` and
`loom.workflow-handle-unsupported`; a leftover `handle` is the parse error
`loom.parse-error#workflow-handle-removed`, which names `commandHandler` and
`scripts/codemod-workflow-handle.mjs`.  The named-`create` half of the original
question is NOT part of this removal — a named command-triggered `create` still
parses, and its missing route is tracked on #4094.

**Question.** Does the workflow `handle name(...) { … }` declaration become a
shipping HTTP entry point on all five backends, or is it removed as redundant
with `commandHandler`?

**Options.** (a) emit a route per `handle` on all five and design the addressing
surface it lacks; (b) remove the declaration — grammar, lowering, and the
diagnostic that promises it — and point authors at `commandHandler`; (c) keep it
parsing behind an honest refusal.

**Decision.** (b) — remove, in one step: the grammar removal and the refusal
(a parse error naming `commandHandler`) landed together, so (c) was not needed.

**Rationale.**

- **The addressing surface does not exist.** `HandleDecl`
  (`src/language/ddd.langium:1488-1491`) is
  `'handle' name '(' params ')' ('requires' gate)? '{' body '}'` — **no `by`
  clause**, unlike its sibling `WorkflowCreateDecl` (`:1473-1476`, which carries
  `('by' correlation=CorrelationExpr)?`) and unlike `OnDecl`, whose `by` was
  deferred *with a written reason*. `HandleIR`
  (`src/ir/types/loom-ir.ts:1361-1368`) carries `name`/`params`/`statements`/
  `savesAtExit` and no correlation. So even a fully built route cannot say WHICH
  saga instance it runs against: option (a) is not "write five emitters", it is
  "design a correlation surface first, then write five emitters".
- **`commandHandler` already covers the use case**, with a full emitter on all
  five and an explicit-handler route surface.
- **Three places promise routing and zero deliver.** Lowering fills
  `WorkflowIR.handlers` (`src/ir/lower/lower-workflow.ts:124-174`),
  `test/ir/workflow-handle.test.ts` pins it, and `loom.duplicate-handler`
  (`src/diagnostics/messages.ts:314-317`) tells the author that
  "a `route -> <Ctx>.<name>` would be ambiguous" — while every emitter drops it
  through the same fail-open `if (!h) continue;`. Named `create` is dropped by a
  different mechanism (`lowerWorkflow` picks one primary).
- **Owner-only** because a default must never take a keyword out of the language
  unattended.

**Consequences.** `handle` stops parsing (it is an ordinary name again); `HandleIR`,
`WorkflowIR.handlers` and `lowerHandle` are deleted; `loom.duplicate-handler`
loses its workflow-`handle` clause and keeps the handler-vs-handler arm.  The
migration is `scripts/codemod-workflow-handle.mjs`: it lifts each `handle` into a
`commandHandler` written after its workflow, and leaves in place, marked, the
ones with no faithful rewrite — a body reading the workflow's own state or
helpers, an `eventSourced` workflow, a `requires` gate or modifier (a
`commandHandler` takes none), a parameter named `id`, a body reaching more than
one aggregate, or a name clash.  `docs/workflow.md` § "There is no `handle`"
carries the migration note.  No correlation-addressed continuation
(`handle f(…) by <expr>`) will be designed.

**Unblocks.** M-T6.58 → wave **C1 packet 1a**.

**Sources.** [`T6-backend-parity.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T6-backend-parity.md) M-T6.58 + its
2026-09-09 fleet note;
[`2026-09-03-language-docs-audit-findings.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/2026-09-03-language-docs-audit-findings.md)
F13; `src/language/ddd.langium`, `src/ir/types/loom-ir.ts`,
`src/ir/lower/lower-workflow.ts`, `src/diagnostics/messages.ts`.

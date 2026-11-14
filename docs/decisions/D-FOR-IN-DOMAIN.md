# D-FOR-IN-DOMAIN — `for` in a domain body is an honest gap with a successor; `variant-match` and `if let` outside their home are permanent refusals

**Status:** applied — the proposed default took effect 2026-09-13 (merged to `main` 2026-09-11 in #2863; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).

**Question.** `for`, `if let` and `variant-match` all parse inside an operation
body but lower only inside a workflow (or a page) — is each a permanent refusal,
or a refusal today with lowering promised?

**Options.** Gate all three permanently; lower all three; or split them.

**Decision.** Split, as the 2026-09-09 fleet recommended. **`variant-match`
outside a ui action → permanent refusal. `if let` outside a workflow → permanent
refusal. `for` in a domain body → honest gap: a refusal code today, with a NAMED
successor mission to lower it.**

**Rationale.**

- **All three are silent today, so a code is the floor under every option.**
  `src/ir/lower/lower-stmt.ts` (the domain-body lowerer) has no `ForStmt` or
  `IfLetStmt` arm at all and ends in
  `return { stmt: { kind: "call", target: "function", name: "<unknown>", args: [] } }`
  (`:374-378`), so `operation touch() { for n in notes { owner := n } }` reports
  `0 error(s), 0 warning(s)` and emits `this.<unknown>();`. `variant-match`
  reaches `src/generator/_stmt/target.ts` and throws.
- **`for` differs in KIND, not only in cost.** `ForStmt` sits in the shared
  `Statement` union (`ddd.langium:2075-2091`), and `lower-workflow.ts:588`
  already lowers it with a per-iteration save — iterating a collection inside an
  operation is an ordinary domain shape the language cannot otherwise express.
  `variant-match` is frontend-shaped by construction (its arms render event
  handlers) and `if let` is the workflow's `repo-let` narrowing; both have a home
  the author is being pointed back to, and `for` does not.
- A "permanent" refusal on `for` would be re-opened the first time somebody
  models a bulk operation. Naming the successor now costs one heading and stops
  the code being read as a decision that iteration is unwanted.

**Consequences.** Three codes in `src/diagnostics/messages.ts` (C1 packet 1b is
the only packet permitted to mint), each with a `code-docs.ts` anchor and a
firing fixture. The `for` code's message says *not yet lowered in a domain body*
and names its successor; the other two say *by design* and name the construct's
home. Neither message may recommend the .NET/Java `match`-error form until
M-T6.61's binding fix is in. The `<unknown>` fallback in `lower-stmt.ts` is
itself a silent sentinel of the M-T9.55 class and is routed through the give-up
gate in the same wave.

**Unblocks.** M-T5.28 → wave **C1 packet 1b**.

**Amendment (2026-11-02, #3367, consistent with D-FAILURE-MODEL).** The
`variant-match` half no longer stands as a permanent refusal. D-FAILURE-MODEL
makes an expected failure a value the caller must handle, and its last bullet —
"workflows return `or E` too, once a workflow body can `match` a result" — needs
a body that branches on that value with statements. So the statement `match` is
**legal** in every body that runs effects: an aggregate `operation`, `create`,
`destroy`, a domain-service operation, a workflow `create` / `on`, and a
`commandHandler` / `queryHandler`. Its subject is a value the body already holds
(a union `let`, a `T?` param / field / read) and must be a name, not a call
(`loom.match-subject-not-simple`). A `T?` subject is a presence check, as for
the value form (D-ABSENCE-MODEL). In a workflow / handler body an arm does not
`return` (the body answers once, after it has run), and an aggregate an arm
binds and changes is saved at the end of that arm, as in an `if let` branch.

It stays **refused** (`loom.variant-match-placement`) in the PURE bodies — an
event-sourced `apply` fold, a projection `on` fold and a `function` — because a
fold is a straight-line state transition (replayed per event) and a function
computes a value: neither has an effect for an arm to run, and the value form
`let x = match r { … }` already expresses a choice there. The original rationale
("its arms render event handlers") described the action form only; the backend
statement spines (`_stmt/target.ts`, `_workflow/stmt-target.ts`) now give it a
form on node, .NET, Java and Python, and Phoenix renders it as a
value-producing `case` in an operation / domain service and a `case`
with-clause in a workflow / handler.  On Phoenix
`loom.elixir-match-stmt-unsupported` (`scope`, D-ELIXIR-IF-BRANCH) refuses the
`if` statement's four body-building sub-shapes and a union of two success
variants. The `if let` and `for` halves are unchanged.

**Sources.** [`T5-language-core.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T5-language-core.md) M-T5.28;
[`2026-09-03-language-docs-audit-findings.md`](https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/audits/2026-09-03-language-docs-audit-findings.md)
F1/F4; `src/ir/lower/lower-stmt.ts`, `src/ir/lower/lower-workflow.ts`,
`src/generator/_stmt/target.ts`, `src/language/ddd.langium`.

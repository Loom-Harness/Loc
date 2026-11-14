# D-PAGE-BODY-EXPRESSION — a page body is an expression tree; the statement `if` stays refused on every frontend

**Status:** applied — the proposed default took effect 2026-09-16 (merged to `main` 2026-09-14 in #2933; no override recorded by 2026-09-28; flipped by Wave C5 packet 5.0).
Raised by wave C2 packet 2f, which was asked to give
`loom.if-stmt-page-body-unsupported` a mission id or a D-tag.

**Question.** `loom.if-stmt-page-body-unsupported` refuses an `if` STATEMENT in a
`ui` page / component / store body on **every** frontend. It sits in the
`*-unsupported` register as a `scope` row with no owner — so is it a v1 limit
someone should drain, or the shape of the surface?

**Options.** (a) keep it a `scope` row and commission a mission that gives page
bodies statement-form control flow on all six frontends; (b) rule the limit
permanent and rename the code out of the `-unsupported` suffix; (c) leave it
unowned.

**Decision.** (a) is declined and (c) is not an option, but the code KEEPS its
name and its row: **the limit is ruled permanent in substance, and the row is
re-pointed at M-T1.20** — the mission that already IS the register of frontend
refusals accepted in `.ddd`, and therefore the place a reader looks for "what
does the page surface refuse, and why". The `scope` kind is correct — a declared
v1 limit with a named owner — and renaming the code would cost a rename across
six emitters and the docs for no behavioural change.

**Rationale.**

- **It is not a per-target gap, and never was.** All six frontends refuse it, for
  the same reason: a page body is an EXPRESSION tree. Each emitter builds a
  value — JSX, an Elmish view, a Flutter widget, a HEEx template — so a
  condition there is a value too. The three spellings already exist and are
  rendered on every target: the ternary (`cond ? a : b`), the value-form
  `match { cond => …, else => … }`, and `match await <op>() { … }` for a union
  result. Nothing an author needs is missing; one spelling is.
- **The refusal replaced a crash, not a working path.** Before the gate the JS
  walker hit a bare `throw` on the unknown statement kind — a raw stack trace
  with no code — and the other engines dropped it silently. There is no shipping
  behaviour to preserve on any target.
- **Giving page bodies statements is a surface decision, not a drain.** It would
  mean a statement position in the page metamodel, a rendering strategy per
  engine (JSX has no statement position inside an element tree; HEEx has no
  `handle_event` to hoist from a render), and a printer arm — i.e. a change to
  what a page IS. That belongs to the frontend-surface mission, not to a packet
  sweeping honest gates.
- **So the row's problem was ownership, not classification.** An unowned `scope`
  row reads as "somebody should do this and nobody has"; pointing it at M-T1.20
  — the mission that already collects the frontend refusals accepted in `.ddd`
  — says what it actually is: the thing that would have to change first.

**Consequences.** `loom.if-stmt-page-body-unsupported` gains
`mission: "M-T1.20"` in `src/diagnostics/unsupported-register.ts`. Its three
siblings gated by the same reasoning (`loom.ui-handler-statement-unknown`'s
statement vocabulary) are unaffected. No emitter changes.

**Unblocks.** `loom.if-stmt-page-body-unsupported` → owned (wave **C2 packet 2f**).

**Sources.** `src/ir/validate/checks/if-stmt-checks.ts` (`validateIfStatementPlacement`,
the UI arm); `src/diagnostics/messages.ts` (`loom.if-stmt-page-body-unsupported`);
[`page-metamodel.md`](../page-metamodel.md).

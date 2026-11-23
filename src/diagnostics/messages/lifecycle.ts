// The `lifecycle` family of the diagnostic-message catalog: an aggregate's `create` / `destroy` lifecycle — its guards and the bodies and named actions no backend renders.
//
// A code lives in the family that owns its first segment (`loom.<segment>-…`),
// listed in `segments` below; `../messages.ts` merges every family into
// `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts` fails on a
// key filed under the wrong family.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["lifecycle", "named"] as const;

export const messages = {
  // ----------------------------------------------------------------------
  // src/language/validators/criterion.ts
  // ----------------------------------------------------------------------
  // What a lifecycle `requires` may READ.  Two arms rather than one message
  // with a conditional clause: the reason `create` is narrower than `destroy`
  // is a different fact in each case, and an author hitting one should not have
  // to read past the other.
  "loom.lifecycle-guard-unreadable#create": (p: { agg: unknown; refs: unknown }) =>
    `aggregate '${p.agg}': the \`create\` guard reads ${p.refs}, which the gate cannot see. A \`create\` guard may read \`currentUser\` and the parameters that name a create-input field — there is no instance until the factory runs, and the emitted POST takes the field-derived create input, not the declared parameter list, so any other parameter has no wire slot. \`requires\` answers "may this caller"; a value check belongs in a \`precondition\` on a named \`operation\`.`,
  "loom.lifecycle-guard-unreadable#destroy": (p: { agg: unknown; refs: unknown }) =>
    `aggregate '${p.agg}': the \`destroy\` guard reads ${p.refs}, which the gate cannot see. A \`destroy\` guard may read \`currentUser\` and \`this\` (the route already loads the row), but not a parameter — a DELETE carries no body. \`requires\` answers "may this caller"; a value check belongs in a \`precondition\` on a named \`operation\`.`,
  // The canonical `create` / `destroy` body no backend renders.  `reason` is
  // computed at the call site (it varies by statement kind AND by action), so
  // the catalog owns the frame and the site owns the clause.
  "loom.lifecycle-body-dropped": (p: {
    agg: unknown;
    label: unknown;
    kind: unknown;
    reason: unknown;
    plural: unknown;
  }) =>
    `aggregate '${p.agg}': the \`${p.label}\` body's \`${p.kind}\` is not emitted on a state-based aggregate, so ${p.reason}. A \`create\` body renders only its \`requires\`, \`precondition\`, \`emit\` and \`let\` statements, a \`destroy\` body only its \`requires\` (an event-sourced \`create\` runs its whole body). Move the logic to a named \`operation\`, which emits its guards and statements on every backend, or drop the clause.`,
  // The sibling of the above, one level up: the whole ACTION is dropped, not
  // just its body.  Kept separate because the remedy differs — the canonical
  // case keeps its route and loses the braces, this one has no route to keep.
  "loom.named-lifecycle-dropped": (p: { agg: unknown; label: unknown; name: unknown }) =>
    `aggregate '${p.agg}': the named \`${p.label} ${p.name}\` reaches no backend — it drives no route and no factory, so nothing in its body runs (guards included). ` +
    (p.label === "create"
      ? "Only the canonical (unnamed) `create` is emitted — on an event-sourced aggregate, its single `create`, named or not."
      : "Only the canonical (unnamed) `destroy` is emitted.") +
    ` Drop the name to make it canonical, or model it as an \`operation\`, which emits on every backend.`,
} satisfies Record<string, MessageEntry>;

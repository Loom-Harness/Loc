import { destroyLadder, gateReadsParam, gateReadsRow } from "../../../ir/plan/gate-ladder.js";
import type { AggregateIR, ExprIR, OperationIR } from "../../../ir/types/loom-ir.js";
import { canonicalDestroy } from "../../../ir/util/canonical-lifecycle.js";
import { mergePatchFields } from "../../../ir/util/merge-patch.js";
import { operationGates, type RequiresStmtIR } from "../../../ir/util/op-gates.js";
import { isAlwaysDenyGate } from "../../../ir/util/read-gates.js";

/** `requires true` is the language's documented "intentionally public" escape
 *  (`docs/auth.md` §32) — a gate that can never deny.  It lowers to a plain
 *  boolean literal, and every other backend happily emits the dead branch
 *  (`if (!(true)) throw …` on java, and so on) because their compilers accept
 *  it.
 *
 *  Elixir's does not.  Since 1.18 the type system reports `if not (true) do`
 *  as a TYPING VIOLATION — "the following conditional expression will always
 *  evaluate to false" — which fails `mix compile --warnings-as-errors`, the
 *  flag the generated project's own CI recipe runs.  So on this backend an
 *  always-true gate emits no guard at all: byte-identical to an ungated read,
 *  and semantically exact, since the guard could never have fired.
 *
 *  Deliberately elixir-local.  Constant-folding a literal-`true` `requires` in
 *  phase ⑤ would fix all five backends at once, but it would rewrite four
 *  backends' golden output for zero defect on those four — the wrong trade for
 *  a divergence only one compiler objects to. */
export function isAlwaysPublicGate(gate: ExprIR | undefined): boolean {
  return !!gate && gate.kind === "literal" && gate.lit === "bool" && gate.value === "true";
}

/** The gate to render, or `undefined` when the declared gate is the always-true
 *  escape.  Call this instead of reading `.requires` directly at a guard site. */
export function effectiveGate(gate: ExprIR | undefined): ExprIR | undefined {
  return isAlwaysPublicGate(gate) ? undefined : gate;
}

/** The Elixir spelling of the always-deny gate (`isAlwaysDenyGate` — e.g. the
 *  one enrichment stamps on an undeclared read under denyByDefault, M-T3.19).  NOT the literal `false`: the
 *  1.18 type checker folds `if not (false)` into a typing violation ("will
 *  always evaluate to true"), failing `--warnings-as-errors` — the same reason
 *  `isAlwaysPublicGate` drops `requires true`.  Dropping is not an option here
 *  (the guard is the whole point), so the deny is spelled as a runtime
 *  membership test against the empty allow-set — opaque to the checker, the
 *  same device as the document repository's `__denied?/1`
 *  (`capability-filter.ts`). */
const ELIXIR_ALWAYS_DENY = "Enum.member?([], :default_deny)";

/** Render a gate CONDITION for an `if not (…)` guard — `render` for an
 *  author-written gate, {@link ELIXIR_ALWAYS_DENY} for the synthesised deny. */
export function renderGateCondition(gate: ExprIR, render: (g: ExprIR) => string): string {
  return isAlwaysDenyGate(gate) ? ELIXIR_ALWAYS_DENY : render(gate);
}

/** The hoisted gates the generic merge-patch `update` seam evaluates: the
 *  operation's own `requires` gates (header, `with crudish(requires: …)`) and
 *  the `mask unless` write gates (`src/ir/enrich/mask-taint.ts`).  Shared by
 *  the context seam, the REST action and the LiveView edit form, so the seam's
 *  arity (it takes `current_user` when gated) cannot drift between them.  An
 *  always-true `requires` is dropped (see {@link isAlwaysPublicGate}); empty
 *  for any other operation. */
export function updateSeamGates(op: OperationIR | undefined): RequiresStmtIR[] {
  if (op?.name !== "update" || !mergePatchFields(op)) return [];
  return operationGates(op).filter(
    (g) => g.maskWriteOf !== undefined || !isAlwaysPublicGate(g.expr),
  );
}

/** The merge-patch `update` seam's gates the controller runs BEFORE it loads
 *  the row (`update_<agg>_gate/2`, the gate ladder): the `requires` gates that
 *  read neither the row nor a parameter.  A parameter gate reads the MERGED
 *  value — the stored one when the body omits the key — and a mask write gate
 *  runs only when the body carries its key, so both stay in the seam, after
 *  the load. */
export function updateSeamRowFreeGates(op: OperationIR | undefined): RequiresStmtIR[] {
  return updateSeamGates(op).filter(
    (g) => g.maskWriteOf === undefined && !gateReadsRow(g) && !gateReadsParam(g),
  );
}

/** The canonical `destroy`'s gates the controller runs BEFORE it loads the row
 *  (`delete_<agg>_gate/1`, `destroyLadder`): the ones that read no row. */
export function destroyRowFreeGates(agg: AggregateIR): RequiresStmtIR[] {
  return destroyLadder(canonicalDestroy(agg), { readsIfMatch: false }).flatMap((step) =>
    step.step === "requires" && !isAlwaysPublicGate(step.gate.expr) ? [step.gate] : [],
  );
}

/** The leading `requires` gates of `op` that read no row.  The controller runs
 *  them (`<op>_<agg>_gate/2`) BEFORE it loads the row, so a caller one refuses
 *  gets 403 whether or not the row exists (the gate ladder,
 *  `ir/plan/gate-ladder.ts`). */
export function opRowFreeGates(op: OperationIR): RequiresStmtIR[] {
  return operationGates(op).filter((g) => !gateReadsRow(g));
}

/** The leading `requires` gates of `op` that read the loaded row and can deny:
 *  the `can_<op>` probe folds them into `allowed` (`can_<op>_<agg>/2`). */
export function probeRowGates(op: OperationIR): RequiresStmtIR[] {
  return operationGates(op).filter((g) => gateReadsRow(g) && !isAlwaysPublicGate(g.expr));
}

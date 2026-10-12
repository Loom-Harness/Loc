import type { ExprIR } from "../../../ir/types/loom-ir.js";
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
export const ELIXIR_ALWAYS_DENY = "Enum.member?([], :default_deny)";

/** Render a gate CONDITION for an `if not (…)` guard — `render` for an
 *  author-written gate, {@link ELIXIR_ALWAYS_DENY} for the synthesised deny. */
export function renderGateCondition(gate: ExprIR, render: (g: ExprIR) => string): string {
  return isAlwaysDenyGate(gate) ? ELIXIR_ALWAYS_DENY : render(gate);
}

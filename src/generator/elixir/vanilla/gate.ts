import type { ExprIR } from "../../../ir/types/loom-ir.js";

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

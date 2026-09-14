// Integer-literal precision (M-T5.23 / `D-LONG-AVG-DEFAULTS`).
//
// The `INT` terminal returns a JS `number` (`terminal INT returns number`), so
// the parser has already collapsed a literal past 2^53 by the time any phase can
// look at it: the source `9007199254740993` reaches the AST as
// `9007199254740992`, and every backend then emits THAT — measured on `main`
// @ `09427a5`, `derived big: long = 9007199254740993` emitted
// `get big(): number { return 9007199254740992; }` with zero diagnostics, on a
// model that validated clean.  The .NET / java / elixir emitters would have
// carried the written value exactly; they never saw it.
//
// `D-LONG-AVG-DEFAULTS` declared the 2^53 ceiling for `long` (option (a):
// declare and enforce, rather than upgrade node's representation).  This is its
// COMPILE-TIME half, and it is the one enforcement point that covers every
// target at once — a literal is written once and emitted five times:
//
//   loom.integer-literal-imprecise — the written digits are not the number the
//                                    toolchain holds
//
// The condition is the DECLARED ceiling (`isExactInteger`,
// `src/util/numeric-range.ts` — the same ±(2^53−1) the wire guards enforce),
// not a round-trip comparison of the written text.  Both would catch
// `9007199254740993`; only the ceiling also catches `9007199254740992`, which
// float64 represents exactly but which is one past the range `long` declares —
// and a literal the language accepts that its own wire boundary then refuses is
// the asymmetry this gate exists to remove.

import { AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import { isExactInteger, LONG_SAFE_MAX } from "../../util/numeric-range.js";
import type { Model } from "../generated/ast.js";
import { isIntLit } from "../generated/ast.js";

export function checkIntegerLiteralPrecision(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    if (!isIntLit(node)) continue;
    if (isExactInteger(node.value)) continue;
    // The CST text is the only place the WRITTEN digits survive — `node.value`
    // is already the rounded number, so a message built from it alone cannot
    // show the author what they typed.  Absent (macro-synthesised literal):
    // fall back to the held value.
    const written = node.$cstNode?.text?.trim() ?? String(node.value);
    accept(
      "error",
      diagMessage("loom.integer-literal-imprecise", {
        written,
        held: node.value,
        ceiling: LONG_SAFE_MAX,
      }),
      { node, property: "value", code: "loom.integer-literal-imprecise" },
    );
  }
}

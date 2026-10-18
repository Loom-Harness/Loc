// Host-language rendering of a capability-filter PRINCIPAL TERM
// (`currentUser.role == "agent"`, see `src/ir/util/principal-term.ts`).
//
// Every backend evaluates the term against the request principal in its own
// language and then turns the boolean into a constant query predicate; this
// module owns the part that is the same everywhere — the operand dispatch and
// Loom's null semantics (a null claim equals `null` and differs from every
// value) — and each backend supplies only its spellings.

import type { ExprIR } from "../../ir/types/loom-ir.js";
import type { PrincipalOperand, PrincipalTerm } from "../../ir/util/principal-term.js";

export interface PrincipalTestSpelling {
  /** A `currentUser.<field>` read against the backend's principal accessor. */
  claim(field: string): string;
  /** A literal / enum value, or null when the backend cannot spell it. */
  value(e: ExprIR): string | null;
  isNull(x: string): string;
  isNotNull(x: string): string;
  eq(l: string, r: string): string;
  ne(l: string, r: string): string;
}

function side(o: PrincipalOperand, s: PrincipalTestSpelling): string | null {
  if (o.kind === "claim") return s.claim(o.field);
  if (o.kind === "value") return s.value(o.expr);
  return null;
}

/** The host-language boolean expression for `pt`, or null when an operand
 *  has no spelling on this backend. */
export function renderPrincipalTest(pt: PrincipalTerm, s: PrincipalTestSpelling): string | null {
  // `principalTerm` guarantees at least one claim, so at most one side is null.
  const nullSide = pt.left.kind === "null" ? "left" : pt.right.kind === "null" ? "right" : null;
  if (nullSide) {
    const other = side(nullSide === "left" ? pt.right : pt.left, s);
    if (other === null) return null;
    return pt.op === "==" ? s.isNull(other) : s.isNotNull(other);
  }
  const l = side(pt.left, s);
  const r = side(pt.right, s);
  if (l === null || r === null) return null;
  return pt.op === "==" ? s.eq(l, r) : s.ne(l, r);
}

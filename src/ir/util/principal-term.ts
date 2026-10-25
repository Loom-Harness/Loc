// A PRINCIPAL TERM is a comparison inside a capability `filter` that reads no
// column at all: both operands are principal-side values (`currentUser.<claim>`,
// a literal, an enum value) and at least one is a claim.
//
//     filter currentUser.role == "agent" || this.customer == currentUser.customerId
//            ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//
// Its truth is fixed for the whole request (it depends only on who is asking),
// so every backend evaluates it in the HOST language against the request
// principal and drops the resulting constant into the query as SQL `TRUE` /
// `FALSE` (or the ORM's equivalent).  That is what lets one row filter say
// "agents see every row, customers see their own" — and because a capability
// filter is installed on every read, the synthesised by-id read included, the
// role split covers single-record reads too.
//
// Only `==` / `!=` qualify: an ordering between two host values has no single
// meaning across the five host languages (C# cannot `<` two strings), and the
// motivating shape is a role / flag test.  Null semantics are Loom's: a claim
// that is null equals `null` and differs from every non-null value.
//
// The shape is derived on demand from the expression — no stamp — so the
// validator admitting it and each renderer recognising it ask the same
// question of the same node.

import type { ExprIR, TypeIR } from "../types/loom-ir.js";

/** One side of a principal term. */
export type PrincipalOperand =
  | { readonly kind: "claim"; readonly field: string; readonly type: TypeIR }
  | { readonly kind: "null" }
  | { readonly kind: "value"; readonly expr: ExprIR };

/** A column-free `==` / `!=` comparison over principal-side values. */
export interface PrincipalTerm {
  readonly op: "==" | "!=";
  readonly left: PrincipalOperand;
  readonly right: PrincipalOperand;
}

const VALUE_LITERALS: ReadonlySet<string> = new Set(["string", "int", "long", "bool"]);

function operand(e: ExprIR): PrincipalOperand | null {
  if (e.kind === "paren") return operand(e.inner);
  if (e.kind === "member" && e.receiver.kind === "ref" && e.receiver.refKind === "current-user") {
    // A claim whose type is a collection or a record cannot be compared as a
    // scalar in every host language, so only scalar-shaped claims qualify.
    const t = e.memberType;
    const base = t.kind === "optional" ? t.inner : t;
    const scalar = base.kind === "primitive" || base.kind === "id" || base.kind === "enum";
    return scalar ? { kind: "claim", field: e.member, type: t } : null;
  }
  if (e.kind === "literal") {
    if (e.lit === "null") return { kind: "null" };
    return VALUE_LITERALS.has(e.lit) ? { kind: "value", expr: e } : null;
  }
  if (e.kind === "ref" && e.refKind === "enum-value") return { kind: "value", expr: e };
  return null;
}

/** The principal term `e` is, or null when `e` is anything else (a comparison
 *  that touches a column, an ordering, a non-comparison). */
export function principalTerm(e: ExprIR): PrincipalTerm | null {
  const inner = e.kind === "paren" ? e.inner : e;
  if (inner.kind !== "binary" || (inner.op !== "==" && inner.op !== "!=")) return null;
  const left = operand(inner.left);
  const right = operand(inner.right);
  if (!left || !right) return null;
  if (left.kind !== "claim" && right.kind !== "claim") return null;
  return { op: inner.op, left, right };
}

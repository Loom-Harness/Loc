// The CLIENT-EVALUABLE GATE SUBSET — the one description of which `ExprIR`
// nodes a frontend can evaluate a `requires` gate from.
//
// Six frontends each render a page `requires` gate into their own syntax
// (`_frontend/gate-expr.ts` for the four JS-family targets, `feliz/auth-gate.ts`,
// `flutter/auth-gate.ts`), and every one of them THROWS on a node outside the
// subset — a gate the UI cannot evaluate is a generation-time error, never
// silent degradation.  That stance is right, but the throw was the FIRST thing
// the author heard: a `.ddd` that reported `0 error(s), 0 warning(s)` and then
// died with a bare JS `Error` carrying no `loom.*` code, no page name and no
// source position, having written nothing (audit D2).
//
// So the subset is described HERE, at the IR layer, where the validator can
// reach it — `src/ir/validate/checks/ui-gate-checks.ts` refuses the gate at
// phase ⑦, which is what makes the renderers' throws unreachable-by-construction
// rather than the user-facing diagnostic.  It lives in `ir/util/` because its
// consumers are the IR validator (⑦) and, as documentation, the generators (⑧) —
// `generator → ir` is a forward edge, `ir → generator` is not.

import type { ExprIR } from "../types/loom-ir.js";

/** Why a gate sub-expression is not client-evaluable.  The validator turns this
 *  into the steer it prints; nothing else reads it. */
export type UiGateRejectKind =
  /** A name the browser has nothing to bind — a page param, `this.<field>`, an
   *  unresolved module-scoped reference (`permissions.<name>` outside the
   *  subdomain that declares the catalogue). */
  | "ref"
  /** A method call other than collection membership (`.contains`). */
  | "method"
  /** A literal with no client-side form (`money`, `now`). */
  | "literal"
  /** An expression kind no gate renderer has an arm for (`match`, a call, …). */
  | "kind";

export interface UiGateReject {
  kind: UiGateRejectKind;
  /** The offending sub-expression, printed back in `.ddd`-ish source so the
   *  diagnostic can quote the exact token the author wrote. */
  text: string;
}

/** The first sub-expression of `e` that no frontend gate renderer can evaluate,
 *  or `null` when the whole expression is inside the subset.
 *
 *  Deliberately the INTERSECTION of what the three renderers accept, walked in
 *  the same order they recurse, so the node this names is the node the renderer
 *  would have thrown on. */
export function firstNonUiGateNode(e: ExprIR): UiGateReject | null {
  switch (e.kind) {
    case "ref":
      // `currentUser` is the session user; an enum member compares against its
      // bare wire string.  Everything else is unbound in the browser.
      if (e.refKind === "current-user" || e.refKind === "enum-value") return null;
      return { kind: "ref", text: printGateExpr(e) };
    case "literal":
      return CLIENT_LITERALS.has(e.lit) ? null : { kind: "literal", text: printGateExpr(e) };
    case "member": {
      // Claim access — `currentUser.role`, `currentUser.org.tier`.  When the
      // ROOT of the chain is what's unbound, quote the whole chain: the author
      // wrote `permissions.manage`, and a diagnostic naming only `permissions`
      // sends them looking for a reference they never spelled on its own.
      const bad = firstNonUiGateNode(e.receiver);
      if (bad?.kind === "ref") return { kind: "ref", text: printGateExpr(e) };
      return bad;
    }
    case "method-call":
      // Collection membership is the only method in the gate grammar.
      if (!(e.isCollectionOp && e.member === "contains")) {
        return { kind: "method", text: `.${e.member}(…)` };
      }
      return firstNonUiGateNode(e.receiver) ?? firstFrom(e.args);
    case "binary":
      return firstNonUiGateNode(e.left) ?? firstNonUiGateNode(e.right);
    case "unary":
      return firstNonUiGateNode(e.operand);
    case "paren":
      return firstNonUiGateNode(e.inner);
    case "ternary":
      return (
        firstNonUiGateNode(e.cond) ?? firstNonUiGateNode(e.then) ?? firstNonUiGateNode(e.otherwise)
      );
    default:
      return { kind: "kind", text: printGateExpr(e) };
  }
}

/** The literal kinds every gate renderer has a client-side form for. */
const CLIENT_LITERALS: ReadonlySet<string> = new Set([
  "string",
  "bool",
  "int",
  "long",
  "decimal",
  "null",
]);

function firstFrom(args: readonly ExprIR[]): UiGateReject | null {
  for (const a of args) {
    const bad = firstNonUiGateNode(a);
    if (bad !== null) return bad;
  }
  return null;
}

/** A short `.ddd`-ish rendering of a gate sub-expression, for quoting inside a
 *  diagnostic.  Not a printer — it only has to be recognisable to the author
 *  who wrote the gate, so anything unusual degrades to its IR kind. */
export function printGateExpr(e: ExprIR): string {
  switch (e.kind) {
    case "ref":
      return e.name;
    case "literal":
      return e.lit === "string" ? JSON.stringify(e.value) : e.value;
    case "member":
      return `${printGateExpr(e.receiver)}.${e.member}`;
    case "method-call":
      return `${printGateExpr(e.receiver)}.${e.member}(${e.args.map(printGateExpr).join(", ")})`;
    case "call":
      return `${e.name}(${e.args.map(printGateExpr).join(", ")})`;
    case "binary":
      return `${printGateExpr(e.left)} ${e.op} ${printGateExpr(e.right)}`;
    case "unary":
      return `${e.op}${printGateExpr(e.operand)}`;
    case "paren":
      return `(${printGateExpr(e.inner)})`;
    default:
      return `<${e.kind}>`;
  }
}

// -------------------------------------------------------------------------
// Domain-emit predicates — pure usage probes over the expr/stmt IR, consumed
// by the context / domain-core / controller emitters to decide whether an
// operation references a given `param` or the request `currentUser`.  Leaf
// module: the renderers depend on this, never the reverse.
// -------------------------------------------------------------------------

import { type ExprIR, exprUsesCurrentUser, type StmtIR } from "../../../ir/types/loom-ir.js";

/** True when statement `s` references `currentUser` anywhere in its expr(s) —
 *  e.g. a `requires currentUser.role == "admin"` guard or a `field :=
 *  currentUser.id` assign.  The context function then threads `current_user`
 *  in (mirroring the auditable/stamp principal path) and the controller passes
 *  `conn.assigns[:current_user]`. */
export function stmtUsesCurrentUser(s: StmtIR): boolean {
  switch (s.kind) {
    case "precondition":
    case "requires":
    case "let":
    case "expression":
      return exprUsesCurrentUser(s.expr);
    case "assign":
    case "add":
    case "remove":
    case "return":
      return exprUsesCurrentUser(s.value);
    case "emit":
      return s.fields.some((f) => exprUsesCurrentUser(f.value));
    case "call":
      return s.args.some(exprUsesCurrentUser);
    case "variant-match":
      return (
        exprUsesCurrentUser(s.subject) ||
        s.arms.some((a) => a.body.some(stmtUsesCurrentUser)) ||
        (s.elseBody ?? []).some(stmtUsesCurrentUser)
      );
  }
}

/** True when any statement in the operation body references `currentUser`. */
export function opUsesCurrentUser(op: { statements: readonly StmtIR[] }): boolean {
  return op.statements.some(stmtUsesCurrentUser);
}

export function exprUsesParam(e: ExprIR | undefined, name: string): boolean {
  if (!e) return false;
  if (e.kind === "ref" && e.refKind === "param" && e.name === name) return true;
  return walkExpr(e, (sub) => exprUsesParam(sub, name));
}

/** True when `e` references the aggregate receiver — a `this`/`this-prop`
 *  access, the `id` accessor, or a receiver-prefixed `function` /
 *  `private-operation` call (all of which render the `thisName` binding).
 *  The vanilla function emitter uses this to underscore-prefix an unused
 *  receiver, so a body that never touches the struct (e.g. `function noop()`)
 *  doesn't trip `mix compile --warnings-as-errors` on an unused `record`. */
export function exprUsesReceiver(e: ExprIR | undefined): boolean {
  if (!e) return false;
  if (e.kind === "this" || e.kind === "id") return true;
  if (e.kind === "ref" && e.refKind === "this-prop") return true;
  if (e.kind === "call" && (e.callKind === "function" || e.callKind === "private-operation"))
    return true;
  return walkExpr(e, exprUsesReceiver);
}

export function stmtUsesParam(s: StmtIR, name: string): boolean {
  switch (s.kind) {
    case "precondition":
    case "requires":
    case "let":
    case "expression":
      return exprUsesParam(s.expr, name);
    case "assign":
    case "add":
    case "remove":
    case "return":
      return exprUsesParam(s.value, name);
    case "emit":
      return s.fields.some((f) => exprUsesParam(f.value, name));
    case "call":
      return s.args.some((a) => exprUsesParam(a, name));
    case "variant-match":
      return (
        exprUsesParam(s.subject, name) ||
        s.arms.some((a) => a.body.some((st) => stmtUsesParam(st, name))) ||
        (s.elseBody ?? []).some((st) => stmtUsesParam(st, name))
      );
  }
}

/** Walk one level into `e` and return true if `pred` matches any child.
 *
 *  EXHAUSTIVE over `ExprIR.kind` on purpose: a missing arm is not a missing
 *  feature, it is a WRONG ANSWER — the probes above are how the emitters decide
 *  whether to bind a parameter or underscore it, so a kind this walk does not
 *  descend into makes the generated Elixir read a binding the head never made
 *  (`def fee(%Order{} = record, _q)` over a body that says `q`), and `mix
 *  compile` fails.  The `never` check at the bottom turns a newly added
 *  `ExprIR` kind into a typecheck error rather than a silent under-report. */
function walkExpr(e: ExprIR, pred: (sub: ExprIR | undefined) => boolean): boolean {
  switch (e.kind) {
    case "method-call":
      return pred(e.receiver) || e.args.some((a) => pred(a));
    case "member":
      return pred(e.receiver);
    case "binary":
      return pred(e.left) || pred(e.right);
    case "ternary":
      return pred(e.cond) || pred(e.then) || pred(e.otherwise);
    case "unary":
      return pred(e.operand);
    case "paren":
      return pred(e.inner);
    case "duration":
      // A5 temporal — `days(n)` etc.; the amount may reference a param
      // (`days(graceDays)`), so the usage probes must descend into it or the
      // param's binding line is dropped and the generated body doesn't compile.
      return pred(e.amount);
    case "call":
      return e.args.some((a) => pred(a));
    case "lambda":
      return pred(e.body);
    case "new":
    case "object":
      return e.fields.some((f) => pred(f.value));
    case "list":
      // `[q, 2, 3]` — a bracketed list literal renders its elements verbatim.
      return e.elements.some((x) => pred(x));
    case "convert":
      // Lowering wraps an implicit coercion (`"x" + q` → `to_string(q)`), so the
      // read sits one level down and is invisible without this arm.
      return pred(e.value);
    case "i18nFormat":
      return pred(e.inner);
    case "match":
      // Boolean-arm and variant forms both: every arm condition and value, the
      // `else` value, and the scrutinee.
      return (
        pred(e.subject) || e.arms.some((a) => pred(a.cond) || pred(a.value)) || pred(e.otherwise)
      );
    // Leaves — no child expression to descend into.
    case "literal":
    case "this":
    case "id":
    case "ref":
    case "action-ref":
    case "authz-filter":
      return false;
    default: {
      const never: never = e;
      void never;
      return false;
    }
  }
}

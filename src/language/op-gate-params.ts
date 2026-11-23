// The operation parameters an operation's gates read, read off the AST.
//
// The gates are the signature `requires`, each `requires` the body starts
// with, and the `when`.  Two readers ask before the IR exists: the permission
// query's argument check (`can o.op(args)` may leave out a parameter no gate
// reads — `loom.can-args`) and the scaffold, which writes a permission query
// only for an operation whose `requires` gates read no parameter.  The IR
// settles the same question through `gateReadsParam` (`src/ir/util/op-gates.ts`);
// `test/system/gate-param-twin-census.test.ts` holds the two to the same answer
// over the whole corpus.

import { AstUtils } from "langium";
import {
  type Expression,
  isLambda,
  isNameRef,
  isRequiresStmt,
  type Operation,
} from "./generated/ast.js";

/** The operation's `requires` gate expressions: the signature gate, then each
 *  `requires` the body starts with. */
export function requiresGateExprs(op: Operation): Expression[] {
  const out: Expression[] = op.gate ? [op.gate] : [];
  for (const st of op.body) {
    if (!isRequiresStmt(st)) break;
    out.push(st.expr);
  }
  return out;
}

/** The names of `op`'s parameters that `exprs` read. */
function paramsRead(op: Operation, exprs: readonly Expression[]): Set<string> {
  const names = new Set(op.params.map((p) => p.name));
  const read = new Set<string>();
  for (const e of exprs) {
    for (const n of AstUtils.streamAst(e)) {
      if (!isNameRef(n) || !names.has(n.name)) continue;
      // A lambda parameter of the same name shadows the operation's.
      const lambda = AstUtils.getContainerOfType(n, isLambda);
      if (lambda && lambda.param === n.name) continue;
      read.add(n.name);
    }
  }
  return read;
}

/** The parameters any of the operation's gates read: its `requires` gates and
 *  its `when`. */
export function gateReadParams(op: Operation): Set<string> {
  return paramsRead(op, [...requiresGateExprs(op), ...(op.when ? [op.when] : [])]);
}

/** True when `op` gets a permission query: a public, `when`-gated operation
 *  none of whose gates reads a parameter, so the query answers it from the row
 *  alone.  The AST twin of `isPermissionQueryOp` (`src/ir/util/op-gates.ts`),
 *  read by the scaffold, which expands before the IR exists. */
export function hasPermissionQuery(op: Operation): boolean {
  return !op.private && op.when !== undefined && gateReadParams(op).size === 0;
}

// -------------------------------------------------------------------------
// Page-body gates over what an expression in a RENDERED SLOT may be.  They
// close one failure mode: a `.ddd` that reports `0 error(s), 0 warning(s)`,
// generates a full tree, and then fails to TYPECHECK — the frontend build is
// where the author finds out, in generated code they did not write.
//
//   D3  `loom.markup-primitive-in-collection-lambda`
//       `rows.map(i => Card { Text { i.name } })` emits
//       `{(…).map((i) => Card(Text(i.name)))}` — the primitives become plain
//       FUNCTION CALLS, which nothing imports (`Cannot find name 'Card'`).
//       `.map` is a perfectly legal collection op in expression position and
//       `docs/page-metamodel.md` encourages it, so nothing signalled that the
//       MARKUP case is different.  `For { each: rows, i => Card { … } }` is
//       the spelling that emits real keyed JSX.
//
// IR-level, so it covers every frontend at once rather than the one whose
// emitter happened to be read.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { isCollectionOp as isCollectionOpName } from "../../../util/collection-ops.js";
import { isWalkerPrimitive } from "../../../util/walker-primitive-names.js";
import type { ComponentIR, ExprIR, PageIR, StmtIR, StoreIR } from "../../types/loom-ir.js";
import { walkExprChildren, walkExprDeep, walkStmtChildren } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

// =========================================================================
// D3 — a markup primitive constructed inside a collection-op lambda
// =========================================================================

/** Every free call the walker would dispatch as a PRIMITIVE, reachable from
 *  `e`.  Used to answer "does this lambda body build markup?". */
function markupInside(e: ExprIR): string | undefined {
  let found: string | undefined;
  walkExprDeep(e, (n) => {
    if (found !== undefined) return;
    if (n.kind === "call" && n.callKind === "free" && isWalkerPrimitive(n.name)) found = n.name;
  });
  return found;
}

/** `loom.markup-primitive-in-collection-lambda` — a walker primitive built
 *  inside a collection-op lambda.
 *
 *  The op's lambda is lowered as an ORDINARY expression lambda: every frontend
 *  renders its body through the expression renderer, not the body walker, so a
 *  primitive there comes out as a bare function call against a name no import
 *  provides.  `For { each: …, x => … }` is the primitive whose lambda IS a
 *  render slot. */
export function checkMarkupInCollectionLambda(
  host: PageIR | ComponentIR | StoreIR,
  where: string,
  diags: LoomDiagnostic[],
): void {
  // One diagnostic per (op, primitive) pair — a `.map` building a card with
  // four nested primitives is ONE mistake, not four.
  const flagged = new Set<string>();
  const visit = (e: ExprIR): void => {
    // BOTH spellings of "this is a collection op": the `isCollectionOp` flag
    // lowering sets when the receiver types as a collection, and the catalogue
    // NAME.  A page-body binding is often type-erased (`rows` lowers with a
    // placeholder `string` type), so `rows.where(λ)` carries the flag OFF while
    // `rows.map(λ)` carries it on — keying on the flag alone would have caught
    // the audit's `.map` and missed its siblings.  The lambda-plus-markup
    // requirement below is what keeps this free of false positives: a lambda
    // ARGUMENT carrying a walker primitive has no legitimate reading, while a
    // primitive's own lambda SLOT (`Column("Name", i => Text { i.name })`) is a
    // `call`, never a `method-call`, so it never reaches here.
    if (e.kind === "method-call" && (e.isCollectionOp || isCollectionOpName(e.member))) {
      for (const arg of e.args) {
        if (arg.kind !== "lambda") continue;
        const primitive = arg.body ? markupInside(arg.body) : undefined;
        if (primitive === undefined) continue;
        const key = `${e.member}:${primitive}`;
        if (flagged.has(key)) continue;
        flagged.add(key);
        diags.push({
          severity: "error",
          code: "loom.markup-primitive-in-collection-lambda",
          message: diagMessage("loom.markup-primitive-in-collection-lambda", {
            where,
            op: e.member,
            primitive,
            param: arg.param,
          }),
          source: where,
        });
      }
    }
    walkExprChildren(e, { expr: visit, stmt: visitStmt });
  };
  const visitStmt = (s: StmtIR): void => walkStmtChildren(s, visit, visitStmt);
  for (const e of renderedExprs(host)) visit(e);
  for (const action of host.actions) for (const s of action.body) visitStmt(s);
}

// =========================================================================

/** The expressions a frontend RENDERS for this host.  Mirrors
 *  `walkerRenderedExprs`, plus the store shape (whose body-less form carries
 *  only state initialisers). */
function renderedExprs(host: PageIR | ComponentIR | StoreIR): ExprIR[] {
  const out: ExprIR[] = [];
  const push = (e?: ExprIR) => {
    if (e) out.push(e);
  };
  if ("body" in host) push(host.body);
  if ("title" in host) push(host.title);
  if ("derived" in host) for (const d of host.derived) push(d.expr);
  for (const s of host.state) push(s.init);
  return out;
}

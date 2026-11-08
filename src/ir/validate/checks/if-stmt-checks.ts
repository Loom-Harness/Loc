// ---------------------------------------------------------------------------
// `if` statement placement gate (M-FT.11).
//
// The `if <cond> { … } else { … }` STATEMENT renders in every domain body on
// all five backends.  Lowering rewrites an early `return` into branch-total
// form (`src/ir/util/if-normal-form.ts`), so a `return` reaches every renderer
// as the last statement of its block, and the Phoenix operation renderers turn
// a tail `if` whose branches decide per path what the body persists, guards or
// emits into one complete body per branch (`vanilla/op-tree.ts`).
//
// One place it can be WRITTEN does not render it: a UI page / component /
// store body, on ANY frontend.  A page body is an expression tree: it
// expresses a condition as a VALUE (a ternary or `match`), and the JS walker /
// Feliz update / Flutter notifier / HEEx handler emitters each have no
// statement-position conditional.  They fail fast on an unknown statement
// kind, so without this gate the author gets a codegen crash instead of a
// diagnostic.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel, StmtIR } from "../../types/loom-ir.js";
import { walkExprStmtsDeep, walkStmtDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** True when any statement in `stmts` (or nested in one of them, or in a
 *  block-body lambda one of them carries) is an `if`. */
function containsIf(stmts: readonly StmtIR[]): boolean {
  let found = false;
  for (const s of stmts) {
    walkStmtDeep(s, (n) => {
      if (n.kind === "if") found = true;
    });
  }
  return found;
}

export function validateIfStatementPlacement(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
  validatePageBodyIf(loom, diags);
}

/** An `if` anywhere in a ui body, on every frontend. */
function validatePageBodyIf(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  for (const sys of loom.systems) {
    for (const ui of sys.uis) {
      const flag = (where: string, stmts: readonly StmtIR[]): void => {
        if (!containsIf(stmts)) return;
        diags.push({
          severity: "error",
          code: "loom.if-stmt-page-body-unsupported",
          message: diagMessage("loom.if-stmt-page-body-unsupported", { where, uiName: ui.name }),
          source: `${ui.name}/${where}`,
        });
      };
      // A page/component BODY is an expression, but its inline handler lambdas
      // (`onClick: e => { … }`) carry statement blocks — reached through
      // `walkExprStmtsDeep`, the same channel `walkStmtDeep` uses internally.
      const bodyStmts = (body: unknown): StmtIR[] => {
        const out: StmtIR[] = [];
        walkExprStmtsDeep(body as never, (s) => out.push(s));
        return out;
      };
      for (const p of ui.pages) {
        for (const a of p.actions) flag(`page '${p.name}' action '${a.name}'`, a.body);
        flag(`page '${p.name}' body`, bodyStmts(p.body));
      }
      for (const c of ui.components) {
        for (const a of c.actions) flag(`component '${c.name}' action '${a.name}'`, a.body);
        flag(`component '${c.name}' body`, bodyStmts(c.body));
      }
      for (const st of ui.stores) {
        for (const a of st.actions) flag(`store '${st.name}' action '${a.name}'`, a.body);
      }
    }
  }
}

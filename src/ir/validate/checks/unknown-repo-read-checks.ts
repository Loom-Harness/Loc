// ---------------------------------------------------------------------------
// A repository read by a name no contract verb spells (`loom.repo-unknown-read`).
//
// A repository declares no reads of its own (D-FINDDECL-REMOVED), so
// `Orders.byCode(c)` in an expression — a domain-service operation, a handler,
// a guard — resolves to nothing.  It lowers to a `repo-read` call with op
// `unknown-read` (its type falls back to the bare aggregate so the rest of the
// body still types), and no backend has a method to call: unrefused, the
// generated code calls a repository method that does not exist.  The workflow
// `let` form has its own code (`loom.workflow-unknown-repository-method`); this
// covers every other expression position.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { nearestName } from "../../../util/edit-distance.js";
import { REPOSITORY_CONTRACT } from "../../../util/repository-contract.js";
import type { BoundedContextIR } from "../../types/loom-ir.js";
import { forEachContextExpr } from "../../util/model-exprs.js";
import type { LoomDiagnostic } from "./diagnostic.js";

const READ_VERBS = REPOSITORY_CONTRACT.filter((c) => c.face === "read").map((c) => c.verb);

export function validateUnknownRepositoryReads(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  const seen = new Set<string>();
  forEachContextExpr(ctx, ({ expr, source }) => {
    if (expr.kind !== "call" || expr.callKind !== "repo-read") return;
    const read = expr.repoRead;
    if (read?.op !== "unknown-read") return;
    const key = `${source}\0${read.repo}.${read.method}`;
    if (seen.has(key)) return;
    seen.add(key);
    diags.push({
      severity: "error",
      code: "loom.repo-unknown-read",
      message: diagMessage("loom.repo-unknown-read", {
        repoName: read.repo,
        method: read.method,
        suggestion: nearestName(read.method, READ_VERBS),
      }),
      source,
      origin: expr.origin ?? ctx.origin,
    });
  });
}

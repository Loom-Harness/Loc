// ---------------------------------------------------------------------------
// A `return match { … }` tagged per arm on the vanilla Phoenix backend.
//
// Each arm answers its own tagged tuple, so the error tuple is the result only
// when the error arm runs:
//
//     cond do
//       kind == :Reject ->
//         {:error, "Rejected", %{reason: notes}}
//       true ->
//         {:ok, Map.put(%{notes: notes}, :type, "Repaired")}
//     end
//
// The variant form is a value `case` over the subject's tagged tuple, one
// clause per arm (`renderElixirMatchStmt` without a thread variable).  Either
// way the expression is the body's tail value.
// ---------------------------------------------------------------------------

import type { ExprIR, StmtIR } from "../../../ir/types/loom-ir.js";
import { distributeUnionReturn, unionReturnBranches } from "../../../ir/util/union-return.js";
import { renderElixirMatchStmt } from "./match-stmt-emit.js";

type ReturnStmt = Extract<StmtIR, { kind: "return" }>;

/** Every line of `text` shifted right by `pad`; blank lines stay blank. */
function indentBlock(text: string, pad: string): string {
  return text
    .split("\n")
    .map((l) => (l.trim() === "" ? "" : pad + l))
    .join("\n");
}

export interface ElixirUnionReturnOpts {
  /** Indent of the `cond` / `case` / `end` keywords, e.g. `"    "`. */
  readonly indent: string;
  readonly renderExpr: (e: ExprIR) => string;
  /** Render one arm's tagged `return` (its tuple), at the caller's own base
   *  indent — this helper re-indents. */
  readonly renderReturn: (s: ReturnStmt) => string;
}

/** Render a per-arm tagged `return` (`armVariants` set) as a value `cond` /
 *  `case`; null for any other `return`. */
export function renderElixirUnionReturn(s: ReturnStmt, opts: ElixirUnionReturnOpts): string | null {
  if (!s.armVariants) return null;
  const { indent, renderExpr, renderReturn } = opts;
  const branches = unionReturnBranches(s);
  if (branches) {
    const lines = branches.flatMap((b) => [
      `${indent}  ${b.cond ? renderExpr(b.cond) : "true"} ->`,
      indentBlock(renderReturn(b.ret).trimStart(), `${indent}    `),
    ]);
    return [`${indent}cond do`, ...lines, `${indent}end`].join("\n");
  }
  const distributed = distributeUnionReturn(s);
  if (distributed.kind !== "variant-match") return null;
  return renderElixirMatchStmt(distributed, {
    indent,
    subject: renderExpr(distributed.subject),
    renderInner: (stmts) => stmts.map((st) => (st.kind === "return" ? renderReturn(st) : "")),
  });
}

/** True when `s` can answer an `error` variant: a whole-value error return,
 *  or a per-arm return with an error arm.  `isError` classifies a tag. */
export function returnCanFail(s: ReturnStmt, isError: (tag: string) => boolean): boolean {
  if (s.armVariants) return s.armVariants.some((v) => isError(v.variantTag));
  return s.variantTag !== undefined && isError(s.variantTag);
}

/** True when `s` only ever answers an `error` variant. */
export function returnAlwaysFails(s: ReturnStmt, isError: (tag: string) => boolean): boolean {
  if (s.armVariants) return s.armVariants.every((v) => isError(v.variantTag));
  return s.variantTag !== undefined && isError(s.variantTag);
}

// ---------------------------------------------------------------------------
// The four type-grounded variant-`match` gates, in ONE place (audit finding
// F56).
//
// `match` has two IR shapes: an `ExprIR` (`kind: "match"`, arms in
// `variantArms`, else in `otherwise`) and a `StmtIR` (`kind: "variant-match"`,
// arms in `arms`, else in `elseBody`).  The gates lived only on the expression
// side, inside `validateVariantMatch`'s visitor, and reached the model through
// `forEachModelExpr` — which hands over EXPRESSIONS.  A `match` written as a
// STATEMENT in a page / component / store action therefore had none of the four
// run.
//
// M-T9.40 already fixed the *expression* half of this exact reach problem
// ("a `match` written anywhere the copy did not reach … was parsed, lowered and
// emitted with none of its four semantic gates run") by widening that visitor
// to `forEachModelExpr`.  The statement form was simply never in scope, because
// no model-wide statement walk exists.  It does not need one: `variant-match`
// is frontend-only, so the three `ActionIR` carriers — `PageIR`, `ComponentIR`,
// `StoreIR` — are the whole surface.
//
// What that gap shipped: `match await <plain state field>` over a `string`
// validates with ZERO diagnostics, and all four SPA walkers then emit
//
//     await Promise.reject(new Error("no remote op for variant-match"))
//
// as their "no detected remote op" fallback — a guaranteed unhandled rejection
// on every invocation, plus arms binding a discriminant that cannot exist.  The
// fallback is commented in each target as a "typed placeholder … so the
// statement is never dropped": the intent was to avoid a SILENT DROP, and the
// result was a runtime bomb instead.  The right layer to refuse it is here, in
// phase ⑦ — the generator cannot raise a `loom.*` diagnostic without inverting
// the pipeline.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { typeKey, variantTag } from "../../stdlib/unions.js";
import type { StmtIR, TypeIR } from "../../types/loom-ir.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The shape both `match` forms reduce to, so one gate serves both. */
export interface VariantMatchShape {
  subjectType?: TypeIR;
  arms: readonly { varType: TypeIR }[];
  /** True when an `else` / `otherwise` branch is present — it makes any
   *  uncovered variant intentional, so the exhaustiveness warning stands down. */
  hasElse: boolean;
}

/**
 * Run the four type-grounded gates over one variant `match`:
 * non-union subject, unknown variant, duplicate variant, non-exhaustive.
 * The AST validator owns the syntactic constraints (empty match,
 * subject-not-simple); these need the resolved union variant set.
 */
export function checkVariantMatchShape(
  m: VariantMatchShape,
  source: string,
  diags: LoomDiagnostic[],
): void {
  const subjectType = m.subjectType;
  // Non-union subject — the scrutinee must resolve to an `or`-union.
  if (subjectType?.kind !== "union") {
    diags.push({
      severity: "error",
      code: "loom.match-non-union-subject",
      message: diagMessage("loom.match-non-union-subject", {
        subjectType: subjectType ? typeKey(subjectType) : "unresolved",
      }),
      source,
    });
    return;
  }
  const variantKeys = new Set(subjectType.variants.map(typeKey));
  const covered = new Set<string>();
  for (const arm of m.arms) {
    const key = typeKey(arm.varType);
    // Unknown variant — the arm names a type outside the union's set.
    if (!variantKeys.has(key)) {
      diags.push({
        severity: "error",
        code: "loom.match-unknown-variant",
        message: diagMessage("loom.match-unknown-variant", {
          varType: variantTag(arm.varType),
          variants: [...subjectType.variants.map(variantTag)].join(" | "),
        }),
        source,
      });
      continue;
    }
    // Duplicate variant — the same variant matched twice.
    if (covered.has(key)) {
      diags.push({
        severity: "error",
        code: "loom.match-duplicate-variant",
        message: diagMessage("loom.match-duplicate-variant", {
          varType: variantTag(arm.varType),
        }),
        source,
      });
      continue;
    }
    covered.add(key);
  }
  // Non-exhaustive — some variant is uncovered and there is no else.
  if (m.hasElse) return;
  const missing = [...variantKeys].filter((k) => !covered.has(k));
  if (missing.length === 0) return;
  const missingTags = subjectType.variants
    .filter((v) => missing.includes(typeKey(v)))
    .map(variantTag);
  diags.push({
    severity: "warning",
    code: "loom.match-non-exhaustive",
    message: diagMessage("loom.match-non-exhaustive", {
      missingTags: missingTags.map((t) => `'${t}'`).join(", "),
    }),
    source,
  });
}

/** Every `variant-match` statement in an action body, at any depth (arms and
 *  `else` nest). */
export function forEachVariantMatchStmt(
  stmts: readonly StmtIR[],
  visit: (s: Extract<StmtIR, { kind: "variant-match" }>) => void,
): void {
  for (const s of stmts) {
    if (s.kind !== "variant-match") continue;
    visit(s);
    for (const arm of s.arms) forEachVariantMatchStmt(arm.body, visit);
    forEachVariantMatchStmt(s.elseBody ?? [], visit);
  }
}

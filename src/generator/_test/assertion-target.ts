// The one renderer for a value assertion in a generated unit or integration
// test.  WHAT the assertion compares is decided once in the plan
// (`assertionPlan`, src/ir/plan/test-assertion.ts); each test framework
// supplies only the spelling of each comparison kind, the same
// contract-plus-leaf-table shape as `_expr/target.ts`.

import {
  type AssertionCompare,
  type AssertionPlan,
  type AssertionRelation,
  assertionPlan,
} from "../../ir/plan/test-assertion.js";
import { unionInstanceName } from "../../ir/stdlib/unions.js";
import type { ExprIR } from "../../ir/types/loom-ir.js";
import { applyLiteralCoercion, type TestLiteralTarget } from "./arg-coercion.js";

/** One comparison, rendered operands in hand. */
export interface CompareOperands {
  relation: AssertionRelation;
  negate: boolean;
  /** The subject may be absent (`AssertionPlan.optional`). */
  optional: boolean;
  /** The subject, rendered by the backend's own subject renderer. */
  actual: string;
  /** The expected value, coerced to the subject's type. */
  expected: string;
}

/** A test framework's spelling of each assertion the plan can decide. */
export interface AssertionTarget {
  /** One leaf per comparison kind. */
  compare: Readonly<Record<AssertionCompare, (c: CompareOperands) => string>>;
  isNull(negate: boolean, actual: string): string;
  contain(
    within: "collection" | "string",
    negate: boolean,
    actual: string,
    expected: string,
  ): string;
  /** Which arm of a returned union `actual` is: the declared error `tag`, its
   *  arm class `<union>_<tag>` where the backend generates one per arm. */
  tag(negate: boolean, actual: string, arm: { union: string; tag: string }): string;
  /** The expected value's literal leaves (`_test/arg-coercion.ts`). */
  literal: TestLiteralTarget;
}

/** How the backend renders the two operands.  `renderSubject` may wrap the
 *  subject where the framework's syntax binds tighter than the expression
 *  (C#'s postfix `.Should()`, Python's chained comparisons). */
export interface AssertionOperands {
  renderSubject(e: ExprIR): string;
  renderExpected(e: ExprIR): string;
}

/** Render `expr` when it is a value matcher, else `null` (a bare boolean
 *  `expect(x)`, which the caller asserts true). */
export function renderAssertion(
  expr: ExprIR,
  target: AssertionTarget,
  operands: AssertionOperands,
): string | null {
  const plan = assertionPlan(expr);
  return plan === undefined ? null : renderAssertionPlan(plan, target, operands);
}

export function renderAssertionPlan(
  plan: AssertionPlan,
  target: AssertionTarget,
  operands: AssertionOperands,
): string {
  const actual = operands.renderSubject(plan.subject);
  switch (plan.kind) {
    case "null":
      return target.isNull(plan.negate, actual);
    case "tag":
      return target.tag(plan.negate, actual, {
        union: unionInstanceName(plan.variants),
        tag: plan.tag,
      });
    case "contain":
      return target.contain(
        plan.within,
        plan.negate,
        actual,
        operands.renderExpected(plan.expected),
      );
    case "compare": {
      const expected = applyLiteralCoercion(
        plan.expectedLiteral,
        operands.renderExpected(plan.expected),
        target.literal,
      );
      return target.compare[plan.compare]({
        relation: plan.relation,
        negate: plan.negate,
        optional: plan.optional,
        actual,
        expected,
      });
    }
    default: {
      const never: never = plan;
      return never;
    }
  }
}

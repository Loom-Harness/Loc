// The FastAPI `responses=` entries a route declares.  FastAPI builds the
// published OpenAPI document from these alone (D-OPENAPI-FRAMEWORK-NATIVE):
// each error status names ProblemDetails (or, at an op-return union's error-arm
// status, the arm's problem bodies) under `application/problem+json`, and a
// union route names its tagged success body at 200.  The statuses come from the
// shared derivations (`errorStatuses`, `deriveAggregateOperations`,
// `routedErrorStatuses`); the union split from `opUnionResponses`.

import type { BoundedContextIR, TypeIR } from "../../ir/types/loom-ir.js";
import { pyRef } from "../_imports/python.js";
import { errorStatusJsonSchema, opUnionResponses } from "../_payload/union-wire.js";
import { pyProblemResponseEntry } from "./wire-policy-py.js";

/** The module that declares ProblemDetails and the op-return union bodies. */
const PROBLEM_MODULE = "app.http.problem";

/** FastAPI's `$ref` to a component it publishes under its model's name. */
export function componentRef(name: string): string {
  return `#/components/schemas/${name}`;
}

/** The union whose split a route's responses publish: the variants of an
 *  operation's / entry point's `T or E` result, and the context resolving the
 *  error arms' statuses. */
export interface PyResponseUnion {
  variants: TypeIR[];
  ctx: BoundedContextIR;
}

/** The `responses=` entries for a route declaring `statuses` (ascending).
 *  With a `union`, the 200 names the union's success body, and each status an
 *  error arm answers names ProblemDetails plus the arms' problem bodies. */
export function pyResponseEntries(statuses: readonly number[], union?: PyResponseUnion): string[] {
  const split = union ? opUnionResponses(union.variants, union.ctx) : undefined;
  const armsAt = new Map(split?.errorStatuses.map((e) => [e.status, e.arms]) ?? []);
  const problemDetails = pyRef(PROBLEM_MODULE, "ProblemDetails");
  return [
    ...(split
      ? [`200: {"model": ${pyRef(PROBLEM_MODULE, split.successName)}, "description": "OK"}`]
      : []),
    ...statuses.map((st) => {
      const arms = armsAt.get(st);
      if (!arms) return pyProblemResponseEntry(st, problemDetails);
      const model = [problemDetails, ...arms.map((a) => pyRef(PROBLEM_MODULE, a.problemName))];
      const content = {
        "application/problem+json": {
          schema: errorStatusJsonSchema(arms, "ProblemDetails", componentRef),
        },
      };
      return pyProblemResponseEntry(st, model.join(" | "), JSON.stringify(content));
    }),
  ];
}

/** `pyResponseEntries` as the decorator's `, responses={…}` kwarg, or "" when
 *  the route declares nothing. */
export function pyResponsesKwarg(statuses: readonly number[], union?: PyResponseUnion): string {
  const entries = pyResponseEntries(statuses, union);
  return entries.length === 0 ? "" : `, responses={${entries.join(", ")}}`;
}

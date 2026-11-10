// The in-app `exists` reads of an aggregate (`exists-reads.ts` derives them).
//
// A `requires` gate or an operation `when` holding `exists <Agg> as s where …`
// is evaluated in the application layer by calling a synthesized find on the
// quantified aggregate's repository.  An emitter that renders such a gate must
// have that repository in scope; these helpers name the reads it will make.

import type { AggregateIR, ExprIR, OperationIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

export type ExistsNode = Extract<ExprIR, { kind: "exists" }>;
export type ExistsReadNode = ExistsNode & { read: NonNullable<ExistsNode["read"]> };

/** Every `exists` in an in-app gate position of `op` — its `when` guard and
 *  its top-level `requires` statements (the gates the application layer runs
 *  before the body), in that order. */
export function inAppExists(op: OperationIR): ExistsNode[] {
  const out: ExistsNode[] = [];
  const take = (e: ExprIR | undefined) =>
    walkExprDeep(e, (x) => {
      if (x.kind === "exists" && !out.includes(x)) out.push(x);
    });
  take(op.when);
  for (const s of op.statements) if (s.kind === "requires") take(s.expr);
  return out;
}

/** The synthesized reads `e` makes. */
export function existsReadsIn(e: ExprIR | undefined): ExistsReadNode[] {
  const out: ExistsReadNode[] = [];
  walkExprDeep(e, (x) => {
    if (x.kind === "exists" && x.read) out.push(x as ExistsReadNode);
  });
  return out;
}

/** True when `e` holds an in-app `exists` read — an expression only the
 *  application layer can evaluate, because it reads a repository. */
export function readsRepository(e: ExprIR | undefined): boolean {
  return existsReadsIn(e).length > 0;
}

/** Every in-app `exists` read the gates of `agg`'s creates, public
 *  operations and destroys make. */
export function aggregateExistsReads(agg: AggregateIR): ExistsReadNode[] {
  return [...agg.creates, ...agg.operations, ...agg.destroys].flatMap((op) =>
    inAppExists(op).filter((x): x is ExistsReadNode => x.read !== undefined),
  );
}

/** The aggregates `agg`'s gates read, deduped, in first-use order. */
export function existsReadAggregates(agg: AggregateIR): string[] {
  return [...new Set(aggregateExistsReads(agg).map((x) => x.aggregate))];
}

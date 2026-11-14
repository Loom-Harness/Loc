// The row a polymorphic base read answers with, for the typed api clients.
//
// `GET /api/<bases>` and (TPH) `GET /api/<bases>/{id}` answer TAGGED rows —
// `{ "type": "Car", …Car's own read wire fields }` — not the abstract base's
// own field list.  Every base-reader builder renders that shape from the
// routed read's variants, so every client reads the same variants here rather
// than re-deriving the hierarchy: each one renders the row as its language's
// discriminated union over the concretes' own response shapes.

import { routedPolymorphicRead } from "../../ir/plan/index.js";
import type { AggregateIR, BoundedContextIR } from "../../ir/types/loom-ir.js";
import type { ApiOperationIR } from "../../ir/util/api-surface.js";

/** One arm of the tagged row: a concrete and the `type` tag its rows carry. */
export interface PolymorphicRowVariant {
  readonly aggregate: AggregateIR;
  readonly tag: string;
}

/** The tagged row a polymorphic base read answers with. */
export interface PolymorphicRow {
  readonly base: AggregateIR;
  readonly variants: readonly PolymorphicRowVariant[];
}

/** The tagged row `op` answers with when it is a polymorphic base read of
 *  `ctx` (`contextOperations`), else `undefined`.  A base read that is not
 *  routed is never in the served surface, so reaching one here is a broken
 *  invariant, not a case to skip. */
export function polymorphicRowOf(
  op: ApiOperationIR,
  ctx: BoundedContextIR,
): PolymorphicRow | undefined {
  if (!op.polymorphicBase) return undefined;
  const base = ctx.aggregates.find((a) => a.name === op.aggregate);
  const read = base ? routedPolymorphicRead(base, ctx) : undefined;
  if (!base || !read) {
    throw new Error(`polymorphic read '${op.id}' has no routed base '${op.aggregate}'`);
  }
  return {
    base,
    variants: read.variants.map((v) => {
      const aggregate = ctx.aggregates.find((a) => a.name === v.aggregate);
      if (!aggregate) throw new Error(`polymorphic read '${op.id}': no concrete '${v.aggregate}'`);
      return { aggregate, tag: v.tag };
    }),
  };
}

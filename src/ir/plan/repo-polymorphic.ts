// The routed polymorphic base read — `GET /api/<bases>`.

import { carriesFieldMask } from "../enrich/mask-taint.js";
import { type PolymorphicRead, polymorphicReadFor } from "../enrich/read-scope.js";
import type { AggregateIR, BoundedContextIR, ExprIR, FindIR } from "../types/loom-ir.js";
import {
  type ApiOperationIR,
  apiStatusContext,
  deriveContextOperations,
  derivePolymorphicReadOperations,
} from "../util/api-surface.js";

/** One concrete's list-read gate, as the base read evaluates it. */
export interface PolymorphicReadGate {
  /** The concrete whose own `all` carries the gate. */
  readonly aggregate: string;
  /** That `all` find: its `requires` is the predicate, its name the 403's
   *  `Forbidden: find <name>` label. */
  readonly find: FindIR & { readonly requires: ExprIR };
}

/** The concrete list-read gates a polymorphic base read checks before it
 *  loads, in variant order.  The base read answers every concrete's rows, so a
 *  caller who fails ANY concrete's own list gate (an author-written `requires`,
 *  a `policy { read … }` line, or the `denyByDefault` synthesised one) gets the
 *  403 that concrete's own route answers — a pre-load gate, never a row
 *  filter, so the 403 says nothing about which rows exist. */
export function polymorphicReadGates(
  base: AggregateIR,
  ctx: Pick<BoundedContextIR, "aggregates" | "repositories">,
): PolymorphicReadGate[] {
  const read = polymorphicReadFor(base, ctx.aggregates);
  if (!read) return [];
  const out: PolymorphicReadGate[] = [];
  for (const v of read.variants) {
    const all = concreteAll(v.aggregate, ctx);
    if (all?.requires)
      out.push({ aggregate: v.aggregate, find: { ...all, requires: all.requires } });
  }
  return out;
}

/** The concretes whose rows the base read redacts, each through its own
 *  `mask unless` serializer, under the caller's principal. */
export function polymorphicReadMasked(
  base: AggregateIR,
  ctx: Pick<BoundedContextIR, "aggregates">,
): string[] {
  const read = polymorphicReadFor(base, ctx.aggregates);
  if (!read) return [];
  return read.variants
    .map((v) => ctx.aggregates.find((a) => a.name === v.aggregate))
    .filter((a): a is AggregateIR => !!a && carriesFieldMask(a))
    .map((a) => a.name);
}

/** `base`'s polymorphic read when it is routed, else `undefined`.  It is
 *  routed whenever every concrete serves its own list read: each concrete's
 *  gate and mask ride the base route (`polymorphicReadGates`,
 *  `polymorphicReadMasked`). */
export function routedPolymorphicRead(
  base: AggregateIR,
  ctx: Pick<BoundedContextIR, "aggregates" | "repositories">,
): PolymorphicRead | undefined {
  const read = polymorphicReadFor(base, ctx.aggregates);
  if (!read) return undefined;
  return read.variants.every((v) => concreteAll(v.aggregate, ctx)) ? read : undefined;
}

function concreteAll(
  aggregate: string,
  ctx: Pick<BoundedContextIR, "repositories">,
): FindIR | undefined {
  return (ctx.repositories ?? [])
    .find((r) => r.aggregateName === aggregate)
    ?.finds.find((f) => f.name === "all");
}

/** The HTTP reads `base` serves: none when its polymorphic read is unrouted,
 *  else the list read and, under TPH, the by-id read.  The e2e route check,
 *  the e2e renderer and the api clients read this instead of asking whether
 *  the base is routed themselves. */
export function polymorphicReadOperations(
  base: AggregateIR,
  ctx: BoundedContextIR,
): ApiOperationIR[] {
  const read = routedPolymorphicRead(base, ctx);
  return read ? derivePolymorphicReadOperations(base, read.layout, apiStatusContext(ctx)) : [];
}

/** Every HTTP operation a context serves: each aggregate's own operations,
 *  then each abstract base's routed polymorphic reads. */
export function contextOperations(ctx: BoundedContextIR): ApiOperationIR[] {
  return [
    ...deriveContextOperations(ctx),
    ...ctx.aggregates.filter((a) => a.isAbstract).flatMap((a) => polymorphicReadOperations(a, ctx)),
  ];
}

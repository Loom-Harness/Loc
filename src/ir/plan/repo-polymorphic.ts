// The routed polymorphic base read — `GET /api/<bases>`.

import { carriesFieldMask } from "../enrich/mask-taint.js";
import { type PolymorphicRead, polymorphicReadFor } from "../enrich/read-scope.js";
import type { AggregateIR, BoundedContextIR } from "../types/loom-ir.js";

/** `base`'s polymorphic read when it is routed, else `undefined`.
 *
 *  The route answers every subtype's rows, so it exists only where every
 *  subtype's own list read is open to the same caller.  A concrete whose `all`
 *  carries a `requires` gate (author-written, or the `denyByDefault`
 *  synthesised one), or whose wire masks a field, would have that gate or
 *  mask bypassed by the base route.  Those hierarchies keep the reader but get
 *  no route. */
export function routedPolymorphicRead(
  base: AggregateIR,
  ctx: Pick<BoundedContextIR, "aggregates" | "repositories">,
): PolymorphicRead | undefined {
  const read = polymorphicReadFor(base, ctx.aggregates);
  if (!read) return undefined;
  const open = read.variants.every((v) => {
    const concrete = ctx.aggregates.find((a) => a.name === v.aggregate);
    const all = (ctx.repositories ?? [])
      .find((r) => r.aggregateName === v.aggregate)
      ?.finds.find((f) => f.name === "all");
    return !!concrete && !!all && !all.requires && !carriesFieldMask(concrete);
  });
  return open ? read : undefined;
}

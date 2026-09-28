import type { BoundedContextIR } from "../types/loom-ir.js";

/** True when some value object the context emits declares an invariant — the
 *  only construct whose constructor raises a backend's value-object-invariant
 *  error (M-T5.1: a value object refused INSIDE a domain body answers the
 *  domain-floor status plus one RFC 7807 `errors[]` entry).  Every backend gates
 *  that error class and its answer on this, so a project without such a value
 *  object emits byte-identically. */
export function hasValueObjectInvariants(ctx: Pick<BoundedContextIR, "valueObjects">): boolean {
  return ctx.valueObjects.some((v) => v.invariants.length > 0);
}

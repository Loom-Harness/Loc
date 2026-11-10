// Shared helpers for the explicit application/transport layer
// (unfoldable-api-derivation.md, Layer 3-4) — the request-record param + the
// response-record return.  Consumed by EVERY backend's explicit-handler emitter
// so they interpret a scaffolded handler's signature identically.
//
// A scaffolded (or hand-written) `commandHandler`/`queryHandler` now takes a
// SINGLE `command`/`query` record param (`cmd: CreateOrderCommand`,
// `query: GetOrderQuery`) and — for a read over the aggregate — declares a
// `<Agg>Response` return.  Both ride as `entity`-marked `TypeIR`s whose name is
// a declared `PayloadIR` (payloads are entity-marked in lowering; see
// `memberOnPayload` in `lower-expr.ts`), so a backend must consult `ctx.payloads`
// to tell a request/response RECORD from a real aggregate.

import type { BoundedContextIR, PayloadIR, TypeIR } from "../types/loom-ir.js";

/** The `command`/`query` request-record a handler param binds to, or `undefined`
 *  when the param is a plain id / scalar / value-object (bound from the route
 *  path, or as a scalar body field).  A record param means the
 *  request body (command) / path+query-string (query) deserialises into this
 *  payload's already-emitted DTO, and the handler body reads `param.<field>`. */
export function requestRecordFor(type: TypeIR, ctx: BoundedContextIR): PayloadIR | undefined {
  if (type.kind !== "entity" || (type.declKind !== "command" && type.declKind !== "query"))
    return undefined;
  return ctx.payloads.find((p) => p.name === type.name);
}

/** Normalise a handler's declared return type to the domain entity the handler
 *  body actually produces — so the INTERNAL handler signature (and the transport
 *  projection) type on the entity, not its wire contract.  Handles BOTH:
 *   - the declared type IS the entity (`Order` / `Order[]`) — hand-written form;
 *   - the declared type is the entity's `<X>Response` record (scaffolded reads)
 *     — mapped back to the entity `X` it projects, keeping array-ness.
 *  A scalar / id / non-entity / void return passes through unchanged, so a
 *  backend can feed the result to its existing type renderer + projection
 *  trigger with no other change. */
export function normalizeHandlerReturn(
  returnType: TypeIR | undefined,
  ctx: BoundedContextIR,
): TypeIR | undefined {
  if (!returnType) return returnType;
  const base = returnType.kind === "array" ? returnType.element : returnType;
  if (base.kind !== "entity" || base.declKind !== "response") return returnType;
  const entity = entityForResponse(base.name, ctx);
  if (!entity) return returnType;
  return returnType.kind === "array" ? { kind: "array", element: entity } : entity;
}

/** The aggregate or containment part a `<X>Response` record projects, or
 *  `undefined` when `X` names neither. */
function entityForResponse(name: string, ctx: BoundedContextIR): TypeIR | undefined {
  const stripped = name.replace(/Response$/, "");
  if (ctx.aggregates.some((a) => a.name === stripped))
    return { kind: "entity", name: stripped, declKind: "aggregate" };
  if (ctx.aggregates.some((a) => a.parts.some((p) => p.name === stripped)))
    return { kind: "entity", name: stripped, declKind: "part" };
  return undefined;
}

/** True when a routed handler declares a single-row `T?` return over a domain
 *  aggregate or part (`queryHandler ByCode(c): Order?`).  Its route answers a
 *  miss as the find-absence 404 (`not_found` ProblemDetails) on every backend,
 *  the status a `getBy…` miss and a remote api call's `T?` read already read as
 *  absence (D-ABSENCE-MODEL) — never a projection of `null` (a node/python 500)
 *  or an empty-bodied 200.  A scalar `T?` and an extern handler (its impl owns
 *  the return shape) keep their value as-is. */
export function routedAbsenceAnswers404(
  h: { readonly extern?: boolean; readonly returnType?: TypeIR },
  ctx: BoundedContextIR,
): boolean {
  if (h.extern || h.returnType?.kind !== "optional") return false;
  const inner = normalizeHandlerReturn(h.returnType.inner, ctx);
  return inner?.kind === "entity" && (inner.declKind === "aggregate" || inner.declKind === "part");
}

// The payload records a context's command-workflow parameters name — the ONE
// place every backend asks "which payload wire types must this context's
// workflow DTOs carry?".
//
// `docs/payloads.md` §1 lists a workflow `create` / `handle` parameter as the
// first position where a payload is admissible as a TYPE, and
// `docs/workflow.md` documents the form: `create(c: PlaceOrder)`, where
// `PlaceOrder` is a declared `command`, is the explicit-command starter.
//
// A payload lowers to an `entity` `TypeIR` (it is a nominal record reference,
// not a value object), and every backend's wire-type mapper renders an
// `entity` as `<Name>Response` — the spelling a CONTAINMENT part carries,
// whose record the per-aggregate DTO emitter emits.  A payload has no owning
// aggregate, so nothing emitted that record: all five backends referenced a
// type they never declared (#2864 D7/T2 — `z.unknown()` on node, an undefined
// name on the other four).  Each backend now seeds its own payload-record
// emission from this collector.
//
// Pure IR traversal, consumed downward by the generators — no back-edge.

import type { BoundedContextIR, PayloadIR, TypeIR, WorkflowIR } from "../../ir/types/loom-ir.js";
import { workflowEmitsCommandRoute } from "../../ir/types/loom-ir.js";

/** Peel the canonical outer wrappers (`array` / `optional`) off a type and
 *  return the leaf's declared name, or `undefined` for a leaf that carries
 *  none (a primitive).  Mirrors `wireTypeInfo`'s peel without pulling in its
 *  full `WireTypeInfo` shape — callers here only need the name. */
function leafName(t: TypeIR): string | undefined {
  if (t.kind === "array") return leafName(t.element);
  if (t.kind === "optional") return leafName(t.inner);
  return t.kind === "entity" ? t.name : undefined;
}

/** True iff `name` is a declared RECORD payload in `ctx` — a flat field list.
 *  A named UNION payload (`payload Foo = A | B`) carries `variants` and an
 *  empty `fields`; it already has its own tagged-wire emission through
 *  `_payload/union-wire.ts`, so it is not this collector's business. */
function recordPayload(ctx: BoundedContextIR, name: string): PayloadIR | undefined {
  return ctx.payloads.find((p) => p.name === name && !p.variants);
}

/**
 * Every record payload named by a parameter of one of `ctx`'s workflows,
 * in context declaration order (stable across runs, so the emitted file is
 * byte-stable).
 *
 * Scoped to workflows that actually expose an HTTP command surface
 * (`workflowEmitsCommandRoute` — the same facade rule the request-DTO emitters
 * already gate on): an event-triggered-only workflow's facade param is an
 * event type, which has its own emission and no request DTO to reference it.
 *
 * The `<Agg>Wire` payloads enrichment synthesizes are excluded — those are the
 * per-aggregate wire projections, already emitted by every backend's aggregate
 * DTO pass.
 */
export function workflowParamPayloads(ctx: BoundedContextIR): PayloadIR[] {
  const named = new Set<string>();
  for (const wf of ctx.workflows) {
    if (!workflowEmitsCommandRoute(wf)) continue;
    for (const p of wf.params) {
      const n = leafName(p.type);
      if (n !== undefined) named.add(n);
    }
  }
  if (named.size === 0) return [];
  return ctx.payloads.filter((p) => named.has(p.name) && !p.variants && !p.synthesized);
}

/** The same collector over a single workflow — used by the emitters that build
 *  one file per workflow (java's request DTO, .NET's command record) and need
 *  to know whether THIS workflow pulls a payload in. */
export function workflowParamPayloadsOf(wf: WorkflowIR, ctx: BoundedContextIR): PayloadIR[] {
  const named = new Set<string>();
  for (const p of wf.params) {
    const n = leafName(p.type);
    if (n !== undefined) named.add(n);
  }
  return ctx.payloads.filter((p) => named.has(p.name) && !p.variants && !p.synthesized);
}

/** True iff `t`'s leaf is a declared record payload in `ctx` — the predicate
 *  each backend's wire-type / materialization arm uses to tell a payload
 *  reference apart from the containment part that shares the `entity` kind. */
export function isRecordPayloadType(t: TypeIR, ctx: BoundedContextIR): boolean {
  const n = leafName(t);
  return n !== undefined && recordPayload(ctx, n) !== undefined;
}

/** The declared record payload `t`'s leaf names, or `undefined` when the leaf
 *  is not one (a containment part, or a primitive). */
export function recordPayloadOf(t: TypeIR, ctx: BoundedContextIR): PayloadIR | undefined {
  const n = leafName(t);
  return n === undefined ? undefined : recordPayload(ctx, n);
}

/**
 * The type seeds a context's command-workflow params expand to for the
 * schema/DTO closure passes — each param's own type PLUS, when that param
 * names a record payload, the payload's own field types.
 *
 * The extra hop is the whole point.  `collectReachableTypes` descends through
 * a VALUE OBJECT's fields but not through a payload's (a payload leaf is an
 * `entity`), so a seed list built from `wf.params` alone misses a value object
 * that is only reachable THROUGH a payload — and the emitted
 * `<Payload>Response` record then names a `<Vo>Request` / `<Vo>Schema` that
 * no pass emitted.  Same dangling-reference class as #2864 D7/T2 itself, one
 * level down.
 */
export function* workflowParamTypeSeeds(
  workflows: readonly WorkflowIR[],
  ctx: BoundedContextIR,
): Generator<TypeIR> {
  for (const wf of workflows) {
    for (const p of wf.params) {
      yield p.type;
      const pl = recordPayloadOf(p.type, ctx);
      if (pl) for (const f of pl.fields) yield f.type;
    }
  }
}

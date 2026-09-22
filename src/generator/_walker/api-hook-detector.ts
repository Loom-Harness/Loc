// ---------------------------------------------------------------------------
// API-hook detection — framework-agnostic IR pattern matching.
//
// Recognises the DSL shapes that lower into an api call:
//
//   Pattern A: `member(member(ref:apiParam, agg), op)`           — `Sales.Customer.all`
//   Pattern B: `method-call(member(ref:apiParam, agg), op, args)` — `Sales.Customer.byId(id)`
//   Pattern D: `member(ref:<Aggregate>, op)`                      — `Customer.create`   (no api-param prefix)
//   Pattern E: `method-call(ref:<Aggregate>, op, args)`           — `Customer.byId(id)` (no api-param prefix)
//   Pattern F: `member(member(ref:<Workflow>, "instances"), "all")`        — `Fulfillment.instances.all`
//   Pattern G: `method-call(member(ref:<Workflow>, "instances"), "byId", args)` — `Fulfillment.instances.byId(id)`
//   Pattern H: `member(ref:apiParam, <Projection>)`                        — `Sales.SalesTotals`
//   Pattern I: `ref:<Projection>`                                          — `SalesTotals`   (no api-param prefix)
//
// Pattern I is to H what D is to A: the same read with no api handle in front
// of it.  Its absence was a HOLE, not a design — every other pattern already
// had its bare twin, and the one read that lacked one is the read the
// dashboard scaffold emits.  `scaffoldHome`'s KPI row builds
// `QueryView { of: <Projection> }` as a BARE ref whenever the `ui` declares no
// `api X: Y` param (`_body-builders.ts::kpiRow`), so on such a ui the read
// bound to nothing, fell through to the shared walker's last-resort `ref` arm,
// and shipped `/* unresolved: <Projection> */ undefined` into the page while
// `ddd generate system` reported `0 error(s), 0 warning(s)`.  Six markers on a
// 26-line model; ZERO across the whole shipped corpus, because every example
// in it declares an api param — which is why no build gate ever saw it.
//
// Detection is PURE IR analysis — no framework assumptions, no
// emission.  Kept out of `react/walker/api-hooks.ts` so any walker
// (Vue/Svelte/Blazor included) can reuse the detector verbatim and plug in its
// own naming via the WalkerTarget's `buildHookUse` method.
//
// The returned `DetectedApiCall` carries everything the framework-
// specific naming layer needs: which aggregate is invoked,
// which operation, and the raw arg expressions (caller renders them
// via its walker context for ref-propagation side-effects).
// ---------------------------------------------------------------------------

import type { ExprIR } from "../../ir/types/loom-ir.js";

/** A framework-agnostic detected api call.  Produced by
 *  `tryDetectApiHook` from an `ExprIR` that matches one of the
 *  documented patterns; consumed by `WalkerTarget.buildHookUse` to
 *  produce the per-framework hook naming (var, hook fn, import path). */
export interface DetectedApiCall {
  /** The aggregate PascalCase name (Patterns A/B/D/E), or the workflow
   *  name for workflow-instance hooks (Patterns F/G).  Disambiguated
   *  by `kind`. */
  aggregateName: string;
  /** The operation invoked off the aggregate.  Standard
   *  operations: `all`, `byId`, `create`, `update`, `delete`, plus
   *  user-declared finder / operation names. */
  operation: string;
  /** Argument expressions in source order.  Empty for `.all`-style
   *  reads.  Caller renders via its own
   *  walker context so refs to params/state propagate. */
  args: ExprIR[];
  /** Discriminator between the pipelines:
   *    `"aggregate"`         — Patterns A/B/D/E (aggregate-rooted hook)
   *    `"workflow-instance"` — Patterns F/G (`<Workflow>.instances.all` /
   *                            `.byId(id)`); `aggregateName` carries the
   *                            workflow name, `operation` is `all`/`byId`.
   *    `"projection"`        — Patterns H / I (`<apiHandle>.<Projection>` and
   *                            the bare `<Projection>`);
   *                            `aggregateName` carries the projection name and
   *                            `operation` is `read` — a projection read takes
   *                            no operation, since the projection IS the row. */
  kind: "aggregate" | "workflow-instance" | "projection";
}

/** Detector context — the minimum subset of `WalkContext` the
 *  detection logic needs.  Decoupled from `WalkContext` so the
 *  detector doesn't pull a React-flavoured interface into the
 *  cross-framework `_walker/` directory.  Both fields are typed as
 *  `.has(name)`-bearing objects so any `Set<string>` / `Map<string, V>`
 *  the consuming walker uses satisfies the shape. */
export interface ApiHookDetectorContext {
  /** Container of in-scope api parameter names (e.g. `{"Sales",
   *  "Marketing"}`).  Populated by the UI walker from the page's
   *  `api X: Y` bindings. */
  apiParamNames: { has(name: string): boolean };
  /** Container of aggregate PascalCase names declared in the bound
   *  modules.  Patterns D / E (no api-param prefix) match against
   *  this set. */
  aggregatesByName: { has(name: string): boolean };
  /** Container of workflow names declared in the bound modules.
   *  Patterns F / G (`<Workflow>.instances.…`) match against this set.
   *  Optional so callers that never reference workflow instances need
   *  not supply it. */
  workflowsByName?: { has(name: string): boolean };
  /** Container of READABLE projection names — the query-time projections the
   *  served backend exposes a route for.  Patterns H and I match against it.
   *  Optional, so a caller that never reads a projection (and every target
   *  whose frontend client isn't ported) leaves the pattern inert and keeps
   *  its previous output byte-for-byte. */
  projectionsByName?: { has(name: string): boolean };
}

/** Returns a `DetectedApiCall` when `expr` matches one of the five
 *  api-call patterns, or `null` otherwise.  Cheap to call — bails on
 *  the first non-matching shape check. */
export function tryDetectApiHook(
  expr: ExprIR,
  ctx: ApiHookDetectorContext,
): DetectedApiCall | null {
  // Pattern A: member(member(ref:apiParam, agg), op)
  if (expr.kind === "member" && expr.receiver.kind === "member") {
    const inner = expr.receiver;
    if (inner.receiver.kind === "ref" && ctx.apiParamNames.has(inner.receiver.name)) {
      return { aggregateName: inner.member, operation: expr.member, args: [], kind: "aggregate" };
    }
  }
  // Pattern B: method-call(member(ref:apiParam, agg), op, args)
  if (expr.kind === "method-call" && expr.receiver.kind === "member") {
    const inner = expr.receiver;
    if (inner.receiver.kind === "ref" && ctx.apiParamNames.has(inner.receiver.name)) {
      return {
        aggregateName: inner.member,
        operation: expr.member,
        args: expr.args,
        kind: "aggregate",
      };
    }
  }
  // Pattern F: member(member(ref:<Workflow>, "instances"), "all") — workflow
  // instance list (workflow-instance-visibility.md).
  if (
    expr.kind === "member" &&
    expr.member === "all" &&
    expr.receiver.kind === "member" &&
    expr.receiver.member === "instances" &&
    expr.receiver.receiver.kind === "ref" &&
    ctx.workflowsByName?.has(expr.receiver.receiver.name)
  ) {
    return {
      aggregateName: expr.receiver.receiver.name,
      operation: "all",
      args: [],
      kind: "workflow-instance",
    };
  }
  // Pattern G: method-call(member(ref:<Workflow>, "instances"), "byId", args)
  // — one workflow instance by correlation id.
  if (
    expr.kind === "method-call" &&
    expr.member === "byId" &&
    expr.receiver.kind === "member" &&
    expr.receiver.member === "instances" &&
    expr.receiver.receiver.kind === "ref" &&
    ctx.workflowsByName?.has(expr.receiver.receiver.name)
  ) {
    return {
      aggregateName: expr.receiver.receiver.name,
      operation: "byId",
      args: expr.args,
      kind: "workflow-instance",
    };
  }
  // Pattern H: member(ref:apiParam, <Projection>) — a projection read.
  // Shaped like Pattern A minus the operation, because a projection read HAS
  // no operation: the projection is the row.  Must be tested before Pattern D,
  // whose `ref` arm would otherwise never see it (the receiver is an api
  // handle, not an aggregate) and let it fall through to the unresolved
  // `undefined.<Projection>` emit.
  if (
    expr.kind === "member" &&
    expr.receiver.kind === "ref" &&
    ctx.apiParamNames.has(expr.receiver.name) &&
    ctx.projectionsByName?.has(expr.member)
  ) {
    return {
      aggregateName: expr.member,
      operation: "read",
      args: [],
      kind: "projection",
    };
  }
  // Pattern I: ref:<Projection> — a projection read with no api-param prefix,
  // the bare twin of Pattern H exactly as D is the bare twin of A.
  //
  // `refKind: "unknown"` is the whole guard, and it is the right one: lowering
  // resolves a page-body name against locals / lambda params / state / derived
  // / actions / criteria / enum members FIRST, and only a name it bound to
  // nothing keeps `"unknown"` (`lower-expr.ts::resolveRef`).  So a `state {}`
  // field, a `let`, or a lambda binding that happens to share a projection's
  // name still shadows it here, for the same reason and by the same mechanism
  // that makes the ui-body enum-member arm safe.  Matching on the NAME alone
  // would have inverted that shadowing, because this detector runs at the top
  // of `emitExpr`, ahead of the ref arm's own scope lookups.
  if (expr.kind === "ref" && expr.refKind === "unknown" && ctx.projectionsByName?.has(expr.name)) {
    return { aggregateName: expr.name, operation: "read", args: [], kind: "projection" };
  }
  // Pattern D: member(ref:<Aggregate>, op) without api-param prefix.
  // Lets UIs without a `api X: Y` binding still get auto-injected
  // hooks (`scaffold modules: M` deployables that never declared
  // api params).
  if (
    expr.kind === "member" &&
    expr.receiver.kind === "ref" &&
    ctx.aggregatesByName.has(expr.receiver.name)
  ) {
    return {
      aggregateName: expr.receiver.name,
      operation: expr.member,
      args: [],
      kind: "aggregate",
    };
  }
  // Pattern E: method-call(ref:<Aggregate>, op, args) — parameterised
  // form of Pattern D.
  if (
    expr.kind === "method-call" &&
    expr.receiver.kind === "ref" &&
    ctx.aggregatesByName.has(expr.receiver.name)
  ) {
    return {
      aggregateName: expr.receiver.name,
      operation: expr.member,
      args: expr.args,
      kind: "aggregate",
    };
  }
  return null;
}

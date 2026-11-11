// ---------------------------------------------------------------------------
// A `QueryView` read on a Phoenix LiveView page: the assign the page loads in
// `handle_params` through the aggregate's context module (actor-scoped, paged
// when the query is), and the walk context its `data:` body renders under.
// `heexTarget.bindQueryView` / `scopeSink` reach these.
// ---------------------------------------------------------------------------

import { pagedReturn } from "../../ir/stdlib/generics.js";
import type { ExprIR } from "../../ir/types/loom-ir.js";
import {
  aggregateUsesPrincipalContextFilter,
  exprUsesCurrentUser,
} from "../../ir/types/loom-ir.js";
import { findsOfAggregate, resolveAggregateRead } from "../../ir/util/page-read.js";
import { snake } from "../../util/naming.js";
import { type DetectedApiCall, tryDetectApiHook } from "../_walker/api-hook-detector.js";
import { isEntityHistoryRead } from "../_walker/history-read.js";
import { queryShape } from "../_walker/paged-query.js";
import type { QueryViewRead } from "../_walker/target.js";
import { registerBinding, renderExpr, type WalkContext } from "./heex-walker-core.js";

/** Resolve the aggregate PascalCase name out of a `QueryView`
 *  `of:` argument.  The scaffold-expander emits one of:
 *    detail  → method-call `<api>.<Agg>.byId(id)` (receiver is a
 *              member `{receiver: ref(api), member: Agg}`), or the
 *              no-api fallback `<Agg>.byId(id)` (receiver ref(Agg))
 *    list    → member access `<api>.<Agg>.all` (the `.all` is the
 *              outer member; its receiver is `<api>.<Agg>`), or the
 *              fallback bare `ref(Agg)` / `<Agg>.all`. */
function resolveQueryAggregate(arg: ExprIR): string | undefined {
  if (arg.kind === "method-call") {
    if (arg.receiver.kind === "member") return arg.receiver.member;
    if (arg.receiver.kind === "ref") return arg.receiver.name;
  }
  if (arg.kind === "member") {
    // `<api>.<Agg>.all` → receiver is `<api>.<Agg>` (a member);
    // `<Agg>.all` → receiver is ref(Agg).
    if (arg.receiver.kind === "member") return arg.receiver.member;
    if (arg.receiver.kind === "ref") return arg.receiver.name;
    return arg.member;
  }
  if (arg.kind === "ref") return arg.name;
  return undefined;
}

/** The argument list of a `QueryView` `of:` call, rendered as handler-position
 *  Elixir.  Only a `method-call` carries args (`<api>.<Agg>.all(page, …)`); a
 *  plain member access (`<api>.<Agg>.all`) has none, so the load stays the
 *  parameterless `list_<agg>s()` it has always been. */
function queryCallArgs(arg: ExprIR | undefined, ctx: WalkContext): string[] | undefined {
  if (arg?.kind !== "method-call" || arg.args.length === 0) return undefined;
  return arg.args.map((a) => renderExpr(a, { ...ctx, position: "handler" }));
}

/** The CONTEXT-MODULE FUNCTION a `QueryView` `of:` aggregate read calls.
 *
 *  Deriving this from the read's SHAPE alone — list-shaped ⇒ `list_<agg>s`,
 *  single-shaped ⇒ `get_<agg>` — is right only for the two standard ops and
 *  silently wrong for every FILTERED read: `Product.findAllBySellable()` would
 *  load the whole table, and `Item.byState(Live)` would pass the filter value
 *  into `list_items/4`'s `page` parameter.  The operation the author named is
 *  the fact that decides this, so it is what gets consulted — through
 *  `resolveAggregateRead`, the same resolution the validator runs to reject a
 *  read that names nothing (`loom.ui-read-unresolved`).
 *
 *  `undefined` means exactly that: the operation resolved to no declaration, so
 *  there is no honest function to call and the load block refuses instead of
 *  substituting the list.  An `of:` the DETECTOR cannot read at all (a bare ref,
 *  an unknown receiver) keeps the shape-derived default — those never named an
 *  operation to route by, and the answer is byte-identical to before. */
function contextReadFn(
  aggName: string,
  isSingle: boolean,
  ctx: WalkContext,
  detected: DetectedApiCall | null,
): string | undefined {
  const aggSnake = snake(aggName);
  const shapeDefault = isSingle ? `get_${aggSnake}` : `list_${aggSnake}s`;
  if (detected?.kind !== "aggregate" || detected.aggregateName !== aggName) return shapeDefault;
  const target = resolveAggregateRead(
    detected.operation,
    findsOfAggregate(aggName, ctx.bcByAggregate.get(aggName)),
  );
  switch (target.kind) {
    case "find-all":
      return `list_${aggSnake}s`;
    case "by-id":
      return `get_${aggSnake}`;
    case "find":
      // The `defdelegate <find>_<agg>(...)` the context module emits beside the
      // CRUD ones (`vanilla/context-emit.ts`, `customFindsOf`).
      return `${snake(target.find.name)}_${aggSnake}`;
    default:
      // `history` is detected one level up (`historyRead`) and never reaches
      // this arm; `unresolved` names no declaration — refuse.
      return undefined;
  }
}

/** The LiveView socket's principal — what `LiveAuth` assigns on mount. */
const SOCKET_ACTOR = "Map.get(socket.assigns, :current_user)";

/** The defaults of the paged `list/5` (`page`, `page_size`, `sort`, `dir`) and
 *  a paged find's trailing paging params, in order — filled in front of the
 *  actor when the page's call passed fewer, so the actor never lands in a
 *  paging slot. */
const PAGED_READ_DEFAULTS = ["1", "20", '"id"', '"asc"'];

/** The trailing arguments that thread the request principal into a LiveView
 *  read, or `undefined` when the read takes none.
 *
 *  A principal-scoped read (a tenancy / `currentUser` capability filter on the
 *  aggregate, or a `currentUser` in the read's own `where`) pins its query to
 *  `current_user && current_user.<claim>`; the controller threads the actor
 *  from `conn.assigns`, and a read called WITHOUT one binds `nil` and answers
 *  no rows (fail-closed).  The LiveView must thread the socket's actor the same
 *  way, through the same parameter its context function declares:
 *
 *  the list (`list_<agg>s`) / by-id (`get_<agg>`) / find delegates take it
 *  POSITIONALLY after their own args (paging defaults filled first when the
 *  page passed fewer). */
function readActorArgs(
  aggName: string,
  isSingle: boolean,
  ctx: WalkContext,
  detected: DetectedApiCall | null,
  ofArgNode: ExprIR | undefined,
): string[] | undefined {
  const bc = ctx.bcByAggregate.get(aggName);
  const agg = bc?.aggregates.find((a) => a.name === aggName);
  if (!agg) return undefined;
  const principal = aggregateUsesPrincipalContextFilter(agg);
  const argCount = queryCallArgs(ofArgNode, ctx)?.length ?? 0;
  const operation =
    detected?.kind === "aggregate" && detected.aggregateName === aggName
      ? detected.operation
      : isSingle
        ? "byId"
        : "all";
  const target = resolveAggregateRead(operation, findsOfAggregate(aggName, bc));
  switch (target.kind) {
    case "by-id":
      return principal ? [SOCKET_ACTOR] : undefined;
    case "find-all": {
      if (!principal) return undefined;
      const all = bc?.repositories
        .find((r) => r.aggregateName === aggName)
        ?.finds.find((f) => f.name === "all");
      const paged = !!all && !!pagedReturn(all.returnType);
      return paged ? [...PAGED_READ_DEFAULTS.slice(argCount), SOCKET_ACTOR] : [SOCKET_ACTOR];
    }
    case "find": {
      const f = target.find;
      const actor = principal || exprUsesCurrentUser(f.filter);
      if (!actor) return undefined;
      const fill = pagedReturn(f.returnType)
        ? PAGED_READ_DEFAULTS.slice(Math.max(0, argCount - f.params.length))
        : [];
      return [...fill, SOCKET_ACTOR];
    }
    default:
      return undefined;
  }
}

/** What a `QueryView` reads on a LiveView page, decided from the IR: the assign
 *  its load fills, the read's shape, and which read it is.  Pure apart from
 *  the per-page assign reservation (`reserveQueryAssign`). */
interface QueryViewPlan {
  ofNode: ExprIR;
  assignName: string;
  isSingle: boolean;
  isPaged: boolean;
  autoPaged: boolean;
  detected: DetectedApiCall | null;
  projectionRead?: string;
  historyRead?: string;
}

function queryViewPlan(
  expr: Extract<ExprIR, { kind: "call" }>,
  ofNode: ExprIR,
  ctx: WalkContext,
): QueryViewPlan {
  // Resolve the read's SHAPE from the IR rather than from the flags.
  // `paged:` / `single:` are opt-INs; the facts behind them are properties of
  // the find, and taking them from the flags alone is what made a hand-written
  // `QueryView { of: X.all }` render `Enum.empty?/1` against the paged envelope
  // MAP (never empty, so the empty arm was dead and `<.table rows={…}>`
  // iterated the map's key/value pairs) and a `byId` read without `single:`
  // raise `Protocol.UndefinedError` on a struct.  Same derivation the JSX
  // walker uses — see `_walker/paged-query.ts`.
  const names = expr.argNames ?? [];
  const litTrue = (i: number): boolean => {
    const a = i >= 0 ? expr.args[i] : undefined;
    return a?.kind === "literal" && a.value === "true";
  };
  // Entity-history read (`<Agg>.history(id)`, docs/audit.md) — NOT an ordinary
  // aggregate read: it scans `audit_records` for one target, so binding it as
  // one would load `list_<aggs>` (the LIST, not the trail).  Loaded by the
  // LiveView's page-private `load_<agg>_history/2`.
  const historyRead = isEntityHistoryRead(ofNode, ctx.aggregatesByName)
    ? resolveQueryAggregate(ofNode)
    : undefined;
  // Detector context, shared by the shape derivation and the Pattern H probe
  // below so the two can't answer from different name sets.
  const detectCtx = {
    apiParamNames: new Set(ctx.ui.apiParams.map((p) => p.name)),
    aggregatesByName: ctx.aggregatesByName,
    bcByAggregate: ctx.bcByAggregate,
    projectionsByName: ctx.projectionsByName,
    listShapedProjections: ctx.listShapedProjections,
  };
  const shape = queryShape(ofNode, detectCtx);
  // Pattern H — `QueryView { of: <api>.<Projection> }`.  The read resolves to
  // the query-time projection's own `run/1`, in-process: a LiveView deployable
  // hosts its contexts in the SAME OTP app, so what the SPA frontends reach
  // over `GET /projections/<slug>` is one function call here.
  const detected = tryDetectApiHook(ofNode, detectCtx);
  const projectionRead = detected?.kind === "projection" ? detected.aggregateName : undefined;
  // Flag OR fact: an author may opt in explicitly (the scaffold does), but
  // omitting the flag does NOT mean "not paged" / "not single".
  const isSingle = litTrue(names.indexOf("single")) || shape.single;
  const explicitPaged = litTrue(names.indexOf("paged"));
  const isPaged = explicitPaged || shape.paged;
  // AUTO-paged: the read is paged but the body was written for a collection, so
  // the lambda binding unwraps to the envelope's rows — the LiveView twin of
  // the JSX walker's `.data.items` unwrap.  Without it a hand-written
  // `Table { rows: rows }` passed the whole envelope MAP as `rows=`, and
  // `<.table>` iterated its key/value pairs.  An explicit `paged: true` body
  // (the scaffold) reads `rows.items` itself, so it binds the envelope.
  const autoPaged = !explicitPaged && !isSingle && shape.paged;
  return {
    ofNode,
    assignName: queryAssignName(expr, projectionRead, historyRead, ctx),
    isSingle,
    isPaged,
    autoPaged,
    detected,
    ...(projectionRead === undefined ? {} : { projectionRead }),
    ...(historyRead === undefined ? {} : { historyRead }),
  };
}

/** The assign a `QueryView`'s load fills.
 *
 *  A projection read names it after the PROJECTION (`:order_totals`) and a
 *  history read after the AGGREGATE (`:order_history`): the scaffolded
 *  dashboard puts one KPI `QueryView` per aggregate on `Home`, each with the
 *  same lambda param, and a detail page's history read uses `entries`, a name
 *  any hand-written read could also pick.  Any other read names it after its
 *  `data:` lambda param — `rows` reads as `items`, the scaffold's list
 *  convention — reserved per page, so two reads whose lambdas share a param
 *  each get their own assign (`items`, `items_2`) instead of loading into one
 *  where the last load wins. */
function queryAssignName(
  expr: Extract<ExprIR, { kind: "call" }>,
  projectionRead: string | undefined,
  historyRead: string | undefined,
  ctx: WalkContext,
): string {
  if (projectionRead) return snake(projectionRead);
  if (historyRead) return `${snake(historyRead)}_history`;
  const data = expr.args[(expr.argNames ?? []).indexOf("data")];
  const param = data?.kind === "lambda" ? snake(data.param) : "rows";
  return reserveQueryAssign(expr, param === "rows" ? "items" : param, ctx);
}

/** The assign `base` for this `QueryView`, or the first free `base_<n>` when
 *  another read on the page already holds `base`.  Keyed by the call node, so
 *  the view's data scope and its load binding agree on the name. */
function reserveQueryAssign(
  expr: Extract<ExprIR, { kind: "call" }>,
  base: string,
  ctx: WalkContext,
): string {
  const reserved = ctx.queryAssigns.get(expr);
  if (reserved !== undefined) return reserved;
  const taken = new Set(ctx.queryAssigns.values());
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
  ctx.queryAssigns.set(expr, name);
  return name;
}

/** The `of:` read of a `QueryView`, when it has one. */
function queryViewOf(expr: Extract<ExprIR, { kind: "call" }>): ExprIR | undefined {
  return expr.args[(expr.argNames ?? []).indexOf("of")];
}

/** The walk context a `QueryView`'s `data:` lambda body renders under: its
 *  parameter remapped to the assign the load fills (the envelope's `.items`
 *  when the read is auto-paged), and typed so a nested instance-qualified
 *  op-form (`OperationForm(data.confirm)`) resolves the aggregate it operates
 *  on — or, for a list, so its `Table` / `For` rows type theirs. */
export function queryViewDataContext(
  expr: Extract<ExprIR, { kind: "call" }>,
  param: string,
  ctx: WalkContext,
): WalkContext {
  const ofNode = queryViewOf(expr);
  if (!ofNode) return ctx;
  const plan = queryViewPlan(expr, ofNode, ctx);
  const remapping = new Map<string, string>([
    [snake(param), plan.autoPaged ? `${plan.assignName}.items` : plan.assignName],
  ]);
  const queried = resolveQueryAggregate(ofNode);
  const known = queried !== undefined && ctx.aggregatesByName.has(queried);
  return {
    ...ctx,
    varRemapping: remapping,
    instanceTypes:
      known && plan.isSingle
        ? new Map([...(ctx.instanceTypes ?? []), [param, queried]])
        : ctx.instanceTypes,
    listTypes:
      known && !plan.isSingle
        ? new Map([...(ctx.listTypes ?? []), [param, queried]])
        : ctx.listTypes,
  };
}

/** Register a `QueryView`'s load so the LiveView emitter fills its assign in
 *  `handle_params` (the assign the ladder reads is never populated otherwise —
 *  see `QueryBinding`), and answer what the ladder tests. */
export function bindHeexQueryView(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): QueryViewRead | undefined {
  const ofNode = queryViewOf(expr);
  if (!ofNode) return undefined;
  const plan = queryViewPlan(expr, ofNode, ctx);
  const { assignName, isSingle, projectionRead, historyRead, detected } = plan;
  if (projectionRead) {
    // The projection load takes no arguments (the read IS the row) and no
    // `listArgs` — a query-time projection has no page/sort surface.
    registerBinding(ctx, ctx.queryBindings, {
      kind: isSingle ? "single" : "list",
      assign: assignName,
      aggregate: projectionRead,
      source: "projection",
    });
  }
  if (historyRead) {
    // `listArgs` carries the entity id the `of:` call passed
    // (`socket.assigns.id` on a scaffolded detail page) — the loader takes it
    // as an argument rather than reaching for `@id`, so a hand-written
    // `history(someOtherId)` loads what it asked for.
    registerBinding(ctx, ctx.queryBindings, {
      kind: "list",
      assign: assignName,
      aggregate: historyRead,
      source: "history",
      listArgs: queryCallArgs(ofNode, ctx),
    });
  }
  const aggName = projectionRead || historyRead ? undefined : resolveQueryAggregate(ofNode);
  if (aggName) {
    registerBinding(ctx, ctx.queryBindings, {
      kind: isSingle ? "single" : "list",
      assign: assignName,
      aggregate: aggName,
      // Forward the `of:` call's arguments to the load block.  A paged scaffold
      // list is `<api>.<Agg>.all(pageNum, 10, sortKey, sortDir)`; without these
      // the emitted `list_<agg>s()` takes the repository defaults and the page
      // never moves off 1.  HANDLER position — the load block is a function
      // body, so state refs must render `socket.assigns.<f>`, not `@<f>`.
      listArgs: queryCallArgs(ofNode, ctx),
      // WHICH context function this read calls, resolved from the `of:`
      // call's OPERATION — see `contextReadFn`.
      readFn: contextReadFn(aggName, isSingle, ctx, detected),
      // The request principal, when the read's repository function takes one.
      actorArgs: readActorArgs(aggName, isSingle, ctx, detected, ofNode),
      // …and only when the enclosing `match` arm is the one being rendered.
      gate: isSingle ? undefined : ctx.matchGate,
    });
  }
  return { readExpr: assignName, single: isSingle, paged: plan.isPaged };
}

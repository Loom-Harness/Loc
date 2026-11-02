// ---------------------------------------------------------------------------
// Routed-handler resolution — the ONE place that answers "does
// `api.<contextSlug>.<handlerName>(…)` name an explicit `route <METHOD> <PATH>
// -> <Context>.<Handler>` binding this compilation emits?".
//
// Shared on purpose by the three readers that must agree:
//   • `src/ir/validate/checks/test-checks.ts`      — is the call addressable?
//   • `src/ir/validate/checks/e2e-route-checks.ts` — does it match the route's
//     own arity / request shape?
//   • `src/system/e2e-render.ts`                   — what request does it emit?
// A second copy of the match is exactly how a validator and an emitter drift
// apart (the `create`-with-no-route case `e2e-route-checks.ts` was minted for),
// so the lookup, the path-token split and the param BINDING all live here and
// the three call sites only decide what to do with the answer.
//
// The binding mirrors what every backend's explicit-route emitter actually
// reads (`src/platform/hono/v4/explicit-handlers-builder.ts` `emitRouteHandler`,
// `src/generator/dotnet/explicit-handlers-emit.ts` `emitExplicitRouteController`,
// and their python / java / elixir twins): a handler param whose NAME is a
// `{token}` in the route path binds from the URL; every other param rides the
// JSON request body — except on the paged-run shape and on a bodyless method
// (`GET` / `DELETE` / `HEAD`), where the emitters put them on the query string
// instead (`routedParamSource`).
// ---------------------------------------------------------------------------

import { lowerFirst, snake } from "../../util/naming.js";
import type {
  ApiIR,
  BoundedContextIR,
  CommandHandlerIR,
  DeployableIR,
  ParamIR,
  QueryHandlerIR,
  RouteIR,
} from "../types/loom-ir.js";

/** The `{token}` names of a route path, in path order. */
export function routePathTokens(path: string): string[] {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1] as string);
}

/** Where one handler param's value rides on the wire. */
export type RoutedParamSource = "path" | "body" | "query";

export interface RoutedHandlerBinding {
  readonly param: ParamIR;
  readonly source: RoutedParamSource;
}

export interface RoutedHandlerTarget {
  readonly apiName: string;
  readonly route: RouteIR;
  readonly context: BoundedContextIR;
  readonly handler: CommandHandlerIR | QueryHandlerIR;
  readonly handlerKind: "command" | "query";
  /** One entry per declared param, in DECLARED order — which is also the
   *  positional order a `test e2e` call passes its arguments in. */
  readonly bindings: readonly RoutedHandlerBinding[];
}

/** `GET`/`DELETE` carry no request body (`fetch` refuses one), so a handler
 *  param that is not path-bound rides their query string. */
const BODYLESS_METHODS = new Set(["GET", "DELETE", "HEAD"]);

/** The paged-run shape the route emitters special-case: a `queryHandler`
 *  returning `<Agg> paged`, whose non-path params ride the QUERY STRING
 *  beside `page`/`pageSize`/`sort`/`dir` rather than a body. */
function isPagedRun(h: CommandHandlerIR | QueryHandlerIR): boolean {
  const t = (h as QueryHandlerIR).returnType;
  return !!t && t.kind === "genericInstance" && t.ctor === "paged";
}

/** The apis a BACKEND deployable serves, in declaration order. */
export function apisServedBy(d: DeployableIR, apis: readonly ApiIR[]): ApiIR[] {
  const want = new Set(d.serves ?? []);
  return apis.filter((a) => want.has(a.name));
}

/** Spellings a `test e2e` body may use for a bounded-context / handler name.
 *  Deliberately the same shapes the aggregate slug accepts (`lowerFirst` and
 *  `snake`), so one rule covers every magic receiver. */
const matchesName = (name: string, slug: string): boolean =>
  name === slug || lowerFirst(name) === slug || snake(name) === slug;

/**
 * Resolve `api.<contextSlug>.<handlerSlug>(…)` to the routed handler it names.
 *
 * Resolution requires ALL THREE of: a bounded context on this deployable, a
 * command/query handler declared in it, and a `route … -> <Ctx>.<Handler>`
 * binding in an api the deployable serves.  Requiring the ROUTE is what keeps
 * this from shadowing an aggregate whose slug collides with a context name: a
 * handler with no route has no HTTP surface to drive, so it is not addressable
 * and the caller falls through to its ordinary aggregate error.
 */
export function resolveRoutedHandler(
  contextSlug: string,
  handlerSlug: string,
  contexts: readonly BoundedContextIR[],
  apis: readonly ApiIR[],
): RoutedHandlerTarget | undefined {
  for (const api of apis) {
    for (const route of api.routes) {
      const ctx = contexts.find((c) => c.name === route.target.context);
      if (!ctx) continue;
      if (!matchesName(ctx.name, contextSlug)) continue;
      const cmd = (ctx.commandHandlers ?? []).find((h) => h.name === route.target.handler);
      const qry = (ctx.queryHandlers ?? []).find((h) => h.name === route.target.handler);
      const handler = cmd ?? qry;
      if (!handler) continue;
      if (!matchesName(handler.name, handlerSlug)) continue;
      return {
        apiName: api.name,
        route,
        context: ctx,
        handler,
        handlerKind: cmd ? "command" : "query",
        bindings: bindParams(handler, route),
      };
    }
  }
  return undefined;
}

/** Where one handler param (or request-record field) named `name` rides on
 *  `route`: the URL when it is a `{token}` of the path; else the query string
 *  on the paged-run shape or a bodyless method (`GET` / `DELETE` / `HEAD`,
 *  which `fetch` cannot give a body); else the JSON body.  A single-row read
 *  routed this way (`scaffoldGet`) answers on the same URL a declared find's
 *  `GET /<aggs>/<find>?<param>=…` did.  Every backend's explicit-route emitter
 *  binds by this rule. */
export function routedParamSource(name: string, route: RouteIR, paged: boolean): RoutedParamSource {
  if (routePathTokens(route.path).includes(name)) return "path";
  if (paged || BODYLESS_METHODS.has(route.method.toUpperCase())) return "query";
  return "body";
}

/** Per-param wire source, in declared order.  See the file header for why this
 *  mirrors the emitters rather than restating the wire in its own words. */
function bindParams(
  handler: CommandHandlerIR | QueryHandlerIR,
  route: RouteIR,
): RoutedHandlerBinding[] {
  const paged = isPagedRun(handler);
  return handler.params.map((param) => ({
    param,
    source: routedParamSource(param.name, route, paged),
  }));
}

/** Every `api.<ctx>.<handler>(…)` spelling this deployable answers — the
 *  "Available:" tail of an unresolved-call diagnostic. */
export function routedHandlerCallHints(
  contexts: readonly BoundedContextIR[],
  apis: readonly ApiIR[],
): string[] {
  const out: string[] = [];
  for (const api of apis) {
    for (const route of api.routes) {
      const ctx = contexts.find((c) => c.name === route.target.context);
      if (!ctx) continue;
      const declared =
        (ctx.commandHandlers ?? []).some((h) => h.name === route.target.handler) ||
        (ctx.queryHandlers ?? []).some((h) => h.name === route.target.handler);
      if (!declared) continue;
      out.push(`api.${lowerFirst(ctx.name)}.${lowerFirst(route.target.handler)}`);
    }
  }
  return [...new Set(out)].sort();
}

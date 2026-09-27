// ---------------------------------------------------------------------------
// Where an explicit `route <METHOD> <PATH> -> <Ctx>.<Handler>` is MOUNTED.
//
// The contract (M-T6.73): an explicit route is a DOMAIN route, so it serves
// under the shared `API_BASE_PATH` — `route POST "/echo/{text}"` answers at
// `POST /api/echo/hi` on every backend.  That is not a per-backend preference:
// `src/system/e2e-render.ts` builds EVERY routed-handler request as
// `base + API_BASE_PATH + <declared path>` for all five platforms, and
// `src/util/api-base.ts` states the rule ("domain routes live under `/api`,
// infra endpoints stay at the root").  node/hono already mounted this way; .NET,
// java and elixir served the declared path at the ROOT, so the caller's request
// 404'd on three of five backends while all five compiled clean.
//
// THE EXCEPTION, and why this module exists.  `with scaffoldHandlers` +
// `with scaffoldApi` synthesises one explicit handler per create / operation /
// find / get-by-id / destroy, so the api's explicit route list becomes a 1:1
// DUPLICATE of the always-on auto-derived REST surface — measured on
// `test/e2e/fixtures/elixir-vanilla-build/vanilla-scaffold-handlers.ddd`, all
// EIGHT explicit routes shadow an auto-CRUD route of the same method and path
// shape (`GET /orders/:order_id` vs `GET /orders/:id`, …).  Moving those under
// `/api` puts two handlers on one slot, and the frameworks disagree on what
// that means:
//
//   • elixir  — a second, unreachable `do_match` clause: `mix compile
//               --warnings-as-errors` FAILS (a build break, not a 404).
//   • .NET    — `AmbiguousMatchException` at request time.
//   • java    — `IllegalStateException: Ambiguous handler methods mapped` at
//               request time (registration succeeds: `{orderId}` and `{id}`
//               are different pattern strings, so Spring only discovers the
//               tie when it compares specificity on a real request).
//   • node /  — first registration wins, silently.  Both already mount under
//     python   `/api`, and the auto-CRUD router is mounted first, so the
//              scaffolded explicit route is already dead code there.
//
// So a colliding route keeps its historical root-absolute mounting: that is
// exactly today's emitted output for the scaffold shape (no behaviour change,
// no regression), while every route that does NOT collide — the whole reason
// the feature exists — moves to the `/api` slot the caller asks for.  The
// duplicate surface `scaffoldApi` emits is a SEPARATE pre-existing defect (on
// node the scaffolded route is unreachable today); this module only declines to
// make it worse.
//
// The collision test is deliberately CONSERVATIVE: over-approximating leaves a
// route at the root, which preserves today's behaviour; under-approximating
// breaks a build.  It compares against `deriveContextOperations` — the one
// shared derivation of the lifted REST surface (`src/ir/util/api-surface.ts`)
// — plus the two aggregate-scoped classes that derivation deliberately does
// NOT lift (`apiSurfaceCoverage.notLifted`: `GET <base>/{id}/history` and
// `GET <base>/prepare`), so it cannot drift as that surface grows.
// ---------------------------------------------------------------------------

import type { EnrichedBoundedContextIR, RouteIR } from "../../ir/types/loom-ir.js";
import { aggregateSegment, deriveContextOperations } from "../../ir/util/api-surface.js";
import { API_BASE_PATH } from "../../util/api-base.js";

/**
 * The `{token}` names in a route path — the params bound from the URL rather
 * than the request body.
 *
 * The .NET, java and python route emitters each still carry a private copy of
 * this three-liner; this is the shared one, and a new consumer takes it from
 * here rather than adding a fourth.
 */
export function pathParamNames(path: string): Set<string> {
  const names = new Set<string>();
  for (const m of path.matchAll(/\{(\w+)\}/g)) names.add(m[1]!);
  return names;
}

/** Collapse every path parameter to a single placeholder, so two paths that
 *  differ only in a param's NAME compare equal — which is how every router
 *  matches them (`/orders/{orderId}` and `/orders/{id}` are one slot).
 *  Accepts both the `{brace}` form the IR carries and the `:colon` form the
 *  Phoenix emitter rewrites to. */
function normalizePath(path: string): string {
  return path.replace(/\{\w+\}/g, "{}").replace(/:\w+/g, "{}");
}

/** `"get /api/orders/{}"` — the router slot a method+path pair occupies. */
function slot(method: string, path: string): string {
  return `${method.toLowerCase()} ${normalizePath(path)}`;
}

/**
 * Every router slot the AUTO-DERIVED REST surface occupies across the given
 * contexts, as `"<method> <normalized absolute path>"` strings.  Paths are
 * absolute and already carry `API_BASE_PATH` (`aggregateBase` builds them that
 * way), so they compare directly against an explicit route mounted under the
 * api base.
 */
export function derivedRouteSlots(contexts: readonly EnrichedBoundedContextIR[]): Set<string> {
  const out = new Set<string>();
  for (const ctx of contexts) {
    for (const op of deriveContextOperations(ctx)) out.add(slot(op.method, op.path));
    // The two aggregate-scoped route classes `deriveContextOperations`
    // deliberately leaves unlifted (`apiSurfaceCoverage.notLifted`).  Added
    // unconditionally rather than behind their per-aggregate predicates
    // (`servesHistory`, the create-defaults gate): an aggregate that does NOT
    // serve one only gets a slot no explicit route was going to reach anyway,
    // and guessing wrong in THIS direction costs a root-mounted route, not a
    // broken build.
    for (const agg of ctx.aggregates) {
      if (agg.isAbstract) continue;
      const base = `${API_BASE_PATH}/${aggregateSegment(agg.name)}`;
      out.add(slot("get", `${base}/{}/history`));
      out.add(slot("get", `${base}/prepare`));
    }
  }
  return out;
}

/**
 * Does this explicit route mount under `API_BASE_PATH`?
 *
 * `true` (the rule) — emit it under the api base, which is where the caller
 * asks for it.  `false` (the scaffold-duplicate exception) — keep the
 * historical root-absolute mounting, because the `/api` slot is already taken
 * by an auto-derived route and the frameworks resolve that tie by breaking.
 */
export function routeMountsUnderApiBase(route: RouteIR, derivedSlots: ReadonlySet<string>): boolean {
  return !derivedSlots.has(slot(route.method, `${API_BASE_PATH}${route.path}`));
}

/**
 * The path an explicit route serves at, absolute from the host root — i.e.
 * `/api/echo/{text}` for an ordinary route, and the bare declared path for one
 * that collides with the auto-derived surface.  The three emitters that render
 * a full absolute path (.NET's `[Http*]` template, java's `@*Mapping`, the
 * hono/python routers' own prefixing aside) go through this so they cannot
 * disagree about which routes moved.
 */
export function explicitRoutePath(route: RouteIR, derivedSlots: ReadonlySet<string>): string {
  return routeMountsUnderApiBase(route, derivedSlots) ? `${API_BASE_PATH}${route.path}` : route.path;
}

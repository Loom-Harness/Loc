// Which handler a `route` reaches.
//
// A `send <Ctx>.<Record>` route reaches the record's one handler, the answer
// `handlerFor` gives; a `-> <Ctx>.<Handler>` route names its handler.  The
// route stores no handler name, so every reader (the validator, each
// backend's explicit-route emitter, the OpenAPI document, the entry surface)
// asks here, and two readers can never reach different handlers for one
// route.  `test/system/route-handler-census.test.ts` keeps it the only reader
// of a route's binding.

import type { CommandHandlerIR, QueryHandlerIR, RouteIR } from "../types/loom-ir.js";
import { type CommandBusContext, handlerFor } from "./command-bus.js";

/** The handler a route dispatches to, and whether it is a write or a read. */
export type RoutedHandler =
  | { readonly kind: "command"; readonly handler: CommandHandlerIR }
  | { readonly kind: "query"; readonly handler: QueryHandlerIR };

/** The context a route dispatches into. */
export function routeContext(route: RouteIR): string {
  return route.binding.context;
}

/** The record a `send` route carries, or undefined for a `->` route. */
export function routeRecord(route: RouteIR): string | undefined {
  return route.binding.kind === "send" ? route.binding.record : undefined;
}

/** The name of the handler a route reaches in `ctx`: the named handler of a
 *  `->` route, or the one `commandHandler` / `queryHandler` catching a sent
 *  record.  Undefined when a sent record has no such handler (none, several,
 *  or a workflow `create`), which the validator refuses. */
export function routeHandlerName(route: RouteIR, ctx: CommandBusContext): string | undefined {
  const b = route.binding;
  if (b.kind === "handler") return b.handler;
  const caught = handlerFor(ctx, b.record);
  return caught && caught.handler.form !== "workflow-create" ? caught.handler.name : undefined;
}

/** The declared handler a route reaches in `ctx`, or undefined when it names
 *  none there. */
export function routeHandler(route: RouteIR, ctx: CommandBusContext): RoutedHandler | undefined {
  const name = routeHandlerName(route, ctx);
  if (name === undefined) return undefined;
  const cmd = (ctx.commandHandlers ?? []).find((h) => h.name === name);
  if (cmd) return { handler: cmd, kind: "command" };
  const qry = (ctx.queryHandlers ?? []).find((h) => h.name === name);
  return qry ? { handler: qry, kind: "query" } : undefined;
}

/** The context a route dispatches into, among `contexts`, with the handler it
 *  reaches there. */
export function resolveRoute<C extends CommandBusContext>(
  route: RouteIR,
  contexts: ReadonlyMap<string, C> | readonly C[],
): { readonly context: C; readonly routed: RoutedHandler } | undefined {
  const name = routeContext(route);
  const context =
    contexts instanceof Map
      ? contexts.get(name)
      : (contexts as readonly C[]).find((c) => c.name === name);
  if (!context) return undefined;
  const routed = routeHandler(route, context);
  return routed ? { context, routed } : undefined;
}

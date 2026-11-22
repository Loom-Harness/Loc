// The handler a `route` reaches, read off the AST for either route form.
//
// `route M "p" -> Ctx.Handler` names it.  `route M "p" send Ctx.Record` names
// the request record, and the handler is the record's one catcher: the
// `commandHandler` / `queryHandler` whose only parameter is typed by that
// record.  The IR settles the same question through the plan fact
// `handlerFor` (`src/ir/plan/command-bus.ts`), which also counts a workflow
// `create`; this AST twin serves the language-side readers (typing, the
// printer) that run before lowering, and answers `undefined` whenever the
// record has no one handler, which phase ⑦ refuses.

import type { Reference } from "langium";
import type { BoundedContext, CommandHandler, QueryHandler, Route } from "./generated/ast.js";
import { isCommandHandler, isNamedType, isQueryHandler } from "./generated/ast.js";

/** The route's context: the `->` target's, or the sent record's. */
export function routeContextRef(route: Route): Reference<BoundedContext> | undefined {
  return route.target?.context ?? route.sends?.context;
}

/** The handler a route reaches, by name: the `->` target's, or the one handler
 *  in the record's context taking the sent record as its only parameter. */
export function routeHandlerName(
  route: Route,
  ctx: BoundedContext | undefined,
): string | undefined {
  if (route.target) return route.target.handler;
  const record = route.sends?.record;
  if (!record || !ctx) return undefined;
  const catchers = ctx.members.filter(
    (m): m is CommandHandler | QueryHandler =>
      (isCommandHandler(m) || isQueryHandler(m)) &&
      m.params.length === 1 &&
      isNamedType(m.params[0]?.type?.base) &&
      m.params[0]!.type.base.target.$refText === record,
  );
  return catchers.length === 1 ? catchers[0]!.name : undefined;
}
